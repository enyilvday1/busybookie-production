import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  expectSqlError,
  inRolledBackTransaction,
  insertAccountWithFreeGrant,
  openGuardedClients,
  prepareSchemaV1,
  type GuardedClients,
} from "./support/testDatabase.js";

// Migration 0008 invariants against PostgreSQL 16 (R44B11B). Runtime writes
// and owner probes run inside rolled-back transactions, so the suite leaves no
// rows. CLAIMED authorizations are fixtures created directly in the database:
// no issuance or claim service exists in this slice.

const CHECK = "23514";
const UNIQUE = "23505";
const FOREIGN_KEY = "23503";
const DENIED = "42501";

let clients: GuardedClients;

beforeAll(async () => {
  clients = await openGuardedClients();
  await prepareSchemaV1(clients);
});

afterAll(async () => {
  await clients.close();
});

type Lifecycle = "ISSUED" | "CLAIMED" | "CANCELLED" | "EXPIRED";
type Fixture = Readonly<{ userId: string; accountId: string; grantId: string; productionId: string; connectionId: string; versionId: string }>;

async function one(client: pg.Client, sql: string, params: unknown[]): Promise<string> {
  return (await client.query<{ id: string }>(sql, params)).rows[0]!.id;
}

async function insertProduction(client: pg.Client, owner: Omit<Fixture, "productionId" | "connectionId" | "versionId">): Promise<string> {
  return one(
    client,
    `INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id)
     VALUES ($1, 'Production', $2, $3) RETURNING id`,
    [owner.accountId, owner.grantId, owner.userId],
  );
}

async function fixture(client: pg.Client, subject: string): Promise<Fixture> {
  const owner = await insertAccountWithFreeGrant(client, subject);
  const productionId = await insertProduction(client, owner);
  const connectionId = await one(
    client,
    `INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id)
     VALUES ($1, 'EXAMPLE_PROVIDER', 'API_KEY', $2) RETURNING id`,
    [owner.accountId, owner.userId],
  );
  const versionId = await one(
    client,
    `INSERT INTO provider_credential_versions
       (account_id, provider_connection_id, credential_version, status, sealed_credential,
        fingerprint_algorithm, fingerprint_key_ref, fingerprint_value, created_by_user_id)
     VALUES ($1, $2, 1, 'ACTIVE', '{"format":"fixture-envelope"}'::jsonb, 'HMAC-SHA-256', 'fixture/v1', rpad($3, 43, 'A'), $4) RETURNING id`,
    [owner.accountId, connectionId, subject.replace(/[^A-Za-z0-9]/g, ""), owner.userId],
  );
  return { ...owner, productionId, connectionId, versionId };
}

// One authorization directly in the given lifecycle state, satisfying the 0003
// timestamp equivalences (EXPIRED needs expired_at >= expires_at).
async function insertAuthorization(client: pg.Client, f: Fixture, lifecycle: Lifecycle, productionId = f.productionId): Promise<string> {
  return one(
    client,
    `INSERT INTO generation_authorizations
       (account_id, production_id, entitlement_grant_id, billing_mode, provider, model, provider_connection_id,
        provider_credential_version_id, generation_request, generation_request_sha256, expected_cost_cap_unit,
        expected_cost_cap_amount, status, expires_at, claimed_at, expired_at, cancelled_at, created_by_user_id)
     VALUES ($1, $2, $3, 'USER_BYO', 'EXAMPLE_PROVIDER', 'example-model-1.0', $4, $5, '{"prompt":"fixture"}'::jsonb, repeat('c', 64),
             'MICRO_USD', 1000000, $6::text, now() + interval '15 minutes',
             CASE WHEN $6::text = 'CLAIMED' THEN now() END,
             CASE WHEN $6::text = 'EXPIRED' THEN now() + interval '20 minutes' END,
             CASE WHEN $6::text = 'CANCELLED' THEN now() END,
             $7)
     RETURNING id`,
    [f.accountId, productionId, f.grantId, f.connectionId, f.versionId, lifecycle, f.userId],
  );
}

