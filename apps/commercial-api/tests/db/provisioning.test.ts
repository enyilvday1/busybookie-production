import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type RuntimeClient, type TransactionalPool } from "../../src/database/runtimePool.js";
import { ProvisioningError } from "../../src/provisioning/provisioningError.js";
import {
  provisionPersonalAccountForIdentity,
  type VerifiedIdentity,
} from "../../src/provisioning/provisionPersonalAccountForIdentity.js";
import { openGuardedClients, prepareSchemaV1, type GuardedClients } from "./support/testDatabase.js";

// Provisioning commits real rows as the restricted runtime role. The suite
// starts from, and is restored to, a pristine schema v1 (no domain rows).

const ISSUER = "https://issuer.provisioning.test/";
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

const uniqueIdentity = (label: string, email?: VerifiedIdentity["email"]): VerifiedIdentity => {
  const subject = `${label}-${randomUUID()}`;
  return email === undefined ? { issuer: ISSUER, subject } : { issuer: ISSUER, subject, email };
};

// Counts from the migration owner's view, scoped to one identity.
async function countsFor(identity: VerifiedIdentity) {
  const result = await clients.migrator.query<{ users: number; accounts: number; grants: number; audits: number }>(
    `WITH u AS (SELECT id FROM users WHERE idp_issuer = $1 AND idp_subject = $2),
          a AS (SELECT id FROM accounts WHERE owner_user_id IN (SELECT id FROM u) AND kind = 'PERSONAL'),
          g AS (SELECT id FROM entitlement_grants WHERE account_id IN (SELECT id FROM a)
                  AND kind = 'FREE_BYO' AND source = 'ACCOUNT_PROVISIONING')
     SELECT (SELECT count(*)::int FROM u) AS users,
            (SELECT count(*)::int FROM a) AS accounts,
            (SELECT count(*)::int FROM g) AS grants,
            (SELECT count(*)::int FROM audit_events
              WHERE resource_id IN (SELECT id FROM u UNION ALL SELECT id FROM a UNION ALL SELECT id FROM g)) AS audits`,
    [identity.issuer, identity.subject],
  );
  return result.rows[0]!;
}

// All parties hold a checked-out session before any of them begins its
// transaction, so the provisioning transactions genuinely race.
function withBarrier(pool: TransactionalPool, barrier: { arrive: () => Promise<void> }): TransactionalPool {
  return {
    ...pool,
    connect: async () => {
      const client = await pool.connect();
      await barrier.arrive();
      return client;
    },
  };
}

function createBarrier(parties: number) {
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  return {
    arrive: async () => {
      arrived += 1;
      if (arrived === parties) open();
      await gate;
    },
  };
}

