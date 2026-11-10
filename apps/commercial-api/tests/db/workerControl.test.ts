import { createHash, randomBytes, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { combineApplicationRouters } from "../../src/application/combineApplicationRouters.js";
import { createCustomerApplication } from "../../src/application/customerApplication.js";
import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type TransactionalPool } from "../../src/database/runtimePool.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../src/startCommercialApiServer.js";
import { createWorkerControlApplication } from "../../src/workerControl/workerControlApplication.js";
import type { WorkerSecurityEvent } from "../../src/workerControl/workerSecurityEvents.js";
import { send, type TestResponse } from "../httpClient.js";
import { createTestIdentityProvider } from "../support/testIdentityProvider.js";
import { createTestWorkerAuthenticationAdapter } from "../support/testWorkerAuthentication.js";
import { createRecordingWorkerSecurityEventSink } from "../support/testWorkerSecurityEvents.js";
import { insertAccountWithFreeGrant, openGuardedClients, prepareSchemaV1, type GuardedClients } from "./support/testDatabase.js";

// Worker-control leases, heartbeats and releases over HTTP against
// PostgreSQL 16. The router is composed only here, with the test worker
// adapter, a recording security sink and a runtime-role pool. Fixtures are
// committed by the owner role; the schema is reset before every test so the
// global queue holds exactly what each test creates.

let clients: GuardedClients;
let pool: TransactionalPool;
let server: RunningCommercialApiServer | undefined;
let events: WorkerSecurityEvent[];

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
  const created: Worker[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = (await clients.migrator.query<{ id: string }>("INSERT INTO worker_principals (label) VALUES ($1) RETURNING id", [`worker-${index}`])).rows[0]!.id;
    created.push({ id, token: `fixture-worker-${randomBytes(16).toString("hex")}` });
  }
  return created;
}

const CUSTOMER_TOKEN = `fixture-customer-${randomBytes(16).toString("hex")}`;

async function compose(list: readonly Worker[], poolOverride: TransactionalPool = pool) {
  const recording = createRecordingWorkerSecurityEventSink();
  events = recording.events;
  const application = combineApplicationRouters(
    createCustomerApplication({
      authentication: createTestIdentityProvider([{ token: CUSTOMER_TOKEN, identity: { issuer: "https://issuer.test/", subject: "customer" } }]),
      pool,
      reportFailure: () => {},
    }),
    createWorkerControlApplication({
      authentication: createTestWorkerAuthenticationAdapter(list.map((worker) => ({ token: worker.token, workerPrincipalId: worker.id }))),
      securityEvents: recording.sink,
      pool: poolOverride,
      reportFailure: () => {},
    }),
  );
  server = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { application, checkReadiness: async () => true } });
  return server.port;
}

type Work = Readonly<{ accountId: string; jobId: string; attemptId: string; authorizationId: string; versionId: string; connectionId: string }>;

