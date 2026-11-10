import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type RuntimeClient, type TransactionalPool } from "../../src/database/runtimePool.js";
import { readCredentialObligations } from "../../src/providerConnections/credentialObligations.js";
import { ProviderConnectionError } from "../../src/providerConnections/providerConnectionError.js";
import { disconnectProviderConnection, type TrustedPrincipal } from "../../src/providerConnections/providerConnectionService.js";
import { insertAccountWithFreeGrant, openGuardedClients, prepareSchemaV1, type GuardedClients } from "./support/testDatabase.js";

// R44B6E: the ProviderConnection disconnect gate against PostgreSQL 16.
// Disconnect runs through the real service on a runtime-role pool, so its
// transactions commit; fixtures are committed by the owner role and the
// schema is reset in afterAll. Sealed envelopes and fingerprints are inert
// fixture values: no credential plaintext exists anywhere in this suite.

let clients: GuardedClients;
let pool: TransactionalPool;
let worker: string;

beforeAll(async () => {
  clients = await openGuardedClients();
  await prepareSchemaV1(clients);
  const config = loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl, COMMERCIAL_API_DATABASE_POOL_MAX: "4" }, "development");
  pool = await createRuntimePool(config!, () => {});
  worker = (await clients.migrator.query<{ id: string }>("INSERT INTO worker_principals (label) VALUES ('fixture-worker') RETURNING id")).rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
  await prepareSchemaV1(clients);
  await clients.close();
});

// ---------------------------------------------------------------------------
// Fixtures (committed by the owner role)

type Owner = TrustedPrincipal & Readonly<{ grantId: string; productionId: string }>;
type Connection = Owner & Readonly<{ connectionId: string; provider: string }>;

let counter = 0;
const unique = (prefix: string) => `${prefix}-${(counter += 1)}-${randomUUID().slice(0, 8)}`;

async function owner(): Promise<Owner> {
  const created = await insertAccountWithFreeGrant(clients.migrator, unique("gate"));
  const production = await clients.migrator.query<{ id: string }>(
    "INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id) VALUES ($1, 'Production', $2, $3) RETURNING id",
    [created.accountId, created.grantId, created.userId],
  );
  return { userId: created.userId, accountId: created.accountId, grantId: created.grantId, productionId: production.rows[0]!.id };
}

async function connection(o?: Owner, status = "ACTIVE"): Promise<Connection> {
  const base = o ?? (await owner());
  const provider = "EXAMPLE_PROVIDER";
  const result = await clients.migrator.query<{ id: string }>(
    `INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id, status, verification_status,
                                       last_verification_attempt_at, verified_at, disabled_at)
     VALUES ($1, $2, 'API_KEY', $3, $4, 'VERIFIED', now(), now(), CASE WHEN $4 = 'DISABLED' THEN now() END) RETURNING id`,
    [base.accountId, provider, base.userId, status],
  );
  return { ...base, connectionId: result.rows[0]!.id, provider };
}

// Versions are created SUPERSEDED except the newest ACTIVE one.
async function version(c: Connection, credentialVersion: number, status: "ACTIVE" | "SUPERSEDED"): Promise<string> {
  const result = await clients.migrator.query<{ id: string }>(
    `INSERT INTO provider_credential_versions
       (account_id, provider_connection_id, credential_version, status, sealed_credential, fingerprint_algorithm,
        fingerprint_key_ref, fingerprint_value, created_by_user_id, superseded_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'HMAC-SHA-256', 'fixture/v1', $6, $7, CASE WHEN $4 = 'SUPERSEDED' THEN now() END) RETURNING id`,
    [
      c.accountId,
      c.connectionId,
      credentialVersion,
      status,
      JSON.stringify({ format: "fixture-envelope", ciphertext: `inert-fixture-${randomUUID()}` }),
      randomUUID().replaceAll("-", "").padEnd(43, "Q").slice(0, 43),
      c.userId,
    ],
  );
  return result.rows[0]!.id;
}

