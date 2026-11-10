import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type RuntimeClient, type TransactionalPool } from "../../src/database/runtimePool.js";
import { readCredentialObligations } from "../../src/providerConnections/credentialObligations.js";
import { disconnectProviderConnection } from "../../src/providerConnections/providerConnectionService.js";
import { PROVIDER_CREDENTIAL_PURPOSE } from "../../src/providerCredentials/credentialContext.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../src/startCommercialApiServer.js";
import { createWorkerControlApplication } from "../../src/workerControl/workerControlApplication.js";
import type { WorkerSecurityEvent } from "../../src/workerControl/workerSecurityEvents.js";
import { send, type TestResponse } from "../httpClient.js";
import { createTestCredentialFingerprinter, createTestCredentialOpener, createTestCredentialSealer, generateTestKey } from "../support/testCredentialCrypto.js";
import { createTestWorkerAuthenticationAdapter } from "../support/testWorkerAuthentication.js";
import { createRecordingWorkerSecurityEventSink } from "../support/testWorkerSecurityEvents.js";
import { insertAccountWithFreeGrant, openGuardedClients, prepareSchemaV1, type GuardedClients } from "./support/testDatabase.js";

// R44B6H exact credential grant against PostgreSQL 16, over the explicitly
// composed worker-control router. Credentials are generated fixture strings
// sealed by the test sealer; the test-only opener exists here solely to prove
// the returned envelope and context are exactly right. Assertions on secrets
// are booleans, so a failure never prints one.

let clients: GuardedClients;
let pool: TransactionalPool;
let server: RunningCommercialApiServer | undefined;
let events: WorkerSecurityEvent[];

const encryptionKey = generateTestKey("grant-test-encryption/v1");
const sealer = createTestCredentialSealer(encryptionKey);
const fingerprinter = createTestCredentialFingerprinter(generateTestKey("grant-test-fingerprint/v1"), encryptionKey);
const opener = createTestCredentialOpener(encryptionKey);

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
    const id = (await clients.migrator.query<{ id: string }>("INSERT INTO worker_principals (label) VALUES ($1) RETURNING id", [`grant-worker-${index}`])).rows[0]!.id;
    list.push({ id, token: `fixture-worker-${randomBytes(16).toString("hex")}` });
  }
  return list;
}

type Work = Readonly<{
  userId: string;
  accountId: string;
  connectionId: string;
  versionId: string;
  credentialVersion: number;
  jobId: string;
  attemptId: string;
  plaintext: string;
  fingerprintValue: string;
}>;

const q = <T extends object>(sql: string, params: unknown[]) => clients.migrator.query<T>(sql, params).then((result) => result.rows[0]!);