async function work(options: Readonly<{ provider?: string }> = {}): Promise<Work> {
  const provider = options.provider ?? "EXAMPLE_PROVIDER";
  const owner = await insertAccountWithFreeGrant(clients.migrator, `wc-${randomUUID()}`);
  const q = <T extends object>(sql: string, params: unknown[]) => clients.migrator.query<T>(sql, params).then((result) => result.rows[0]!);
  const production = await q<{ id: string }>(
    "INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id) VALUES ($1, 'Production', $2, $3) RETURNING id",
    [owner.accountId, owner.grantId, owner.userId],
  );
  const connection = await q<{ id: string }>(
    "INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id) VALUES ($1, $2, 'API_KEY', $3) RETURNING id",
    [owner.accountId, provider, owner.userId],
  );
  const version = await q<{ id: string }>(
    `INSERT INTO provider_credential_versions (account_id, provider_connection_id, credential_version, sealed_credential, fingerprint_algorithm,
                                               fingerprint_key_ref, fingerprint_value, created_by_user_id)
     VALUES ($1, $2, 1, '{"format":"fixture-envelope"}'::jsonb, 'HMAC-SHA-256', 'fixture/v1', $3, $4) RETURNING id`,
    [owner.accountId, connection.id, randomUUID().replaceAll("-", "").padEnd(43, "W").slice(0, 43), owner.userId],
  );
  const authorization = await q<{ id: string }>(
    `INSERT INTO generation_authorizations
       (account_id, production_id, entitlement_grant_id, billing_mode, provider, model, provider_connection_id,
        provider_credential_version_id, generation_request, generation_request_sha256, expected_cost_cap_unit,
        expected_cost_cap_amount, expires_at, created_by_user_id)
     VALUES ($1, $2, $3, 'USER_BYO', $4, 'example-model-1', $5, $6, '{"prompt":"a lighthouse at dawn","durationSeconds":5}'::jsonb,
             repeat('c', 64), 'MICRO_USD', 2000000, now() + interval '15 minutes', $7) RETURNING id`,
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
  return { accountId: owner.accountId, jobId: job.id, attemptId: attempt.id, authorizationId: authorization.id, versionId: version.id, connectionId: connection.id };
}

// ---------------------------------------------------------------------------
// HTTP helpers

const auth = (worker: Worker) => ({ Authorization: `Bearer ${worker.token}` });
const json = (response: TestResponse) => JSON.parse(response.body) as Record<string, any>;
const lease = (port: number, worker: Worker) => send(port, "POST", "/worker-control/v1/leases", undefined, auth(worker));
const proofCall = (port: number, worker: Worker, action: "heartbeat" | "release", attemptId: string, proof: Record<string, unknown>) =>
  send(port, "POST", `/worker-control/v1/attempts/${attemptId}/${action}`, JSON.stringify(proof), { ...auth(worker), "Content-Type": "application/json" });

async function attemptRow(id: string) {
  return (
    await clients.migrator.query<{
      state: string;
      lease_worker_principal_id: string | null;
      lease_token_sha256: string | null;
      lease_fencing_counter: string;
      leased_at: Date | null;
      lease_expires_at: Date | null;
      heartbeat_at: Date | null;
      credential_granted_at: Date | null;
      submitting_at: Date | null;
    }>(
      `SELECT state, lease_worker_principal_id, lease_token_sha256, lease_fencing_counter, leased_at, lease_expires_at, heartbeat_at,
              credential_granted_at, submitting_at
         FROM execution_attempts WHERE id = $1`,
      [id],
    )
  ).rows[0]!;
}

const jobStatus = async (id: string) => (await clients.migrator.query<{ status: string }>("SELECT status FROM execution_jobs WHERE id = $1", [id])).rows[0]!.status;
const auditText = async () => (await clients.migrator.query<{ text: string }>("SELECT string_agg(audit_events::text, '\n') AS text FROM audit_events")).rows[0]!.text ?? "";
const auditTypes = async (attemptId: string) =>
  (await clients.migrator.query<{ event_type: string }>("SELECT event_type FROM audit_events WHERE resource_id = $1 ORDER BY sequence", [attemptId])).rows.map(
    (row) => row.event_type,
  );
const eventSummary = () => events.map((event) => [event.type, event.reason]);

// ---------------------------------------------------------------------------

describe("lease acquisition", () => {
  it("leases the oldest eligible attempt, storing only the token verifier and moving the job to RUNNING", async () => {
    const [worker] = await workers(1);
    const first = await work();
    await work();
    const port = await compose([worker!]);

    const response = await lease(port, worker!);
    expect(response.status).toBe(200);
    const body = json(response).lease;
    expect(Object.keys(body).sort()).toEqual([
      "attemptNumber",
      "executionAttemptId",
      "executionJobId",
      "expectedCostCap",
      "fencingCounter",
      "generationRequest",
      "generationRequestSha256",
      "leaseExpiresAt",
      "leaseToken",
      "model",
      "provider",
    ]);
    expect(body).toMatchObject({
      executionJobId: first.jobId,
      executionAttemptId: first.attemptId,
      attemptNumber: 1,
      provider: "EXAMPLE_PROVIDER",
      model: "example-model-1",
      generationRequest: { prompt: "a lighthouse at dawn", durationSeconds: 5 },
      generationRequestSha256: "c".repeat(64),
      expectedCostCap: { unit: "MICRO_USD", amount: 2000000 },
      fencingCounter: 1,
    });
    expect(body.leaseToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Nothing about the credential leaves the control plane.
    expect(/credential|fingerprint|sealed|account|user/i.test(JSON.stringify(Object.keys(body)))).toBe(false);
    expect(response.body.includes(first.versionId)).toBe(false);

    const row = await attemptRow(first.attemptId);
    expect(row).toMatchObject({ state: "LEASED", lease_worker_principal_id: worker!.id, lease_fencing_counter: "1", credential_granted_at: null, submitting_at: null });
    expect(row.lease_token_sha256).toBe(createHash("sha256").update(body.leaseToken).digest("hex"));
    expect(row.lease_expires_at!.getTime() - row.leased_at!.getTime()).toBe(120_000);
    expect(row.heartbeat_at).toEqual(row.leased_at);
    expect(await jobStatus(first.jobId)).toBe("RUNNING");
    expect(await auditTypes(first.attemptId)).toEqual(["execution_attempt.leased"]);
    expect((await auditText()).includes(body.leaseToken)).toBe(false);
    expect(events).toEqual([]);
  });

  it("returns no lease when nothing is eligible, and never leases ineligible work", async () => {
    const [worker] = await workers(1);
    const cancelledJob = await work();
    await clients.migrator.query("UPDATE execution_jobs SET status = 'CANCELLED', completed_at = now() WHERE id = $1", [cancelledJob.jobId]);
    const disconnected = await work();
    await clients.migrator.query("UPDATE provider_connections SET status = 'DISCONNECTED', disconnected_at = now() WHERE id = $1", [disconnected.connectionId]);
    const destroyed = await work();
    await clients.migrator.query(
      `UPDATE provider_credential_versions SET status = 'DESTROYED', destroyed_at = now(), sealed_credential = NULL,
              fingerprint_algorithm = NULL, fingerprint_key_ref = NULL, fingerprint_value = NULL WHERE id = $1`,
      [destroyed.versionId],
    );
    const port = await compose([worker!]);

    const response = await lease(port, worker!);
    expect(response.status).toBe(200);
    expect(json(response)).toEqual({ lease: null });
    for (const item of [cancelledJob, disconnected, destroyed]) expect((await attemptRow(item.attemptId)).state).toBe("QUEUED");
  });

  it("never lets two workers lease the same attempt, under concurrency", async () => {
    for (let round = 0; round < 5; round += 1) {
      await prepareSchemaV1(clients);
      const pair = await workers(2);
      const only = await work();
      const port = await compose(pair);
      const responses = await Promise.all(pair.map((worker) => lease(port, worker)));
      const leases = responses.map((response) => json(response).lease).filter((value) => value !== null);
      expect(leases).toHaveLength(1);
      expect(leases[0].executionAttemptId).toBe(only.attemptId);
      expect(leases[0].fencingCounter).toBe(1);
      await server!.close();
      server = undefined;
    }

    await prepareSchemaV1(clients);
    const many = await workers(4);
    const items = [await work(), await work()];
    const port = await compose(many);
    const leased = (await Promise.all(many.map((worker) => lease(port, worker)))).map((response) => json(response).lease).filter((value) => value !== null);
    expect(new Set(leased.map((value) => value.executionAttemptId))).toEqual(new Set(items.map((item) => item.attemptId)));
  });

  it("holds a worker to one current lease (initial concurrency 1)", async () => {
    const [worker] = await workers(1);
    await work();
    await work();
    const port = await compose([worker!]);
    expect((await lease(port, worker!)).status).toBe(200);
    const second = await lease(port, worker!);
    expect(second.status).toBe(409);
    expect(second.body).toBe('{"status":"error","code":"LEASE_REJECTED"}\n');
    expect(eventSummary()).toEqual([["WORKER_LEASE_REJECTED", "WORKER_AT_CAPACITY"]]);
  });

  it("rolls back a failed acquisition completely", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const failing: TransactionalPool = {
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
    const port = await compose([worker!], failing);
    const response = await lease(port, worker!);
    expect(response.status).toBe(503);
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "QUEUED", lease_fencing_counter: "0", lease_token_sha256: null, lease_worker_principal_id: null });
    expect(await jobStatus(item.jobId)).toBe("QUEUED");
    expect(await auditText()).toBe("");
  });
});

