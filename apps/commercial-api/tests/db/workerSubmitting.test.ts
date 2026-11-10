import { createHash, randomBytes, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type RuntimeClient, type TransactionalPool } from "../../src/database/runtimePool.js";
import { readCredentialObligations } from "../../src/providerConnections/credentialObligations.js";
import { disconnectProviderConnection } from "../../src/providerConnections/providerConnectionService.js";
import { PROVIDER_CREDENTIAL_PURPOSE } from "commercial-worker-protocol";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../src/startCommercialApiServer.js";
import { createWorkerControlApplication } from "../../src/workerControl/workerControlApplication.js";
import type { WorkerSecurityEvent } from "../../src/workerControl/workerSecurityEvents.js";
import { send, type TestResponse } from "../httpClient.js";
import { createTestCredentialFingerprinter, createTestCredentialSealer, generateTestKey } from "../support/testCredentialCrypto.js";
import { createTestWorkerAuthenticationAdapter } from "../support/testWorkerAuthentication.js";
import { createRecordingWorkerSecurityEventSink } from "../support/testWorkerSecurityEvents.js";
import { insertAccountWithFreeGrant, openGuardedClients, prepareSchemaV1, type GuardedClients } from "./support/testDatabase.js";

// R44B6J fenced SUBMITTING acknowledgement barrier against PostgreSQL 16, over
// the explicitly composed worker-control router. No provider is called and no
// credential is opened: the barrier only records, under the current fenced
// lease, that provider submission is now authorised. Assertions on secrets are
// booleans, so a failure never prints one.

let clients: GuardedClients;
let pool: TransactionalPool;
let server: RunningCommercialApiServer | undefined;
let events: WorkerSecurityEvent[];
let setSinkFailing: (failing: boolean) => void;

const encryptionKey = generateTestKey("submitting-test-encryption/v1");
const sealer = createTestCredentialSealer(encryptionKey);
const fingerprinter = createTestCredentialFingerprinter(generateTestKey("submitting-test-fingerprint/v1"), encryptionKey);

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
    const id = (await clients.migrator.query<{ id: string }>("INSERT INTO worker_principals (label) VALUES ($1) RETURNING id", [`submitting-worker-${index}`])).rows[0]!.id;
    list.push({ id, token: `fixture-worker-${randomBytes(16).toString("hex")}` });
  }
  return list;
}

type Work = Readonly<{
  userId: string;
  accountId: string;
  connectionId: string;
  versionId: string;
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
  const owner = await insertAccountWithFreeGrant(clients.migrator, `submitting-${randomUUID()}`);
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
    jobId: job.id,
    attemptId: attempt.id,
    plaintext: v1.plaintext,
    fingerprintValue: v1.fingerprintValue,
  };
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
const json = (response: TestResponse) => JSON.parse(response.body) as Record<string, any>;
type Proof = { fencingCounter: number; leaseToken: string };
type Action = "credential-grant" | "release" | "heartbeat" | "submitting";

async function leaseFor(port: number, worker: Worker): Promise<Proof & { attemptId: string }> {
  const body = json(await send(port, "POST", "/worker-control/v1/leases", undefined, auth(worker))).lease;
  return { attemptId: body.executionAttemptId, fencingCounter: body.fencingCounter, leaseToken: body.leaseToken };
}
const call = (port: number, worker: Worker, action: Action, attemptId: string, proof: Proof) =>
  send(port, "POST", `/worker-control/v1/attempts/${attemptId}/${action}`, JSON.stringify({ fencingCounter: proof.fencingCounter, leaseToken: proof.leaseToken }), {
    ...auth(worker),
    "Content-Type": "application/json",
  });

// Lease the next attempt and receive its credential grant: the precondition for SUBMITTING.
async function granted(port: number, worker: Worker) {
  const proof = await leaseFor(port, worker);
  expect((await call(port, worker, "credential-grant", proof.attemptId, proof)).status).toBe(200);
  return proof;
}

type AttemptRow = {
  state: string;
  credential_granted_at: Date | null;
  submitting_at: Date | null;
  submitted_at: Date | null;
  provider_execution_id: string | null;
  recovery_expires_at: Date | null;
  lease_worker_principal_id: string | null;
  lease_fencing_counter: string;
  updated_at: Date;
};
const attempt = async (id: string) =>
  (
    await clients.migrator.query<AttemptRow>(
      `SELECT state, credential_granted_at, submitting_at, submitted_at, provider_execution_id, recovery_expires_at,
              lease_worker_principal_id, lease_fencing_counter, updated_at
         FROM execution_attempts WHERE id = $1`,
      [id],
    )
  ).rows[0]!;
const version = async (id: string) =>
  (await clients.migrator.query<{ status: string; sealed_credential: unknown }>("SELECT status, sealed_credential FROM provider_credential_versions WHERE id = $1", [id])).rows[0]!;
const jobStatus = async (id: string) => (await clients.migrator.query<{ status: string }>("SELECT status FROM execution_jobs WHERE id = $1", [id])).rows[0]!.status;
const submittingAudits = async (attemptId: string) =>
  (await clients.migrator.query<{ metadata: Record<string, unknown> }>(
    "SELECT metadata FROM audit_events WHERE resource_id = $1 AND event_type = 'execution_attempt.submitting' ORDER BY sequence",
    [attemptId],
  )).rows.map((row) => row.metadata);
const allAuditText = async () => (await clients.migrator.query<{ text: string | null }>("SELECT string_agg(audit_events::text, '\n') AS text FROM audit_events")).rows[0]!.text ?? "";
const disconnect = (item: Work, p: TransactionalPool = pool) => disconnectProviderConnection({ pool: p }, { userId: item.userId, accountId: item.accountId }, item.connectionId);
const obligations = async (item: Work) => {
  const client = await pool.connect();
  try {
    return (await readCredentialObligations(client, item.accountId, [item.versionId])).get(item.versionId);
  } finally {
    client.release();
  }
};
const eventSummary = () => events.map((event) => [event.type, event.reason]);

const REJECTED = '{"status":"error","code":"LEASE_REJECTED"}\n';
const DESTROY = `UPDATE provider_credential_versions SET status = 'DESTROYED', destroyed_at = now(), sealed_credential = NULL,
                        fingerprint_algorithm = NULL, fingerprint_key_ref = NULL, fingerprint_value = NULL WHERE id = $1`;

// ---------------------------------------------------------------------------