// An authorization, job and QUEUED attempt bound to exactly this version.
async function attempt(c: Connection, versionId: string): Promise<string> {
  const authorization = await clients.migrator.query<{ id: string }>(
    `INSERT INTO generation_authorizations
       (account_id, production_id, entitlement_grant_id, billing_mode, provider, model, provider_connection_id,
        provider_credential_version_id, generation_request, generation_request_sha256, expected_cost_cap_unit,
        expected_cost_cap_amount, expires_at, created_by_user_id)
     VALUES ($1, $2, $3, 'USER_BYO', $4, 'example-model-1', $5, $6, '{"prompt":"fixture"}'::jsonb, repeat('c', 64),
             'MICRO_USD', 1000000, now() + interval '15 minutes', $7) RETURNING id`,
    [c.accountId, c.productionId, c.grantId, c.provider, c.connectionId, versionId, c.userId],
  );
  const job = await clients.migrator.query<{ id: string }>(
    "INSERT INTO execution_jobs (account_id, production_id, generation_authorization_id) VALUES ($1, $2, $3) RETURNING id",
    [c.accountId, c.productionId, authorization.rows[0]!.id],
  );
  const created = await clients.migrator.query<{ id: string }>(
    `INSERT INTO execution_attempts (account_id, execution_job_id, generation_authorization_id, attempt_number, billing_mode, provider,
                                     provider_credential_version_id)
     VALUES ($1, $2, $3, 1, 'USER_BYO', $4, $5) RETURNING id`,
    [c.accountId, job.rows[0]!.id, authorization.rows[0]!.id, c.provider, versionId],
  );
  return created.rows[0]!.id;
}

const CLEAR_LEASE = "lease_worker_principal_id = NULL, lease_token_sha256 = NULL, leased_at = NULL, lease_expires_at = NULL, heartbeat_at = NULL";
const STEP = {
  LEASED: `state = 'LEASED', lease_worker_principal_id = $2, lease_token_sha256 = encode(sha256(gen_random_uuid()::text::bytea), 'hex'),
           lease_fencing_counter = lease_fencing_counter + 1, leased_at = now() - interval '3 days', lease_expires_at = now() + interval '5 minutes'`,
  GRANT: "credential_granted_at = now() - interval '3 days'",
  QUEUED: `state = 'QUEUED', ${CLEAR_LEASE}, credential_granted_at = NULL`,
  SUBMITTING: "state = 'SUBMITTING', credential_granted_at = COALESCE(credential_granted_at, now() - interval '3 days'), submitting_at = now() - interval '2 days'",
  SUBMITTED: "state = 'SUBMITTED', provider_execution_id = 'exec-' || id::text, submitted_at = now() - interval '2 days'",
  OUTCOME_UNKNOWN: `state = 'OUTCOME_UNKNOWN', ${CLEAR_LEASE}, failure_code = 'PROVIDER_CREATE_TIMEOUT'`,
  SUCCEEDED: `state = 'SUCCEEDED', ${CLEAR_LEASE}, output_object_key = 'accounts/a/attempts/' || id || '/output.mp4',
              output_sha256 = repeat('a', 64), output_byte_count = 10, output_content_type = 'video/mp4', completed_at = now()`,
  FAILED_BEFORE_SUBMISSION: `state = 'FAILED_BEFORE_SUBMISSION', ${CLEAR_LEASE}, failure_code = 'PROVIDER_REJECTED_REQUEST', completed_at = now()`,
  SUBMITTED_FAILED: `state = 'SUBMITTED_FAILED', ${CLEAR_LEASE}, failure_code = 'PROVIDER_GENERATION_FAILED', completed_at = now()`,
  ABANDONED: `state = 'ABANDONED', ${CLEAR_LEASE}, failure_code = 'RECOVERY_ABANDONED', completed_at = now()`,
  CANCELLED: `state = 'CANCELLED', ${CLEAR_LEASE}, completed_at = now()`,
} as const;
type Step = keyof typeof STEP;

async function walk(attemptId: string, steps: readonly Step[]): Promise<void> {
  for (const step of steps) {
    const params = step === "LEASED" ? [attemptId, worker] : [attemptId];
    await clients.migrator.query(`UPDATE execution_attempts SET ${STEP[step]}, updated_at = now() WHERE id = $1`, params);
  }
}

const PATHS = {
  QUEUED: [],
  LEASED_NO_GRANT: ["LEASED"],
  LEASED_GRANTED: ["LEASED", "GRANT"],
  SUBMITTING: ["LEASED", "SUBMITTING"],
  SUBMITTED: ["LEASED", "SUBMITTING", "SUBMITTED"],
  OUTCOME_UNKNOWN: ["LEASED", "SUBMITTING", "OUTCOME_UNKNOWN"],
  SUCCEEDED: ["LEASED", "SUBMITTING", "SUBMITTED", "SUCCEEDED"],
  FAILED_BEFORE_SUBMISSION: ["LEASED", "FAILED_BEFORE_SUBMISSION"],
  DEFINITIVE_REJECTION: ["LEASED", "SUBMITTING", "FAILED_BEFORE_SUBMISSION"],
  SUBMITTED_FAILED: ["LEASED", "SUBMITTING", "SUBMITTED", "SUBMITTED_FAILED"],
  ABANDONED: ["LEASED", "SUBMITTING", "SUBMITTED", "ABANDONED"],
  CANCELLED: ["CANCELLED"],
} as const satisfies Record<string, readonly Step[]>;

