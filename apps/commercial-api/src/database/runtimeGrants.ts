import type { ClientBase } from "pg";

import { MigrationError } from "./migrationError.js";
import type { MigrationFile } from "./migrationFiles.js";
import { MIGRATION_LOCK_KEY } from "./migrationLock.js";

// Source-controlled privileges for the runtime API role. Environment-specific
// role names never appear in migrations; this manifest is applied to a named
// role by the explicit runtime-grant command, as the migration owner.
//
// UPDATE is column-scoped: identity, ownership and creation provenance columns
// cannot be changed by the runtime role. No table grants DELETE, TRUNCATE,
// REFERENCES or TRIGGER. audit_events is SELECT and INSERT only.
export type TablePrivileges = Readonly<{
  select: boolean;
  insert: boolean;
  updateColumns: readonly string[];
}>;

export const RUNTIME_TABLE_PRIVILEGES: Readonly<Record<string, TablePrivileges>> = Object.freeze({
  users: { select: true, insert: true, updateColumns: ["email", "email_verified", "status", "disabled_at", "updated_at"] },
  accounts: { select: true, insert: true, updateColumns: ["status", "disabled_at", "updated_at"] },
  entitlement_grants: {
    select: true,
    insert: true,
    updateColumns: ["state", "reserved_at", "consumed_at", "revoked_at", "expired_at", "expires_at", "updated_at"],
  },
  productions: { select: true, insert: true, updateColumns: ["title", "archived_at", "updated_at"] },
  // Lifecycle and verification only; ownership, provider, credential kind,
  // creator and idempotency key are immutable to the runtime role.
  provider_connections: {
    select: true,
    insert: true,
    updateColumns: [
      "label",
      "status",
      "verification_status",
      "last_verification_attempt_at",
      "verified_at",
      "disconnected_at",
      "disabled_at",
      "updated_at",
    ],
  },
  // Lifecycle fields, plus the secret and fingerprint columns solely so that
  // destruction can set them to NULL. The provider_credential_versions guard
  // trigger rejects any replacement of secret material with another value.
  provider_credential_versions: {
    select: true,
    insert: true,
    updateColumns: [
      "status",
      "superseded_at",
      "retained_for_recovery_at",
      "destroyed_at",
      "sealed_credential",
      "fingerprint_algorithm",
      "fingerprint_key_ref",
      "fingerprint_value",
      "updated_at",
    ],
  },
  audit_events: { select: true, insert: true, updateColumns: [] },
  // Read-only: lets the API verify the applied schema version.
  schema_migrations: { select: true, insert: false, updateColumns: [] },
});

const ROLE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

// Safe because every identifier passed here is validated or source-controlled.
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function runtimeGrantStatements(roleName: string): readonly string[] {
  const role = quoteIdentifier(roleName);
  const statements = [
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role}`,
    `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${role}`,
    `REVOKE CREATE ON SCHEMA public FROM ${role}`,
    `GRANT USAGE ON SCHEMA public TO ${role}`,
  ];

  for (const [table, privileges] of Object.entries(RUNTIME_TABLE_PRIVILEGES)) {
    const tablePrivileges = [privileges.select ? "SELECT" : null, privileges.insert ? "INSERT" : null].filter(
      (privilege) => privilege !== null,
    );
    if (tablePrivileges.length > 0) {
      statements.push(`GRANT ${tablePrivileges.join(", ")} ON TABLE ${quoteIdentifier(table)} TO ${role}`);
    }
    if (privileges.updateColumns.length > 0) {
      const columns = privileges.updateColumns.map(quoteIdentifier).join(", ");
      statements.push(`GRANT UPDATE (${columns}) ON TABLE ${quoteIdentifier(table)} TO ${role}`);
    }
  }

  return Object.freeze(statements);
}

// Synchronises the runtime role's privileges to the manifest. Refuses unless
// the role exists, is not the migration role, holds no elevated attribute,
// and the schema is exactly at the committed latest version with exactly the
// manifest's tables.
export async function applyRuntimeGrants(
  client: ClientBase,
  roleName: string,
  migrations: readonly MigrationFile[],
): Promise<void> {
  if (!ROLE_NAME_PATTERN.test(roleName)) {
    throw new MigrationError("RUNTIME_ROLE_INVALID", "The runtime role name is not a plain lowercase PostgreSQL identifier.");
  }

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = public");

    const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired", [
      MIGRATION_LOCK_KEY,
    ]);
    if (lock.rows[0]?.acquired !== true) {
      throw new MigrationError("MIGRATION_LOCKED", "Another migration run holds the commercial migration lock.");
    }

    const role = await client.query<{
      is_current_user: boolean;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolname = current_user AS is_current_user, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
         FROM pg_roles WHERE rolname = $1`,
      [roleName],
    );
    const attributes = role.rows[0];
    if (
      attributes === undefined ||
      attributes.is_current_user ||
      attributes.rolsuper ||
      attributes.rolcreatedb ||
      attributes.rolcreaterole ||
      attributes.rolreplication ||
      attributes.rolbypassrls
    ) {
      throw new MigrationError(
        "RUNTIME_ROLE_INVALID",
        "The runtime role must exist, differ from the migration role, and hold no superuser, CREATEDB, CREATEROLE, REPLICATION or BYPASSRLS attribute.",
      );
    }

    const latest = migrations.at(-1)?.version ?? 0;
    const state = await client.query<{ applied_version: number | null; tables: string[] }>(
      `SELECT (SELECT max(version) FROM schema_migrations) AS applied_version,
              ARRAY(SELECT tablename::text FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename) AS tables`,
    );
    const expectedTables = Object.keys(RUNTIME_TABLE_PRIVILEGES).sort();
    const actualTables = state.rows[0]?.tables ?? [];
    if (
      state.rows[0]?.applied_version !== latest ||
      actualTables.length !== expectedTables.length ||
      actualTables.some((table, index) => table !== expectedTables[index])
    ) {
      throw new MigrationError(
        "RUNTIME_GRANT_SCHEMA_MISMATCH",
        "The database schema is not at the committed latest migration with exactly the runtime grant manifest's tables.",
      );
    }

    for (const statement of runtimeGrantStatements(roleName)) {
      await client.query(statement);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
