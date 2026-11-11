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
  insertAccountWithFreeGrant,
  openGuardedClients,
  prepareSchemaV1,
  resetTestSchema,
  type GuardedClients,
} from "./support/testDatabase.js";
import { APPROVED_MIGRATION_ROLE } from "./support/testDatabaseGuard.js";

const SCHEMA_V1_FILE = "0001_commercial_schema_v1.sql";
const PROVIDER_CONNECTIONS_FILE = "0002_provider_connections.sql";
const GENERATION_AUTHORIZATIONS_FILE = "0003_generation_authorizations.sql";
const WORKER_BRIDGE_FILE = "0004_worker_bridge_persistence.sql";
const SUBMISSION_PROVENANCE_FILE = "0005_submission_authority_provenance.sql";
const LEASE_EPOCH_FILE = "0006_submission_lease_epoch_provenance.sql";
const COMMITTED_FILES = [
  SCHEMA_V1_FILE,
  PROVIDER_CONNECTIONS_FILE,
  GENERATION_AUTHORIZATIONS_FILE,
  WORKER_BRIDGE_FILE,
  SUBMISSION_PROVENANCE_FILE,
  LEASE_EPOCH_FILE,
];

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
  it("applies the bootstrap and 0001 to 0006 to an empty database and records the exact checksums", async () => {
    expect(await publicTables()).toEqual([]);

    const migrations = await discoverMigrations();
    const result = await runMigrations(clients.migrator, migrations);

    expect(result).toEqual({ applied: COMMITTED_FILES, latestVersion: 6 });
    const v1 = await readFile(join(DEFAULT_MIGRATIONS_DIRECTORY, SCHEMA_V1_FILE));
    const v2 = await readFile(join(DEFAULT_MIGRATIONS_DIRECTORY, PROVIDER_CONNECTIONS_FILE));
    const v3 = await readFile(join(DEFAULT_MIGRATIONS_DIRECTORY, GENERATION_AUTHORIZATIONS_FILE));
    const v4 = await readFile(join(DEFAULT_MIGRATIONS_DIRECTORY, WORKER_BRIDGE_FILE));
    const v5 = await readFile(join(DEFAULT_MIGRATIONS_DIRECTORY, SUBMISSION_PROVENANCE_FILE));
    const v6 = await readFile(join(DEFAULT_MIGRATIONS_DIRECTORY, LEASE_EPOCH_FILE));
    expect(sha256Hex(v5)).toBe("ff12efddc15441e2c529796632ca3e1ad188ebb6c7df5ddfb1058426065934ec");
    expect(sha256Hex(v1)).toBe("6e03d9d784278318d1e6586d7c247aef7486d6c5641409cfacab5fc77a5a88ed");
    expect(sha256Hex(v2)).toBe("599dcc34eaf046ab942e8b2f575531cd98499a1790a4ae5df12ff6c36d697f06");
    expect(sha256Hex(v3)).toBe("639f300b96592064d03659b09da99f84ad242be8c41829e8bbedebb24c819868");
    expect(sha256Hex(v4)).toBe("c19113d3e3022f26e17cb4eeba9cee2719a387914549d5c2996fc66fcd8cfe49");
    expect(await appliedRows()).toEqual([
      { version: 1, name: "commercial_schema_v1", sha256: sha256Hex(v1) },
      { version: 2, name: "provider_connections", sha256: sha256Hex(v2) },
      { version: 3, name: "generation_authorizations", sha256: sha256Hex(v3) },
      { version: 4, name: "worker_bridge_persistence", sha256: sha256Hex(v4) },
      { version: 5, name: "submission_authority_provenance", sha256: sha256Hex(v5) },
      { version: 6, name: "submission_lease_epoch_provenance", sha256: sha256Hex(v6) },
    ]);
    expect(await publicTables()).toEqual([
      "accounts",
      "audit_events",
      "entitlement_grants",
      "execution_attempts",
      "execution_jobs",
      "generation_authorizations",
      "productions",
      "provider_connections",
      "provider_credential_versions",
      "schema_migrations",
      "users",
      "worker_principals",
    ]);
  });

  it("applies 0002 to 0006 on top of a database already at version 1", async () => {
    const [schemaV1] = await discoverMigrations();
    await runMigrations(clients.migrator, [schemaV1!]);
    expect((await appliedRows()).map((row) => row.version)).toEqual([1]);

    const result = await runMigrations(clients.migrator, await discoverMigrations());

    expect(result.applied).toEqual([PROVIDER_CONNECTIONS_FILE, GENERATION_AUTHORIZATIONS_FILE, WORKER_BRIDGE_FILE, SUBMISSION_PROVENANCE_FILE, LEASE_EPOCH_FILE]);
    expect((await appliedRows()).map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("upgrades a database at version 3 through version 6", async () => {
    const [schemaV1, providerConnections, generationAuthorizations] = await discoverMigrations();
    await runMigrations(clients.migrator, [schemaV1!, providerConnections!, generationAuthorizations!]);
    expect((await appliedRows()).map((row) => row.version)).toEqual([1, 2, 3]);
    for (const table of ["worker_principals", "execution_jobs", "execution_attempts"]) {
      expect(await publicTables()).not.toContain(table);
    }

    const result = await runMigrations(clients.migrator, await discoverMigrations());

    expect(result).toEqual({ applied: [WORKER_BRIDGE_FILE, SUBMISSION_PROVENANCE_FILE, LEASE_EPOCH_FILE], latestVersion: 6 });
    expect((await appliedRows()).map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const table of ["worker_principals", "execution_jobs", "execution_attempts"]) {
      expect(await publicTables()).toContain(table);
    }
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
      `commercial-api migrate: applied ${PROVIDER_CONNECTIONS_FILE}\n`,
      `commercial-api migrate: applied ${GENERATION_AUTHORIZATIONS_FILE}\n`,
      `commercial-api migrate: applied ${WORKER_BRIDGE_FILE}\n`,
      `commercial-api migrate: applied ${SUBMISSION_PROVENANCE_FILE}\n`,
      `commercial-api migrate: applied ${LEASE_EPOCH_FILE}\n`,
      "commercial-api migrate: schema at version 6\n",
    ]);
    expect((await appliedRows()).map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it.each(COMMITTED_FILES)("rejects checksum drift in an applied %s and changes nothing", async (edited) => {
    await runMigrations(clients.migrator, await discoverMigrations());
    const before = await clients.migrator.query("SELECT version, sha256, applied_at FROM schema_migrations ORDER BY version");
    for (const file of COMMITTED_FILES) {
      if (file === edited) {
        const original = await readFile(join(DEFAULT_MIGRATIONS_DIRECTORY, file), "utf8");
        await writeFile(join(scratch, file), `${original}-- edited after apply\n`);
      } else {
        await copyFile(join(DEFAULT_MIGRATIONS_DIRECTORY, file), join(scratch, file));
      }
    }

    await expectMigrationError(runMigrations(clients.migrator, await discoverMigrations(scratch)), "MIGRATION_CHECKSUM_DRIFT");
    const after = await clients.migrator.query("SELECT version, sha256, applied_at FROM schema_migrations ORDER BY version");
    expect(after.rows).toEqual(before.rows);
    expect(after.rows).toHaveLength(6);
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

// Migration 0005 on databases already at schema version 4. Rows are built by
// the owner through the 0004 guard's legal transitions, then 0005 is applied.
describe("migration 0005 on a schema-version-4 database", () => {
  async function migrateToVersion4(): Promise<void> {
    await runMigrations(clients.migrator, (await discoverMigrations()).slice(0, 4));
    expect((await appliedRows()).map((row) => row.version)).toEqual([1, 2, 3, 4]);
  }

  async function legacyAttempt(subject: string): Promise<Readonly<{ id: string; workerId: string }>> {
    const q = async (sql: string, params: unknown[]) => (await clients.migrator.query<{ id: string }>(sql, params)).rows[0]!.id;
    const owner = await insertAccountWithFreeGrant(clients.migrator, subject);
    const workerId = await q("INSERT INTO worker_principals (label) VALUES ($1) RETURNING id", [`${subject}-worker`]);
    const productionId = await q(
      "INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id) VALUES ($1, 'Production', $2, $3) RETURNING id",
      [owner.accountId, owner.grantId, owner.userId],
    );
    const connectionId = await q(
      "INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id) VALUES ($1, 'EXAMPLE_PROVIDER', 'API_KEY', $2) RETURNING id",
      [owner.accountId, owner.userId],
    );
    const versionId = await q(
      `INSERT INTO provider_credential_versions
         (account_id, provider_connection_id, credential_version, status, sealed_credential,
          fingerprint_algorithm, fingerprint_key_ref, fingerprint_value, created_by_user_id)
       VALUES ($1, $2, 1, 'ACTIVE', '{"format":"fixture-envelope"}'::jsonb, 'HMAC-SHA-256', 'fixture/v1', repeat('B', 43), $3) RETURNING id`,
      [owner.accountId, connectionId, owner.userId],
    );
    const authorizationId = await q(
      `INSERT INTO generation_authorizations
         (account_id, production_id, entitlement_grant_id, billing_mode, provider, model, provider_connection_id,
          provider_credential_version_id, generation_request, generation_request_sha256, expected_cost_cap_unit,
          expected_cost_cap_amount, expires_at, created_by_user_id)
       VALUES ($1, $2, $3, 'USER_BYO', 'EXAMPLE_PROVIDER', 'example-model-1', $4, $5, '{"prompt":"fixture"}'::jsonb, repeat('c', 64),
               'MICRO_USD', 1000000, now() + interval '15 minutes', $6) RETURNING id`,
      [owner.accountId, productionId, owner.grantId, connectionId, versionId, owner.userId],
    );
    const jobId = await q("INSERT INTO execution_jobs (account_id, production_id, generation_authorization_id) VALUES ($1, $2, $3) RETURNING id", [
      owner.accountId,
      productionId,
      authorizationId,
    ]);
    const id = await q(
      `INSERT INTO execution_attempts (account_id, execution_job_id, generation_authorization_id, attempt_number, billing_mode, provider, provider_credential_version_id)
       VALUES ($1, $2, $3, 1, 'USER_BYO', 'EXAMPLE_PROVIDER', $4) RETURNING id`,
      [owner.accountId, jobId, authorizationId, versionId],
    );
    return { id, workerId };
  }

  const LEASE = `UPDATE execution_attempts
      SET state = 'LEASED', lease_worker_principal_id = $2, lease_token_sha256 = repeat('a', 64), lease_fencing_counter = 1,
          leased_at = now(), lease_expires_at = now() + interval '2 minutes'
    WHERE id = $1`;
  const SUBMIT = "UPDATE execution_attempts SET state = 'SUBMITTING', credential_granted_at = now(), submitting_at = now() WHERE id = $1";
  const CLEAR = "lease_worker_principal_id = NULL, lease_token_sha256 = NULL, leased_at = NULL, lease_expires_at = NULL, heartbeat_at = NULL";

  async function provenanceInstalled() {
    const column = await clients.migrator.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'execution_attempts' AND column_name = 'submitting_worker_principal_id'",
    );
    const constraints = await clients.migrator.query(
      "SELECT conname FROM pg_constraint WHERE conname IN ('execution_attempts_submitting_worker_fk', 'execution_attempts_submitting_worker_ck')",
    );
    const guard = await clients.migrator.query<{ src: string }>("SELECT prosrc AS src FROM pg_proc WHERE proname = 'execution_attempts_guard'");
    return {
      column: column.rowCount === 1,
      constraints: constraints.rowCount,
      guardStamps: guard.rows.length === 1 && guard.rows[0]!.src.includes("submitting_worker_principal_id"),
    };
  }

  it("A: applies to rows that never crossed SUBMITTING and leaves their provenance NULL", async () => {
    await migrateToVersion4();
    const queued = await legacyAttempt("legacy-queued");
    const leased = await legacyAttempt("legacy-leased");
    await clients.migrator.query(LEASE, [leased.id, leased.workerId]);
    const failed = await legacyAttempt("legacy-failed");
    await clients.migrator.query(LEASE, [failed.id, failed.workerId]);
    await clients.migrator.query(
      `UPDATE execution_attempts SET state = 'FAILED_BEFORE_SUBMISSION', ${CLEAR}, failure_code = 'CREDENTIAL_UNAVAILABLE', completed_at = now() WHERE id = $1`,
      [failed.id],
    );

    const result = await runMigrations(clients.migrator, (await discoverMigrations()).slice(0, 5));

    expect(result).toEqual({ applied: [SUBMISSION_PROVENANCE_FILE], latestVersion: 5 });
    expect((await appliedRows()).map((row) => row.version)).toEqual([1, 2, 3, 4, 5]);
    expect(await provenanceInstalled()).toEqual({ column: true, constraints: 2, guardStamps: true });
    const rows = await clients.migrator.query<{ state: string; submitting_at: Date | null; submitting_worker_principal_id: string | null }>(
      "SELECT state, submitting_at, submitting_worker_principal_id FROM execution_attempts WHERE id = ANY($1) ORDER BY state",
      [[queued.id, leased.id, failed.id]],
    );
    expect(rows.rows).toEqual([
      { state: "FAILED_BEFORE_SUBMISSION", submitting_at: null, submitting_worker_principal_id: null },
      { state: "LEASED", submitting_at: null, submitting_worker_principal_id: null },
      { state: "QUEUED", submitting_at: null, submitting_worker_principal_id: null },
    ]);
  });

  it("B: backfills a SUBMITTING row from its lease principal, which then survives the lease clearing", async () => {
    await migrateToVersion4();
    const legacy = await legacyAttempt("legacy-submitting");
    await clients.migrator.query(LEASE, [legacy.id, legacy.workerId]);
    await clients.migrator.query(SUBMIT, [legacy.id]);

    await runMigrations(clients.migrator, (await discoverMigrations()).slice(0, 5));

    const after = await clients.migrator.query("SELECT state, submitting_worker_principal_id FROM execution_attempts WHERE id = $1", [legacy.id]);
    expect(after.rows).toEqual([{ state: "SUBMITTING", submitting_worker_principal_id: legacy.workerId }]);
    await clients.migrator.query(
      `UPDATE execution_attempts SET state = 'OUTCOME_UNKNOWN', ${CLEAR}, failure_code = 'WORKER_LEASE_EXPIRED_DURING_SUBMISSION' WHERE id = $1`,
      [legacy.id],
    );
    const unknown = await clients.migrator.query(
      "SELECT state, lease_worker_principal_id, submitting_worker_principal_id FROM execution_attempts WHERE id = $1",
      [legacy.id],
    );
    expect(unknown.rows).toEqual([{ state: "OUTCOME_UNKNOWN", lease_worker_principal_id: null, submitting_worker_principal_id: legacy.workerId }]);
  });

  it("C: aborts on a post-SUBMITTING row without recoverable provenance, installing nothing and recording no version 5", async () => {
    await migrateToVersion4();
    const legacy = await legacyAttempt("legacy-unknown");
    await clients.migrator.query(LEASE, [legacy.id, legacy.workerId]);
    await clients.migrator.query(SUBMIT, [legacy.id]);
    await clients.migrator.query(
      `UPDATE execution_attempts SET state = 'OUTCOME_UNKNOWN', ${CLEAR}, failure_code = 'PROVIDER_CREATE_TIMEOUT' WHERE id = $1`,
      [legacy.id],
    );
    const before = await clients.migrator.query("SELECT * FROM execution_attempts WHERE id = $1", [legacy.id]);

    const failure = runMigrations(clients.migrator, await discoverMigrations());
    await expect(failure).rejects.toMatchObject({ code: "23514" });
    await expect(failure).rejects.toThrow(/without recoverable submitting worker provenance/);

    expect((await appliedRows()).map((row) => row.version)).toEqual([1, 2, 3, 4]);
    expect(await provenanceInstalled()).toEqual({ column: false, constraints: 0, guardStamps: false });
    const after = await clients.migrator.query("SELECT * FROM execution_attempts WHERE id = $1", [legacy.id]);
    expect(after.rows).toEqual(before.rows);
    // The 0004 guard is still installed and still enforces its transition rules.
    await expect(clients.migrator.query("UPDATE execution_attempts SET state = 'QUEUED' WHERE id = $1", [legacy.id])).rejects.toMatchObject({
      code: "23514",
    });
    // The migration lock was released: a later run reaches the same refusal.
    await expect(runMigrations(clients.migrator, await discoverMigrations())).rejects.toMatchObject({ code: "23514" });
  });

  // Migration 0006 on databases already at schema version 5 (R44B6N).
  async function migrateToVersion5(): Promise<void> {
    await runMigrations(clients.migrator, (await discoverMigrations()).slice(0, 5));
    expect((await appliedRows()).map((row) => row.version)).toEqual([1, 2, 3, 4, 5]);
  }

  async function epochInstalled() {
    const column = await clients.migrator.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'execution_attempts' AND column_name = 'submitting_fencing_counter'",
    );
    const constraints = await clients.migrator.query(
      "SELECT conname FROM pg_constraint WHERE conname IN ('execution_attempts_submitting_fencing_ck', 'execution_attempts_submitting_epoch_ck')",
    );
    const guard = await clients.migrator.query<{ src: string }>("SELECT prosrc AS src FROM pg_proc WHERE proname = 'execution_attempts_guard'");
    return {
      column: column.rowCount === 1,
      constraints: constraints.rowCount,
      guardStamps: guard.rows.length === 1 && guard.rows[0]!.src.includes("submitting_fencing_counter"),
    };
  }

  it("0006 A: applies to rows that never crossed SUBMITTING and leaves their lease epoch NULL", async () => {
    await migrateToVersion5();
    const queued = await legacyAttempt("epoch-queued");
    const leased = await legacyAttempt("epoch-leased");
    await clients.migrator.query(LEASE, [leased.id, leased.workerId]);
    const failed = await legacyAttempt("epoch-failed");
    await clients.migrator.query(LEASE, [failed.id, failed.workerId]);
    await clients.migrator.query(
      `UPDATE execution_attempts SET state = 'FAILED_BEFORE_SUBMISSION', ${CLEAR}, failure_code = 'CREDENTIAL_UNAVAILABLE', completed_at = now() WHERE id = $1`,
      [failed.id],
    );

    const result = await runMigrations(clients.migrator, await discoverMigrations());

    expect(result).toEqual({ applied: [LEASE_EPOCH_FILE], latestVersion: 6 });
    expect((await appliedRows()).map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await epochInstalled()).toEqual({ column: true, constraints: 2, guardStamps: true });
    const rows = await clients.migrator.query(
      "SELECT state, submitting_fencing_counter FROM execution_attempts WHERE id = ANY($1) ORDER BY state",
      [[queued.id, leased.id, failed.id]],
    );
    expect(rows.rows).toEqual([
      { state: "FAILED_BEFORE_SUBMISSION", submitting_fencing_counter: null },
      { state: "LEASED", submitting_fencing_counter: null },
      { state: "QUEUED", submitting_fencing_counter: null },
    ]);
  });

  it("0006 B: refuses a SUBMITTING row, whose entry epoch schema 5 cannot prove, installing nothing", async () => {
    await migrateToVersion5();
    const legacy = await legacyAttempt("epoch-submitting");
    await clients.migrator.query(LEASE, [legacy.id, legacy.workerId]);
    await clients.migrator.query(SUBMIT, [legacy.id]);
    // Why no backfill: under the 0005 guard a SUBMITTING row's fencing counter can still rise without a new
    // token, so its current counter need not be the generation that entered SUBMITTING.
    await clients.migrator.query("UPDATE execution_attempts SET lease_fencing_counter = lease_fencing_counter + 1 WHERE id = $1", [legacy.id]);
    expect(
      (await clients.migrator.query("SELECT state, lease_fencing_counter FROM execution_attempts WHERE id = $1", [legacy.id])).rows,
    ).toEqual([{ state: "SUBMITTING", lease_fencing_counter: "2" }]);
    const before = await clients.migrator.query("SELECT * FROM execution_attempts WHERE id = $1", [legacy.id]);

    const failure = runMigrations(clients.migrator, await discoverMigrations());
    await expect(failure).rejects.toMatchObject({ code: "23514" });
    await expect(failure).rejects.toThrow(/without provable submitting lease-epoch provenance/);

    expect((await appliedRows()).map((row) => row.version)).toEqual([1, 2, 3, 4, 5]);
    expect(await epochInstalled()).toEqual({ column: false, constraints: 0, guardStamps: false });
    expect((await clients.migrator.query("SELECT * FROM execution_attempts WHERE id = $1", [legacy.id])).rows).toEqual(before.rows);
  });

  it("0006 C: refuses any post-SUBMITTING row (OUTCOME_UNKNOWN), inferring nothing from principal, counter or audit", async () => {
    await migrateToVersion5();
    const legacy = await legacyAttempt("epoch-unknown");
    await clients.migrator.query(LEASE, [legacy.id, legacy.workerId]);
    await clients.migrator.query(SUBMIT, [legacy.id]);
    await clients.migrator.query(
      `UPDATE execution_attempts SET state = 'OUTCOME_UNKNOWN', ${CLEAR}, failure_code = 'WORKER_LEASE_EXPIRED_DURING_SUBMISSION' WHERE id = $1`,
      [legacy.id],
    );

    await expect(runMigrations(clients.migrator, await discoverMigrations())).rejects.toMatchObject({ code: "23514" });
    expect((await appliedRows()).map((row) => row.version)).toEqual([1, 2, 3, 4, 5]);
    expect(await epochInstalled()).toEqual({ column: false, constraints: 0, guardStamps: false });
  });
});