type VersionRow = {
  id: string;
  credential_version: number;
  status: string;
  sealed_credential: unknown;
  fingerprint_algorithm: string | null;
  fingerprint_key_ref: string | null;
  fingerprint_value: string | null;
  retained_for_recovery_at: Date | null;
  destroyed_at: Date | null;
};

async function versions(c: Connection): Promise<Map<number, VersionRow>> {
  const result = await clients.migrator.query<VersionRow>(
    `SELECT id, credential_version, status, sealed_credential, fingerprint_algorithm, fingerprint_key_ref, fingerprint_value,
            retained_for_recovery_at, destroyed_at
       FROM provider_credential_versions WHERE provider_connection_id = $1 ORDER BY credential_version`,
    [c.connectionId],
  );
  return new Map(result.rows.map((row) => [row.credential_version, row]));
}

async function audits(c: Connection) {
  const result = await clients.migrator.query<{ event_type: string; metadata: Record<string, unknown>; text: string }>(
    "SELECT event_type, metadata, audit_events::text AS text FROM audit_events WHERE resource_id = $1 ORDER BY sequence",
    [c.connectionId],
  );
  return result.rows;
}

const disconnect = (c: Connection, p: TransactionalPool = pool) => disconnectProviderConnection({ pool: p }, { userId: c.userId, accountId: c.accountId }, c.connectionId);

async function obligationsFor(accountId: string, ids: readonly string[]) {
  const client = await pool.connect();
  try {
    return await readCredentialObligations(client, accountId, ids);
  } finally {
    client.release();
  }
}

function expectRetainedUnchanged(before: VersionRow, after: VersionRow) {
  expect(after.status).toBe("RETAINED_FOR_RECOVERY");
  expect(after.retained_for_recovery_at).not.toBeNull();
  expect(after.destroyed_at).toBeNull();
  expect(after.sealed_credential).toEqual(before.sealed_credential);
  expect([after.fingerprint_algorithm, after.fingerprint_key_ref, after.fingerprint_value]).toEqual([
    before.fingerprint_algorithm,
    before.fingerprint_key_ref,
    before.fingerprint_value,
  ]);
}

function expectDestroyed(row: VersionRow) {
  expect(row).toMatchObject({ status: "DESTROYED", sealed_credential: null, fingerprint_algorithm: null, fingerprint_key_ref: null, fingerprint_value: null });
  expect(row.destroyed_at).not.toBeNull();
}

// ---------------------------------------------------------------------------

describe("credential obligation read model", () => {
  it("derives retention and recovery per exact credential version from attempt state", async () => {
    const c = await connection();
    const expected: Record<keyof typeof PATHS, [boolean, boolean]> = {
      QUEUED: [false, false],
      LEASED_NO_GRANT: [false, false],
      LEASED_GRANTED: [true, false],
      SUBMITTING: [true, true],
      SUBMITTED: [true, true],
      OUTCOME_UNKNOWN: [true, true],
      SUCCEEDED: [false, false],
      FAILED_BEFORE_SUBMISSION: [false, false],
      DEFINITIVE_REJECTION: [false, false],
      SUBMITTED_FAILED: [false, false],
      ABANDONED: [false, false],
      CANCELLED: [false, false],
    };
    const ids = new Map<keyof typeof PATHS, string>();
    let n = 0;
    for (const [label, path] of Object.entries(PATHS) as [keyof typeof PATHS, readonly Step[]][]) {
      const versionId = await version(c, (n += 1), "SUPERSEDED");
      await walk(await attempt(c, versionId), path);
      ids.set(label, versionId);
    }
    const untouched = await version(c, (n += 1), "ACTIVE");

    const states = await obligationsFor(c.accountId, [...ids.values(), untouched]);
    for (const [label, versionId] of ids) {
      const state = states.get(versionId)!;
      const [retention, recovery] = expected[label];
      expect({ label, retention: state.hasOpenCredentialRetentionObligation, recovery: state.hasOpenProviderRecoveryObligation, blocks: state.blocksDestruction }).toEqual({
        label,
        retention,
        recovery,
        blocks: retention || recovery,
      });
    }
    // Isolation: an open obligation on other versions never reaches this one.
    expect(states.get(untouched)).toEqual({ hasOpenCredentialRetentionObligation: false, hasOpenProviderRecoveryObligation: false, blocksDestruction: false });
    // Another account cannot read these versions at all.
    const other = await owner();
    expect((await obligationsFor(other.accountId, [...ids.values()])).size).toBe(0);
  });
});