// One claimed authorization bound to the exact sealed version 1 (or to a
// superseded v1 when a v2 is rotated in), with its job and QUEUED attempt.
async function work(options: Readonly<{ rotateAfterBinding?: boolean }> = {}): Promise<Work> {
  const provider = "EXAMPLE_PROVIDER";
  const owner = await insertAccountWithFreeGrant(clients.migrator, `grant-${randomUUID()}`);
  const production = await q<{ id: string }>(
    "INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id) VALUES ($1, 'Production', $2, $3) RETURNING id",
    [owner.accountId, owner.grantId, owner.userId],
  );
  const connection = await q<{ id: string }>(
    "INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id) VALUES ($1, $2, 'API_KEY', $3) RETURNING id",
    [owner.accountId, provider, owner.userId],
  );
  const insertVersion = async (credentialVersion: number) => {
    const plaintext = `fixture-credential-${randomBytes(18).toString("hex")}`;
    const envelope = await sealer.seal(plaintext, {
      accountId: owner.accountId,
      providerConnectionId: connection.id,
      provider,
      credentialVersion,
      purpose: PROVIDER_CREDENTIAL_PURPOSE,
    });
    const fingerprint = await fingerprinter.fingerprint(plaintext);
    const row = await q<{ id: string }>(
      `INSERT INTO provider_credential_versions (account_id, provider_connection_id, credential_version, sealed_credential, fingerprint_algorithm,
                                                 fingerprint_key_ref, fingerprint_value, created_by_user_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8) RETURNING id`,
      [owner.accountId, connection.id, credentialVersion, JSON.stringify(envelope), fingerprint.algorithm, fingerprint.keyRef, fingerprint.value, owner.userId],
    );
    return { id: row.id, plaintext, fingerprintValue: fingerprint.value };
  };
  const v1 = await insertVersion(1);
  const authorization = await q<{ id: string }>(
    `INSERT INTO generation_authorizations
       (account_id, production_id, entitlement_grant_id, billing_mode, provider, model, provider_connection_id,
        provider_credential_version_id, generation_request, generation_request_sha256, expected_cost_cap_unit,
        expected_cost_cap_amount, expires_at, created_by_user_id)
     VALUES ($1, $2, $3, 'USER_BYO', $4, 'example-model-1', $5, $6, '{"prompt":"fixture"}'::jsonb, repeat('c', 64),
             'MICRO_USD', 2000000, now() + interval '15 minutes', $7) RETURNING id`,
    [owner.accountId, production.id, owner.grantId, provider, connection.id, v1.id, owner.userId],
  );
  await clients.migrator.query("UPDATE generation_authorizations SET status = 'CLAIMED', claimed_at = now() WHERE id = $1", [authorization.id]);
  const job = await q<{ id: string }>(
    "INSERT INTO execution_jobs (account_id, production_id, generation_authorization_id) VALUES ($1, $2, $3) RETURNING id",
    [owner.accountId, production.id, authorization.id],
  );
  const attempt = await q<{ id: string }>(
    `INSERT INTO execution_attempts (account_id, execution_job_id, generation_authorization_id, attempt_number, billing_mode, provider, provider_credential_version_id)
     VALUES ($1, $2, $3, 1, 'USER_BYO', $4, $5) RETURNING id`,
    [owner.accountId, job.id, authorization.id, provider, v1.id],
  );
  if (options.rotateAfterBinding === true) {
    await clients.migrator.query("UPDATE provider_credential_versions SET status = 'SUPERSEDED', superseded_at = now() WHERE id = $1", [v1.id]);
    await insertVersion(2);
  }
  return {
    userId: owner.userId,
    accountId: owner.accountId,
    connectionId: connection.id,
    versionId: v1.id,
    credentialVersion: 1,
    jobId: job.id,
    attemptId: attempt.id,
    plaintext: v1.plaintext,
    fingerprintValue: v1.fingerprintValue,
  };
}

async function compose(list: readonly Worker[], poolOverride: TransactionalPool = pool) {
  const recording = createRecordingWorkerSecurityEventSink();
  events = recording.events;
  const application = createWorkerControlApplication({
    authentication: createTestWorkerAuthenticationAdapter(list.map((worker) => ({ token: worker.token, workerPrincipalId: worker.id }))),
    securityEvents: recording.sink,
    pool: poolOverride,
    reportFailure: () => {},
  });
  server = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { application, checkReadiness: async () => true } });
  return server.port;
}

// A pool whose sessions pause at the first statement matching `pause` until
// released, holding whatever locks the transaction already has.
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

// ---------------------------------------------------------------------------
// HTTP helpers

const auth = (worker: Worker) => ({ Authorization: `Bearer ${worker.token}` });
const json = (response: TestResponse) => JSON.parse(response.body) as Record<string, any>;
type Proof = { fencingCounter: number; leaseToken: string };

async function leaseFor(port: number, worker: Worker): Promise<Proof & { attemptId: string }> {
  const body = json(await send(port, "POST", "/worker-control/v1/leases", undefined, auth(worker))).lease;
  return { attemptId: body.executionAttemptId, fencingCounter: body.fencingCounter, leaseToken: body.leaseToken };
}
const call = (port: number, worker: Worker, action: "credential-grant" | "release" | "heartbeat", attemptId: string, proof: Proof) =>
  send(port, "POST", `/worker-control/v1/attempts/${attemptId}/${action}`, JSON.stringify({ fencingCounter: proof.fencingCounter, leaseToken: proof.leaseToken }), {
    ...auth(worker),
    "Content-Type": "application/json",
  });

const attempt = async (id: string) =>
  (
    await clients.migrator.query<{ state: string; credential_granted_at: Date | null; submitting_at: Date | null; lease_worker_principal_id: string | null; lease_fencing_counter: string }>(
      "SELECT state, credential_granted_at, submitting_at, lease_worker_principal_id, lease_fencing_counter FROM execution_attempts WHERE id = $1",
      [id],
    )
  ).rows[0]!;
