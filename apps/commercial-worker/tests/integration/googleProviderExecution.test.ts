import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GoogleGenAI } from "@google/genai";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../../commercial-api/src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type TransactionalPool } from "../../../commercial-api/src/database/runtimePool.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../../commercial-api/src/startCommercialApiServer.js";
import { createWorkerControlApplication } from "../../../commercial-api/src/workerControl/workerControlApplication.js";
import { insertAccountWithFreeGrant, openGuardedClients, prepareSchemaV1, type GuardedClients } from "../../../commercial-api/tests/db/support/testDatabase.js";
import { createTestWorkerAuthenticationAdapter } from "../../../commercial-api/tests/support/testWorkerAuthentication.js";
import { createRecordingWorkerSecurityEventSink } from "../../../commercial-api/tests/support/testWorkerSecurityEvents.js";
import type { RecoverySleep } from "../../src/acceptanceRecoveryPolicy.js";
import type { CredentialOpener } from "../../src/credentialContracts.js";
import { runGoogleProviderAttemptOnce, type GoogleProviderAttemptDependencies } from "../../src/googleAttemptExecution.js";
import { createHostFaultLatch } from "../../src/hostFaultLatch.js";
import type { DeadlineTimer } from "../../src/preProviderOrchestration.js";
import { createHttpWorkerControlClient } from "../../src/workerControlClient.js";
import type { WorkerConfig } from "../../src/workerConfig.js";
import { WorkerError } from "../../src/workerError.js";
import { createInMemoryObjectStore } from "../support/inMemoryObjectStore.js";
import { createTestCredentialFingerprinter, createTestCredentialOpener, createTestCredentialSealer, generateTestKey } from "../support/testCredentialOpening.js";

// R44B10A tier 3: the production real Google composer, the real
// WorkerControlClient over HTTP to the real commercial-api router on
// PostgreSQL 16, a real development journal, the test-only in-memory object
// store and the ACTUAL @google/genai 2.24.0 client whose transport is an
// injected local counting fetch. No request ever leaves the process: the
// control-plane transport refuses every other origin and the provider
// transport answers locally. No polling, output or completion exists.

let clients: GuardedClients;
let pool: TransactionalPool;
let server: RunningCommercialApiServer | undefined;
let stateRoot: string;

const encryptionKey = generateTestKey("google-execution-encryption/v1");
const sealer = createTestCredentialSealer(encryptionKey);
const fingerprinter = createTestCredentialFingerprinter(generateTestKey("google-execution-fingerprint/v1"), encryptionKey);
const testOpener = createTestCredentialOpener(encryptionKey);

beforeAll(async () => {
  clients = await openGuardedClients();
  const config = loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl, COMMERCIAL_API_DATABASE_POOL_MAX: "6" }, "development");
  pool = await createRuntimePool(config!, () => {});
});
beforeEach(async () => {
  await prepareSchemaV1(clients);
  stateRoot = await mkdtemp(join(tmpdir(), "busybookie-google-execution-"));
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(stateRoot, { recursive: true, force: true });
});
afterAll(async () => {
  await pool.end();
  await prepareSchemaV1(clients);
  await clients.close();
});

// ---------------------------------------------------------------------------
// Fixtures (committed by the commercial-api owner role)

const PROVIDER = "GOOGLE_GENAI";
const MODEL = "gemini-omni-1.1-flash";
const KEY = "inputs/reference.png";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const INTERACTION_ID = "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi1pbnQ";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const generationRequest = () => ({ prompt: "A red kite over a quiet harbour.", referenceImage: { key: KEY, sha256: sha(PNG), byteCount: PNG.length, contentType: "image/png" }, resolution: "720p" });
// R44B11A: the canonical hash of exactly the seeded request (RFC 8785 text,
// hashed with sha256sum outside the code under test), as an issuer would store it.
const SEEDED_REQUEST_SHA256 = "34a2c546aa68163530865f1f7b878df24091d37cdeb5206ecb5893017bb4a44f";

const q = <T extends object>(sql: string, params: unknown[]) => clients.migrator.query<T>(sql, params).then((result) => result.rows[0]!);

type Work = Readonly<{ accountId: string; attemptId: string; jobId: string; plaintext: string }>;

