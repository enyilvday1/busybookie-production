import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type RuntimeClient, type TransactionalPool } from "../../src/database/runtimePool.js";
import { readCredentialObligations } from "../../src/providerConnections/credentialObligations.js";
import { PROVIDER_CREDENTIAL_PURPOSE } from "commercial-worker-protocol";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../src/startCommercialApiServer.js";
import { createWorkerControlApplication } from "../../src/workerControl/workerControlApplication.js";
import type { WorkerSecurityEvent } from "../../src/workerControl/workerSecurityEvents.js";
import { disconnectProviderConnection } from "../../src/providerConnections/providerConnectionService.js";
import { WORKER_EXPIRED_LEASE_RECLAIM_LIMIT, WORKER_MAX_CURRENT_LEASES } from "../../src/workerControl/workerLeasePolicy.js";
import { send, type TestResponse } from "../httpClient.js";
import { createTestCredentialFingerprinter, createTestCredentialSealer, generateTestKey } from "../support/testCredentialCrypto.js";
import { createTestWorkerAuthenticationAdapter } from "../support/testWorkerAuthentication.js";
import { createRecordingWorkerSecurityEventSink } from "../support/testWorkerSecurityEvents.js";
import { insertAccountWithFreeGrant, openGuardedClients, prepareSchemaV1, type GuardedClients } from "./support/testDatabase.js";

// R44B6X granted-but-expired LEASED recovery against PostgreSQL 16, over the
// explicitly composed worker-control router (architecture section 12, policy
// locked by R44B6X0). Recovery runs inside lease acquisition; no provider is
// called and no credential is opened. Assertions on secrets are booleans, so
// a failure never prints one.

let clients: GuardedClients;
let pool: TransactionalPool;
let server: RunningCommercialApiServer | undefined;
let events: WorkerSecurityEvent[];
let setSinkFailing: (failing: boolean) => void;

const encryptionKey = generateTestKey("granted-recovery-test-encryption/v1");
const sealer = createTestCredentialSealer(encryptionKey);
const fingerprinter = createTestCredentialFingerprinter(generateTestKey("granted-recovery-test-fingerprint/v1"), encryptionKey);

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
    const id = (await clients.migrator.query<{ id: string }>("INSERT INTO worker_principals (label) VALUES ($1) RETURNING id", [`recovery-worker-${index}`])).rows[0]!.id;
    list.push({ id, token: `fixture-worker-${randomBytes(16).toString("hex")}` });
  }
  return list;
}

type Work = Readonly<{ userId: string; accountId: string; connectionId: string; versionId: string; jobId: string; attemptId: string; plaintext: string }>;

const q = <T extends object>(sql: string, params: unknown[]) => clients.migrator.query<T>(sql, params).then((result) => result.rows[0]!);