const version = async (id: string) =>
  (await clients.migrator.query<{ status: string; sealed_credential: unknown }>("SELECT status, sealed_credential FROM provider_credential_versions WHERE id = $1", [id])).rows[0]!;
const grantAudits = async (attemptId: string) =>
  (await clients.migrator.query<{ metadata: Record<string, unknown> }>(
    "SELECT metadata FROM audit_events WHERE resource_id = $1 AND event_type = 'execution_attempt.credential_granted' ORDER BY sequence",
    [attemptId],
  )).rows.map((row) => row.metadata);
const allAuditText = async () => (await clients.migrator.query<{ text: string | null }>("SELECT string_agg(audit_events::text, '\n') AS text FROM audit_events")).rows[0]!.text ?? "";
const disconnect = (item: Work, p: TransactionalPool = pool) => disconnectProviderConnection({ pool: p }, { userId: item.userId, accountId: item.accountId }, item.connectionId);

const REJECTED = '{"status":"error","code":"LEASE_REJECTED"}\n';

// ---------------------------------------------------------------------------

describe("exact credential grant", () => {
  it("returns exactly the bound sealed envelope and its opening context, records the grant once, and stays LEASED", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await leaseFor(port, worker!);

    const response = await call(port, worker!, "credential-grant", item.attemptId, proof);
    expect(response.status).toBe(200);
    const body = json(response);
    expect(Object.keys(body).sort()).toEqual(["credential", "credentialGrantedAt", "executionAttemptId", "fencingCounter"]);
    expect(Object.keys(body.credential).sort()).toEqual(["openingContext", "sealedEnvelope"]);
    expect(body.openingContext).toBeUndefined();
    expect(body.credential.openingContext).toEqual({
      accountId: item.accountId,
      providerConnectionId: item.connectionId,
      provider: "EXAMPLE_PROVIDER",
      credentialVersion: 1,
      purpose: "provider-credential",
    });
    expect(body.credential.sealedEnvelope).toEqual((await version(item.versionId)).sealed_credential);
    expect(body).toMatchObject({ executionAttemptId: item.attemptId, fencingCounter: 1 });

    // Proof only: the private worker's future opener can open it with exactly this context.
    expect((await opener.open(body.credential.sealedEnvelope, body.credential.openingContext)) === item.plaintext).toBe(true);
    // No plaintext, fingerprint or key reference of the fingerprint key leaves the control plane.
    expect(response.body.includes(item.plaintext)).toBe(false);
    expect(response.body.includes(item.fingerprintValue)).toBe(false);
    expect(/fingerprint/i.test(response.body)).toBe(false);

    const row = await attempt(item.attemptId);
    expect(row.state).toBe("LEASED");
    expect(row.submitting_at).toBeNull();
    expect(row.credential_granted_at!.toISOString()).toBe(body.credentialGrantedAt);
    expect(await grantAudits(item.attemptId)).toEqual([
      { attemptNumber: 1, fencingCounter: 1, workerPrincipalId: worker!.id, provider: "EXAMPLE_PROVIDER", credentialVersion: 1 },
    ]);
    const visible = (await allAuditText()) + JSON.stringify(events);
    expect(visible.includes(item.plaintext) || visible.includes(proof.leaseToken) || visible.includes(item.fingerprintValue)).toBe(false);

    // The grant opened the credential-retention obligation on exactly that version.
    const client = await pool.connect();
    try {
      const obligations = await readCredentialObligations(client, item.accountId, [item.versionId]);
      expect(obligations.get(item.versionId)).toEqual({ hasOpenCredentialRetentionObligation: true, hasOpenProviderRecoveryObligation: false, blocksDestruction: true });
    } finally {
      client.release();
    }
  });

  it("grants a SUPERSEDED bound version, never the newer active one", async () => {
    const [worker] = await workers(1);
    const item = await work({ rotateAfterBinding: true });
    const port = await compose([worker!]);
    const proof = await leaseFor(port, worker!);
    const body = json(await call(port, worker!, "credential-grant", item.attemptId, proof));
    expect(body.credential.openingContext.credentialVersion).toBe(1);
    expect((await opener.open(body.credential.sealedEnvelope, body.credential.openingContext)) === item.plaintext).toBe(true);
  });

  it("is idempotent for a retry under the same lease, including concurrent identical requests", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await leaseFor(port, worker!);
    const responses = await Promise.all([1, 2, 3].map(() => call(port, worker!, "credential-grant", item.attemptId, proof)));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    const bodies = responses.map(json);
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    const retry = json(await call(port, worker!, "credential-grant", item.attemptId, proof));
    expect(retry).toEqual(bodies[0]);
    expect(await grantAudits(item.attemptId)).toHaveLength(1);
  });

  it.each([
    ["a DISCONNECTED connection", "UPDATE provider_connections SET status = 'DISCONNECTED', disconnected_at = now() WHERE id = $1", "connection", "CONNECTION_INELIGIBLE"],
    ["a DISABLED connection", "UPDATE provider_connections SET status = 'DISABLED', disabled_at = now() WHERE id = $1", "connection", "CONNECTION_INELIGIBLE"],
    [
      "a RETAINED_FOR_RECOVERY version",
      "UPDATE provider_credential_versions SET status = 'RETAINED_FOR_RECOVERY', retained_for_recovery_at = now() WHERE id = $1",
      "version",
      "CREDENTIAL_VERSION_INELIGIBLE",
    ],
    [
      "a DESTROYED version",
      `UPDATE provider_credential_versions SET status = 'DESTROYED', destroyed_at = now(), sealed_credential = NULL,
              fingerprint_algorithm = NULL, fingerprint_key_ref = NULL, fingerprint_value = NULL WHERE id = $1`,
      "version",
      "CREDENTIAL_VERSION_INELIGIBLE",
    ],
  ] as const)("refuses %s with the uniform 409 and no material", async (_label, sql, target, reason) => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await leaseFor(port, worker!);
    await clients.migrator.query(sql, [target === "connection" ? item.connectionId : item.versionId]);

    const response = await call(port, worker!, "credential-grant", item.attemptId, proof);
    expect(response.status).toBe(409);
    expect(response.body).toBe(REJECTED);
    expect(events.map((event) => [event.type, event.reason])).toEqual([["WORKER_CREDENTIAL_GRANT_REJECTED", reason]]);
    expect((await attempt(item.attemptId)).credential_granted_at).toBeNull();
    expect(await grantAudits(item.attemptId)).toEqual([]);
  });

  it("refuses stale fencing after a re-lease, wrong tokens, other workers and unknown attempts", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const first = await leaseFor(port, list[0]!);
    expect((await call(port, list[0]!, "release", item.attemptId, first)).status).toBe(200);
    const second = await leaseFor(port, list[0]!);
    expect(second.fencingCounter).toBe(2);

    for (const [worker, attemptId, proof, reason] of [
      [list[0]!, item.attemptId, first, "FENCING_MISMATCH"],
      [list[0]!, item.attemptId, { ...second, leaseToken: randomBytes(32).toString("base64url") }, "TOKEN_MISMATCH"],
      [list[1]!, item.attemptId, second, "OTHER_WORKER"],
      [list[0]!, randomUUID(), second, "UNKNOWN_ATTEMPT"],
    ] as const) {
      const response = await call(port, worker, "credential-grant", attemptId, proof);
      expect(response.status).toBe(409);
      expect(response.body).toBe(REJECTED);
      expect(events.at(-1)).toMatchObject({ type: "WORKER_CREDENTIAL_GRANT_REJECTED", reason });
    }
    expect((await attempt(item.attemptId)).credential_granted_at).toBeNull();
    expect((await call(port, list[0]!, "credential-grant", item.attemptId, second)).status).toBe(200);
  });

  it("gives a worker disabled after authentication no credential material", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const leasePort = await compose([worker!]);
    const proof = await leaseFor(leasePort, worker!);
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
    const response = await call(port, worker!, "credential-grant", item.attemptId, proof);
    expect(response.status).toBe(401);
    expect(response.body.includes("sealed")).toBe(false);
    expect(events.map((event) => [event.type, event.reason])).toEqual([["WORKER_CREDENTIAL_GRANT_REJECTED", "WORKER_NOT_ACTIVE"]]);
    expect((await attempt(item.attemptId)).credential_granted_at).toBeNull();
  });

  it("rolls back completely when the grant fails before commit", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const leasePort = await compose([worker!]);
    const proof = await leaseFor(leasePort, worker!);
    await server!.close();
    const before = { attempt: await attempt(item.attemptId), version: await version(item.versionId) };
    const failing = gatedPool(() => false);
    const broken: TransactionalPool = {
      ...failing.pool,
      connect: async () => {
        const inner = await pool.connect();
        return {
          release: (error?: Error) => inner.release(error),
          query: async <Row extends object>(sql: string, params?: unknown[]) => {
            if (sql.includes("INSERT INTO audit_events") && params?.includes("execution_attempt.credential_granted")) {
              throw Object.assign(new Error("injected"), { code: "XX000" });
            }
            return inner.query<Row>(sql, params);
          },
        };
      },
    };
    const port = await compose([worker!], broken);
    const response = await call(port, worker!, "credential-grant", item.attemptId, proof);
    expect(response.status).toBe(503);
    expect(response.body).toBe('{"status":"error","code":"SERVICE_UNAVAILABLE"}\n');
    expect(await attempt(item.attemptId)).toEqual(before.attempt);
    expect(await version(item.versionId)).toEqual(before.version);
    expect(await grantAudits(item.attemptId)).toEqual([]);
  });
});

