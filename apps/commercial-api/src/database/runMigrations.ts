import type { ClientBase } from "pg";

import { MigrationError } from "./migrationError.js";
import type { MigrationFile } from "./migrationFiles.js";
import { MIGRATION_LOCK_KEY } from "./migrationLock.js";

// The only DDL the runner itself owns.
const BOOTSTRAP_SCHEMA_MIGRATIONS = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     integer     NOT NULL,
  name        text        NOT NULL,
  sha256      char(64)    NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schema_migrations_pk PRIMARY KEY (version),
  CONSTRAINT schema_migrations_version_ck CHECK (version > 0),
  CONSTRAINT schema_migrations_name_ck CHECK (name ~ '^[a-z0-9]+(_[a-z0-9]+)*$' AND char_length(name) <= 100),
  CONSTRAINT schema_migrations_sha256_ck CHECK (sha256 ~ '^[0-9a-f]{64}$')
)`;

type AppliedMigration = Readonly<{ version: number; name: string; sha256: string }>;

export type MigrationRunResult = Readonly<{
  applied: readonly string[];
  latestVersion: number;
}>;

// Opens a migration transaction, ensures schema_migrations exists, and
// validates every applied row against the committed files. Returns the next
// unapplied migration, or null when the schema is current. The caller must
// already hold the session-level migration lock.
async function beginValidationTransaction(
  client: ClientBase,
  migrations: readonly MigrationFile[],
): Promise<MigrationFile | null> {
  await client.query("BEGIN");
  await client.query("SET LOCAL search_path = public");

  await client.query(BOOTSTRAP_SCHEMA_MIGRATIONS);

  const appliedRows = await client.query<AppliedMigration>(
    "SELECT version, name, sha256 FROM schema_migrations ORDER BY version",
  );
  const byVersion = new Map(migrations.map((migration) => [migration.version, migration]));

  for (const applied of appliedRows.rows) {
    const local = byVersion.get(applied.version);
    if (local === undefined) {
      throw new MigrationError(
        "MIGRATION_UNKNOWN_APPLIED",
        `Applied migration ${applied.version} has no committed migration file.`,
      );
    }
    if (local.name !== applied.name) {
      throw new MigrationError(
        "MIGRATION_NAME_MISMATCH",
        `Applied migration ${applied.version} is named ${applied.name}, but the committed file is ${local.fileName}.`,
      );
    }
    if (local.sha256 !== applied.sha256) {
      throw new MigrationError(
        "MIGRATION_CHECKSUM_DRIFT",
        `Committed migration ${local.fileName} differs from the version already applied.`,
      );
    }
  }

  const appliedVersions = new Set(appliedRows.rows.map((row) => row.version));
  const next = migrations.find((migration) => !appliedVersions.has(migration.version)) ?? null;

  if (next !== null && appliedRows.rows.some((row) => row.version > next.version)) {
    throw new MigrationError(
      "MIGRATION_OUT_OF_ORDER",
      `Migration ${next.fileName} is unapplied but a later version is already applied.`,
    );
  }

  return next;
}

// Applies every unapplied migration in version order.
//
// The runner owns a session-level advisory lock for the entire invocation:
// it is acquired once before anything else and released once at the end, so
// it survives each migration's COMMIT and no other migration run or
// runtime-grant synchronisation (same key) can interleave. Each migration
// still runs in its own SQL transaction. If the database session is lost,
// PostgreSQL releases the session lock automatically.
//
// Any failure rolls back the current migration and propagates unchanged; a
// failed lock release never replaces that primary error.
export async function runMigrations(client: ClientBase, migrations: readonly MigrationFile[]): Promise<MigrationRunResult> {
  const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1::bigint) AS acquired", [
    MIGRATION_LOCK_KEY,
  ]);
  if (lock.rows[0]?.acquired !== true) {
    throw new MigrationError("MIGRATION_LOCKED", "Another migration run holds the commercial migration lock.");
  }

  const applied: string[] = [];
  let failed = false;

  try {
    for (;;) {
      try {
        const next = await beginValidationTransaction(client, migrations);

        if (next === null) {
          await client.query("COMMIT");
          break;
        }

        await client.query(next.sql);
        await client.query("INSERT INTO schema_migrations (version, name, sha256) VALUES ($1, $2, $3)", [
          next.version,
          next.name,
          next.sha256,
        ]);
        await client.query("COMMIT");
        applied.push(next.fileName);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await releaseMigrationLock(client, failed);
  }

  return Object.freeze({
    applied: Object.freeze(applied),
    latestVersion: migrations.at(-1)?.version ?? 0,
  });
}

// After a successful run the release must report true; anything else is an
// explicit failure. After a failed run, release problems (including a broken
// connection, which releases the lock anyway) are ignored so the original
// error propagates.
async function releaseMigrationLock(client: ClientBase, runFailed: boolean): Promise<void> {
  let released = false;

  try {
    const result = await client.query<{ released: boolean }>("SELECT pg_advisory_unlock($1::bigint) AS released", [
      MIGRATION_LOCK_KEY,
    ]);
    released = result.rows[0]?.released === true;
  } catch (error) {
    if (!runFailed) {
      throw error;
    }
  }

  if (!runFailed && !released) {
    throw new MigrationError(
      "MIGRATION_LOCK_RELEASE_FAILED",
      "The commercial migration lock was not held by this session when the run finished.",
    );
  }
}