describe("heartbeat and fencing", () => {
  async function leased(count = 2) {
    const list = await workers(count);
    const item = await work();
    const port = await compose(list);
    const body = json(await lease(port, list[0]!)).lease;
    return { list, item, port, proof: { fencingCounter: body.fencingCounter as number, leaseToken: body.leaseToken as string } };
  }

  it("renews only the current lease, keeping state and fencing", async () => {
    const { list, item, port, proof } = await leased();
    // Age the lease so the renewal is observable.
    await clients.migrator.query(
      "UPDATE execution_attempts SET leased_at = now() - interval '90 seconds', heartbeat_at = now() - interval '90 seconds', lease_expires_at = now() + interval '30 seconds' WHERE id = $1",
      [item.attemptId],
    );
    const before = await attemptRow(item.attemptId);
    const response = await proofCall(port, list[0]!, "heartbeat", item.attemptId, proof);
    expect(response.status).toBe(200);
    expect(json(response).fencingCounter).toBe(1);
    const after = await attemptRow(item.attemptId);
    expect(after.state).toBe("LEASED");
    expect(after.lease_fencing_counter).toBe("1");
    expect(after.lease_token_sha256).toBe(before.lease_token_sha256);
    expect(after.lease_expires_at!.getTime()).toBeGreaterThan(before.lease_expires_at!.getTime());
    expect(after.heartbeat_at!.getTime()).toBeGreaterThan(before.heartbeat_at!.getTime());
    expect(new Date(json(response).leaseExpiresAt).getTime()).toBe(after.lease_expires_at!.getTime());
  });

  it("rejects stale or invented fencing, wrong tokens, other workers and unknown attempts with one 409", async () => {
    const { list, item, port, proof } = await leased();
    const otherToken = randomBytes(32).toString("base64url");
    const cases: [typeof list[number], string, Record<string, unknown>, string, string][] = [
      [list[0]!, item.attemptId, { ...proof, fencingCounter: 2 }, "WORKER_FENCING_REJECTED", "FENCING_MISMATCH"],
      [list[0]!, item.attemptId, { ...proof, leaseToken: otherToken }, "WORKER_FENCING_REJECTED", "TOKEN_MISMATCH"],
      [list[1]!, item.attemptId, proof, "WORKER_LEASE_REJECTED", "OTHER_WORKER"],
      [list[0]!, randomUUID(), proof, "WORKER_LEASE_REJECTED", "UNKNOWN_ATTEMPT"],
    ];
    for (const [worker, attemptId, body] of cases) {
      for (const action of ["heartbeat", "release"] as const) {
        const response = await proofCall(port, worker, action, attemptId, body);
        expect(response.status).toBe(409);
        expect(response.body).toBe('{"status":"error","code":"LEASE_REJECTED"}\n');
      }
    }
    expect(eventSummary()).toEqual(cases.flatMap(([, , , type, reason]) => [[type, reason], [type, reason]]));
    expect(events.every((event) => event.workerPrincipalId !== undefined && event.executionAttemptId !== undefined)).toBe(true);
    // Nothing changed, and the genuine lease still works.
    expect((await attemptRow(item.attemptId)).state).toBe("LEASED");
    expect((await proofCall(port, list[0]!, "heartbeat", item.attemptId, proof)).status).toBe(200);
    // No token in any security event or audit row.
    const visible = JSON.stringify(events) + (await auditText());
    expect(visible.includes(proof.leaseToken) || visible.includes(otherToken)).toBe(false);
  });

  it("refuses an expired lease, then reclaims it for the next worker at a higher fencing generation", async () => {
    const { list, item, port, proof } = await leased();
    await clients.migrator.query(
      "UPDATE execution_attempts SET leased_at = now() - interval '10 minutes', heartbeat_at = now() - interval '10 minutes', lease_expires_at = now() - interval '1 second' WHERE id = $1",
      [item.attemptId],
    );
    expect((await proofCall(port, list[0]!, "heartbeat", item.attemptId, proof)).status).toBe(409);
    expect(eventSummary()).toEqual([["WORKER_LEASE_REJECTED", "LEASE_EXPIRED"]]);

    const second = json(await lease(port, list[1]!)).lease;
    expect(second).toMatchObject({ executionAttemptId: item.attemptId, fencingCounter: 2 });
    expect(await auditTypes(item.attemptId)).toEqual(["execution_attempt.leased", "execution_attempt.lease_expired", "execution_attempt.leased"]);
    // The old lease is dead; the new one works.
    expect((await proofCall(port, list[0]!, "heartbeat", item.attemptId, proof)).status).toBe(409);
    expect((await proofCall(port, list[1]!, "heartbeat", item.attemptId, { fencingCounter: 2, leaseToken: second.leaseToken })).status).toBe(200);
    expect((await attemptRow(item.attemptId)).lease_worker_principal_id).toBe(list[1]!.id);
  });

  it("releases a pre-grant lease to the queue; the next lease takes generation 2 and the old proof dies", async () => {
    const { list, item, port, proof } = await leased();
    const released = await proofCall(port, list[0]!, "release", item.attemptId, proof);
    expect(released.status).toBe(200);
    expect(json(released)).toEqual({ released: true });
    expect(await attemptRow(item.attemptId)).toMatchObject({
      state: "QUEUED",
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      lease_expires_at: null,
      lease_fencing_counter: "1",
      credential_granted_at: null,
    });
    expect(await jobStatus(item.jobId)).toBe("QUEUED");

    const again = json(await lease(port, list[0]!)).lease;
    expect(again.fencingCounter).toBe(2);
    expect(again.leaseToken).not.toBe(proof.leaseToken);
    expect((await proofCall(port, list[0]!, "heartbeat", item.attemptId, proof)).status).toBe(409);
    expect((await proofCall(port, list[0]!, "heartbeat", item.attemptId, { fencingCounter: 2, leaseToken: again.leaseToken })).status).toBe(200);
    expect(await auditTypes(item.attemptId)).toEqual(["execution_attempt.leased", "execution_attempt.lease_released", "execution_attempt.leased"]);
  });

  it("will not release a lease that holds a credential grant", async () => {
    const { list, item, port, proof } = await leased();
    // Simulates a future grant: this slice itself never writes credential_granted_at.
    await clients.migrator.query("UPDATE execution_attempts SET credential_granted_at = now() WHERE id = $1", [item.attemptId]);
    const response = await proofCall(port, list[0]!, "release", item.attemptId, proof);
    expect(response.status).toBe(409);
    expect(eventSummary()).toEqual([["WORKER_LEASE_REJECTED", "CREDENTIAL_GRANTED"]]);
    expect((await attemptRow(item.attemptId)).state).toBe("LEASED");
  });

  it("validates the proof body strictly", async () => {
    const { list, item, port, proof } = await leased();
    for (const body of [
      {},
      { fencingCounter: 1 },
      { leaseToken: proof.leaseToken },
      { ...proof, fencingCounter: "1" },
      { ...proof, fencingCounter: 0 },
      { ...proof, fencingCounter: 1.5 },
      { ...proof, leaseToken: "short" },
      { ...proof, workerPrincipalId: list[0]!.id },
      { ...proof, leaseExpiresAt: new Date().toISOString() },
    ]) {
      expect((await proofCall(port, list[0]!, "heartbeat", item.attemptId, body)).status).toBe(400);
    }
    const duplicate = `{"fencingCounter":1,"fencingCounter":1,"leaseToken":"${proof.leaseToken}"}`;
    const headers = { ...auth(list[0]!), "Content-Type": "application/json" };
    expect((await send(port, "POST", `/worker-control/v1/attempts/${item.attemptId}/heartbeat`, duplicate, headers)).status).toBe(400);
    expect((await send(port, "POST", `/worker-control/v1/attempts/${item.attemptId}/heartbeat`, JSON.stringify(proof), auth(list[0]!))).status).toBe(415);
    expect((await send(port, "POST", `/worker-control/v1/attempts/${item.attemptId}/heartbeat`, `{"x":"${"y".repeat(5000)}"}`, headers)).status).toBe(413);
    expect((await send(port, "POST", "/worker-control/v1/leases", "{}", headers)).status).toBe(400);
  });
});

