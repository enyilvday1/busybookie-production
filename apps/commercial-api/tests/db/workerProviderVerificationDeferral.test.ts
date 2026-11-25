import { createHash, randomBytes, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PROVIDER_CREDENTIAL_PURPOSE } from "commercial-worker-protocol";
import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type RuntimeClient, type TransactionalPool } from "../../src/database/runtimePool.js";
import { reconcileProviderVerificationJobs } from "../../src/providerConnections/providerVerificationReconciliationService.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../src/startCommercialApiServer.js";
import { createWorkerControlApplication } from "../../src/workerControl/workerControlApplication.js";
import {
  deferUnsupportedProviderVerification,
  unsupportedDeferralSeconds,
  type ProviderVerificationRefusal,
} from "../../src/workerControl/workerProviderVerificationDeferralService.js";
import { acquireProviderVerificationLease } from "../../src/workerControl/workerProviderVerificationLeaseService.js";
import type { WorkerSecurityEvent } from "../../src/workerControl/workerSecurityEvents.js";
import { send, type TestResponse } from "../httpClient.js";
import { createTestCredentialFingerprinter, createTestCredentialSealer, generateTestKey } from "../support/testCredentialCrypto.js";
import { createTestWorkerAuthenticationAdapter } from "../support/testWorkerAuthentication.js";
import { createRecordingWorkerSecurityEventSink } from "../support/testWorkerSecurityEvents.js";
import { connectAs, insertAccountWithFreeGrant, openGuardedClients, prepareSchemaV1, type GuardedClients } from "./support/testDatabase.js";
import { APPROVED_RUNTIME_ROLE } from "./support/testDatabaseGuard.js";

// R44B11G unsupported-lease bounded deferral against PostgreSQL 16
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md, R44B11G section
// 11: N, F, H and C). The HTTP deferral always uses the production d(n); the
// service's test-only schedule seam shortens deferrals so repeated refusals do
// not wait minutes, and migration 0011 still bounds every write. No provider is
// called anywhere; credentials are generated fixture strings sealed by the test
// sealer, and secret assertions are booleans.

let clients: GuardedClients;
let pool: TransactionalPool;
let server: RunningCommercialApiServer | undefined;
let port: number;
let recording: ReturnType<typeof createRecordingWorkerSecurityEventSink>;

const encryptionKey = generateTestKey("deferral-test-encryption/v1");
const sealer = createTestCredentialSealer(encryptionKey);
const fingerprinter = createTestCredentialFingerprinter(generateTestKey("deferral-test-fingerprint/v1"), encryptionKey);

const PROVIDER = "EXAMPLE_PROVIDER";
const POLICY = "EXAMPLE_METADATA_V1";
const BASE = "/worker-control/v1/provider-verifications";
const LEASE_PATH = `${BASE}/lease`;
const REJECTED = '{"status":"error","code":"LEASE_REJECTED"}\n';
const DEFERRAL_REJECTED = "WORKER_PROVIDER_VERIFICATION_DEFERRAL_REJECTED";
// The seam's short deferral for repeated refusals (well under every d(n)).
const SHORT_SECONDS = 0.05;

beforeAll(async () => {
  clients = await openGuardedClients();
  const config = loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl, COMMERCIAL_API_DATABASE_POOL_MAX: "12" }, "development");
  pool = await createRuntimePool(config!, () => {});
});
beforeEach(async () => {
  await prepareSchemaV1(clients);
});
afterEach(async () => {
  await server?.close();
  server = undefined;
});
afterAll(async () => {
  await pool.end();
  await prepareSchemaV1(clients);
  await clients.close();
});

// ---------------------------------------------------------------------------
// Fixtures

type Worker = Readonly<{ id: string; token: string }>;

async function workers(count: number): Promise<Worker[]> {
  const list: Worker[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = (await clients.migrator.query<{ id: string }>("INSERT INTO worker_principals (label) VALUES ($1) RETURNING id", [`deferral-worker-${index}`])).rows[0]!.id;
    list.push({ id, token: `fixture-worker-${randomBytes(16).toString("hex")}` });
  }
  return list;
}

async function start(list: readonly Worker[], routerPool: TransactionalPool = pool): Promise<void> {
  recording = createRecordingWorkerSecurityEventSink();
  const application = createWorkerControlApplication({
    authentication: createTestWorkerAuthenticationAdapter(list.map((worker) => ({ token: worker.token, workerPrincipalId: worker.id }))),
    securityEvents: recording.sink,
    pool: routerPool,
    reportFailure: () => {},
  });
  server = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { application, checkReadiness: async () => true } });
  port = server.port;
}

async function begin(count = 2): Promise<Worker[]> {
  const list = await workers(count);
  await start(list);
  return list;
}

const one = <T extends object>(sql: string, params: unknown[] = []) => clients.migrator.query<T>(sql, params).then((result) => result.rows[0]!);

type Fixture = Readonly<{ userId: string; accountId: string; connectionId: string; versionId: string; jobId: string }>;

