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

async function insertClaimedUsageEventFixture(): Promise<string> {
  const { userId, accountId, grantId } = await insertAccountWithFreeGrant(
    clients.migrator,
    "usage-events-owner",
  );

  const production = await clients.migrator.query<{ id: string }>(
    `INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id)
     VALUES ($1, 'Usage event immutability', $2, $3) RETURNING id`,
    [accountId, grantId, userId],
  );
  const productionId = production.rows[0]!.id;

  const connection = await clients.migrator.query<{ id: string }>(
    `INSERT INTO provider_connections
       (account_id, provider, credential_kind, status, verification_status,
        last_verification_attempt_at, verified_at, created_by_user_id)
     VALUES ($1, 'GOOGLE_GENAI', 'API_KEY', 'ACTIVE', 'VERIFIED',
             clock_timestamp(), clock_timestamp(), $2)
     RETURNING id`,
    [accountId, userId],
  );
  const connectionId = connection.rows[0]!.id;

  const credential = await clients.migrator.query<{ id: string }>(
    `INSERT INTO provider_credential_versions
       (account_id, provider_connection_id, credential_version, status,
        sealed_credential, fingerprint_algorithm, fingerprint_key_ref,
        fingerprint_value, created_by_user_id)
     VALUES ($1, $2, 1, 'ACTIVE',
             '{"format":"fixture-envelope"}'::jsonb, 'HMAC-SHA-256',
             'fixture/v1', repeat('a', 43), $3)
     RETURNING id`,
    [accountId, connectionId, userId],
  );
  const credentialId = credential.rows[0]!.id;

  const authorization = await clients.migrator.query<{ id: string }>(
    `INSERT INTO generation_authorizations
       (account_id, production_id, entitlement_grant_id, billing_mode,
        provider, model, provider_connection_id, provider_credential_version_id,
        generation_request, generation_request_sha256,
        expected_cost_cap_unit, expected_cost_cap_amount,
        status, expires_at, claimed_at, created_by_user_id, created_at)
     VALUES ($1, $2, $3, 'USER_BYO',
             'GOOGLE_GENAI', 'gemini-omni-1.1-flash', $4, $5,
             '{"prompt":"owner-immutability"}'::jsonb, repeat('a', 64),
             'MICRO_USD', 1,
             'CLAIMED', clock_timestamp() + interval '1 hour',
             clock_timestamp(), $6, clock_timestamp() - interval '1 hour')
     RETURNING id`,
    [accountId, productionId, grantId, connectionId, credentialId, userId],
  );
  const authorizationId = authorization.rows[0]!.id;

  await clients.migrator.query(
    `INSERT INTO generation_usage_ledger
       (generation_authorization_id, account_id, production_id)
     VALUES ($1, $2, $3)`,
    [authorizationId, accountId, productionId],
  );

  const event = await clients.migrator.query<{ generation_authorization_id: string; db_owned: boolean }>(
    `INSERT INTO generation_usage_events
       (generation_authorization_id, event_type, reason_code, recorded_at)
     VALUES ($1, 'CANCELLED_BEFORE_SUBMISSION', 'PROVIDER_CONNECTION_DISCONNECTED',
             '2000-01-01T00:00:00Z'::timestamptz)
     RETURNING generation_authorization_id,
               recorded_at <> '2000-01-01T00:00:00Z'::timestamptz AS db_owned`,
    [authorizationId],
  );
  expect(event.rows).toEqual([{ generation_authorization_id: authorizationId, db_owned: true }]);

  return authorizationId;
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
      expect(version.rows).toEqual([{ version: 10 }]);
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

  it("has no UPDATE on submission-authority provenance: only the database guard derives it (migration 0005)", async () => {
    const privileges = await clients.runtime.query(
      `SELECT has_column_privilege(current_user, 'public.execution_attempts', 'submitting_worker_principal_id', 'UPDATE') AS update,
              has_column_privilege(current_user, 'public.execution_attempts', 'submitting_worker_principal_id', 'SELECT') AS select,
              has_column_privilege(current_user, 'public.execution_attempts', 'submitting_worker_principal_id', 'REFERENCES') AS references,
              has_table_privilege(current_user, 'public.execution_attempts', 'DELETE') AS delete,
              has_table_privilege(current_user, 'public.execution_attempts', 'TRUNCATE') AS truncate,
              has_table_privilege(current_user, 'public.execution_attempts', 'TRIGGER') AS trigger`,
    );
    expect(privileges.rows).toEqual([{ update: false, select: true, references: false, delete: false, truncate: false, trigger: false }]);
    expect(RUNTIME_TABLE_PRIVILEGES.execution_attempts!.updateColumns).not.toContain("submitting_worker_principal_id");
    await inRolledBackTransaction(clients.runtime, async () => {
      await expectSqlError(clients.runtime, "UPDATE execution_attempts SET submitting_worker_principal_id = NULL", [], { code: INSUFFICIENT_PRIVILEGE });
    });
  });

  it("has no UPDATE on submission lease-epoch provenance: only the database guard derives it (migration 0006)", async () => {
    const privileges = await clients.runtime.query(
      `SELECT has_column_privilege(current_user, 'public.execution_attempts', 'submitting_fencing_counter', 'UPDATE') AS update,
              has_column_privilege(current_user, 'public.execution_attempts', 'submitting_fencing_counter', 'SELECT') AS select,
              has_column_privilege(current_user, 'public.execution_attempts', 'submitting_fencing_counter', 'REFERENCES') AS references`,
    );
    expect(privileges.rows).toEqual([{ update: false, select: true, references: false }]);
    expect(RUNTIME_TABLE_PRIVILEGES.execution_attempts!.updateColumns).not.toContain("submitting_fencing_counter");
    await inRolledBackTransaction(clients.runtime, async () => {
      await expectSqlError(clients.runtime, "UPDATE execution_attempts SET submitting_fencing_counter = 1", [], { code: INSUFFICIENT_PRIVILEGE });
    });
  });

  it.each(["input_failed_worker_principal_id", "input_failed_fencing_counter"])(
    "has no UPDATE on input-failure provenance %s: only the database guard derives it (migration 0007)",
    async (column) => {
      const privileges = await clients.runtime.query(
        `SELECT has_column_privilege(current_user, 'public.execution_attempts', $1, 'UPDATE') AS update,
                has_column_privilege(current_user, 'public.execution_attempts', $1, 'SELECT') AS select,
                has_column_privilege(current_user, 'public.execution_attempts', $1, 'REFERENCES') AS references`,
        [column],
      );
      expect(privileges.rows).toEqual([{ update: false, select: true, references: false }]);
      expect(RUNTIME_TABLE_PRIVILEGES.execution_attempts!.updateColumns).not.toContain(column);
      await inRolledBackTransaction(clients.runtime, async () => {
        await expectSqlError(clients.runtime, `UPDATE execution_attempts SET ${column} = NULL`, [], { code: INSUFFICIENT_PRIVILEGE });
      });
    },
  );

  it("grants provider-verification lifecycle writes but never immutable provenance ownership (migration 0010)", async () => {
    expect(RUNTIME_TABLE_PRIVILEGES.provider_verification_jobs).toEqual({
      select: true,
      insert: true,
      updateColumns: [
        "state",
        "lease_worker_principal_id",
        "lease_token_sha256",
        "lease_fencing_counter",
        "leased_at",
        "lease_expires_at",
        "credential_granted_at",
        "verifying_at",
        "verifying_worker_principal_id",
        "verifying_fencing_counter",
        "result_outcome",
        "terminal_reason_code",
        "result_worker_principal_id",
        "result_fencing_counter",
        "completed_at",
        "updated_at",
      ],
    });

    for (const column of [
      "id",
      "account_id",
      "provider_connection_id",
      "provider_credential_version_id",
      "verification_policy_id",
      "requested_by_user_id",
      "created_at",
    ]) {
      expect(
        await runtimeHas(
          "SELECT has_column_privilege(current_user, 'public.provider_verification_jobs', $1, 'UPDATE') AS allowed",
          [column],
        ),
        column,
      ).toBe(false);
    }

    for (const column of [
      "state",
      "lease_worker_principal_id",
      "lease_token_sha256",
      "lease_fencing_counter",
      "credential_granted_at",
      "verifying_at",
      "verifying_worker_principal_id",
      "verifying_fencing_counter",
      "result_outcome",
      "terminal_reason_code",
      "result_worker_principal_id",
      "result_fencing_counter",
      "completed_at",
    ]) {
      expect(
        await runtimeHas(
          "SELECT has_column_privilege(current_user, 'public.provider_verification_jobs', $1, 'UPDATE') AS allowed",
          [column],
        ),
        column,
      ).toBe(true);
    }

    expect(
      await runtimeHas(
        "SELECT has_table_privilege(current_user, 'public.provider_verification_jobs', 'DELETE') AS allowed",
      ),
    ).toBe(false);
    expect(
      await runtimeHas(
        "SELECT has_table_privilege(current_user, 'public.provider_verification_jobs', 'TRUNCATE') AS allowed",
      ),
    ).toBe(false);
    expect(
      await runtimeHas(
        "SELECT has_table_privilege(current_user, 'public.provider_verification_jobs', 'TRIGGER') AS allowed",
      ),
    ).toBe(false);
  });

  it("holds only SELECT and INSERT on the generation usage ledger, with no updatable column (migration 0008)", async () => {
    expect(RUNTIME_TABLE_PRIVILEGES.generation_usage_ledger).toEqual({ select: true, insert: true, updateColumns: [] });
    const privileges = await clients.runtime.query(
      `SELECT has_table_privilege(current_user, 'public.generation_usage_ledger', 'SELECT') AS select,
              has_table_privilege(current_user, 'public.generation_usage_ledger', 'INSERT') AS insert,
              has_table_privilege(current_user, 'public.generation_usage_ledger', 'UPDATE') AS table_update,
              has_table_privilege(current_user, 'public.generation_usage_ledger', 'DELETE') AS delete,
              has_table_privilege(current_user, 'public.generation_usage_ledger', 'TRUNCATE') AS truncate,
              has_table_privilege(current_user, 'public.generation_usage_ledger', 'REFERENCES') AS references,
              has_table_privilege(current_user, 'public.generation_usage_ledger', 'TRIGGER') AS trigger,
              has_any_column_privilege(current_user, 'public.generation_usage_ledger', 'UPDATE') AS any_column_update`,
    );
    expect(privileges.rows).toEqual([
      { select: true, insert: true, table_update: false, delete: false, truncate: false, references: false, trigger: false, any_column_update: false },
    ]);
    await inRolledBackTransaction(clients.runtime, async () => {
      const denied = { code: INSUFFICIENT_PRIVILEGE };
      await expectSqlError(clients.runtime, "UPDATE generation_usage_ledger SET recorded_at = now()", [], denied);
      await expectSqlError(clients.runtime, "DELETE FROM generation_usage_ledger", [], denied);
      await expectSqlError(clients.runtime, "TRUNCATE generation_usage_ledger", [], denied);
    });
  });

  it("holds only SELECT and INSERT on disconnect terminal usage events, with no updatable column (migration 0009)", async () => {
    expect(RUNTIME_TABLE_PRIVILEGES.generation_usage_events).toEqual({ select: true, insert: true, updateColumns: [] });
    const privileges = await clients.runtime.query(
      `SELECT has_table_privilege(current_user, 'public.generation_usage_events', 'SELECT') AS select,
              has_table_privilege(current_user, 'public.generation_usage_events', 'INSERT') AS insert,
              has_table_privilege(current_user, 'public.generation_usage_events', 'UPDATE') AS table_update,
              has_table_privilege(current_user, 'public.generation_usage_events', 'DELETE') AS delete,
              has_table_privilege(current_user, 'public.generation_usage_events', 'TRUNCATE') AS truncate,
              has_table_privilege(current_user, 'public.generation_usage_events', 'REFERENCES') AS references,
              has_table_privilege(current_user, 'public.generation_usage_events', 'TRIGGER') AS trigger,
              has_any_column_privilege(current_user, 'public.generation_usage_events', 'UPDATE') AS any_column_update`,
    );
    expect(privileges.rows).toEqual([
      { select: true, insert: true, table_update: false, delete: false, truncate: false, references: false, trigger: false, any_column_update: false },
    ]);
    await inRolledBackTransaction(clients.runtime, async () => {
      const denied = { code: INSUFFICIENT_PRIVILEGE };
      await expectSqlError(clients.runtime, "UPDATE generation_usage_events SET recorded_at = now()", [], denied);
      await expectSqlError(clients.runtime, "DELETE FROM generation_usage_events", [], denied);
      await expectSqlError(clients.runtime, "TRUNCATE generation_usage_events", [], denied);
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

describe("generation usage event immutability trigger", () => {
  it("rejects UPDATE, DELETE and TRUNCATE even for the table owner", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const authorizationId = await insertClaimedUsageEventFixture();

      for (const sql of [
        "UPDATE generation_usage_events SET recorded_at = now() WHERE generation_authorization_id = $1",
        "DELETE FROM generation_usage_events WHERE generation_authorization_id = $1",
      ]) {
        await clients.migrator.query("SAVEPOINT usage_event_trigger_probe");
        await expect(clients.migrator.query(sql, [authorizationId])).rejects.toMatchObject({
          code: INSUFFICIENT_PRIVILEGE,
          message: expect.stringContaining("generation_usage_events is append-only"),
        });
        await clients.migrator.query("ROLLBACK TO SAVEPOINT usage_event_trigger_probe");
      }

      await clients.migrator.query("SAVEPOINT usage_event_trigger_probe");
      await expect(clients.migrator.query("TRUNCATE generation_usage_events")).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
        message: "generation_usage_events is append-only: TRUNCATE rejected",
      });
      await clients.migrator.query("ROLLBACK TO SAVEPOINT usage_event_trigger_probe");

      expect(
        (
          await clients.migrator.query(
            "SELECT generation_authorization_id FROM generation_usage_events WHERE generation_authorization_id = $1",
            [authorizationId],
          )
        ).rowCount,
      ).toBe(1);
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