describe("provisioning against PostgreSQL 16 as the runtime role", () => {
  it("runs as the restricted runtime role, which still cannot run DDL", async () => {
    const pool = await runtimePool();
    const identity = await pool.query<{ user: string }>("SELECT current_user AS user");
    expect(identity.rows).toEqual([{ user: "busybookie_commercial_test_runtime" }]);
    await expect(pool.query("CREATE TABLE provisioning_probe (id integer)")).rejects.toMatchObject({ code: "42501" });
    await expect(pool.query("DELETE FROM users")).rejects.toMatchObject({ code: "42501" });
  });

  it("A. first provisioning creates exactly one user, PERSONAL account and initial FREE_BYO grant, with audit events", async () => {
    const pool = await runtimePool();
    const identity = uniqueIdentity("first", { address: "first@example.test", verified: true });

    const result = await provisionPersonalAccountForIdentity(pool, identity);

    expect(result.created).toEqual({ user: true, personalAccount: true, freeByoEntitlementGrant: true });
    expect(await countsFor(identity)).toEqual({ users: 1, accounts: 1, grants: 1, audits: 3 });

    const grant = await clients.migrator.query(
      "SELECT kind, state, source, issuance_key, policy_version FROM entitlement_grants WHERE id = $1",
      [result.freeByoEntitlementGrant.id],
    );
    expect(grant.rows).toEqual([
      { kind: "FREE_BYO", state: "AVAILABLE", source: "ACCOUNT_PROVISIONING", issuance_key: "account-provisioning", policy_version: "free-byo-v1" },
    ]);

    const audits = await clients.migrator.query<{ event_type: string; actor_type: string; actor_user_id: string; account_id: string; correlation_id: string; metadata: object }>(
      "SELECT event_type, actor_type, actor_user_id, account_id, correlation_id, metadata FROM audit_events WHERE correlation_id = $1 ORDER BY sequence",
      [result.correlationId],
    );
    expect(audits.rows.map((row) => row.event_type)).toEqual(["user.provisioned", "account.provisioned", "entitlement_grant.issued"]);
    for (const row of audits.rows) {
      expect(row).toMatchObject({ actor_type: "USER", actor_user_id: result.user.id, account_id: result.personalAccount.id });
      expect(JSON.stringify(row.metadata)).not.toContain("first@example.test");
    }
  });

  it("B. sequential repeats return the same IDs and leave counts at 1/1/1", async () => {
    const pool = await runtimePool();
    const identity = uniqueIdentity("sequential");
    const first = await provisionPersonalAccountForIdentity(pool, identity);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const again = await provisionPersonalAccountForIdentity(pool, identity);
      expect([again.user.id, again.personalAccount.id, again.freeByoEntitlementGrant.id]).toEqual([
        first.user.id,
        first.personalAccount.id,
        first.freeByoEntitlementGrant.id,
      ]);
      expect(again.created).toEqual({ user: false, personalAccount: false, freeByoEntitlementGrant: false });
    }
    expect(await countsFor(identity)).toEqual({ users: 1, accounts: 1, grants: 1, audits: 3 });
  });

  it("C. 20 concurrent calls from two independent pools converge on one user, account and grant", async () => {
    const poolA = await runtimePool(10);
    const poolB = await runtimePool(10);

    for (let round = 0; round < 3; round += 1) {
      const identity = uniqueIdentity(`concurrent-${round}`);
      const barrier = createBarrier(20);
      const racingA = withBarrier(poolA, barrier);
      const racingB = withBarrier(poolB, barrier);

      const results = await Promise.all(
        Array.from({ length: 20 }, (_unused, index) => provisionPersonalAccountForIdentity(index % 2 === 0 ? racingA : racingB, identity)),
      );

      expect(new Set(results.map((result) => result.user.id)).size).toBe(1);
      expect(new Set(results.map((result) => result.personalAccount.id)).size).toBe(1);
      expect(new Set(results.map((result) => result.freeByoEntitlementGrant.id)).size).toBe(1);
      // Exactly one caller created each record; the other 19 resolved it through conflict handling.
      expect(results.filter((result) => result.created.user)).toHaveLength(1);
      expect(results.filter((result) => result.created.personalAccount)).toHaveLength(1);
      expect(results.filter((result) => result.created.freeByoEntitlementGrant)).toHaveLength(1);
      expect(await countsFor(identity)).toEqual({ users: 1, accounts: 1, grants: 1, audits: 3 });
    }
  });

  it("D. identities sharing an email, or a subject under different issuers, stay distinct", async () => {
    const pool = await runtimePool();
    const email = { address: `shared-${randomUUID()}@example.test`, verified: true };
    const one = await provisionPersonalAccountForIdentity(pool, uniqueIdentity("email-a", email));
    const two = await provisionPersonalAccountForIdentity(pool, uniqueIdentity("email-b", email));

    expect(new Set([one.user.id, two.user.id]).size).toBe(2);
    expect(new Set([one.personalAccount.id, two.personalAccount.id]).size).toBe(2);
    expect(new Set([one.freeByoEntitlementGrant.id, two.freeByoEntitlementGrant.id]).size).toBe(2);

    const subject = `shared-subject-${randomUUID()}`;
    const issuerOne = await provisionPersonalAccountForIdentity(pool, { issuer: "https://issuer-one.provisioning.test", subject });
    const issuerTwo = await provisionPersonalAccountForIdentity(pool, { issuer: "https://issuer-two.provisioning.test", subject });
    expect(issuerTwo.user.id).not.toBe(issuerOne.user.id);
    expect(issuerTwo.personalAccount.id).not.toBe(issuerOne.personalAccount.id);
    expect(issuerTwo.freeByoEntitlementGrant.id).not.toBe(issuerOne.freeByoEntitlementGrant.id);
  });

  it.each([
    ["REVOKED", "revoked_at"],
    ["CONSUMED", "consumed_at"],
    ["EXPIRED", "expired_at"],
  ])("E. an existing grant in state %s is returned unchanged and never re-issued", async (state, timestampColumn) => {
    const pool = await runtimePool();
    const identity = uniqueIdentity(`grant-${state.toLowerCase()}`);
    const first = await provisionPersonalAccountForIdentity(pool, identity);
    await pool.query(`UPDATE entitlement_grants SET state = $1, ${timestampColumn} = now(), updated_at = now() WHERE id = $2`, [
      state,
      first.freeByoEntitlementGrant.id,
    ]);
    const before = await clients.migrator.query("SELECT updated_at FROM entitlement_grants WHERE id = $1", [first.freeByoEntitlementGrant.id]);

    const again = await provisionPersonalAccountForIdentity(pool, identity);

    expect(again.freeByoEntitlementGrant).toMatchObject({ id: first.freeByoEntitlementGrant.id, state });
    expect(again.created.freeByoEntitlementGrant).toBe(false);
    expect(await countsFor(identity)).toEqual({ users: 1, accounts: 1, grants: 1, audits: 3 });
    const after = await clients.migrator.query("SELECT state, updated_at FROM entitlement_grants WHERE id = $1", [first.freeByoEntitlementGrant.id]);
    expect(after.rows[0]).toEqual({ state, updated_at: before.rows[0].updated_at });
  });

  it("completes legitimately partial state without duplicating anything", async () => {
    const pool = await runtimePool();

    const userOnly = uniqueIdentity("partial-user");
    const inserted = await pool.query<{ id: string }>("INSERT INTO users (idp_issuer, idp_subject) VALUES ($1, $2) RETURNING id", [
      userOnly.issuer,
      userOnly.subject,
    ]);
    const completed = await provisionPersonalAccountForIdentity(pool, userOnly);
    expect(completed.user.id).toBe(inserted.rows[0]!.id);
    expect(completed.created).toEqual({ user: false, personalAccount: true, freeByoEntitlementGrant: true });
    expect(await countsFor(userOnly)).toEqual({ users: 1, accounts: 1, grants: 1, audits: 2 });

    const userAndAccount = uniqueIdentity("partial-account");
    const user = await pool.query<{ id: string }>("INSERT INTO users (idp_issuer, idp_subject) VALUES ($1, $2) RETURNING id", [
      userAndAccount.issuer,
      userAndAccount.subject,
    ]);
    const account = await pool.query<{ id: string }>("INSERT INTO accounts (kind, owner_user_id) VALUES ('PERSONAL', $1) RETURNING id", [
      user.rows[0]!.id,
    ]);
    const finished = await provisionPersonalAccountForIdentity(pool, userAndAccount);
    expect(finished.personalAccount.id).toBe(account.rows[0]!.id);
    expect(finished.created).toEqual({ user: false, personalAccount: false, freeByoEntitlementGrant: true });
    expect(await countsFor(userAndAccount)).toEqual({ users: 1, accounts: 1, grants: 1, audits: 1 });
  });

  it("refreshes a changed email claim and never erases a stored email", async () => {
    const pool = await runtimePool();
    const identity = uniqueIdentity("email-refresh", { address: "old@example.test", verified: false });
    await provisionPersonalAccountForIdentity(pool, identity);

    const refreshed = await provisionPersonalAccountForIdentity(pool, { ...identity, email: { address: "new@example.test", verified: true } });
    expect(refreshed.user).toMatchObject({ email: "new@example.test", emailVerified: true });

    const withoutEmail = await provisionPersonalAccountForIdentity(pool, { issuer: identity.issuer, subject: identity.subject });
    expect(withoutEmail.user).toMatchObject({ email: "new@example.test", emailVerified: true });
  });

  it("refuses a disabled user and creates nothing for it", async () => {
    const pool = await runtimePool();
    const identity = uniqueIdentity("disabled");
    await pool.query("INSERT INTO users (idp_issuer, idp_subject, status, disabled_at) VALUES ($1, $2, 'DISABLED', now())", [
      identity.issuer,
      identity.subject,
    ]);

    const attempt = provisionPersonalAccountForIdentity(pool, identity);
    await expect(attempt).rejects.toBeInstanceOf(ProvisioningError);
    await expect(attempt).rejects.toMatchObject({ code: "PROVISIONING_REFUSED", reason: "USER_DISABLED" });
    expect(await countsFor(identity)).toEqual({ users: 1, accounts: 0, grants: 0, audits: 0 });
  });

  it("F. a real PostgreSQL error late in the transaction rolls back every earlier insert", async () => {
    const pool = await runtimePool();
    const identity = uniqueIdentity("rollback");
    let auditInserts = 0;

    // Replace the third audit insert (after user, account and grant inserts and
    // two audit inserts) with SQL that PostgreSQL itself rejects.
    const failingPool: TransactionalPool = {
      ...pool,
      connect: async () => {
        const client = await pool.connect();
        const wrapped: RuntimeClient = {
          query: async <Row extends object>(sql: string, params?: unknown[]) => {
            if (sql.trim().startsWith("INSERT INTO audit_events") && ++auditInserts === 3) {
              return client.query<Row>("SELECT no_such_function_for_rollback_test()");
            }
            return client.query<Row>(sql, params);
          },
          release: client.release,
        };
        return wrapped;
      },
    };

    const attempt = provisionPersonalAccountForIdentity(failingPool, identity);
    await expect(attempt).rejects.toMatchObject({ code: "PROVISIONING_DATABASE_FAILURE", databaseCode: "42883" });
    expect(auditInserts).toBe(3);
    expect(await countsFor(identity)).toEqual({ users: 0, accounts: 0, grants: 0, audits: 0 });

    // The released session is clean and reusable: the same identity now provisions normally.
    const recovered = await provisionPersonalAccountForIdentity(pool, identity);
    expect(recovered.created).toEqual({ user: true, personalAccount: true, freeByoEntitlementGrant: true });
  });
});
