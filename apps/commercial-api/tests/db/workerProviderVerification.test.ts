import { createHash, randomBytes, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type RuntimeClient, type TransactionalPool } from "../../src/database/runtimePool.js";
import { PROVIDER_CREDENTIAL_PURPOSE } from "commercial-worker-protocol";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../src/startCommercialApiServer.js";
import { createWorkerControlApplication } from "../../src/workerControl/workerControlApplication.js";
import { reportProviderVerificationResult } from "../../src/workerControl/workerProviderVerificationResultService.js";
import type { WorkerSecurityEvent } from "../../src/workerControl/workerSecurityEvents.js";
import { send, type TestResponse } from "../httpClient.js";
import { createTestCredentialFingerprinter, createTestCredentialOpener, createTestCredentialSealer, generateTestKey } from "../support/testCredentialCrypto.js";
import { createTestWorkerAuthenticationAdapter } from "../support/testWorkerAuthentication.js";
import { createRecordingWorkerSecurityEventSink } from "../support/testWorkerSecurityEvents.js";
import { insertAccountWithFreeGrant, openGuardedClients, prepareSchemaV1, type GuardedClients } from "./support/testDatabase.js";

// R44B11F Phase 3 provider-verification worker-control lifecycle against
// PostgreSQL 16: lease, exact credential grant, durable VERIFYING barrier and
// the published terminal result contract, over the explicitly composed
// worker-control router. Credentials are generated fixture strings sealed by
// the test sealer; the test-only opener exists here only to prove the
// returned envelope and context are exact. Secret assertions are booleans so
// a failure never prints one. No provider is called anywhere.

let clients: GuardedClients;
let pool: TransactionalPool;
let server: RunningCommercialApiServer | undefined;
let port: number;
let events: WorkerSecurityEvent[];

const encryptionKey = generateTestKey("verification-test-encryption/v1");
const sealer = createTestCredentialSealer(encryptionKey);
const fingerprinter = createTestCredentialFingerprinter(generateTestKey("verification-test-fingerprint/v1"), encryptionKey);
const opener = createTestCredentialOpener(encryptionKey);

const PROVIDER = "EXAMPLE_PROVIDER";
const POLICY = "EXAMPLE_METADATA_V1";
const BASE = "/worker-control/v1/provider-verifications";
const LEASE_PATH = `${BASE}/lease`;
const REJECTED = '{"status":"error","code":"LEASE_REJECTED"}\n';
const INVALID = '{"status":"error","code":"INVALID_REQUEST"}\n';
const INCONCLUSIVE_REASONS = [
  "PROVIDER_BILLING_RESTRICTION",
  "PROVIDER_RATE_OR_QUOTA_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_NETWORK_FAILURE",
  "PROVIDER_RESPONSE_MALFORMED",
  "PROVIDER_RESPONSE_TOO_LARGE",
  "PROVIDER_UNEXPECTED_STATUS",
  "PROVIDER_OPERATION_DRIFT",
  "VERIFICATION_AMBIGUOUS",
] as const;
const PAIRS: readonly (readonly [string, string])[] = [
  ["VERIFIED", "VERIFICATION_SUCCEEDED"],
  ["DEFINITIVE_FAILURE", "CREDENTIAL_REJECTED"],
  ["DEFINITIVE_FAILURE", "CREDENTIAL_NOT_AUTHORIZED"],
  ...INCONCLUSIVE_REASONS.map((reason) => ["INCONCLUSIVE", reason] as const),
];

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
    const id = (await clients.migrator.query<{ id: string }>("INSERT INTO worker_principals (label) VALUES ($1) RETURNING id", [`verification-worker-${index}`])).rows[0]!.id;
    list.push({ id, token: `fixture-worker-${randomBytes(16).toString("hex")}` });
  }
  return list;
}