async function work(): Promise<Work> {
  const owner = await insertAccountWithFreeGrant(clients.migrator, `google-execution-${randomUUID()}`);
  const production = await q<{ id: string }>(
    "INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id) VALUES ($1, 'Production', $2, $3) RETURNING id",
    [owner.accountId, owner.grantId, owner.userId],
  );
  const connection = await q<{ id: string }>(
    "INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id) VALUES ($1, $2, 'API_KEY', $3) RETURNING id",
    [owner.accountId, PROVIDER, owner.userId],
  );
  const plaintext = `fixture-credential-${randomBytes(18).toString("hex")}`;
  const envelope = await sealer.seal(plaintext, { accountId: owner.accountId, providerConnectionId: connection.id, provider: PROVIDER, credentialVersion: 1, purpose: "provider-credential" });
  const fingerprint = await fingerprinter.fingerprint(plaintext);
  const version = await q<{ id: string }>(
    `INSERT INTO provider_credential_versions (account_id, provider_connection_id, credential_version, sealed_credential, fingerprint_algorithm,
                                               fingerprint_key_ref, fingerprint_value, created_by_user_id)
     VALUES ($1, $2, 1, $3::jsonb, $4, $5, $6, $7) RETURNING id`,
    [owner.accountId, connection.id, JSON.stringify(envelope), fingerprint.algorithm, fingerprint.keyRef, fingerprint.value, owner.userId],
  );
  const authorization = await q<{ id: string }>(
    `INSERT INTO generation_authorizations
       (account_id, production_id, entitlement_grant_id, billing_mode, provider, model, provider_connection_id,
        provider_credential_version_id, generation_request, generation_request_sha256, expected_cost_cap_unit,
        expected_cost_cap_amount, expires_at, created_by_user_id)
     VALUES ($1, $2, $3, 'USER_BYO', $4, $5, $6, $7, $8::jsonb, $10,
             'MICRO_USD', 2000000, now() + interval '15 minutes', $9) RETURNING id`,
    [owner.accountId, production.id, owner.grantId, PROVIDER, MODEL, connection.id, version.id, JSON.stringify(generationRequest()), owner.userId, SEEDED_REQUEST_SHA256],
  );
  await clients.migrator.query("UPDATE generation_authorizations SET status = 'CLAIMED', claimed_at = now() WHERE id = $1", [authorization.id]);
  const job = await q<{ id: string }>(
    "INSERT INTO execution_jobs (account_id, production_id, generation_authorization_id) VALUES ($1, $2, $3) RETURNING id",
    [owner.accountId, production.id, authorization.id],
  );
  const attempt = await q<{ id: string }>(
    `INSERT INTO execution_attempts (account_id, execution_job_id, generation_authorization_id, attempt_number, billing_mode, provider, provider_credential_version_id)
     VALUES ($1, $2, $3, 1, 'USER_BYO', $4, $5) RETURNING id`,
    [owner.accountId, job.id, authorization.id, PROVIDER, version.id],
  );
  return { accountId: owner.accountId, attemptId: attempt.id, jobId: job.id, plaintext };
}

type Machine = Readonly<{ id: string; credential: string }>;

async function machine(label = "google-execution-worker"): Promise<Machine> {
  const id = (await clients.migrator.query<{ id: string }>("INSERT INTO worker_principals (label) VALUES ($1) RETURNING id", [label])).rows[0]!.id;
  return { id, credential: `fixture-machine-${randomBytes(16).toString("hex")}` };
}

async function controlPlane(list: readonly Machine[]): Promise<string> {
  const recording = createRecordingWorkerSecurityEventSink();
  const application = createWorkerControlApplication({
    authentication: createTestWorkerAuthenticationAdapter(list.map((worker) => ({ token: worker.credential, workerPrincipalId: worker.id }))),
    securityEvents: recording.sink,
    pool,
    reportFailure: () => {},
  });
  server = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { application, checkReadiness: async () => true } });
  return `http://127.0.0.1:${server.port}`;
}

const attemptRow = async (id: string) =>
  (
    await clients.migrator.query<{
      state: string;
      failure_code: string | null;
      provider_execution_id: string | null;
      submitting_at: Date | null;
      lease_worker_principal_id: string | null;
    }>("SELECT state, failure_code, provider_execution_id, submitting_at, lease_worker_principal_id FROM execution_attempts WHERE id = $1", [id])
  ).rows[0]!;
