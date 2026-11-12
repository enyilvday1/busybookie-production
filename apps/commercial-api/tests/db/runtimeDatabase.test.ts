import { EventEmitter } from "node:events";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { discoverMigrations, parseMigrationFile, type MigrationFile } from "../../src/database/migrationFiles.js";
import { loadRuntimeDatabaseConfig, type RuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type RuntimePool } from "../../src/database/runtimePool.js";
import { runMigrations } from "../../src/database/runMigrations.js";
import { createReadinessCheck, verifyRuntimeDatabase } from "../../src/database/verifyRuntimeDatabase.js";
import { runCommercialApiProcess, type ShutdownSignal } from "../../src/runCommercialApiProcess.js";
import { startCommercialApiServer } from "../../src/startCommercialApiServer.js";
import { send } from "../httpClient.js";
import { openGuardedClients, prepareSchemaV1, resetTestSchema, type GuardedClients } from "./support/testDatabase.js";

const SCHEMA_V1_SHA256 = "6e03d9d784278318d1e6586d7c247aef7486d6c5641409cfacab5fc77a5a88ed";

let clients: GuardedClients;
let migrations: readonly MigrationFile[];

beforeAll(async () => {
  clients = await openGuardedClients();
  await prepareSchemaV1(clients);
  migrations = await discoverMigrations();
});

afterAll(async () => {
  await prepareSchemaV1(clients);
  await clients.close();
});

function runtimeConfig(url: string, extra: Record<string, string> = {}): RuntimeDatabaseConfig {
  const config = loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: url, ...extra }, "development");
  if (config === null) throw new Error("expected a database configuration");
  return config;
}