async function start(list: readonly Worker[]): Promise<void> {
  const recording = createRecordingWorkerSecurityEventSink();
  events = recording.events;
  const application = createWorkerControlApplication({
    authentication: createTestWorkerAuthenticationAdapter(list.map((worker) => ({ token: worker.token, workerPrincipalId: worker.id }))),
    securityEvents: recording.sink,
    pool,
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

type Fixture = Readonly<{ userId: string; accountId: string; connectionId: string; versionId: string; plaintext: string; jobId: string }>;

const one = <T extends object>(sql: string, params: unknown[] = []) => clients.migrator.query<T>(sql, params).then((result) => result.rows[0]!);

async function insertVersion(accountId: string, connectionId: string, credentialVersion: number, userId: string) {
  const plaintext = `fixture-credential-${randomBytes(18).toString("hex")}`;
  const envelope = await sealer.seal(plaintext, { accountId, providerConnectionId: connectionId, provider: PROVIDER, credentialVersion, purpose: PROVIDER_CREDENTIAL_PURPOSE });
  const fingerprint = await fingerprinter.fingerprint(plaintext);
  const row = await one<{ id: string }>(
    `INSERT INTO provider_credential_versions (account_id, provider_connection_id, credential_version, sealed_credential, fingerprint_algorithm,
                                               fingerprint_key_ref, fingerprint_value, created_by_user_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8) RETURNING id`,
    [accountId, connectionId, credentialVersion, JSON.stringify(envelope), fingerprint.algorithm, fingerprint.keyRef, fingerprint.value, userId],
  );
  return { id: row.id, plaintext };
}

// One account, one PENDING_VERIFICATION connection with ACTIVE sealed v1 and
// one QUEUED verification job bound to v1. `verified` starts the aggregate as
// ACTIVE/VERIFIED a day ago.
async function fixture(options: Readonly<{ verified?: boolean }> = {}): Promise<Fixture> {
  const owner = await insertAccountWithFreeGrant(clients.migrator, `verification-${randomUUID()}`);
  const connection = await one<{ id: string }>(
    "INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id) VALUES ($1, $2, 'API_KEY', $3) RETURNING id",
    [owner.accountId, PROVIDER, owner.userId],
  );
  const v1 = await insertVersion(owner.accountId, connection.id, 1, owner.userId);
  if (options.verified === true) {
    await clients.migrator.query(
      `UPDATE provider_connections SET status = 'ACTIVE', verification_status = 'VERIFIED',
              verified_at = now() - interval '1 day', last_verification_attempt_at = now() - interval '1 day'
        WHERE id = $1`,
      [connection.id],
    );
  }
  const job = await one<{ id: string }>(
    `INSERT INTO provider_verification_jobs (account_id, provider_connection_id, provider_credential_version_id, verification_policy_id, requested_by_user_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [owner.accountId, connection.id, v1.id, POLICY, owner.userId],
  );
  return Object.freeze({ userId: owner.userId, accountId: owner.accountId, connectionId: connection.id, versionId: v1.id, plaintext: v1.plaintext, jobId: job.id });
}

// Lifecycle changes, applied as committed facts by the migration owner.
const lifecycle = {
  rotate: async (f: Fixture) => {
    await clients.migrator.query("UPDATE provider_credential_versions SET status = 'SUPERSEDED', superseded_at = now(), updated_at = now() WHERE id = $1", [f.versionId]);
    await insertVersion(f.accountId, f.connectionId, 2, f.userId);
    await clients.migrator.query(
      `UPDATE provider_connections SET status = 'PENDING_VERIFICATION', verification_status = 'UNVERIFIED',
              verified_at = NULL, last_verification_attempt_at = NULL, updated_at = now()
        WHERE id = $1`,
      [f.connectionId],
    );
  },
  disconnect: (f: Fixture) => clients.migrator.query("UPDATE provider_connections SET status = 'DISCONNECTED', disconnected_at = now() WHERE id = $1", [f.connectionId]),
  disable: (f: Fixture) => clients.migrator.query("UPDATE provider_connections SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [f.connectionId]),
  retain: (f: Fixture) =>
    clients.migrator.query("UPDATE provider_credential_versions SET status = 'RETAINED_FOR_RECOVERY', retained_for_recovery_at = now() WHERE id = $1", [f.versionId]),
  destroy: (f: Fixture) =>
    clients.migrator.query(
      `UPDATE provider_credential_versions SET status = 'DESTROYED', destroyed_at = now(), sealed_credential = NULL,
              fingerprint_algorithm = NULL, fingerprint_key_ref = NULL, fingerprint_value = NULL
        WHERE id = $1`,
      [f.versionId],
    ),
  disableAccount: (f: Fixture) => clients.migrator.query("UPDATE accounts SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [f.accountId]),
} as const;

// ---------------------------------------------------------------------------
// HTTP

const json = (response: TestResponse) => JSON.parse(response.body) as Record<string, any>;

function post(worker: Worker, path: string, body?: unknown): Promise<TestResponse> {
  const headers: Record<string, string> = { Authorization: `Bearer ${worker.token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return send(port, "POST", path, body === undefined ? undefined : JSON.stringify(body), headers);
}

type Lease = Readonly<{ providerVerificationJobId: string; leaseToken: string; fencingCounter: number; leaseExpiresAt: string; provider: string; verificationPolicyId: string }>;
type Proof = Readonly<{ fencingCounter: number; leaseToken: string }>;

async function lease(worker: Worker): Promise<Lease | null> {
  const response = await post(worker, LEASE_PATH);
  expect(response.status).toBe(200);
  return json(response).lease as Lease | null;
}
const proofOf = (acquired: Lease): Proof => ({ fencingCounter: acquired.fencingCounter, leaseToken: acquired.leaseToken });
const otherToken = () => randomBytes(32).toString("base64url");
const grant = (worker: Worker, jobId: string, proof: Proof) => post(worker, `${BASE}/${jobId}/credential-grant`, proof);
const verifying = (worker: Worker, jobId: string, proof: Proof) => post(worker, `${BASE}/${jobId}/verifying`, proof);
const result = (worker: Worker, jobId: string, proof: Proof, outcome: string, reasonCode: string) =>
  post(worker, `${BASE}/${jobId}/result`, { ...proof, outcome, reasonCode });

async function leased(worker: Worker, f: Fixture): Promise<Proof> {
  const acquired = await lease(worker);
  expect(acquired?.providerVerificationJobId).toBe(f.jobId);
  return proofOf(acquired!);
}
async function granted(worker: Worker, f: Fixture): Promise<Proof> {
  const proof = await leased(worker, f);
  expect((await grant(worker, f.jobId, proof)).status).toBe(200);
  return proof;
}
async function atBarrier(worker: Worker, f: Fixture): Promise<Proof> {
  const proof = await granted(worker, f);
  expect((await verifying(worker, f.jobId, proof)).status).toBe(200);
  return proof;
}

// ---------------------------------------------------------------------------
// Reads

type JobRow = {
  state: string;
  lease_worker_principal_id: string | null;
  lease_token_sha256: string | null;
  lease_fencing_counter: string;
  leased_at: Date | null;
  lease_expires_at: Date | null;
  credential_granted_at: Date | null;
  verifying_at: Date | null;
  verifying_worker_principal_id: string | null;
  verifying_fencing_counter: string | null;
  result_outcome: string | null;
  terminal_reason_code: string | null;
  result_worker_principal_id: string | null;
  result_fencing_counter: string | null;
  completed_at: Date | null;
  updated_at: Date;
};
const jobRow = (jobId: string) => one<JobRow>("SELECT * FROM provider_verification_jobs WHERE id = $1", [jobId]);

type ConnectionRow = { status: string; verification_status: string; verified_at: Date | null; last_verification_attempt_at: Date | null; updated_at: Date };
const connectionRow = (connectionId: string) =>
  one<ConnectionRow>("SELECT status, verification_status, verified_at, last_verification_attempt_at, updated_at FROM provider_connections WHERE id = $1", [connectionId]);

const audits = async (connectionId: string) =>
  (
    await clients.migrator.query<{ event_type: string; actor_type: string; actor_user_id: string | null; metadata: Record<string, unknown> }>(
      "SELECT event_type, actor_type, actor_user_id, metadata FROM audit_events WHERE resource_type = 'provider_connection' AND resource_id = $1 ORDER BY sequence",
      [connectionId],
    )
  ).rows;

const dbNow = () => one<{ now: Date }>("SELECT clock_timestamp() AS now").then((row) => row.now);

async function generationRows(): Promise<number> {
  const row = await one<{ total: string }>(
    "SELECT (SELECT count(*) FROM execution_jobs) + (SELECT count(*) FROM execution_attempts) + (SELECT count(*) FROM generation_authorizations) AS total",
  );
  return Number(row.total);
}

// Rows anywhere in the verification, connection or audit state that contain the value.
async function occurrences(value: string): Promise<number> {
  const row = await one<{ hits: string }>(
    `SELECT (SELECT count(*) FROM provider_verification_jobs t WHERE strpos(t::text, $1) > 0)
          + (SELECT count(*) FROM provider_connections t WHERE strpos(t::text, $1) > 0)
          + (SELECT count(*) FROM audit_events t WHERE strpos(t::text, $1) > 0) AS hits`,
    [value],
  );
  return Number(row.hits);
}

function expectRejected(response: TestResponse, type: WorkerSecurityEvent["type"], reason: WorkerSecurityEvent["reason"], jobId?: string) {
  expect(response.status).toBe(409);
  expect(response.body).toBe(REJECTED);
  const event = events.at(-1)!;
  expect({ type: event.type, reason: event.reason }).toEqual({ type, reason });
  if (jobId !== undefined) expect(event.providerVerificationJobId).toBe(jobId);
  expect(event.executionAttemptId).toBeUndefined();
}

const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

// ---------------------------------------------------------------------------

describe("provider-verification lease", () => {
  it("leases QUEUED -> LEASED for exactly 30 seconds of database time, storing only the token verifier", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const before = await dbNow();
    const response = await post(worker!, LEASE_PATH);
    const after = await dbNow();
    expect(response.status).toBe(200);
    const acquired = json(response).lease as Lease;
    expect(Object.keys(acquired).sort()).toEqual(["fencingCounter", "leaseExpiresAt", "leaseToken", "provider", "providerVerificationJobId", "verificationPolicyId"]);
    expect(acquired).toMatchObject({ providerVerificationJobId: f.jobId, provider: PROVIDER, verificationPolicyId: POLICY, fencingCounter: 1 });
    expect(acquired.leaseToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(/sealed|envelope|credential|fingerprint/i.test(response.body)).toBe(false);

    const row = await jobRow(f.jobId);
    expect(row).toMatchObject({ state: "LEASED", lease_worker_principal_id: worker!.id, lease_fencing_counter: "1", credential_granted_at: null, verifying_at: null });
    expect(row.lease_token_sha256).toBe(sha256Hex(acquired.leaseToken));
    expect(row.lease_expires_at!.getTime() - row.leased_at!.getTime()).toBe(30_000);
    expect(row.leased_at!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1);
    expect(row.leased_at!.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(new Date(acquired.leaseExpiresAt).getTime()).toBe(row.lease_expires_at!.getTime());
    expect(await occurrences(acquired.leaseToken)).toBe(0);

    // No second holder; no generation state; no customer audit for leasing.
    expect(await lease(worker!)).toBeNull();
    expect(await generationRows()).toBe(0);
    expect(await audits(f.connectionId)).toEqual([]);
  });

  it("continues the monotonic fencing counter when a job is leased again, and the old proof is dead", async () => {
    const [first, second] = await begin(2);
    const f = await fixture();
    const old = await leased(first!, f);
    // Simulates the Phase 4 pre-grant requeue that migration 0010 permits.
    await clients.migrator.query(
      `UPDATE provider_verification_jobs SET state = 'QUEUED', lease_worker_principal_id = NULL, lease_token_sha256 = NULL,
              leased_at = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1`,
      [f.jobId],
    );
    const next = await lease(second!);
    expect(next).toMatchObject({ providerVerificationJobId: f.jobId, fencingCounter: 2 });
    expectRejected(await grant(first!, f.jobId, old), "WORKER_PROVIDER_VERIFICATION_GRANT_REJECTED", "OTHER_WORKER", f.jobId);
    expectRejected(await grant(second!, f.jobId, { ...proofOf(next!), fencingCounter: 1 }), "WORKER_PROVIDER_VERIFICATION_GRANT_REJECTED", "FENCING_MISMATCH", f.jobId);
  });

  it("never lets concurrent workers acquire the same job", async () => {
    const list = await begin(6);
    const fixtures = [await fixture(), await fixture(), await fixture()];
    const leases = await Promise.all(list.map((worker) => lease(worker)));
    const taken = leases.filter((value): value is Lease => value !== null);
    expect(taken).toHaveLength(3);
    expect(new Set(taken.map((value) => value.providerVerificationJobId))).toEqual(new Set(fixtures.map((f) => f.jobId)));
    const owners = await clients.migrator.query<{ lease_worker_principal_id: string }>("SELECT lease_worker_principal_id FROM provider_verification_jobs WHERE state = 'LEASED'");
    expect(new Set(owners.rows.map((row) => row.lease_worker_principal_id)).size).toBe(3);
  });

  it("skips a locked job instead of waiting (bounded SKIP LOCKED selection)", async () => {
    const [worker] = await begin(1);
    const oldest = await fixture();
    const next = await fixture();
    await clients.migrator.query("BEGIN");
    try {
      await clients.migrator.query("SELECT id FROM provider_verification_jobs WHERE id = $1 FOR UPDATE", [oldest.jobId]);
      const acquired = await lease(worker!);
      expect(acquired?.providerVerificationJobId).toBe(next.jobId);
    } finally {
      await clients.migrator.query("ROLLBACK");
    }
    expect((await jobRow(oldest.jobId)).state).toBe("QUEUED");
  });

  it("leases only work whose account, connection and exact version are still eligible", async () => {
    const [worker] = await begin(1);
    for (const change of [lifecycle.disconnect, lifecycle.disable, lifecycle.retain, lifecycle.disableAccount]) {
      const f = await fixture();
      await change(f);
      expect(await lease(worker!)).toBeNull();
      expect((await jobRow(f.jobId)).state).toBe("QUEUED");
      await clients.migrator.query(
        "UPDATE provider_verification_jobs SET state = 'CANCELLED', terminal_reason_code = 'TEST_CLEANUP', completed_at = now() WHERE id = $1",
        [f.jobId],
      );
    }
  });

  it("refuses a disabled worker principal and leaves the queue untouched", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    await clients.migrator.query("UPDATE worker_principals SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [worker!.id]);
    const response = await post(worker!, LEASE_PATH);
    expect(response.status).toBe(401);
    expect((await jobRow(f.jobId)).state).toBe("QUEUED");
  });
});

describe("provider-verification credential grant", () => {
  it("returns exactly the bound sealed credential and its opening context, stamped once from the database clock", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await leased(worker!, f);
    const leasedAt = (await jobRow(f.jobId)).leased_at!;
    const response = await grant(worker!, f.jobId, proof);
    const after = await dbNow();
    expect(response.status).toBe(200);
    const body = json(response);
    expect(Object.keys(body).sort()).toEqual(["credential", "credentialGrantedAt", "fencingCounter", "providerVerificationJobId"]);
    expect(Object.keys(body.credential).sort()).toEqual(["openingContext", "sealedEnvelope"]);
    expect(body).toMatchObject({ providerVerificationJobId: f.jobId, fencingCounter: 1 });
    expect(body.credential.openingContext).toEqual({
      accountId: f.accountId,
      providerConnectionId: f.connectionId,
      provider: PROVIDER,
      credentialVersion: 1,
      purpose: PROVIDER_CREDENTIAL_PURPOSE,
    });
    const stored = await one<{ sealed_credential: unknown }>("SELECT sealed_credential FROM provider_credential_versions WHERE id = $1", [f.versionId]);
    expect(body.credential.sealedEnvelope).toEqual(stored.sealed_credential);
    // Test oracle only: the API returned sealed material; it never opened it.
    expect((await opener.open(body.credential.sealedEnvelope, body.credential.openingContext)) === f.plaintext).toBe(true);
    expect(response.body.includes(f.plaintext)).toBe(false);

    const row = await jobRow(f.jobId);
    expect(row.state).toBe("LEASED");
    expect(row.credential_granted_at!.getTime()).toBeGreaterThanOrEqual(leasedAt.getTime());
    expect(row.credential_granted_at!.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(new Date(body.credentialGrantedAt).getTime()).toBe(row.credential_granted_at!.getTime());

    // Exact replay: same grant, original timestamp, no write.
    const replay = await grant(worker!, f.jobId, proof);
    expect(replay.status).toBe(200);
    expect(json(replay)).toEqual(body);
    expect(await jobRow(f.jobId)).toEqual(row);

    expect(await occurrences(f.plaintext)).toBe(0);
    expect(await occurrences(proof.leaseToken)).toBe(0);
    expect(await generationRows()).toBe(0);
    expect(await audits(f.connectionId)).toEqual([]);
    expect(JSON.stringify(events).includes(proof.leaseToken)).toBe(false);
  });

  it("refuses a wrong worker, token or fence and an unknown job, with its own security event", async () => {
    const [worker, other] = await begin(2);
    const f = await fixture();
    const proof = await leased(worker!, f);
    const type = "WORKER_PROVIDER_VERIFICATION_GRANT_REJECTED" as const;
    expectRejected(await grant(other!, f.jobId, proof), type, "OTHER_WORKER", f.jobId);
    expectRejected(await grant(worker!, f.jobId, { ...proof, leaseToken: otherToken() }), type, "TOKEN_MISMATCH", f.jobId);
    expectRejected(await grant(worker!, f.jobId, { ...proof, fencingCounter: 2 }), type, "FENCING_MISMATCH", f.jobId);
    const unknown = randomUUID();
    expectRejected(await grant(worker!, unknown, proof), type, "UNKNOWN_VERIFICATION_JOB", unknown);
    expect((await jobRow(f.jobId)).credential_granted_at).toBeNull();
    expect(JSON.stringify(events).includes(proof.leaseToken)).toBe(false);
  });

  it.each([
    ["a rotation", "rotate", "CREDENTIAL_VERSION_INELIGIBLE"],
    ["a disconnect", "disconnect", "CONNECTION_INELIGIBLE"],
    ["a disabled connection", "disable", "CONNECTION_INELIGIBLE"],
    ["a RETAINED_FOR_RECOVERY version", "retain", "CREDENTIAL_VERSION_INELIGIBLE"],
    ["a DESTROYED version", "destroy", "CREDENTIAL_VERSION_INELIGIBLE"],
    ["a disabled account", "disableAccount", "ACCOUNT_INELIGIBLE"],
  ] as const)("fails closed after %s committed before the grant", async (_label, change, reason) => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await leased(worker!, f);
    await lifecycle[change](f);
    expectRejected(await grant(worker!, f.jobId, proof), "WORKER_PROVIDER_VERIFICATION_GRANT_REJECTED", reason, f.jobId);
    expect((await jobRow(f.jobId)).credential_granted_at).toBeNull();
  });

  it("revalidates a replay: no envelope is returned after a rotation, and the original grant time is kept", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await granted(worker!, f);
    const before = await jobRow(f.jobId);
    await lifecycle.rotate(f);
    expectRejected(await grant(worker!, f.jobId, proof), "WORKER_PROVIDER_VERIFICATION_GRANT_REJECTED", "CREDENTIAL_VERSION_INELIGIBLE", f.jobId);
    expect(await jobRow(f.jobId)).toEqual(before);
  });
});

describe("durable VERIFYING barrier", () => {
  it("requires a committed credential grant first", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await leased(worker!, f);
    expectRejected(await verifying(worker!, f.jobId, proof), "WORKER_PROVIDER_VERIFICATION_VERIFYING_REJECTED", "CREDENTIAL_NOT_GRANTED", f.jobId);
    expect((await jobRow(f.jobId)).state).toBe("LEASED");
    expect((await connectionRow(f.connectionId)).last_verification_attempt_at).toBeNull();
  });

  it("enters VERIFYING with immutable provenance and atomically stamps the aggregate attempt; replay writes nothing", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await granted(worker!, f);
    const response = await verifying(worker!, f.jobId, proof);
    expect(response.status).toBe(200);
    const body = json(response);
    expect(Object.keys(body).sort()).toEqual(["fencingCounter", "providerVerificationJobId", "state", "verifyingAt"]);
    expect(body).toMatchObject({ providerVerificationJobId: f.jobId, fencingCounter: 1, state: "VERIFYING" });

    const row = await jobRow(f.jobId);
    expect(row).toMatchObject({ state: "VERIFYING", verifying_worker_principal_id: worker!.id, verifying_fencing_counter: "1", lease_worker_principal_id: worker!.id });
    expect(row.verifying_at!.getTime()).toBeGreaterThanOrEqual(row.credential_granted_at!.getTime());
    expect(new Date(body.verifyingAt).getTime()).toBe(row.verifying_at!.getTime());
    const connection = await connectionRow(f.connectionId);
    expect(connection.last_verification_attempt_at!.getTime()).toBe(row.verifying_at!.getTime());
    // The barrier alone records an attempt; it changes no verification result.
    expect(connection).toMatchObject({ status: "PENDING_VERIFICATION", verification_status: "UNVERIFIED", verified_at: null });

    const replay = await verifying(worker!, f.jobId, proof);
    expect(replay.status).toBe(200);
    expect(json(replay)).toEqual(body);
    expect(await jobRow(f.jobId)).toEqual(row);
    expect(await connectionRow(f.connectionId)).toEqual(connection);
    expect(await audits(f.connectionId)).toEqual([]);
  });

  it.each([
    ["a rotation", "rotate", "CREDENTIAL_VERSION_INELIGIBLE"],
    ["a disconnect", "disconnect", "CONNECTION_INELIGIBLE"],
    ["a disabled connection", "disable", "CONNECTION_INELIGIBLE"],
    ["a disabled account", "disableAccount", "ACCOUNT_INELIGIBLE"],
  ] as const)("fails closed after %s committed before the barrier", async (_label, change, reason) => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await granted(worker!, f);
    await lifecycle[change](f);
    expectRejected(await verifying(worker!, f.jobId, proof), "WORKER_PROVIDER_VERIFICATION_VERIFYING_REJECTED", reason, f.jobId);
    const row = await jobRow(f.jobId);
    expect(row.state).toBe("LEASED");
    expect(row.verifying_at).toBeNull();
    expect((await connectionRow(f.connectionId)).last_verification_attempt_at).toBeNull();
  });

  // Lost response: the first barrier committed, a lifecycle change committed
  // afterwards, and the worker repeats the exact request. The committed
  // authority is recovered, never re-judged and never rewritten.
  it.each([
    ["a rotation", "rotate"],
    ["a disconnect", "disconnect"],
    ["a disabled connection", "disable"],
    ["a RETAINED_FOR_RECOVERY version", "retain"],
    ["a disabled account", "disableAccount"],
  ] as const)("recovers the committed barrier acknowledgement after %s committed post-barrier", async (_label, change) => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await granted(worker!, f);
    const first = await verifying(worker!, f.jobId, proof);
    expect(first.status).toBe(200);
    await lifecycle[change](f);
    const job = await jobRow(f.jobId);
    const connection = await connectionRow(f.connectionId);

    const replay = await verifying(worker!, f.jobId, proof);
    expect(replay.status).toBe(200);
    expect(replay.body).toBe(first.body);
    expect(await jobRow(f.jobId)).toEqual(job);
    expect(await connectionRow(f.connectionId)).toEqual(connection);
    expect(await audits(f.connectionId)).toEqual([]);
  });

  it("fails a barrier replay closed only when the bound version was DESTROYED", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await atBarrier(worker!, f);
    await lifecycle.destroy(f);
    const job = await jobRow(f.jobId);
    expectRejected(await verifying(worker!, f.jobId, proof), "WORKER_PROVIDER_VERIFICATION_VERIFYING_REJECTED", "VERIFYING_VERSION_DESTROYED", f.jobId);
    expect(await jobRow(f.jobId)).toEqual(job);
  });

  it("refuses a wrong worker, token or fence, before and after the barrier", async () => {
    const [worker, other] = await begin(2);
    const f = await fixture();
    const proof = await granted(worker!, f);
    const type = "WORKER_PROVIDER_VERIFICATION_VERIFYING_REJECTED" as const;
    expectRejected(await verifying(other!, f.jobId, proof), type, "OTHER_WORKER", f.jobId);
    expectRejected(await verifying(worker!, f.jobId, { ...proof, leaseToken: otherToken() }), type, "TOKEN_MISMATCH", f.jobId);
    expectRejected(await verifying(worker!, f.jobId, { ...proof, fencingCounter: 3 }), type, "FENCING_MISMATCH", f.jobId);
    expect((await verifying(worker!, f.jobId, proof)).status).toBe(200);
    const crossed = await jobRow(f.jobId);
    expectRejected(await verifying(other!, f.jobId, proof), type, "OTHER_WORKER", f.jobId);
    expectRejected(await verifying(worker!, f.jobId, { ...proof, leaseToken: otherToken() }), type, "TOKEN_MISMATCH", f.jobId);
    expect(await jobRow(f.jobId)).toEqual(crossed);
  });
});

