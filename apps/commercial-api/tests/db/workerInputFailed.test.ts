import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type RuntimeClient, type TransactionalPool } from "../../src/database/runtimePool.js";
import { readCredentialObligations } from "../../src/providerConnections/credentialObligations.js";
import { PROVIDER_CREDENTIAL_PURPOSE } from "commercial-worker-protocol";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../src/startCommercialApiServer.js";
import { createWorkerControlApplication } from "../../src/workerControl/workerControlApplication.js";
import { INPUT_FAILURE_CODES } from "../../src/workerControl/workerInputFailedService.js";
import type { WorkerSecurityEvent } from "../../src/workerControl/workerSecurityEvents.js";
import { send, type TestResponse } from "../httpClient.js";
import { createTestCredentialFingerprinter, createTestCredentialSealer, generateTestKey } from "../support/testCredentialCrypto.js";
import { createTestWorkerAuthenticationAdapter } from "../support/testWorkerAuthentication.js";
import { createRecordingWorkerSecurityEventSink } from "../support/testWorkerSecurityEvents.js";
import { insertAccountWithFreeGrant, openGuardedClients, prepareSchemaV1, type GuardedClients } from "./support/testDatabase.js";

// R44B10P2 input-failed report against PostgreSQL 16, over the explicitly
// composed worker-control router (architecture section 18, "input-failed
// route"). A granted, live LEASED attempt with a permanent pre-provider input
// failure becomes FAILED_BEFORE_SUBMISSION with no SUBMITTING barrier. No
// provider is called and no credential is opened. Assertions on secrets are
// booleans, so a failure never prints one.

let clients: GuardedClients;
let pool: TransactionalPool;
let server: RunningCommercialApiServer | undefined;
let events: WorkerSecurityEvent[];
let setSinkFailing: (failing: boolean) => void;

const encryptionKey = generateTestKey("input-failed-test-encryption/v1");
const sealer = createTestCredentialSealer(encryptionKey);
const fingerprinter = createTestCredentialFingerprinter(generateTestKey("input-failed-test-fingerprint/v1"), encryptionKey);

beforeAll(async () => {
  clients = await openGuardedClients();
  const config = loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl, COMMERCIAL_API_DATABASE_POOL_MAX: "10" }, "development");
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
    const id = (await clients.migrator.query<{ id: string }>("INSERT INTO worker_principals (label) VALUES ($1) RETURNING id", [`input-worker-${index}`])).rows[0]!.id;
    list.push({ id, token: `fixture-worker-${randomBytes(16).toString("hex")}` });
  }
  return list;
}

type Work = Readonly<{ accountId: string; versionId: string; jobId: string; attemptId: string; plaintext: string }>;

const q = <T extends object>(sql: string, params: unknown[]) => clients.migrator.query<T>(sql, params).then((result) => result.rows[0]!);

// One claimed authorization bound to the exact sealed version 1, with its job and QUEUED attempt.
async function work(): Promise<Work> {
  const provider = "EXAMPLE_PROVIDER";
  const owner = await insertAccountWithFreeGrant(clients.migrator, `input-${randomUUID()}`);
  const production = await q<{ id: string }>(
    "INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id) VALUES ($1, 'Production', $2, $3) RETURNING id",
    [owner.accountId, owner.grantId, owner.userId],
  );
  const connection = await q<{ id: string }>(
    "INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id) VALUES ($1, $2, 'API_KEY', $3) RETURNING id",
    [owner.accountId, provider, owner.userId],
  );
  const plaintext = `fixture-credential-${randomBytes(18).toString("hex")}`;
  const envelope = await sealer.seal(plaintext, { accountId: owner.accountId, providerConnectionId: connection.id, provider, credentialVersion: 1, purpose: PROVIDER_CREDENTIAL_PURPOSE });
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
    [owner.accountId, production.id, owner.grantId, provider, connection.id, version.id, owner.userId],
  );
  await clients.migrator.query("UPDATE generation_authorizations SET status = 'CLAIMED', claimed_at = now() WHERE id = $1", [authorization.id]);
  const job = await q<{ id: string }>(
    "INSERT INTO execution_jobs (account_id, production_id, generation_authorization_id) VALUES ($1, $2, $3) RETURNING id",
    [owner.accountId, production.id, authorization.id],
  );
  const attempt = await q<{ id: string }>(
    `INSERT INTO execution_attempts (account_id, execution_job_id, generation_authorization_id, attempt_number, billing_mode, provider, provider_credential_version_id)
     VALUES ($1, $2, $3, 1, 'USER_BYO', $4, $5) RETURNING id`,
    [owner.accountId, job.id, authorization.id, provider, version.id],
  );
  return { accountId: owner.accountId, versionId: version.id, jobId: job.id, attemptId: attempt.id, plaintext };
}

async function compose(list: readonly Worker[], poolOverride: TransactionalPool = pool) {
  const recording = createRecordingWorkerSecurityEventSink();
  events = recording.events;
  setSinkFailing = recording.setFailing;
  const application = createWorkerControlApplication({
    authentication: createTestWorkerAuthenticationAdapter(list.map((worker) => ({ token: worker.token, workerPrincipalId: worker.id }))),
    securityEvents: recording.sink,
    pool: poolOverride,
    reportFailure: () => {},
  });
  server = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { application, checkReadiness: async () => true } });
  return server.port;
}