const INSERT_USAGE = "INSERT INTO generation_usage_ledger (generation_authorization_id, account_id, production_id) VALUES ($1, $2, $3)";
const INSERT_USAGE_AT =
  "INSERT INTO generation_usage_ledger (generation_authorization_id, account_id, production_id, recorded_at) VALUES ($1, $2, $3, $4::timestamptz) RETURNING recorded_at";
const ADMISSION_REFUSED = "generation usage requires the exact CLAIMED generation authorization";

async function usageRows(client: pg.Client, authorizationId: string) {
  return (
    await client.query<{ generation_authorization_id: string; account_id: string; production_id: string }>(
      "SELECT generation_authorization_id, account_id, production_id FROM generation_usage_ledger WHERE generation_authorization_id = $1",
      [authorizationId],
    )
  ).rows;
}

// Asserts a statement fails with the SQLSTATE and message, without aborting
// the surrounding transaction.
async function expectRefused(client: pg.Client, sql: string, params: unknown[], code: string, message: string): Promise<void> {
  await client.query("SAVEPOINT expect_refused");
  try {
    await expect(client.query(sql, params)).rejects.toMatchObject({ code, message });
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expect_refused");
  }
}

describe("CLAIMED-state admission", () => {
  it("admits one row for the exact same-account, same-production CLAIMED authorization, readable by the runtime role", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "gul-claimed");
      const authorizationId = await insertAuthorization(clients.runtime, f, "CLAIMED");

      await clients.runtime.query(INSERT_USAGE, [authorizationId, f.accountId, f.productionId]);

      expect(await usageRows(clients.runtime, authorizationId)).toEqual([
        { generation_authorization_id: authorizationId, account_id: f.accountId, production_id: f.productionId },
      ]);
    });
  });

  it("observes the inserting transaction's own ISSUED -> CLAIMED transition, as the future claim transaction will", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "gul-claim-transaction");
      const authorizationId = await insertAuthorization(clients.runtime, f, "ISSUED");
      await expectRefused(clients.runtime, INSERT_USAGE, [authorizationId, f.accountId, f.productionId], CHECK, ADMISSION_REFUSED);

      await clients.runtime.query("SELECT id FROM generation_authorizations WHERE id = $1 AND status = 'ISSUED' FOR UPDATE", [authorizationId]);
      await clients.runtime.query("UPDATE generation_authorizations SET status = 'CLAIMED', claimed_at = now(), updated_at = now() WHERE id = $1", [
        authorizationId,
      ]);
      await clients.runtime.query(INSERT_USAGE, [authorizationId, f.accountId, f.productionId]);

      expect(await usageRows(clients.runtime, authorizationId)).toHaveLength(1);
    });
  });

  it.each(["ISSUED", "CANCELLED", "EXPIRED"] as const)("refuses usage for an %s authorization", async (lifecycle) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, `gul-${lifecycle.toLowerCase()}`);
      const authorizationId = await insertAuthorization(clients.runtime, f, lifecycle);
      const state = await clients.runtime.query("SELECT status, claimed_at FROM generation_authorizations WHERE id = $1", [authorizationId]);
      expect(state.rows).toEqual([{ status: lifecycle, claimed_at: null }]);

      await expectRefused(clients.runtime, INSERT_USAGE, [authorizationId, f.accountId, f.productionId], CHECK, ADMISSION_REFUSED);
      expect(await usageRows(clients.runtime, authorizationId)).toEqual([]);
    });
  });

  it("refuses a second canonical row for the same generation authorization through the primary key", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "gul-duplicate");
      const authorizationId = await insertAuthorization(clients.runtime, f, "CLAIMED");
      await clients.runtime.query(INSERT_USAGE, [authorizationId, f.accountId, f.productionId]);

      await expectSqlError(clients.runtime, INSERT_USAGE, [authorizationId, f.accountId, f.productionId], {
        code: UNIQUE,
        constraint: "generation_usage_ledger_pk",
      });
      expect(await usageRows(clients.runtime, authorizationId)).toHaveLength(1);
    });
  });

  it("refuses cross-account provenance", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "gul-account");
      const other = await fixture(clients.runtime, "gul-account-other");
      const authorizationId = await insertAuthorization(clients.runtime, f, "CLAIMED");
      const otherAuthorizationId = await insertAuthorization(clients.runtime, other, "CLAIMED");

      // Another account with its own production, and another account with this production.
      await expectRefused(clients.runtime, INSERT_USAGE, [authorizationId, other.accountId, other.productionId], CHECK, ADMISSION_REFUSED);
      await expectRefused(clients.runtime, INSERT_USAGE, [authorizationId, other.accountId, f.productionId], CHECK, ADMISSION_REFUSED);
      // This account's scope claiming another account's authorization.
      await expectRefused(clients.runtime, INSERT_USAGE, [otherAuthorizationId, f.accountId, f.productionId], CHECK, ADMISSION_REFUSED);
      expect(await usageRows(clients.runtime, authorizationId)).toEqual([]);
      expect(await usageRows(clients.runtime, otherAuthorizationId)).toEqual([]);
    });
  });

  it("refuses cross-production provenance within one account", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "gul-production");
      const secondProduction = await insertProduction(clients.runtime, f);
      const authorizationId = await insertAuthorization(clients.runtime, f, "CLAIMED");
      const secondAuthorizationId = await insertAuthorization(clients.runtime, f, "CLAIMED", secondProduction);

      await expectRefused(clients.runtime, INSERT_USAGE, [authorizationId, f.accountId, secondProduction], CHECK, ADMISSION_REFUSED);
      await expectRefused(clients.runtime, INSERT_USAGE, [secondAuthorizationId, f.accountId, f.productionId], CHECK, ADMISSION_REFUSED);
      expect(await usageRows(clients.runtime, authorizationId)).toEqual([]);
      expect(await usageRows(clients.runtime, secondAuthorizationId)).toEqual([]);
    });
  });

  it("refuses an unknown generation authorization", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "gul-unknown");
      await expectRefused(clients.runtime, INSERT_USAGE, ["00000000-0000-4000-8000-000000000000", f.accountId, f.productionId], CHECK, ADMISSION_REFUSED);
    });
  });

  it("keeps the composite foreign key live: a referenced authorization cannot be deleted, even by the owner", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const f = await fixture(clients.migrator, "gul-restrict");
      const authorizationId = await insertAuthorization(clients.migrator, f, "CLAIMED");
      await clients.migrator.query(INSERT_USAGE, [authorizationId, f.accountId, f.productionId]);

      await expectSqlError(clients.migrator, "DELETE FROM generation_authorizations WHERE id = $1", [authorizationId], {
        code: FOREIGN_KEY,
        constraint: "generation_usage_ledger_authorization_same_production_fk",
      });
      expect(await usageRows(clients.migrator, authorizationId)).toHaveLength(1);
    });
  });
});