describe("terminal result: request contract", () => {
  it("rejects malformed bodies and unknown or reconciler-only vocabulary with 400 before any lifecycle work", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await atBarrier(worker!, f);
    const before = await jobRow(f.jobId);
    const eventsBefore = events.length;
    const path = `${BASE}/${f.jobId}/result`;
    for (const body of [
      { ...proof, outcome: "VERIFIED" },
      { ...proof, reasonCode: "VERIFICATION_SUCCEEDED" },
      { ...proof, outcome: "VERIFIED", reasonCode: "VERIFICATION_SUCCEEDED", extra: true },
      { ...proof, outcome: "SUCCEEDED", reasonCode: "VERIFICATION_SUCCEEDED" },
      { ...proof, outcome: "VERIFIED", reasonCode: "CREDENTIAL_ACCEPTED" },
      { ...proof, outcome: "INCONCLUSIVE", reasonCode: "WORKER_LOST_AFTER_CREDENTIAL_GRANT" },
      { ...proof, outcome: "INCONCLUSIVE", reasonCode: "WORKER_LOST_DURING_VERIFYING" },
      { ...proof, fencingCounter: 0, outcome: "VERIFIED", reasonCode: "VERIFICATION_SUCCEEDED" },
      { ...proof, leaseToken: "x", outcome: "VERIFIED", reasonCode: "VERIFICATION_SUCCEEDED" },
    ]) {
      const response = await post(worker!, path, body);
      expect(response.status).toBe(400);
      expect(response.body).toBe(INVALID);
    }
    expect(await jobRow(f.jobId)).toEqual(before);
    expect(events.length).toBe(eventsBefore);
    expect(await audits(f.connectionId)).toEqual([]);
  });

  it("classifies a recognised but mismatched pair only after authority, and mutates nothing", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await atBarrier(worker!, f);
    const before = await jobRow(f.jobId);
    const connectionBefore = await connectionRow(f.connectionId);
    const type = "WORKER_PROVIDER_VERIFICATION_RESULT_REJECTED" as const;
    // Without authority the mismatch is never what is reported.
    expectRejected(await result(worker!, f.jobId, { ...proof, leaseToken: otherToken() }, "VERIFIED", "CREDENTIAL_REJECTED"), type, "TOKEN_MISMATCH", f.jobId);
    for (const [outcome] of PAIRS) {
      for (const [otherOutcome, reason] of PAIRS) {
        if (otherOutcome === outcome) continue;
        expectRejected(await result(worker!, f.jobId, proof, outcome, reason), type, "REASON_CODE_OUTCOME_MISMATCH", f.jobId);
      }
    }
    expect(await jobRow(f.jobId)).toEqual(before);
    expect(await connectionRow(f.connectionId)).toEqual(connectionBefore);
    expect(await audits(f.connectionId)).toEqual([]);
  });

  it("refuses a result for a job that has not crossed the barrier", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await granted(worker!, f);
    expectRejected(await result(worker!, f.jobId, proof, "VERIFIED", "VERIFICATION_SUCCEEDED"), "WORKER_PROVIDER_VERIFICATION_RESULT_REJECTED", "NOT_VERIFYING", f.jobId);
    expect((await jobRow(f.jobId)).state).toBe("LEASED");
  });

  it("requires the live lease and the exact worker and fence that crossed the barrier", async () => {
    const [worker, other] = await begin(2);
    const f = await fixture();
    const proof = await atBarrier(worker!, f);
    const type = "WORKER_PROVIDER_VERIFICATION_RESULT_REJECTED" as const;
    expectRejected(await result(other!, f.jobId, proof, "VERIFIED", "VERIFICATION_SUCCEEDED"), type, "OTHER_WORKER", f.jobId);
    expectRejected(await result(worker!, f.jobId, { ...proof, fencingCounter: 2 }, "VERIFIED", "VERIFICATION_SUCCEEDED"), type, "FENCING_MISMATCH", f.jobId);
    expectRejected(await result(worker!, f.jobId, { ...proof, leaseToken: otherToken() }, "VERIFIED", "VERIFICATION_SUCCEEDED"), type, "TOKEN_MISMATCH", f.jobId);
    expect((await jobRow(f.jobId)).state).toBe("VERIFYING");
  });
});