// One claimed authorization bound to the exact sealed version 1, with its job and QUEUED attempt.
async function work(): Promise<Work> {
  const provider = "EXAMPLE_PROVIDER";
  const owner = await insertAccountWithFreeGrant(clients.migrator, `recovery-${randomUUID()}`);
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
// HTTP and row helpers

const auth = (worker: Worker) => ({ Authorization: `Bearer ${worker.token}` });
const json = (response: TestResponse) => JSON.parse(response.body) as Record<string, any>;
type Proof = { fencingCounter: number; leaseToken: string };

const acquire = (port: number, worker: Worker) => send(port, "POST", "/worker-control/v1/leases", undefined, auth(worker));
async function leaseFor(port: number, worker: Worker): Promise<Proof & { attemptId: string }> {
  const body = json(await acquire(port, worker)).lease;
  return { attemptId: body.executionAttemptId, fencingCounter: body.fencingCounter, leaseToken: body.leaseToken };
}
const call = (port: number, worker: Worker, action: string, attemptId: string, body: Record<string, unknown>) =>
  send(port, "POST", `/worker-control/v1/attempts/${attemptId}/${action}`, JSON.stringify(body), { ...auth(worker), "Content-Type": "application/json" });
const proofBody = (proof: Proof) => ({ fencingCounter: proof.fencingCounter, leaseToken: proof.leaseToken });
async function granted(port: number, worker: Worker) {
  const proof = await leaseFor(port, worker);
  expect((await call(port, worker, "credential-grant", proof.attemptId, proofBody(proof))).status).toBe(200);
  return proof;
}

type Row = {
  state: string;
  credential_granted_at: Date | null;
  submitting_at: Date | null;
  lease_worker_principal_id: string | null;
  lease_token_sha256: string | null;
  leased_at: Date | null;
  lease_expires_at: Date | null;
  heartbeat_at: Date | null;
  lease_fencing_counter: string;
  failure_code: string | null;
};
const row = async (id: string) =>
  (
    await clients.migrator.query<Row>(
      `SELECT state, credential_granted_at, submitting_at, lease_worker_principal_id, lease_token_sha256, leased_at, lease_expires_at,
              heartbeat_at, lease_fencing_counter, failure_code
         FROM execution_attempts WHERE id = $1`,
      [id],
    )
  ).rows[0]!;
const jobStatus = async (id: string) => (await clients.migrator.query<{ status: string }>("SELECT status FROM execution_jobs WHERE id = $1", [id])).rows[0]!.status;
const versionRow = async (id: string) =>
  (await clients.migrator.query<Record<string, unknown>>("SELECT status, retained_for_recovery_at, destroyed_at, updated_at FROM provider_credential_versions WHERE id = $1", [id])).rows[0]!;
const audits = async (attemptId: string) =>
  (
    await clients.migrator.query<{ event_type: string; metadata: Record<string, unknown> }>(
      "SELECT event_type, metadata FROM audit_events WHERE resource_id = $1 ORDER BY sequence",
      [attemptId],
    )
  ).rows.map(({ event_type, metadata }) => [event_type, metadata] as const);
const allAuditText = async () => (await clients.migrator.query<{ text: string | null }>("SELECT string_agg(audit_events::text, '\n') AS text FROM audit_events")).rows[0]!.text ?? "";
const expire = (attemptId: string, ago = "1 second") =>
  clients.migrator.query(
    `UPDATE execution_attempts SET leased_at = now() - interval '30 minutes', heartbeat_at = now() - interval '30 minutes',
            lease_expires_at = now() - interval '${ago}' WHERE id = $1`,
    [attemptId],
  );
const disconnect = (item: Work) => disconnectProviderConnection({ pool }, { userId: item.userId, accountId: item.accountId }, item.connectionId);
const LEASE_CLEARED = { lease_worker_principal_id: null, lease_token_sha256: null, leased_at: null, lease_expires_at: null, heartbeat_at: null };

// ---------------------------------------------------------------------------

describe("granted-but-expired LEASED recovery", () => {
  it("requeues a granted expired lease atomically with its job, keeping the fence and the credential version", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const proof = await granted(port, list[0]!);
    // A disconnect after the grant retains the exact version for that grant;
    // it also keeps the requeued attempt from being leased again at once.
    await disconnect(item);
    const versionBefore = await versionRow(item.versionId);
    expect(versionBefore.status).toBe("RETAINED_FOR_RECOVERY");
    await expire(item.attemptId);
    expect(await jobStatus(item.jobId)).toBe("RUNNING");
    events.length = 0;

    expect(json(await acquire(port, list[1]!))).toEqual({ lease: null });
    expect(await row(item.attemptId)).toMatchObject({ state: "QUEUED", credential_granted_at: null, submitting_at: null, failure_code: null, lease_fencing_counter: "1", ...LEASE_CLEARED });
    expect(await jobStatus(item.jobId)).toBe("QUEUED");
    // No credential version lifecycle change.
    expect(await versionRow(item.versionId)).toEqual(versionBefore);
    // Audited with the existing event and a granted marker; no security event.
    expect((await audits(item.attemptId)).at(-1)).toEqual([
      "execution_attempt.lease_expired",
      { attemptNumber: 1, fencingCounter: 1, workerPrincipalId: list[0]!.id, grantedLeaseRecovered: true },
    ]);
    expect(events).toEqual([]);
    const visible = await allAuditText();
    expect(visible.includes(proof.leaseToken) || visible.includes(item.plaintext) || /sealed|fingerprint|lease_token/i.test(visible)).toBe(false);
  });

  it("refuses the stale proof afterwards and gives the next lease a strictly higher fence and a new token", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const old = await granted(port, list[0]!);
    expect(old.fencingCounter).toBe(1);
    await expire(item.attemptId);

    const next = await leaseFor(port, list[1]!);
    expect(next).toMatchObject({ attemptId: item.attemptId, fencingCounter: 2 });
    expect(next.leaseToken).not.toBe(old.leaseToken);
    // Recovery kept fence 1; the new lease incremented it exactly once.
    expect((await audits(item.attemptId)).map(([type, metadata]) => [type, metadata.fencingCounter])).toEqual([
      ["execution_attempt.leased", 1],
      ["execution_attempt.credential_granted", 1],
      ["execution_attempt.lease_expired", 1],
      ["execution_attempt.leased", 2],
    ]);
    expect(await row(item.attemptId)).toMatchObject({ state: "LEASED", credential_granted_at: null, lease_worker_principal_id: list[1]!.id, lease_fencing_counter: "2" });

    events.length = 0;
    for (const action of ["heartbeat", "credential-grant", "submitting"]) {
      expect((await call(port, list[0]!, action, item.attemptId, proofBody(old))).status).toBe(409);
    }
    expect(events.map((event) => event.reason)).toEqual(["OTHER_WORKER", "OTHER_WORKER", "OTHER_WORKER"]);
    // The old grant never carries over: the new lease must obtain its own.
    expect((await row(item.attemptId)).credential_granted_at).toBeNull();
    expect((await call(port, list[1]!, "credential-grant", item.attemptId, proofBody(next))).status).toBe(200);
  });

  it("keeps the ordinary ungranted reclaim, without the granted marker", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    await leaseFor(port, list[0]!);
    await expire(item.attemptId);
    expect(await leaseFor(port, list[1]!)).toMatchObject({ attemptId: item.attemptId, fencingCounter: 2 });
    const reclaimed = (await audits(item.attemptId)).find(([type]) => type === "execution_attempt.lease_expired");
    expect(reclaimed).toEqual(["execution_attempt.lease_expired", { attemptNumber: 1, fencingCounter: 1, workerPrincipalId: list[0]!.id }]);
  });

  it("never touches a granted lease that is still live", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const proof = await granted(port, list[0]!);
    const before = await row(item.attemptId);
    expect(json(await acquire(port, list[1]!))).toEqual({ lease: null });
    expect(await row(item.attemptId)).toEqual(before);
    expect((await call(port, list[0]!, "heartbeat", item.attemptId, proofBody(proof))).status).toBe(200);
  });

  it("never handles SUBMITTING: an expired SUBMITTING attempt goes to the existing sweep", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const proof = await granted(port, list[0]!);
    expect((await call(port, list[0]!, "submitting", item.attemptId, proofBody(proof))).status).toBe(200);
    await expire(item.attemptId);
    expect(json(await acquire(port, list[1]!))).toEqual({ lease: null });
    const after = await row(item.attemptId);
    expect(after).toMatchObject({ state: "OUTCOME_UNKNOWN", failure_code: "WORKER_LEASE_EXPIRED_DURING_SUBMISSION" });
    expect(after.credential_granted_at).not.toBeNull();
    expect((await audits(item.attemptId)).some(([type]) => type === "execution_attempt.lease_expired")).toBe(false);
  });

  it("leaves later states alone even when their lease fields look expired", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const proof = await granted(port, list[0]!);
    expect((await call(port, list[0]!, "submitting", item.attemptId, proofBody(proof))).status).toBe(200);
    expect((await call(port, list[0]!, "submitted", item.attemptId, { ...proofBody(proof), providerExecutionId: "synthetic/op-1" })).status).toBe(200);
    await expire(item.attemptId);
    const before = await row(item.attemptId);
    expect(json(await acquire(port, list[1]!))).toEqual({ lease: null });
    expect(await row(item.attemptId)).toEqual(before);
    expect(before.state).toBe("SUBMITTED");
  });

  it("issues no provider credential version statement during acquisition", async () => {
    const list = await workers(2);
    const item = await work();
    const leasePort = await compose(list);
    await granted(leasePort, list[0]!);
    await expire(item.attemptId);
    await server!.close();
    const recorded = recordingPool();
    const port = await compose(list, recorded.pool);
    await acquire(port, list[1]!);
    expect((await row(item.attemptId)).credential_granted_at).toBeNull();
    // Only the eligibility filter of the next-attempt query reads versions; nothing writes them.
    expect(recorded.statements.some((sql) => /UPDATE\s+provider_credential_versions|DELETE\s+FROM\s+provider_credential_versions/i.test(sql))).toBe(false);
  });
});