describe("first SUBMITTING transition", () => {
  it("records SUBMITTING once under the current fenced lease and opens the recovery obligation", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    const before = await attempt(item.attemptId);
    const versionBefore = await version(item.versionId);
    expect(await jobStatus(item.jobId)).toBe("RUNNING");

    const response = await call(port, worker!, "submitting", item.attemptId, proof);
    expect(response.status).toBe(200);
    const body = json(response);
    expect(Object.keys(body).sort()).toEqual(["executionAttemptId", "fencingCounter", "state", "submittingAt"]);
    expect(body).toMatchObject({ executionAttemptId: item.attemptId, fencingCounter: 1, state: "SUBMITTING" });

    const row = await attempt(item.attemptId);
    expect(row.state).toBe("SUBMITTING");
    expect(row.submitting_at!.toISOString()).toBe(body.submittingAt);
    expect(row.submitting_at!.getTime()).toBeGreaterThanOrEqual(row.credential_granted_at!.getTime());
    // Only state, submitting_at and updated_at changed.
    expect(row.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());
    expect({ ...row, state: before.state, submitting_at: null, updated_at: before.updated_at }).toEqual(before);
    expect(row).toMatchObject({ submitted_at: null, provider_execution_id: null, recovery_expires_at: null, lease_worker_principal_id: worker!.id, lease_fencing_counter: "1" });
    // The job is untouched and the version is neither read for material nor changed.
    expect(await jobStatus(item.jobId)).toBe("RUNNING");
    expect(await version(item.versionId)).toEqual(versionBefore);

    expect(await submittingAudits(item.attemptId)).toEqual([
      { attemptNumber: 1, fencingCounter: 1, workerPrincipalId: worker!.id, provider: "EXAMPLE_PROVIDER", credentialVersion: 1 },
    ]);
    const visible = (await allAuditText()) + JSON.stringify(events) + response.body;
    expect(visible.includes(item.plaintext) || visible.includes(proof.leaseToken) || visible.includes(item.fingerprintValue)).toBe(false);
    expect(/sealed|envelope|fingerprint|credential/i.test(response.body)).toBe(false);
    expect(events).toEqual([]);

    expect(await obligations(item)).toEqual({ hasOpenCredentialRetentionObligation: true, hasOpenProviderRecoveryObligation: true, blocksDestruction: true });
  });

  it("gets the authenticated lease principal stamped as submitting provenance by the database (migration 0005)", async () => {
    const list = await workers(2);
    const item = await work();
    const leasePort = await compose(list);
    const proof = await granted(leasePort, list[1]!);
    await server!.close();
    const recorded = recordingPool();
    const port = await compose(list, recorded.pool);
    const response = await call(port, list[1]!, "submitting", item.attemptId, proof);
    expect(response.status).toBe(200);
    // The unchanged R44B6J statement never names the column...
    expect(recorded.statements.some((sql) => /submitting_worker_principal_id/.test(sql))).toBe(false);
    // ...yet the committed row carries exactly the lease principal that took the barrier.
    const provenance = async () =>
      (
        await clients.migrator.query(
          "SELECT state, lease_worker_principal_id, submitting_worker_principal_id, submitting_at IS NOT NULL AS barrier FROM execution_attempts WHERE id = $1",
          [item.attemptId],
        )
      ).rows;
    expect(await provenance()).toEqual([
      { state: "SUBMITTING", lease_worker_principal_id: list[1]!.id, submitting_worker_principal_id: list[1]!.id, barrier: true },
    ]);
    // A replay writes nothing and leaves it unchanged.
    expect((await call(port, list[1]!, "submitting", item.attemptId, proof)).status).toBe(200);
    expect(await provenance()).toEqual([
      { state: "SUBMITTING", lease_worker_principal_id: list[1]!.id, submitting_worker_principal_id: list[1]!.id, barrier: true },
    ]);
  });

  it("is refused by the database barrier when the lease expires after the service check but before the transition (R44B6L1)", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const leasePort = await compose([worker!]);
    const proof = await granted(leasePort, worker!);
    await server!.close();
    // A lease that is valid now and expires in under a second.
    await clients.migrator.query("UPDATE execution_attempts SET lease_expires_at = clock_timestamp() + interval '750 milliseconds' WHERE id = $1", [
      item.attemptId,
    ]);
    // Pause the unchanged R44B6J service after its own preliminary lease check
    // has passed, immediately before its SUBMITTING update.
    const gated = gatedPool((sql) => sql.includes("SET state = 'SUBMITTING'"));
    const port = await compose([worker!], gated.pool);
    const submitting = call(port, worker!, "submitting", item.attemptId, proof);
    await gated.paused;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const expired = await clients.migrator.query<{ expired: boolean }>(
      "SELECT lease_expires_at <= clock_timestamp() AS expired FROM execution_attempts WHERE id = $1",
      [item.attemptId],
    );
    expect(expired.rows).toEqual([{ expired: true }]);
    gated.release();

    const response = await submitting;
    // The database guard refuses, and the refusal keeps the ordinary R44B6J
    // lifecycle contract (R44B6L2): 409 LEASE_REJECTED with exactly one
    // rejection event, never a 5xx and never provider-call authority.
    expect(response.status).toBe(409);
    expect(response.body).toBe(REJECTED);
    expect(eventSummary()).toEqual([["WORKER_SUBMITTING_REJECTED", "LEASE_EXPIRED"]]);
    expect(events[0]).toMatchObject({ workerPrincipalId: worker!.id, executionAttemptId: item.attemptId });
    expect(JSON.stringify(events).includes(proof.leaseToken)).toBe(false);
    const row = await attempt(item.attemptId);
    expect(row).toMatchObject({ state: "LEASED", submitting_at: null });
    expect(
      (await clients.migrator.query("SELECT submitting_worker_principal_id FROM execution_attempts WHERE id = $1", [item.attemptId])).rows,
    ).toEqual([{ submitting_worker_principal_id: null }]);
    expect(await submittingAudits(item.attemptId)).toEqual([]);
  });

  it.each([
    ["another check violation", { code: "23514", constraint: "execution_attempts_submitting_at_ck" }],
    ["a check violation without a constraint name", { code: "23514" }],
    ["the lease-expiry constraint name under another SQLSTATE", { code: "XX000", constraint: "execution_attempts_submitting_lease_unexpired" }],
    ["a serialization failure", { code: "40001" }],
    ["a lost connection", { code: "57P01" }],
  ] as const)("keeps %s at the SUBMITTING update a 503, never LEASE_REJECTED (R44B6L2)", async (_label, injected) => {
    const [worker] = await workers(1);
    const item = await work();
    const leasePort = await compose([worker!]);
    const proof = await granted(leasePort, worker!);
    await server!.close();
    const before = await attempt(item.attemptId);
    const failing: TransactionalPool = {
      query: pool.query,
      end: async () => {},
      connect: async () => {
        const inner = await pool.connect();
        return {
          release: (error?: Error) => inner.release(error),
          query: async <Row extends object>(sql: string, params?: unknown[]) => {
            if (sql.includes("SET state = 'SUBMITTING'")) throw Object.assign(new Error("injected database failure"), injected);
            return inner.query<Row>(sql, params);
          },
        };
      },
    };
    const port = await compose([worker!], failing);
    const response = await call(port, worker!, "submitting", item.attemptId, proof);
    expect(response.status).toBe(503);
    expect(response.body).toBe('{"status":"error","code":"SERVICE_UNAVAILABLE"}\n');
    // No lifecycle-refusal event: this is a failure, not a lease refusal.
    expect(events).toEqual([]);
    expect(await attempt(item.attemptId)).toEqual(before);
    expect(await submittingAudits(item.attemptId)).toEqual([]);
  });

  it("never reads the sealed credential or fingerprint", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const leasePort = await compose([worker!]);
    const proof = await granted(leasePort, worker!);
    await server!.close();
    const recorded = recordingPool();
    const port = await compose([worker!], recorded.pool);
    expect((await call(port, worker!, "submitting", item.attemptId, proof)).status).toBe(200);
    expect(recorded.statements.some((sql) => /sealed_credential|fingerprint_/i.test(sql))).toBe(false);
    expect(recorded.statements.some((sql) => /recovery_expires_at|provider_execution_id|submitted_at|execution_jobs\s+SET/i.test(sql))).toBe(false);
    expect(recorded.statements[0]).toBe("BEGIN ISOLATION LEVEL READ COMMITTED");
  });

  it("locks principal, attempt, connection and exact version in that order", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const leasePort = await compose([worker!]);
    const proof = await granted(leasePort, worker!);
    await server!.close();
    const recorded = recordingPool();
    const port = await compose([worker!], recorded.pool);
    expect((await call(port, worker!, "submitting", item.attemptId, proof)).status).toBe(200);
    const locks = recorded.statements
      .filter((sql) => /FOR (SHARE|UPDATE)/.test(sql))
      .map((sql) => `${/FROM\s+(\w+)/.exec(sql)![1]} ${/FOR (SHARE|UPDATE)/.exec(sql)![0]}`);
    expect(locks).toEqual([
      "worker_principals FOR SHARE",
      "execution_attempts FOR UPDATE",
      "provider_connections FOR SHARE",
      "provider_credential_versions FOR SHARE",
    ]);
  });

  it("accepts the exact bound version after rotation superseded it", async () => {
    const [worker] = await workers(1);
    const item = await work({ rotateAfterBinding: true });
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    expect((await version(item.versionId)).status).toBe("SUPERSEDED");
    const response = await call(port, worker!, "submitting", item.attemptId, proof);
    expect(response.status).toBe(200);
    expect(await submittingAudits(item.attemptId)).toEqual([expect.objectContaining({ credentialVersion: 1 })]);
  });

  it("refuses an attempt with no credential grant under its lease", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await leaseFor(port, worker!);
    const response = await call(port, worker!, "submitting", item.attemptId, proof);
    expect(response.status).toBe(409);
    expect(response.body).toBe(REJECTED);
    expect(eventSummary()).toEqual([["WORKER_SUBMITTING_REJECTED", "CREDENTIAL_NOT_GRANTED"]]);
    expect((await attempt(item.attemptId)).state).toBe("LEASED");
    expect(await submittingAudits(item.attemptId)).toEqual([]);
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
    ["a DESTROYED version", DESTROY, "version", "CREDENTIAL_VERSION_INELIGIBLE"],
  ] as const)("refuses a first transition on %s with the uniform 409", async (_label, sql, target, reason) => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    await clients.migrator.query(sql, [target === "connection" ? item.connectionId : item.versionId]);

    const response = await call(port, worker!, "submitting", item.attemptId, proof);
    expect(response.status).toBe(409);
    expect(response.body).toBe(REJECTED);
    expect(eventSummary()).toEqual([["WORKER_SUBMITTING_REJECTED", reason]]);
    const row = await attempt(item.attemptId);
    expect(row.state).toBe("LEASED");
    expect(row.submitting_at).toBeNull();
    expect(await submittingAudits(item.attemptId)).toEqual([]);
  });

  it("refuses stale fencing after a re-lease, wrong tokens, other workers and unknown attempts", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const first = await leaseFor(port, list[0]!);
    expect((await call(port, list[0]!, "release", item.attemptId, first)).status).toBe(200);
    const second = await granted(port, list[0]!);
    expect(second.fencingCounter).toBe(2);

    for (const [worker, attemptId, proof, reason] of [
      [list[0]!, item.attemptId, first, "FENCING_MISMATCH"],
      [list[0]!, item.attemptId, { ...second, leaseToken: randomBytes(32).toString("base64url") }, "TOKEN_MISMATCH"],
      [list[1]!, item.attemptId, second, "OTHER_WORKER"],
      [list[0]!, randomUUID(), second, "UNKNOWN_ATTEMPT"],
    ] as const) {
      const response = await call(port, worker, "submitting", attemptId, proof);
      expect(response.status).toBe(409);
      expect(response.body).toBe(REJECTED);
      expect(events.at(-1)).toMatchObject({ type: "WORKER_SUBMITTING_REJECTED", reason });
    }
    expect((await attempt(item.attemptId)).state).toBe("LEASED");
    expect(await submittingAudits(item.attemptId)).toEqual([]);
    expect((await call(port, list[0]!, "submitting", item.attemptId, second)).status).toBe(200);
  });

  it("refuses an expired lease, and an expired granted lease is never reclaimed", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const proof = await granted(port, list[0]!);
    await clients.migrator.query(
      "UPDATE execution_attempts SET leased_at = now() - interval '10 minutes', heartbeat_at = now() - interval '10 minutes', lease_expires_at = now() - interval '1 second' WHERE id = $1",
      [item.attemptId],
    );
    const response = await call(port, list[0]!, "submitting", item.attemptId, proof);
    expect(response.status).toBe(409);
    expect(response.body).toBe(REJECTED);
    expect(eventSummary()).toEqual([["WORKER_SUBMITTING_REJECTED", "LEASE_EXPIRED"]]);
    expect(json(await send(port, "POST", "/worker-control/v1/leases", undefined, auth(list[1]!)))).toEqual({ lease: null });
    expect((await attempt(item.attemptId)).state).toBe("LEASED");
  });

  it("gives a worker disabled after authentication no acknowledgement", async () => {
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
    const response = await call(port, worker!, "submitting", item.attemptId, proof);
    expect(response.status).toBe(401);
    expect(response.body).toBe('{"status":"error","code":"AUTHENTICATION_REQUIRED"}\n');
    expect(eventSummary()).toEqual([["WORKER_SUBMITTING_REJECTED", "WORKER_NOT_ACTIVE"]]);
    expect((await attempt(item.attemptId)).state).toBe("LEASED");
  });

  it("rolls back completely when the acknowledgement fails before commit", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const leasePort = await compose([worker!]);
    const proof = await granted(leasePort, worker!);
    await server!.close();
    const before = { attempt: await attempt(item.attemptId), version: await version(item.versionId), job: await jobStatus(item.jobId) };
    const broken: TransactionalPool = {
      query: pool.query,
      end: async () => {},
      connect: async () => {
        const inner = await pool.connect();
        return {
          release: (error?: Error) => inner.release(error),
          query: async <Row extends object>(sql: string, params?: unknown[]) => {
            if (sql.includes("INSERT INTO audit_events") && params?.includes("execution_attempt.submitting")) {
              throw Object.assign(new Error("injected"), { code: "XX000" });
            }
            return inner.query<Row>(sql, params);
          },
        };
      },
    };
    const port = await compose([worker!], broken);
    const response = await call(port, worker!, "submitting", item.attemptId, proof);
    expect(response.status).toBe(503);
    expect(response.body).toBe('{"status":"error","code":"SERVICE_UNAVAILABLE"}\n');
    expect(await attempt(item.attemptId)).toEqual(before.attempt);
    expect(await version(item.versionId)).toEqual(before.version);
    expect(await jobStatus(item.jobId)).toBe(before.job);
    expect(await submittingAudits(item.attemptId)).toEqual([]);
  });

  it("fails closed with 503 when the security log cannot record a rejection", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await leaseFor(port, worker!);
    setSinkFailing(true);
    const response = await call(port, worker!, "submitting", item.attemptId, proof);
    expect(response.status).toBe(503);
    expect(response.body).toBe('{"status":"error","code":"SERVICE_UNAVAILABLE"}\n');
    expect((await attempt(item.attemptId)).state).toBe("LEASED");
  });
});

