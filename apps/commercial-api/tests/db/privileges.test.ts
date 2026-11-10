import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RUNTIME_TABLE_PRIVILEGES } from "../../src/database/runtimeGrants.js";
import {
  expectSqlError,
  inRolledBackTransaction,
  insertAccountWithFreeGrant,
  openGuardedClients,
  prepareSchemaV1,
  type GuardedClients,
} from "./support/testDatabase.js";

const INSUFFICIENT_PRIVILEGE = "42501";
const TABLES = Object.keys(RUNTIME_TABLE_PRIVILEGES);

let clients: GuardedClients;

beforeAll(async () => {
  clients = await openGuardedClients();
  await prepareSchemaV1(clients);
});

afterAll(async () => {
  await clients.close();
});

async function runtimeHas(sql: string, params: readonly unknown[] = []): Promise<boolean> {
  const result = await clients.runtime.query<{ allowed: boolean }>(sql, params as unknown[]);
  return result.rows[0]?.allowed === true;
}

describe("runtime role authority", () => {
  it("has no schema, database or temporary-object creation authority", async () => {
    expect(await runtimeHas("SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS allowed")).toBe(false);
    expect(await runtimeHas("SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS allowed")).toBe(false);
    expect(await runtimeHas("SELECT has_database_privilege(current_user, current_database(), 'TEMP') AS allowed")).toBe(false);
    expect(await runtimeHas("SELECT has_schema_privilege(current_user, 'public', 'USAGE') AS allowed")).toBe(true);

    const attributes = await clients.runtime.query(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(attributes.rows).toEqual([
      { rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false },
    ]);
  });

  it("cannot run DDL", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      await expectSqlError(clients.runtime, "CREATE TABLE runtime_probe (id integer)", [], { code: INSUFFICIENT_PRIVILEGE });
      await expectSqlError(clients.runtime, "CREATE TEMP TABLE runtime_probe (id integer)", [], { code: INSUFFICIENT_PRIVILEGE });
      await expectSqlError(clients.runtime, "ALTER TABLE productions ADD COLUMN probe integer", [], { code: INSUFFICIENT_PRIVILEGE });
      await expectSqlError(clients.runtime, "DROP TABLE audit_events", [], { code: INSUFFICIENT_PRIVILEGE });
    });
  });

  it.each(TABLES)("holds exactly the manifest's table privileges on %s", async (table) => {
    const expected = RUNTIME_TABLE_PRIVILEGES[table]!;
    const privileges = await clients.runtime.query<Record<string, boolean>>(
      `SELECT has_table_privilege(current_user, $1, 'SELECT') AS select,
              has_table_privilege(current_user, $1, 'INSERT') AS insert,
              has_table_privilege(current_user, $1, 'UPDATE') AS table_update,
              has_table_privilege(current_user, $1, 'DELETE') AS delete,
              has_table_privilege(current_user, $1, 'TRUNCATE') AS truncate,
              has_table_privilege(current_user, $1, 'REFERENCES') AS references,
              has_table_privilege(current_user, $1, 'TRIGGER') AS trigger`,
      [`public.${table}`],
    );
    expect(privileges.rows[0]).toEqual({
      select: expected.select,
      insert: expected.insert,
      table_update: false,
      delete: false,
      truncate: false,
      references: false,
      trigger: false,
    });

    const updatable = await clients.runtime.query<{ attname: string }>(
      `SELECT attname FROM pg_attribute
        WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped
          AND has_column_privilege(current_user, attrelid, attnum, 'UPDATE')
        ORDER BY attname`,
      [`public.${table}`],
    );
    expect(updatable.rows.map((row) => row.attname)).toEqual([...expected.updateColumns].sort());
  });

  it("can perform the reads and writes future repositories need", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const { userId, accountId, grantId } = await insertAccountWithFreeGrant(clients.runtime, "runtime-writes");

      const locked = await clients.runtime.query("SELECT id FROM entitlement_grants WHERE id = $1 FOR UPDATE", [grantId]);
      expect(locked.rowCount).toBe(1);
      await clients.runtime.query("SELECT id FROM accounts WHERE id = $1 FOR NO KEY UPDATE", [accountId]);

      const production = await clients.runtime.query<{ id: string }>(
        `INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id)
         VALUES ($1, 'First production', $2, $3) RETURNING id`,
        [accountId, grantId, userId],
      );
      await clients.runtime.query("UPDATE productions SET title = 'Renamed', updated_at = now() WHERE id = $1", [
        production.rows[0]!.id,
      ]);
      await clients.runtime.query("UPDATE users SET email = 'person@example.test', email_verified = true WHERE id = $1", [userId]);
      await clients.runtime.query(
        "UPDATE entitlement_grants SET state = 'CONSUMED', consumed_at = now(), updated_at = now() WHERE id = $1",
        [grantId],
      );
      await clients.runtime.query(
        `INSERT INTO audit_events (account_id, actor_type, actor_user_id, event_type, resource_type, resource_id, correlation_id)
         VALUES ($1, 'USER', $2, 'production.created', 'production', $3, gen_random_uuid())`,
        [accountId, userId, production.rows[0]!.id],
      );
      const audit = await clients.runtime.query("SELECT sequence FROM audit_events WHERE account_id = $1", [accountId]);
      expect(audit.rowCount).toBe(1);

      const version = await clients.runtime.query("SELECT max(version) AS version FROM schema_migrations");
      expect(version.rows).toEqual([{ version: 1 }]);
    });
  });

  it("cannot delete, change ownership or provenance, or alter migration records", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const { userId, accountId, grantId } = await insertAccountWithFreeGrant(clients.runtime, "runtime-denials");
      const other = await insertAccountWithFreeGrant(clients.runtime, "runtime-denials-other");
      const production = await clients.runtime.query<{ id: string }>(
        `INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id)
         VALUES ($1, 'Owned', $2, $3) RETURNING id`,
        [accountId, grantId, userId],
      );
      const productionId = production.rows[0]!.id;
      const denied = { code: INSUFFICIENT_PRIVILEGE };

      await expectSqlError(clients.runtime, "DELETE FROM productions WHERE id = $1", [productionId], denied);
      await expectSqlError(clients.runtime, "DELETE FROM users WHERE id = $1", [userId], denied);
      await expectSqlError(clients.runtime, "UPDATE productions SET account_id = $1 WHERE id = $2", [other.accountId, productionId], denied);
      await expectSqlError(
        clients.runtime,
        "UPDATE productions SET creation_entitlement_grant_id = $1 WHERE id = $2",
        [other.grantId, productionId],
        denied,
      );
      await expectSqlError(clients.runtime, "UPDATE accounts SET owner_user_id = $1 WHERE id = $2", [other.userId, accountId], denied);
      await expectSqlError(clients.runtime, "UPDATE entitlement_grants SET kind = 'FREE_BYO', account_id = $1 WHERE id = $2", [
        other.accountId,
        grantId,
      ], denied);
      await expectSqlError(clients.runtime, "UPDATE users SET idp_subject = 'taken-over' WHERE id = $1", [userId], denied);
      await expectSqlError(clients.runtime, "TRUNCATE productions", [], denied);
      await expectSqlError(clients.runtime, "DELETE FROM schema_migrations", [], denied);
      await expectSqlError(clients.runtime, "UPDATE schema_migrations SET sha256 = repeat('0', 64)", [], denied);
      await expectSqlError(
        clients.runtime,
        "INSERT INTO schema_migrations (version, name, sha256) VALUES (99, 'injected', repeat('0', 64))",
        [],
        denied,
      );
    });
  });

  it("can insert and read audit events but never update, delete or truncate them", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const inserted = await clients.runtime.query<{ id: string }>(
        `INSERT INTO audit_events (actor_type, event_type, resource_type, resource_id, correlation_id)
         VALUES ('SYSTEM', 'user.provisioned', 'user', gen_random_uuid(), gen_random_uuid()) RETURNING id`,
      );
      const id = inserted.rows[0]!.id;
      const denied = { code: INSUFFICIENT_PRIVILEGE };

      await expectSqlError(clients.runtime, "UPDATE audit_events SET event_type = 'user.disabled' WHERE id = $1", [id], denied);
      await expectSqlError(clients.runtime, "DELETE FROM audit_events WHERE id = $1", [id], denied);
      await expectSqlError(clients.runtime, "TRUNCATE audit_events", [], denied);
      expect((await clients.runtime.query("SELECT id FROM audit_events WHERE id = $1", [id])).rowCount).toBe(1);
    });
  });
});

