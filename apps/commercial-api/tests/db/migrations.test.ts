import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DATABASE_CONFIG_KEYS } from "../../src/database/databaseConfig.js";
import { MigrationError } from "../../src/database/migrationError.js";
import { DEFAULT_MIGRATIONS_DIRECTORY, discoverMigrations, sha256Hex } from "../../src/database/migrationFiles.js";
import { MIGRATION_LOCK_KEY } from "../../src/database/migrationLock.js";
import { runDatabaseCommand } from "../../src/database/runDatabaseCommand.js";
import { runMigrations } from "../../src/database/runMigrations.js";
import { applyRuntimeGrants } from "../../src/database/runtimeGrants.js";
import {
  connectAs,
  openGuardedClients,
  prepareSchemaV1,
  resetTestSchema,
  type GuardedClients,
} from "./support/testDatabase.js";
import { APPROVED_MIGRATION_ROLE } from "./support/testDatabaseGuard.js";

const SCHEMA_V1_FILE = "0001_commercial_schema_v1.sql";

let clients: GuardedClients;
let scratch: string;

beforeAll(async () => {
  clients = await openGuardedClients();
});

afterAll(async () => {
  // Leave the database at schema v1 with runtime grants and no rows.
  await prepareSchemaV1(clients);
  await clients.close();
});

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "commercial-api-migrations-"));
  await resetTestSchema(clients.migrator);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function publicTables(): Promise<string[]> {
  const result = await clients.migrator.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  return result.rows.map((row) => row.tablename);
}

async function appliedRows() {
  const result = await clients.migrator.query<{ version: number; name: string; sha256: string }>(
    "SELECT version, name, sha256 FROM schema_migrations ORDER BY version",
  );
  return result.rows;
}

async function stageMigrations(files: Readonly<Record<string, string>>): Promise<string> {
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(scratch, name), content);
  }
  return scratch;
}

async function expectMigrationError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(MigrationError);
  await expect(promise).rejects.toMatchObject({ code });
}

function commandDependencies(migrationsDirectory: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  return {
    stdout,
    stderr,
    exitCodes,
    dependencies: {
      environment: { [DATABASE_CONFIG_KEYS.migrationUrl]: clients.config.migrationUrl },
      migrationsDirectory,
      writeStdout: (text: string) => stdout.push(text),
      writeStderr: (text: string) => stderr.push(text),
      setExitCode: (code: number) => exitCodes.push(code),
    },
  };
}