const jobStatus = async (id: string) => (await clients.migrator.query<{ status: string }>("SELECT status FROM execution_jobs WHERE id = $1", [id])).rows[0]!.status;
const auditTypes = async (id: string) =>
  (await clients.migrator.query<{ event_type: string }>("SELECT event_type FROM audit_events WHERE resource_id = $1 ORDER BY sequence", [id])).rows.map(({ event_type }) => event_type);
const allAuditText = async () => (await clients.migrator.query<{ text: string | null }>("SELECT string_agg(audit_events::text, '\n') AS text FROM audit_events")).rows[0]!.text ?? "";
const recordFiles = async () => (await readdir(join(stateRoot, "acceptance-journal", "v1")).catch(() => [] as string[])).sort();
const expireLease = (attemptId: string) =>
  clients.migrator.query(
    "UPDATE execution_attempts SET leased_at = now() - interval '10 minutes', heartbeat_at = now() - interval '10 minutes', lease_expires_at = now() - interval '1 second' WHERE id = $1",
    [attemptId],
  );

type ProviderAnswer = (request: Request) => Response | Promise<Response>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// One worker run with the real control client (origin-checked), the in-memory
// store seeded for the account, and the real SDK behind a counting transport.
function workerRun(baseUrl: string, worker: Machine, item: Work, options: Partial<{ answer: ProviderAnswer; openerFailOn: number; seed: boolean }> = {}) {
  const origin = new URL(baseUrl).origin;
  const controlRoutes: string[] = [];
  const offOrigin: string[] = [];
  const controlFetch = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    if (new URL(url).origin !== origin) {
      offOrigin.push(url);
      throw new Error("off-origin request refused by the test transport");
    }
    const response = await fetch(input, init);
    controlRoutes.push(url.slice(origin.length).replace(/[0-9a-f-]{36}/g, ":id"));
    return response;
  }) as typeof fetch;

  const counts = { constructed: 0, dispatched: 0 };
  const providerUrls: string[] = [];
  const answer = options.answer ?? (() => json(200, { id: INTERACTION_ID, status: "in_progress" }));
  class CountingGoogleGenAI extends GoogleGenAI {
    constructor(clientOptions: ConstructorParameters<typeof GoogleGenAI>[0]) {
      super(clientOptions);
      counts.constructed += 1;
    }
  }
  // The local provider transport: counted, answered here, never the network.
  const providerTransport = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    counts.dispatched += 1;
    providerUrls.push(request.url);
    return answer(request);
  }) as typeof fetch;

  const memory = createInMemoryObjectStore();
  if (options.seed !== false) memory.seed(item.accountId, KEY, PNG);
  const opened = { count: 0 };
  const opener: CredentialOpener = {
    open: async (sealed, context) => {
      opened.count += 1;
      if (opened.count === options.openerFailOn) throw new Error("opener failure");
      return testOpener.open(sealed, context);
    },
  };
  const deadlineTimer: DeadlineTimer = () => () => {};
  const keeperSleep: RecoverySleep = (_ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  const latch = createHostFaultLatch();
  const dependencies: GoogleProviderAttemptDependencies = {
    environment: {},
    client: createHttpWorkerControlClient({ baseUrl, machineCredential: worker.credential, fetchImpl: controlFetch }),
    opener,
    latch,
    store: memory.store,
    provider: { transport: providerTransport, clientConstructor: CountingGoogleGenAI as unknown as typeof GoogleGenAI },
    deadlineTimer,
    keeperSleep,
  };
  return { dependencies, counts, providerUrls, controlRoutes, offOrigin, latch, opened, memory };
}

const development = (): WorkerConfig => Object.freeze({ mode: "development", stateRoot });

// ---------------------------------------------------------------------------