describe("replay", () => {
  it("is idempotent under the same proof, including concurrent identical requests", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    const responses = await Promise.all([1, 2, 3].map(() => call(port, worker!, "submitting", item.attemptId, proof)));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    const bodies = responses.map(json);
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    const updatedAt = (await attempt(item.attemptId)).updated_at;
    const retry = json(await call(port, worker!, "submitting", item.attemptId, proof));
    expect(retry).toEqual(bodies[0]);
    expect(await submittingAudits(item.attemptId)).toHaveLength(1);
    const row = await attempt(item.attemptId);
    expect(row.submitting_at!.toISOString()).toBe(bodies[0]!.submittingAt);
    expect(row.updated_at).toEqual(updatedAt);
    expect(events).toEqual([]);
  });

  it("replays an acknowledgement committed before a disconnect, which retains the exact version", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    const lost = await call(port, worker!, "submitting", item.attemptId, proof);
    expect(lost.status).toBe(200);
    const original = json(lost);

    await disconnect(item);
    expect((await version(item.versionId)).status).toBe("RETAINED_FOR_RECOVERY");
    expect((await version(item.versionId)).sealed_credential).not.toBeNull();
    const versionBefore = await version(item.versionId);

    const retry = await call(port, worker!, "submitting", item.attemptId, proof);
    expect(retry.status).toBe(200);
    expect(json(retry)).toEqual(original);
    expect(await submittingAudits(item.attemptId)).toHaveLength(1);
    expect(await version(item.versionId)).toEqual(versionBefore);
    const row = await attempt(item.attemptId);
    expect(row).toMatchObject({ state: "SUBMITTING", submitted_at: null, provider_execution_id: null, recovery_expires_at: null });
    expect(events).toEqual([]);
  });

  it("refuses a replay under a different token, another worker or a stale fence", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const proof = await granted(port, list[0]!);
    expect((await call(port, list[0]!, "submitting", item.attemptId, proof)).status).toBe(200);
    for (const [worker, candidate, reason] of [
      [list[0]!, { ...proof, leaseToken: randomBytes(32).toString("base64url") }, "TOKEN_MISMATCH"],
      [list[0]!, { ...proof, fencingCounter: proof.fencingCounter + 1 }, "FENCING_MISMATCH"],
      [list[1]!, proof, "OTHER_WORKER"],
    ] as const) {
      const response = await call(port, worker, "submitting", item.attemptId, candidate);
      expect(response.status).toBe(409);
      expect(response.body).toBe(REJECTED);
      expect(events.at(-1)).toMatchObject({ type: "WORKER_SUBMITTING_REJECTED", reason });
    }
    expect(await submittingAudits(item.attemptId)).toHaveLength(1);
  });

  it("fails closed when an already-SUBMITTING exact version has been destroyed (invariant failure)", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    expect((await call(port, worker!, "submitting", item.attemptId, proof)).status).toBe(200);
    // Not reachable through disconnect (the open recovery obligation retains it); forced here to prove fail-closed.
    await clients.migrator.query(DESTROY, [item.versionId]);
    const retry = await call(port, worker!, "submitting", item.attemptId, proof);
    expect(retry.status).toBe(409);
    expect(retry.body).toBe(REJECTED);
    expect(events.at(-1)).toMatchObject({ type: "WORKER_SUBMITTING_REJECTED", reason: "SUBMITTING_VERSION_DESTROYED" });
    expect(await submittingAudits(item.attemptId)).toHaveLength(1);
  });

  it("leaves a SUBMITTING attempt out of release, grant and requeue; an expired one becomes OUTCOME_UNKNOWN (R44B6M)", async () => {
    const list = await workers(2);
    const item = await work();
    const port = await compose(list);
    const proof = await granted(port, list[0]!);
    expect((await call(port, list[0]!, "submitting", item.attemptId, proof)).status).toBe(200);
    for (const action of ["release", "credential-grant"] as const) {
      const response = await call(port, list[0]!, action, item.attemptId, proof);
      expect(response.status).toBe(409);
      expect(response.body).toBe(REJECTED);
    }
    await clients.migrator.query(
      "UPDATE execution_attempts SET leased_at = now() - interval '10 minutes', heartbeat_at = now() - interval '10 minutes', lease_expires_at = now() - interval '1 second' WHERE id = $1",
      [item.attemptId],
    );
    // Another worker's lease request sweeps it: never requeued, never re-leased.
    expect(json(await send(port, "POST", "/worker-control/v1/leases", undefined, auth(list[1]!)))).toEqual({ lease: null });
    const row = await attempt(item.attemptId);
    expect(row).toMatchObject({ state: "OUTCOME_UNKNOWN", lease_worker_principal_id: null, lease_fencing_counter: "1", submitted_at: null, provider_execution_id: null });
    expect(await jobStatus(item.jobId)).toBe("NEEDS_ATTENTION");
  });
});