// A pool that records every statement its sessions send.
function recordingPool() {
  const statements: string[] = [];
  const wrapped: TransactionalPool = {
    query: pool.query,
    end: async () => {},
    connect: async () => {
      const inner = await pool.connect();
      return {
        release: (error?: Error) => inner.release(error),
        query: async <Row extends object>(sql: string, params?: unknown[]) => {
          statements.push(sql);
          return inner.query<Row>(sql, params);
        },
      };
    },
  };
  return { pool: wrapped, statements };
}

// A pool whose first session pauses at the first statement matching `pause`
// until released, holding whatever locks its transaction already has.
function gatedPool(pause: (sql: string) => boolean) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let reached!: () => void;
  const paused = new Promise<void>((resolve) => (reached = resolve));
  let used = false;
  const wrapped: TransactionalPool = {
    query: pool.query,
    end: async () => {},
    connect: async () => {
      const inner = await pool.connect();
      const client: RuntimeClient = {
        release: (error?: Error) => inner.release(error),
        query: async <Row extends object>(sql: string, params?: unknown[]) => {
          if (!used && pause(sql)) {
            used = true;
            reached();
            await gate;
          }
          return inner.query<Row>(sql, params);
        },
      };
      return client;
    },
  };
  return { pool: wrapped, paused, release };
}

// ---------------------------------------------------------------------------
// HTTP helpers

const auth = (worker: Worker) => ({ Authorization: `Bearer ${worker.token}` });
const json = (response: TestResponse) => JSON.parse(response.body) as Record<string, unknown>;
type Proof = { fencingCounter: number; leaseToken: string };

async function leaseFor(port: number, worker: Worker): Promise<Proof & { attemptId: string }> {
  const response = await send(port, "POST", "/worker-control/v1/leases", undefined, auth(worker));
  expect(response.status).toBe(200);
  const body = json(response).lease as Record<string, unknown>;
  return { attemptId: body.executionAttemptId as string, fencingCounter: body.fencingCounter as number, leaseToken: body.leaseToken as string };
}
const call = (port: number, worker: Worker, action: string, attemptId: string, body: Record<string, unknown>, extra: Record<string, string> = {}) =>
  send(port, "POST", `/worker-control/v1/attempts/${attemptId}/${action}`, JSON.stringify(body), { ...auth(worker), "Content-Type": "application/json", ...extra });
const proofBody = (proof: Proof) => ({ fencingCounter: proof.fencingCounter, leaseToken: proof.leaseToken });

// Lease and receive the credential grant: a granted, live LEASED attempt.
async function granted(port: number, worker: Worker) {
  const proof = await leaseFor(port, worker);
  expect((await call(port, worker, "credential-grant", proof.attemptId, proofBody(proof))).status).toBe(200);
  return proof;
}
const report = (port: number, worker: Worker, attemptId: string, proof: Proof, failureCode: string) =>
  call(port, worker, "input-failed", attemptId, { ...proofBody(proof), failureCode });

const FULL_ROW = `SELECT state, failure_code, completed_at, updated_at, submitting_at, submitting_worker_principal_id, submitting_fencing_counter,
                         provider_execution_id, submitted_at, lease_worker_principal_id, lease_token_sha256, lease_fencing_counter, leased_at,
                         lease_expires_at, heartbeat_at, credential_granted_at, recovery_expires_at,
                         input_failed_worker_principal_id, input_failed_fencing_counter
                    FROM execution_attempts WHERE id = $1`;
type Row = Record<string, unknown> & { state: string; failure_code: string | null; completed_at: Date | null };
const row = async (id: string) => (await clients.migrator.query<Row>(FULL_ROW, [id])).rows[0]!;
const job = async (id: string) =>
  (await clients.migrator.query<{ status: string; completed_at: Date | null; updated_at: Date }>("SELECT status, completed_at, updated_at FROM execution_jobs WHERE id = $1", [id])).rows[0]!;
const audits = async (attemptId: string) =>
  (
    await clients.migrator.query<{ event_type: string; metadata: Record<string, unknown> }>(
      "SELECT event_type, metadata FROM audit_events WHERE resource_id = $1 ORDER BY sequence",
      [attemptId],
    )
  ).rows.map(({ event_type, metadata }) => [event_type, metadata] as const);
const inputAudits = async (attemptId: string) => (await audits(attemptId)).filter(([type]) => type === "execution_attempt.input_failed");
const allAuditText = async () => (await clients.migrator.query<{ text: string | null }>("SELECT string_agg(audit_events::text, '\n') AS text FROM audit_events")).rows[0]!.text ?? "";
const obligations = async (item: Work) => {
  const client = await pool.connect();
  try {
    return (await readCredentialObligations(client, item.accountId, [item.versionId])).get(item.versionId);
  } finally {
    client.release();
  }
};
const eventSummary = () => events.map((event) => [event.type, event.reason]);
const expireLease = (attemptId: string) =>
  clients.migrator.query(
    "UPDATE execution_attempts SET leased_at = now() - interval '10 minutes', heartbeat_at = now() - interval '10 minutes', lease_expires_at = now() - interval '1 second' WHERE id = $1",
    [attemptId],
  );