describe("after a grant", () => {
  it("forbids release, survives expiry untouched by reclaim, and refuses a retry once the lease has expired", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const proof = await leaseFor(port, list[0]!);
    expect((await call(port, list[0]!, "credential-grant", item.attemptId, proof)).status).toBe(200);

    expect((await call(port, list[0]!, "release", item.attemptId, proof)).status).toBe(409);
    expect(events.at(-1)).toMatchObject({ type: "WORKER_LEASE_REJECTED", reason: "CREDENTIAL_GRANTED" });

    await clients.migrator.query(
      "UPDATE execution_attempts SET leased_at = now() - interval '10 minutes', heartbeat_at = now() - interval '10 minutes', lease_expires_at = now() - interval '1 second' WHERE id = $1",
      [item.attemptId],
    );
    expect((await call(port, list[0]!, "heartbeat", item.attemptId, proof)).status).toBe(409);
    expect((await call(port, list[0]!, "credential-grant", item.attemptId, proof)).status).toBe(409);
    expect(events.at(-1)).toMatchObject({ type: "WORKER_CREDENTIAL_GRANT_REJECTED", reason: "LEASE_EXPIRED" });
    // Another worker's acquisition never reclaims a granted lease.
    expect(json(await send(port, "POST", "/worker-control/v1/leases", undefined, auth(list[1]!)))).toEqual({ lease: null });
    const row = await attempt(item.attemptId);
    expect(row).toMatchObject({ state: "LEASED", lease_worker_principal_id: list[0]!.id, lease_fencing_counter: "1" });
    expect(row.credential_granted_at).not.toBeNull();
  });

  it("replays a grant committed before a disconnect, under the same valid lease, without a new grant", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await leaseFor(port, worker!);

    // 1-2. The first grant commits; its response is treated as lost.
    const lost = await call(port, worker!, "credential-grant", item.attemptId, proof);
    expect(lost.status).toBe(200);
    const original = json(lost);
    const grantedAt = (await attempt(item.attemptId)).credential_granted_at!;

    // 3-4. The customer disconnects; the granted exact version is retained.
    await disconnect(item);
    expect((await version(item.versionId)).status).toBe("RETAINED_FOR_RECOVERY");
    const connection = await clients.migrator.query("SELECT status FROM provider_connections WHERE id = $1", [item.connectionId]);
    expect(connection.rows).toEqual([{ status: "DISCONNECTED" }]);
    const versionBefore = await version(item.versionId);

    // 5-6. Same worker, same lease, same fencing: the identical committed grant comes back.
    const retry = await call(port, worker!, "credential-grant", item.attemptId, proof);
    expect(retry.status).toBe(200);
    const replay = json(retry);
    expect(replay).toEqual(original);
    expect(replay.credential.sealedEnvelope).toEqual(original.credential.sealedEnvelope);
    expect(replay.credential.openingContext).toEqual(original.credential.openingContext);
    expect(replay.credentialGrantedAt).toBe(original.credentialGrantedAt);
    expect(replay.fencingCounter).toBe(original.fencingCounter);
    // 9. No substitution: still exactly version 1 of the bound connection.
    expect(replay.credential.openingContext).toMatchObject({ providerConnectionId: item.connectionId, credentialVersion: 1 });
    expect((await opener.open(replay.credential.sealedEnvelope, replay.credential.openingContext)) === item.plaintext).toBe(true);

    // 7-8, 10. No second audit, no timestamp change, version untouched, still LEASED.
    expect(await grantAudits(item.attemptId)).toHaveLength(1);
    const row = await attempt(item.attemptId);
    expect(row.credential_granted_at).toEqual(grantedAt);
    expect(row.state).toBe("LEASED");
    expect(row.submitting_at).toBeNull();
    expect(await version(item.versionId)).toEqual(versionBefore);
    expect(events).toEqual([]);
  });

  it("distinguishes a new grant from a replay on a RETAINED_FOR_RECOVERY version", async () => {
    const [worker] = await workers(1);
    const fresh = await work();
    const replayed = await work();
    const port = await compose([worker!]);

    // RETAINED_FOR_RECOVERY + no grant yet: a new pre-submission grant is refused.
    const freshProof = await leaseFor(port, worker!);
    expect(freshProof.attemptId).toBe(fresh.attemptId);
    await clients.migrator.query(
      "UPDATE provider_credential_versions SET status = 'RETAINED_FOR_RECOVERY', retained_for_recovery_at = now() WHERE id = $1",
      [fresh.versionId],
    );
    const refused = await call(port, worker!, "credential-grant", fresh.attemptId, freshProof);
    expect(refused.status).toBe(409);
    expect(refused.body).toBe(REJECTED);
    expect(events.map((event) => [event.type, event.reason])).toEqual([["WORKER_CREDENTIAL_GRANT_REJECTED", "CREDENTIAL_VERSION_INELIGIBLE"]]);
    expect((await attempt(fresh.attemptId)).credential_granted_at).toBeNull();
    expect((await call(port, worker!, "release", fresh.attemptId, freshProof)).status).toBe(200);
    await clients.migrator.query("UPDATE execution_jobs SET status = 'CANCELLED', completed_at = now() WHERE id = $1", [fresh.jobId]);

    // RETAINED_FOR_RECOVERY + an existing grant under the same valid lease: replay is allowed.
    const proof = await leaseFor(port, worker!);
    expect(proof.attemptId).toBe(replayed.attemptId);
    const original = json(await call(port, worker!, "credential-grant", replayed.attemptId, proof));
    await clients.migrator.query(
      "UPDATE provider_credential_versions SET status = 'RETAINED_FOR_RECOVERY', retained_for_recovery_at = now() WHERE id = $1",
      [replayed.versionId],
    );
    const replay = await call(port, worker!, "credential-grant", replayed.attemptId, proof);
    expect(replay.status).toBe(200);
    expect(json(replay)).toEqual(original);
    expect(await grantAudits(replayed.attemptId)).toHaveLength(1);
  });

  it("fails closed when an already-granted exact version has been destroyed (invariant failure)", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await leaseFor(port, worker!);
    expect((await call(port, worker!, "credential-grant", item.attemptId, proof)).status).toBe(200);
    // Not reachable through disconnect (the open obligation retains it); forced here to prove fail-closed.
    await clients.migrator.query(
      `UPDATE provider_credential_versions SET status = 'DESTROYED', destroyed_at = now(), sealed_credential = NULL,
              fingerprint_algorithm = NULL, fingerprint_key_ref = NULL, fingerprint_value = NULL WHERE id = $1`,
      [item.versionId],
    );
    const retry = await call(port, worker!, "credential-grant", item.attemptId, proof);
    expect(retry.status).toBe(409);
    expect(retry.body).toBe(REJECTED);
    expect(events.at(-1)).toMatchObject({ type: "WORKER_CREDENTIAL_GRANT_REJECTED", reason: "GRANTED_VERSION_DESTROYED" });
    expect(await grantAudits(item.attemptId)).toHaveLength(1);
  });
});

