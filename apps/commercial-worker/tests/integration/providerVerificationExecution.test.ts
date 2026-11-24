import { createHash, randomBytes, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../../commercial-api/src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type TransactionalPool } from "../../../commercial-api/src/database/runtimePool.js";
import {
  reconcileProviderVerificationJobs,
  type ProviderVerificationReconciliationPassResult,
} from "../../../commercial-api/src/providerConnections/providerVerificationReconciliationService.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../../commercial-api/src/startCommercialApiServer.js";
import { createWorkerControlApplication } from "../../../commercial-api/src/workerControl/workerControlApplication.js";
import { WORKER_LEASE_TOKEN_PATTERN } from "../../../commercial-api/src/workerControl/workerLeasePolicy.js";
import type { WorkerSecurityEvent } from "../../../commercial-api/src/workerControl/workerSecurityEvents.js";
import { insertAccountWithFreeGrant, openGuardedClients, prepareSchemaV1, type GuardedClients } from "../../../commercial-api/tests/db/support/testDatabase.js";
import { createTestWorkerAuthenticationAdapter } from "../../../commercial-api/tests/support/testWorkerAuthentication.js";
import { createRecordingWorkerSecurityEventSink } from "../../../commercial-api/tests/support/testWorkerSecurityEvents.js";
import { loadProviderVerificationConfig } from "../../src/providerVerificationConfig.js";
import { SUPPORTED_PROVIDER_VERIFICATION_PAIRS, type ProviderVerificationResultReport } from "../../src/providerVerificationContract.js";
import { runProviderVerification, type ProviderVerificationRunResult } from "../../src/providerVerificationRun.js";
import type { ProviderVerificationDeadlineTimer } from "../../src/providerVerificationTransport.js";
import { createHttpProviderVerificationControlClient, type LeaseProof } from "../../src/workerControlClient.js";
import { WorkerError } from "../../src/workerError.js";
import { createTestCredentialFingerprinter, createTestCredentialOpener, createTestCredentialSealer, generateTestKey } from "../support/testCredentialOpening.js";

// R44B11F Phase 8 (architecture "R44B11F Phase 8 race, idempotency, boundary
// and integration regression contract amendment"). Integration proof only:
// the published Phase 3 to Phase 7 behaviour against the real commercial-api
// worker-control router and services served on loopback, real PostgreSQL 16
// transactions on the guarded test database, direct reconciliation passes,
// the real worker control client and the Phase 7 run with a counting fake
// provider fetchImpl. No commercial-api service is mocked, no provider network
// is contacted and no real credential exists: credentials are generated
// fixture strings sealed by the test sealer.
//
// PostgreSQL is the only time authority. Lease expiry is decided only by
// SELECT clock_timestamp() > $1::timestamptz against an exact ::text capture;
// exact timestamp proofs compare ::text captures cast back inside PostgreSQL.
// Race ordering uses a sidecar migrator transaction holding the Account row
// FOR UPDATE, proven by pg_blocking_pids and a FOR UPDATE NOWAIT probe; no
// fixed sleep establishes order. Secret assertions are booleans.

let clients: GuardedClients;
let pool: TransactionalPool;
let server: RunningCommercialApiServer | undefined;
let events: WorkerSecurityEvent[] = [];
let serverFailures: string[] = [];
let runtimeConfig: NonNullable<ReturnType<typeof loadRuntimeDatabaseConfig>>;
// Contract item K, literally: every fixture secret the test creates (plaintext
// credentials and machine credentials) and every artefact it captures (control
// bodies, run results), swept after each test with boolean assertions only.
let fixtureSecrets: string[] = [];
let capturedExchanges: Exchange[] = [];
let capturedRuns: CapturedRun[] = [];

// Test-only runtime pool timeouts (architecture "Phase 8 runtime pool
// configuration"), passed as a literal record; no production default changes.
const LOCK_TIMEOUT_MS = 60000;
const STATEMENT_TIMEOUT_MS = 90000;
const SIDECAR_MAX_HOLD_MS = 20000;
// Technique B: a migrator short lease of at most 5 seconds, never handed to a Phase 7 run.
const SHORT_LEASE_SECONDS = 3;
// A short delay between PostgreSQL clock polls, only to avoid busy-looping.
const POLL_DELAY_MS = 25;
const SHORT_EXPIRY_MAX_POLLS = 400;
const REAL_EXPIRY_MAX_POLLS = 2400;
const REAL_WAIT_TEST_TIMEOUT_MS = 120000;

const encryptionKey = generateTestKey("phase8-verification-encryption/v1");
const sealer = createTestCredentialSealer(encryptionKey);
const fingerprinter = createTestCredentialFingerprinter(generateTestKey("phase8-verification-fingerprint/v1"), encryptionKey);
const CREDENTIAL_PURPOSE = "provider-credential" as const;

const VERIFIED_REPORT: ProviderVerificationResultReport = Object.freeze({ outcome: "VERIFIED", reasonCode: "VERIFICATION_SUCCEEDED" });
const TIMEOUT_REPORT: ProviderVerificationResultReport = Object.freeze({ outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_TIMEOUT" });
const REJECTED_BODY = '{"status":"error","code":"LEASE_REJECTED"}\n';
const ZERO_PASS: ProviderVerificationReconciliationPassResult = Object.freeze({ cancelledJobs: 0, requeuedJobs: 0, completedJobs: 0 });

beforeAll(async () => {
  clients = await openGuardedClients();
  const loaded = loadRuntimeDatabaseConfig(
    {
      COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl,
      COMMERCIAL_API_DATABASE_POOL_MAX: "6",
      COMMERCIAL_API_DATABASE_LOCK_TIMEOUT_MS: "60000",
      COMMERCIAL_API_DATABASE_STATEMENT_TIMEOUT_MS: "90000",
    },
    "development",
  );
  if (loaded === null) throw new Error("the Phase 8 runtime pool configuration did not load");
  runtimeConfig = loaded;
  pool = await createRuntimePool(runtimeConfig, () => {});
});
beforeEach(async () => {
  await prepareSchemaV1(clients);
  events = [];
  serverFailures = [];
  fixtureSecrets = [];
  capturedExchanges = [];
  capturedRuns = [];
});
afterEach(async () => {
  // A failed race never leaves the sidecar transaction open.
  if (activeSidecar !== null) {
    activeSidecar = null;
    await clients.migrator.query("ROLLBACK");
  }
  await server?.close();
  server = undefined;
  await expectCapturedArtefactsSecretFree();
});
afterAll(async () => {
  await pool.end();
  await prepareSchemaV1(clients);
  await clients.close();
});

// ---------------------------------------------------------------------------
// Fixtures, committed by the migration owner

type Machine = Readonly<{ id: string; credential: string }>;

async function machine(): Promise<Machine> {
  const id = (await clients.migrator.query<{ id: string }>("INSERT INTO worker_principals (label) VALUES ('phase8-verification-worker') RETURNING id")).rows[0]!.id;
  const credential = `fixture-machine-${randomBytes(16).toString("hex")}`;
  fixtureSecrets.push(credential);
  return { id, credential };
}

async function controlPlane(machines: readonly Machine[]): Promise<string> {
  const recording = createRecordingWorkerSecurityEventSink();
  events = recording.events;
  const application = createWorkerControlApplication({
    authentication: createTestWorkerAuthenticationAdapter(machines.map((each) => ({ token: each.credential, workerPrincipalId: each.id }))),
    securityEvents: recording.sink,
    pool,
    reportFailure: (text) => {
      serverFailures.push(text);
    },
  });
  server = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { application, checkReadiness: async () => true } });
  return `http://127.0.0.1:${server.port}`;
}

type Job = Readonly<{
  userId: string;
  accountId: string;
  connectionId: string;
  versionId: string;
  jobId: string;
  provider: string;
  plaintext: string;
}>;

async function insertVersion(accountId: string, connectionId: string, provider: string, credentialVersion: number, userId: string) {
  const plaintext = `fixture-credential-${randomBytes(18).toString("hex")}`;
  fixtureSecrets.push(plaintext);
  const envelope = await sealer.seal(plaintext, { accountId, providerConnectionId: connectionId, provider, credentialVersion, purpose: CREDENTIAL_PURPOSE });
  const fingerprint = await fingerprinter.fingerprint(plaintext);
  const id = (
    await clients.migrator.query<{ id: string }>(
      `INSERT INTO provider_credential_versions (account_id, provider_connection_id, credential_version, sealed_credential, fingerprint_algorithm,
                                                 fingerprint_key_ref, fingerprint_value, created_by_user_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8) RETURNING id`,
      [accountId, connectionId, credentialVersion, JSON.stringify(envelope), fingerprint.algorithm, fingerprint.keyRef, fingerprint.value, userId],
    )
  ).rows[0]!.id;
  return { id, plaintext };
}