const REJECTED = '{"status":"error","code":"LEASE_REJECTED"}\n';
const INVALID = '{"status":"error","code":"INVALID_REQUEST"}\n';
const ACK_MEMBERS = ["executionAttemptId", "fencingCounter", "state", "failureCode"];

// ---------------------------------------------------------------------------

describe("first transition", () => {
  it("fails a granted live LEASED attempt before submission, fails the job, clears the lease and closes the obligations", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    const before = await row(item.attemptId);
    expect(before).toMatchObject({ state: "LEASED", submitting_at: null, input_failed_worker_principal_id: null, input_failed_fencing_counter: null });
    expect(before.credential_granted_at).toBeInstanceOf(Date);
    expect(await obligations(item)).toEqual({ hasOpenCredentialRetentionObligation: true, hasOpenProviderRecoveryObligation: false, blocksDestruction: true });

    const response = await report(port, worker!, item.attemptId, proof, "INPUT_REFERENCE_INVALID");
    expect(response.status).toBe(200);
    expect(json(response)).toEqual({ executionAttemptId: item.attemptId, fencingCounter: 1, state: "FAILED_BEFORE_SUBMISSION", failureCode: "INPUT_REFERENCE_INVALID" });
    expect(Object.keys(json(response))).toEqual(ACK_MEMBERS);

    const after = await row(item.attemptId);
    expect(after).toMatchObject({
      state: "FAILED_BEFORE_SUBMISSION",
      failure_code: "INPUT_REFERENCE_INVALID",
      // No SUBMITTING barrier and no provider field fabricated.
      submitting_at: null,
      submitting_worker_principal_id: null,
      submitting_fencing_counter: null,
      provider_execution_id: null,
      submitted_at: null,
      recovery_expires_at: null,
      // The lease is cleared field by field.
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      leased_at: null,
      lease_expires_at: null,
      heartbeat_at: null,
      // The guard-stamped reporter and its epoch.
      input_failed_worker_principal_id: worker!.id,
      input_failed_fencing_counter: "1",
    });
    expect(after.completed_at).toBeInstanceOf(Date);
    // The retained fencing counter and the historical grant are kept.
    expect(after.lease_fencing_counter).toEqual(before.lease_fencing_counter);
    expect(after.credential_granted_at).toEqual(before.credential_granted_at);

    const parent = await job(item.jobId);
    expect(parent.status).toBe("FAILED");
    expect(parent.completed_at).toBeInstanceOf(Date);
    // No automatic new attempt.
    expect((await clients.migrator.query("SELECT id FROM execution_attempts WHERE execution_job_id = $1", [item.jobId])).rows).toHaveLength(1);
    expect(await inputAudits(item.attemptId)).toEqual([
      [
        "execution_attempt.input_failed",
        { attemptNumber: 1, fencingCounter: 1, workerPrincipalId: worker!.id, provider: "EXAMPLE_PROVIDER", credentialVersion: 1, failureCode: "INPUT_REFERENCE_INVALID" },
      ],
    ]);
    // Never a provider rejection or a provider-side outcome.
    expect((await audits(item.attemptId)).map(([type]) => type)).toEqual([
      "execution_attempt.leased",
      "execution_attempt.credential_granted",
      "execution_attempt.input_failed",
    ]);
    expect(events).toEqual([]);
    expect(await obligations(item)).toEqual({ hasOpenCredentialRetentionObligation: false, hasOpenProviderRecoveryObligation: false, blocksDestruction: false });
    const visible = (await allAuditText()) + JSON.stringify(events) + response.body;
    expect(visible.includes(proof.leaseToken) || visible.includes(item.plaintext) || visible.includes(worker!.token)).toBe(false);
  });

  it.each(INPUT_FAILURE_CODES)("persists %s exactly and replays it exactly", async (code) => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    const first = await report(port, worker!, item.attemptId, proof, code);
    expect(first.status).toBe(200);
    expect(json(first)).toEqual({ executionAttemptId: item.attemptId, fencingCounter: 1, state: "FAILED_BEFORE_SUBMISSION", failureCode: code });
    expect(await row(item.attemptId)).toMatchObject({ state: "FAILED_BEFORE_SUBMISSION", failure_code: code });
    const replay = await report(port, worker!, item.attemptId, proof, code);
    expect(replay.status).toBe(200);
    expect(replay.body).toBe(first.body);
    expect(await inputAudits(item.attemptId)).toHaveLength(1);
  });

  it("frees the worker's lease capacity immediately", async () => {
    const [worker] = await workers(1);
    const first = await work();
    const second = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    const [failing, other] = proof.attemptId === first.attemptId ? [first, second] : [second, first];
    expect(failing.attemptId).toBe(proof.attemptId);
    // At its single-lease capacity, the worker can take nothing else.
    const atCapacity = await send(port, "POST", "/worker-control/v1/leases", undefined, auth(worker!));
    expect(atCapacity.status).toBe(409);
    expect(eventSummary()).toEqual([["WORKER_LEASE_REJECTED", "WORKER_AT_CAPACITY"]]);

    expect((await report(port, worker!, failing.attemptId, proof, "INPUT_OBJECT_NOT_FOUND")).status).toBe(200);
    const next = await leaseFor(port, worker!);
    expect(next.attemptId).toBe(other.attemptId);
    expect((await row(other.attemptId)).state).toBe("LEASED");
    expect((await row(failing.attemptId)).state).toBe("FAILED_BEFORE_SUBMISSION");
  });

  it("locks only the principal and the attempt, reads the exact version only for the audit, and reads no secret", async () => {
    const [worker] = await workers(1);
    await work();
    const leasePort = await compose([worker!]);
    const proof = await granted(leasePort, worker!);
    await server!.close();
    const recorded = recordingPool();
    const port = await compose([worker!], recorded.pool);
    expect((await report(port, worker!, proof.attemptId, proof, "INPUT_OBJECT_NOT_FOUND")).status).toBe(200);
    const locks = recorded.statements.filter((sql) => /FOR (SHARE|UPDATE)/.test(sql)).map((sql) => /FROM (\w+)/.exec(sql)![1]);
    expect(locks).toEqual(["worker_principals", "execution_attempts", "execution_attempts"]);
    expect(recorded.statements.some((sql) => /sealed_credential|fingerprint_|provider_connections/.test(sql))).toBe(false);
    expect(recorded.statements.filter((sql) => /provider_credential_versions/.test(sql))).toEqual([
      "SELECT credential_version FROM provider_credential_versions WHERE account_id = $1 AND id = $2",
    ]);
    // Never assigns the guard-stamped provenance, nor any SUBMITTING field.
    expect(recorded.statements.some((sql) => /^\s*UPDATE[\s\S]*(input_failed_\w+|submitting_\w+)\s*=/.test(sql))).toBe(false);
  });
});