describe("worker authority", () => {
  it("re-checks the principal inside the transaction: a worker disabled after authenticating cannot lease", async () => {
    const [worker] = await workers(1);
    const item = await work();
    // Disable the principal after authentication has read it ACTIVE, before the lease transaction starts.
    const disablingPool: TransactionalPool = {
      query: pool.query,
      end: async () => {},
      connect: async () => {
        await clients.migrator.query("UPDATE worker_principals SET status = 'DISABLED', disabled_at = now() WHERE id = $1 AND status = 'ACTIVE'", [worker!.id]);
        return pool.connect();
      },
    };
    const port = await compose([worker!], disablingPool);
    const response = await lease(port, worker!);
    expect(response.status).toBe(401);
    expect(response.body).toBe('{"status":"error","code":"AUTHENTICATION_REQUIRED"}\n');
    expect(eventSummary()).toEqual([["WORKER_LEASE_REJECTED", "WORKER_NOT_ACTIVE"]]);
    expect((await attemptRow(item.attemptId)).state).toBe("QUEUED");
    // Once disabled, authentication itself refuses, with the same response.
    const again = await lease(port, worker!);
    expect(again.body).toBe(response.body);
    expect(events.at(-1)).toMatchObject({ type: "WORKER_AUTH_REJECTED", reason: "PRINCIPAL_DISABLED" });
  });

  it("keeps customer and worker credentials apart in both directions", async () => {
    const [worker] = await workers(1);
    await work();
    const port = await compose([worker!]);
    const customerOnWorker = await send(port, "POST", "/worker-control/v1/leases", undefined, { Authorization: `Bearer ${CUSTOMER_TOKEN}` });
    expect(customerOnWorker.status).toBe(401);
    expect(eventSummary()).toEqual([["WORKER_AUTH_REJECTED", "ADAPTER_REJECTED"]]);
    const workerOnCustomer = await send(port, "GET", "/productions", undefined, auth(worker!));
    expect(workerOnCustomer.status).toBe(401);
  });

  it("reaches no state beyond LEASED and never writes a credential grant", async () => {
    const list = await workers(2);
    const items = [await work(), await work()];
    const port = await compose(list);
    const first = json(await lease(port, list[0]!)).lease;
    await proofCall(port, list[0]!, "heartbeat", first.executionAttemptId, { fencingCounter: first.fencingCounter, leaseToken: first.leaseToken });
    await proofCall(port, list[0]!, "release", first.executionAttemptId, { fencingCounter: first.fencingCounter, leaseToken: first.leaseToken });
    await lease(port, list[1]!);
    const states = await clients.migrator.query(
      "SELECT state, count(*)::int AS count, bool_or(credential_granted_at IS NOT NULL) AS granted, bool_or(submitting_at IS NOT NULL) AS submitting FROM execution_attempts WHERE id = ANY($1) GROUP BY state ORDER BY state",
      [items.map((item) => item.attemptId)],
    );
    expect(states.rows).toEqual([
      { state: "LEASED", count: 1, granted: false, submitting: false },
      { state: "QUEUED", count: 1, granted: false, submitting: false },
    ]);
  });
});
