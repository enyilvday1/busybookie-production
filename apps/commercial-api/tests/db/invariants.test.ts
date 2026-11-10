import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  expectSqlError,
  inRolledBackTransaction,
  insertAccountWithFreeGrant,
  openGuardedClients,
  prepareSchemaV1,
  type GuardedClients,
} from "./support/testDatabase.js";

// All rows are written as the restricted runtime role inside rolled-back
// transactions, so the suite proves constraints under real application
// permissions and leaves the database empty.

const UNIQUE = "23505";
const FOREIGN_KEY = "23503";
const NOT_NULL = "23502";
const CHECK = "23514";

let clients: GuardedClients;

beforeAll(async () => {
  clients = await openGuardedClients();
  await prepareSchemaV1(clients);
});

afterAll(async () => {
  await clients.close();
});

function insertProduction(accountId: string, grantId: string | null, userId: string, title = "A production", key: string | null = null) {
  return [
    `INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id, creation_idempotency_key)
     VALUES ($1, $2, $3, $4, $5)`,
    [accountId, title, grantId, userId, key],
  ] as const;
}

const insertGrant = `INSERT INTO entitlement_grants (account_id, kind, state, source, issuance_key, policy_version)
                     VALUES ($1, $2, 'AVAILABLE', 'ACCOUNT_PROVISIONING', $3, 'test-policy')`;

describe("structural tenancy", () => {
  it("rejects a production under another account's grant", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "tenancy-owner");
      const intruder = await insertAccountWithFreeGrant(clients.runtime, "tenancy-intruder");

      const [sql, params] = insertProduction(intruder.accountId, owner.grantId, intruder.userId);
      await expectSqlError(clients.runtime, sql, params, {
        code: FOREIGN_KEY,
        constraint: "productions_creation_grant_same_account_fk",
      });
    });
  });

  it("requires creation-grant provenance on every production", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "provenance");
      const [sql, params] = insertProduction(owner.accountId, null, owner.userId);
      await expectSqlError(clients.runtime, sql, params, { code: NOT_NULL });
    });
  });

  it("permits many productions per account", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "cardinality");
      for (const title of ["First", "Second", "Third"]) {
        const [sql, params] = insertProduction(owner.accountId, owner.grantId, owner.userId, title);
        await clients.runtime.query(sql, [...params]);
      }
      const count = await clients.runtime.query("SELECT count(*)::int AS count FROM productions WHERE account_id = $1", [owner.accountId]);
      expect(count.rows).toEqual([{ count: 3 }]);
    });
  });
});

describe("initial FREE_BYO uniqueness", () => {
  it("rejects a second account-provisioned FREE_BYO even with a different issuance key", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "free-byo-duplicate");
      await expectSqlError(clients.runtime, insertGrant, [owner.accountId, "FREE_BYO", "another-key"], {
        code: UNIQUE,
        constraint: "entitlement_grants_initial_free_byo_uq",
      });
    });
  });

  it("rejects a replay of the same issuance", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "free-byo-replay");
      await expectSqlError(clients.runtime, insertGrant, [owner.accountId, "FREE_BYO", "account-provisioning"], { code: UNIQUE });
    });
  });

  it.each([
    ["CONSUMED", "consumed_at"],
    ["REVOKED", "revoked_at"],
    ["EXPIRED", "expired_at"],
    ["RESERVED", "reserved_at"],
  ])("does not reopen eligibility after the grant becomes %s", async (state, timestampColumn) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, `free-byo-${state.toLowerCase()}`);
      await clients.runtime.query(
        `UPDATE entitlement_grants SET state = $1, ${timestampColumn} = now(), updated_at = now() WHERE id = $2`,
        [state, owner.grantId],
      );
      await expectSqlError(clients.runtime, insertGrant, [owner.accountId, "FREE_BYO", "after-transition"], {
        code: UNIQUE,
        constraint: "entitlement_grants_initial_free_byo_uq",
      });
    });
  });

  it.each(["HOSTED_TRIAL", "CREATOR"])("refuses to issue %s in schema v1", async (kind) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, `issuable-${kind.toLowerCase()}`);
      await expectSqlError(clients.runtime, insertGrant, [owner.accountId, kind, "promotion"], {
        code: CHECK,
        constraint: "entitlement_grants_v1_issuable_kind_ck",
      });
    });
  });

  it.each([
    ["RESERVED", "entitlement_grants_reserved_at_ck"],
    ["CONSUMED", "entitlement_grants_consumed_at_ck"],
    ["REVOKED", "entitlement_grants_revoked_at_ck"],
    ["EXPIRED", "entitlement_grants_expired_at_ck"],
  ])("requires the transition timestamp for %s", async (state, constraint) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, `timestamp-${state.toLowerCase()}`);
      await expectSqlError(clients.runtime, "UPDATE entitlement_grants SET state = $1 WHERE id = $2", [state, owner.grantId], {
        code: CHECK,
        constraint,
      });
    });
  });
});