describe("requesting-worker capacity", () => {
  it("recovers the worker's own expired granted lease before the capacity check, even when the shared batch is full", async () => {
    expect(WORKER_MAX_CURRENT_LEASES).toBe(1);
    // Enough other expired leases, all expiring earlier, to fill the shared batch.
    const others = await workers(WORKER_EXPIRED_LEASE_RECLAIM_LIMIT);
    const [requester] = await workers(1);
    const items: Work[] = [];
    for (let index = 0; index < WORKER_EXPIRED_LEASE_RECLAIM_LIMIT + 2; index += 1) items.push(await work());
    const port = await compose([...others, requester!]);
    for (const worker of others) await leaseFor(port, worker);
    const own = await granted(port, requester!);
    for (const item of items) {
      if (item.attemptId !== own.attemptId && (await row(item.attemptId)).state === "LEASED") await expire(item.attemptId, "10 minutes");
    }
    // The requester's own lease expired last, so the oldest-first shared batch omits it.
    await expire(own.attemptId, "1 second");
    const earlier = await clients.migrator.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM execution_attempts WHERE state = 'LEASED' AND lease_expires_at < (SELECT lease_expires_at FROM execution_attempts WHERE id = $1)",
      [own.attemptId],
    );
    expect(earlier.rows[0]!.n).toBeGreaterThanOrEqual(WORKER_EXPIRED_LEASE_RECLAIM_LIMIT);
    // Before: the stale lease counts against the requester's capacity.
    expect(
      (await clients.migrator.query<{ n: number }>("SELECT count(*)::int AS n FROM execution_attempts WHERE lease_worker_principal_id = $1", [requester!.id])).rows[0]!.n,
    ).toBe(WORKER_MAX_CURRENT_LEASES);

    const response = await acquire(port, requester!);
    expect(response.status).toBe(200);
    const next = json(response).lease;
    expect(next).not.toBeNull();
    expect(next.executionAttemptId).not.toBe(own.attemptId);
    expect(await row(own.attemptId)).toMatchObject({ state: "QUEUED", credential_granted_at: null, ...LEASE_CLEARED, lease_fencing_counter: "1" });
    expect((await audits(own.attemptId)).at(-1)).toEqual([
      "execution_attempt.lease_expired",
      { attemptNumber: 1, fencingCounter: 1, workerPrincipalId: requester!.id, grantedLeaseRecovered: true },
    ]);
    // The global capacity rule still holds: exactly one current lease.
    expect(
      (await clients.migrator.query<{ n: number }>("SELECT count(*)::int AS n FROM execution_attempts WHERE lease_worker_principal_id = $1", [requester!.id])).rows[0]!.n,
    ).toBe(1);
  });
});

