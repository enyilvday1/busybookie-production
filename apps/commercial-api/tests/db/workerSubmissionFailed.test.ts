import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type RuntimeClient, type TransactionalPool } from "../../src/database/runtimePool.js";
import { readCredentialObligations } from "../../src/providerConnections/credentialObligations.js";
import { PROVIDER_CREDENTIAL_PURPOSE } from "commercial-worker-protocol";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../src/startCommercialApiServer.js";
import { createWorkerControlApplication } from "../../src/workerControl/workerControlApplication.js";
import type { WorkerSecurityEvent } from "../../src/workerControl/workerSecurityEvents.js";
import { sweepExpiredSubmittingAttempts, withTransaction } from "../../src/workerControl/workerLeaseService.js";
import { send, type TestResponse } from "../httpClient.js";
import { createTestCredentialFingerprinter, createTestCredentialSealer, generateTestKey } from "../support/testCredentialCrypto.js";
import { createTestWorkerAuthenticationAdapter } from "../support/testWorkerAuthentication.js";
import { createRecordingWorkerSecurityEventSink } from "../support/testWorkerSecurityEvents.js";
import { insertAccountWithFreeGrant, openGuardedClients, prepareSchemaV1, type GuardedClients } from "./support/testDatabase.js";

// R44B6T submission-failed report against PostgreSQL 16, over the explicitly
// composed worker-control router (architecture section 18, contract locked by
// R44B6T0). No provider is called and no credential is opened. Assertions on
// secrets are booleans, so a failure never prints one.

let clients: GuardedClients;
let pool: TransactionalPool;
let server: RunningCommercialApiServer | undefined;
let events: WorkerSecurityEvent[];
let setSinkFailing: (failing: boolean) => void;

const encryptionKey = generateTestKey("submission-failed-test-encryption/v1");
const sealer = createTestCredentialSealer(encryptionKey);
const fingerprinter = createTestCredentialFingerprinter(generateTestKey("submission-failed-test-fingerprint/v1"), encryptionKey);

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
    const id = (await clients.migrator.query<{ id: string }>("INSERT INTO worker_principals (label) VALUES ($1) RETURNING id", [`failed-worker-${index}`])).rows[0]!.id;
    list.push({ id, token: `fixture-worker-${randomBytes(16).toString("hex")}` });
  }
  return list;
}

type Work = Readonly<{ userId: string; accountId: string; connectionId: string; versionId: string; jobId: string; attemptId: string; plaintext: string }>;

const q = <T extends object>(sql: string, params: unknown[]) => clients.migrator.query<T>(sql, params).then((result) => result.rows[0]!);