// R44B6M: SUBMITTING lease liveness and the authoritative expired-SUBMITTING sweep.
describe("SUBMITTING lease liveness and expiry sweep (R44B6M)", () => {
  type FullRow = Record<string, unknown>;
  const fullRow = async (id: string) =>
    (await clients.migrator.query<FullRow>("SELECT * FROM execution_attempts WHERE id = $1", [id])).rows[0]!;
  const outcomeAudits = async (attemptId: string) =>
    (await clients.migrator.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_events WHERE resource_id = $1 AND event_type = 'execution_attempt.outcome_unknown' ORDER BY sequence",
      [attemptId],
    )).rows.map((row) => row.metadata);
  const expire = (attemptId: string) =>
    clients.migrator.query(
      "UPDATE execution_attempts SET leased_at = now() - interval '10 minutes', heartbeat_at = now() - interval '10 minutes', lease_expires_at = now() - interval '1 second' WHERE id = $1",
      [attemptId],
    );
  const age = (attemptId: string) =>
    clients.migrator.query(
      "UPDATE execution_attempts SET leased_at = now() - interval '90 seconds', heartbeat_at = now() - interval '90 seconds', lease_expires_at = now() + interval '30 seconds' WHERE id = $1",
      [attemptId],
    );
  const leaseRequest = (port: number, worker: Worker) => send(port, "POST", "/worker-control/v1/leases", undefined, auth(worker));
  // Enters SUBMITTING through the unchanged R44B6J route.
  async function submittingAttempt(port: number, worker: Worker, item: Work) {
    const proof = await granted(port, worker);
    expect(proof.attemptId).toBe(item.attemptId);
    expect((await call(port, worker, "submitting", item.attemptId, proof)).status).toBe(200);
    return proof;
  }

  describe("heartbeat", () => {
    it("renews a SUBMITTING lease, writing only heartbeat_at, lease_expires_at and updated_at", async () => {
      const [worker] = await workers(1);
      const item = await work();
      const port = await compose([worker!]);
      const proof = await submittingAttempt(port, worker!, item);
      await age(item.attemptId);
      const before = await fullRow(item.attemptId);

      const response = await call(port, worker!, "heartbeat", item.attemptId, proof);
      expect(response.status).toBe(200);
      const body = json(response);
      expect(body.fencingCounter).toBe(1);
      const after = await fullRow(item.attemptId);
      expect(new Date(body.leaseExpiresAt).getTime()).toBe((after.lease_expires_at as Date).getTime());
      expect((after.lease_expires_at as Date).getTime()).toBeGreaterThan((before.lease_expires_at as Date).getTime());
      expect((after.heartbeat_at as Date).getTime()).toBeGreaterThan((before.heartbeat_at as Date).getTime());
      // Nothing else moved: no new authority, no new barrier, no new fencing epoch.
      const unchanged = (row: FullRow) => ({ ...row, lease_expires_at: null, heartbeat_at: null, updated_at: null });
      expect(unchanged(after)).toEqual(unchanged(before));
      expect(after).toMatchObject({ state: "SUBMITTING", submitting_worker_principal_id: worker!.id, lease_fencing_counter: "1" });
      expect(await submittingAudits(item.attemptId)).toHaveLength(1);
      expect(events).toEqual([]);
    });

    it("R44B6M1: does not renew any SUBMITTED lease until the live-route epoch is durably provable", async () => {
      const list = await workers(2);
      const item = await work();
      const port = await compose(list);
      const proof = await submittingAttempt(port, list[0]!, item);
      // No /submitted route exists yet: the owner commits SUBMITTED, keeping the lease (as the live route will).
      await clients.migrator.query(
        "UPDATE execution_attempts SET state = 'SUBMITTED', provider_execution_id = 'fixture-execution-1', submitted_at = now() WHERE id = $1",
        [item.attemptId],
      );
      await age(item.attemptId);
      const before = await fullRow(item.attemptId);
      // Even the genuine live-route lease is refused: nothing durable distinguishes it from a replacement epoch.
      const live = await call(port, list[0]!, "heartbeat", item.attemptId, proof);
      expect(live.status).toBe(409);
      expect(live.body).toBe(REJECTED);
      expect(events.at(-1)).toMatchObject({ type: "WORKER_LEASE_REJECTED", reason: "NOT_LEASED" });
      expect(await fullRow(item.attemptId)).toEqual(before);

      // A different lease on SUBMITTED (the future recovery-lease shape) is not renewable either,
      // even with a fully valid proof for that lease.
      const recoveryToken = randomBytes(32).toString("base64url");
      await clients.migrator.query(
        `UPDATE execution_attempts SET lease_worker_principal_id = $2, lease_token_sha256 = $3, lease_fencing_counter = lease_fencing_counter + 1,
                leased_at = now(), lease_expires_at = now() + interval '2 minutes', heartbeat_at = NULL WHERE id = $1`,
        [item.attemptId, list[1]!.id, createHash("sha256").update(recoveryToken, "utf8").digest("hex")],
      );
      const other = await call(port, list[1]!, "heartbeat", item.attemptId, { fencingCounter: 2, leaseToken: recoveryToken });
      expect(other.status).toBe(409);
      expect(other.body).toBe(REJECTED);
      expect(events.at(-1)).toMatchObject({ type: "WORKER_LEASE_REJECTED", reason: "NOT_LEASED" });
    });

    it("R44B6M1: a same-principal replacement lease on SUBMITTED is reachable under current authority and must not be renewable", async () => {
      const [worker] = await workers(1);
      const item = await work();
      const port = await compose([worker!]);
      await submittingAttempt(port, worker!, item);
      // No /submitted route exists yet: the owner commits SUBMITTED, keeping the live lease (W, N=1, T1).
      await clients.migrator.query(
        "UPDATE execution_attempts SET state = 'SUBMITTED', provider_execution_id = 'fixture-execution-3', submitted_at = now() WHERE id = $1",
        [item.attemptId],
      );

      // Reachability under current authority: the restricted runtime role itself may replace the lease on
      // SUBMITTED with a new epoch for the SAME principal (W, N+1, T2). Migration 0004/0005 forbid re-leasing
      // only while SUBMITTING; on SUBMITTED a lease is optional and a new one only needs a higher generation.
      const replacementToken = randomBytes(32).toString("base64url");
      await clients.runtime.query(
        `UPDATE execution_attempts SET lease_worker_principal_id = $2, lease_token_sha256 = $3, lease_fencing_counter = lease_fencing_counter + 1,
                leased_at = now(), lease_expires_at = now() + interval '2 minutes', heartbeat_at = NULL WHERE id = $1`,
        [item.attemptId, worker!.id, createHash("sha256").update(replacementToken, "utf8").digest("hex")],
      );
      const replaced = await fullRow(item.attemptId);
      expect(replaced).toMatchObject({
        state: "SUBMITTED",
        lease_worker_principal_id: worker!.id,
        submitting_worker_principal_id: worker!.id,
        lease_fencing_counter: "2",
      });

      // Principal equality cannot tell this epoch from the live-route lease (R44B6M accepted it with 200), so
      // SUBMITTED renewal is refused outright.
      const response = await call(port, worker!, "heartbeat", item.attemptId, { fencingCounter: 2, leaseToken: replacementToken });
      expect(response.status).toBe(409);
      expect(response.body).toBe(REJECTED);
      expect(events.at(-1)).toMatchObject({ type: "WORKER_LEASE_REJECTED", reason: "NOT_LEASED" });
      expect(await fullRow(item.attemptId)).toEqual(replaced);
    });

    it("rejects wrong worker, wrong token, stale fence and an expired lease in SUBMITTING, without extending it", async () => {
      const list = await workers(2);
      const item = await work();
      const port = await compose(list);
      const proof = await submittingAttempt(port, list[0]!, item);
      await age(item.attemptId);
      const before = await fullRow(item.attemptId);
      for (const [worker, candidate, type, reason] of [
        [list[1]!, proof, "WORKER_LEASE_REJECTED", "OTHER_WORKER"],
        [list[0]!, { ...proof, leaseToken: randomBytes(32).toString("base64url") }, "WORKER_FENCING_REJECTED", "TOKEN_MISMATCH"],
        [list[0]!, { ...proof, fencingCounter: 2 }, "WORKER_FENCING_REJECTED", "FENCING_MISMATCH"],
      ] as const) {
        const response = await call(port, worker, "heartbeat", item.attemptId, candidate);
        expect(response.status).toBe(409);
        expect(response.body).toBe(REJECTED);
        expect(events.at(-1)).toMatchObject({ type, reason });
      }
      expect(await fullRow(item.attemptId)).toEqual(before);

      await expire(item.attemptId);
      const expired = await fullRow(item.attemptId);
      const response = await call(port, list[0]!, "heartbeat", item.attemptId, proof);
      expect(response.status).toBe(409);
      expect(events.at(-1)).toMatchObject({ type: "WORKER_LEASE_REJECTED", reason: "LEASE_EXPIRED" });
      expect(await fullRow(item.attemptId)).toEqual(expired);
      expect(JSON.stringify(events).includes(proof.leaseToken)).toBe(false);
    });

    it("rejects OUTCOME_UNKNOWN and a terminal state (ABANDONED), which carry no lease", async () => {
      const [worker] = await workers(1);
      const port = await compose([worker!]);
      const item = await work();
      const proof = await submittingAttempt(port, worker!, item);
      await expire(item.attemptId);
      expect((await leaseRequest(port, worker!)).status).toBe(200);
      expect((await attempt(item.attemptId)).state).toBe("OUTCOME_UNKNOWN");
      const unknown = await call(port, worker!, "heartbeat", item.attemptId, proof);
      expect(unknown.status).toBe(409);
      expect(events.at(-1)).toMatchObject({ type: "WORKER_LEASE_REJECTED", reason: "NOT_LEASED" });

      // Terminal states carry no lease (migration 0004) and are outside the heartbeat states: walk the swept attempt to ABANDONED.
      await clients.migrator.query("UPDATE execution_attempts SET state = 'ABANDONED', failure_code = 'RECOVERY_ABANDONED', completed_at = now() WHERE id = $1", [
        item.attemptId,
      ]);
      expect((await call(port, worker!, "heartbeat", item.attemptId, proof)).status).toBe(409);
      expect(events.at(-1)).toMatchObject({ reason: "NOT_LEASED" });
    });
  });

  describe("release", () => {
    it("never releases SUBMITTING, a live SUBMITTED lease or OUTCOME_UNKNOWN to the queue", async () => {
      const list = await workers(3);
      const first = await work();
      const second = await work();
      const port = await compose(list);
      const proof = await submittingAttempt(port, list[0]!, first);
      const release = (worker: Worker, item: Work, candidate: Proof) => call(port, worker, "release", item.attemptId, candidate);
      expect((await release(list[0]!, first, proof)).status).toBe(409);
      expect((await attempt(first.attemptId)).state).toBe("SUBMITTING");

      // No /submitted route exists yet: the owner commits SUBMITTED, keeping the lease.
      await clients.migrator.query(
        "UPDATE execution_attempts SET state = 'SUBMITTED', provider_execution_id = 'fixture-execution-2', submitted_at = now() WHERE id = $1",
        [first.attemptId],
      );
      expect((await release(list[0]!, first, proof)).status).toBe(409);
      expect((await attempt(first.attemptId)).state).toBe("SUBMITTED");

      const secondProof = await submittingAttempt(port, list[1]!, second);
      await expire(second.attemptId);
      expect((await leaseRequest(port, list[2]!)).status).toBe(200);
      expect((await attempt(second.attemptId)).state).toBe("OUTCOME_UNKNOWN");
      expect((await release(list[1]!, second, secondProof)).status).toBe(409);
      expect((await attempt(second.attemptId)).state).toBe("OUTCOME_UNKNOWN");
      expect(await jobStatus(second.jobId)).toBe("NEEDS_ATTENTION");
      for (const event of events.filter((candidate) => candidate.type === "WORKER_LEASE_REJECTED")) expect(event.reason).toBe("NOT_LEASED");
    });
  });

  describe("expired-SUBMITTING sweep", () => {
    it("moves an expired SUBMITTING attempt to OUTCOME_UNKNOWN, keeping provenance and inventing nothing", async () => {
      const list = await workers(2);
      const item = await work();
      const port = await compose(list);
      const proof = await submittingAttempt(port, list[0]!, item);
      await expire(item.attemptId);
      const before = await fullRow(item.attemptId);

      const response = await leaseRequest(port, list[1]!);
      expect(response.status).toBe(200);
      expect(json(response)).toEqual({ lease: null });

      const after = await fullRow(item.attemptId);
      expect(after).toMatchObject({
        state: "OUTCOME_UNKNOWN",
        failure_code: "WORKER_LEASE_EXPIRED_DURING_SUBMISSION",
        // Live lease proof cleared, exactly as migration 0004 requires for OUTCOME_UNKNOWN.
        lease_worker_principal_id: null,
        lease_token_sha256: null,
        leased_at: null,
        lease_expires_at: null,
        heartbeat_at: null,
        // Kept: fencing counter, grant, barrier and the immutable submitting principal.
        lease_fencing_counter: before.lease_fencing_counter,
        credential_granted_at: before.credential_granted_at,
        submitting_at: before.submitting_at,
        submitting_worker_principal_id: list[0]!.id,
        // Never invented.
        provider_execution_id: null,
        submitted_at: null,
        recovery_expires_at: null,
        completed_at: null,
        output_object_key: null,
      });
      expect(await jobStatus(item.jobId)).toBe("NEEDS_ATTENTION");
      expect(await outcomeAudits(item.attemptId)).toEqual([
        { attemptNumber: 1, fencingCounter: 1, workerPrincipalId: list[0]!.id, failureCode: "WORKER_LEASE_EXPIRED_DURING_SUBMISSION" },
      ]);
      // A lifecycle fact, not a security event (architecture section 30).
      expect(events).toEqual([]);
      const visible = (await allAuditText()) + JSON.stringify(events);
      expect(visible.includes(proof.leaseToken) || visible.includes(item.plaintext) || visible.includes(item.fingerprintValue)).toBe(false);
      // Both credential obligations stay open.
      expect(await obligations(item)).toEqual({ hasOpenCredentialRetentionObligation: true, hasOpenProviderRecoveryObligation: true, blocksDestruction: true });
      // A later sweep is a no-op: no second transition, no second audit.
      expect((await leaseRequest(port, list[1]!)).status).toBe(200);
      expect(await fullRow(item.attemptId)).toEqual(after);
      expect(await outcomeAudits(item.attemptId)).toHaveLength(1);
    });

    it("leaves a live SUBMITTING lease alone, and sweeps only from the server's recognition of expiry", async () => {
      const list = await workers(2);
      const item = await work();
      const port = await compose(list);
      await submittingAttempt(port, list[0]!, item);
      expect((await leaseRequest(port, list[1]!)).status).toBe(200);
      expect((await attempt(item.attemptId)).state).toBe("SUBMITTING");
      expect(await outcomeAudits(item.attemptId)).toEqual([]);
    });

    it("does not lease the expired attempt, but leases unrelated queued work in the same request", async () => {
      const list = await workers(2);
      const stale = await work();
      const fresh = await work();
      const port = await compose(list);
      await submittingAttempt(port, list[0]!, stale);
      await expire(stale.attemptId);

      const lease = json(await leaseRequest(port, list[1]!)).lease;
      expect(lease.executionAttemptId).toBe(fresh.attemptId);
      expect((await attempt(stale.attemptId)).state).toBe("OUTCOME_UNKNOWN");
      expect((await attempt(fresh.attemptId)).state).toBe("LEASED");
      expect(await jobStatus(stale.jobId)).toBe("NEEDS_ATTENTION");
      expect(await jobStatus(fresh.jobId)).toBe("RUNNING");
      // The attempt count per job is unchanged: no replacement attempt was created.
      const attempts = await clients.migrator.query("SELECT count(*)::int AS count FROM execution_attempts WHERE execution_job_id = $1", [stale.jobId]);
      expect(attempts.rows).toEqual([{ count: 1 }]);
    });

    it("keeps one current lease per worker: a live SUBMITTING lease holds the slot until the sweep clears it", async () => {
      const [worker] = await workers(1);
      const stale = await work();
      const fresh = await work();
      const port = await compose([worker!]);
      await submittingAttempt(port, worker!, stale);
      // While SUBMITTING is live, the worker is at capacity.
      const refused = await leaseRequest(port, worker!);
      expect(refused.status).toBe(409);
      expect(events.at(-1)).toMatchObject({ type: "WORKER_LEASE_REJECTED", reason: "WORKER_AT_CAPACITY" });
      // Once expired, the same request sweeps it first; the worker then gets unrelated work, never the swept attempt.
      await expire(stale.attemptId);
      const lease = json(await leaseRequest(port, worker!)).lease;
      expect(lease.executionAttemptId).toBe(fresh.attemptId);
      expect((await attempt(stale.attemptId)).state).toBe("OUTCOME_UNKNOWN");
    });

    it("keeps the exact credential version retained when the customer disconnects after the sweep", async () => {
      const list = await workers(2);
      const item = await work();
      const port = await compose(list);
      await submittingAttempt(port, list[0]!, item);
      await expire(item.attemptId);
      expect((await leaseRequest(port, list[1]!)).status).toBe(200);
      expect((await attempt(item.attemptId)).state).toBe("OUTCOME_UNKNOWN");

      await disconnect(item);
      const row = await version(item.versionId);
      expect(row.status).toBe("RETAINED_FOR_RECOVERY");
      expect(row.sealed_credential).not.toBeNull();
      expect(await obligations(item)).toMatchObject({ hasOpenProviderRecoveryObligation: true, blocksDestruction: true });
    });
  });

  describe("races", () => {
    it("heartbeat first: a sweep that runs while the heartbeat holds the row skips it, and the renewed lease is not swept", async () => {
      const list = await workers(2);
      const item = await work();
      const leasePort = await compose(list);
      const proof = await submittingAttempt(leasePort, list[0]!, item);
      await server!.close();
      // Nearly expired: the heartbeat must win.
      await clients.migrator.query("UPDATE execution_attempts SET lease_expires_at = now() + interval '1 second' WHERE id = $1", [item.attemptId]);

      // Pause the heartbeat after it has locked and proven the lease, just before it renews.
      // The gated pool pauses only that one statement; the sweep below passes through it.
      const gated = gatedPool((sql) => sql.includes("SET heartbeat_at = now()"));
      const port = await compose(list, gated.pool);
      const heartbeat = call(port, list[0]!, "heartbeat", item.attemptId, proof);
      await gated.paused;
      // Let the old lease expire by every clock while the heartbeat holds the row lock.
      await new Promise((resolve) => setTimeout(resolve, 1300));
      expect(
        (await clients.migrator.query("SELECT lease_expires_at <= now() AS expired FROM execution_attempts WHERE id = $1", [item.attemptId])).rows,
      ).toEqual([{ expired: true }]);
      // A concurrent sweep (another worker's lease request) skips the locked row.
      expect((await leaseRequest(port, list[1]!)).status).toBe(200);
      expect((await attempt(item.attemptId)).state).toBe("SUBMITTING");
      gated.release();
      expect((await heartbeat).status).toBe(200);
      // After the renewal commits, the lease is live again and a later sweep leaves it.
      expect((await leaseRequest(port, list[1]!)).status).toBe(200);
      expect(await attempt(item.attemptId)).toMatchObject({ state: "SUBMITTING", lease_worker_principal_id: list[0]!.id });
      expect(await outcomeAudits(item.attemptId)).toEqual([]);
    });

    it("sweep first: the cleared lease cannot be revived by the old token and fence", async () => {
      const list = await workers(2);
      const item = await work();
      const port = await compose(list);
      const proof = await submittingAttempt(port, list[0]!, item);
      await expire(item.attemptId);
      expect((await leaseRequest(port, list[1]!)).status).toBe(200);
      const swept = await fullRow(item.attemptId);
      expect(swept.state).toBe("OUTCOME_UNKNOWN");
      for (const action of ["heartbeat", "submitting", "release", "credential-grant"] as const) {
        expect((await call(port, list[0]!, action, item.attemptId, proof)).status).toBe(409);
      }
      expect(await fullRow(item.attemptId)).toEqual(swept);
      expect(await outcomeAudits(item.attemptId)).toHaveLength(1);
    });

    it("concurrent sweepers convert each expired attempt exactly once, with one audit each", async () => {
      const list = await workers(6);
      const items = [await work(), await work(), await work()];
      const port = await compose(list);
      for (const [index, item] of items.entries()) await submittingAttempt(port, list[index]!, item);
      for (const item of items) await expire(item.attemptId);

      const responses = await Promise.all(list.slice(3).map((worker) => leaseRequest(port, worker)));
      expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
      for (const item of items) {
        expect(await attempt(item.attemptId)).toMatchObject({ state: "OUTCOME_UNKNOWN" });
        expect(await outcomeAudits(item.attemptId)).toHaveLength(1);
        expect(await jobStatus(item.jobId)).toBe("NEEDS_ATTENTION");
      }
    });
  });
});