describe("terminal result: first transition and aggregate", () => {
  it("records VERIFIED / VERIFICATION_SUCCEEDED, verifies the current version and audits exactly once", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await atBarrier(worker!, f);
    const barrier = await jobRow(f.jobId);
    const response = await result(worker!, f.jobId, proof, "VERIFIED", "VERIFICATION_SUCCEEDED");
    expect(response.status).toBe(200);
    const body = json(response);
    expect(Object.keys(body).sort()).toEqual(["completedAt", "fencingCounter", "outcome", "providerVerificationJobId", "reasonCode", "state"]);
    expect(body).toMatchObject({ providerVerificationJobId: f.jobId, fencingCounter: 1, state: "COMPLETED", outcome: "VERIFIED", reasonCode: "VERIFICATION_SUCCEEDED" });
    expect(/lease|token|sealed|envelope|fingerprint|worker/i.test(response.body)).toBe(false);

    const row = await jobRow(f.jobId);
    expect(row).toMatchObject({
      state: "COMPLETED",
      result_outcome: "VERIFIED",
      terminal_reason_code: "VERIFICATION_SUCCEEDED",
      result_worker_principal_id: worker!.id,
      result_fencing_counter: "1",
      // Live lease proof cleared; verifying provenance and fencing history kept.
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      leased_at: null,
      lease_expires_at: null,
      lease_fencing_counter: "1",
      verifying_worker_principal_id: worker!.id,
      verifying_fencing_counter: "1",
    });
    expect(row.verifying_at).toEqual(barrier.verifying_at);
    expect(row.credential_granted_at).toEqual(barrier.credential_granted_at);
    expect(new Date(body.completedAt).getTime()).toBe(row.completed_at!.getTime());

    const connection = await connectionRow(f.connectionId);
    expect(connection).toMatchObject({ status: "ACTIVE", verification_status: "VERIFIED" });
    expect(connection.verified_at).toEqual(row.completed_at);
    expect(connection.last_verification_attempt_at).toEqual(barrier.verifying_at);

    expect(await audits(f.connectionId)).toEqual([
      {
        event_type: "provider_connection.verified",
        actor_type: "SYSTEM",
        actor_user_id: null,
        metadata: { provider: PROVIDER, credentialVersion: 1, verificationJobId: f.jobId, verificationPolicyId: POLICY, outcome: "VERIFIED", reasonCode: "VERIFICATION_SUCCEEDED" },
      },
    ]);
    expect(await occurrences(proof.leaseToken)).toBe(0);
    expect(await occurrences(f.plaintext)).toBe(0);
    expect(await generationRows()).toBe(0);
  });

  it.each(["CREDENTIAL_REJECTED", "CREDENTIAL_NOT_AUTHORIZED"])("records DEFINITIVE_FAILURE / %s and invalidates the current version", async (reason) => {
    const [worker] = await begin(1);
    const f = await fixture({ verified: true });
    const proof = await atBarrier(worker!, f);
    expect((await result(worker!, f.jobId, proof, "DEFINITIVE_FAILURE", reason)).status).toBe(200);
    expect(await connectionRow(f.connectionId)).toMatchObject({ status: "INVALID", verification_status: "FAILED", verified_at: null });
    const recorded = await audits(f.connectionId);
    expect(recorded.map((event) => event.event_type)).toEqual(["provider_connection.verification_failed"]);
    expect(recorded[0]!.metadata).toMatchObject({ outcome: "DEFINITIVE_FAILURE", reasonCode: reason });
  });

  it("accepts every closed INCONCLUSIVE reason and never invalidates a verified connection", async () => {
    const [worker] = await begin(1);
    for (const reason of INCONCLUSIVE_REASONS) {
      const f = await fixture({ verified: true });
      const before = await connectionRow(f.connectionId);
      const proof = await atBarrier(worker!, f);
      const response = await result(worker!, f.jobId, proof, "INCONCLUSIVE", reason);
      expect(response.status).toBe(200);
      expect(json(response)).toMatchObject({ outcome: "INCONCLUSIVE", reasonCode: reason });
      const after = await connectionRow(f.connectionId);
      expect(after).toMatchObject({ status: "ACTIVE", verification_status: "VERIFIED" });
      expect(after.verified_at).toEqual(before.verified_at);
      expect(after.last_verification_attempt_at!.getTime()).toBeGreaterThan(before.last_verification_attempt_at!.getTime());
      expect((await audits(f.connectionId)).map((event) => [event.event_type, event.metadata.reasonCode])).toEqual([
        ["provider_connection.verification_inconclusive", reason],
      ]);
    }
  });

  it.each([
    ["a rotation", "rotate", "VERIFIED", "VERIFICATION_SUCCEEDED", { status: "PENDING_VERIFICATION", verification_status: "UNVERIFIED" }],
    ["a disconnect", "disconnect", "VERIFIED", "VERIFICATION_SUCCEEDED", { status: "DISCONNECTED", verification_status: "UNVERIFIED" }],
    ["a disabled connection", "disable", "DEFINITIVE_FAILURE", "CREDENTIAL_REJECTED", { status: "DISABLED", verification_status: "UNVERIFIED" }],
    ["a retained version", "retain", "VERIFIED", "VERIFICATION_SUCCEEDED", { status: "PENDING_VERIFICATION", verification_status: "UNVERIFIED" }],
  ] as const)("records a stale result after %s without mutating the aggregate", async (_label, change, outcome, reason, expected) => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await atBarrier(worker!, f);
    await lifecycle[change](f);
    const before = await connectionRow(f.connectionId);
    const response = await result(worker!, f.jobId, proof, outcome, reason);
    expect(response.status).toBe(200);
    expect((await jobRow(f.jobId))).toMatchObject({ state: "COMPLETED", result_outcome: outcome, terminal_reason_code: reason });
    const after = await connectionRow(f.connectionId);
    expect(after).toEqual(before);
    expect(after).toMatchObject({ ...expected, verified_at: null });
    const recorded = await audits(f.connectionId);
    expect(recorded.map((event) => event.event_type)).toEqual(["provider_connection.verification_result_stale"]);
    expect(recorded[0]!.metadata).toMatchObject({ verificationJobId: f.jobId, credentialVersion: 1, outcome, reasonCode: reason });
  });
});