describe("closed request vocabulary", () => {
  it.each([
    ["an unknown INPUT_ code", { failureCode: "INPUT_OBJECT_EXPIRED" }],
    ["a lowercase code", { failureCode: "input_object_not_found" }],
    ["a provider code", { failureCode: "PROVIDER_REJECTED_DEFINITIVELY" }],
    ["an ambiguity code", { failureCode: "PROVIDER_SUBMISSION_AMBIGUOUS" }],
    ["a storage worker code", { failureCode: "OBJECT_NOT_FOUND" }],
    ["a storage failure", { failureCode: "NOT_FOUND" }],
    ["the sweep-only code", { failureCode: "WORKER_LEASE_EXPIRED_DURING_SUBMISSION" }],
    ["a free-form code", { failureCode: "the image is missing" }],
    ["a non-string code", { failureCode: 7 }],
    ["a missing code", {}],
    ["an unknown member", { failureCode: "INPUT_OBJECT_NOT_FOUND", message: "missing" }],
    ["an account", { failureCode: "INPUT_OBJECT_NOT_FOUND", accountId: randomUUID() }],
    ["a provider", { failureCode: "INPUT_OBJECT_NOT_FOUND", provider: "EXAMPLE_PROVIDER" }],
    ["an object key", { failureCode: "INPUT_OBJECT_NOT_FOUND", key: "images/a.png" }],
    ["a digest", { failureCode: "INPUT_OBJECT_NOT_FOUND", sha256: "a".repeat(64) }],
    ["a URL", { failureCode: "INPUT_OBJECT_NOT_FOUND", url: "https://bucket.example/a.png" }],
    ["an outcome", { failureCode: "INPUT_OBJECT_NOT_FOUND", outcome: "DEFINITIVELY_REJECTED" }],
    ["a provider execution ID", { failureCode: "INPUT_OBJECT_NOT_FOUND", providerExecutionId: "op-1" }],
    ["a credential", { failureCode: "INPUT_OBJECT_NOT_FOUND", credential: "x" }],
  ])("refuses %s with 400 and touches nothing", async (_label, extra) => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    const before = await row(item.attemptId);
    const response = await call(port, worker!, "input-failed", item.attemptId, { ...proofBody(proof), ...extra });
    expect(response.status).toBe(400);
    expect(response.body).toBe(INVALID);
    expect(events).toEqual([]);
    expect(await row(item.attemptId)).toEqual(before);
    expect(await inputAudits(item.attemptId)).toEqual([]);
  });

  it("refuses a malformed proof with 400", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    for (const body of [
      { fencingCounter: 0, leaseToken: proof.leaseToken, failureCode: "INPUT_OBJECT_NOT_FOUND" },
      { fencingCounter: "1", leaseToken: proof.leaseToken, failureCode: "INPUT_OBJECT_NOT_FOUND" },
      { fencingCounter: 1, leaseToken: "short", failureCode: "INPUT_OBJECT_NOT_FOUND" },
      { fencingCounter: 1, failureCode: "INPUT_OBJECT_NOT_FOUND" },
    ]) {
      expect((await call(port, worker!, "input-failed", item.attemptId, body)).status).toBe(400);
    }
    expect((await row(item.attemptId)).state).toBe("LEASED");
  });

  it("refuses a browser Origin with 403 before authentication", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    const response = await call(port, worker!, "input-failed", item.attemptId, { ...proofBody(proof), failureCode: "INPUT_OBJECT_NOT_FOUND" }, { Origin: "https://app.example" });
    expect(response.status).toBe(403);
    expect(eventSummary()).toEqual([["WORKER_ORIGIN_REJECTED", "ORIGIN_PRESENT"]]);
    expect((await row(item.attemptId)).state).toBe("LEASED");
  });

  it("refuses missing or unknown worker authentication with 401", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    const body = JSON.stringify({ ...proofBody(proof), failureCode: "INPUT_OBJECT_NOT_FOUND" });
    const path = `/worker-control/v1/attempts/${item.attemptId}/input-failed`;
    const missing = await send(port, "POST", path, body, { "Content-Type": "application/json" });
    const unknown = await send(port, "POST", path, body, { Authorization: "Bearer fixture-not-a-worker", "Content-Type": "application/json" });
    expect([missing.status, unknown.status]).toEqual([401, 401]);
    expect(eventSummary()).toEqual([
      ["WORKER_AUTH_REQUIRED", "CREDENTIAL_ABSENT"],
      ["WORKER_AUTH_REJECTED", "ADAPTER_REJECTED"],
    ]);
    expect((await row(item.attemptId)).state).toBe("LEASED");
  });

  it("gives a worker disabled after authentication no report (401)", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const leasePort = await compose([worker!]);
    const proof = await granted(leasePort, worker!);
    await server!.close();
    const disabling: TransactionalPool = {
      query: pool.query,
      end: async () => {},
      connect: async () => {
        await clients.migrator.query("UPDATE worker_principals SET status = 'DISABLED', disabled_at = now() WHERE id = $1 AND status = 'ACTIVE'", [worker!.id]);
        return pool.connect();
      },
    };
    const port = await compose([worker!], disabling);
    const response = await report(port, worker!, item.attemptId, proof, "INPUT_OBJECT_NOT_FOUND");
    expect(response.status).toBe(401);
    expect(eventSummary()).toEqual([["WORKER_INPUT_FAILURE_REJECTED", "WORKER_NOT_ACTIVE"]]);
    expect((await row(item.attemptId)).state).toBe("LEASED");
  });
});