// One claimed authorization bound to the exact sealed version 1, with its job and QUEUED attempt.
async function work(): Promise<Work> {
  const provider = "EXAMPLE_PROVIDER";
  const owner = await insertAccountWithFreeGrant(clients.migrator, `failed-${randomUUID()}`);
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
  return { userId: owner.userId, accountId: owner.accountId, connectionId: connection.id, versionId: version.id, jobId: job.id, attemptId: attempt.id, plaintext };
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

// A pool whose first session pauses at the first statement matching `pause`
// until released, holding whatever locks its transaction already has.
function gatedPool(pause: (sql: string, params: unknown[] | undefined) => boolean) {
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
          if (!used && pause(sql, params)) {
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

// ---------------------------------------------------------------------------
// HTTP helpers

const auth = (worker: Worker) => ({ Authorization: `Bearer ${worker.token}` });
const json = (response: TestResponse) => JSON.parse(response.body) as Record<string, unknown>;
type Proof = { fencingCounter: number; leaseToken: string };
type Outcome = "DEFINITIVELY_REJECTED" | "OUTCOME_UNKNOWN";

async function leaseFor(port: number, worker: Worker): Promise<Proof & { attemptId: string }> {
  const body = json(await send(port, "POST", "/worker-control/v1/leases", undefined, auth(worker))).lease as Record<string, unknown>;
  return { attemptId: body.executionAttemptId as string, fencingCounter: body.fencingCounter as number, leaseToken: body.leaseToken as string };
}
const call = (port: number, worker: Worker, action: string, attemptId: string, body: Record<string, unknown>) =>
  send(port, "POST", `/worker-control/v1/attempts/${attemptId}/${action}`, JSON.stringify(body), { ...auth(worker), "Content-Type": "application/json" });

// Lease, receive the grant and cross the SUBMITTING barrier.
async function submitting(port: number, worker: Worker) {
  const proof = await leaseFor(port, worker);
  expect((await call(port, worker, "credential-grant", proof.attemptId, { fencingCounter: proof.fencingCounter, leaseToken: proof.leaseToken })).status).toBe(200);
  expect((await call(port, worker, "submitting", proof.attemptId, { fencingCounter: proof.fencingCounter, leaseToken: proof.leaseToken })).status).toBe(200);
  return proof;
}
const report = (port: number, worker: Worker, attemptId: string, proof: Proof, outcome: Outcome, failureCode: string) =>
  call(port, worker, "submission-failed", attemptId, { fencingCounter: proof.fencingCounter, leaseToken: proof.leaseToken, outcome, failureCode });

const FULL_ROW = `SELECT state, failure_code, completed_at, updated_at, submitting_at, submitting_worker_principal_id, submitting_fencing_counter,
                         provider_execution_id, submitted_at, lease_worker_principal_id, lease_token_sha256, lease_fencing_counter, leased_at,
                         lease_expires_at, heartbeat_at, credential_granted_at, recovery_expires_at
                    FROM execution_attempts WHERE id = $1`;
type Row = Record<string, unknown> & { state: string; failure_code: string | null; completed_at: Date | null; updated_at: Date };
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
const failureAudits = async (attemptId: string) =>
  (await audits(attemptId)).filter(([type]) => type === "execution_attempt.failed_before_submission" || type === "execution_attempt.outcome_unknown");
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
const DESTROY = `UPDATE provider_credential_versions SET status = 'DESTROYED', destroyed_at = now(), sealed_credential = NULL,
                        fingerprint_algorithm = NULL, fingerprint_key_ref = NULL, fingerprint_value = NULL WHERE id = $1`;
const UNKNOWN_CODES = ["PROVIDER_SUBMISSION_AMBIGUOUS", "ACCEPTANCE_JOURNAL_WRITE_FAILED", "PROVIDER_EXECUTION_ID_INVALID"] as const;
const PAIRS = [["DEFINITIVELY_REJECTED", "PROVIDER_REJECTED_DEFINITIVELY"], ...UNKNOWN_CODES.map((code) => ["OUTCOME_UNKNOWN", code] as const)] as const;
const stateOf = (outcome: Outcome) => (outcome === "DEFINITIVELY_REJECTED" ? "FAILED_BEFORE_SUBMISSION" : "OUTCOME_UNKNOWN");

// ---------------------------------------------------------------------------

describe("first transition", () => {
  it("records a definitive rejection as FAILED_BEFORE_SUBMISSION, fails the job and closes the obligations", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await submitting(port, worker!);
    const before = await row(item.attemptId);
    expect(await obligations(item)).toMatchObject({ hasOpenProviderRecoveryObligation: true });

    const response = await report(port, worker!, item.attemptId, proof, "DEFINITIVELY_REJECTED", "PROVIDER_REJECTED_DEFINITIVELY");
    expect(response.status).toBe(200);
    expect(json(response)).toEqual({ executionAttemptId: item.attemptId, fencingCounter: 1, state: "FAILED_BEFORE_SUBMISSION", failureCode: "PROVIDER_REJECTED_DEFINITIVELY" });
    expect(Object.keys(json(response))).toEqual(["executionAttemptId", "fencingCounter", "state", "failureCode"]);

    const after = await row(item.attemptId);
    expect(after).toMatchObject({
      state: "FAILED_BEFORE_SUBMISSION",
      failure_code: "PROVIDER_REJECTED_DEFINITIVELY",
      provider_execution_id: null,
      submitted_at: null,
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      leased_at: null,
      lease_expires_at: null,
      heartbeat_at: null,
      recovery_expires_at: null,
    });
    expect(after.completed_at).toBeInstanceOf(Date);
    // Submission provenance, the retained fencing counter and the grant are kept.
    for (const column of ["submitting_at", "submitting_worker_principal_id", "submitting_fencing_counter", "lease_fencing_counter", "credential_granted_at"]) {
      expect(after[column]).toEqual(before[column]);
    }
    const parent = await job(item.jobId);
    expect(parent.status).toBe("FAILED");
    expect(parent.completed_at).toBeInstanceOf(Date);
    expect(await failureAudits(item.attemptId)).toEqual([
      [
        "execution_attempt.failed_before_submission",
        { attemptNumber: 1, fencingCounter: 1, workerPrincipalId: worker!.id, provider: "EXAMPLE_PROVIDER", credentialVersion: 1, failureCode: "PROVIDER_REJECTED_DEFINITIVELY" },
      ],
    ]);
    expect(events).toEqual([]);
    // No automatic new attempt.
    expect((await clients.migrator.query("SELECT id FROM execution_attempts WHERE execution_job_id = $1", [item.jobId])).rows).toHaveLength(1);
    expect(await obligations(item)).toEqual({ hasOpenCredentialRetentionObligation: false, hasOpenProviderRecoveryObligation: false, blocksDestruction: false });
    const visible = (await allAuditText()) + JSON.stringify(events) + response.body;
    expect(visible.includes(proof.leaseToken) || visible.includes(item.plaintext) || visible.includes(worker!.token)).toBe(false);
  });

  it.each(UNKNOWN_CODES)("records OUTCOME_UNKNOWN with %s, needs attention and keeps the recovery obligation", async (code) => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await submitting(port, worker!);
    const before = await row(item.attemptId);

    const response = await report(port, worker!, item.attemptId, proof, "OUTCOME_UNKNOWN", code);
    expect(response.status).toBe(200);
    expect(json(response)).toEqual({ executionAttemptId: item.attemptId, fencingCounter: 1, state: "OUTCOME_UNKNOWN", failureCode: code });

    const after = await row(item.attemptId);
    expect(after).toMatchObject({
      state: "OUTCOME_UNKNOWN",
      failure_code: code,
      completed_at: null,
      provider_execution_id: null,
      submitted_at: null,
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      leased_at: null,
      lease_expires_at: null,
      heartbeat_at: null,
    });
    for (const column of ["submitting_at", "submitting_worker_principal_id", "submitting_fencing_counter", "lease_fencing_counter", "credential_granted_at"]) {
      expect(after[column]).toEqual(before[column]);
    }
    expect(await job(item.jobId)).toMatchObject({ status: "NEEDS_ATTENTION", completed_at: null });
    expect(await failureAudits(item.attemptId)).toEqual([
      [
        "execution_attempt.outcome_unknown",
        { attemptNumber: 1, fencingCounter: 1, workerPrincipalId: worker!.id, provider: "EXAMPLE_PROVIDER", credentialVersion: 1, failureCode: code },
      ],
    ]);
    expect(events).toEqual([]);
    expect(await obligations(item)).toEqual({ hasOpenCredentialRetentionObligation: true, hasOpenProviderRecoveryObligation: true, blocksDestruction: true });
  });

  it("locks principal, attempt, connection and exact version in that order", async () => {
    const [worker] = await workers(1);
    await work();
    const leasePort = await compose([worker!]);
    const proof = await submitting(leasePort, worker!);
    await server!.close();
    const recorded = recordingPool();
    const port = await compose([worker!], recorded.pool);
    expect((await report(port, worker!, proof.attemptId, proof, "OUTCOME_UNKNOWN", "PROVIDER_SUBMISSION_AMBIGUOUS")).status).toBe(200);
    const locks = recorded.statements.filter((sql) => /FOR (SHARE|UPDATE)/.test(sql)).map((sql) => /FROM (\w+)/.exec(sql)![1]);
    expect(locks).toEqual(["worker_principals", "execution_attempts", "execution_attempts", "provider_connections", "provider_credential_versions"]);
    expect(recorded.statements.some((sql) => /sealed_credential|fingerprint_/.test(sql))).toBe(false);
  });

  it("refuses a recognised but mismatched pair only after the live proof, with no mutation", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const proof = await submitting(port, list[0]!);
    const before = await row(item.attemptId);

    for (const [outcome, code] of [
      ["DEFINITIVELY_REJECTED", "PROVIDER_SUBMISSION_AMBIGUOUS"],
      ["OUTCOME_UNKNOWN", "PROVIDER_REJECTED_DEFINITIVELY"],
    ] as const) {
      const response = await report(port, list[0]!, item.attemptId, proof, outcome, code);
      expect(response.status).toBe(409);
      expect(response.body).toBe(REJECTED);
    }
    expect(eventSummary()).toEqual([
      ["WORKER_SUBMISSION_FAILURE_REJECTED", "FAILURE_CODE_OUTCOME_MISMATCH"],
      ["WORKER_SUBMISSION_FAILURE_REJECTED", "FAILURE_CODE_OUTCOME_MISMATCH"],
    ]);
    // Without authority, the pairing is never classified.
    events.length = 0;
    expect((await report(port, list[1]!, item.attemptId, proof, "DEFINITIVELY_REJECTED", "PROVIDER_SUBMISSION_AMBIGUOUS")).body).toBe(REJECTED);
    expect((await report(port, list[0]!, item.attemptId, { ...proof, leaseToken: "B".repeat(43) }, "DEFINITIVELY_REJECTED", "PROVIDER_SUBMISSION_AMBIGUOUS")).body).toBe(REJECTED);
    expect(eventSummary()).toEqual([
      ["WORKER_SUBMISSION_FAILURE_REJECTED", "OTHER_WORKER"],
      ["WORKER_SUBMISSION_FAILURE_REJECTED", "TOKEN_MISMATCH"],
    ]);
    expect(await row(item.attemptId)).toEqual(before);
    expect(await failureAudits(item.attemptId)).toEqual([]);
  });

  it("does not accept a vocabulary failure as anything but 400, with no event or mutation", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await submitting(port, worker!);
    const before = await row(item.attemptId);
    for (const code of ["WORKER_LEASE_EXPIRED_DURING_SUBMISSION", "PROVIDER_TIMEOUT"]) {
      const response = await report(port, worker!, item.attemptId, proof, "OUTCOME_UNKNOWN", code);
      expect(response.status).toBe(400);
      expect(response.body).toBe('{"status":"error","code":"INVALID_REQUEST"}\n');
    }
    expect(events).toEqual([]);
    expect(await row(item.attemptId)).toEqual(before);
  });
});