describe("terminal result: Account status is not staleness", () => {
  it.each([
    ["VERIFIED", "VERIFICATION_SUCCEEDED", "provider_connection.verified", { status: "ACTIVE", verification_status: "VERIFIED" }],
    ["DEFINITIVE_FAILURE", "CREDENTIAL_REJECTED", "provider_connection.verification_failed", { status: "INVALID", verification_status: "FAILED" }],
  ] as const)("still applies a same-current %s result after the Account was disabled post-barrier", async (outcome, reason, eventType, expected) => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await atBarrier(worker!, f);
    await lifecycle.disableAccount(f);
    expect((await result(worker!, f.jobId, proof, outcome, reason)).status).toBe(200);
    const job = await jobRow(f.jobId);
    const connection = await connectionRow(f.connectionId);
    expect(connection).toMatchObject(expected);
    expect(connection.verified_at).toEqual(outcome === "VERIFIED" ? job.completed_at : null);
    expect((await audits(f.connectionId)).map((event) => event.event_type)).toEqual([eventType]);
  });
});

describe("terminal result: exact replay", () => {
  it("replays the exact tuple with no write, no aggregate change and no audit; the token is not authority", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await atBarrier(worker!, f);
    const first = await result(worker!, f.jobId, proof, "VERIFIED", "VERIFICATION_SUCCEEDED");
    const job = await jobRow(f.jobId);
    const connection = await connectionRow(f.connectionId);
    for (const replayProof of [proof, { ...proof, leaseToken: otherToken() }]) {
      const replay = await result(worker!, f.jobId, replayProof, "VERIFIED", "VERIFICATION_SUCCEEDED");
      expect(replay.status).toBe(200);
      expect(replay.body).toBe(first.body);
    }
    expect(await jobRow(f.jobId)).toEqual(job);
    expect(await connectionRow(f.connectionId)).toEqual(connection);
    expect(await audits(f.connectionId)).toHaveLength(1);
  });

  it("fails closed for a different principal, fence, outcome or reason", async () => {
    const [worker, other] = await begin(2);
    const f = await fixture();
    const proof = await atBarrier(worker!, f);
    expect((await result(worker!, f.jobId, proof, "INCONCLUSIVE", "PROVIDER_TIMEOUT")).status).toBe(200);
    const job = await jobRow(f.jobId);
    const type = "WORKER_PROVIDER_VERIFICATION_RESULT_REJECTED" as const;
    expectRejected(await result(other!, f.jobId, proof, "INCONCLUSIVE", "PROVIDER_TIMEOUT"), type, "VERIFYING_PRINCIPAL_MISMATCH", f.jobId);
    expectRejected(await result(worker!, f.jobId, { ...proof, fencingCounter: 2 }, "INCONCLUSIVE", "PROVIDER_TIMEOUT"), type, "FENCING_MISMATCH", f.jobId);
    expectRejected(await result(worker!, f.jobId, proof, "INCONCLUSIVE", "PROVIDER_UNAVAILABLE"), type, "VERIFICATION_RESULT_CONFLICT", f.jobId);
    expectRejected(await result(worker!, f.jobId, proof, "VERIFIED", "VERIFICATION_SUCCEEDED"), type, "VERIFICATION_RESULT_CONFLICT", f.jobId);
    expectRejected(await result(worker!, f.jobId, proof, "DEFINITIVE_FAILURE", "CREDENTIAL_REJECTED"), type, "VERIFICATION_RESULT_CONFLICT", f.jobId);
    expect(await jobRow(f.jobId)).toEqual(job);
    expect(await audits(f.connectionId)).toHaveLength(1);
  });

  it("never treats a reconciliation-written terminal result as worker replay authority", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await atBarrier(worker!, f);
    // Simulates the Phase 4 expired-VERIFYING convergence permitted by migration 0010.
    await clients.migrator.query(
      `UPDATE provider_verification_jobs
          SET state = 'COMPLETED', lease_worker_principal_id = NULL, lease_token_sha256 = NULL, leased_at = NULL, lease_expires_at = NULL,
              result_outcome = 'INCONCLUSIVE', terminal_reason_code = 'WORKER_LOST_DURING_VERIFYING',
              result_worker_principal_id = verifying_worker_principal_id, result_fencing_counter = verifying_fencing_counter,
              completed_at = now(), updated_at = now()
        WHERE id = $1`,
      [f.jobId],
    );
    const job = await jobRow(f.jobId);
    expect((await result(worker!, f.jobId, proof, "INCONCLUSIVE", "WORKER_LOST_DURING_VERIFYING")).status).toBe(400);
    for (const reason of INCONCLUSIVE_REASONS) {
      expectRejected(await result(worker!, f.jobId, proof, "INCONCLUSIVE", reason), "WORKER_PROVIDER_VERIFICATION_RESULT_REJECTED", "VERIFICATION_RESULT_CONFLICT", f.jobId);
    }
    expect(await jobRow(f.jobId)).toEqual(job);
    expect(await audits(f.connectionId)).toEqual([]);
  });
});

