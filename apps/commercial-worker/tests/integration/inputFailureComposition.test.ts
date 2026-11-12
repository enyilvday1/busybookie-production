import { createHash, randomBytes, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../../commercial-api/src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type TransactionalPool } from "../../../commercial-api/src/database/runtimePool.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../../commercial-api/src/startCommercialApiServer.js";
import { createWorkerControlApplication } from "../../../commercial-api/src/workerControl/workerControlApplication.js";
import { insertAccountWithFreeGrant, openGuardedClients, prepareSchemaV1, type GuardedClients } from "../../../commercial-api/tests/db/support/testDatabase.js";
import { createTestWorkerAuthenticationAdapter } from "../../../commercial-api/tests/support/testWorkerAuthentication.js";
import { createRecordingWorkerSecurityEventSink } from "../../../commercial-api/tests/support/testWorkerSecurityEvents.js";
import { createHostFaultLatch } from "../../src/hostFaultLatch.js";
import { handleInputMediaFailure, type InputMediaFailureOutcome } from "../../src/inputMediaFailurePolicy.js";
import { retrieveVerifiedReferenceImage } from "../../src/inputMediaRetrieval.js";
import type { ObjectStore } from "../../src/objectStorageContract.js";
import type { DeadlineTimer } from "../../src/preProviderOrchestration.js";
import { createHttpWorkerControlClient, type LeaseProof, type WorkerControlClient } from "../../src/workerControlClient.js";
import { createTestCredentialFingerprinter, createTestCredentialSealer, generateTestKey } from "../support/testCredentialOpening.js";
import { createInMemoryObjectStore } from "../support/inMemoryObjectStore.js";

// R44B10P2: the TEST-ONLY P1/P2 composition (architecture section 18,
// "input-failed route"; real-provider composition is deferred to R44B10A).
// A granted LEASED attempt goes through input-media retrieval against the
// test-only in-memory store, the closed classification, the caller-side
// failure policy and the real WorkerControlClient over HTTP to the real
// commercial-api worker-control router on PostgreSQL 16. No permit, no
// SUBMITTING, no provider construction or dispatch: every outbound request
// is recorded and only the lease, grant and input-failed routes appear.

let clients: GuardedClients;
let pool: TransactionalPool;
let server: RunningCommercialApiServer | undefined;

const encryptionKey = generateTestKey("input-composition-encryption/v1");
const sealer = createTestCredentialSealer(encryptionKey);
const fingerprinter = createTestCredentialFingerprinter(generateTestKey("input-composition-fingerprint/v1"), encryptionKey);

beforeAll(async () => {
  clients = await openGuardedClients();
  const config = loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl, COMMERCIAL_API_DATABASE_POOL_MAX: "6" }, "development");
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
// Fixtures (committed by the commercial-api owner role)

const q = <T extends object>(sql: string, params: unknown[]) => clients.migrator.query<T>(sql, params).then((result) => result.rows[0]!);
const PROVIDER = "EXAMPLE_PROVIDER";

type Work = Readonly<{ accountId: string; attemptId: string; jobId: string }>;