describe("live-lease authority", () => {
  it("refuses another worker, a wrong token, a wrong fence and an unknown attempt", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const proof = await submitting(port, list[0]!);
    const before = await row(item.attemptId);
    const attempts: Array<[Worker, string, Proof]> = [
      [list[1]!, item.attemptId, proof],
      [list[0]!, item.attemptId, { ...proof, leaseToken: "B".repeat(43) }],
      [list[0]!, item.attemptId, { ...proof, fencingCounter: 2 }],
      [list[0]!, randomUUID(), proof],
    ];
    for (const [worker, attemptId, presented] of attempts) {
      const response = await report(port, worker, attemptId, presented, "OUTCOME_UNKNOWN", "PROVIDER_SUBMISSION_AMBIGUOUS");
      expect(response.status).toBe(409);
      expect(response.body).toBe(REJECTED);
    }
    expect(eventSummary()).toEqual([
      ["WORKER_SUBMISSION_FAILURE_REJECTED", "OTHER_WORKER"],
      ["WORKER_SUBMISSION_FAILURE_REJECTED", "TOKEN_MISMATCH"],
      ["WORKER_SUBMISSION_FAILURE_REJECTED", "FENCING_MISMATCH"],
      ["WORKER_SUBMISSION_FAILURE_REJECTED", "UNKNOWN_ATTEMPT"],
    ]);
    expect(await row(item.attemptId)).toEqual(before);
  });

  it("never accepts the proof of an earlier lease epoch of the same attempt", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    // Epoch 1: leased, released before any grant, so the attempt returns to the queue.
    const first = await leaseFor(port, worker!);
    expect((await call(port, worker!, "release", first.attemptId, { fencingCounter: first.fencingCounter, leaseToken: first.leaseToken })).status).toBe(200);
    // Epoch 2 crosses the barrier.
    const second = await submitting(port, worker!);
    expect(second.fencingCounter).toBe(2);
    const response = await report(port, worker!, item.attemptId, first, "OUTCOME_UNKNOWN", "PROVIDER_SUBMISSION_AMBIGUOUS");
    expect(response.body).toBe(REJECTED);
    expect(eventSummary()).toEqual([["WORKER_SUBMISSION_FAILURE_REJECTED", "FENCING_MISMATCH"]]);
    expect((await row(item.attemptId)).state).toBe("SUBMITTING");
    // The database itself forbids a replacement lease on a SUBMITTING attempt (migration 0004).
    await expect(
      clients.migrator.query("UPDATE execution_attempts SET lease_token_sha256 = repeat('d', 64), lease_fencing_counter = 3 WHERE id = $1", [item.attemptId]),
    ).rejects.toThrow();
  });

  it("refuses an expired, not yet swept lease; the sweep later records its own outcome", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await submitting(port, worker!);
    await expireLease(item.attemptId);
    const response = await report(port, worker!, item.attemptId, proof, "DEFINITIVELY_REJECTED", "PROVIDER_REJECTED_DEFINITIVELY");
    expect(response.body).toBe(REJECTED);
    expect(eventSummary()).toEqual([["WORKER_SUBMISSION_FAILURE_REJECTED", "LEASE_EXPIRED"]]);
    expect((await row(item.attemptId)).state).toBe("SUBMITTING");
    await withTransaction(pool, (client) => sweepExpiredSubmittingAttempts(client, randomUUID(), item.attemptId));
    expect(await row(item.attemptId)).toMatchObject({ state: "OUTCOME_UNKNOWN", failure_code: "WORKER_LEASE_EXPIRED_DURING_SUBMISSION" });
  });

  it("gives a worker disabled after authentication no report", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const leasePort = await compose([worker!]);
    const proof = await submitting(leasePort, worker!);
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
    const response = await report(port, worker!, item.attemptId, proof, "OUTCOME_UNKNOWN", "PROVIDER_SUBMISSION_AMBIGUOUS");
    expect(response.status).toBe(401);
    expect(eventSummary()).toEqual([["WORKER_SUBMISSION_FAILURE_REJECTED", "WORKER_NOT_ACTIVE"]]);
    expect((await row(item.attemptId)).state).toBe("SUBMITTING");
  });

  it("fails closed when the exact version was destroyed (invariant failure)", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await submitting(port, worker!);
    await clients.migrator.query(DESTROY, [item.versionId]);
    const response = await report(port, worker!, item.attemptId, proof, "OUTCOME_UNKNOWN", "PROVIDER_SUBMISSION_AMBIGUOUS");
    expect(response.body).toBe(REJECTED);
    expect(eventSummary()).toEqual([["WORKER_SUBMISSION_FAILURE_REJECTED", "SUBMITTING_VERSION_DESTROYED"]]);
    expect((await row(item.attemptId)).state).toBe("SUBMITTING");
  });

  it("refuses a report for an attempt that never crossed SUBMITTING", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await leaseFor(port, worker!);
    const before = await row(item.attemptId);
    const response = await report(port, worker!, item.attemptId, proof, "OUTCOME_UNKNOWN", "PROVIDER_SUBMISSION_AMBIGUOUS");
    expect(response.body).toBe(REJECTED);
    expect(eventSummary()).toEqual([["WORKER_SUBMISSION_FAILURE_REJECTED", "SUBMITTING_PRINCIPAL_MISMATCH"]]);
    expect(await row(item.attemptId)).toEqual(before);
  });
});