describe("terminal result: atomicity", () => {
  it("rolls back the terminal job write and the aggregate together when the audit insert fails", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const proof = await atBarrier(worker!, f);
    const job = await jobRow(f.jobId);
    const connection = await connectionRow(f.connectionId);

    let auditAttempts = 0;
    const failingPool: TransactionalPool = {
      query: pool.query,
      end: pool.end,
      connect: async () => {
        const client = await pool.connect();
        const wrapped: RuntimeClient = {
          query: (async (sql: string, values?: unknown[]) => {
            if (sql.includes("INSERT INTO audit_events")) {
              auditAttempts += 1;
              throw Object.assign(new Error("fixture audit failure"), { code: "XX000" });
            }
            return client.query(sql, values);
          }) as RuntimeClient["query"],
          release: (error?: Error) => client.release(error),
        };
        return wrapped;
      },
    };
    await expect(
      reportProviderVerificationResult(failingPool, { workerPrincipalId: worker!.id, correlationId: randomUUID() }, f.jobId, proof, "VERIFIED", "VERIFICATION_SUCCEEDED"),
    ).rejects.toMatchObject({ code: "WORKER_CONTROL_DATABASE_FAILURE" });
    expect(auditAttempts).toBe(1);
    expect(await jobRow(f.jobId)).toEqual(job);
    expect(await connectionRow(f.connectionId)).toEqual(connection);
    expect(await audits(f.connectionId)).toEqual([]);

    // The same live authority then commits normally, exactly once.
    expect((await result(worker!, f.jobId, proof, "VERIFIED", "VERIFICATION_SUCCEEDED")).status).toBe(200);
    expect((await connectionRow(f.connectionId)).verification_status).toBe("VERIFIED");
    expect(await audits(f.connectionId)).toHaveLength(1);
  });
});