// One Account, one connection for a supported pair with an ACTIVE sealed v1,
// and one QUEUED verification job (fencing counter 0) bound to v1.
async function seedJob(pairIndex = 0): Promise<Job> {
  const pair = SUPPORTED_PROVIDER_VERIFICATION_PAIRS[pairIndex % SUPPORTED_PROVIDER_VERIFICATION_PAIRS.length]!;
  const owner = await insertAccountWithFreeGrant(clients.migrator, `phase8-verification-${randomUUID()}`);
  const connectionId = (
    await clients.migrator.query<{ id: string }>(
      "INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id) VALUES ($1, $2, 'API_KEY', $3) RETURNING id",
      [owner.accountId, pair.provider, owner.userId],
    )
  ).rows[0]!.id;
  const version = await insertVersion(owner.accountId, connectionId, pair.provider, 1, owner.userId);
  const jobId = (
    await clients.migrator.query<{ id: string }>(
      `INSERT INTO provider_verification_jobs (account_id, provider_connection_id, provider_credential_version_id, verification_policy_id, requested_by_user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [owner.accountId, connectionId, version.id, pair.verificationPolicyId, owner.userId],
    )
  ).rows[0]!.id;
  return Object.freeze({
    userId: owner.userId,
    accountId: owner.accountId,
    connectionId,
    versionId: version.id,
    jobId,
    provider: pair.provider,
    plaintext: version.plaintext,
  });
}

// Lifecycle facts committed by the migration owner.
async function rotate(job: Job): Promise<void> {
  await clients.migrator.query("UPDATE provider_credential_versions SET status = 'SUPERSEDED', superseded_at = now(), updated_at = now() WHERE id = $1", [job.versionId]);
  await insertVersion(job.accountId, job.connectionId, job.provider, 2, job.userId);
}
const destroyBoundVersion = (job: Job) =>
  clients.migrator.query(
    `UPDATE provider_credential_versions SET status = 'DESTROYED', destroyed_at = now(), sealed_credential = NULL,
            fingerprint_algorithm = NULL, fingerprint_key_ref = NULL, fingerprint_value = NULL
      WHERE id = $1`,
    [job.versionId],
  );

const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

// Technique B: a migrator QUEUED -> LEASED with fence = previous + 1, a
// test-generated token stored only as its SHA-256 verifier, and
// leased_at / lease_expires_at from clock_timestamp(). The exact expiry is
// returned as text and never converted to a JavaScript Date.
async function shortLease(job: Job, worker: Machine): Promise<Readonly<{ proof: LeaseProof; expiresText: string }>> {
  const leaseToken = randomBytes(32).toString("base64url");
  expect(WORKER_LEASE_TOKEN_PATTERN.test(leaseToken)).toBe(true);
  const row = (
    await clients.migrator.query<{ fence: number; expires: string }>(
      `UPDATE provider_verification_jobs
          SET state = 'LEASED', lease_worker_principal_id = $2, lease_token_sha256 = $3,
              lease_fencing_counter = lease_fencing_counter + 1, leased_at = clock_timestamp(),
              lease_expires_at = clock_timestamp() + make_interval(secs => $4), updated_at = now()
        WHERE id = $1 AND state = 'QUEUED'
        RETURNING lease_fencing_counter::integer AS fence, lease_expires_at::text AS expires`,
      [job.jobId, worker.id, sha256Hex(leaseToken), SHORT_LEASE_SECONDS],
    )
  ).rows[0]!;
  return { proof: Object.freeze({ fencingCounter: row.fence, leaseToken }), expiresText: row.expires };
}

// ---------------------------------------------------------------------------
// Reads (the fixture runtime connection, usable while the sidecar holds the migrator)

const one = <T extends object>(sql: string, params: unknown[] = []) => clients.runtime.query<T>(sql, params).then((result) => result.rows[0]!);

const jobSnapshot = (jobId: string) =>
  one<{ text: string }>("SELECT row_to_json(j)::text AS text FROM provider_verification_jobs j WHERE id = $1", [jobId]).then((row) => row.text);
const connectionSnapshot = (connectionId: string) =>
  one<{ text: string }>("SELECT row_to_json(c)::text AS text FROM provider_connections c WHERE id = $1", [connectionId]).then((row) => row.text);

type JobState = Readonly<{
  state: string;
  fence: number;
  granted: boolean;
  verifying: boolean;
  result_outcome: string | null;
  terminal_reason_code: string | null;
  result_worker_principal_id: string | null;
  result_fencing_counter: number | null;
  verifying_worker_principal_id: string | null;
  verifying_fencing_counter: number | null;
  lease_worker_principal_id: string | null;
  live_lease_cleared: boolean;
}>;
const jobState = (jobId: string) =>
  one<JobState>(
    `SELECT state, lease_fencing_counter::integer AS fence, credential_granted_at IS NOT NULL AS granted, verifying_at IS NOT NULL AS verifying,
            result_outcome, terminal_reason_code, result_worker_principal_id, result_fencing_counter::integer AS result_fencing_counter,
            verifying_worker_principal_id, verifying_fencing_counter::integer AS verifying_fencing_counter, lease_worker_principal_id,
            (lease_token_sha256 IS NULL AND leased_at IS NULL AND lease_expires_at IS NULL) AS live_lease_cleared
       FROM provider_verification_jobs WHERE id = $1`,
    [jobId],
  );

const auditTypes = async (job: Job) =>
  (
    await clients.runtime.query<{ event_type: string; job: string }>(
      "SELECT event_type, metadata->>'verificationJobId' AS job FROM audit_events WHERE resource_type = 'provider_connection' AND resource_id = $1 ORDER BY sequence",
      [job.connectionId],
    )
  ).rows.map((row) => {
    expect(row.job).toBe(job.jobId);
    return row.event_type;
  });
const auditCount = () => one<{ total: number }>("SELECT count(*)::integer AS total FROM audit_events").then((row) => row.total);

// Every test asserting pass counts first proves no other job is actionable.
async function expectOnlyTargetsActionable(jobs: readonly Job[]): Promise<void> {
  const row = await one<{ others: number }>(
    "SELECT count(*)::integer AS others FROM provider_verification_jobs WHERE NOT (id = ANY($1::uuid[])) AND state IN ('QUEUED', 'LEASED', 'VERIFYING')",
    [jobs.map(({ jobId }) => jobId)],
  );
  expect(row.others).toBe(0);
}

const reconcile = () => reconcileProviderVerificationJobs(pool, { correlationId: randomUUID() });

// Rows of the verification and audit state containing the value.
const rowHits = (value: string) =>
  one<{ hits: number }>(
    `SELECT ((SELECT count(*) FROM provider_verification_jobs t WHERE strpos(t::text, $1) > 0)
           + (SELECT count(*) FROM provider_connections t WHERE strpos(t::text, $1) > 0)
           + (SELECT count(*) FROM audit_events t WHERE strpos(t::text, $1) > 0))::integer AS hits`,
    [value],
  ).then((row) => row.hits);

// ---------------------------------------------------------------------------
// PostgreSQL time authority (exact ::text captures, compared only in PostgreSQL)

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const never = <T>() => new Promise<T>(() => {});

const expiryCrossed = (expiresText: string) =>
  one<{ expired: boolean }>("SELECT clock_timestamp() > $1::timestamptz AS expired", [expiresText]).then((row) => row.expired);

// Polls the database clock until it crosses the captured expiry. The delay
// only avoids a busy loop; it is never the oracle.
async function untilExpired(expiresText: string, maxPolls: number, during: () => void = () => undefined): Promise<void> {
  for (let poll = 0; poll < maxPolls; poll += 1) {
    during();
    if (await expiryCrossed(expiresText)) return;
    await pause(POLL_DELAY_MS);
  }
  throw new Error("the PostgreSQL clock did not cross the captured lease expiry");
}

const startedBeforeExpiry = (xactStartText: string, expiresText: string) =>
  one<{ started_before_expiry: boolean }>("SELECT $1::timestamptz < $2::timestamptz AS started_before_expiry", [xactStartText, expiresText]).then(
    (row) => row.started_before_expiry,
  );

// ---------------------------------------------------------------------------
// Technique C: the sidecar, the blocker oracle and the NOWAIT probe

type Sidecar = Readonly<{ pid: number; check: () => void; release: () => Promise<void> }>;
let activeSidecar: Sidecar | null = null;

// The migrator fixture connection holds the job's Account row FOR UPDATE,
// changes nothing and ends with ROLLBACK, within SIDECAR_MAX_HOLD_MS.
async function sidecar(accountId: string): Promise<Sidecar> {
  await clients.migrator.query("BEGIN");
  const pid = (await clients.migrator.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
  await clients.migrator.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [accountId]);
  const acquiredAt = Date.now();
  const check = () => {
    if (Date.now() - acquiredAt >= SIDECAR_MAX_HOLD_MS) throw new Error("the sidecar hold reached its maximum");
  };
  const held: Sidecar = Object.freeze({
    pid,
    check,
    release: async () => {
      check();
      activeSidecar = null;
      await clients.migrator.query("ROLLBACK");
    },
  });
  activeSidecar = held;
  return held;
}

// The unique active commercial-api backend whose blockers include the
// expected PID. Each lookup is its own autocommit statement on the fixture
// runtime connection; more than one match fails rather than choosing.
async function blockedBy(blockerPid: number, during: () => void): Promise<number> {
  for (let poll = 0; poll < 400; poll += 1) {
    during();
    const rows = (
      await clients.runtime.query<{ pid: number }>(
        `SELECT pid FROM pg_stat_activity
          WHERE application_name = 'commercial-api' AND state = 'active' AND $1::integer = ANY(pg_blocking_pids(pid))`,
        [blockerPid],
      )
    ).rows;
    if (rows.length > 1) throw new Error("more than one backend is blocked by the expected blocker");
    if (rows.length === 1) return rows[0]!.pid;
    await pause(10);
  }
  throw new Error("no backend was observed blocked by the expected blocker");
}

const stillBlockedBy = (pid: number, blockerPid: number) =>
  one<{ blocked: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND state = 'active' AND $2::integer = ANY(pg_blocking_pids(pid))) AS blocked", [
    pid,
    blockerPid,
  ]).then((row) => row.blocked);

// pg_stat_activity.xact_start of the still-blocked backend, as exact text.
async function xactStartWhileBlocked(pid: number, blockerPid: number): Promise<string> {
  const rows = (
    await clients.runtime.query<{ xact_start: string }>(
      "SELECT xact_start::text AS xact_start FROM pg_stat_activity WHERE pid = $1 AND state = 'active' AND $2::integer = ANY(pg_blocking_pids(pid))",
      [pid, blockerPid],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  return rows[0]!.xact_start;
}

// The job row is held by another transaction: a non-blocking probe in its own
// rolled-back transaction fails 55P03, mutating and waiting for nothing.
async function expectJobRowHeld(jobId: string): Promise<void> {
  await clients.runtime.query("BEGIN");
  let code: unknown = "NONE";
  try {
    await clients.runtime.query("SELECT id FROM provider_verification_jobs WHERE id = $1 FOR UPDATE NOWAIT", [jobId]);
  } catch (error) {
    expectErrorSecretFree(error);
    code = (error as { code?: unknown }).code;
  } finally {
    await clients.runtime.query("ROLLBACK");
  }
  expect(code).toBe("55P03");
}

// ---------------------------------------------------------------------------
// Worker side

// K: no fixture secret in a captured error's string form, message, JSON form
// or stack. One boolean, so a failure never prints a secret.
function expectErrorSecretFree(error: unknown): void {
  const shape = (error ?? {}) as { message?: unknown; stack?: unknown };
  const forms = [String(error), String(shape.message), JSON.stringify(error) ?? "", String(shape.stack)];
  expect(forms.some((form) => fixtureSecrets.some((secret) => form.includes(secret)))).toBe(false);
}

// Every captured rejection passes the K error assertion before any caller sees it.
type Settled<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: unknown }>;
const settle = <T>(promise: Promise<T>): Promise<Settled<T>> =>
  promise.then(
    (value): Settled<T> => ({ ok: true, value }),
    (error: unknown): Settled<T> => {
      expectErrorSecretFree(error);
      return { ok: false, error };
    },
  );
const codeOf = (settled: Settled<unknown>) => (settled.ok ? "OK" : settled.error instanceof WorkerError ? settled.error.code : "UNEXPECTED");

type Exchange = { url: string; status: number; body: string; lost?: true };

// A harness client: the real control client over loopback, recording each
// exchange for status and body assertions.
function harness(baseUrl: string, worker: Machine) {
  const exchanges: Exchange[] = [];
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    const response = await fetch(input, init);
    const body = await response.text();
    const entry: Exchange = { url: String(input), status: response.status, body };
    exchanges.push(entry);
    capturedExchanges.push(entry);
    return new Response(body, { status: response.status, headers: response.headers });
  }) as typeof fetch;
  return { client: createHttpProviderVerificationControlClient({ baseUrl, machineCredential: worker.credential, fetchImpl }), exchanges };
}
type Harness = ReturnType<typeof harness>;

type GraphOptions = Readonly<{
  // The control route suffix after whose committed response the graph crashes.
  freezeAfter?: string;
  // The control route suffix whose committed response is lost exactly once.
  loseOnce?: string;
  // The fake provider never answers and the graph crashes during the provider request.
  providerHangs?: boolean;
  // A crashed graph's deadline timer never fires.
  frozenTimers?: boolean;
  // Harness work before a request is forwarded (never a worker object).
  beforeForward?: (url: string) => Promise<void>;
}>;

const passGate = (): void => undefined;
const frozenTimer: ProviderVerificationDeadlineTimer = () => () => undefined;

// One simulated worker object graph: its own control fetchImpl, client,
// opener, fake provider and run. A crash freezes all of its I/O forever.
function graph(baseUrl: string, worker: Machine, fixtureCredentials: readonly string[], options: GraphOptions = {}) {
  let dead = false;
  let lostDone = false;
  let exchangesAtDeath = -1;
  let attemptsAfterDeath = 0;
  const exchanges: Exchange[] = [];
  const die = () => {
    dead = true;
    exchangesAtDeath = exchanges.length;
  };
  const control = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    if (dead) {
      attemptsAfterDeath += 1;
      return never<Response>();
    }
    if (options.beforeForward !== undefined) await options.beforeForward(url);
    const response = await fetch(input, init);
    const body = await response.text();
    const entry: Exchange = { url, status: response.status, body };
    exchanges.push(entry);
    capturedExchanges.push(entry);
    if (options.freezeAfter !== undefined && url.endsWith(options.freezeAfter)) {
      // The server committed and answered; the graph dies before observing it.
      die();
      return never<Response>();
    }
    if (options.loseOnce !== undefined && !lostDone && url.endsWith(options.loseOnce)) {
      // The server committed; the response is consumed and lost in transport.
      lostDone = true;
      entry.lost = true;
      throw new TypeError("simulated response loss after the server committed");
    }
    return new Response(body, { status: response.status, headers: response.headers });
  }) as typeof fetch;

  // The fake provider: counts calls, performs no I/O and answers a success
  // shape both supported classifiers accept, with a marker body.
  let providerCalls = 0;
  let credentialPresented = false;
  const providerMarker = `fixture-provider-body-${randomBytes(8).toString("hex")}`;
  const provider = (async (_input: URL | string, init?: RequestInit) => {
    providerCalls += 1;
    const headers = Object.values((init?.headers ?? {}) as Readonly<Record<string, string>>);
    credentialPresented = headers.some((value) => fixtureCredentials.some((credential) => value.includes(credential)));
    if (options.providerHangs === true) {
      die();
      return never<Response>();
    }
    return new Response(JSON.stringify({ marker: providerMarker }), { status: 200 });
  }) as typeof fetch;

  const client = createHttpProviderVerificationControlClient({ baseUrl, machineCredential: worker.credential, fetchImpl: control });
  const opener = createTestCredentialOpener(encryptionKey);
  let settled: ProviderVerificationRunResult | undefined;
  const start = () => {
    const promise = runProviderVerification(
      { config: loadProviderVerificationConfig({}), environment: {} },
      { client, opener, fetchImpl: provider, liveGate: passGate, ...(options.frozenTimers === true ? { deadlineTimer: frozenTimer } : {}) },
    );
    promise.then((value) => {
      settled = value;
    });
    return promise;
  };
  capturedRuns.push({ exchanges, settled: () => settled, providerMarker });
  return {
    start,
    settled: () => settled,
    exchanges,
    paths: () => exchanges.map(({ url }) => new URL(url).pathname.replace(/^\/worker-control\/v1\/provider-verifications\//, "")),
    isDead: () => dead,
    exchangesAtDeath: () => exchangesAtDeath,
    attemptsAfterDeath: () => attemptsAfterDeath,
    providerCalls: () => providerCalls,
    credentialPresented: () => credentialPresented,
    providerMarker,
  };
}
type Graph = ReturnType<typeof graph>;

// Waits on real I/O for a condition; never a lease or expiry wait.
async function until(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 2000; index += 1) {
    if (condition()) return;
    await pause(5);
  }
  throw new Error("condition not reached");
}

const pathFor = (jobId: string, route: string) => `${jobId}/${route}`;

async function expectRefused(
  h: Harness,
  send: () => Promise<unknown>,
  expected: Readonly<{ code: string; type: WorkerSecurityEvent["type"]; reason: WorkerSecurityEvent["reason"]; job: Job; worker: Machine }>,
): Promise<void> {
  const before = events.length;
  const settled = await settle(send());
  expect(codeOf(settled)).toBe(expected.code);
  // K: the captured error carries no plaintext credential or machine credential.
  const captured = settled.ok ? "" : `${String((settled.error as Error).message)} ${JSON.stringify(settled.error)} ${String((settled.error as Error).stack)}`;
  expect(captured.includes(expected.job.plaintext) || captured.includes(expected.worker.credential)).toBe(false);
  expect(h.exchanges.at(-1)).toMatchObject({ status: 409, body: REJECTED_BODY });
  expect(events).toHaveLength(before + 1);
  expect(events.at(-1)).toMatchObject({ type: expected.type, reason: expected.reason, providerVerificationJobId: expected.job.jobId, workerPrincipalId: expected.worker.id });
}

// Booleans only, so a failure never prints a secret.
async function expectSecretFree(secrets: readonly string[], texts: readonly string[]): Promise<void> {
  for (const secret of secrets) {
    for (const text of texts) expect(text.includes(secret)).toBe(false);
    expect(await rowHits(secret)).toBe(0);
  }
}

type CapturedRun = Readonly<{ exchanges: readonly Exchange[]; settled: () => ProviderVerificationRunResult | undefined; providerMarker: string }>;

// The lease tokens and sealed-envelope ciphertexts a graph received.
function runArtefactSecrets(exchanges: readonly Exchange[]): string[] {
  const found: string[] = [];
  for (const { url, status, body } of exchanges) {
    if (status !== 200) continue;
    if (url.endsWith("/lease")) {
      const token = (JSON.parse(body) as { lease?: { leaseToken?: string } | null }).lease?.leaseToken;
      if (token !== undefined) found.push(token);
    } else if (url.endsWith("/credential-grant")) {
      const ciphertext = (JSON.parse(body) as { credential?: { sealedEnvelope?: { ciphertext?: string } } }).credential?.sealedEnvelope?.ciphertext;
      if (ciphertext !== undefined) found.push(ciphertext);
    }
  }
  return found;
}

// K, swept after every test: no fixture secret in any security event, server
// failure text, captured control body, run result or verification, connection
// or audit row; no lease token, sealed envelope or provider body in any run
// result. Booleans only.
async function expectCapturedArtefactsSecretFree(): Promise<void> {
  const hit = (text: string) => fixtureSecrets.some((secret) => text.includes(secret));
  expect(events.some((event) => hit(JSON.stringify(event)))).toBe(false);
  expect(serverFailures.some(hit)).toBe(false);
  expect(capturedExchanges.some(({ body }) => hit(body))).toBe(false);
  for (const run of capturedRuns) {
    const result = run.settled();
    if (result === undefined) continue;
    const text = JSON.stringify(result);
    expect(hit(text) || [...runArtefactSecrets(run.exchanges), run.providerMarker].some((secret) => text.includes(secret))).toBe(false);
  }
  for (const secret of fixtureSecrets) expect(await rowHits(secret)).toBe(0);
}

const leaseOf = (g: Graph, index = 0) => {
  const body = JSON.parse(g.exchanges.filter(({ url }) => url.endsWith("/lease"))[index]!.body) as {
    lease: { providerVerificationJobId: string; leaseToken: string; fencingCounter: number };
  };
  return body.lease;
};
const ciphertextOf = (g: Graph) =>
  (JSON.parse(g.exchanges.find(({ url }) => url.endsWith("/credential-grant"))!.body) as { credential: { sealedEnvelope: { ciphertext: string } } }).credential.sealedEnvelope
    .ciphertext;

// ---------------------------------------------------------------------------

describe("Phase 8 database guard and runtime pool configuration", () => {
  it("connects only through the guarded fixture and runs races under the explicit test-only lock and statement timeouts", async () => {
    for (const [client, role] of [
      [clients.migrator, "busybookie_commercial_test_migrator"],
      [clients.runtime, "busybookie_commercial_test_runtime"],
    ] as const) {
      const identity = (
        await client.query<{ database: string; role: string; major: number; application_name: string }>(
          "SELECT current_database() AS database, current_user AS role, current_setting('server_version_num')::integer / 10000 AS major, current_setting('application_name') AS application_name",
        )
      ).rows[0]!;
      expect(identity).toEqual({ database: "busybookie_commercial_test", role, major: 16, application_name: "commercial-api-test-db" });
    }

    expect(runtimeConfig.poolMax).toBe(6);
    expect(runtimeConfig.lockTimeoutMs).toBe(LOCK_TIMEOUT_MS);
    expect(runtimeConfig.statementTimeoutMs).toBe(STATEMENT_TIMEOUT_MS);
    expect(SIDECAR_MAX_HOLD_MS < LOCK_TIMEOUT_MS && LOCK_TIMEOUT_MS < STATEMENT_TIMEOUT_MS).toBe(true);
    expect(SHORT_LEASE_SECONDS > 0 && SHORT_LEASE_SECONDS <= 5).toBe(true);

    const session = await pool.connect();
    try {
      const settings = (
        await session.query<{ lock_ok: boolean; statement_ok: boolean; application_name: string; role: string }>(
          `SELECT current_setting('lock_timeout')::interval = interval '60 seconds' AS lock_ok,
                  current_setting('statement_timeout')::interval = interval '90 seconds' AS statement_ok,
                  current_setting('application_name') AS application_name, current_user AS role`,
        )
      ).rows[0]!;
      expect(settings).toEqual({ lock_ok: true, statement_ok: true, application_name: "commercial-api", role: "busybookie_commercial_test_runtime" });
    } finally {
      session.release();
    }
  });
});

describe("A. worker integration path", () => {
  it.each(SUPPORTED_PROVIDER_VERIFICATION_PAIRS.map((_, index) => index))(
    "supported pair %i: runProviderVerification -> real client -> loopback router -> PostgreSQL 16 -> fake provider reports VERIFIED",
    async (pairIndex) => {
      const worker = await machine();
      const job = await seedJob(pairIndex);
      const g = graph(await controlPlane([worker]), worker, [job.plaintext]);

      const result = await g.start();
      expect(result).toMatchObject({ status: "REPORTED", providerVerificationJobId: job.jobId, fencingCounter: 1, outcome: "VERIFIED", reasonCode: "VERIFICATION_SUCCEEDED" });
      expect(g.paths()).toEqual(["lease", pathFor(job.jobId, "credential-grant"), pathFor(job.jobId, "verifying"), pathFor(job.jobId, "result")]);
      expect(g.exchanges.every(({ status }) => status === 200)).toBe(true);
      // Exactly one provider fetch, carrying the opened fixture credential.
      expect(g.providerCalls()).toBe(1);
      expect(g.credentialPresented()).toBe(true);

      expect(await jobState(job.jobId)).toEqual({
        state: "COMPLETED",
        fence: 1,
        granted: true,
        verifying: true,
        result_outcome: "VERIFIED",
        terminal_reason_code: "VERIFICATION_SUCCEEDED",
        result_worker_principal_id: worker.id,
        result_fencing_counter: 1,
        verifying_worker_principal_id: worker.id,
        verifying_fencing_counter: 1,
        lease_worker_principal_id: null,
        live_lease_cleared: true,
      });
      // The aggregate, with verified_at the millisecond copy of completed_at, inside PostgreSQL.
      expect(
        await one(
          `SELECT c.status, c.verification_status,
                  c.verified_at IS NOT NULL AND c.verified_at = date_trunc('milliseconds', j.completed_at) AS verified_at_copy,
                  j.completed_at >= j.verifying_at AND j.verifying_at >= j.credential_granted_at AS ordered
             FROM provider_connections c JOIN provider_verification_jobs j ON j.account_id = c.account_id AND j.provider_connection_id = c.id
            WHERE j.id = $1`,
          [job.jobId],
        ),
      ).toEqual({ status: "ACTIVE", verification_status: "VERIFIED", verified_at_copy: true, ordered: true });
      expect(await auditTypes(job)).toEqual(["provider_connection.verified"]);
      expect(events).toEqual([]);
      expect(serverFailures).toEqual([]);

      // K: no plaintext anywhere; no lease token, sealed envelope or provider body in the run result.
      const lease = leaseOf(g);
      await expectSecretFree([job.plaintext], [JSON.stringify(result), JSON.stringify(events), ...g.exchanges.map(({ body }) => body)]);
      const runText = JSON.stringify(result);
      expect(runText.includes(lease.leaseToken) || runText.includes(ciphertextOf(g)) || runText.includes(g.providerMarker)).toBe(false);
      expect(await rowHits(lease.leaseToken)).toBe(0);
    },
  );
});

describe("B. technique-A lease and fence", () => {
  it("leases the oldest QUEUED job for exactly 30 seconds to the authenticated worker, fence +1, storing only the token verifier", async () => {
    const worker = await machine();
    const oldest = await seedJob(0);
    const newer = await seedJob(1);
    const h = harness(await controlPlane([worker]), worker);

    const lease = (await h.client.leaseProviderVerification())!;
    expect(lease).toMatchObject({ providerVerificationJobId: oldest.jobId, fencingCounter: 1 });
    expect(WORKER_LEASE_TOKEN_PATTERN.test(lease.leaseToken)).toBe(true);
    expect(
      await one(
        `SELECT state, lease_worker_principal_id, lease_token_sha256 = $2 AS verifier_only,
                lease_expires_at - leased_at = interval '30 seconds' AS thirty_seconds, credential_granted_at IS NULL AS ungranted
           FROM provider_verification_jobs WHERE id = $1`,
        [oldest.jobId, sha256Hex(lease.leaseToken)],
      ),
    ).toEqual({ state: "LEASED", lease_worker_principal_id: worker.id, verifier_only: true, thirty_seconds: true, ungranted: true });
    expect(await rowHits(lease.leaseToken)).toBe(0);
    expect(await jobState(newer.jobId)).toMatchObject({ state: "QUEUED", fence: 0 });
    expect(await auditCount()).toBe(0);
  });
});

describe("C. response loss through Phase 7's one exact retry", () => {
  it.each([
    ["credential grant", "/credential-grant"],
    ["VERIFYING", "/verifying"],
    ["result", "/result"],
  ] as const)("%s committed, response lost, replayed exactly once", async (_label, route) => {
    const worker = await machine();
    const job = await seedJob(0);
    const g = graph(await controlPlane([worker]), worker, [job.plaintext], { loseOnce: route });

    const result = await g.start();
    expect(result).toMatchObject({ status: "REPORTED", providerVerificationJobId: job.jobId, fencingCounter: 1, outcome: "VERIFIED", reasonCode: "VERIFICATION_SUCCEEDED" });
    const pair = g.exchanges.filter(({ url }) => url.endsWith(route));
    expect(pair.map(({ status, lost }) => ({ status, lost }))).toEqual([
      { status: 200, lost: true },
      { status: 200, lost: undefined },
    ]);
    // The replayed body equals the lost body: one stamp, barrier or terminal tuple.
    expect(pair[1]!.body).toBe(pair[0]!.body);
    expect(g.exchanges).toHaveLength(5);
    expect(g.providerCalls()).toBe(1);

    const grantedAt = (JSON.parse(g.exchanges.find(({ url }) => url.endsWith("/credential-grant"))!.body) as { credentialGrantedAt: string }).credentialGrantedAt;
    const verifyingAt = (JSON.parse(g.exchanges.find(({ url }) => url.endsWith("/verifying"))!.body) as { verifyingAt: string }).verifyingAt;
    const completedAt = (JSON.parse(g.exchanges.find(({ url }) => url.endsWith("/result"))!.body) as { completedAt: string }).completedAt;
    expect(
      await one(
        `SELECT date_trunc('milliseconds', credential_granted_at) = $2::timestamptz AS one_stamp,
                date_trunc('milliseconds', verifying_at) = $3::timestamptz AS one_barrier,
                date_trunc('milliseconds', completed_at) = $4::timestamptz AS one_terminal
           FROM provider_verification_jobs WHERE id = $1`,
        [job.jobId, grantedAt, verifyingAt, completedAt],
      ),
    ).toEqual({ one_stamp: true, one_barrier: true, one_terminal: true });
    expect(await auditTypes(job)).toEqual(["provider_connection.verified"]);
    expect(serverFailures).toEqual([]);
    await expectSecretFree([job.plaintext], [JSON.stringify(result), ...g.exchanges.map(({ body }) => body)]);
  });

  it("a lost lease response is STOPPED at LEASE with no retry", async () => {
    const worker = await machine();
    const job = await seedJob(0);
    const g = graph(await controlPlane([worker]), worker, [job.plaintext], { loseOnce: "/lease" });

    expect(await g.start()).toEqual({ status: "STOPPED", stage: "LEASE", code: "CONTROL_API_UNAVAILABLE", providerVerificationJobId: null });
    expect(g.paths()).toEqual(["lease"]);
    expect(g.exchanges[0]).toMatchObject({ status: 200, lost: true });
    expect(await jobState(job.jobId)).toMatchObject({ state: "LEASED", fence: 1, granted: false });
    expect(g.providerCalls()).toBe(0);
    expect(await auditCount()).toBe(0);
  });
});

describe("D. crash windows with fresh object graphs", () => {
  it(
    "G1 to G4 share one real service-issued 30-second expiry: requeue to fence n+1 with the old proof rejected, worker-loss convergence, at most one provider call per job",
    async () => {
      const worker = await machine();
      const jobs = [await seedJob(0), await seedJob(1), await seedJob(0), await seedJob(1)];
      const [g1Job, g2Job, g3Job, g4Job] = jobs as [Job, Job, Job, Job];
      const baseUrl = await controlPlane([worker]);
      const credentials = jobs.map(({ plaintext }) => plaintext);

      // G1 (C0): the lease commits and its response is never usable.
      const g1 = graph(baseUrl, worker, credentials, { freezeAfter: "/lease", frozenTimers: true });
      g1.start();
      await until(g1.isDead);
      // G2 (C2): the grant commits and the graph dies with the response.
      const g2 = graph(baseUrl, worker, credentials, { freezeAfter: "/credential-grant", frozenTimers: true });
      g2.start();
      await until(g2.isDead);
      // G3 (C4): VERIFYING commits and the graph dies with the response.
      const g3 = graph(baseUrl, worker, credentials, { freezeAfter: "/verifying", frozenTimers: true });
      g3.start();
      await until(g3.isDead);
      // G4 (C7): the graph dies during the provider request.
      const g4 = graph(baseUrl, worker, credentials, { providerHangs: true, frozenTimers: true });
      g4.start();
      await until(g4.isDead);

      // Oldest first: each crashed graph leased its own job at fence 1.
      expect([g1, g2, g3, g4].map((each) => leaseOf(each).providerVerificationJobId)).toEqual(jobs.map(({ jobId }) => jobId));
      expect([g1, g2, g3, g4].map((each) => leaseOf(each).fencingCounter)).toEqual([1, 1, 1, 1]);
      expect(await jobState(g1Job.jobId)).toMatchObject({ state: "LEASED", granted: false });
      expect(await jobState(g2Job.jobId)).toMatchObject({ state: "LEASED", granted: true, verifying: false });
      expect(await jobState(g3Job.jobId)).toMatchObject({ state: "VERIFYING" });
      expect(await jobState(g4Job.jobId)).toMatchObject({ state: "VERIFYING" });
      expect([g1, g2, g3, g4].map((each) => each.providerCalls())).toEqual([0, 0, 0, 1]);
      // B: every service-issued lease lasts exactly 30 seconds of database time.
      expect(
        (
          await one<{ thirty: boolean }>(
            "SELECT bool_and(lease_expires_at - leased_at = interval '30 seconds') AS thirty FROM provider_verification_jobs WHERE id = ANY($1::uuid[])",
            [jobs.map(({ jobId }) => jobId)],
          )
        ).thirty,
      ).toBe(true);

      // SAME_LEASE_RESUME_SUPPORTED=NO: a fresh graph cannot resume any crashed lease.
      const fresh = graph(baseUrl, worker, credentials);
      expect(await fresh.start()).toEqual({ status: "NO_WORK" });
      expect(fresh.providerCalls()).toBe(0);

      // The single real wait: the latest service-issued expiry as exact text,
      // then the PostgreSQL clock is polled until it crosses it.
      const latest = (
        await one<{ latest: string }>("SELECT max(lease_expires_at)::text AS latest FROM provider_verification_jobs WHERE id = ANY($1::uuid[])", [
          jobs.map(({ jobId }) => jobId),
        ])
      ).latest;
      expect(await expiryCrossed(latest)).toBe(false);
      await untilExpired(latest, REAL_EXPIRY_MAX_POLLS);

      await expectOnlyTargetsActionable(jobs);
      expect(await reconcile()).toEqual({ cancelledJobs: 0, requeuedJobs: 1, completedJobs: 3 });
      expect(await jobState(g1Job.jobId)).toMatchObject({ state: "QUEUED", fence: 1, granted: false, lease_worker_principal_id: null, live_lease_cleared: true });
      expect(await jobState(g2Job.jobId)).toMatchObject({
        state: "COMPLETED",
        result_outcome: "INCONCLUSIVE",
        terminal_reason_code: "WORKER_LOST_AFTER_CREDENTIAL_GRANT",
        result_worker_principal_id: worker.id,
        result_fencing_counter: 1,
        verifying: false,
      });
      for (const job of [g3Job, g4Job]) {
        expect(await jobState(job.jobId)).toMatchObject({
          state: "COMPLETED",
          result_outcome: "INCONCLUSIVE",
          terminal_reason_code: "WORKER_LOST_DURING_VERIFYING",
          result_worker_principal_id: worker.id,
          result_fencing_counter: 1,
        });
      }
      expect(await auditTypes(g1Job)).toEqual([]);
      for (const job of [g2Job, g3Job, g4Job]) expect(await auditTypes(job)).toEqual(["provider_connection.verification_inconclusive"]);
      // A repeated pass is a no-op with no event.
      expect(await reconcile()).toEqual(ZERO_PASS);
      expect(await auditCount()).toBe(3);

      // Fence n -> requeue -> fence n+1; the old fence-n proof is rejected
      // while the fence-n+1 lease is live, and again after it completes.
      const oldLease = leaseOf(g1);
      const oldProof: LeaseProof = { fencingCounter: oldLease.fencingCounter, leaseToken: oldLease.leaseToken };
      const h = harness(baseUrl, worker);
      // The hook runs inside the graph's control fetchImpl, whose failures the
      // worker client maps to CONTROL_API_UNAVAILABLE. The original settle
      // promise is therefore retained (assigned before any await, so the hook
      // runs once) and awaited in the test body: a K checker failure is owned
      // by this test, never absorbed by the client.
      let oldProofWhileLive: Promise<Settled<unknown>> | undefined;
      let eventWhileLive: WorkerSecurityEvent | undefined;
      const next = graph(baseUrl, worker, credentials, {
        beforeForward: async (url) => {
          if (oldProofWhileLive === undefined && url.endsWith("/credential-grant")) {
            oldProofWhileLive = settle(h.client.requestProviderVerificationCredentialGrant(g1Job.jobId, oldProof));
            await oldProofWhileLive.catch(() => undefined);
            eventWhileLive = events.at(-1);
          }
        },
      });
      const nextResult = await next.start();
      expect(oldProofWhileLive !== undefined).toBe(true);
      const oldProofSettled = await oldProofWhileLive!;
      expect(nextResult).toMatchObject({ status: "REPORTED", providerVerificationJobId: g1Job.jobId, fencingCounter: 2, outcome: "VERIFIED" });
      expect(codeOf(oldProofSettled)).toBe("PROVIDER_VERIFICATION_GRANT_REJECTED");
      expect(eventWhileLive).toMatchObject({ type: "WORKER_PROVIDER_VERIFICATION_GRANT_REJECTED", reason: "FENCING_MISMATCH", providerVerificationJobId: g1Job.jobId });
      await expectRefused(h, () => h.client.reportProviderVerificationResult(g1Job.jobId, oldProof, VERIFIED_REPORT), {
        code: "PROVIDER_VERIFICATION_RESULT_REJECTED",
        type: "WORKER_PROVIDER_VERIFICATION_RESULT_REJECTED",
        reason: "FENCING_MISMATCH",
        job: g1Job,
        worker,
      });
      await expectRefused(h, () => h.client.requestProviderVerificationCredentialGrant(g1Job.jobId, oldProof), {
        code: "PROVIDER_VERIFICATION_GRANT_REJECTED",
        type: "WORKER_PROVIDER_VERIFICATION_GRANT_REJECTED",
        reason: "NOT_LEASED",
        job: g1Job,
        worker,
      });
      expect(await jobState(g1Job.jobId)).toMatchObject({ state: "COMPLETED", fence: 2, result_fencing_counter: 2, result_outcome: "VERIFIED" });
      expect(await auditTypes(g1Job)).toEqual(["provider_connection.verified"]);
      expect(await graph(baseUrl, worker, credentials).start()).toEqual({ status: "NO_WORK" });

      // J: at most one provider call per job across every graph; the crashed
      // graphs never reach the router again and their runs never settle.
      expect([g1, g2, g3, g4, next].map((each) => each.providerCalls())).toEqual([0, 0, 0, 1, 1]);
      for (const crashed of [g1, g2, g3, g4]) {
        expect(crashed.exchanges).toHaveLength(crashed.exchangesAtDeath());
        expect(crashed.attemptsAfterDeath()).toBe(0);
        expect(crashed.settled()).toBeUndefined();
      }
      expect(await auditCount()).toBe(4);
      expect(serverFailures).toEqual([]);
      await expectSecretFree(credentials, [JSON.stringify(nextResult), JSON.stringify(events), ...[g1, g2, g3, g4, next].flatMap((each) => each.exchanges.map(({ body }) => body))]);
    },
    REAL_WAIT_TEST_TIMEOUT_MS,
  );

  it("G5: a committed result whose response dies with the graph stays terminal; a fresh graph finds no work", async () => {
    const worker = await machine();
    const job = await seedJob(1);
    const baseUrl = await controlPlane([worker]);
    const crashed = graph(baseUrl, worker, [job.plaintext], { freezeAfter: "/result", frozenTimers: true });
    crashed.start();
    await until(crashed.isDead);
    expect(await jobState(job.jobId)).toMatchObject({ state: "COMPLETED", result_outcome: "VERIFIED", live_lease_cleared: true });
    const terminal = await jobSnapshot(job.jobId);

    const fresh = graph(baseUrl, worker, [job.plaintext]);
    expect(await fresh.start()).toEqual({ status: "NO_WORK" });
    expect(await jobSnapshot(job.jobId)).toBe(terminal);
    expect(await auditTypes(job)).toEqual(["provider_connection.verified"]);
    expect(crashed.providerCalls() + fresh.providerCalls()).toBe(1);
    expect(crashed.exchanges).toHaveLength(crashed.exchangesAtDeath());
    expect(crashed.settled()).toBeUndefined();
  });
});

type RaceKind = "GRANT" | "VERIFYING" | "RESULT";

const ROUTE_REJECTION = {
  GRANT: { code: "PROVIDER_VERIFICATION_GRANT_REJECTED", type: "WORKER_PROVIDER_VERIFICATION_GRANT_REJECTED" },
  VERIFYING: { code: "PROVIDER_VERIFICATION_VERIFYING_REJECTED", type: "WORKER_PROVIDER_VERIFICATION_VERIFYING_REJECTED" },
  RESULT: { code: "PROVIDER_VERIFICATION_RESULT_REJECTED", type: "WORKER_PROVIDER_VERIFICATION_RESULT_REJECTED" },
} as const;

// Technique B in the state under test: LEASED, LEASED with a grant, or VERIFYING.
async function prepareRace(kind: RaceKind, h: Harness, worker: Machine) {
  const job = await seedJob(0);
  const { proof, expiresText } = await shortLease(job, worker);
  if (kind !== "GRANT") await h.client.requestProviderVerificationCredentialGrant(job.jobId, proof);
  if (kind === "RESULT") await h.client.acknowledgeProviderVerificationVerifying(job.jobId, proof);
  return { job, proof, expiresText };
}

const sendRace = (kind: RaceKind, h: Harness, job: Job, proof: LeaseProof): Promise<unknown> =>
  kind === "GRANT"
    ? h.client.requestProviderVerificationCredentialGrant(job.jobId, proof)
    : kind === "VERIFYING"
      ? h.client.acknowledgeProviderVerificationVerifying(job.jobId, proof)
      : h.client.reportProviderVerificationResult(job.jobId, proof, VERIFIED_REPORT);

// The stamp written by the worker transaction equals its captured xact_start
// and is earlier than the captured expiry, compared inside PostgreSQL.
function stampProof(kind: RaceKind, job: Job, xactStartText: string, expiresText: string, shift = "0 microseconds") {
  const sql =
    kind === "GRANT"
      ? `SELECT j.credential_granted_at = ($1::timestamptz + $4::interval) AND j.credential_granted_at < $2::timestamptz AS valid
           FROM provider_verification_jobs j WHERE j.id = $3`
      : kind === "VERIFYING"
        ? `SELECT j.verifying_at = ($1::timestamptz + $4::interval) AND j.verifying_at < $2::timestamptz
                  AND c.last_verification_attempt_at = ($1::timestamptz + $4::interval) AND c.last_verification_attempt_at < $2::timestamptz AS valid
             FROM provider_verification_jobs j JOIN provider_connections c ON c.account_id = j.account_id AND c.id = j.provider_connection_id
            WHERE j.id = $3`
        : `SELECT j.completed_at = ($1::timestamptz + $4::interval) AND j.completed_at < $2::timestamptz AS valid
             FROM provider_verification_jobs j WHERE j.id = $3`;
  return one<{ valid: boolean }>(sql, [xactStartText, expiresText, job.jobId, shift]).then((row) => row.valid);
}

describe("F. races under technique B and C (worker transaction first)", () => {
  it.each(["GRANT", "VERIFYING", "RESULT"] as const)(
    "%s: a worker transaction started before the database expiry commits after it; the concurrent pass skips; the stamp is its xact_start",
    async (kind) => {
      const worker = await machine();
      const h = harness(await controlPlane([worker]), worker);
      const { job, proof, expiresText } = await prepareRace(kind, h, worker);
      await expectOnlyTargetsActionable([job]);
      const connectionBefore = await connectionSnapshot(job.connectionId);

      const side = await sidecar(job.accountId);
      const request = settle(sendRace(kind, h, job, proof));
      const workerPid = await blockedBy(side.pid, side.check);
      await expectJobRowHeld(job.jobId);
      const xactStart = await xactStartWhileBlocked(workerPid, side.pid);
      expect(await startedBeforeExpiry(xactStart, expiresText)).toBe(true);

      await untilExpired(expiresText, SHORT_EXPIRY_MAX_POLLS, side.check);
      const held = await jobSnapshot(job.jobId);
      expect(await reconcile()).toEqual(ZERO_PASS);
      expect(await jobSnapshot(job.jobId)).toBe(held);
      // The sidecar held the Account continuously and the worker is still
      // blocked by it after the expiry: its commit can only follow the boundary.
      expect(await stillBlockedBy(workerPid, side.pid)).toBe(true);
      await side.release();

      const settled = await request;
      expect(codeOf(settled)).toBe("OK");
      expect(await stampProof(kind, job, xactStart, expiresText)).toBe(true);
      // Guard the oracle: one microsecond away is not the stamp.
      expect(await stampProof(kind, job, xactStart, expiresText, "1 microsecond")).toBe(false);
      expect(await stillBlockedBy(workerPid, side.pid)).toBe(false);

      if (kind === "RESULT") {
        expect(await jobState(job.jobId)).toMatchObject({ state: "COMPLETED", result_outcome: "VERIFIED", result_worker_principal_id: worker.id });
        expect(
          await one(
            `SELECT c.verified_at IS NOT NULL AND c.verified_at = date_trunc('milliseconds', j.completed_at) AS verified_at_copy, c.verification_status
               FROM provider_connections c JOIN provider_verification_jobs j ON j.account_id = c.account_id AND j.provider_connection_id = c.id
              WHERE j.id = $1`,
            [job.jobId],
          ),
        ).toEqual({ verified_at_copy: true, verification_status: "VERIFIED" });
        // The later pass finds nothing to do.
        expect(await reconcile()).toEqual(ZERO_PASS);
        expect(await auditTypes(job)).toEqual(["provider_connection.verified"]);
      } else {
        // The later pass converges the expired granted or VERIFYING job; it never requeues.
        expect(await reconcile()).toEqual({ cancelledJobs: 0, requeuedJobs: 0, completedJobs: 1 });
        expect(await jobState(job.jobId)).toMatchObject({
          state: "COMPLETED",
          fence: 1,
          result_outcome: "INCONCLUSIVE",
          terminal_reason_code: kind === "GRANT" ? "WORKER_LOST_AFTER_CREDENTIAL_GRANT" : "WORKER_LOST_DURING_VERIFYING",
          result_worker_principal_id: worker.id,
          result_fencing_counter: 1,
        });
        expect(await auditTypes(job)).toEqual(["provider_connection.verification_inconclusive"]);
        if (kind === "GRANT") expect(await connectionSnapshot(job.connectionId)).toBe(connectionBefore);
      }
      expect(await reconcile()).toEqual(ZERO_PASS);
      expect(events).toEqual([]);
      expect(serverFailures).toEqual([]);
    },
  );
});

describe("F. races under technique B and C (expiry and reconciliation first)", () => {
  it.each(["GRANT", "VERIFYING", "RESULT"] as const)(
    "%s: reconciliation wins the job row; the waiting worker request re-reads the committed state and is rejected with no further change",
    async (kind) => {
      const worker = await machine();
      const h = harness(await controlPlane([worker]), worker);
      const { job, proof, expiresText } = await prepareRace(kind, h, worker);
      await expectOnlyTargetsActionable([job]);
      const connectionBefore = await connectionSnapshot(job.connectionId);
      await untilExpired(expiresText, SHORT_EXPIRY_MAX_POLLS);

      const side = await sidecar(job.accountId);
      const pass = settle(reconcile());
      const reconcilerPid = await blockedBy(side.pid, side.check);
      await expectJobRowHeld(job.jobId);
      const request = settle(sendRace(kind, h, job, proof));
      const workerPid = await blockedBy(reconcilerPid, side.check);
      expect(workerPid).not.toBe(reconcilerPid);
      await side.release();

      const passed = await pass;
      expect(passed).toEqual({
        ok: true,
        value: kind === "GRANT" ? { cancelledJobs: 0, requeuedJobs: 1, completedJobs: 0 } : { cancelledJobs: 0, requeuedJobs: 0, completedJobs: 1 },
      });
      const settled = await request;
      expect(codeOf(settled)).toBe(ROUTE_REJECTION[kind].code);
      expect(h.exchanges.at(-1)).toMatchObject({ status: 409, body: REJECTED_BODY });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: ROUTE_REJECTION[kind].type,
        reason: kind === "RESULT" ? "VERIFICATION_RESULT_CONFLICT" : "NOT_LEASED",
        providerVerificationJobId: job.jobId,
        workerPrincipalId: worker.id,
      });

      if (kind === "GRANT") {
        // Requeued: live lease cleared, fence kept, no grant stamp, no audit.
        expect(await jobState(job.jobId)).toMatchObject({ state: "QUEUED", fence: 1, granted: false, live_lease_cleared: true, lease_worker_principal_id: null });
        expect(await auditTypes(job)).toEqual([]);
      } else if (kind === "VERIFYING") {
        // No verifying provenance and no attempt timestamp were written.
        expect(await jobState(job.jobId)).toMatchObject({
          state: "COMPLETED",
          verifying: false,
          verifying_worker_principal_id: null,
          result_outcome: "INCONCLUSIVE",
          terminal_reason_code: "WORKER_LOST_AFTER_CREDENTIAL_GRANT",
        });
        expect(await one("SELECT last_verification_attempt_at IS NULL AS no_attempt FROM provider_connections WHERE id = $1", [job.connectionId])).toEqual({ no_attempt: true });
        expect(await auditTypes(job)).toEqual(["provider_connection.verification_inconclusive"]);
      } else {
        expect(await jobState(job.jobId)).toMatchObject({ state: "COMPLETED", result_outcome: "INCONCLUSIVE", terminal_reason_code: "WORKER_LOST_DURING_VERIFYING" });
        expect(await auditTypes(job)).toEqual(["provider_connection.verification_inconclusive"]);
      }
      if (kind !== "VERIFYING") expect(await connectionSnapshot(job.connectionId)).toBe(connectionBefore);
      // No double terminal: a further pass and a repeated request change nothing.
      const after = await jobSnapshot(job.jobId);
      expect(await reconcile()).toEqual(ZERO_PASS);
      expect(codeOf(await settle(sendRace(kind, h, job, proof)))).toBe(ROUTE_REJECTION[kind].code);
      expect(await jobSnapshot(job.jobId)).toBe(after);
      expect(await auditCount()).toBe(kind === "GRANT" ? 0 : 1);
      expect(serverFailures).toEqual([]);
    },
  );
});

describe("G. concurrent duplicates through the real router", () => {
  // Both requests are proven in flight together: the first holds the job row
  // and waits on the sidecar, the second waits on the first.
  async function together<T>(job: Job, first: () => Promise<T>, second: () => Promise<T>): Promise<readonly [Settled<T>, Settled<T>]> {
    const side = await sidecar(job.accountId);
    const a = settle(first());
    const b = settle(second());
    const leader = await blockedBy(side.pid, side.check);
    await expectJobRowHeld(job.jobId);
    const follower = await blockedBy(leader, side.check);
    expect(follower).not.toBe(leader);
    await side.release();
    return [await a, await b] as const;
  }

  async function leased(h: Harness, job: Job) {
    const lease = (await h.client.leaseProviderVerification())!;
    expect(lease.providerVerificationJobId).toBe(job.jobId);
    return Object.freeze({ fencingCounter: lease.fencingCounter, leaseToken: lease.leaseToken });
  }

  it("concurrent identical grants: one stamp, both 200 with the same credentialGrantedAt", async () => {
    const worker = await machine();
    const job = await seedJob(0);
    const h = harness(await controlPlane([worker]), worker);
    const proof = await leased(h, job);

    const [a, b] = await together(
      job,
      () => h.client.requestProviderVerificationCredentialGrant(job.jobId, proof),
      () => h.client.requestProviderVerificationCredentialGrant(job.jobId, proof),
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value).not.toBe(b.value);
    expect(a.value.credentialGrantedAt.getTime()).toBe(b.value.credentialGrantedAt.getTime());
    const bodies = h.exchanges.filter(({ url }) => url.endsWith("/credential-grant")).map(({ body }) => body);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(await jobState(job.jobId)).toMatchObject({ state: "LEASED", granted: true });
    expect(await auditCount()).toBe(0);
  });

  it("concurrent identical VERIFYING: one transition, both 200 with the same verifyingAt", async () => {
    const worker = await machine();
    const job = await seedJob(1);
    const h = harness(await controlPlane([worker]), worker);
    const proof = await leased(h, job);
    await h.client.requestProviderVerificationCredentialGrant(job.jobId, proof);

    const [a, b] = await together(
      job,
      () => h.client.acknowledgeProviderVerificationVerifying(job.jobId, proof),
      () => h.client.acknowledgeProviderVerificationVerifying(job.jobId, proof),
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.verifyingAt.getTime()).toBe(b.value.verifyingAt.getTime());
    expect(await jobState(job.jobId)).toMatchObject({ state: "VERIFYING", verifying_worker_principal_id: worker.id, verifying_fencing_counter: 1 });
    expect(await auditCount()).toBe(0);
  });

  it("concurrent identical results: one terminal transition plus one exact replay, one audit event", async () => {
    const worker = await machine();
    const job = await seedJob(0);
    const h = harness(await controlPlane([worker]), worker);
    const proof = await leased(h, job);
    await h.client.requestProviderVerificationCredentialGrant(job.jobId, proof);
    await h.client.acknowledgeProviderVerificationVerifying(job.jobId, proof);

    const [a, b] = await together(
      job,
      () => h.client.reportProviderVerificationResult(job.jobId, proof, VERIFIED_REPORT),
      () => h.client.reportProviderVerificationResult(job.jobId, proof, VERIFIED_REPORT),
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.completedAt.getTime()).toBe(b.value.completedAt.getTime());
    expect(await jobState(job.jobId)).toMatchObject({ state: "COMPLETED", result_outcome: "VERIFIED" });
    expect(await auditTypes(job)).toEqual(["provider_connection.verified"]);
  });

  it("concurrent conflicting results: the first committed tuple wins, the other fails VERIFICATION_RESULT_CONFLICT, one audit event", async () => {
    const worker = await machine();
    const job = await seedJob(1);
    const h = harness(await controlPlane([worker]), worker);
    const proof = await leased(h, job);
    await h.client.requestProviderVerificationCredentialGrant(job.jobId, proof);
    await h.client.acknowledgeProviderVerificationVerifying(job.jobId, proof);

    const [verified, inconclusive] = await together(
      job,
      () => h.client.reportProviderVerificationResult(job.jobId, proof, VERIFIED_REPORT),
      () => h.client.reportProviderVerificationResult(job.jobId, proof, TIMEOUT_REPORT),
    );
    expect([codeOf(verified), codeOf(inconclusive)].sort()).toEqual(["OK", "PROVIDER_VERIFICATION_RESULT_REJECTED"]);
    const winner = verified.ok ? VERIFIED_REPORT : TIMEOUT_REPORT;
    expect(await jobState(job.jobId)).toMatchObject({ state: "COMPLETED", result_outcome: winner.outcome, terminal_reason_code: winner.reasonCode });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "WORKER_PROVIDER_VERIFICATION_RESULT_REJECTED", reason: "VERIFICATION_RESULT_CONFLICT", providerVerificationJobId: job.jobId });
    expect(await auditTypes(job)).toEqual([winner.outcome === "VERIFIED" ? "provider_connection.verified" : "provider_connection.verification_inconclusive"]);
  });
});

describe("Exact replay of grant, VERIFYING and result", () => {
  it("grant replay under the same live lease returns the same payload with no write and re-checks eligibility", async () => {
    const worker = await machine();
    const job = await seedJob(0);
    const h = harness(await controlPlane([worker]), worker);
    const lease = (await h.client.leaseProviderVerification())!;
    const proof: LeaseProof = { fencingCounter: lease.fencingCounter, leaseToken: lease.leaseToken };
    await expectRefused(h, () => h.client.acknowledgeProviderVerificationVerifying(job.jobId, proof), {
      code: "PROVIDER_VERIFICATION_VERIFYING_REJECTED",
      type: "WORKER_PROVIDER_VERIFICATION_VERIFYING_REJECTED",
      reason: "CREDENTIAL_NOT_GRANTED",
      job,
      worker,
    });

    const first = await h.client.requestProviderVerificationCredentialGrant(job.jobId, proof);
    const granted = await jobSnapshot(job.jobId);
    const replay = await h.client.requestProviderVerificationCredentialGrant(job.jobId, proof);
    // A new local grant object for each response; identical payload and stamp.
    expect(replay).not.toBe(first);
    expect(replay).toEqual(first);
    const bodies = h.exchanges.filter(({ url }) => url.endsWith("/credential-grant")).map(({ body }) => body);
    expect(bodies[1]).toBe(bodies[0]);
    expect(await jobSnapshot(job.jobId)).toBe(granted);

    // A rotation committed in between makes the replay fail closed.
    await rotate(job);
    await expectRefused(h, () => h.client.requestProviderVerificationCredentialGrant(job.jobId, proof), {
      code: "PROVIDER_VERIFICATION_GRANT_REJECTED",
      type: "WORKER_PROVIDER_VERIFICATION_GRANT_REJECTED",
      reason: "CREDENTIAL_VERSION_INELIGIBLE",
      job,
      worker,
    });
    expect(await jobSnapshot(job.jobId)).toBe(granted);
    expect(await auditCount()).toBe(0);
  });

  it("VERIFYING replay returns the original verifyingAt with no write, no eligibility re-run, and fails only for a DESTROYED version", async () => {
    const worker = await machine();
    const job = await seedJob(1);
    const h = harness(await controlPlane([worker]), worker);
    const lease = (await h.client.leaseProviderVerification())!;
    const proof: LeaseProof = { fencingCounter: lease.fencingCounter, leaseToken: lease.leaseToken };
    await h.client.requestProviderVerificationCredentialGrant(job.jobId, proof);
    const first = await h.client.acknowledgeProviderVerificationVerifying(job.jobId, proof);
    const barrier = await jobSnapshot(job.jobId);
    const attempt = await connectionSnapshot(job.connectionId);

    const replay = await h.client.acknowledgeProviderVerificationVerifying(job.jobId, proof);
    expect(replay.verifyingAt.getTime()).toBe(first.verifyingAt.getTime());
    expect(await jobSnapshot(job.jobId)).toBe(barrier);
    expect(await connectionSnapshot(job.connectionId)).toBe(attempt);

    await rotate(job);
    expect((await h.client.acknowledgeProviderVerificationVerifying(job.jobId, proof)).verifyingAt.getTime()).toBe(first.verifyingAt.getTime());
    await destroyBoundVersion(job);
    await expectRefused(h, () => h.client.acknowledgeProviderVerificationVerifying(job.jobId, proof), {
      code: "PROVIDER_VERIFICATION_VERIFYING_REJECTED",
      type: "WORKER_PROVIDER_VERIFICATION_VERIFYING_REJECTED",
      reason: "VERIFYING_VERSION_DESTROYED",
      job,
      worker,
    });
    expect(await jobSnapshot(job.jobId)).toBe(barrier);
    expect(await auditCount()).toBe(0);
  });
});

describe("H. stale authority (one representative per route and column)", () => {
  async function setup() {
    const worker = await machine();
    const other = await machine();
    const baseUrl = await controlPlane([worker, other]);
    return { worker, other, h: harness(baseUrl, worker), otherHarness: harness(baseUrl, other) };
  }
  const wrongToken = () => randomBytes(32).toString("base64url");

  it.each([
    ["grant", "LEASED", "GRANT"],
    ["VERIFYING", "LEASED with a grant", "VERIFYING"],
    ["result", "VERIFYING", "RESULT"],
  ] as const)("%s on a %s job: stale fence, wrong token and wrong worker are refused with no row change and no audit", async (_route, _state, kind) => {
    const { worker, other, h, otherHarness } = await setup();
    const job = await seedJob(0);
    const lease = (await h.client.leaseProviderVerification())!;
    const proof: LeaseProof = { fencingCounter: lease.fencingCounter, leaseToken: lease.leaseToken };
    if (kind !== "GRANT") await h.client.requestProviderVerificationCredentialGrant(job.jobId, proof);
    if (kind === "RESULT") await h.client.acknowledgeProviderVerificationVerifying(job.jobId, proof);
    const before = await jobSnapshot(job.jobId);
    const connectionBefore = await connectionSnapshot(job.connectionId);
    const rejection = ROUTE_REJECTION[kind];

    for (const [caller, callerHarness, presented, reason] of [
      [worker, h, { fencingCounter: proof.fencingCounter + 1, leaseToken: proof.leaseToken }, "FENCING_MISMATCH"],
      [worker, h, { fencingCounter: proof.fencingCounter, leaseToken: wrongToken() }, "TOKEN_MISMATCH"],
      [other, otherHarness, proof, "OTHER_WORKER"],
    ] as const) {
      await expectRefused(callerHarness, () => sendRace(kind, callerHarness, job, presented), { code: rejection.code, type: rejection.type, reason, job, worker: caller });
      expect(await jobSnapshot(job.jobId)).toBe(before);
      expect(await connectionSnapshot(job.connectionId)).toBe(connectionBefore);
      expect(await auditCount()).toBe(0);
    }
    expect(serverFailures).toEqual([]);
    expect([lease.leaseToken, worker.credential, other.credential, job.plaintext].some((secret) => JSON.stringify(events).includes(secret))).toBe(false);
  });

  it("result on a COMPLETED job: stale fence and wrong worker are refused; the token is not authority for an exact terminal replay", async () => {
    const { worker, other, h, otherHarness } = await setup();
    const job = await seedJob(1);
    const lease = (await h.client.leaseProviderVerification())!;
    const proof: LeaseProof = { fencingCounter: lease.fencingCounter, leaseToken: lease.leaseToken };
    await h.client.requestProviderVerificationCredentialGrant(job.jobId, proof);
    await h.client.acknowledgeProviderVerificationVerifying(job.jobId, proof);
    const first = await h.client.reportProviderVerificationResult(job.jobId, proof, VERIFIED_REPORT);
    const terminal = await jobSnapshot(job.jobId);
    const aggregate = await connectionSnapshot(job.connectionId);

    await expectRefused(h, () => h.client.reportProviderVerificationResult(job.jobId, { fencingCounter: proof.fencingCounter + 1, leaseToken: proof.leaseToken }, VERIFIED_REPORT), {
      code: "PROVIDER_VERIFICATION_RESULT_REJECTED",
      type: "WORKER_PROVIDER_VERIFICATION_RESULT_REJECTED",
      reason: "FENCING_MISMATCH",
      job,
      worker,
    });
    await expectRefused(otherHarness, () => otherHarness.client.reportProviderVerificationResult(job.jobId, proof, VERIFIED_REPORT), {
      code: "PROVIDER_VERIFICATION_RESULT_REJECTED",
      type: "WORKER_PROVIDER_VERIFICATION_RESULT_REJECTED",
      reason: "VERIFYING_PRINCIPAL_MISMATCH",
      job,
      worker: other,
    });
    // An exact tuple with a different well-formed token replays the stored result.
    const replay = await h.client.reportProviderVerificationResult(job.jobId, { fencingCounter: proof.fencingCounter, leaseToken: wrongToken() }, VERIFIED_REPORT);
    expect(replay).toEqual(first);
    // A different outcome conflicts.
    await expectRefused(h, () => h.client.reportProviderVerificationResult(job.jobId, proof, TIMEOUT_REPORT), {
      code: "PROVIDER_VERIFICATION_RESULT_REJECTED",
      type: "WORKER_PROVIDER_VERIFICATION_RESULT_REJECTED",
      reason: "VERIFICATION_RESULT_CONFLICT",
      job,
      worker,
    });
    expect(await jobSnapshot(job.jobId)).toBe(terminal);
    expect(await connectionSnapshot(job.connectionId)).toBe(aggregate);
    expect(await auditTypes(job)).toEqual(["provider_connection.verified"]);
    expect(serverFailures).toEqual([]);
  });
});

describe("E and I. expiry without reconciliation, convergence and audit uniqueness", () => {
  it("expired leases refuse grant, VERIFYING and first result; one pass requeues or terminalizes each once; repeated passes, replays and requeues write no audit", async () => {
    const worker = await machine();
    const h = harness(await controlPlane([worker]), worker);
    const done = await seedJob(0);
    const granted = await seedJob(1);
    const ungranted = await seedJob(0);
    const verifying = await seedJob(1);
    const leases = {
      done: await shortLease(done, worker),
      granted: await shortLease(granted, worker),
      ungranted: await shortLease(ungranted, worker),
      verifying: await shortLease(verifying, worker),
    };
    await h.client.requestProviderVerificationCredentialGrant(done.jobId, leases.done.proof);
    await h.client.acknowledgeProviderVerificationVerifying(done.jobId, leases.done.proof);
    const first = await h.client.reportProviderVerificationResult(done.jobId, leases.done.proof, VERIFIED_REPORT);
    await h.client.requestProviderVerificationCredentialGrant(granted.jobId, leases.granted.proof);
    await h.client.requestProviderVerificationCredentialGrant(verifying.jobId, leases.verifying.proof);
    await h.client.acknowledgeProviderVerificationVerifying(verifying.jobId, leases.verifying.proof);
    // Grant, VERIFYING and the first result write no audit event.
    expect(await auditCount()).toBe(1);

    for (const each of Object.values(leases)) await untilExpired(each.expiresText, SHORT_EXPIRY_MAX_POLLS);

    // Expired but not yet reconciled: LEASE_EXPIRED for grant, VERIFYING and first result.
    await expectRefused(h, () => h.client.requestProviderVerificationCredentialGrant(ungranted.jobId, leases.ungranted.proof), {
      code: "PROVIDER_VERIFICATION_GRANT_REJECTED",
      type: "WORKER_PROVIDER_VERIFICATION_GRANT_REJECTED",
      reason: "LEASE_EXPIRED",
      job: ungranted,
      worker,
    });
    await expectRefused(h, () => h.client.acknowledgeProviderVerificationVerifying(granted.jobId, leases.granted.proof), {
      code: "PROVIDER_VERIFICATION_VERIFYING_REJECTED",
      type: "WORKER_PROVIDER_VERIFICATION_VERIFYING_REJECTED",
      reason: "LEASE_EXPIRED",
      job: granted,
      worker,
    });
    await expectRefused(h, () => h.client.reportProviderVerificationResult(verifying.jobId, leases.verifying.proof, VERIFIED_REPORT), {
      code: "PROVIDER_VERIFICATION_RESULT_REJECTED",
      type: "WORKER_PROVIDER_VERIFICATION_RESULT_REJECTED",
      reason: "LEASE_EXPIRED",
      job: verifying,
      worker,
    });
    // The committed result replays after expiry, token-free, with no write.
    const doneRow = await jobSnapshot(done.jobId);
    expect(await h.client.reportProviderVerificationResult(done.jobId, leases.done.proof, VERIFIED_REPORT)).toEqual(first);
    expect(await jobSnapshot(done.jobId)).toBe(doneRow);

    await expectOnlyTargetsActionable([done, granted, ungranted, verifying]);
    expect(await reconcile()).toEqual({ cancelledJobs: 0, requeuedJobs: 1, completedJobs: 2 });
    expect(await jobState(ungranted.jobId)).toMatchObject({ state: "QUEUED", fence: 1, granted: false, live_lease_cleared: true });
    expect(await jobState(granted.jobId)).toMatchObject({ state: "COMPLETED", terminal_reason_code: "WORKER_LOST_AFTER_CREDENTIAL_GRANT" });
    expect(await jobState(verifying.jobId)).toMatchObject({ state: "COMPLETED", terminal_reason_code: "WORKER_LOST_DURING_VERIFYING" });
    const audited = await auditCount();
    expect(audited).toBe(3);
    for (let repeat = 0; repeat < 2; repeat += 1) expect(await reconcile()).toEqual(ZERO_PASS);
    expect(await auditCount()).toBe(audited);

    // After a pre-grant requeue VERIFYING fails NOT_LEASED; a reconciler-written
    // terminal result never replays as a worker result.
    await expectRefused(h, () => h.client.acknowledgeProviderVerificationVerifying(ungranted.jobId, leases.ungranted.proof), {
      code: "PROVIDER_VERIFICATION_VERIFYING_REJECTED",
      type: "WORKER_PROVIDER_VERIFICATION_VERIFYING_REJECTED",
      reason: "NOT_LEASED",
      job: ungranted,
      worker,
    });
    await expectRefused(h, () => h.client.reportProviderVerificationResult(verifying.jobId, leases.verifying.proof, TIMEOUT_REPORT), {
      code: "PROVIDER_VERIFICATION_RESULT_REJECTED",
      type: "WORKER_PROVIDER_VERIFICATION_RESULT_REJECTED",
      reason: "VERIFICATION_RESULT_CONFLICT",
      job: verifying,
      worker,
    });

    // Exactly one terminal audit event per terminal job; none for the requeue.
    expect(await auditTypes(done)).toEqual(["provider_connection.verified"]);
    expect(await auditTypes(granted)).toEqual(["provider_connection.verification_inconclusive"]);
    expect(await auditTypes(ungranted)).toEqual([]);
    expect(await auditTypes(verifying)).toEqual(["provider_connection.verification_inconclusive"]);
    expect(await auditCount()).toBe(3);
    expect(serverFailures).toEqual([]);
  });
});