describe("races", () => {
  it("grant first, then disconnect: disconnect waits for the grant and retains the exact version", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const leasePort = await compose([worker!]);
    const proof = await leaseFor(leasePort, worker!);
    await server!.close();

    // Pause the grant after it holds the connection and version locks and has written the grant.
    const gated = gatedPool((sql, params) => sql.includes("INSERT INTO audit_events") && (params ?? []).includes("execution_attempt.credential_granted"));
    const port = await compose([worker!], gated.pool);
    const granting = call(port, worker!, "credential-grant", item.attemptId, proof);
    await gated.paused;

    let disconnected = false;
    const disconnecting = disconnect(item).finally(() => (disconnected = true));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(disconnected).toBe(false);
    gated.release();

    expect((await granting).status).toBe(200);
    await disconnecting;
    const row = await version(item.versionId);
    expect(row.status).toBe("RETAINED_FOR_RECOVERY");
    expect(row.sealed_credential).not.toBeNull();
    expect((await attempt(item.attemptId)).credential_granted_at).not.toBeNull();
  });

  it("disconnect first, then grant: the grant waits, then refuses with no material and no grant", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await leaseFor(port, worker!);

    // Pause the disconnect after it has locked the connection and destroyed the version.
    const gated = gatedPool((sql, params) => sql.includes("INSERT INTO audit_events") && (params ?? []).includes("provider_connection.disconnected"));
    const disconnecting = disconnect(item, gated.pool);
    await gated.paused;

    let settled = false;
    const granting = call(port, worker!, "credential-grant", item.attemptId, proof).finally(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);
    gated.release();
    await disconnecting;

    const response = await granting;
    expect(response.status).toBe(409);
    expect(response.body).toBe(REJECTED);
    expect(events.map((event) => [event.type, event.reason])).toEqual([["WORKER_CREDENTIAL_GRANT_REJECTED", "CONNECTION_INELIGIBLE"]]);
    expect((await attempt(item.attemptId)).credential_granted_at).toBeNull();
    expect((await version(item.versionId)).status).toBe("DESTROYED");
  });

  it("grant against release: exactly one wins and the other is refused", async () => {
    for (let round = 0; round < 4; round += 1) {
      await prepareSchemaV1(clients);
      const [worker] = await workers(1);
      const item = await work();
      const port = await compose([worker!]);
      const proof = await leaseFor(port, worker!);
      const [grant, release] = await Promise.all([
        call(port, worker!, "credential-grant", item.attemptId, proof),
        call(port, worker!, "release", item.attemptId, proof),
      ]);
      expect([grant.status, release.status].sort()).toEqual([200, 409]);
      const row = await attempt(item.attemptId);
      if (grant.status === 200) {
        expect(row.state).toBe("LEASED");
        expect(row.credential_granted_at).not.toBeNull();
      } else {
        expect(row.state).toBe("QUEUED");
        expect(row.credential_granted_at).toBeNull();
      }
      await server!.close();
      server = undefined;
    }
  });
});