describe("lease expiry gives no worker authority (database clock)", () => {
  it(
    "refuses grant, barrier and result once the 30-second lease has expired, and never terminalises the VERIFYING job",
    async () => {
      const [a, b, c] = await begin(3);
      const leasedOnly = await fixture();
      const leasedProof = await leased(a!, leasedOnly);
      const grantedOnly = await fixture();
      const grantedProof = await granted(b!, grantedOnly);
      const verifyingJob = await fixture();
      const verifyingProof = await atBarrier(c!, verifyingJob);
      const verifyingRow = await jobRow(verifyingJob.jobId);

      // Real database time passes; no lease timestamp is altered.
      await clients.migrator.query("SELECT pg_sleep(31)");

      expectRejected(await grant(a!, leasedOnly.jobId, leasedProof), "WORKER_PROVIDER_VERIFICATION_GRANT_REJECTED", "LEASE_EXPIRED", leasedOnly.jobId);
      expectRejected(await grant(b!, grantedOnly.jobId, grantedProof), "WORKER_PROVIDER_VERIFICATION_GRANT_REJECTED", "LEASE_EXPIRED", grantedOnly.jobId);
      expectRejected(await verifying(b!, grantedOnly.jobId, grantedProof), "WORKER_PROVIDER_VERIFICATION_VERIFYING_REJECTED", "LEASE_EXPIRED", grantedOnly.jobId);
      expectRejected(
        await result(c!, verifyingJob.jobId, verifyingProof, "VERIFIED", "VERIFICATION_SUCCEEDED"),
        "WORKER_PROVIDER_VERIFICATION_RESULT_REJECTED",
        "LEASE_EXPIRED",
        verifyingJob.jobId,
      );
      expect(await jobRow(verifyingJob.jobId)).toEqual(verifyingRow);
      expect((await jobRow(leasedOnly.jobId)).credential_granted_at).toBeNull();
      expect((await jobRow(grantedOnly.jobId)).state).toBe("LEASED");
      expect(await audits(verifyingJob.connectionId)).toEqual([]);
    },
    60_000,
  );
});

