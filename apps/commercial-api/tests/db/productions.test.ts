import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type RuntimeClient, type TransactionalPool } from "../../src/database/runtimePool.js";
import { createFirstProductionForUser, type CreateFirstProductionResult } from "../../src/productions/createFirstProductionForUser.js";
import { ProductionCreationError } from "../../src/productions/productionCreationError.js";
import { provisionPersonalAccountForIdentity } from "../../src/provisioning/provisionPersonalAccountForIdentity.js";
import { openGuardedClients, prepareSchemaV1, type GuardedClients } from "./support/testDatabase.js";

// Every application write runs as the restricted runtime role. The suite
// starts from, and is restored to, a pristine schema v1.

const ISSUER = "https://issuer.productions.test/";
let clients: GuardedClients;
const pools: TransactionalPool[] = [];

async function runtimePool(poolMax = 10): Promise<TransactionalPool> {
  const config = loadRuntimeDatabaseConfig(
    { COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl, COMMERCIAL_API_DATABASE_POOL_MAX: String(poolMax) },
    "development",
  );
  const pool = await createRuntimePool(config!, () => {});
  pools.push(pool);
  return pool;
}

beforeAll(async () => {
  clients = await openGuardedClients();
  await prepareSchemaV1(clients);
});

afterAll(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
  await prepareSchemaV1(clients);
  await clients.close();
});

async function provisioned(pool: TransactionalPool, label: string) {
  return provisionPersonalAccountForIdentity(pool, { issuer: ISSUER, subject: `${label}-${randomUUID()}` });
}

async function grantRow(grantId: string) {
  const result = await clients.migrator.query(
    "SELECT state, reserved_at, consumed_at, revoked_at, expired_at, expires_at, policy_version, updated_at FROM entitlement_grants WHERE id = $1",
    [grantId],
  );
  return result.rows[0];
}

async function accountCounts(accountId: string) {
  const result = await clients.migrator.query<{ productions: number; audits: number }>(
    `SELECT (SELECT count(*)::int FROM productions WHERE account_id = $1) AS productions,
            (SELECT count(*)::int FROM audit_events WHERE account_id = $1 AND event_type = 'production.created') AS audits`,
    [accountId],
  );
  return result.rows[0]!;
}

function createBarrier(parties: number) {
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  return async () => {
    arrived += 1;
    if (arrived === parties) open();
    await gate;
  };
}

// Every party holds a checked-out session before any begins its transaction.
function withBarrier(pool: TransactionalPool, arrive: () => Promise<void>): TransactionalPool {
  return {
    ...pool,
    connect: async () => {
      const client = await pool.connect();
      await arrive();
      return client;
    },
  };
}

type Outcome = { ok: true; result: CreateFirstProductionResult } | { ok: false; error: unknown };

async function race(pools: readonly TransactionalPool[], calls: number, input: (index: number) => Parameters<typeof createFirstProductionForUser>[1]) {
  const arrive = createBarrier(calls);
  const racing = pools.map((pool) => withBarrier(pool, arrive));
  return Promise.all(
    Array.from({ length: calls }, (_unused, index): Promise<Outcome> =>
      createFirstProductionForUser(racing[index % racing.length]!, input(index)).then(
        (result) => ({ ok: true, result }),
        (error: unknown) => ({ ok: false, error }),
      ),
    ),
  );
}