describe("races with disconnect", () => {
  it("SUBMITTING first, then disconnect: disconnect waits and retains the exact version", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const leasePort = await compose([worker!]);
    const proof = await granted(leasePort, worker!);
    await server!.close();

    // Pause the acknowledgement after it holds the connection and version locks and has written SUBMITTING.
    const gated = gatedPool((sql, params) => sql.includes("INSERT INTO audit_events") && (params ?? []).includes("execution_attempt.submitting"));
    const port = await compose([worker!], gated.pool);
    const submitting = call(port, worker!, "submitting", item.attemptId, proof);
    await gated.paused;

    let disconnected = false;
    const disconnecting = disconnect(item).finally(() => (disconnected = true));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(disconnected).toBe(false);
    gated.release();

    expect((await submitting).status).toBe(200);
    await disconnecting;
    const row = await version(item.versionId);
    expect(row.status).toBe("RETAINED_FOR_RECOVERY");
    expect(row.sealed_credential).not.toBeNull();
    expect((await attempt(item.attemptId)).state).toBe("SUBMITTING");
    expect(await obligations(item)).toMatchObject({ hasOpenProviderRecoveryObligation: true, blocksDestruction: true });
  });

  it("disconnect first, then SUBMITTING: the acknowledgement waits, then refuses and the attempt stays LEASED", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);

    // Pause the disconnect after it has locked the connection and decided the version's fate.
    const gated = gatedPool((sql, params) => sql.includes("INSERT INTO audit_events") && (params ?? []).includes("provider_connection.disconnected"));
    const disconnecting = disconnect(item, gated.pool);
    await gated.paused;

    let settled = false;
    const submitting = call(port, worker!, "submitting", item.attemptId, proof).finally(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);
    gated.release();
    await disconnecting;

    const response = await submitting;
    expect(response.status).toBe(409);
    expect(response.body).toBe(REJECTED);
    expect(eventSummary()).toEqual([["WORKER_SUBMITTING_REJECTED", "CONNECTION_INELIGIBLE"]]);
    const row = await attempt(item.attemptId);
    expect(row.state).toBe("LEASED");
    expect(row.submitting_at).toBeNull();
    // The LEASED+grant retention obligation kept the exact version.
    expect((await version(item.versionId)).status).toBe("RETAINED_FOR_RECOVERY");
    expect(await submittingAudits(item.attemptId)).toEqual([]);
  });
});