// One account, one PENDING_VERIFICATION connection with an ACTIVE sealed v1 and
// one QUEUED verification job bound to it (the existing fixture shape).
async function fixture(): Promise<Fixture> {
  const owner = await insertAccountWithFreeGrant(clients.migrator, `deferral-${randomUUID()}`);
  const connection = await one<{ id: string }>(
    "INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id) VALUES ($1, $2, 'API_KEY', $3) RETURNING id",
    [owner.accountId, PROVIDER, owner.userId],
  );
  const plaintext = `fixture-credential-${randomBytes(18).toString("hex")}`;
  const envelope = await sealer.seal(plaintext, { accountId: owner.accountId, providerConnectionId: connection.id, provider: PROVIDER, credentialVersion: 1, purpose: PROVIDER_CREDENTIAL_PURPOSE });
  const fingerprint = await fingerprinter.fingerprint(plaintext);
  const version = await one<{ id: string }>(
    `INSERT INTO provider_credential_versions (account_id, provider_connection_id, credential_version, sealed_credential, fingerprint_algorithm,
                                               fingerprint_key_ref, fingerprint_value, created_by_user_id)
     VALUES ($1, $2, 1, $3::jsonb, $4, $5, $6, $7) RETURNING id`,
    [owner.accountId, connection.id, JSON.stringify(envelope), fingerprint.algorithm, fingerprint.keyRef, fingerprint.value, owner.userId],
  );
  const job = await one<{ id: string }>(
    `INSERT INTO provider_verification_jobs (account_id, provider_connection_id, provider_credential_version_id, verification_policy_id, requested_by_user_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [owner.accountId, connection.id, version.id, POLICY, owner.userId],
  );
  return Object.freeze({ userId: owner.userId, accountId: owner.accountId, connectionId: connection.id, versionId: version.id, jobId: job.id });
}

const disconnect = (f: Fixture) => clients.migrator.query("UPDATE provider_connections SET status = 'DISCONNECTED', disconnected_at = now() WHERE id = $1", [f.connectionId]);

// An owner-applied lease with a known token and a short database-time expiry,
// through the 0010 guard's legal QUEUED -> LEASED transition.
async function ownerLease(jobId: string, worker: Worker, token: string, milliseconds: number): Promise<number> {
  const row = await one<{ fence: string }>(
    `UPDATE provider_verification_jobs
        SET state = 'LEASED', lease_worker_principal_id = $2, lease_token_sha256 = $3, lease_fencing_counter = lease_fencing_counter + 1,
            leased_at = clock_timestamp(), lease_expires_at = clock_timestamp() + make_interval(secs => $4::float8 / 1000), updated_at = clock_timestamp()
      WHERE id = $1 AND state = 'QUEUED'
      RETURNING lease_fencing_counter AS fence`,
    [jobId, worker.id, sha256Hex(token), milliseconds],
  );
  return Number(row.fence);
}

// ---------------------------------------------------------------------------
// HTTP and service calls

const json = (response: TestResponse) => JSON.parse(response.body) as Record<string, any>;

function post(worker: Worker, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<TestResponse> {
  const headers: Record<string, string> = { Authorization: `Bearer ${worker.token}`, ...extra };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return send(port, "POST", path, body === undefined ? undefined : JSON.stringify(body), headers);
}

type Lease = Readonly<{ providerVerificationJobId: string; leaseToken: string; fencingCounter: number }>;
type Proof = Readonly<{ fencingCounter: number; leaseToken: string }>;

async function lease(worker: Worker): Promise<Lease | null> {
  const response = await post(worker, LEASE_PATH);
  expect(response.status).toBe(200);
  return json(response).lease as Lease | null;
}
const proofOf = (acquired: Lease): Proof => ({ fencingCounter: acquired.fencingCounter, leaseToken: acquired.leaseToken });
async function leased(worker: Worker, jobId: string): Promise<Proof> {
  const acquired = await lease(worker);
  expect(acquired?.providerVerificationJobId).toBe(jobId);
  return proofOf(acquired!);
}

const unsupported = (worker: Worker, jobId: string, proof: Proof, refusal: string = "UNSUPPORTED_PROVIDER", extra: Record<string, string> = {}) =>
  post(worker, `${BASE}/${jobId}/unsupported`, { ...proof, refusal }, extra);
const grant = (worker: Worker, jobId: string, proof: Proof) => post(worker, `${BASE}/${jobId}/credential-grant`, proof);
const verifying = (worker: Worker, jobId: string, proof: Proof) => post(worker, `${BASE}/${jobId}/verifying`, proof);
const result = (worker: Worker, jobId: string, proof: Proof, outcome: string, reasonCode: string) =>
  post(worker, `${BASE}/${jobId}/result`, { ...proof, outcome, reasonCode });

const contextOf = (worker: Worker) => Object.freeze({ workerPrincipalId: worker.id, correlationId: randomUUID() });

// The real deferral service with the test-only seam (never reachable over HTTP).
const deferBySeam = (worker: Worker, jobId: string, proof: Proof, refusal: ProviderVerificationRefusal = "UNSUPPORTED_PROVIDER", seconds = SHORT_SECONDS) =>
  deferUnsupportedProviderVerification(pool, contextOf(worker), jobId, proof, refusal, () => seconds);

// ---------------------------------------------------------------------------
// Reads

type DeferralRow = {
  state: string;
  fence: string;
  count: number;
  refusal: string | null;
  deferred_until: Date | null;
  // deferred_until - updated_at in seconds: both are the deferring transaction's now().
  offset: number | null;
  lease_worker_principal_id: string | null;
  lease_token_sha256: string | null;
  leased_at: Date | null;
  lease_expires_at: Date | null;
  credential_granted_at: Date | null;
  verifying_at: Date | null;
  result_outcome: string | null;
  terminal_reason_code: string | null;
  completed_at: Date | null;
};
const deferralRow = (jobId: string) =>
  one<DeferralRow>(
    `SELECT state, lease_fencing_counter AS fence, unsupported_deferral_count AS count, last_unsupported_refusal AS refusal, deferred_until,
            extract(epoch FROM deferred_until - updated_at)::float8 AS offset, lease_worker_principal_id, lease_token_sha256, leased_at,
            lease_expires_at, credential_granted_at, verifying_at, result_outcome, terminal_reason_code, completed_at
       FROM provider_verification_jobs WHERE id = $1`,
    [jobId],
  );
const wholeRow = (jobId: string) => one<Record<string, unknown>>("SELECT * FROM provider_verification_jobs WHERE id = $1", [jobId]);
const connectionRow = (connectionId: string) => one<Record<string, unknown>>("SELECT * FROM provider_connections WHERE id = $1", [connectionId]);
const auditCount = () => one<{ n: number }>("SELECT count(*)::int AS n FROM audit_events").then((row) => row.n);

// Phase 8 precision rule: compare database timestamps in the database, as text.
async function waitUntilEligible(jobId: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await one<{ eligible: boolean }>(
      "SELECT clock_timestamp() > COALESCE(deferred_until, created_at) AS eligible FROM provider_verification_jobs WHERE id = $1",
      [jobId],
    );
    if (row.eligible) return;
    if (Date.now() > deadline) throw new Error("job did not become eligible within the bounded test wait");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForDatabaseTimePast(timestampText: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await one<{ past: boolean }>("SELECT clock_timestamp() > $1::timestamptz AS past", [timestampText])).past) return;
    if (Date.now() > deadline) throw new Error("database time did not pass the bounded wait");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function expectRejected(response: TestResponse, reason: WorkerSecurityEvent["reason"], jobId: string, workerId: string) {
  expect(response.status).toBe(409);
  expect(response.body).toBe(REJECTED);
  const event = recording.events.at(-1)!;
  expect(event).toMatchObject({ type: DEFERRAL_REJECTED, reason, providerVerificationJobId: jobId, workerPrincipalId: workerId });
  expect(event.executionAttemptId).toBeUndefined();
  expect(Object.keys(event).sort()).toEqual(["correlationId", "occurredAt", "providerVerificationJobId", "reason", "type", "workerPrincipalId"]);
}

const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

// Defers the fixture job `times` times through the real lease and the seam,
// asserting after each step that the job stays QUEUED and non-terminal (N1).
async function deferRepeatedly(worker: Worker, jobId: string, times: number): Promise<void> {
  const refusals: ProviderVerificationRefusal[] = ["UNSUPPORTED_PROVIDER", "UNSUPPORTED_POLICY", "PROVIDER_POLICY_MISMATCH"];
  for (let step = 1; step <= times; step += 1) {
    await waitUntilEligible(jobId);
    const proof = await leased(worker, jobId);
    const refusal = refusals[step % refusals.length]!;
    const deferral = await deferBySeam(worker, jobId, proof, refusal);
    expect(deferral).toMatchObject({ providerVerificationJobId: jobId, fencingCounter: proof.fencingCounter, state: "QUEUED" });
    const row = await deferralRow(jobId);
    expect(row, `step ${step}`).toMatchObject({
      state: "QUEUED",
      count: step,
      refusal,
      fence: String(step),
      completed_at: null,
      terminal_reason_code: null,
      result_outcome: null,
      credential_granted_at: null,
      lease_worker_principal_id: null,
    });
  }
}

// ---------------------------------------------------------------------------

describe("N: an unsupported refusal is never terminal", () => {
  it("N1/N2: 30 refusals keep the job QUEUED and open, and a capable worker then verifies it with the columns persisting", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    await deferRepeatedly(worker!, f.jobId, 30);
    const after30 = await deferralRow(f.jobId);
    // Steps 12 and 13 crossed explicitly by the loop; 30 is the count now.
    expect(after30).toMatchObject({ state: "QUEUED", count: 30, completed_at: null, terminal_reason_code: null });

    await waitUntilEligible(f.jobId);
    const proof = await leased(worker!, f.jobId);
    expect((await grant(worker!, f.jobId, proof)).status).toBe(200);
    expect((await verifying(worker!, f.jobId, proof)).status).toBe(200);
    expect((await result(worker!, f.jobId, proof, "VERIFIED", "VERIFICATION_SUCCEEDED")).status).toBe(200);
    const completed = await deferralRow(f.jobId);
    expect(completed).toMatchObject({ state: "COMPLETED", count: 30, refusal: after30.refusal, result_outcome: "VERIFIED", fence: "31" });
    expect(completed.deferred_until).toEqual(after30.deferred_until);
  }, 120_000);

  it("N3: after 30 refusals the reconciler leaves an eligible job alone, and cancels it only on lifecycle ineligibility, keeping the columns", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    await deferRepeatedly(worker!, f.jobId, 30);
    const before = await deferralRow(f.jobId);

    expect(await reconcileProviderVerificationJobs(pool, { correlationId: randomUUID() })).toEqual({ cancelledJobs: 0, requeuedJobs: 0, completedJobs: 0 });
    expect(await deferralRow(f.jobId)).toEqual(before);

    await disconnect(f);
    expect(await reconcileProviderVerificationJobs(pool, { correlationId: randomUUID() })).toEqual({ cancelledJobs: 1, requeuedJobs: 0, completedJobs: 0 });
    const cancelled = await deferralRow(f.jobId);
    expect(cancelled).toMatchObject({ state: "CANCELLED", terminal_reason_code: "LIFECYCLE_NO_LONGER_ELIGIBLE", count: 30, refusal: before.refusal });
    expect(cancelled.deferred_until).toEqual(before.deferred_until);
  }, 120_000);

  it("N4: the service never makes a job terminal; a refused deferral leaves every column unchanged", async () => {
    const [worker, other] = await begin(2);
    const f = await fixture();
    const proof = await leased(worker!, f.jobId);
    const before = await wholeRow(f.jobId);
    expectRejected(await unsupported(other!, f.jobId, proof), "OTHER_WORKER", f.jobId, other!.id);
    expect(await wholeRow(f.jobId)).toEqual(before);
    expect((await unsupported(worker!, f.jobId, proof)).status).toBe(200);
    expect((await deferralRow(f.jobId)).state).toBe("QUEUED");
  });

  it("N6: d(n) is 300, 600, 1200, 2400 and then 3600 seconds for every n >= 5, including 50", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 12, 13, 50].map(unsupportedDeferralSeconds)).toEqual([300, 600, 1200, 2400, 3600, 3600, 3600, 3600, 3600, 3600]);
  });

  it("N6: the HTTP route's production deferral at n = 50 is exactly 3600 seconds", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    await deferRepeatedly(worker!, f.jobId, 49);
    await waitUntilEligible(f.jobId);
    const proof = await leased(worker!, f.jobId);
    expect((await unsupported(worker!, f.jobId, proof)).status).toBe(200);
    expect(await deferralRow(f.jobId)).toMatchObject({ state: "QUEUED", count: 50, offset: 3600 });
  }, 120_000);
});

describe("F: bounded fairness", () => {
  it("F1/F2/F8.2: a deferred job is not leasable before deferred_until and is leasable once it has passed", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    // Production deferral over HTTP: not leasable for 300 s.
    const proof = await leased(worker!, f.jobId);
    expect((await unsupported(worker!, f.jobId, proof)).status).toBe(200);
    expect(await lease(worker!)).toBeNull();

    // A second job, deferred briefly through the seam, is leasable once its key has passed.
    const g = await fixture();
    const second = await leased(worker!, g.jobId);
    await deferBySeam(worker!, g.jobId, second, "UNSUPPORTED_POLICY", 0.3);
    expect(await lease(worker!)).toBeNull();
    await waitUntilEligible(g.jobId);
    expect((await lease(worker!))?.providerVerificationJobId).toBe(g.jobId);
  });

  it("F3: the production schedule writes exactly now() + 300, 600, 1200, 2400, 3600, 3600, 3600 s for n = 1..7", async () => {
    const [worker] = await begin(1);
    for (let n = 1; n <= 7; n += 1) {
      // Each earlier fixture is now deferred for minutes, so this job is the only eligible one.
      const f = await fixture();
      await deferRepeatedly(worker!, f.jobId, n - 1);
      await waitUntilEligible(f.jobId);
      const proof = await leased(worker!, f.jobId);
      const response = await unsupported(worker!, f.jobId, proof);
      expect(response.status).toBe(200);
      expect(await deferralRow(f.jobId), `n = ${n}`).toMatchObject({ count: n, offset: [300, 600, 1200, 2400, 3600, 3600, 3600][n - 1] });
    }
  }, 120_000);

  it("F4: a re-eligible deferred job follows a job created before its deferral ended", async () => {
    const [worker] = await begin(1);
    const deferred = await fixture();
    const proof = await leased(worker!, deferred.jobId);
    await deferBySeam(worker!, deferred.jobId, proof, "UNSUPPORTED_PROVIDER", 0.5);
    const later = await fixture();
    expect((await one<{ ordered: boolean }>(
      "SELECT (SELECT created_at FROM provider_verification_jobs WHERE id = $2) < (SELECT deferred_until FROM provider_verification_jobs WHERE id = $1) AS ordered",
      [deferred.jobId, later.jobId],
    )).ordered).toBe(true);
    await waitUntilEligible(deferred.jobId);
    expect((await lease(worker!))?.providerVerificationJobId).toBe(later.jobId);
    expect((await lease(worker!))?.providerVerificationJobId).toBe(deferred.jobId);
  });

  it("F5: with 20 older unsupported jobs, a supported job is acquired within 21 acquisitions", async () => {
    const [worker] = await begin(1);
    const older: string[] = [];
    for (let index = 0; index < 20; index += 1) older.push((await fixture()).jobId);
    const supported = await fixture();
    let acquisitions = 0;
    for (;;) {
      const acquired = await lease(worker!);
      expect(acquired).not.toBeNull();
      acquisitions += 1;
      if (acquired!.providerVerificationJobId === supported.jobId) break;
      expect(older).toContain(acquired!.providerVerificationJobId);
      expect((await unsupported(worker!, acquired!.providerVerificationJobId, proofOf(acquired!))).status).toBe(200);
      expect(acquisitions).toBeLessThan(21);
    }
    expect(acquisitions).toBeLessThanOrEqual(21);
  }, 60_000);

  it("F7/M2: a natural-expiry requeue keeps the key and the deferral columns; an R44B11F-style silent refusal changes none", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await leased(worker!, f.jobId);
    await deferBySeam(worker!, f.jobId, proof, "PROVIDER_POLICY_MISMATCH", 0.2);
    const deferred = await deferralRow(f.jobId);
    await waitUntilEligible(f.jobId);
    // A worker that never sends a deferral (pre-R44B11G behaviour): the lease just expires.
    await ownerLease(f.jobId, worker!, randomBytes(32).toString("base64url"), 400);
    await waitForDatabaseTimePast((await one<{ at: string }>("SELECT lease_expires_at::text AS at FROM provider_verification_jobs WHERE id = $1", [f.jobId])).at);
    expect(await reconcileProviderVerificationJobs(pool, { correlationId: randomUUID() })).toEqual({ cancelledJobs: 0, requeuedJobs: 1, completedJobs: 0 });
    const requeued = await deferralRow(f.jobId);
    expect(requeued).toMatchObject({ state: "QUEUED", count: 1, refusal: "PROVIDER_POLICY_MISMATCH", fence: "2", lease_worker_principal_id: null });
    expect(requeued.deferred_until).toEqual(deferred.deferred_until);

    const silent = await fixture();
    await ownerLease(silent.jobId, worker!, randomBytes(32).toString("base64url"), 400);
    await waitForDatabaseTimePast((await one<{ at: string }>("SELECT lease_expires_at::text AS at FROM provider_verification_jobs WHERE id = $1", [silent.jobId])).at);
    expect(await reconcileProviderVerificationJobs(pool, { correlationId: randomUUID() })).toEqual({ cancelledJobs: 0, requeuedJobs: 1, completedJobs: 0 });
    expect(await deferralRow(silent.jobId)).toMatchObject({ state: "QUEUED", count: 0, refusal: null, deferred_until: null });
  });

  it("F8.1: SKIP LOCKED acquires the next eligible job without waiting while another transaction holds the first", async () => {
    const [worker] = await begin(1);
    const first = await fixture();
    const second = await fixture();
    expect((await one<{ ordered: boolean }>(
      `SELECT (a.created_at, a.id) < (b.created_at, b.id) AS ordered FROM provider_verification_jobs a, provider_verification_jobs b WHERE a.id = $1 AND b.id = $2`,
      [first.jobId, second.jobId],
    )).ordered).toBe(true);

    const holder = await connectAs(clients.config.runtimeUrl, APPROVED_RUNTIME_ROLE);
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM provider_verification_jobs WHERE id = $1 FOR UPDATE", [first.jobId]);

      // Positive evidence: the real lease call settles within 5 s while J1 stays locked.
      const acquired = await Promise.race([
        acquireProviderVerificationLease(pool, contextOf(worker!)),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5000)),
      ]);
      expect(acquired).not.toBe("timeout");

      // Negative control on a third connection: A's lock is effective against a non-SKIP-LOCKED locker.
      const control = await connectAs(clients.config.runtimeUrl, APPROVED_RUNTIME_ROLE);
      try {
        await control.query("BEGIN");
        let caught: unknown;
        try {
          await control.query("SET LOCAL lock_timeout = '500ms'");
          await control.query("SELECT id FROM provider_verification_jobs WHERE id = $1 FOR UPDATE", [first.jobId]);
        } catch (error) {
          caught = error;
        } finally {
          await control.query("ROLLBACK");
        }
        expect(caught).toMatchObject({ code: "55P03" });
      } finally {
        await control.end();
      }

      expect(acquired === "timeout" ? null : acquired?.providerVerificationJobId).toBe(second.jobId);
      await holder.query("ROLLBACK");
    } finally {
      await holder.end();
    }

    expect(await deferralRow(first.jobId)).toMatchObject({ state: "QUEUED", fence: "0", lease_worker_principal_id: null, lease_token_sha256: null });
    const secondRow = await deferralRow(second.jobId);
    expect(secondRow).toMatchObject({ state: "LEASED", fence: "1", lease_worker_principal_id: worker!.id });
    expect(secondRow.lease_token_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await acquireProviderVerificationLease(pool, contextOf(worker!)))?.providerVerificationJobId).toBe(first.jobId);
  });
});

// ---------------------------------------------------------------------------
// F6: index applicability and plan shape on a representative synthetic
// distribution (R44B11G 11 F6). Seeding and inspection are separate; the
// assertion is never weakened, and a seeding overrun is a setup failure.

const F6_PAST = 500;
const F6_FUTURE = 5000;
const F6_NEVER = 520;
const F6_LEASED = 5;
const F6_CANCELLED = 10;
const F6_CONCURRENCY = 8;
// Every 300 s deferral must be written, and inspection must start, inside d(1).
const F6_SEEDING_BOUND_MS = 240_000;

type PlanNode = { "Node Type": string; Plans?: PlanNode[]; "Scan Direction"?: string; "Index Name"?: string; "Relation Name"?: string; Alias?: string; "Index Cond"?: string };

const allNodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(allNodes)];

function stripOuterParentheses(text: string): string {
  let current = text;
  for (;;) {
    if (!current.startsWith("(") || !current.endsWith(")")) return current;
    let depth = 0;
    let closesAtEnd = true;
    for (let index = 0; index < current.length; index += 1) {
      if (current[index] === "(") depth += 1;
      if (current[index] === ")") depth -= 1;
      if (depth === 0 && index < current.length - 1) {
        closesAtEnd = false;
        break;
      }
    }
    if (!closesAtEnd) return current;
    current = current.slice(1, -1);
  }
}

// m3: remove the j. qualifier, casts, whitespace and redundant outer parentheses.
const normaliseCondition = (condition: string) =>
  stripOuterParentheses(condition.replace(/\bj\./g, "").replace(/::[a-z ]+(\(\d+\))?/gi, "").replace(/\s+/g, ""));

function recordingPool(base: TransactionalPool, recorded: Set<string>): TransactionalPool {
  return Object.freeze({
    query: base.query,
    end: async () => {},
    connect: async () => {
      const client = await base.connect();
      return Object.freeze({
        query: <Row extends object>(sql: string, params?: unknown[]) => {
          recorded.add(sql);
          return client.query<Row>(sql, params);
        },
        release: (error?: Error) => client.release(error),
      });
    },
  });
}

async function runLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const item = items[next]!;
        next += 1;
        await work(item);
      }
    }),
  );
}

// Fixture-equivalent bulk creation: each job has its own Account, owner,
// connection and ACTIVE version, honouring every uniqueness constraint.
async function bulkJobs(count: number, tag: string): Promise<{ jobIds: string[]; connectionIds: string[] }> {
  const users = Array.from({ length: count }, () => randomUUID());
  const accounts = Array.from({ length: count }, () => randomUUID());
  const connections = Array.from({ length: count }, () => randomUUID());
  const versions = Array.from({ length: count }, () => randomUUID());
  const subjects = users.map((_, index) => `f6-${tag}-${index}-${randomUUID()}`);
  await clients.migrator.query("INSERT INTO users (id, idp_issuer, idp_subject) SELECT u, 'https://issuer.test', s FROM unnest($1::uuid[], $2::text[]) AS t(u, s)", [users, subjects]);
  await clients.migrator.query("INSERT INTO accounts (id, kind, owner_user_id) SELECT a, 'PERSONAL', u FROM unnest($1::uuid[], $2::uuid[]) AS t(a, u)", [accounts, users]);
  await clients.migrator.query(
    `INSERT INTO provider_connections (id, account_id, provider, credential_kind, created_by_user_id)
     SELECT c, a, 'EXAMPLE_PROVIDER', 'API_KEY', u FROM unnest($1::uuid[], $2::uuid[], $3::uuid[]) AS t(c, a, u)`,
    [connections, accounts, users],
  );
  await clients.migrator.query(
    `INSERT INTO provider_credential_versions
       (id, account_id, provider_connection_id, credential_version, status, sealed_credential, fingerprint_algorithm, fingerprint_key_ref, fingerprint_value, created_by_user_id)
     SELECT v, a, c, 1, 'ACTIVE', '{"format":"fixture-envelope"}'::jsonb, 'HMAC-SHA-256', 'fixture/v1', repeat('a', 43), u
       FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[]) AS t(v, a, c, u)`,
    [versions, accounts, connections, users],
  );
  const jobs = await clients.migrator.query<{ id: string }>(
    `INSERT INTO provider_verification_jobs (account_id, provider_connection_id, provider_credential_version_id, verification_policy_id, requested_by_user_id)
     SELECT a, c, v, 'EXAMPLE_METADATA_V1', u FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[]) AS t(a, c, v, u)
     RETURNING id`,
    [accounts, connections, versions, users],
  );
  return { jobIds: jobs.rows.map((row) => row.id), connectionIds: connections };
}

describe("F6: eligible-queue index plan for the complete lease query", () => {
  it("drives the lease query by a forward scan of provider_verification_jobs_eligible_queue_ix with no sort or bitmap scan", async () => {
    const [worker] = await workers(1);
    const context = contextOf(worker!);

    // Seed phase: fixtures, then committed leases and deferrals through the real services.
    const cancelled = await bulkJobs(F6_CANCELLED, "cancelled");
    await bulkJobs(F6_PAST + F6_FUTURE + F6_NEVER + F6_LEASED, "open");
    await clients.migrator.query("UPDATE provider_connections SET status = 'DISCONNECTED', disconnected_at = now() WHERE id = ANY($1::uuid[])", [cancelled.connectionIds]);
    expect(await reconcileProviderVerificationJobs(pool, { correlationId: randomUUID(), batchSize: 100 })).toEqual({
      cancelledJobs: F6_CANCELLED,
      requeuedJobs: 0,
      completedJobs: 0,
    });

    const recorded = new Set<string>();
    const recordingLeasePool = recordingPool(pool, recorded);
    const sequenceMs: number[] = [];
    const pastIds: string[] = [];
    const futureIds: string[] = [];
    const leaseAndDefer = async (seconds: number, into: string[]) => {
      const started = Date.now();
      const acquired = await acquireProviderVerificationLease(recordingLeasePool, context);
      if (acquired === null) throw new Error("F6 SETUP FAILURE: no eligible job to lease while seeding");
      await deferUnsupportedProviderVerification(pool, context, acquired.providerVerificationJobId, proofOf(acquired), "UNSUPPORTED_PROVIDER", () => seconds);
      into.push(acquired.providerVerificationJobId);
      sequenceMs.push(Date.now() - started);
    };

    // Past-deferred rows (1 s schedule).
    await runLimited(Array.from({ length: F6_PAST }), F6_CONCURRENCY, () => leaseAndDefer(1, pastIds));
    // Future-deferred rows (production d(1) = 300 s), inside an explicit seeding window.
    const seedingStarted = Date.now();
    await runLimited(Array.from({ length: F6_FUTURE }), F6_CONCURRENCY, () => leaseAndDefer(unsupportedDeferralSeconds(1), futureIds));
    // Some LEASED rows, never deferred.
    for (let index = 0; index < F6_LEASED; index += 1) expect(await acquireProviderVerificationLease(recordingLeasePool, context)).not.toBeNull();
    expect(sequenceMs).toHaveLength(F6_PAST + F6_FUTURE);
    if (Date.now() - seedingStarted > F6_SEEDING_BOUND_MS) {
      throw new Error(`F6 SETUP FAILURE: seeding took ${Date.now() - seedingStarted} ms (bound ${F6_SEEDING_BOUND_MS} ms); not plan evidence`);
    }

    // Every intended-eligible past deferral has passed; every intended-future row is still in the future.
    const pastMax = await one<{ at: string }>("SELECT max(deferred_until)::text AS at FROM provider_verification_jobs WHERE id = ANY($1::uuid[])", [pastIds]);
    await waitForDatabaseTimePast(pastMax.at);
    const mix = await one<{ eligible: number; future: number; past_deferred: number; never: number; leased: number; cancelled: number; future_still_future: boolean }>(
      `SELECT count(*) FILTER (WHERE state = 'QUEUED' AND COALESCE(deferred_until, created_at) <= clock_timestamp())::int AS eligible,
              count(*) FILTER (WHERE state = 'QUEUED' AND deferred_until > clock_timestamp())::int AS future,
              count(*) FILTER (WHERE state = 'QUEUED' AND deferred_until <= clock_timestamp())::int AS past_deferred,
              count(*) FILTER (WHERE state = 'QUEUED' AND deferred_until IS NULL)::int AS never,
              count(*) FILTER (WHERE state = 'LEASED')::int AS leased,
              count(*) FILTER (WHERE state = 'CANCELLED')::int AS cancelled,
              bool_and(deferred_until > clock_timestamp()) FILTER (WHERE id = ANY($1::uuid[])) AS future_still_future
         FROM provider_verification_jobs`,
      [futureIds],
    );
    if (mix.future_still_future !== true) throw new Error("F6 SETUP FAILURE: an intended-future row became eligible before inspection; not plan evidence");
    expect(mix).toMatchObject({ future: F6_FUTURE, past_deferred: F6_PAST, never: F6_NEVER, leased: F6_LEASED, cancelled: F6_CANCELLED });
    expect(mix.eligible).toBeGreaterThanOrEqual(1000);
    expect(mix.future).toBeGreaterThanOrEqual(5000);

    // Statistics, on the migrator (table owner), as separate autocommit statements; any WARNING fails.
    const warnings: string[] = [];
    const onNotice = (notice: { severity?: string | undefined; message?: string | undefined }) => {
      if (notice.severity === "WARNING") warnings.push(notice.message ?? "warning");
    };
    clients.migrator.on("notice", onNotice);
    try {
      const statsBefore = await one<{ analyze_count: string; last_analyze: string | null }>(
        "SELECT analyze_count::text AS analyze_count, last_analyze::text AS last_analyze FROM pg_stat_user_tables WHERE relname = 'provider_verification_jobs'",
      );
      await clients.migrator.query("ANALYZE provider_verification_jobs, accounts, users, provider_connections, provider_credential_versions");
      expect(warnings).toEqual([]);
      const deadline = Date.now() + 5000;
      let statsAfter = statsBefore;
      while (statsAfter.analyze_count === statsBefore.analyze_count && statsAfter.last_analyze === statsBefore.last_analyze && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        statsAfter = await one<{ analyze_count: string; last_analyze: string | null }>(
          "SELECT analyze_count::text AS analyze_count, last_analyze::text AS last_analyze FROM pg_stat_user_tables WHERE relname = 'provider_verification_jobs'",
        );
      }
      expect(Number(statsAfter.analyze_count) > Number(statsBefore.analyze_count) || statsAfter.last_analyze !== statsBefore.last_analyze).toBe(true);
      expect((await one<{ reltuples: number }>("SELECT reltuples::float8 AS reltuples FROM pg_class WHERE oid = 'public.provider_verification_jobs'::regclass")).reltuples).toBeGreaterThan(0);
      expect(
        (await one<{ n: number }>("SELECT count(*)::int AS n FROM pg_stats WHERE schemaname = 'public' AND tablename = 'provider_verification_jobs_eligible_queue_ix'")).n,
      ).toBeGreaterThan(0);
    } finally {
      clients.migrator.removeListener("notice", onNotice);
    }

    // The exact, complete lease-selection SQL, recorded from the real lease calls (SELECT_NEXT stays unexported).
    const selects = [...recorded].filter((sql) => sql.includes("FOR UPDATE OF j SKIP LOCKED"));
    expect(selects).toHaveLength(1);
    const selectNext = selects[0]!;
    expect(selectNext).toMatch(/COALESCE\(j\.deferred_until, j\.created_at\) <= now\(\)/);
    expect(selectNext).toMatch(/ORDER BY COALESCE\(j\.deferred_until, j\.created_at\), j\.id/);

    // Inspection transaction on the runtime connection, with the production privileges.
    await clients.runtime.query("BEGIN");
    let plan: PlanNode;
    try {
      await clients.runtime.query("SET LOCAL enable_seqscan = off");
      const explained = await clients.runtime.query<{ "QUERY PLAN": [{ Plan: PlanNode }] }>(`EXPLAIN (FORMAT JSON) ${selectNext}`);
      plan = explained.rows[0]!["QUERY PLAN"][0].Plan;
    } finally {
      await clients.runtime.query("ROLLBACK");
    }

    const root = plan["Node Type"] === "Result" ? plan.Plans![0]! : plan;
    expect(root["Node Type"]).toBe("Limit");
    const lockRows = root.Plans?.[0];
    expect(lockRows?.["Node Type"]).toBe("LockRows");
    // The ordered driving input: the outer side of the join subtree below LockRows.
    let driving = lockRows!.Plans![0]!;
    while (/Join|Nested Loop/.test(driving["Node Type"]) && driving.Plans !== undefined) driving = driving.Plans[0]!;
    expect({
      nodeType: driving["Node Type"],
      direction: driving["Scan Direction"],
      index: driving["Index Name"],
      relation: driving["Relation Name"],
      alias: driving.Alias,
    }).toEqual({
      nodeType: "Index Scan",
      direction: "Forward",
      index: "provider_verification_jobs_eligible_queue_ix",
      relation: "provider_verification_jobs",
      alias: "j",
    });
    expect(normaliseCondition(driving["Index Cond"] ?? "")).toBe("COALESCE(deferred_until,created_at)<=now()");
    const nodes = allNodes(plan);
    expect(nodes.filter((node) => node["Node Type"] === "Sort" || node["Node Type"] === "Incremental Sort")).toEqual([]);
    expect(
      nodes.filter(
        (node) =>
          (node["Node Type"] === "Bitmap Heap Scan" && node["Relation Name"] === "provider_verification_jobs") ||
          (node["Node Type"] === "Bitmap Index Scan" && (node["Index Name"] ?? "").startsWith("provider_verification_jobs_")),
      ),
    ).toEqual([]);

    // Behaviourally, the real lease call returns the minimum-key eligible row.
    const expected = await one<{ id: string }>(
      `SELECT j.id FROM provider_verification_jobs j
         JOIN accounts a ON a.id = j.account_id JOIN users u ON u.id = a.owner_user_id
         JOIN provider_connections c ON c.account_id = j.account_id AND c.id = j.provider_connection_id
         JOIN provider_credential_versions v ON v.account_id = j.account_id AND v.provider_connection_id = j.provider_connection_id AND v.id = j.provider_credential_version_id
        WHERE j.state = 'QUEUED' AND COALESCE(j.deferred_until, j.created_at) <= clock_timestamp()
          AND a.status = 'ACTIVE' AND u.status = 'ACTIVE' AND c.status NOT IN ('DISCONNECTED', 'DISABLED') AND v.status = 'ACTIVE'
        ORDER BY COALESCE(j.deferred_until, j.created_at), j.id LIMIT 1`,
    );
    expect((await acquireProviderVerificationLease(pool, context))?.providerVerificationJobId).toBe(expected.id);

    // Guard the normalisation.
    expect(normaliseCondition("(COALESCE(j.deferred_until, j.created_at) <= now())")).toBe("COALESCE(deferred_until,created_at)<=now()");
    expect(normaliseCondition("(j.created_at <= now())")).not.toBe("COALESCE(deferred_until,created_at)<=now()");
  }, 600_000);
});

// ---------------------------------------------------------------------------

describe("H: unsupported route over HTTP", () => {
  it("H7/Z: commits ungranted LEASED -> QUEUED with exactly four response keys, no grant, no audit and no customer-visible change", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const connectionBefore = await connectionRow(f.connectionId);
    const auditsBefore = await auditCount();
    const acquired = await lease(worker!);
    const response = await unsupported(worker!, f.jobId, proofOf(acquired!), "UNSUPPORTED_POLICY");
    expect(response.status).toBe(200);
    const body = json(response);
    expect(Object.keys(body).sort()).toEqual(["deferredUntil", "fencingCounter", "providerVerificationJobId", "state"]);
    const row = await deferralRow(f.jobId);
    expect(body).toEqual({ providerVerificationJobId: f.jobId, fencingCounter: 1, state: "QUEUED", deferredUntil: row.deferred_until!.toISOString() });
    expect(row).toMatchObject({
      state: "QUEUED",
      fence: "1",
      count: 1,
      refusal: "UNSUPPORTED_POLICY",
      offset: 300,
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      leased_at: null,
      lease_expires_at: null,
      credential_granted_at: null,
      verifying_at: null,
    });
    // Successful deferrals are not security events; nothing customer-visible or audited changes.
    expect(recording.events).toEqual([]);
    expect(await connectionRow(f.connectionId)).toEqual(connectionBefore);
    expect(await auditCount()).toBe(auditsBefore);
    // The plaintext lease token is stored nowhere and appears in no event.
    expect((await one<{ hits: number }>("SELECT count(*)::int AS hits FROM provider_verification_jobs t WHERE strpos(t::text, $1) > 0", [acquired!.leaseToken])).hits).toBe(0);
    expect(JSON.stringify(recording.events).includes(acquired!.leaseToken)).toBe(false);
  });

  it("H9: a repeat after commit is not replayed: 409 NOT_LEASED and no second increment", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await leased(worker!, f.jobId);
    expect((await unsupported(worker!, f.jobId, proof)).status).toBe(200);
    const before = await wholeRow(f.jobId);
    expectRejected(await unsupported(worker!, f.jobId, proof), "NOT_LEASED", f.jobId, worker!.id);
    expect(await wholeRow(f.jobId)).toEqual(before);
  });

  it("H4: every 409 reason is logged with its own event and changes nothing", async () => {
    const [worker, other] = await begin(2);

    const unknownJob = randomUUID();
    expectRejected(await unsupported(worker!, unknownJob, { fencingCounter: 1, leaseToken: "A".repeat(43) }), "UNKNOWN_VERIFICATION_JOB", unknownJob, worker!.id);

    const queued = await fixture();
    const queuedBefore = await wholeRow(queued.jobId);
    expectRejected(await unsupported(worker!, queued.jobId, { fencingCounter: 1, leaseToken: "A".repeat(43) }), "NOT_LEASED", queued.jobId, worker!.id);
    expect(await wholeRow(queued.jobId)).toEqual(queuedBefore);

    // The worker leases the oldest eligible job (queued); f stays QUEUED for the expiry case.
    const f = await fixture();
    const proof = await leased(worker!, queued.jobId);
    const leasedBefore = await wholeRow(queued.jobId);
    expectRejected(await unsupported(other!, queued.jobId, proof), "OTHER_WORKER", queued.jobId, other!.id);
    expectRejected(await unsupported(worker!, queued.jobId, { ...proof, fencingCounter: proof.fencingCounter + 1 }), "FENCING_MISMATCH", queued.jobId, worker!.id);
    expectRejected(await unsupported(worker!, queued.jobId, { ...proof, leaseToken: randomBytes(32).toString("base64url") }), "TOKEN_MISMATCH", queued.jobId, worker!.id);
    expect(await wholeRow(queued.jobId)).toEqual(leasedBefore);

    expect((await grant(worker!, queued.jobId, proof)).status).toBe(200);
    const grantedBefore = await wholeRow(queued.jobId);
    expectRejected(await unsupported(worker!, queued.jobId, proof), "CREDENTIAL_GRANTED", queued.jobId, worker!.id);
    expect(await wholeRow(queued.jobId)).toEqual(grantedBefore);

    const token = randomBytes(32).toString("base64url");
    const fence = await ownerLease(f.jobId, worker!, token, 300);
    await waitForDatabaseTimePast((await one<{ at: string }>("SELECT lease_expires_at::text AS at FROM provider_verification_jobs WHERE id = $1", [f.jobId])).at);
    const expiredBefore = await wholeRow(f.jobId);
    expectRejected(await unsupported(worker!, f.jobId, { fencingCounter: fence, leaseToken: token }), "LEASE_EXPIRED", f.jobId, worker!.id);
    expect(await wholeRow(f.jobId)).toEqual(expiredBefore);

    // No event, response or row carries a lease token.
    const visible = JSON.stringify(recording.events);
    expect(visible.includes(proof.leaseToken) || visible.includes(token)).toBe(false);
  });

  it("H2: a principal disabled after authenticating is 401 with a deferral rejection event, rolled back", async () => {
    const [worker] = await workers(1);
    const f = await fixture();
    await start([worker!]);
    const proof = await leased(worker!, f.jobId);
    const before = await wholeRow(f.jobId);
    await server!.close();
    const disablingPool: TransactionalPool = {
      query: pool.query,
      end: async () => {},
      connect: async () => {
        await clients.migrator.query("UPDATE worker_principals SET status = 'DISABLED', disabled_at = now() WHERE id = $1 AND status = 'ACTIVE'", [worker!.id]);
        return pool.connect();
      },
    };
    await start([worker!], disablingPool);
    const response = await unsupported(worker!, f.jobId, proof);
    expect(response.status).toBe(401);
    expect(response.body).toBe('{"status":"error","code":"AUTHENTICATION_REQUIRED"}\n');
    expect(recording.events.map((event) => [event.type, event.reason, event.providerVerificationJobId])).toEqual([[DEFERRAL_REJECTED, "WORKER_NOT_ACTIVE", f.jobId]]);
    expect(await wholeRow(f.jobId)).toEqual(before);
  });

  it("H1/H3/H5/H6/H8: authentication, Origin, body defects, routing and a failing security log change no state", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await leased(worker!, f.jobId);
    const before = await wholeRow(f.jobId);
    const path = `${BASE}/${f.jobId}/unsupported`;
    const body = JSON.stringify({ ...proof, refusal: "UNSUPPORTED_PROVIDER" });

    expect((await send(port, "POST", path, body, { "Content-Type": "application/json" })).status).toBe(401);
    expect((await send(port, "POST", path, body, { "Content-Type": "application/json", Authorization: "Bearer not-a-fixture" })).status).toBe(401);
    expect((await unsupported(worker!, f.jobId, proof, "UNSUPPORTED_PROVIDER", { Origin: "https://app.example" })).status).toBe(403);
    expect((await post(worker!, path, { ...proof, refusal: "UNSUPPORTED_PROVIDER", deferralSeconds: 1 })).status).toBe(400);
    expect((await post(worker!, path, { ...proof, refusal: "VERIFICATION_UNSCHEDULABLE" })).status).toBe(400);
    expect((await post(worker!, path, proof)).status).toBe(400);
    expect((await send(port, "POST", path, body, { Authorization: `Bearer ${worker!.token}`, "Content-Type": "text/plain" })).status).toBe(415);
    expect((await send(port, "POST", path, JSON.stringify({ ...proof, refusal: "U".repeat(5000) }), { Authorization: `Bearer ${worker!.token}`, "Content-Type": "application/json" })).status).toBe(413);
    expect((await send(port, "GET", path, undefined, { Authorization: `Bearer ${worker!.token}` })).status).toBe(405);
    expect((await post(worker!, `${BASE}/${f.jobId.toUpperCase()}/unsupported`, { ...proof, refusal: "UNSUPPORTED_PROVIDER" })).status).toBe(404);
    expect((await post(worker!, `${BASE}/${f.jobId}/release`, proof)).status).toBe(404);

    // H8: a rejection whose security event cannot be recorded is 503 and changes nothing.
    recording.setFailing(true);
    expect((await unsupported(worker!, f.jobId, { ...proof, fencingCounter: proof.fencingCounter + 1 })).status).toBe(503);
    recording.setFailing(false);
    expect(await wholeRow(f.jobId)).toEqual(before);

    // The lease is untouched and still usable.
    expect((await unsupported(worker!, f.jobId, proof)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------

// Pauses a deferral transaction just before its guarded UPDATE, so tests can
// act while it holds its locks.
function pausingPool(onPause: (client: RuntimeClient) => Promise<void>): TransactionalPool {
  return Object.freeze({
    query: pool.query,
    end: async () => {},
    connect: async () => {
      const client = await pool.connect();
      return Object.freeze({
        query: async <Row extends object>(sql: string, params?: unknown[]) => {
          if (sql.startsWith("UPDATE provider_verification_jobs")) await onPause(client);
          return client.query<Row>(sql, params);
        },
        release: (error?: Error) => client.release(error),
      });
    },
  });
}

describe("C: concurrency", () => {
  it("C1: concurrent duplicate deferrals: exactly one 200, one 409, one increment", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await leased(worker!, f.jobId);
    const responses = await Promise.all([unsupported(worker!, f.jobId, proof), unsupported(worker!, f.jobId, proof)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(recording.events.map((event) => [event.type, event.reason])).toEqual([[DEFERRAL_REJECTED, "NOT_LEASED"]]);
    expect((await deferralRow(f.jobId)).count).toBe(1);
  });

  it("C2: deferral against credential grant: exactly one wins", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await leased(worker!, f.jobId);
    const [deferral, granted] = await Promise.all([unsupported(worker!, f.jobId, proof), grant(worker!, f.jobId, proof)]);
    expect([deferral.status, granted.status].sort()).toEqual([200, 409]);
    const row = await deferralRow(f.jobId);
    if (deferral.status === 200) {
      expect(row).toMatchObject({ state: "QUEUED", count: 1, credential_granted_at: null });
      expect(recording.events.at(-1)).toMatchObject({ type: "WORKER_PROVIDER_VERIFICATION_GRANT_REJECTED", reason: "NOT_LEASED" });
    } else {
      expect(row).toMatchObject({ state: "LEASED", count: 0, refusal: null, deferred_until: null });
      expect(row.credential_granted_at).not.toBeNull();
      expect(recording.events.at(-1)).toMatchObject({ type: DEFERRAL_REJECTED, reason: "CREDENTIAL_GRANTED" });
    }
  });

  it("C3/L3: liveness is judged at transaction start; the reconciler then has nothing to requeue", async () => {
    const [worker] = await workers(1);
    const f = await fixture();
    const token = randomBytes(32).toString("base64url");
    const fence = await ownerLease(f.jobId, worker!, token, 600);
    const expiresAt = (await one<{ at: string }>("SELECT lease_expires_at::text AS at FROM provider_verification_jobs WHERE id = $1", [f.jobId])).at;
    // The deferral begins before expiry and reaches its UPDATE only after it.
    const deferral = await deferUnsupportedProviderVerification(
      pausingPool(() => waitForDatabaseTimePast(expiresAt)),
      contextOf(worker!),
      f.jobId,
      { fencingCounter: fence, leaseToken: token },
      "UNSUPPORTED_PROVIDER",
    );
    expect(deferral.state).toBe("QUEUED");
    expect((await one<{ committed_after_expiry: boolean }>(
      "SELECT updated_at < $2::timestamptz AND clock_timestamp() > $2::timestamptz AS committed_after_expiry FROM provider_verification_jobs WHERE id = $1",
      [f.jobId, expiresAt],
    )).committed_after_expiry).toBe(true);
    expect(await reconcileProviderVerificationJobs(pool, { correlationId: randomUUID() })).toEqual({ cancelledJobs: 0, requeuedJobs: 0, completedJobs: 0 });
    expect(await deferralRow(f.jobId)).toMatchObject({ state: "QUEUED", count: 1 });

    // A deferral that starts after expiry is LEASE_EXPIRED; natural expiry then requeues with the columns unchanged.
    const g = await fixture();
    const lateToken = randomBytes(32).toString("base64url");
    const lateFence = await ownerLease(g.jobId, worker!, lateToken, 200);
    await waitForDatabaseTimePast((await one<{ at: string }>("SELECT lease_expires_at::text AS at FROM provider_verification_jobs WHERE id = $1", [g.jobId])).at);
    await expect(deferUnsupportedProviderVerification(pool, contextOf(worker!), g.jobId, { fencingCounter: lateFence, leaseToken: lateToken }, "UNSUPPORTED_PROVIDER")).rejects.toMatchObject({
      code: "LEASE_REJECTED",
      reason: "LEASE_EXPIRED",
    });
    expect(await reconcileProviderVerificationJobs(pool, { correlationId: randomUUID() })).toEqual({ cancelledJobs: 0, requeuedJobs: 1, completedJobs: 0 });
    expect(await deferralRow(g.jobId)).toMatchObject({ state: "QUEUED", count: 0, refusal: null, deferred_until: null });
  });

  it("C4: deferral against lifecycle cancellation is serialised without deadlock; cancellation stays authoritative", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await leased(worker!, f.jobId);
    await disconnect(f);
    const [deferral, pass] = await Promise.all([
      unsupported(worker!, f.jobId, proof),
      reconcileProviderVerificationJobs(pool, { correlationId: randomUUID() }),
    ]);
    expect([200, 409]).toContain(deferral.status);
    let row = await deferralRow(f.jobId);
    if (row.state !== "CANCELLED") {
      // The deferral committed first; the next pass cancels the deferred job.
      expect(pass.cancelledJobs).toBe(0);
      expect(await reconcileProviderVerificationJobs(pool, { correlationId: randomUUID() })).toMatchObject({ cancelledJobs: 1 });
      row = await deferralRow(f.jobId);
    }
    expect(row).toMatchObject({ state: "CANCELLED", terminal_reason_code: "LIFECYCLE_NO_LONGER_ELIGIBLE" });
    if (deferral.status === 200) expect(row).toMatchObject({ count: 1, refusal: "UNSUPPORTED_PROVIDER" });
    else expect(row).toMatchObject({ count: 0, refusal: null });
  });

  it("C5: the deferral transaction takes no Account, owner, connection, credential-version or audit lock", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await leased(worker!, f.jobId);
    let locked: string[] = [];
    await deferUnsupportedProviderVerification(
      pausingPool(async (client) => {
        const pid = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
        locked = (
          await clients.migrator.query<{ relation: string }>(
            "SELECT DISTINCT relation::regclass::text AS relation FROM pg_locks WHERE pid = $1 AND locktype = 'relation' ORDER BY 1",
            [pid],
          )
        ).rows.map((row) => row.relation);
      }),
      contextOf(worker!),
      f.jobId,
      proof,
      "UNSUPPORTED_POLICY",
    );
    expect(locked).toContain("provider_verification_jobs");
    expect(locked).toContain("worker_principals");
    expect(locked.filter((relation) => /^(accounts|users|provider_connections|provider_credential_versions|audit_events)/.test(relation))).toEqual([]);
  });

  it("C6: after a re-lease, an old proof is FENCING_MISMATCH under the same worker's new lease and OTHER_WORKER under another's", async () => {
    const [first, second] = await begin(2);
    const f = await fixture();
    const expireAndRequeue = async () => {
      await waitForDatabaseTimePast((await one<{ at: string }>("SELECT lease_expires_at::text AS at FROM provider_verification_jobs WHERE id = $1", [f.jobId])).at);
      expect(await reconcileProviderVerificationJobs(pool, { correlationId: randomUUID() })).toEqual({ cancelledJobs: 0, requeuedJobs: 1, completedJobs: 0 });
    };
    const oldToken = randomBytes(32).toString("base64url");
    const oldFence = await ownerLease(f.jobId, first!, oldToken, 200);
    await expireAndRequeue();

    // The same worker holds a newer lease: its stale proof fails the fence.
    const newerFence = await ownerLease(f.jobId, first!, randomBytes(32).toString("base64url"), 200);
    expect(newerFence).toBe(oldFence + 1);
    expectRejected(await unsupported(first!, f.jobId, { fencingCounter: oldFence, leaseToken: oldToken }), "FENCING_MISMATCH", f.jobId, first!.id);
    await expireAndRequeue();

    // Another worker holds the lease: the stale proof fails ownership first.
    const secondProof = await leased(second!, f.jobId);
    const before = await wholeRow(f.jobId);
    expectRejected(await unsupported(first!, f.jobId, { fencingCounter: oldFence, leaseToken: oldToken }), "OTHER_WORKER", f.jobId, first!.id);
    expect(await wholeRow(f.jobId)).toEqual(before);
    expect((await unsupported(second!, f.jobId, secondProof)).status).toBe(200);
    expect(await deferralRow(f.jobId)).toMatchObject({ state: "QUEUED", count: 1, fence: String(oldFence + 2) });
  });
});

// ---------------------------------------------------------------------------
// R1: controlled transaction overlap for C1, C2 and C4. The C1, C2 and C4
// tests above schedule their competitors with Promise.all, which does not
// prove the transactions overlapped; they remain as supplementary coverage.
// The tests below force the overlap and prove, from a separate observer
// connection, that the competitor waited on the holder's transaction.

const OVERLAP_WAIT_MS = 10_000;
const OVERLAP_POLL_MS = 20;

// Polls a condition within a finite deadline. Each poll interval is awaited to
// completion, so no timer outlives the call. A timeout fails the test: it is
// never evidence of correct serialisation.
async function waitFor(what: string, condition: () => boolean | Promise<boolean>, timeoutMs = OVERLAP_WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error(`OVERLAP NOT ESTABLISHED: ${what} within ${timeoutMs} ms`);
    await new Promise<void>((resolve) => setTimeout(resolve, OVERLAP_POLL_MS));
  }
}

// Observes settlement without changing the outcome. Attaching both handlers
// here also keeps a rejection from ever being reported as unhandled; awaiting
// the original promise later still rethrows it.
function track(promise: Promise<unknown>): { settled: boolean } {
  const state = { settled: false };
  promise.then(
    () => {
      state.settled = true;
    },
    () => {
      state.settled = true;
    },
  );
  return state;
}

const isJobUpdate = (sql: string) => sql.trimStart().startsWith("UPDATE provider_verification_jobs");

type ControlledPool = Readonly<{
  pool: TransactionalPool;
  // The backend PID of every connection this pool handed out, in connect order.
  pids: readonly number[];
  // Once armed, the first transaction issuing a statement that matches pauseOn
  // is held immediately before that statement, with every lock it took earlier.
  arm: () => void;
  // The backend PID of the held connection, once it is held.
  holderPid: () => number | undefined;
  release: () => void;
}>;

// Test-only instrumentation over the real runtime pool. The PID probe is an
// autocommit statement issued before the caller's BEGIN, so it neither starts
// nor joins the caller's transaction. No production code exposes a PID.
function controlledPool(base: TransactionalPool, pauseOn: (sql: string) => boolean = () => false): ControlledPool {
  const pids: number[] = [];
  let armed = false;
  let held = false;
  let holder: number | undefined;
  let releaseGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const controlled: TransactionalPool = Object.freeze({
    query: <Row extends object>(sql: string, params?: unknown[]) => base.query<Row>(sql, params),
    end: async () => {},
    connect: async () => {
      const client = await base.connect();
      let pid: number;
      try {
        pid = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      } catch (error) {
        client.release(error instanceof Error ? error : new Error("backend PID probe failed"));
        throw error;
      }
      pids.push(pid);
      return Object.freeze({
        query: async <Row extends object>(sql: string, params?: unknown[]) => {
          if (armed && !held && pauseOn(sql)) {
            held = true;
            holder = pid;
            await gate;
          }
          return client.query<Row>(sql, params);
        },
        release: (error?: Error) => client.release(error),
      });
    },
  });
  return Object.freeze({
    pool: controlled,
    pids,
    arm: () => {
      armed = true;
    },
    holderPid: () => holder,
    release: () => releaseGate(),
  });
}

// Observer: a connection distinct from both participants (the migrator).
const blockedBy = async (waiterPid: number, holderPid: number) =>
  (await one<{ blocked: boolean }>("SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS blocked", [waiterPid, holderPid])).blocked;

type Overlap<H, W> = Readonly<{ held: H; competing: W; holderPid: number; waiterPid: number }>;

// 1. Starts the holder and waits until it is held, after its FOR UPDATE job
//    lock and before its state-changing UPDATE.
// 2. Starts the competitor, which must check out a new, distinct connection.
// 3. Proves from the observer that pg_blocking_pids(waiter) contains the
//    holder while neither operation has settled.
// 4. Releases the holder, always (finally), and settles both operations
//    before returning or rethrowing.
async function overlap<H, W>(
  holderPool: ControlledPool,
  startHolder: () => Promise<H>,
  competitorPool: ControlledPool,
  startCompetitor: () => Promise<W>,
): Promise<Overlap<H, W>> {
  const held = startHolder();
  const heldState = track(held);
  let competing: Promise<W> | undefined;
  let holderPid: number | undefined;
  let waiterPid: number | undefined;
  try {
    await waitFor("the holder paused while holding the job lock", () => holderPool.holderPid() !== undefined || heldState.settled);
    expect(heldState.settled, "the holder settled instead of pausing").toBe(false);
    holderPid = holderPool.holderPid()!;

    const connectionsBefore = competitorPool.pids.length;
    competing = startCompetitor();
    const competingState = track(competing);
    await waitFor("the competitor checked out its own connection", () => competitorPool.pids.length > connectionsBefore || competingState.settled);
    expect(competingState.settled, "the competitor settled before checking out a connection").toBe(false);
    waiterPid = competitorPool.pids[connectionsBefore]!;
    expect(waiterPid).not.toBe(holderPid);

    const waiter = waiterPid;
    const holderBackend = holderPid;
    await waitFor("pg_blocking_pids(waiter) to contain the holder", async () => competingState.settled || (await blockedBy(waiter, holderBackend)));
    expect(competingState.settled, "the competitor completed while the holder still held the job lock").toBe(false);
    expect(heldState.settled, "the holder settled while paused").toBe(false);
  } finally {
    holderPool.release();
    await Promise.allSettled([held, competing ?? Promise.resolve()]);
  }
  return Object.freeze({ held: await held, competing: await competing!, holderPid: holderPid!, waiterPid: waiterPid! });
}

describe("C (controlled overlap): competitors proven to wait on the holder's transaction", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  beforeEach(() => {
    unhandled.length = 0;
    process.on("unhandledRejection", onUnhandled);
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    process.removeListener("unhandledRejection", onUnhandled);
    expect(unhandled).toEqual([]);
  });

  it("C1: a duplicate deferral waits on the first deferral's job lock, then is NOT_LEASED; exactly one increment", async () => {
    const [worker] = await workers(1);
    const router = controlledPool(pool);
    await start([worker!], router.pool);
    const f = await fixture();
    const proof = await leased(worker!, f.jobId);
    const auditsBefore = await auditCount();

    const holder = controlledPool(pool, isJobUpdate);
    holder.arm();
    const { held, competing, holderPid } = await overlap(
      holder,
      () => deferUnsupportedProviderVerification(holder.pool, contextOf(worker!), f.jobId, proof, "UNSUPPORTED_POLICY"),
      router,
      () => unsupported(worker!, f.jobId, proof, "UNSUPPORTED_PROVIDER"),
    );

    expect(holder.pids).toEqual([holderPid]);
    expect(held).toMatchObject({ providerVerificationJobId: f.jobId, fencingCounter: proof.fencingCounter, state: "QUEUED" });
    expectRejected(competing, "NOT_LEASED", f.jobId, worker!.id);
    expect(recording.events).toHaveLength(1);

    const row = await deferralRow(f.jobId);
    expect(row).toMatchObject({
      state: "QUEUED",
      count: 1,
      refusal: "UNSUPPORTED_POLICY",
      fence: String(proof.fencingCounter),
      offset: 300,
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      leased_at: null,
      lease_expires_at: null,
      credential_granted_at: null,
      verifying_at: null,
      result_outcome: null,
      terminal_reason_code: null,
      completed_at: null,
    });
    expect(row.deferred_until).toEqual(held.deferredUntil);
    expect(await auditCount()).toBe(auditsBefore);
  });

  it("C2-A: deferral wins; the credential grant waits on its job lock, then is NOT_LEASED and records no grant", async () => {
    const [worker] = await workers(1);
    const router = controlledPool(pool);
    await start([worker!], router.pool);
    const f = await fixture();
    const proof = await leased(worker!, f.jobId);
    const auditsBefore = await auditCount();

    const holder = controlledPool(pool, isJobUpdate);
    holder.arm();
    const { held, competing } = await overlap(
      holder,
      () => deferUnsupportedProviderVerification(holder.pool, contextOf(worker!), f.jobId, proof, "UNSUPPORTED_PROVIDER"),
      router,
      () => grant(worker!, f.jobId, proof),
    );

    expect(held).toMatchObject({ providerVerificationJobId: f.jobId, fencingCounter: proof.fencingCounter, state: "QUEUED" });
    expect(competing.status).toBe(409);
    expect(competing.body).toBe(REJECTED);
    expect(recording.events).toHaveLength(1);
    expect(recording.events[0]).toMatchObject({
      type: "WORKER_PROVIDER_VERIFICATION_GRANT_REJECTED",
      reason: "NOT_LEASED",
      providerVerificationJobId: f.jobId,
      workerPrincipalId: worker!.id,
    });

    const row = await deferralRow(f.jobId);
    expect(row).toMatchObject({
      state: "QUEUED",
      count: 1,
      refusal: "UNSUPPORTED_PROVIDER",
      fence: String(proof.fencingCounter),
      offset: 300,
      credential_granted_at: null,
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      leased_at: null,
      lease_expires_at: null,
      completed_at: null,
      terminal_reason_code: null,
    });
    expect(await auditCount()).toBe(auditsBefore);
  });

  it("C2-B: credential grant wins; the deferral waits on its job lock, then is CREDENTIAL_GRANTED and writes nothing", async () => {
    const [worker] = await workers(1);
    // The router's grant is the holder: armed only after the lease, so the
    // lease's own UPDATE is never held.
    const router = controlledPool(pool, isJobUpdate);
    await start([worker!], router.pool);
    const f = await fixture();
    const proof = await leased(worker!, f.jobId);
    const leasedRow = await wholeRow(f.jobId);
    const auditsBefore = await auditCount();

    router.arm();
    const { held, competing } = await overlap(
      router,
      () => grant(worker!, f.jobId, proof),
      router,
      () => unsupported(worker!, f.jobId, proof, "UNSUPPORTED_POLICY"),
    );

    expect(held.status).toBe(200);
    expect(json(held)).toMatchObject({ providerVerificationJobId: f.jobId, fencingCounter: proof.fencingCounter });
    expectRejected(competing, "CREDENTIAL_GRANTED", f.jobId, worker!.id);
    expect(recording.events).toHaveLength(1);

    const row = await deferralRow(f.jobId);
    expect(row).toMatchObject({
      state: "LEASED",
      count: 0,
      refusal: null,
      deferred_until: null,
      fence: String(proof.fencingCounter),
      lease_worker_principal_id: worker!.id,
      lease_token_sha256: sha256Hex(proof.leaseToken),
      verifying_at: null,
      completed_at: null,
      terminal_reason_code: null,
    });
    expect(row.credential_granted_at).not.toBeNull();
    expect(row.leased_at).toEqual(leasedRow.leased_at);
    expect(row.lease_expires_at).toEqual(leasedRow.lease_expires_at);
    expect(await auditCount()).toBe(auditsBefore);

    // The lease proof is still enforced ahead of the grant check on the granted lease.
    const grantedBefore = await wholeRow(f.jobId);
    expectRejected(await unsupported(worker!, f.jobId, { ...proof, leaseToken: randomBytes(32).toString("base64url") }), "TOKEN_MISMATCH", f.jobId, worker!.id);
    expectRejected(await unsupported(worker!, f.jobId, proof), "CREDENTIAL_GRANTED", f.jobId, worker!.id);
    expect(await wholeRow(f.jobId)).toEqual(grantedBefore);
    expect(JSON.stringify(recording.events).includes(proof.leaseToken)).toBe(false);
  });

  it("C4: the reconciler completes while the deferral holds the job lock, skips it (SKIP LOCKED), then cancels it on the next pass", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await leased(worker!, f.jobId);
    await disconnect(f);
    const auditsBefore = await auditCount();

    const holder = controlledPool(pool, isJobUpdate);
    holder.arm();
    const reconciler = controlledPool(pool);
    const deferral = deferUnsupportedProviderVerification(holder.pool, contextOf(worker!), f.jobId, proof, "UNSUPPORTED_PROVIDER");
    const deferralState = track(deferral);
    let pass: ReturnType<typeof reconcileProviderVerificationJobs> | undefined;
    try {
      await waitFor("the deferral paused while holding the job lock", () => holder.holderPid() !== undefined || deferralState.settled);
      expect(deferralState.settled, "the deferral settled instead of pausing").toBe(false);
      const holderPid = holder.holderPid()!;

      pass = reconcileProviderVerificationJobs(reconciler.pool, { correlationId: randomUUID() });
      const passState = track(pass);
      await waitFor("the reconciler pass to complete while the deferral holds the job lock", () => passState.settled);
      expect(deferralState.settled, "the deferral settled before release").toBe(false);
      expect(reconciler.pids.length).toBeGreaterThan(0);
      expect(reconciler.pids).not.toContain(holderPid);
      expect(await pass).toEqual({ cancelledJobs: 0, requeuedJobs: 0, completedJobs: 0 });
      expect((await one<{ state: string }>("SELECT state FROM provider_verification_jobs WHERE id = $1", [f.jobId])).state).toBe("LEASED");
    } finally {
      holder.release();
      await Promise.allSettled([deferral, pass ?? Promise.resolve()]);
    }

    const deferred = await deferral;
    expect(deferred).toMatchObject({ providerVerificationJobId: f.jobId, fencingCounter: proof.fencingCounter, state: "QUEUED" });
    const queued = await deferralRow(f.jobId);
    expect(queued).toMatchObject({ state: "QUEUED", count: 1, refusal: "UNSUPPORTED_PROVIDER", offset: 300, lease_worker_principal_id: null, lease_token_sha256: null });
    // The deferral itself writes no audit row and makes nothing terminal.
    expect(await auditCount()).toBe(auditsBefore);
    expect(queued).toMatchObject({ completed_at: null, terminal_reason_code: null });

    expect(await reconcileProviderVerificationJobs(pool, { correlationId: randomUUID() })).toEqual({ cancelledJobs: 1, requeuedJobs: 0, completedJobs: 0 });
    const cancelled = await deferralRow(f.jobId);
    expect(cancelled).toMatchObject({
      state: "CANCELLED",
      terminal_reason_code: "LIFECYCLE_NO_LONGER_ELIGIBLE",
      count: 1,
      refusal: "UNSUPPORTED_PROVIDER",
      fence: String(proof.fencingCounter),
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      leased_at: null,
      lease_expires_at: null,
      credential_granted_at: null,
      result_outcome: null,
    });
    expect(cancelled.deferred_until).toEqual(queued.deferred_until);
  });
});