describe("audit immutability trigger", () => {
  it("rejects UPDATE, DELETE and TRUNCATE even for the table owner", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const inserted = await clients.migrator.query<{ id: string }>(
        `INSERT INTO audit_events (actor_type, event_type, resource_type, resource_id, correlation_id)
         VALUES ('SYSTEM', 'user.provisioned', 'user', gen_random_uuid(), gen_random_uuid()) RETURNING id`,
      );
      const id = inserted.rows[0]!.id;

      for (const sql of [
        "UPDATE audit_events SET event_type = 'user.disabled' WHERE id = $1",
        "DELETE FROM audit_events WHERE id = $1",
      ]) {
        await clients.migrator.query("SAVEPOINT trigger_probe");
        await expect(clients.migrator.query(sql, [id])).rejects.toMatchObject({
          code: INSUFFICIENT_PRIVILEGE,
          message: expect.stringContaining("audit_events is append-only"),
        });
        await clients.migrator.query("ROLLBACK TO SAVEPOINT trigger_probe");
      }

      await clients.migrator.query("SAVEPOINT trigger_probe");
      await expect(clients.migrator.query("TRUNCATE audit_events")).rejects.toMatchObject({
        message: "audit_events is append-only: TRUNCATE rejected",
      });
      await clients.migrator.query("ROLLBACK TO SAVEPOINT trigger_probe");
    });
  });
});