describe("exact replay (original-submission-epoch authority)", () => {
  it.each(PAIRS)("replays %s / %s with the identical response and no write", async (outcome, code) => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await submitting(port, worker!);
    const first = await report(port, worker!, item.attemptId, proof, outcome, code);
    expect(first.status).toBe(200);
    const committed = { attempt: await row(item.attemptId), job: await job(item.jobId), audits: await audits(item.attemptId) };

    // The lease token is not authority on replay: any well-formed value works.
    for (const presented of [proof, { ...proof, leaseToken: "C".repeat(43) }]) {
      const replay = await report(port, worker!, item.attemptId, presented, outcome, code);
      expect(replay.status).toBe(200);
      expect(replay.body).toBe(first.body);
    }
    expect(json(first)).toEqual({ executionAttemptId: item.attemptId, fencingCounter: 1, state: stateOf(outcome), failureCode: code });
    expect(await row(item.attemptId)).toEqual(committed.attempt);
    expect(await job(item.jobId)).toEqual(committed.job);
    expect(await audits(item.attemptId)).toEqual(committed.audits);
    expect((await row(item.attemptId)).lease_token_sha256).toBeNull();
    expect(events).toEqual([]);
  });

  it("replays a definitive rejection after its version was destroyed, without locking the version", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const leasePort = await compose([worker!]);
    const proof = await submitting(leasePort, worker!);
    const first = await report(leasePort, worker!, item.attemptId, proof, "DEFINITIVELY_REJECTED", "PROVIDER_REJECTED_DEFINITIVELY");
    expect(first.status).toBe(200);
    // The committed failure closed the obligations, so destruction is legitimate.
    expect(await obligations(item)).toMatchObject({ blocksDestruction: false });
    await clients.migrator.query(DESTROY, [item.versionId]);
    await server!.close();
    const recorded = recordingPool();
    const port = await compose([worker!], recorded.pool);
    const replay = await report(port, worker!, item.attemptId, proof, "DEFINITIVELY_REJECTED", "PROVIDER_REJECTED_DEFINITIVELY");
    expect(replay.status).toBe(200);
    expect(replay.body).toBe(first.body);
    expect(recorded.statements.some((sql) => /provider_credential_versions|provider_connections/.test(sql))).toBe(false);
    expect(recorded.statements.some((sql) => /^\s*(UPDATE|INSERT)/.test(sql))).toBe(false);
  });

  it("refuses a different outcome, a different code or a mismatched pair, and never rewrites the committed code", async () => {
    const [worker] = await workers(1);
    const definitive = await work();
    const port = await compose([worker!]);
    const proofA = await submitting(port, worker!);
    expect((await report(port, worker!, definitive.attemptId, proofA, "DEFINITIVELY_REJECTED", "PROVIDER_REJECTED_DEFINITIVELY")).status).toBe(200);
    const unknown = await work();
    const proofB = await submitting(port, worker!);
    expect((await report(port, worker!, unknown.attemptId, proofB, "OUTCOME_UNKNOWN", "PROVIDER_SUBMISSION_AMBIGUOUS")).status).toBe(200);
    const before = { a: await row(definitive.attemptId), b: await row(unknown.attemptId) };
    events.length = 0;

    const cases: Array<[string, Proof, Outcome, string]> = [
      [definitive.attemptId, proofA, "OUTCOME_UNKNOWN", "PROVIDER_SUBMISSION_AMBIGUOUS"],
      [unknown.attemptId, proofB, "DEFINITIVELY_REJECTED", "PROVIDER_REJECTED_DEFINITIVELY"],
      [unknown.attemptId, proofB, "OUTCOME_UNKNOWN", "ACCEPTANCE_JOURNAL_WRITE_FAILED"],
      [unknown.attemptId, proofB, "OUTCOME_UNKNOWN", "PROVIDER_REJECTED_DEFINITIVELY"],
    ];
    for (const [attemptId, proof, outcome, code] of cases) {
      const response = await report(port, worker!, attemptId, proof, outcome, code);
      expect(response.status).toBe(409);
      expect(response.body).toBe(REJECTED);
    }
    expect(eventSummary()).toEqual([
      ["WORKER_SUBMISSION_FAILURE_REJECTED", "INCOMPATIBLE_ATTEMPT_STATE"],
      ["WORKER_SUBMISSION_FAILURE_REJECTED", "INCOMPATIBLE_ATTEMPT_STATE"],
      ["WORKER_SUBMISSION_FAILURE_REJECTED", "INCOMPATIBLE_ATTEMPT_STATE"],
      ["WORKER_SUBMISSION_FAILURE_REJECTED", "FAILURE_CODE_OUTCOME_MISMATCH"],
    ]);
    expect(await row(definitive.attemptId)).toEqual(before.a);
    expect(await row(unknown.attemptId)).toEqual(before.b);
  });

  it("proves the original epoch before disclosing state: another principal or a wrong fence learns nothing", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const proof = await submitting(port, list[0]!);
    expect((await report(port, list[0]!, item.attemptId, proof, "OUTCOME_UNKNOWN", "PROVIDER_SUBMISSION_AMBIGUOUS")).status).toBe(200);
    events.length = 0;
    // Exact replay bodies from the wrong principal or epoch, and a mismatched pair, are refused uniformly.
    const responses = [
      await report(port, list[1]!, item.attemptId, proof, "OUTCOME_UNKNOWN", "PROVIDER_SUBMISSION_AMBIGUOUS"),
      await report(port, list[0]!, item.attemptId, { ...proof, fencingCounter: 2 }, "OUTCOME_UNKNOWN", "PROVIDER_SUBMISSION_AMBIGUOUS"),
      await report(port, list[1]!, item.attemptId, proof, "DEFINITIVELY_REJECTED", "PROVIDER_SUBMISSION_AMBIGUOUS"),
    ];
    expect(responses.map((response) => [response.status, response.body])).toEqual(Array(3).fill([409, REJECTED]));
    expect(eventSummary()).toEqual([
      ["WORKER_SUBMISSION_FAILURE_REJECTED", "SUBMITTING_PRINCIPAL_MISMATCH"],
      ["WORKER_SUBMISSION_FAILURE_REJECTED", "FENCING_MISMATCH"],
      ["WORKER_SUBMISSION_FAILURE_REJECTED", "SUBMITTING_PRINCIPAL_MISMATCH"],
    ]);
  });

  it("never replaces the sweep's expiry evidence", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await submitting(port, worker!);
    await expireLease(item.attemptId);
    await withTransaction(pool, (client) => sweepExpiredSubmittingAttempts(client, randomUUID(), item.attemptId));
    const swept = await row(item.attemptId);
    expect(swept).toMatchObject({ state: "OUTCOME_UNKNOWN", failure_code: "WORKER_LEASE_EXPIRED_DURING_SUBMISSION" });
    for (const [outcome, code] of PAIRS) {
      const response = await report(port, worker!, item.attemptId, proof, outcome, code);
      expect(response.body).toBe(REJECTED);
    }
    expect(new Set(eventSummary().map(([, reason]) => reason))).toEqual(new Set(["INCOMPATIBLE_ATTEMPT_STATE"]));
    expect(await row(item.attemptId)).toEqual(swept);
  });

  it("refuses an attempt already SUBMITTED by the live route", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await submitting(port, worker!);
    expect((await call(port, worker!, "submitted", item.attemptId, { fencingCounter: 1, leaseToken: proof.leaseToken, providerExecutionId: "synthetic/op-1" })).status).toBe(200);
    const before = await row(item.attemptId);
    const response = await report(port, worker!, item.attemptId, proof, "OUTCOME_UNKNOWN", "PROVIDER_SUBMISSION_AMBIGUOUS");
    expect(response.body).toBe(REJECTED);
    expect(eventSummary()).toEqual([["WORKER_SUBMISSION_FAILURE_REJECTED", "INCOMPATIBLE_ATTEMPT_STATE"]]);
    expect(await row(item.attemptId)).toEqual(before);
  });
});