describe("tier 3: accepted", () => {
  it("leases, admits, grants, verifies, permits, re-opens, constructs and dispatches once, and reaches SUBMITTED with the raw Interaction.id", async () => {
    const worker = await machine();
    const item = await work();
    const baseUrl = await controlPlane([worker]);
    const run = workerRun(baseUrl, worker, item);
    const result = await runGoogleProviderAttemptOnce(development(), run.dependencies);

    expect(result).toEqual({ status: "SUBMITTED", executionAttemptId: item.attemptId });
    expect(run.counts).toEqual({ constructed: 1, dispatched: 1 });
    expect(run.providerUrls).toEqual(["https://generativelanguage.googleapis.com/v1beta/interactions"]);
    expect(run.opened.count).toBe(2);
    expect(run.controlRoutes).toEqual([
      "/worker-control/v1/leases",
      "/worker-control/v1/attempts/:id/credential-grant",
      "/worker-control/v1/attempts/:id/submitting",
      "/worker-control/v1/attempts/:id/heartbeat",
      "/worker-control/v1/attempts/:id/submitted",
    ]);
    expect(run.offOrigin).toEqual([]);
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "SUBMITTED", provider_execution_id: INTERACTION_ID });
    expect(await jobStatus(item.jobId)).toBe("RUNNING");
    expect((await recordFiles()).length).toBe(1);
    expect(run.latch.isTripped()).toBe(false);
    // No polling, output or completion: nothing after SUBMITTED.
    expect(await auditTypes(item.attemptId)).toEqual(["execution_attempt.leased", "execution_attempt.credential_granted", "execution_attempt.submitting", "execution_attempt.submitted"]);
    expect((await allAuditText()).includes(item.plaintext)).toBe(false);
  });
});

describe("tier 3: typed provider failures", () => {
  it("records a definitive pre-ID rejection as FAILED_BEFORE_SUBMISSION with the job FAILED, one dispatch, no journal record and no latch", async () => {
    const worker = await machine();
    const item = await work();
    const baseUrl = await controlPlane([worker]);
    const run = workerRun(baseUrl, worker, item, { answer: () => json(400, { error: { code: "invalid_request", message: "detail" } }) });
    const result = await runGoogleProviderAttemptOnce(development(), run.dependencies);
    expect(result).toEqual({ status: "PROVIDER_FAILURE_REPORTED", executionAttemptId: item.attemptId, outcome: "DEFINITIVE_FAILURE", state: "FAILED_BEFORE_SUBMISSION" });
    expect(run.counts).toEqual({ constructed: 1, dispatched: 1 });
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "FAILED_BEFORE_SUBMISSION", failure_code: "PROVIDER_REJECTED_DEFINITIVELY", provider_execution_id: null });
    expect(await jobStatus(item.jobId)).toBe("FAILED");
    expect(await recordFiles()).toEqual([]);
    expect(run.latch.isTripped()).toBe(false);
    expect((await auditTypes(item.attemptId)).filter((type) => type === "execution_attempt.failed_before_submission")).toHaveLength(1);
  });

  it("records an ambiguous outcome as OUTCOME_UNKNOWN with the job NEEDS_ATTENTION, one dispatch and no fabricated ID", async () => {
    const worker = await machine();
    const item = await work();
    const baseUrl = await controlPlane([worker]);
    const run = workerRun(baseUrl, worker, item, {
      answer: () => {
        throw new DOMException("timeout", "TimeoutError");
      },
    });
    const result = await runGoogleProviderAttemptOnce(development(), run.dependencies);
    expect(result).toEqual({ status: "PROVIDER_FAILURE_REPORTED", executionAttemptId: item.attemptId, outcome: "AMBIGUOUS_FAILURE", state: "OUTCOME_UNKNOWN" });
    expect(run.counts).toEqual({ constructed: 1, dispatched: 1 });
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "OUTCOME_UNKNOWN", failure_code: "PROVIDER_SUBMISSION_AMBIGUOUS", provider_execution_id: null });
    expect(await jobStatus(item.jobId)).toBe("NEEDS_ATTENTION");
    expect(await recordFiles()).toEqual([]);
    expect((await auditTypes(item.attemptId)).filter((type) => type === "execution_attempt.outcome_unknown")).toHaveLength(1);
  });
});