describe("first-transition authority", () => {
  it("refuses another worker, a wrong token, a wrong fence and an unknown attempt", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const proof = await granted(port, list[0]!);
    const before = await row(item.attemptId);
    const attempts: Array<[Worker, string, Proof]> = [
      [list[1]!, item.attemptId, proof],
      [list[0]!, item.attemptId, { ...proof, leaseToken: "B".repeat(43) }],
      [list[0]!, item.attemptId, { ...proof, fencingCounter: 2 }],
      [list[0]!, randomUUID(), proof],
    ];
    for (const [worker, attemptId, presented] of attempts) {
      const response = await report(port, worker, attemptId, presented, "INPUT_OBJECT_NOT_FOUND");
      expect(response.status).toBe(409);
      expect(response.body).toBe(REJECTED);
    }
    expect(eventSummary()).toEqual([
      ["WORKER_INPUT_FAILURE_REJECTED", "OTHER_WORKER"],
      ["WORKER_INPUT_FAILURE_REJECTED", "TOKEN_MISMATCH"],
      ["WORKER_INPUT_FAILURE_REJECTED", "FENCING_MISMATCH"],
      ["WORKER_INPUT_FAILURE_REJECTED", "UNKNOWN_ATTEMPT"],
    ]);
    expect(await row(item.attemptId)).toEqual(before);
    expect(await inputAudits(item.attemptId)).toEqual([]);
  });

  it("refuses a lease that never received a credential grant", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await leaseFor(port, worker!);
    const before = await row(item.attemptId);
    const response = await report(port, worker!, item.attemptId, proof, "INPUT_OBJECT_NOT_FOUND");
    expect(response.body).toBe(REJECTED);
    expect(eventSummary()).toEqual([["WORKER_INPUT_FAILURE_REJECTED", "CREDENTIAL_NOT_GRANTED"]]);
    expect(await row(item.attemptId)).toEqual(before);
  });

  it("refuses an expired, not yet reclaimed lease; granted-expired recovery then requeues it, never OUTCOME_UNKNOWN", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const proof = await granted(port, list[0]!);
    await expireLease(item.attemptId);
    const response = await report(port, list[0]!, item.attemptId, proof, "INPUT_OBJECT_NOT_FOUND");
    expect(response.body).toBe(REJECTED);
    expect(eventSummary()).toEqual([["WORKER_INPUT_FAILURE_REJECTED", "LEASE_EXPIRED"]]);
    expect((await row(item.attemptId)).state).toBe("LEASED");

    // Crash before the report: recovery reclaims the granted lease and a new epoch leases it.
    const recovered = await leaseFor(port, list[1]!);
    expect(recovered).toMatchObject({ attemptId: item.attemptId, fencingCounter: 2 });
    const after = await row(item.attemptId);
    expect(after).toMatchObject({ state: "LEASED", lease_worker_principal_id: list[1]!.id, credential_granted_at: null, failure_code: null, submitting_at: null });
    expect((await audits(item.attemptId)).map(([type]) => type)).not.toContain("execution_attempt.outcome_unknown");
    expect((await job(item.jobId)).status).toBe("RUNNING");
  });

  it("never lets a stale epoch terminate the newer authority after recovery", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const stale = await granted(port, worker!);
    await expireLease(item.attemptId);
    // The same worker recovers the attempt under a newer epoch and is granted again.
    const fresh = await granted(port, worker!);
    expect(fresh).toMatchObject({ attemptId: item.attemptId, fencingCounter: 2 });
    events.length = 0;
    const response = await report(port, worker!, item.attemptId, stale, "INPUT_OBJECT_NOT_FOUND");
    expect(response.status).toBe(409);
    expect(eventSummary()).toEqual([["WORKER_INPUT_FAILURE_REJECTED", "FENCING_MISMATCH"]]);
    expect(await row(item.attemptId)).toMatchObject({ state: "LEASED", lease_fencing_counter: "2", input_failed_worker_principal_id: null });
    // The newer authority can still report its own input failure.
    expect((await report(port, worker!, item.attemptId, fresh, "INPUT_OBJECT_NOT_FOUND")).status).toBe(200);
    expect(await row(item.attemptId)).toMatchObject({ state: "FAILED_BEFORE_SUBMISSION", input_failed_fencing_counter: "2" });
  });
});