async function work(): Promise<Work> {
  const owner = await insertAccountWithFreeGrant(clients.migrator, `input-composition-${randomUUID()}`);
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
     VALUES ($1, $2, $3, 'USER_BYO', $4, 'example-model-1', $5, $6, '{"prompt":"fixture"}'::jsonb, repeat('c', 64),
             'MICRO_USD', 2000000, now() + interval '15 minutes', $7) RETURNING id`,
    [owner.accountId, production.id, owner.grantId, PROVIDER, connection.id, version.id, owner.userId],
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
  return { accountId: owner.accountId, attemptId: attempt.id, jobId: job.id };
}

type Machine = Readonly<{ id: string; credential: string }>;

async function machine(label = "input-composition-worker"): Promise<Machine> {
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

// The real HTTP client with a recording fetch. `lose` decides, per
// input-failed request, whether to drop it before sending (UNSENT) or to send
// it and then lose the response (LOST_RESPONSE).
type Transport = "DELIVER" | "UNSENT" | "LOST_RESPONSE";
function recordingClient(baseUrl: string, worker: Machine, lose: (inputFailedCall: number) => Transport = () => "DELIVER") {
  const requests: string[] = [];
  let inputFailedCalls = 0;
  const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const target = new URL(String(url));
    expect(target.origin).toBe(baseUrl);
    const route = target.pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, ":id");
    requests.push(route);
    if (route.endsWith("/input-failed")) {
      inputFailedCalls += 1;
      const transport = lose(inputFailedCalls);
      if (transport === "UNSENT") throw new TypeError("fetch failed");
      if (transport === "LOST_RESPONSE") {
        const response = await fetch(url, init);
        await response.body?.cancel();
        throw new TypeError("socket hang up");
      }
    }
    return fetch(url, init);
  }) as typeof fetch;
  const client = createHttpWorkerControlClient({ baseUrl, machineCredential: worker.credential, fetchImpl });
  return { client, requests };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const KEY = "inputs/reference.png";
const MAX = 4096;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const reference = (bytes: Uint8Array, contentType: string, overrides: Record<string, unknown> = {}) => ({
  key: KEY,
  sha256: sha(bytes),
  byteCount: bytes.length,
  contentType,
  ...overrides,
});
const neverFires: DeadlineTimer = () => () => {};

// Lease, receive the grant, retrieve the input and hand any failure to the
// policy. The test plays the not-yet-built composer: it never asks for a
// permit, never acknowledges SUBMITTING and constructs no provider.
async function runInputStage(
  client: WorkerControlClient,
  input: Readonly<{ accountId: string; store: ObjectStore; reference: unknown; maxBytes?: number }>,
) {
  const lease = await client.leaseNextAttempt();
  expect(lease).not.toBeNull();
  const proof: LeaseProof = Object.freeze({ fencingCounter: lease!.fencingCounter, leaseToken: lease!.leaseToken });
  await client.requestCredentialGrant(lease!.executionAttemptId, proof);
  const latch = createHostFaultLatch();
  let outcome: InputMediaFailureOutcome | "VERIFIED";
  try {
    await retrieveVerifiedReferenceImage({ accountId: input.accountId, reference: input.reference, maxBytes: input.maxBytes ?? MAX }, { store: input.store, deadlineTimer: neverFires });
    outcome = "VERIFIED";
  } catch (error) {
    outcome = await handleInputMediaFailure({ client, deadlineTimer: neverFires, latch }, lease!.executionAttemptId, proof, error);
  }
  return { outcome, latch, proof, attemptId: lease!.executionAttemptId };
}

const attemptRow = async (id: string) =>
  (
    await clients.migrator.query<{
      state: string;
      failure_code: string | null;
      submitting_at: Date | null;
      lease_worker_principal_id: string | null;
      lease_token_sha256: string | null;
      lease_fencing_counter: string;
      credential_granted_at: Date | null;
      input_failed_worker_principal_id: string | null;
      input_failed_fencing_counter: string | null;
    }>(
      `SELECT state, failure_code, submitting_at, lease_worker_principal_id, lease_token_sha256, lease_fencing_counter, credential_granted_at,
              input_failed_worker_principal_id, input_failed_fencing_counter
         FROM execution_attempts WHERE id = $1`,
      [id],
    )
  ).rows[0]!;
const jobStatus = async (id: string) => (await clients.migrator.query<{ status: string }>("SELECT status FROM execution_jobs WHERE id = $1", [id])).rows[0]!.status;
const auditTypes = async (id: string) =>
  (await clients.migrator.query<{ event_type: string }>("SELECT event_type FROM audit_events WHERE resource_id = $1 ORDER BY sequence", [id])).rows.map(({ event_type }) => event_type);
const expireLease = (attemptId: string) =>
  clients.migrator.query(
    "UPDATE execution_attempts SET leased_at = now() - interval '10 minutes', heartbeat_at = now() - interval '10 minutes', lease_expires_at = now() - interval '1 second' WHERE id = $1",
    [attemptId],
  );

const CONTROL_ROUTES_WITH_REPORT = ["/worker-control/v1/leases", "/worker-control/v1/attempts/:id/credential-grant", "/worker-control/v1/attempts/:id/input-failed"];
const CONTROL_ROUTES_WITHOUT_REPORT = ["/worker-control/v1/leases", "/worker-control/v1/attempts/:id/credential-grant"];

// ---------------------------------------------------------------------------

describe("permanent input failure: authoritative pre-provider termination", () => {
  const cases: ReadonlyArray<readonly [string, (accountId: string) => { store: ObjectStore; reference: unknown; maxBytes?: number }, string]> = [
    ["not found", () => ({ store: createInMemoryObjectStore().store, reference: reference(PNG, "image/png") }), "INPUT_OBJECT_NOT_FOUND"],
    [
      "a SHA-256 mismatch",
      (accountId) => {
        const memory = createInMemoryObjectStore();
        memory.seed(accountId, KEY, PNG);
        return { store: memory.store, reference: reference(PNG, "image/png", { sha256: sha(JPEG) }) };
      },
      "INPUT_OBJECT_INTEGRITY_MISMATCH",
    ],
    [
      "a media mismatch",
      (accountId) => {
        const memory = createInMemoryObjectStore();
        memory.seed(accountId, KEY, JPEG);
        return { store: memory.store, reference: reference(JPEG, "image/png") };
      },
      "INPUT_MEDIA_TYPE_INVALID",
    ],
    [
      "a declared oversize",
      (accountId) => {
        const memory = createInMemoryObjectStore();
        memory.seed(accountId, KEY, PNG);
        return { store: memory.store, reference: reference(PNG, "image/png"), maxBytes: PNG.length - 1 };
      },
      "INPUT_OBJECT_TOO_LARGE",
    ],
  ];

  it.each(cases)("terminates the attempt for %s: FAILED_BEFORE_SUBMISSION, job FAILED, lease cleared, no latch, no SUBMITTING or provider", async (_label, build, code) => {
    const worker = await machine();
    const item = await work();
    const baseUrl = await controlPlane([worker]);
    const { client, requests } = recordingClient(baseUrl, worker);
    const { outcome, latch, attemptId } = await runInputStage(client, { accountId: item.accountId, ...build(item.accountId) });

    expect(attemptId).toBe(item.attemptId);
    expect(outcome).toEqual({ status: "PERMANENT_INPUT_REPORTED", failureCode: code });
    expect(latch.isTripped()).toBe(false);
    const row = await attemptRow(item.attemptId);
    expect(row).toMatchObject({
      state: "FAILED_BEFORE_SUBMISSION",
      failure_code: code,
      submitting_at: null,
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      input_failed_worker_principal_id: worker.id,
      input_failed_fencing_counter: "1",
    });
    expect(row.credential_granted_at).toBeInstanceOf(Date);
    expect(await jobStatus(item.jobId)).toBe("FAILED");
    // Exactly lease, grant and one input-failed report: no permit, SUBMITTING, heartbeat or provider request.
    expect(requests).toEqual(CONTROL_ROUTES_WITH_REPORT);
    expect(await auditTypes(item.attemptId)).toEqual(["execution_attempt.leased", "execution_attempt.credential_granted", "execution_attempt.input_failed"]);
  });

  it("recovers a lost response by the policy's exact replay: one transition, one audit, never requeued", async () => {
    const list = [await machine("input-composition-a"), await machine("input-composition-b")];
    const item = await work();
    const baseUrl = await controlPlane(list);
    const { client, requests } = recordingClient(baseUrl, list[0]!, (call) => (call === 1 ? "LOST_RESPONSE" : "DELIVER"));
    const { outcome, latch } = await runInputStage(client, { accountId: item.accountId, store: createInMemoryObjectStore().store, reference: reference(PNG, "image/png") });

    expect(outcome).toEqual({ status: "PERMANENT_INPUT_REPORTED", failureCode: "INPUT_OBJECT_NOT_FOUND" });
    expect(latch.isTripped()).toBe(false);
    expect(requests.filter((route) => route.endsWith("/input-failed"))).toHaveLength(2);
    expect((await auditTypes(item.attemptId)).filter((type) => type === "execution_attempt.input_failed")).toHaveLength(1);
    // Another worker finds nothing to lease: the terminal attempt is never requeued.
    const other = recordingClient(baseUrl, list[1]!);
    expect(await other.client.leaseNextAttempt()).toBeNull();
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "FAILED_BEFORE_SUBMISSION", failure_code: "INPUT_OBJECT_NOT_FOUND" });
  });

  it("stops unreported after two unavailable reports, with no latch; the lease stays for expiry and recovery requeues it", async () => {
    const list = [await machine("input-composition-a"), await machine("input-composition-b")];
    const item = await work();
    const baseUrl = await controlPlane(list);
    const { client, requests } = recordingClient(baseUrl, list[0]!, () => "UNSENT");
    const { outcome, latch } = await runInputStage(client, { accountId: item.accountId, store: createInMemoryObjectStore().store, reference: reference(PNG, "image/png") });

    expect(outcome).toEqual({ status: "PERMANENT_INPUT_UNREPORTED", failureCode: "INPUT_OBJECT_NOT_FOUND" });
    expect(latch.isTripped()).toBe(false);
    expect(requests).toEqual([...CONTROL_ROUTES_WITHOUT_REPORT, "/worker-control/v1/attempts/:id/input-failed", "/worker-control/v1/attempts/:id/input-failed"]);
    // The control plane is still authoritative: LEASED, granted, never OUTCOME_UNKNOWN.
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "LEASED", lease_worker_principal_id: list[0]!.id, submitting_at: null, failure_code: null });

    // Crash before the report: on expiry, granted-expired recovery requeues and the next lease rediscovers the fault.
    await expireLease(item.attemptId);
    const next = recordingClient(baseUrl, list[1]!);
    const rediscovered = await runInputStage(next.client, { accountId: item.accountId, store: createInMemoryObjectStore().store, reference: reference(PNG, "image/png") });
    expect(rediscovered.outcome).toEqual({ status: "PERMANENT_INPUT_REPORTED", failureCode: "INPUT_OBJECT_NOT_FOUND" });
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "FAILED_BEFORE_SUBMISSION", input_failed_worker_principal_id: list[1]!.id, input_failed_fencing_counter: "2" });
    expect(await auditTypes(item.attemptId)).not.toContain("execution_attempt.outcome_unknown");
  });

  it("refuses a stale report from the old epoch after recovery, leaving the newer authority's attempt LEASED", async () => {
    const list = [await machine("input-composition-a"), await machine("input-composition-b")];
    const item = await work();
    const baseUrl = await controlPlane(list);
    const stale = recordingClient(baseUrl, list[0]!);
    const lease = await stale.client.leaseNextAttempt();
    const staleProof: LeaseProof = { fencingCounter: lease!.fencingCounter, leaseToken: lease!.leaseToken };
    await stale.client.requestCredentialGrant(item.attemptId, staleProof);
    await expireLease(item.attemptId);
    const fresh = recordingClient(baseUrl, list[1]!);
    expect((await fresh.client.leaseNextAttempt())?.fencingCounter).toBe(2);

    const latch = createHostFaultLatch();
    const error = await retrieveVerifiedReferenceImage(
      { accountId: item.accountId, reference: reference(PNG, "image/png"), maxBytes: MAX },
      { store: createInMemoryObjectStore().store, deadlineTimer: neverFires },
    ).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    const outcome = await handleInputMediaFailure({ client: stale.client, deadlineTimer: neverFires, latch }, item.attemptId, staleProof, error);
    // The 409 refusal is not retried and establishes nothing.
    expect(outcome).toEqual({ status: "PERMANENT_INPUT_UNREPORTED", failureCode: "INPUT_OBJECT_NOT_FOUND" });
    expect(stale.requests.filter((route) => route.endsWith("/input-failed"))).toHaveLength(1);
    expect(latch.isTripped()).toBe(false);
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "LEASED", lease_worker_principal_id: list[1]!.id, lease_fencing_counter: "2", input_failed_worker_principal_id: null });
  });
});

describe("host faults and transient storage: no report", () => {
  it.each([
    [
      "access denied",
      () => {
        const memory = createInMemoryObjectStore();
        memory.forceNext("ACCESS_DENIED");
        return memory.store;
      },
    ],
    ["a store contract violation (throw)", () => ({ getObject: async () => Promise.reject(new Error("vendor detail")) }) as unknown as ObjectStore],
    [
      "a store contract violation (oversized return)",
      () => {
        const memory = createInMemoryObjectStore();
        memory.forceNext({ found: Buffer.concat([PNG, Buffer.alloc(MAX)]) });
        return memory.store;
      },
    ],
  ])("trips the latch for %s, sends no input-failed report and leaves the attempt LEASED", async (_label, build) => {
    const worker = await machine();
    const item = await work();
    const baseUrl = await controlPlane([worker]);
    const { client, requests } = recordingClient(baseUrl, worker);
    const { outcome, latch } = await runInputStage(client, { accountId: item.accountId, store: build(), reference: reference(PNG, "image/png") });

    expect(outcome).toEqual({ status: "HOST_FAULT" });
    expect(latch.isTripped()).toBe(true);
    expect(requests).toEqual(CONTROL_ROUTES_WITHOUT_REPORT);
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "LEASED", lease_worker_principal_id: worker.id, submitting_at: null, input_failed_worker_principal_id: null });
    expect(await jobStatus(item.jobId)).toBe("RUNNING");
  });

  it("treats storage unavailable through the bounded retry as transient: no report, no latch, the lease is left to expiry and recovery", async () => {
    const list = [await machine("input-composition-a"), await machine("input-composition-b")];
    const item = await work();
    const baseUrl = await controlPlane(list);
    const memory = createInMemoryObjectStore();
    memory.forceNext("UNAVAILABLE", "UNAVAILABLE");
    const { client, requests } = recordingClient(baseUrl, list[0]!);
    const { outcome, latch } = await runInputStage(client, { accountId: item.accountId, store: memory.store, reference: reference(PNG, "image/png") });

    expect(outcome).toEqual({ status: "TRANSIENT_STORAGE" });
    expect(memory.calls).toHaveLength(2);
    expect(latch.isTripped()).toBe(false);
    expect(requests).toEqual(CONTROL_ROUTES_WITHOUT_REPORT);
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "LEASED", lease_worker_principal_id: list[0]!.id, input_failed_worker_principal_id: null });

    // Later expiry and recovery own the requeue.
    await expireLease(item.attemptId);
    const next = recordingClient(baseUrl, list[1]!);
    const recovered = await next.client.leaseNextAttempt();
    expect(recovered).toMatchObject({ executionAttemptId: item.attemptId, fencingCounter: 2 });
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "LEASED", lease_worker_principal_id: list[1]!.id, credential_granted_at: null });
  });
});