async function withPool<T>(config: RuntimeDatabaseConfig, fn: (pool: RuntimePool) => Promise<T>): Promise<T> {
  const pool = await createRuntimePool(config, () => {});
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

describe("runtime pool against PostgreSQL 16", () => {
  it("connects as the runtime role and verifies the latest committed schema (version 7) with its exact checksum", async () => {
    expect(migrations[0]?.sha256).toBe(SCHEMA_V1_SHA256);
    expect(migrations).toHaveLength(7);
    await withPool(runtimeConfig(clients.config.runtimeUrl), async (pool) => {
      await expect(verifyRuntimeDatabase(pool, migrations)).resolves.toEqual({ latestVersion: 7, latestSha256: migrations[6]!.sha256 });

      const identity = await pool.query<{ user: string; version_num: string }>(
        "SELECT current_user AS user, current_setting('server_version_num') AS version_num",
      );
      expect(identity.rows[0]?.user).toBe("busybookie_commercial_test_runtime");
      expect(Number(identity.rows[0]?.version_num)).toBeGreaterThanOrEqual(160000);
      expect(Number(identity.rows[0]?.version_num)).toBeLessThan(170000);
    });
  });

  it("applies the configured timeouts as session settings", async () => {
    const config = runtimeConfig(clients.config.runtimeUrl, {
      COMMERCIAL_API_DATABASE_STATEMENT_TIMEOUT_MS: "7000",
      COMMERCIAL_API_DATABASE_LOCK_TIMEOUT_MS: "3000",
      COMMERCIAL_API_DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: "20000",
    });
    await withPool(config, async (pool) => {
      const settings = await pool.query<Record<string, string>>(
        `SELECT current_setting('statement_timeout') AS statement_timeout,
                current_setting('lock_timeout') AS lock_timeout,
                current_setting('idle_in_transaction_session_timeout') AS idle_timeout,
                current_setting('application_name') AS application_name`,
      );
      expect(settings.rows[0]).toEqual({
        statement_timeout: "7s",
        lock_timeout: "3s",
        idle_timeout: "20s",
        application_name: "commercial-api",
      });
    });
  });

  it("enforces the statement timeout", async () => {
    await withPool(runtimeConfig(clients.config.runtimeUrl, { COMMERCIAL_API_DATABASE_STATEMENT_TIMEOUT_MS: "200" }), async (pool) => {
      await expect(pool.query("SELECT pg_sleep(2)")).rejects.toMatchObject({ code: "57014" });
    });
  });

  it("refuses a migration-owner session as the runtime identity", async () => {
    await withPool(runtimeConfig(clients.config.migrationUrl), async (pool) => {
      await expect(verifyRuntimeDatabase(pool, migrations)).rejects.toMatchObject({ code: "DATABASE_ROLE_UNSAFE" });
    });
  });

  it("still cannot run DDL through the runtime pool", async () => {
    await withPool(runtimeConfig(clients.config.runtimeUrl), async (pool) => {
      await expect(pool.query("CREATE TABLE runtime_pool_probe (id integer)")).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("detects drift, a schema behind and a schema ahead of the committed migrations", async () => {
    const [schemaV1, ...later] = migrations;
    const provenance = migrations[6]!;
    const drifted = parseMigrationFile(schemaV1!.fileName, new TextEncoder().encode(`${schemaV1!.sql}-- drift\n`));
    const next = parseMigrationFile("0008_next.sql", new TextEncoder().encode("SELECT 8;\n"));

    await withPool(runtimeConfig(clients.config.runtimeUrl), async (pool) => {
      await expect(verifyRuntimeDatabase(pool, [drifted, ...later])).rejects.toMatchObject({
        code: "SCHEMA_DRIFT",
      });
      await expect(verifyRuntimeDatabase(pool, [...migrations, next])).rejects.toMatchObject({ code: "SCHEMA_BEHIND" });
    });

    // Ahead: a migration applied to the database that the code does not know.
    await clients.migrator.query("INSERT INTO schema_migrations (version, name, sha256) VALUES (8, 'next', $1)", [next.sha256]);
    try {
      await withPool(runtimeConfig(clients.config.runtimeUrl), async (pool) => {
        await expect(verifyRuntimeDatabase(pool, migrations)).rejects.toMatchObject({ code: "SCHEMA_AHEAD" });
        // Readiness verified against version 7 now sees a newer applied migration.
        const check = createReadinessCheck(pool, { latestVersion: 7, latestSha256: provenance.sha256 }, 2000);
        await expect(check()).resolves.toBe(false);
      });
    } finally {
      await clients.migrator.query("DELETE FROM schema_migrations WHERE version = 8");
    }
  });

  it("is not ready while the database is still at version 1", async () => {
    const [schemaV1] = migrations;
    const provenance = migrations[6]!;
    await resetTestSchema(clients.migrator);
    await runMigrations(clients.migrator, [schemaV1!]);
    // As a version-1 deployment's grants did, let the runtime role read the schema version.
    await clients.migrator.query("GRANT SELECT ON schema_migrations TO busybookie_commercial_test_runtime");
    try {
      await withPool(runtimeConfig(clients.config.runtimeUrl), async (pool) => {
        await expect(verifyRuntimeDatabase(pool, migrations)).rejects.toMatchObject({ code: "SCHEMA_BEHIND" });
        const check = createReadinessCheck(pool, { latestVersion: 7, latestSha256: provenance.sha256 }, 2000);
        await expect(check()).resolves.toBe(false);
      });
    } finally {
      await prepareSchemaV1(clients);
    }
  });

  it("is not ready while the database is at version 6, and is ready at version 7", async () => {
    const provenance = migrations[6]!;
    await resetTestSchema(clients.migrator);
    await runMigrations(clients.migrator, migrations.slice(0, 6));
    // As a version-6 deployment's grants did, let the runtime role read the schema version.
    await clients.migrator.query("GRANT SELECT ON schema_migrations TO busybookie_commercial_test_runtime");
    try {
      await withPool(runtimeConfig(clients.config.runtimeUrl), async (pool) => {
        await expect(verifyRuntimeDatabase(pool, migrations)).rejects.toMatchObject({ code: "SCHEMA_BEHIND" });
        // A process verified at version 7 also reports not ready here.
        const check = createReadinessCheck(pool, { latestVersion: 7, latestSha256: provenance.sha256 }, 2000);
        await expect(check()).resolves.toBe(false);
      });
    } finally {
      await prepareSchemaV1(clients);
    }

    await withPool(runtimeConfig(clients.config.runtimeUrl), async (pool) => {
      const verified = await verifyRuntimeDatabase(pool, migrations);
      expect(verified).toEqual({ latestVersion: 7, latestSha256: provenance.sha256 });
      await expect(createReadinessCheck(pool, verified, 2000)()).resolves.toBe(true);
    });
  });

  it("detects a missing schema", async () => {
    await resetTestSchema(clients.migrator);
    try {
      await withPool(runtimeConfig(clients.config.runtimeUrl), async (pool) => {
        await expect(verifyRuntimeDatabase(pool, migrations)).rejects.toMatchObject({ code: "SCHEMA_MISSING" });
      });
    } finally {
      await prepareSchemaV1(clients);
    }
  });

  it("reports a refused connection as a connection failure", async () => {
    // Nothing listens on 5499; this never touches another PostgreSQL instance.
    const unreachable = clients.config.runtimeUrl.replace(":5433/", ":5499/");
    await withPool(runtimeConfig(unreachable, { COMMERCIAL_API_DATABASE_CONNECT_TIMEOUT_MS: "1000" }), async (pool) => {
      await expect(verifyRuntimeDatabase(pool, migrations)).rejects.toMatchObject({
        code: "DATABASE_CONNECTION_FAILED",
        detail: "ECONNREFUSED",
      });
    });
  });

  it("readiness is true on a live pool and false once the pool is closed", async () => {
    const pool = await createRuntimePool(runtimeConfig(clients.config.runtimeUrl), () => {});
    const verified = await verifyRuntimeDatabase(pool, migrations);
    const check = createReadinessCheck(pool, verified, 2000);

    await expect(check()).resolves.toBe(true);
    await pool.end();
    await expect(check()).resolves.toBe(false);
  });
});

describe("API process against PostgreSQL 16", () => {
  it("starts with the runtime pool, serves /__ready and /__health, and closes the pool on SIGTERM", async () => {
    const signals = new EventEmitter();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const running = await runCommercialApiProcess({
      environment: { COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl },
      onSignal: (signal: ShutdownSignal, listener: () => void) => {
        signals.once(signal, listener);
      },
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text),
      setExitCode: (code) => stderr.push(`exit ${code}`),
      startServer: (options) => startCommercialApiServer({ ...options, port: 0 }),
    });

    expect(running).not.toBeNull();
    expect(stdout[0]).toBe("commercial-api: database verified\n");
    const ready = await send(running!.port, "GET", "/__ready");
    expect(ready.status).toBe(200);
    expect(ready.body).toBe('{"status":"ready","service":"commercial-api"}\n');
    expect((await send(running!.port, "GET", "/__health")).body).toBe('{"status":"ok","service":"commercial-api"}\n');

    signals.emit("SIGTERM");
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 10000;
      const poll = () =>
        stdout.includes("commercial-api: stopped\n") ? resolve() : Date.now() > deadline ? reject(new Error("not stopped")) : setTimeout(poll, 10);
      poll();
    });
    expect(stderr).toEqual([]);

    const sessions = await clients.migrator.query<{ count: string }>(
      "SELECT count(*) AS count FROM pg_stat_activity WHERE application_name = 'commercial-api' AND datname = current_database()",
    );
    expect(sessions.rows).toEqual([{ count: "0" }]);
  });
});