describe("non-LEASED attempts", () => {
  // Drives the attempt through the real routes, and the owner for ABANDONED.
  async function reach(port: number, worker: Worker, item: Work, target: "SUBMITTING" | "SUBMITTED" | "OUTCOME_UNKNOWN" | "PROVIDER_FAILED" | "ABANDONED" | "QUEUED") {
    if (target === "QUEUED") return { fencingCounter: 1, leaseToken: "A".repeat(43) };
    const proof = await granted(port, worker);
    expect((await call(port, worker, "submitting", item.attemptId, proofBody(proof))).status).toBe(200);
    if (target === "SUBMITTED" || target === "ABANDONED") {
      expect((await call(port, worker, "submitted", item.attemptId, { ...proofBody(proof), providerExecutionId: "synthetic/op-1" })).status).toBe(200);
    }
    if (target === "ABANDONED") {
      await clients.migrator.query(
        "UPDATE execution_attempts SET state = 'ABANDONED', lease_worker_principal_id = NULL, lease_token_sha256 = NULL, leased_at = NULL, lease_expires_at = NULL, heartbeat_at = NULL, failure_code = 'RECOVERY_ABANDONED', completed_at = now() WHERE id = $1",
        [item.attemptId],
      );
    }
    if (target === "OUTCOME_UNKNOWN" || target === "PROVIDER_FAILED") {
      const outcome = target === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "DEFINITIVELY_REJECTED";
      const failureCode = target === "OUTCOME_UNKNOWN" ? "PROVIDER_SUBMISSION_AMBIGUOUS" : "PROVIDER_REJECTED_DEFINITIVELY";
      expect((await call(port, worker, "submission-failed", item.attemptId, { ...proofBody(proof), outcome, failureCode })).status).toBe(200);
    }
    return proof;
  }

  it.each(["QUEUED", "SUBMITTING", "SUBMITTED", "OUTCOME_UNKNOWN", "PROVIDER_FAILED", "ABANDONED"] as const)(
    "refuses %s with the uniform 409, before disclosing anything, and changes nothing",
    async (target) => {
      const [worker] = await workers(1);
      const item = await work();
      const port = await compose([worker!]);
      const proof = await reach(port, worker!, item, target);
      const before = await row(item.attemptId);
      const auditsBefore = await audits(item.attemptId);
      events.length = 0;
      const response = await report(port, worker!, item.attemptId, proof, "INPUT_OBJECT_NOT_FOUND");
      expect(response.status).toBe(409);
      expect(response.body).toBe(REJECTED);
      // No input-failure reporter exists, so authority fails first.
      expect(eventSummary()).toEqual([["WORKER_INPUT_FAILURE_REJECTED", "INPUT_FAILURE_PRINCIPAL_MISMATCH"]]);
      expect(await row(item.attemptId)).toEqual(before);
      expect(await audits(item.attemptId)).toEqual(auditsBefore);
      if (target === "PROVIDER_FAILED") {
        expect(before).toMatchObject({ state: "FAILED_BEFORE_SUBMISSION", failure_code: "PROVIDER_REJECTED_DEFINITIVELY", input_failed_worker_principal_id: null });
        expect(before.submitting_at).toBeInstanceOf(Date);
      }
    },
  );

  it("lets exactly one of a concurrent SUBMITTING acknowledgement and an input-failed report win", async () => {
    for (let round = 0; round < 3; round += 1) {
      const [worker] = await workers(1);
      const item = await work();
      const port = await compose([worker!]);
      const proof = await granted(port, worker!);
      const [submittingResponse, inputResponse] = await Promise.all([
        call(port, worker!, "submitting", item.attemptId, proofBody(proof)),
        report(port, worker!, item.attemptId, proof, "INPUT_OBJECT_NOT_FOUND"),
      ]);
      const statuses = [submittingResponse.status, inputResponse.status];
      expect(statuses.sort()).toEqual([200, 409]);
      const after = await row(item.attemptId);
      if (inputResponse.status === 200) {
        expect(after).toMatchObject({ state: "FAILED_BEFORE_SUBMISSION", submitting_at: null, input_failed_worker_principal_id: worker!.id });
      } else {
        expect(after).toMatchObject({ state: "SUBMITTING", input_failed_worker_principal_id: null });
        expect(after.submitting_at).toBeInstanceOf(Date);
      }
      await server!.close();
      server = undefined;
    }
  });
});