describe("identity and account invariants", () => {
  it("identifies users by issuer and subject, never by email", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const insertUser = "INSERT INTO users (idp_issuer, idp_subject, email) VALUES ($1, $2, $3)";
      await clients.runtime.query(insertUser, ["https://issuer.test", "subject-a", "shared@example.test"]);
      await clients.runtime.query(insertUser, ["https://issuer.test", "subject-b", "shared@example.test"]);
      await clients.runtime.query(insertUser, ["https://other-issuer.test", "subject-a", null]);
      await expectSqlError(clients.runtime, insertUser, ["https://issuer.test", "subject-a", null], {
        code: UNIQUE,
        constraint: "users_idp_identity_uq",
      });
      await expectSqlError(clients.runtime, insertUser, ["https://issuer.test", "   ", null], {
        code: CHECK,
        constraint: "users_idp_subject_ck",
      });
      await expectSqlError(clients.runtime, "INSERT INTO users (idp_issuer, idp_subject, status) VALUES ('i', 's-disabled', 'DISABLED')", [], {
        code: CHECK,
        constraint: "users_disabled_ck",
      });
    });
  });

  it("allows one PERSONAL account per user and no TEAM accounts yet", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "personal-account");
      await expectSqlError(clients.runtime, "INSERT INTO accounts (kind, owner_user_id) VALUES ('PERSONAL', $1)", [owner.userId], {
        code: UNIQUE,
        constraint: "accounts_personal_owner_uq",
      });
      await expectSqlError(clients.runtime, "INSERT INTO accounts (kind, owner_user_id) VALUES ('TEAM', $1)", [owner.userId], {
        code: CHECK,
        constraint: "accounts_kind_ck",
      });
    });
  });
});

describe("production invariants", () => {
  it.each([
    ["an empty title", ""],
    ["a whitespace-only title", "   "],
    ["a leading space", " Leading"],
    ["a trailing tab", "Trailing\t"],
    ["a 201-character title", "x".repeat(201)],
  ])("rejects %s", async (_label, title) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, `title-${title.length}-${title.charCodeAt(0) || 0}`);
      const [sql, params] = insertProduction(owner.accountId, owner.grantId, owner.userId, title);
      await expectSqlError(clients.runtime, sql, params, { code: CHECK, constraint: "productions_title_ck" });
    });
  });

  it("accepts a trimmed 200-character title", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "title-200");
      const [sql, params] = insertProduction(owner.accountId, owner.grantId, owner.userId, "x".repeat(200));
      await clients.runtime.query(sql, [...params]);
    });
  });

  it("scopes creation idempotency keys to the account", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const first = await insertAccountWithFreeGrant(clients.runtime, "idempotency-first");
      const second = await insertAccountWithFreeGrant(clients.runtime, "idempotency-second");

      const [sql, params] = insertProduction(first.accountId, first.grantId, first.userId, "One", "request-1");
      await clients.runtime.query(sql, [...params]);
      const [otherSql, otherParams] = insertProduction(second.accountId, second.grantId, second.userId, "One", "request-1");
      await clients.runtime.query(otherSql, [...otherParams]);

      const [dupSql, dupParams] = insertProduction(first.accountId, first.grantId, first.userId, "Two", "request-1");
      await expectSqlError(clients.runtime, dupSql, dupParams, { code: UNIQUE, constraint: "productions_creation_idempotency_key_uq" });
    });
  });
});

describe("audit event invariants", () => {
  const insertAudit = `INSERT INTO audit_events (actor_type, actor_user_id, event_type, resource_type, resource_id, correlation_id, metadata)
                       VALUES ($1, $2, $3, 'user', gen_random_uuid(), gen_random_uuid(), $4::jsonb)`;

  it.each([
    ["a non-object metadata value", ["SYSTEM", null, "user.provisioned", "[]"], "audit_events_metadata_ck"],
    ["oversized metadata", ["SYSTEM", null, "user.provisioned", JSON.stringify({ note: "x".repeat(5000) })], "audit_events_metadata_ck"],
    ["a malformed event type", ["SYSTEM", null, "UserProvisioned", "{}"], "audit_events_event_type_ck"],
    ["a USER actor without a user", ["USER", null, "user.provisioned", "{}"], "audit_events_actor_ck"],
  ])("rejects %s", async (_label, params, constraint) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      await expectSqlError(clients.runtime, insertAudit, params, { code: CHECK, constraint });
    });
  });

  it("assigns increasing navigation sequence numbers", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const first = await clients.runtime.query<{ sequence: string }>(`${insertAudit} RETURNING sequence`, [
        "SYSTEM",
        null,
        "user.provisioned",
        "{}",
      ]);
      const second = await clients.runtime.query<{ sequence: string }>(`${insertAudit} RETURNING sequence`, [
        "SYSTEM",
        null,
        "account.provisioned",
        '{"from":"NONE","to":"ACTIVE"}',
      ]);
      expect(BigInt(second.rows[0]!.sequence)).toBeGreaterThan(BigInt(first.rows[0]!.sequence));
    });
  });
});