describe("races (the attempt row lock decides)", () => {
  it("a live heartbeat holding the row wins; recovery skips it and never resurrects or clears that lease", async () => {
    const list = await workers(2);
    const item = await work();
    const leasePort = await compose(list);
    const proof = await granted(leasePort, list[0]!);
    await server!.close();
    await clients.migrator.query("UPDATE execution_attempts SET lease_expires_at = clock_timestamp() + interval '1500 milliseconds' WHERE id = $1", [item.attemptId]);
    const gated = gatedPool((sql) => /SET heartbeat_at = now\(\)/.test(sql));
    const port = await compose(list, gated.pool);
    const heartbeat = call(port, list[0]!, "heartbeat", item.attemptId, proofBody(proof));
    await gated.paused;
    await new Promise((resolve) => setTimeout(resolve, 1700));
    // The lease is now past its old expiry, but the heartbeat holds the row: recovery skips it.
    expect(json(await acquire(port, list[1]!))).toEqual({ lease: null });
    gated.release();
    expect((await heartbeat).status).toBe(200);
    const after = await row(item.attemptId);
    expect(after).toMatchObject({ state: "LEASED", lease_worker_principal_id: list[0]!.id, lease_fencing_counter: "1" });
    expect(after.credential_granted_at).not.toBeNull();
    expect(after.lease_expires_at!.getTime()).toBeGreaterThan(Date.now());
    expect((await audits(item.attemptId)).some(([type]) => type === "execution_attempt.lease_expired")).toBe(false);
  });

  it("SUBMITTING holding the row cannot commit once the lease expires; recovery then requeues it, never after a committed SUBMITTING", async () => {
    const list = await workers(2);
    const item = await work();
    const leasePort = await compose(list);
    const proof = await granted(leasePort, list[0]!);
    await server!.close();
    await clients.migrator.query("UPDATE execution_attempts SET lease_expires_at = clock_timestamp() + interval '1500 milliseconds' WHERE id = $1", [item.attemptId]);
    const gated = gatedPool((sql) => sql.includes("FROM provider_connections WHERE account_id = $1 AND id = $2 FOR SHARE"));
    const port = await compose(list, gated.pool);
    const submitting = call(port, list[0]!, "submitting", item.attemptId, proofBody(proof));
    await gated.paused;
    await new Promise((resolve) => setTimeout(resolve, 1700));
    // Recovery skips the locked row while SUBMITTING holds it.
    expect(json(await acquire(port, list[1]!))).toEqual({ lease: null });
    gated.release();
    // The database barrier refuses the expired lease: SUBMITTING never commits.
    expect((await submitting).status).toBe(409);
    expect((await row(item.attemptId)).state).toBe("LEASED");
    // The next acquisition recovers and re-leases it at a higher fence.
    expect(await leaseFor(port, list[1]!)).toMatchObject({ attemptId: item.attemptId, fencingCounter: 2 });
    expect((await row(item.attemptId)).submitting_at).toBeNull();
  });

  it("a stale grant after recovery is refused and leaves no grant on the requeued attempt", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const proof = await granted(port, list[0]!);
    await disconnect(item);
    await expire(item.attemptId);
    expect(json(await acquire(port, list[1]!))).toEqual({ lease: null });
    expect((await call(port, list[0]!, "credential-grant", item.attemptId, proofBody(proof))).status).toBe(409);
    expect((await call(port, list[0]!, "heartbeat", item.attemptId, proofBody(proof))).status).toBe(409);
    expect(await row(item.attemptId)).toMatchObject({ state: "QUEUED", credential_granted_at: null, ...LEASE_CLEARED });
  });
});