describe("tier 3: input media and pre-dispatch faults", () => {
  it("reports a missing reference image through input-failed with no permit, client or dispatch", async () => {
    const worker = await machine();
    const item = await work();
    const baseUrl = await controlPlane([worker]);
    const run = workerRun(baseUrl, worker, item, { seed: false });
    const result = await runGoogleProviderAttemptOnce(development(), run.dependencies);
    expect(result).toEqual({
      status: "STOPPED_ON_INPUT_MEDIA",
      executionAttemptId: item.attemptId,
      input: { status: "PERMANENT_INPUT_REPORTED", failureCode: "INPUT_OBJECT_NOT_FOUND" },
    });
    expect(run.counts).toEqual({ constructed: 0, dispatched: 0 });
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "FAILED_BEFORE_SUBMISSION", failure_code: "INPUT_OBJECT_NOT_FOUND", submitting_at: null });
    expect(await jobStatus(item.jobId)).toBe("FAILED");
  });

  it("latches a post-permit re-open failure with no dispatch or report; the expiry sweep converges to OUTCOME_UNKNOWN", async () => {
    const list = [await machine("google-a"), await machine("google-b")];
    const item = await work();
    const baseUrl = await controlPlane(list);
    const run = workerRun(baseUrl, list[0]!, item, { openerFailOn: 2 });
    await expect(runGoogleProviderAttemptOnce(development(), run.dependencies)).rejects.toMatchObject({ code: "CREDENTIAL_OPEN_FAILED" });
    expect(run.counts).toEqual({ constructed: 0, dispatched: 0 });
    expect(run.latch.isTripped()).toBe(true);
    expect(run.controlRoutes.some((route) => route.endsWith("/submission-failed"))).toBe(false);
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "SUBMITTING" });
    // The authoritative sweep, run by another worker's lease request, converges it.
    await expireLease(item.attemptId);
    const other = createHttpWorkerControlClient({ baseUrl, machineCredential: list[1]!.credential });
    expect(await other.leaseNextAttempt()).toBeNull();
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "OUTCOME_UNKNOWN", failure_code: "WORKER_LEASE_EXPIRED_DURING_SUBMISSION" });
  });
});

describe("tier 3: lost response and restart", () => {
  it("recovers a lost live submitted response through acceptance recovery, with one dispatch", async () => {
    const worker = await machine();
    const item = await work();
    const baseUrl = await controlPlane([worker]);
    const run = workerRun(baseUrl, worker, item);
    // The submitted report commits but its responses are lost: the live route is
    // treated as unavailable twice and acceptance recovery replays the commit.
    const client = run.dependencies.client;
    let lost = 0;
    const losingClient: GoogleProviderAttemptDependencies["client"] = {
      ...client,
      reportSubmitted: async (...args) => {
        await client.reportSubmitted(...args);
        lost += 1;
        throw new WorkerError("CONTROL_API_UNAVAILABLE");
      },
    };
    const result = await runGoogleProviderAttemptOnce(development(), { ...run.dependencies, client: losingClient });
    expect(result).toEqual({ status: "SUBMITTED", executionAttemptId: item.attemptId });
    expect(lost).toBe(2);
    expect(run.counts).toEqual({ constructed: 1, dispatched: 1 });
    expect(run.controlRoutes.filter((route) => route.endsWith("/acceptance-recovery"))).toHaveLength(1);
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "SUBMITTED", provider_execution_id: INTERACTION_ID });
  });

  it("never re-creates after a restart: the second process reconciles the journal and dispatches nothing", async () => {
    const worker = await machine();
    const item = await work();
    const baseUrl = await controlPlane([worker]);
    const first = workerRun(baseUrl, worker, item);
    await expect(runGoogleProviderAttemptOnce(development(), first.dependencies)).resolves.toMatchObject({ status: "SUBMITTED" });
    const second = workerRun(baseUrl, worker, item);
    // Startup reconciles the retained record through acceptance recovery. The
    // live SUBMITTED lease still holds this worker's single slot (the deferred
    // live-route capacity condition), so the lease request is refused.
    await expect(runGoogleProviderAttemptOnce(development(), second.dependencies)).rejects.toMatchObject({ code: "LEASE_REJECTED" });
    expect(second.controlRoutes).toEqual(["/worker-control/v1/attempts/:id/acceptance-recovery", "/worker-control/v1/leases"]);
    expect(second.counts).toEqual({ constructed: 0, dispatched: 0 });
    expect(first.counts.dispatched + second.counts.dispatched).toBe(1);
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "SUBMITTED", provider_execution_id: INTERACTION_ID });
  });
});