describe("exact replay (reporter and epoch authority)", () => {
  it("replays the committed acknowledgement with no write and no audit, even with a different well-formed lease token", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    const first = await report(port, worker!, item.attemptId, proof, "INPUT_OBJECT_NOT_FOUND");
    expect(first.status).toBe(200);
    const committed = { attempt: await row(item.attemptId), job: await job(item.jobId), audits: await audits(item.attemptId) };
    // The lease is cleared: no token verifier survives to compare against.
    expect(committed.attempt.lease_token_sha256).toBeNull();

    // The lease token is not authority on replay: any well-formed value works.
    for (const presented of [proof, { ...proof, leaseToken: "C".repeat(43) }]) {
      const replay = await report(port, worker!, item.attemptId, presented, "INPUT_OBJECT_NOT_FOUND");
      expect(replay.status).toBe(200);
      expect(replay.body).toBe(first.body);
    }
    expect(await row(item.attemptId)).toEqual(committed.attempt);
    expect(await job(item.jobId)).toEqual(committed.job);
    expect(await audits(item.attemptId)).toEqual(committed.audits);
    expect(await inputAudits(item.attemptId)).toHaveLength(1);
    expect(events).toEqual([]);
  });

  it("replays without writing, locking or reading anything beyond the principal and the attempt", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const leasePort = await compose([worker!]);
    const proof = await granted(leasePort, worker!);
    expect((await report(leasePort, worker!, item.attemptId, proof, "INPUT_MEDIA_TYPE_INVALID")).status).toBe(200);
    await server!.close();
    const recorded = recordingPool();
    const port = await compose([worker!], recorded.pool);
    expect((await report(port, worker!, item.attemptId, proof, "INPUT_MEDIA_TYPE_INVALID")).status).toBe(200);
    expect(recorded.statements.some((sql) => /^\s*(UPDATE|INSERT)/.test(sql))).toBe(false);
    expect(recorded.statements.some((sql) => /provider_credential_versions|provider_connections|lease_token_sha256/.test(sql))).toBe(false);
  });

  it("refuses a different code, principal or epoch after authority, and the first reason wins", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const proof = await granted(port, list[0]!);
    expect((await report(port, list[0]!, item.attemptId, proof, "INPUT_OBJECT_NOT_FOUND")).status).toBe(200);
    const committed = await row(item.attemptId);
    events.length = 0;
    const responses = [
      await report(port, list[0]!, item.attemptId, proof, "INPUT_MEDIA_TYPE_INVALID"),
      await report(port, list[1]!, item.attemptId, proof, "INPUT_OBJECT_NOT_FOUND"),
      await report(port, list[0]!, item.attemptId, { ...proof, fencingCounter: 2 }, "INPUT_OBJECT_NOT_FOUND"),
      // Wrong principal and wrong code: the principal is refused first, the code is never classified.
      await report(port, list[1]!, item.attemptId, proof, "INPUT_MEDIA_TYPE_INVALID"),
      // Wrong epoch and wrong code: the epoch is refused first.
      await report(port, list[0]!, item.attemptId, { ...proof, fencingCounter: 2 }, "INPUT_MEDIA_TYPE_INVALID"),
    ];
    expect(responses.map((response) => [response.status, response.body])).toEqual(Array(5).fill([409, REJECTED]));
    expect(eventSummary()).toEqual([
      ["WORKER_INPUT_FAILURE_REJECTED", "INCOMPATIBLE_ATTEMPT_STATE"],
      ["WORKER_INPUT_FAILURE_REJECTED", "INPUT_FAILURE_PRINCIPAL_MISMATCH"],
      ["WORKER_INPUT_FAILURE_REJECTED", "FENCING_MISMATCH"],
      ["WORKER_INPUT_FAILURE_REJECTED", "INPUT_FAILURE_PRINCIPAL_MISMATCH"],
      ["WORKER_INPUT_FAILURE_REJECTED", "FENCING_MISMATCH"],
    ]);
    expect(await row(item.attemptId)).toEqual(committed);
    expect(await inputAudits(item.attemptId)).toHaveLength(1);
  });

  it("recovers a lost response: the retried report replays 200 with one audit, and the terminal attempt is never requeued", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const proof = await granted(port, list[0]!);
    // The first request commits; its response is treated as lost.
    const lost = await report(port, list[0]!, item.attemptId, proof, "INPUT_OBJECT_INTEGRITY_MISMATCH");
    expect(lost.status).toBe(200);
    // The worker's policy retries the identical report.
    const retried = await report(port, list[0]!, item.attemptId, proof, "INPUT_OBJECT_INTEGRITY_MISMATCH");
    expect(retried.status).toBe(200);
    expect(retried.body).toBe(lost.body);
    expect(await inputAudits(item.attemptId)).toHaveLength(1);

    // Granted-expired recovery selects only expired LEASED attempts: this one stays terminal.
    const committed = await row(item.attemptId);
    const next = await send(port, "POST", "/worker-control/v1/leases", undefined, auth(list[1]!));
    expect(next.status).toBe(200);
    expect(json(next).lease).toBeNull();
    expect(await row(item.attemptId)).toEqual(committed);
    expect((await audits(item.attemptId)).map(([type]) => type)).not.toContain("execution_attempt.lease_expired");
    expect((await job(item.jobId)).status).toBe("FAILED");
  });

  it("serialises concurrent identical reports into one transition, one audit and exact replays", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    const responses = await Promise.all([1, 2, 3].map(() => report(port, worker!, item.attemptId, proof, "INPUT_OBJECT_TOO_LARGE")));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(new Set(responses.map((response) => response.body)).size).toBe(1);
    expect(await inputAudits(item.attemptId)).toHaveLength(1);
    expect(events).toEqual([]);
  });

  it("lets exactly one of two conflicting concurrent reports succeed", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    const responses = await Promise.all([
      report(port, worker!, item.attemptId, proof, "INPUT_OBJECT_NOT_FOUND"),
      report(port, worker!, item.attemptId, proof, "INPUT_MEDIA_TYPE_INVALID"),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = json(responses.find((response) => response.status === 200)!);
    expect(await row(item.attemptId)).toMatchObject({ state: "FAILED_BEFORE_SUBMISSION", failure_code: winner.failureCode });
    expect(await inputAudits(item.attemptId)).toHaveLength(1);
    expect(eventSummary()).toEqual([["WORKER_INPUT_FAILURE_REJECTED", "INCOMPATIBLE_ATTEMPT_STATE"]]);
  });
});