describe("privileges and limits", () => {
  it("uses the runtime role's existing read of the sealed envelope, with no new role or destructive privilege", async () => {
    const privileges = await clients.runtime.query(
      `SELECT has_column_privilege(current_user, 'public.provider_credential_versions', 'sealed_credential', 'SELECT') AS sealed_select,
              has_table_privilege(current_user, 'public.provider_credential_versions', 'DELETE') AS delete,
              has_table_privilege(current_user, 'public.execution_attempts', 'TRUNCATE') AS truncate,
              (SELECT count(*)::int FROM pg_roles WHERE rolname ILIKE '%worker%') AS worker_roles`,
    );
    expect(privileges.rows).toEqual([{ sealed_select: true, delete: false, truncate: false, worker_roles: 0 }]);
  });

  it("reaches no state beyond LEASED", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await leaseFor(port, worker!);
    await call(port, worker!, "credential-grant", item.attemptId, proof);
    await call(port, worker!, "heartbeat", item.attemptId, proof);
    const row = await clients.migrator.query(
      "SELECT state, submitting_at, submitted_at, provider_execution_id FROM execution_attempts WHERE id = $1",
      [item.attemptId],
    );
    expect(row.rows).toEqual([{ state: "LEASED", submitting_at: null, submitted_at: null, provider_execution_id: null }]);
  });
});