describe("first production against PostgreSQL 16 as the runtime role", () => {
  it("runs as the runtime role", async () => {
    const pool = await runtimePool();
    expect((await pool.query<{ user: string }>("SELECT current_user AS user")).rows).toEqual([{ user: "busybookie_commercial_test_runtime" }]);
  });

  it("A. creates the first production with correct provenance and one audit event, leaving the grant untouched", async () => {
    const pool = await runtimePool();
    const identity = await provisioned(pool, "first");
    const before = await grantRow(identity.freeByoEntitlementGrant.id);

    const result = await createFirstProductionForUser(pool, { userId: identity.user.id, title: "Our first story", idempotencyKey: "create-1" });

    expect(result.created).toBe(true);
    expect(result.production).toMatchObject({
      accountId: identity.personalAccount.id,
      creationEntitlementGrantId: identity.freeByoEntitlementGrant.id,
      createdByUserId: identity.user.id,
      title: "Our first story",
      creationIdempotencyKey: "create-1",
      archivedAt: null,
    });
    expect(await accountCounts(identity.personalAccount.id)).toEqual({ productions: 1, audits: 1 });

    const audit = await clients.migrator.query(
      "SELECT actor_type, actor_user_id, resource_type, resource_id, correlation_id, metadata FROM audit_events WHERE event_type = 'production.created' AND account_id = $1",
      [identity.personalAccount.id],
    );
    expect(audit.rows).toEqual([
      {
        actor_type: "USER",
        actor_user_id: identity.user.id,
        resource_type: "production",
        resource_id: result.production.id,
        correlation_id: result.correlationId,
        metadata: { grantId: identity.freeByoEntitlementGrant.id, policyVersion: "free-byo-v1" },
      },
    ]);

    const after = await grantRow(identity.freeByoEntitlementGrant.id);
    expect(after).toEqual(before);
    expect(after).toMatchObject({ state: "AVAILABLE", reserved_at: null, consumed_at: null, revoked_at: null, expired_at: null });
  });

  it("B. sequential retries with the same key return the same production and one audit event", async () => {
    const pool = await runtimePool();
    const identity = await provisioned(pool, "sequential");
    const first = await createFirstProductionForUser(pool, { userId: identity.user.id, title: "Retry me", idempotencyKey: "retry-key" });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const again = await createFirstProductionForUser(pool, { userId: identity.user.id, title: "Retry me", idempotencyKey: "retry-key" });
      expect(again).toMatchObject({ created: false, production: { id: first.production.id } });
    }
    expect(await accountCounts(identity.personalAccount.id)).toEqual({ productions: 1, audits: 1 });

    await expect(
      createFirstProductionForUser(pool, { userId: identity.user.id, title: "Another title", idempotencyKey: "retry-key" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_CONFLICT" });
  });

  it("C. 20 concurrent same-key calls across two pools converge on one production without a surfaced 23505", async () => {
    const poolA = await runtimePool(10);
    const poolB = await runtimePool(10);

    for (let round = 0; round < 3; round += 1) {
      const identity = await provisioned(poolA, `same-key-${round}`);
      const outcomes = await race([poolA, poolB], 20, () => ({ userId: identity.user.id, title: "Shared request", idempotencyKey: "same-key" }));

      const failures = outcomes.filter((outcome) => !outcome.ok);
      expect(failures, JSON.stringify(failures.map((failure) => (failure as { error: { code?: string } }).error.code))).toEqual([]);
      const results = outcomes.map((outcome) => (outcome as { result: CreateFirstProductionResult }).result);
      expect(new Set(results.map((result) => result.production.id)).size).toBe(1);
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(await accountCounts(identity.personalAccount.id)).toEqual({ productions: 1, audits: 1 });
    }
  });

  it("D. 20 concurrent calls with different keys create exactly one production", async () => {
    const poolA = await runtimePool(10);
    const poolB = await runtimePool(10);

    for (let round = 0; round < 3; round += 1) {
      const identity = await provisioned(poolA, `different-keys-${round}`);
      const outcomes = await race([poolA, poolB], 20, (index) => ({ userId: identity.user.id, title: "Competing", idempotencyKey: `key-${index}` }));

      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
      for (const outcome of outcomes.filter((candidate) => !candidate.ok)) {
        expect((outcome as { error: unknown }).error).toBeInstanceOf(ProductionCreationError);
        expect((outcome as { error: ProductionCreationError }).error.code).toBe("ENTITLEMENT_NOT_AVAILABLE");
      }
      expect(await accountCounts(identity.personalAccount.id)).toEqual({ productions: 1, audits: 1 });
    }
  });

  it("E. 20 concurrent calls without a key create exactly one production", async () => {
    const poolA = await runtimePool(10);
    const poolB = await runtimePool(10);
    const identity = await provisioned(poolA, "no-key");

    const outcomes = await race([poolA, poolB], 20, () => ({ userId: identity.user.id, title: "No key" }));

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok).every((outcome) => (outcome as { error: ProductionCreationError }).error.code === "ENTITLEMENT_NOT_AVAILABLE")).toBe(true);
    expect(await accountCounts(identity.personalAccount.id)).toEqual({ productions: 1, audits: 1 });
  });

  it("F. an archived first production still counts toward free-byo-v1", async () => {
    const pool = await runtimePool();
    const identity = await provisioned(pool, "archived");
    const first = await createFirstProductionForUser(pool, { userId: identity.user.id, title: "To archive" });
    await pool.query("UPDATE productions SET archived_at = now(), updated_at = now() WHERE id = $1", [first.production.id]);

    await expect(createFirstProductionForUser(pool, { userId: identity.user.id, title: "Second" })).rejects.toMatchObject({
      code: "ENTITLEMENT_NOT_AVAILABLE",
    });
    expect(await accountCounts(identity.personalAccount.id)).toEqual({ productions: 1, audits: 1 });
    const archived = await clients.migrator.query("SELECT archived_at IS NOT NULL AS archived FROM productions WHERE id = $1", [first.production.id]);
    expect(archived.rows).toEqual([{ archived: true }]);
  });

  it.each([
    ["RESERVED", "reserved_at"],
    ["CONSUMED", "consumed_at"],
    ["REVOKED", "revoked_at"],
    ["EXPIRED", "expired_at"],
  ])("G. a %s grant cannot authorise a production and is left unchanged", async (state, timestampColumn) => {
    const pool = await runtimePool();
    const identity = await provisioned(pool, `state-${state.toLowerCase()}`);
    await pool.query(`UPDATE entitlement_grants SET state = $1, ${timestampColumn} = now(), updated_at = now() WHERE id = $2`, [
      state,
      identity.freeByoEntitlementGrant.id,
    ]);
    const before = await grantRow(identity.freeByoEntitlementGrant.id);

    await expect(createFirstProductionForUser(pool, { userId: identity.user.id, title: "Blocked" })).rejects.toMatchObject({
      code: "ENTITLEMENT_NOT_AVAILABLE",
    });
    expect(await grantRow(identity.freeByoEntitlementGrant.id)).toEqual(before);
    expect(await accountCounts(identity.personalAccount.id)).toEqual({ productions: 0, audits: 0 });
  });

  it("H. a grant issued under an unknown policy version fails closed and creates nothing", async () => {
    const pool = await runtimePool();
    const user = await pool.query<{ id: string }>("INSERT INTO users (idp_issuer, idp_subject) VALUES ($1, $2) RETURNING id", [ISSUER, `unknown-policy-${randomUUID()}`]);
    const account = await pool.query<{ id: string }>("INSERT INTO accounts (kind, owner_user_id) VALUES ('PERSONAL', $1) RETURNING id", [user.rows[0]!.id]);
    await pool.query(
      `INSERT INTO entitlement_grants (account_id, kind, state, source, issuance_key, policy_version)
       VALUES ($1, 'FREE_BYO', 'AVAILABLE', 'ACCOUNT_PROVISIONING', 'account-provisioning', 'free-byo-v999')`,
      [account.rows[0]!.id],
    );

    await expect(createFirstProductionForUser(pool, { userId: user.rows[0]!.id, title: "Unknown" })).rejects.toMatchObject({
      code: "ENTITLEMENT_POLICY_UNSUPPORTED",
    });
    expect(await accountCounts(account.rows[0]!.id)).toEqual({ productions: 0, audits: 0 });
  });

  it("I. refuses a disabled user or account without a production or audit event", async () => {
    const pool = await runtimePool();

    const disabledUser = await provisioned(pool, "disabled-user");
    await pool.query("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [disabledUser.user.id]);
    await expect(createFirstProductionForUser(pool, { userId: disabledUser.user.id, title: "No" })).rejects.toMatchObject({
      code: "PRODUCTION_ACCOUNT_UNAVAILABLE",
      reason: "USER_DISABLED",
    });
    expect(await accountCounts(disabledUser.personalAccount.id)).toEqual({ productions: 0, audits: 0 });

    const disabledAccount = await provisioned(pool, "disabled-account");
    await pool.query("UPDATE accounts SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [disabledAccount.personalAccount.id]);
    await expect(createFirstProductionForUser(pool, { userId: disabledAccount.user.id, title: "No" })).rejects.toMatchObject({
      code: "PRODUCTION_ACCOUNT_UNAVAILABLE",
      reason: "ACCOUNT_DISABLED",
    });
    expect(await accountCounts(disabledAccount.personalAccount.id)).toEqual({ productions: 0, audits: 0 });

    await expect(createFirstProductionForUser(pool, { userId: randomUUID(), title: "No" })).rejects.toMatchObject({ reason: "USER_NOT_FOUND" });
  });

  it("J. callers cannot choose another account or grant, and the composite foreign key still blocks cross-account provenance", async () => {
    const pool = await runtimePool();
    const owner = await provisioned(pool, "owner");
    const other = await provisioned(pool, "other");

    await expect(
      createFirstProductionForUser(pool, { userId: other.user.id, title: "Steal", accountId: owner.personalAccount.id } as never),
    ).rejects.toMatchObject({ code: "PRODUCTION_INPUT_INVALID" });
    await expect(
      createFirstProductionForUser(pool, { userId: other.user.id, title: "Steal", creationEntitlementGrantId: owner.freeByoEntitlementGrant.id } as never),
    ).rejects.toMatchObject({ code: "PRODUCTION_INPUT_INVALID" });

    // The service always uses the trusted user's own account and grant.
    const own = await createFirstProductionForUser(pool, { userId: other.user.id, title: "Own" });
    expect(own.production).toMatchObject({ accountId: other.personalAccount.id, creationEntitlementGrantId: other.freeByoEntitlementGrant.id });

    await expect(
      pool.query(
        "INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id) VALUES ($1, 'Forged', $2, $3)",
        [other.personalAccount.id, owner.freeByoEntitlementGrant.id, other.user.id],
      ),
    ).rejects.toMatchObject({ code: "23503", constraint: "productions_creation_grant_same_account_fk" });
    expect(await accountCounts(owner.personalAccount.id)).toEqual({ productions: 0, audits: 0 });
  });

  it("K. a real PostgreSQL error at the audit insert rolls back the production; a later attempt succeeds", async () => {
    const pool = await runtimePool();
    const identity = await provisioned(pool, "rollback");
    const before = await grantRow(identity.freeByoEntitlementGrant.id);

    const failingPool: TransactionalPool = {
      ...pool,
      connect: async () => {
        const client = await pool.connect();
        const wrapped: RuntimeClient = {
          query: async <Row extends object>(sql: string, params?: unknown[]) =>
            sql.trim().startsWith("INSERT INTO audit_events")
              ? client.query<Row>("SELECT no_such_function_for_production_rollback()")
              : client.query<Row>(sql, params),
          release: client.release,
        };
        return wrapped;
      },
    };

    await expect(createFirstProductionForUser(failingPool, { userId: identity.user.id, title: "Rolled back", idempotencyKey: "k" })).rejects.toMatchObject({
      code: "PRODUCTION_DATABASE_FAILURE",
      databaseCode: "42883",
    });
    expect(await accountCounts(identity.personalAccount.id)).toEqual({ productions: 0, audits: 0 });
    expect(await grantRow(identity.freeByoEntitlementGrant.id)).toEqual(before);

    const retried = await createFirstProductionForUser(pool, { userId: identity.user.id, title: "Rolled back", idempotencyKey: "k" });
    expect(retried.created).toBe(true);
    expect(await accountCounts(identity.personalAccount.id)).toEqual({ productions: 1, audits: 1 });
  });

  it("L. the same idempotency key under two accounts never resolves across accounts", async () => {
    const pool = await runtimePool();
    const first = await provisioned(pool, "scope-a");
    const second = await provisioned(pool, "scope-b");

    const a = await createFirstProductionForUser(pool, { userId: first.user.id, title: "Same title", idempotencyKey: "shared" });
    const b = await createFirstProductionForUser(pool, { userId: second.user.id, title: "Same title", idempotencyKey: "shared" });

    expect(a.created && b.created).toBe(true);
    expect(b.production.id).not.toBe(a.production.id);
    expect(b.production.accountId).toBe(second.personalAccount.id);
    const replayA = await createFirstProductionForUser(pool, { userId: first.user.id, title: "Same title", idempotencyKey: "shared" });
    expect(replayA.production.id).toBe(a.production.id);
  });

  it("the runtime role still cannot delete a production to free the entitlement", async () => {
    const pool = await runtimePool();
    await expect(pool.query("DELETE FROM productions")).rejects.toMatchObject({ code: "42501" });
    await expect(pool.query("CREATE TABLE production_probe (id integer)")).rejects.toMatchObject({ code: "42501" });
  });
});