describe("disconnect gate", () => {
  it("decides each version independently: retains blocked versions sealed, destroys the rest", async () => {
    const c = await connection();
    const v1 = await version(c, 1, "SUPERSEDED");
    const v2 = await version(c, 2, "SUPERSEDED");
    const v3 = await version(c, 3, "SUPERSEDED");
    const v4 = await version(c, 4, "SUPERSEDED");
    const v5 = await version(c, 5, "ACTIVE");
    await walk(await attempt(c, v1), PATHS.SUBMITTED);
    await walk(await attempt(c, v3), PATHS.OUTCOME_UNKNOWN);
    await walk(await attempt(c, v4), PATHS.SUCCEEDED);
    await walk(await attempt(c, v5), PATHS.LEASED_GRANTED);
    // v2 has no attempt at all.
    void v2;
    const before = await versions(c);

    const result = await disconnect(c);

    expect(result.created).toBe(true);
    expect(result.providerConnection.status).toBe("DISCONNECTED");
    expect(result.providerConnection.disconnectedAt).not.toBeNull();
    expect(Object.keys(result.providerConnection).sort()).toEqual([
      "createdAt",
      "credentialKind",
      "currentCredentialStatus",
      "currentCredentialVersion",
      "disconnectedAt",
      "id",
      "label",
      "provider",
      "status",
      "updatedAt",
      "verificationStatus",
    ]);
    const after = await versions(c);
    // SUPERSEDED -> RETAINED (v1, v3) and ACTIVE -> RETAINED (v5), byte-identical material.
    for (const n of [1, 3, 5]) expectRetainedUnchanged(before.get(n)!, after.get(n)!);
    for (const n of [2, 4]) expectDestroyed(after.get(n)!);
    expect([...after.values()].some((row) => row.status === "ACTIVE")).toBe(false);

    const events = await audits(c);
    expect(events.map((event) => [event.event_type, event.metadata])).toEqual([
      ["provider_connection.disconnected", { provider: "EXAMPLE_PROVIDER" }],
      ["provider_connection.secret_retained_for_recovery", { provider: "EXAMPLE_PROVIDER", credentialVersion: 1 }],
      ["provider_connection.secret_retained_for_recovery", { provider: "EXAMPLE_PROVIDER", credentialVersion: 3 }],
      ["provider_connection.secret_retained_for_recovery", { provider: "EXAMPLE_PROVIDER", credentialVersion: 5 }],
      ["provider_connection.secret_destroyed", { provider: "EXAMPLE_PROVIDER", credentialVersion: 2 }],
      ["provider_connection.secret_destroyed", { provider: "EXAMPLE_PROVIDER", credentialVersion: 4 }],
    ]);
    // No envelope, ciphertext, fingerprint or key reference in audit or response.
    const secrets = [...before.values()].flatMap((row) => [JSON.stringify(row.sealed_credential), row.fingerprint_value!, "inert-fixture-", "fixture/v1"]);
    const visible = JSON.stringify(result) + events.map((event) => event.text).join("\n");
    for (const secret of secrets) expect(visible.includes(secret)).toBe(false);
  });

  it("destroys after a definitive provider rejection, keeping submitting_at as history", async () => {
    const c = await connection();
    const v1 = await version(c, 1, "ACTIVE");
    const attemptId = await attempt(c, v1);
    await walk(attemptId, PATHS.DEFINITIVE_REJECTION);

    await disconnect(c);

    expectDestroyed((await versions(c)).get(1)!);
    const row = await clients.migrator.query("SELECT state, submitting_at IS NOT NULL AS barrier_crossed FROM execution_attempts WHERE id = $1", [attemptId]);
    expect(row.rows).toEqual([{ state: "FAILED_BEFORE_SUBMISSION", barrier_crossed: true }]);
  });

  it("retains for OUTCOME_UNKNOWN even after its recovery horizon passed, until explicitly abandoned", async () => {
    const c = await connection();
    const v1 = await version(c, 1, "ACTIVE");
    const attemptId = await attempt(c, v1);
    await walk(attemptId, PATHS.OUTCOME_UNKNOWN);
    await clients.migrator.query("UPDATE execution_attempts SET recovery_expires_at = now() - interval '1 day' WHERE id = $1", [attemptId]);
    const before = await versions(c);

    await disconnect(c);
    expectRetainedUnchanged(before.get(1)!, (await versions(c)).get(1)!);
    // Repeating while the obligation remains open changes nothing.
    const repeated = await disconnect(c);
    expect(repeated.created).toBe(false);
    expectRetainedUnchanged(before.get(1)!, (await versions(c)).get(1)!);
    expect((await audits(c)).map((event) => event.event_type)).toEqual([
      "provider_connection.disconnected",
      "provider_connection.secret_retained_for_recovery",
    ]);

    // An explicit terminal resolution closes the obligation; the next disconnect destroys.
    await walk(attemptId, ["ABANDONED"]);
    await disconnect(c);
    expectDestroyed((await versions(c)).get(1)!);

    // After destruction: no error, no resurrection, no further audit.
    const again = await disconnect(c);
    expect(again.providerConnection.status).toBe("DISCONNECTED");
    expectDestroyed((await versions(c)).get(1)!);
    expect((await audits(c)).map((event) => event.event_type)).toEqual([
      "provider_connection.disconnected",
      "provider_connection.secret_retained_for_recovery",
      "provider_connection.secret_destroyed",
    ]);
  });

  it("retains a pre-submission granted credential, then destroys it once the lease is returned", async () => {
    const c = await connection();
    const v1 = await version(c, 1, "ACTIVE");
    const attemptId = await attempt(c, v1);
    await walk(attemptId, PATHS.LEASED_GRANTED);
    const before = await versions(c);

    await disconnect(c);
    expectRetainedUnchanged(before.get(1)!, (await versions(c)).get(1)!);

    // The lease ends without a provider call: requeue clears the lease-scoped grant.
    await walk(attemptId, ["QUEUED"]);
    await disconnect(c);
    expectDestroyed((await versions(c)).get(1)!);
  });

  it("retains for SUBMITTING and SUBMITTED, and destroys after SUBMITTED_FAILED, SUCCEEDED or CANCELLED", async () => {
    for (const [path, retained] of [
      [PATHS.SUBMITTING, true],
      [PATHS.SUBMITTED, true],
      [PATHS.SUBMITTED_FAILED, false],
      [PATHS.SUCCEEDED, false],
      [PATHS.CANCELLED, false],
      [PATHS.FAILED_BEFORE_SUBMISSION, false],
      [PATHS.LEASED_NO_GRANT, false],
      [PATHS.QUEUED, false],
    ] as const) {
      const c = await connection();
      const v1 = await version(c, 1, "ACTIVE");
      await walk(await attempt(c, v1), path);
      await disconnect(c);
      expect({ path, status: (await versions(c)).get(1)!.status }).toEqual({ path, status: retained ? "RETAINED_FOR_RECOVERY" : "DESTROYED" });
    }
  });

  it("disconnects a DISABLED connection with the same gate and leaves already destroyed versions destroyed", async () => {
    const c = await connection(undefined, "DISABLED");
    const v1 = await version(c, 1, "SUPERSEDED");
    const v2 = await version(c, 2, "ACTIVE");
    await walk(await attempt(c, v2), PATHS.SUBMITTED);
    await clients.migrator.query(
      `UPDATE provider_credential_versions SET status = 'DESTROYED', destroyed_at = now(), sealed_credential = NULL,
              fingerprint_algorithm = NULL, fingerprint_key_ref = NULL, fingerprint_value = NULL WHERE id = $1`,
      [v1],
    );

    await disconnect(c);
    const after = await versions(c);
    expectDestroyed(after.get(1)!);
    expect(after.get(2)!.status).toBe("RETAINED_FOR_RECOVERY");
    // The only audit for v1 is none: it was already destroyed before this disconnect.
    expect((await audits(c)).map((event) => [event.event_type, event.metadata.credentialVersion ?? null])).toEqual([
      ["provider_connection.disconnected", null],
      ["provider_connection.secret_retained_for_recovery", 2],
    ]);
  });

  it("is not affected by obligations on another account's credentials", async () => {
    const a = await connection();
    const b = await connection();
    const va = await version(a, 1, "ACTIVE");
    await version(b, 1, "ACTIVE");
    await walk(await attempt(a, va), PATHS.SUBMITTED);

    await disconnect(b);
    expectDestroyed((await versions(b)).get(1)!);
    expect((await versions(a)).get(1)!.status).toBe("ACTIVE");
  });
});