describe("migration runner against PostgreSQL 16", () => {
  it("applies the bootstrap and 0001 to an empty database and records the exact checksum", async () => {
    expect(await publicTables()).toEqual([]);

    const migrations = await discoverMigrations();
    const result = await runMigrations(clients.migrator, migrations);

    expect(result).toEqual({ applied: [SCHEMA_V1_FILE], latestVersion: 1 });
    const bytes = await readFile(join(DEFAULT_MIGRATIONS_DIRECTORY, SCHEMA_V1_FILE));
    expect(await appliedRows()).toEqual([{ version: 1, name: "commercial_schema_v1", sha256: sha256Hex(bytes) }]);
    expect(await publicTables()).toEqual([
      "accounts",
      "audit_events",
      "entitlement_grants",
      "productions",
      "schema_migrations",
      "users",
    ]);
  });

  it("is a no-op on a second run", async () => {
    const migrations = await discoverMigrations();
    await runMigrations(clients.migrator, migrations);
    const before = await clients.migrator.query("SELECT version, applied_at FROM schema_migrations");

    const result = await runMigrations(clients.migrator, migrations);

    expect(result.applied).toEqual([]);
    const after = await clients.migrator.query("SELECT version, applied_at FROM schema_migrations");
    expect(after.rows).toEqual(before.rows);
  });

  it("runs through the explicit migrate command with configuration from the environment", async () => {
    const run = commandDependencies(DEFAULT_MIGRATIONS_DIRECTORY);

    await runDatabaseCommand("migrate", run.dependencies);

    expect(run.exitCodes).toEqual([]);
    expect(run.stdout).toEqual([
      `commercial-api migrate: applied ${SCHEMA_V1_FILE}\n`,
      "commercial-api migrate: schema at version 1\n",
    ]);
    expect((await appliedRows()).map((row) => row.version)).toEqual([1]);
  });

  it("rejects checksum drift in an applied migration and changes nothing", async () => {
    await runMigrations(clients.migrator, await discoverMigrations());
    const original = await readFile(join(DEFAULT_MIGRATIONS_DIRECTORY, SCHEMA_V1_FILE), "utf8");
    const directory = await stageMigrations({ [SCHEMA_V1_FILE]: `${original}-- edited after apply\n` });

    await expectMigrationError(runMigrations(clients.migrator, await discoverMigrations(directory)), "MIGRATION_CHECKSUM_DRIFT");
    expect(await appliedRows()).toHaveLength(1);
  });

  it("rejects an applied version whose committed name differs", async () => {
    await runMigrations(clients.migrator, await discoverMigrations());
    const original = await readFile(join(DEFAULT_MIGRATIONS_DIRECTORY, SCHEMA_V1_FILE), "utf8");
    const directory = await stageMigrations({ "0001_renamed_schema.sql": original });

    await expectMigrationError(runMigrations(clients.migrator, await discoverMigrations(directory)), "MIGRATION_NAME_MISMATCH");
  });

  it("rejects an applied version with no committed file", async () => {
    await runMigrations(clients.migrator, await discoverMigrations());

    await expectMigrationError(runMigrations(clients.migrator, []), "MIGRATION_UNKNOWN_APPLIED");
  });

  it("rejects an unapplied migration older than an applied one", async () => {
    const directory = await stageMigrations({ "0001_first.sql": "SELECT 1;\n", "0003_third.sql": "SELECT 3;\n" });
    await runMigrations(clients.migrator, await discoverMigrations(directory));
    await writeFile(join(directory, "0002_second.sql"), "SELECT 2;\n");

    await expectMigrationError(runMigrations(clients.migrator, await discoverMigrations(directory)), "MIGRATION_OUT_OF_ORDER");
    expect((await appliedRows()).map((row) => row.version)).toEqual([1, 3]);
  });

  it("rolls back a failing migration completely and records nothing for it", async () => {
    await copyFile(join(DEFAULT_MIGRATIONS_DIRECTORY, SCHEMA_V1_FILE), join(scratch, SCHEMA_V1_FILE));
    await writeFile(join(scratch, "0002_broken.sql"), "CREATE TABLE partial_marker (id integer);\nSELECT no_such_function();\n");

    await expect(runMigrations(clients.migrator, await discoverMigrations(scratch))).rejects.toMatchObject({ code: "42883" });

    expect((await appliedRows()).map((row) => row.version)).toEqual([1]);
    expect(await publicTables()).not.toContain("partial_marker");
  });

  it("refuses to run while another session holds the migration lock", async () => {
    const holder = await connectAs(clients.config.migrationUrl, APPROVED_MIGRATION_ROLE);
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock($1::bigint)", [MIGRATION_LOCK_KEY]);

      await expectMigrationError(runMigrations(clients.migrator, await discoverMigrations()), "MIGRATION_LOCKED");
      expect(await publicTables()).toEqual([]);
    } finally {
      await holder.query("ROLLBACK");
      await holder.end();
    }
  });

  it("keeps the migration lock across commits so a second runner cannot interleave", async () => {
    const directory = await stageMigrations({
      "0001_first.sql": "CREATE TABLE interleave_first (id integer);\n",
      "0002_second.sql": "CREATE TABLE interleave_second (id integer);\n",
    });
    const migrations = await discoverMigrations(directory);

    // Runner A uses the real client and the real runner. The proxy only pauses
    // once, after A's first COMMIT has actually completed and before A opens
    // its next migration transaction.
    let releasePause!: () => void;
    let signalPaused!: () => void;
    const paused = new Promise<void>((resolve) => (signalPaused = resolve));
    const resume = new Promise<void>((resolve) => (releasePause = resolve));
    let commits = 0;

    const runnerAClient = await connectAs(clients.config.migrationUrl, APPROVED_MIGRATION_ROLE);
    const runnerBClient = await connectAs(clients.config.migrationUrl, APPROVED_MIGRATION_ROLE);
    const pausingClient = new Proxy(runnerAClient, {
      get(target, property) {
        if (property === "query") {
          return async (...args: Parameters<pg.Client["query"]>) => {
            const result = await (target.query as (...queryArgs: unknown[]) => Promise<unknown>)(...args);
            if (args[0] === "COMMIT" && ++commits === 1) {
              signalPaused();
              await resume;
            }
            return result;
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    try {
      const runnerA = runMigrations(pausingClient, migrations);
      await paused;

      // A has committed 0001 and is between transactions.
      expect((await appliedRows()).map((row) => row.version)).toEqual([1]);

      await expectMigrationError(runMigrations(runnerBClient, migrations), "MIGRATION_LOCKED");
      await expectMigrationError(
        applyRuntimeGrants(runnerBClient, "busybookie_commercial_test_runtime", migrations),
        "MIGRATION_LOCKED",
      );
      expect((await appliedRows()).map((row) => row.version)).toEqual([1]);

      releasePause();
      await expect(runnerA).resolves.toEqual({ applied: ["0001_first.sql", "0002_second.sql"], latestVersion: 2 });

      const counts = await clients.migrator.query<{ version: number; count: string }>(
        "SELECT version, count(*) AS count FROM schema_migrations GROUP BY version ORDER BY version",
      );
      expect(counts.rows).toEqual([
        { version: 1, count: "1" },
        { version: 2, count: "1" },
      ]);

      await expect(runMigrations(runnerBClient, migrations)).resolves.toEqual({ applied: [], latestVersion: 2 });
    } finally {
      releasePause();
      await Promise.all([runnerAClient.end(), runnerBClient.end()]);
    }
  });

  it("releases the session lock after a successful run and after a failed run", async () => {
    const holder = await connectAs(clients.config.migrationUrl, APPROVED_MIGRATION_ROLE);
    const lockIsFree = async () => {
      const result = await holder.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1::bigint) AS acquired", [
        MIGRATION_LOCK_KEY,
      ]);
      if (result.rows[0]?.acquired === true) {
        await holder.query("SELECT pg_advisory_unlock($1::bigint)", [MIGRATION_LOCK_KEY]);
        return true;
      }
      return false;
    };

    try {
      await runMigrations(clients.migrator, await discoverMigrations());
      expect(await lockIsFree()).toBe(true);

      const broken = await stageMigrations({ "0001_broken.sql": "SELECT no_such_function();\n" });
      await resetTestSchema(clients.migrator);
      await expect(runMigrations(clients.migrator, await discoverMigrations(broken))).rejects.toMatchObject({ code: "42883" });
      expect(await lockIsFree()).toBe(true);
    } finally {
      await holder.end();
    }
  });

  it.each([
    ["a malformed filename", { "1_short.sql": "SELECT 1;\n" }, "MIGRATION_FILENAME_INVALID"],
    ["a duplicate version", { "0001_first.sql": "SELECT 1;\n", "0001_other.sql": "SELECT 2;\n" }, "MIGRATION_VERSION_DUPLICATE"],
    ["CRLF line endings", { "0001_crlf.sql": "SELECT 1;\r\n" }, "MIGRATION_CONTENT_INVALID"],
    ["transaction control", { "0001_commit.sql": "SELECT 1;\nCOMMIT;\n" }, "MIGRATION_CONTENT_INVALID"],
  ])("refuses %s through the migrate command before touching the database", async (_label, files, code) => {
    const run = commandDependencies(await stageMigrations(files));

    await runDatabaseCommand("migrate", run.dependencies);

    expect(run.exitCodes).toEqual([1]);
    expect(run.stderr.join("")).toContain(code);
    expect(await publicTables()).toEqual([]);
  });
});