describe("worker-control boundary for verification routes", () => {
  it("refuses customer-style credentials and Origin before any verification operation, without CORS or cookies", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const customer = await send(port, "POST", LEASE_PATH, undefined, { Authorization: "Bearer fixture-alice" });
    expect(customer.status).toBe(401);
    const origin = await send(port, "POST", LEASE_PATH, undefined, { Authorization: `Bearer ${worker!.token}`, Origin: "https://app.example" });
    expect(origin.status).toBe(403);
    for (const response of [customer, origin]) {
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    expect((await jobRow(f.jobId)).state).toBe("QUEUED");
    expect(events.map((event) => event.type)).toEqual(["WORKER_AUTH_REJECTED", "WORKER_ORIGIN_REJECTED"]);
  });

  it("runs the whole lifecycle with no generation side effects and no secret or lease internals in any response", async () => {
    const [worker] = await begin(1);
    const f = await fixture();
    const acquired = (await lease(worker!))!;
    const proof = proofOf(acquired);
    const responses = [
      await grant(worker!, f.jobId, proof),
      await verifying(worker!, f.jobId, proof),
      await result(worker!, f.jobId, proof, "VERIFIED", "VERIFICATION_SUCCEEDED"),
    ];
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    const fingerprint = await one<{ fingerprint_value: string }>("SELECT fingerprint_value FROM provider_credential_versions WHERE id = $1", [f.versionId]);
    for (const response of responses) {
      expect(response.body.includes(proof.leaseToken)).toBe(false);
      expect(response.body.includes(sha256Hex(proof.leaseToken))).toBe(false);
      expect(response.body.includes(f.plaintext)).toBe(false);
      expect(response.body.includes(fingerprint.fingerprint_value)).toBe(false);
    }
    // Only the grant carries the sealed envelope.
    expect(responses.map((response) => response.body.includes("sealedEnvelope"))).toEqual([true, false, false]);
    expect(await generationRows()).toBe(0);
    expect(JSON.stringify(events).includes(proof.leaseToken)).toBe(false);
  });
});