describe("atomicity and failure", () => {
  it("rolls back the attempt and job together when the audit fails", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const leasePort = await compose([worker!]);
    const proof = await granted(leasePort, worker!);
    await server!.close();
    const before = { attempt: await row(item.attemptId), job: await job(item.jobId), audits: await audits(item.attemptId) };
    const broken: TransactionalPool = {
      query: pool.query,
      end: async () => {},
      connect: async () => {
        const inner = await pool.connect();
        return {
          release: (error?: Error) => inner.release(error),
          query: async <Row extends object>(sql: string, params?: unknown[]) => {
            if (sql.includes("INSERT INTO audit_events")) throw Object.assign(new Error("injected"), { code: "XX000" });
            return inner.query<Row>(sql, params);
          },
        };
      },
    };
    const port = await compose([worker!], broken);
    const response = await report(port, worker!, item.attemptId, proof, "INPUT_OBJECT_NOT_FOUND");
    expect(response.status).toBe(503);
    expect(response.body).toBe('{"status":"error","code":"SERVICE_UNAVAILABLE"}\n');
    expect(await row(item.attemptId)).toEqual(before.attempt);
    expect(await job(item.jobId)).toEqual(before.job);
    expect(await audits(item.attemptId)).toEqual(before.audits);
  });

  it("fails closed with 503 when the security log cannot record a rejection", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const proof = await granted(port, list[0]!);
    setSinkFailing(true);
    const response = await report(port, list[1]!, item.attemptId, proof, "INPUT_OBJECT_NOT_FOUND");
    expect(response.status).toBe(503);
    expect((await row(item.attemptId)).state).toBe("LEASED");
  });

  it("holds the attempt lock against a concurrent SUBMITTING acknowledgement, which then finds the attempt terminal", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const leasePort = await compose([worker!]);
    const proof = await granted(leasePort, worker!);
    await server!.close();
    const gated = gatedPool((sql) => sql.includes("INSERT INTO audit_events"));
    const port = await compose([worker!], gated.pool);
    const pending = report(port, worker!, item.attemptId, proof, "INPUT_OBJECT_NOT_FOUND");
    await gated.paused;
    // The barrier waits for the attempt row lock held by the uncommitted input failure.
    const barrier = call(port, worker!, "submitting", item.attemptId, proofBody(proof));
    await new Promise((resolve) => setTimeout(resolve, 300));
    gated.release();
    expect((await pending).status).toBe(200);
    expect((await barrier).status).toBe(409);
    expect(await row(item.attemptId)).toMatchObject({ state: "FAILED_BEFORE_SUBMISSION", submitting_at: null });
  });
});