describe("atomicity and failure", () => {
  it.each(PAIRS)("rolls back the attempt and job together when the %s audit fails", async (outcome, code) => {
    const [worker] = await workers(1);
    const item = await work();
    const leasePort = await compose([worker!]);
    const proof = await submitting(leasePort, worker!);
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
    const response = await report(port, worker!, item.attemptId, proof, outcome, code);
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
    const proof = await submitting(port, list[0]!);
    setSinkFailing(true);
    const response = await report(port, list[1]!, item.attemptId, proof, "OUTCOME_UNKNOWN", "PROVIDER_SUBMISSION_AMBIGUOUS");
    expect(response.status).toBe(503);
    expect((await row(item.attemptId)).state).toBe("SUBMITTING");
  });
});

describe("concurrency", () => {
  it("serialises concurrent identical reports into one transition, one audit and an exact replay", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await submitting(port, worker!);
    const responses = await Promise.all([1, 2, 3].map(() => report(port, worker!, item.attemptId, proof, "OUTCOME_UNKNOWN", "PROVIDER_SUBMISSION_AMBIGUOUS")));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(new Set(responses.map((response) => response.body)).size).toBe(1);
    expect(await failureAudits(item.attemptId)).toHaveLength(1);
    expect(events).toEqual([]);
  });

  it("lets exactly one of two conflicting concurrent reports succeed", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await submitting(port, worker!);
    const responses = await Promise.all([
      report(port, worker!, item.attemptId, proof, "DEFINITIVELY_REJECTED", "PROVIDER_REJECTED_DEFINITIVELY"),
      report(port, worker!, item.attemptId, proof, "OUTCOME_UNKNOWN", "PROVIDER_SUBMISSION_AMBIGUOUS"),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = json(responses.find((response) => response.status === 200)!);
    expect(await row(item.attemptId)).toMatchObject({ state: winner.state, failure_code: winner.failureCode });
    expect(await failureAudits(item.attemptId)).toHaveLength(1);
    expect(eventSummary()).toEqual([["WORKER_SUBMISSION_FAILURE_REJECTED", "INCOMPATIBLE_ATTEMPT_STATE"]]);
  });

  it("holds the attempt lock against a concurrent named sweep, which then finds nothing to convert", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const leasePort = await compose([worker!]);
    const proof = await submitting(leasePort, worker!);
    await server!.close();
    // The lease expires shortly after the report has proven it live.
    await clients.migrator.query("UPDATE execution_attempts SET lease_expires_at = clock_timestamp() + interval '1500 milliseconds' WHERE id = $1", [item.attemptId]);
    const gated = gatedPool((sql) => sql.includes("INSERT INTO audit_events"));
    const port = await compose([worker!], gated.pool);
    const pending = report(port, worker!, item.attemptId, proof, "DEFINITIVELY_REJECTED", "PROVIDER_REJECTED_DEFINITIVELY");
    await gated.paused;
    await new Promise((resolve) => setTimeout(resolve, 1700));
    // The named sweep sees an expired SUBMITTING row in its snapshot, waits for the lock, then re-checks.
    const sweep = withTransaction(pool, (client) => sweepExpiredSubmittingAttempts(client, randomUUID(), item.attemptId));
    gated.release();
    expect((await pending).status).toBe(200);
    await sweep;
    expect(await row(item.attemptId)).toMatchObject({ state: "FAILED_BEFORE_SUBMISSION", failure_code: "PROVIDER_REJECTED_DEFINITIVELY" });
    expect((await audits(item.attemptId)).filter(([type]) => type === "execution_attempt.outcome_unknown")).toEqual([]);
  });
});