describe("atomicity, ownership and locking", () => {
  it("rolls back everything when the transaction fails part-way", async () => {
    const c = await connection();
    const v1 = await version(c, 1, "SUPERSEDED");
    await version(c, 2, "ACTIVE");
    await walk(await attempt(c, v1), PATHS.SUBMITTED);
    const before = await versions(c);

    // A pool whose sessions fail the first secret_destroyed audit insert, after
    // the connection update and both version decisions have run.
    const failing: TransactionalPool = {
      query: pool.query,
      end: async () => {},
      connect: async () => {
        const inner = await pool.connect();
        const client: RuntimeClient = {
          release: (error?: Error) => inner.release(error),
          query: async <Row extends object>(sql: string, params?: unknown[]) => {
            if (sql.includes("INSERT INTO audit_events") && params?.includes("provider_connection.secret_destroyed")) {
              throw Object.assign(new Error("injected failure"), { code: "XX000" });
            }
            return inner.query<Row>(sql, params);
          },
        };
        return client;
      },
    };

    await expect(disconnect(c, failing)).rejects.toMatchObject({ code: "PROVIDER_CONNECTION_DATABASE_FAILURE" });

    const status = await clients.migrator.query("SELECT status, disconnected_at FROM provider_connections WHERE id = $1", [c.connectionId]);
    expect(status.rows).toEqual([{ status: "ACTIVE", disconnected_at: null }]);
    expect(await versions(c)).toEqual(before);
    expect(await audits(c)).toEqual([]);
  });

  it("answers foreign, missing and malformed connections identically and changes nothing", async () => {
    const a = await connection();
    const b = await connection();
    await version(a, 1, "ACTIVE");
    for (const target of [a.connectionId, randomUUID(), "not-a-uuid"]) {
      const error = await disconnectProviderConnection({ pool }, { userId: b.userId, accountId: b.accountId }, target).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ProviderConnectionError);
      expect((error as ProviderConnectionError).code).toBe("PROVIDER_CONNECTION_NOT_FOUND");
    }
    expect((await versions(a)).get(1)!.status).toBe("ACTIVE");
    expect(await audits(a)).toEqual([]);
  });

  it("serialises with a future credential grant that locks the exact version row first", async () => {
    // Models the contract for the future worker-control service: the grant
    // transaction locks the version row FOR SHARE before recording
    // credential_granted_at. Disconnect's FOR UPDATE must wait for it, then
    // see the committed grant and retain the version.
    const c = await connection();
    const v1 = await version(c, 1, "ACTIVE");
    const attemptId = await attempt(c, v1);
    await walk(attemptId, ["LEASED"]);

    const grant: pg.Client = clients.runtime;
    await grant.query("BEGIN");
    try {
      const locked = await grant.query(
        "SELECT v.status, c.status AS connection_status FROM provider_credential_versions v JOIN provider_connections c ON c.id = v.provider_connection_id WHERE v.id = $1 FOR SHARE OF v",
        [v1],
      );
      expect(locked.rows).toEqual([{ status: "ACTIVE", connection_status: "ACTIVE" }]);
      await grant.query("UPDATE execution_attempts SET credential_granted_at = now() WHERE id = $1", [attemptId]);

      let settled = false;
      const pending = disconnect(c).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await grant.query("COMMIT");
      await pending;
    } catch (error) {
      await grant.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    expect((await versions(c)).get(1)!.status).toBe("RETAINED_FOR_RECOVERY");

    // The other order: after disconnect commits, a grant that locks first sees the
    // version is no longer eligible for a new pre-submission grant and must refuse.
    const d = await connection();
    const w1 = await version(d, 1, "ACTIVE");
    await walk(await attempt(d, w1), ["LEASED"]);
    await disconnect(d);
    const seen = await clients.runtime.query(
      "SELECT v.status, c.status AS connection_status FROM provider_credential_versions v JOIN provider_connections c ON c.id = v.provider_connection_id WHERE v.id = $1",
      [w1],
    );
    expect(seen.rows).toEqual([{ status: "DESTROYED", connection_status: "DISCONNECTED" }]);
  });
});