describe("database-authored recorded_at", () => {
  it.each([
    ["backdated", "2000-01-01T00:00:00Z"],
    ["future-dated", "2999-01-01T00:00:00Z"],
  ])("overwrites a %s caller value with the database clock", async (_label, supplied) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, `gul-recorded-${supplied.slice(0, 4)}`);
      const authorizationId = await insertAuthorization(clients.runtime, f, "CLAIMED");
      // Let the wall clock move past the transaction start, so a transaction-stable value would be detectable.
      await clients.runtime.query("SELECT pg_sleep(0.02)");
      const before = (await clients.runtime.query<{ at: string }>("SELECT clock_timestamp()::text AS at")).rows[0]!.at;

      await clients.runtime.query(INSERT_USAGE_AT, [authorizationId, f.accountId, f.productionId, supplied]);

      const check = await clients.runtime.query(
        `SELECT recorded_at <> $2::timestamptz AS not_supplied,
                recorded_at >= $3::timestamptz AS not_before_insert,
                recorded_at <= clock_timestamp() AS not_future,
                recorded_at > now() AS after_transaction_start
           FROM generation_usage_ledger WHERE generation_authorization_id = $1`,
        [authorizationId, supplied, before],
      );
      expect(check.rows).toEqual([{ not_supplied: true, not_before_insert: true, not_future: true, after_transaction_start: true }]);
    });
  });

  it("sets recorded_at from the database clock when the caller omits it", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "gul-recorded-default");
      const authorizationId = await insertAuthorization(clients.runtime, f, "CLAIMED");
      const before = (await clients.runtime.query<{ at: string }>("SELECT clock_timestamp()::text AS at")).rows[0]!.at;

      await clients.runtime.query(INSERT_USAGE, [authorizationId, f.accountId, f.productionId]);

      const check = await clients.runtime.query(
        `SELECT recorded_at >= $2::timestamptz AND recorded_at <= clock_timestamp() AS database_clock
           FROM generation_usage_ledger WHERE generation_authorization_id = $1`,
        [authorizationId, before],
      );
      expect(check.rows).toEqual([{ database_clock: true }]);
    });
  });
});