describe("route", () => {
  it("validates the proof body strictly and the attempt id exactly", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    const headers = { ...auth(worker!), "Content-Type": "application/json" };
    const path = `/worker-control/v1/attempts/${item.attemptId}/submitting`;
    for (const body of [
      {},
      { fencingCounter: 1 },
      { leaseToken: proof.leaseToken },
      { ...proof, fencingCounter: "1" },
      { ...proof, fencingCounter: 0 },
      { ...proof, leaseToken: "short" },
      { ...proof, state: "SUBMITTING" },
      { ...proof, submittingAt: new Date().toISOString() },
      { ...proof, providerExecutionId: "x" },
    ]) {
      expect((await send(port, "POST", path, JSON.stringify(body), headers)).status).toBe(400);
    }
    expect((await send(port, "POST", path, `{"fencingCounter":1,"fencingCounter":1,"leaseToken":"${proof.leaseToken}"}`, headers)).status).toBe(400);
    expect((await send(port, "POST", path, JSON.stringify(proof), auth(worker!))).status).toBe(415);
    expect((await send(port, "POST", path, undefined, auth(worker!))).status).not.toBe(200);
    expect((await send(port, "POST", `/worker-control/v1/attempts/${item.attemptId.toUpperCase()}/submitting`, JSON.stringify(proof), headers)).status).toBe(404);
    expect((await send(port, "POST", "/worker-control/v1/attempts/not-a-uuid/submitting", JSON.stringify(proof), headers)).status).toBe(404);
    const get = await send(port, "GET", path, undefined, auth(worker!));
    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe("POST");
    expect((await attempt(item.attemptId)).state).toBe("LEASED");
  });

  it("requires worker authentication and refuses browser origins", async () => {
    const [worker] = await workers(1);
    const item = await work();
    const port = await compose([worker!]);
    const proof = await granted(port, worker!);
    const path = `/worker-control/v1/attempts/${item.attemptId}/submitting`;
    const body = JSON.stringify(proof);
    const missing = await send(port, "POST", path, body, { "Content-Type": "application/json" });
    expect(missing.status).toBe(401);
    expect(missing.body).toBe('{"status":"error","code":"AUTHENTICATION_REQUIRED"}\n');
    const wrong = await send(port, "POST", path, body, { "Content-Type": "application/json", Authorization: `Bearer fixture-customer-${randomBytes(16).toString("hex")}` });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toBe(missing.body);
    const origin = await send(port, "POST", path, body, { ...auth(worker!), "Content-Type": "application/json", Origin: "https://app.example" });
    expect(origin.status).toBe(403);
    expect(eventSummary()).toEqual([
      ["WORKER_AUTH_REQUIRED", expect.any(String)],
      ["WORKER_AUTH_REJECTED", "ADAPTER_REJECTED"],
      ["WORKER_ORIGIN_REJECTED", "ORIGIN_PRESENT"],
    ]);
    expect((await attempt(item.attemptId)).state).toBe("LEASED");
  });

  it("is not reachable through the default customer composition", async () => {
    const [worker] = await workers(1);
    const item = await work();
    server = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { checkReadiness: async () => true } });
    const response = await send(server.port, "POST", `/worker-control/v1/attempts/${item.attemptId}/submitting`, "{}", { ...auth(worker!), "Content-Type": "application/json" });
    expect(response.status).toBe(404);
    expect((await attempt(item.attemptId)).state).toBe("QUEUED");
  });
});

describe("privileges", () => {
  it("needs no new role or destructive privilege", async () => {
    const privileges = await clients.runtime.query(
      `SELECT has_column_privilege(current_user, 'public.execution_attempts', 'state', 'UPDATE') AS state_update,
              has_column_privilege(current_user, 'public.execution_attempts', 'submitting_at', 'UPDATE') AS submitting_update,
              has_table_privilege(current_user, 'public.execution_attempts', 'DELETE') AS delete,
              has_table_privilege(current_user, 'public.execution_attempts', 'TRUNCATE') AS truncate,
              (SELECT count(*)::int FROM pg_roles WHERE rolname ILIKE '%worker%') AS worker_roles`,
    );
    expect(privileges.rows).toEqual([{ state_update: true, submitting_update: true, delete: false, truncate: false, worker_roles: 0 }]);
  });
});
