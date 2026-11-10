import pg from "pg";
import { expect } from "vitest";

import { discoverMigrations } from "../../../src/database/migrationFiles.js";
import { runMigrations } from "../../../src/database/runMigrations.js";
import { applyRuntimeGrants } from "../../../src/database/runtimeGrants.js";
import {
  APPROVED_MIGRATION_ROLE,
  APPROVED_RUNTIME_ROLE,
  assertServerIdentity,
  loadTestDatabaseConfig,
  type TestDatabaseConfig,
} from "./testDatabaseGuard.js";

export type GuardedClients = Readonly<{
  config: TestDatabaseConfig;
  migrator: pg.Client;
  runtime: pg.Client;
  close: () => Promise<void>;
}>;

export async function connectAs(url: string, expectedUser: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, application_name: "commercial-api-test-db" });
  await client.connect();

  try {
    const identity = await client.query<{ database: string; user: string; version_num: string }>(
      "SELECT current_database() AS database, current_user AS user, current_setting('server_version_num') AS version_num",
    );
    const row = identity.rows[0];
    assertServerIdentity(
      { database: row?.database ?? "", user: row?.user ?? "", serverVersionNum: Number(row?.version_num) },
      expectedUser,
    );
  } catch (error) {
    await client.end();
    throw error;
  }

  return client;
}

// Every database suite starts here. Throws (never skips) when the guard fails.
export async function openGuardedClients(): Promise<GuardedClients> {
  const config = loadTestDatabaseConfig(process.env);
  const migrator = await connectAs(config.migrationUrl, APPROVED_MIGRATION_ROLE);
  let runtime: pg.Client;

  try {
    runtime = await connectAs(config.runtimeUrl, APPROVED_RUNTIME_ROLE);
  } catch (error) {
    await migrator.end();
    throw error;
  }

  return Object.freeze({
    config,
    migrator,
    runtime,
    close: async () => {
      await Promise.all([migrator.end(), runtime.end()]);
    },
  });
}

// Destructive: drops every table and function the migration role owns in
// public, returning the database to its pre-migration state. Re-checks the
// server-reported identity immediately before dropping anything.
export async function resetTestSchema(migrator: pg.Client): Promise<void> {
  const identity = await migrator.query<{ database: string; user: string; version_num: string }>(
    "SELECT current_database() AS database, current_user AS user, current_setting('server_version_num') AS version_num",
  );
  const row = identity.rows[0];
  assertServerIdentity(
    { database: row?.database ?? "", user: row?.user ?? "", serverVersionNum: Number(row?.version_num) },
    APPROVED_MIGRATION_ROLE,
  );

  await migrator.query(`
    DO $$
    DECLARE item record;
    BEGIN
      FOR item IN
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND pg_get_userbyid(c.relowner) = current_user
      LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', item.relname);
      END LOOP;
      FOR item IN
        SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = current_user
      LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', item.signature);
      END LOOP;
    END
    $$`);
}

// Fresh schema v1 with runtime grants: reset, apply committed migrations, grant.
export async function prepareSchemaV1(clients: GuardedClients): Promise<void> {
  const migrations = await discoverMigrations();
  await resetTestSchema(clients.migrator);
  await runMigrations(clients.migrator, migrations);
  await applyRuntimeGrants(clients.migrator, APPROVED_RUNTIME_ROLE, migrations);
}

// Runs fn inside a transaction that is always rolled back, so suites leave no rows.
export async function inRolledBackTransaction(client: pg.Client, fn: () => Promise<void>): Promise<void> {
  await client.query("BEGIN");
  try {
    await fn();
  } finally {
    await client.query("ROLLBACK");
  }
}

// Asserts a statement fails with the given SQLSTATE (and optional constraint)
// without aborting the surrounding transaction.
export async function expectSqlError(
  client: pg.Client,
  sql: string,
  params: readonly unknown[],
  expected: Readonly<{ code: string; constraint?: string }>,
): Promise<void> {
  await client.query("SAVEPOINT expect_sql_error");
  let caught: unknown;
  try {
    await client.query(sql, params as unknown[]);
  } catch (error) {
    caught = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT expect_sql_error");

  expect(caught, `expected ${expected.code} from: ${sql}`).toBeInstanceOf(Error);
  expect((caught as { code?: string }).code).toBe(expected.code);
  if (expected.constraint !== undefined) {
    expect((caught as { constraint?: string }).constraint).toBe(expected.constraint);
  }
}

// Inserts a user, personal account and FREE_BYO grant as the given client.
export async function insertAccountWithFreeGrant(
  client: pg.Client,
  subject: string,
): Promise<Readonly<{ userId: string; accountId: string; grantId: string }>> {
  const user = await client.query<{ id: string }>(
    "INSERT INTO users (idp_issuer, idp_subject) VALUES ('https://issuer.test', $1) RETURNING id",
    [subject],
  );
  const userId = user.rows[0]!.id;
  const account = await client.query<{ id: string }>(
    "INSERT INTO accounts (kind, owner_user_id) VALUES ('PERSONAL', $1) RETURNING id",
    [userId],
  );
  const accountId = account.rows[0]!.id;
  const grant = await client.query<{ id: string }>(
    `INSERT INTO entitlement_grants (account_id, kind, state, source, issuance_key, policy_version)
     VALUES ($1, 'FREE_BYO', 'AVAILABLE', 'ACCOUNT_PROVISIONING', 'account-provisioning', 'test-policy')
     RETURNING id`,
    [accountId],
  );
  return { userId, accountId, grantId: grant.rows[0]!.id };
}