describe("append-only enforcement", () => {
  it("refuses runtime UPDATE, DELETE and TRUNCATE by privilege", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "gul-runtime-mutation");
      const authorizationId = await insertAuthorization(clients.runtime, f, "CLAIMED");
      await clients.runtime.query(INSERT_USAGE, [authorizationId, f.accountId, f.productionId]);
      const denied = { code: DENIED };

      await expectSqlError(clients.runtime, "UPDATE generation_usage_ledger SET recorded_at = recorded_at WHERE generation_authorization_id = $1", [authorizationId], denied);
      await expectSqlError(clients.runtime, "DELETE FROM generation_usage_ledger WHERE generation_authorization_id = $1", [authorizationId], denied);
      await expectSqlError(clients.runtime, "TRUNCATE generation_usage_ledger", [], denied);
      expect(await usageRows(clients.runtime, authorizationId)).toHaveLength(1);
    });
  });

  it("refuses owner UPDATE, DELETE and TRUNCATE through the append-only guards, leaving the row intact", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const f = await fixture(clients.migrator, "gul-owner-mutation");
      const authorizationId = await insertAuthorization(clients.migrator, f, "CLAIMED");
      await clients.migrator.query(INSERT_USAGE, [authorizationId, f.accountId, f.productionId]);
      const before = await clients.migrator.query("SELECT * FROM generation_usage_ledger WHERE generation_authorization_id = $1", [authorizationId]);
      expect(before.rows).toHaveLength(1);

      for (const [sql, operation] of [
        ["UPDATE generation_usage_ledger SET recorded_at = recorded_at - interval '1 day' WHERE generation_authorization_id = $1", "UPDATE"],
        ["UPDATE generation_usage_ledger SET production_id = production_id WHERE generation_authorization_id = $1", "UPDATE"],
        ["DELETE FROM generation_usage_ledger WHERE generation_authorization_id = $1", "DELETE"],
      ] as const) {
        await expectRefused(clients.migrator, sql, [authorizationId], DENIED, `generation_usage_ledger is append-only: ${operation} rejected`);
      }
      await expectRefused(clients.migrator, "TRUNCATE generation_usage_ledger", [], DENIED, "generation_usage_ledger is append-only: TRUNCATE rejected");

      const after = await clients.migrator.query("SELECT * FROM generation_usage_ledger WHERE generation_authorization_id = $1", [authorizationId]);
      expect(after.rows).toEqual(before.rows);
    });
  });
});

describe("table shape", () => {
  it("holds exactly the four normalized columns: no copied provenance, execution identity, status or counter", async () => {
    const columns = await clients.runtime.query<{ attname: string }>(
      `SELECT attname FROM pg_attribute WHERE attrelid = 'public.generation_usage_ledger'::regclass AND attnum > 0 AND NOT attisdropped
        ORDER BY attnum`,
    );
    const names = columns.rows.map((row) => row.attname);
    expect(names).toEqual(["generation_authorization_id", "account_id", "production_id", "recorded_at"]);
    // Whole underscore-delimited identifier components only: account_id must
    // not match "count".
    const FORBIDDEN =
      /(^|_)(grant|billing|provider|model|connection|credential|request|sha256|cost|created_by|creator|job|execution|attempt|worker|lease|fencing|token|status|state|quota|balance|count|counter|amount)(_|$)/;
    expect(names.filter((name) => FORBIDDEN.test(name))).toEqual([]);
    // Guard the guard.
    expect(
      ["usage_count", "provider_id", "execution_attempt_id", "provider_execution_id", "lease_fencing_counter", "entitlement_grant_id", "status"].every(
        (name) => FORBIDDEN.test(name),
      ),
    ).toBe(true);
    expect(["generation_authorization_id", "account_id", "production_id", "recorded_at"].some((name) => FORBIDDEN.test(name))).toBe(false);
  });
});
