import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ServerConfigError } from "../../src/config.js";
import { loadRuntimeDatabaseConfig, type RuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, toPgPoolConfig, toPgSslOptions } from "../../src/database/runtimePool.js";

const SECRET = "s3cret-Pa55";
const LOCAL_URL = `postgres://app_runtime:${SECRET}@127.0.0.1:5433/app_db`;
const REMOTE_URL = `postgresql://app_runtime:${SECRET}@db.internal.example:5432/app_db`;

function expectConfigError(fn: () => unknown, message: string | RegExp) {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ServerConfigError);
  expect((caught as Error).message).toMatch(message);
  expect((caught as Error).message).not.toContain(SECRET);
  expect((caught as Error).message).not.toContain("db.internal.example");
}

describe("runtime database configuration", () => {
  it("returns null in development when no database is configured", () => {
    expect(loadRuntimeDatabaseConfig({}, "development")).toBeNull();
  });

  it("requires the database URL in production", () => {
    expectConfigError(() => loadRuntimeDatabaseConfig({}, "production"), /COMMERCIAL_API_DATABASE_URL is required/);
  });

  it("refuses database settings without a URL instead of ignoring them", () => {
    expectConfigError(
      () => loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_POOL_MAX: "5" }, "development"),
      /Database settings are set but COMMERCIAL_API_DATABASE_URL is not/,
    );
  });

  it("never reads the migration or test database keys", () => {
    expect(
      loadRuntimeDatabaseConfig(
        {
          COMMERCIAL_API_MIGRATION_DATABASE_URL: LOCAL_URL,
          COMMERCIAL_API_TEST_DATABASE_RUNTIME_URL: LOCAL_URL,
          DATABASE_URL: LOCAL_URL,
        },
        "development",
      ),
    ).toBeNull();
  });

  it("applies documented defaults for a loopback development database", () => {
    expect(loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: LOCAL_URL }, "development")).toEqual({
      url: LOCAL_URL,
      host: "127.0.0.1",
      tls: "disable",
      caFile: null,
      poolMax: 10,
      connectTimeoutMs: 5000,
      statementTimeoutMs: 15000,
      lockTimeoutMs: 5000,
      idleInTransactionTimeoutMs: 30000,
    });
  });

  it.each([
    "not a url",
    "https://app_runtime@127.0.0.1/app_db",
    "postgres://127.0.0.1:5433/app_db",
    "postgres://app_runtime@127.0.0.1:5433",
    "postgres://app_runtime@127.0.0.1:5433/",
    "postgres://app_runtime@127.0.0.1:5433/app_db/extra",
    `postgres://app_runtime:${SECRET}@127.0.0.1:5433/app_db?sslmode=disable`,
    `postgres://app_runtime:${SECRET}@127.0.0.1:5433/app_db?options=-c%20search_path%3Devil`,
    `postgres://app_runtime:${SECRET}@127.0.0.1:5433/app_db#fragment`,
  ])("rejects the malformed or parameterised URL %s without echoing it", (url) => {
    expectConfigError(() => loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: url }, "development"), /must be a postgres/);
  });

  describe("TLS", () => {
    it("defaults to verify-full for a non-loopback development host and for production", () => {
      expect(loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: REMOTE_URL }, "development")?.tls).toBe("verify-full");
      expect(
        loadRuntimeDatabaseConfig(
          { COMMERCIAL_API_DATABASE_URL: REMOTE_URL, COMMERCIAL_API_DATABASE_CA_FILE: "/etc/ca.pem" },
          "production",
        )?.tls,
      ).toBe("verify-full");
    });

    it.each(["", "DISABLE", "prefer", "verify-ca", "true"])("rejects the unknown mode %j", (tls) => {
      expectConfigError(
        () => loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: LOCAL_URL, COMMERCIAL_API_DATABASE_TLS: tls }, "development"),
        /must be "disable", "require" or "verify-full"/,
      );
    });

    it("rejects plaintext to a non-loopback host in any mode", () => {
      expectConfigError(
        () => loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: REMOTE_URL, COMMERCIAL_API_DATABASE_TLS: "disable" }, "development"),
        /only permitted for a loopback/,
      );
    });

    it.each(["disable", "require"])("rejects %s in production, even for loopback", (tls) => {
      expectConfigError(
        () => loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: LOCAL_URL, COMMERCIAL_API_DATABASE_TLS: tls }, "production"),
        /must be "verify-full" in production/,
      );
    });

    it("requires an explicit CA file in production", () => {
      expectConfigError(
        () => loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: REMOTE_URL, COMMERCIAL_API_DATABASE_TLS: "verify-full" }, "production"),
        /COMMERCIAL_API_DATABASE_CA_FILE is required in production/,
      );
    });

    it("rejects a CA file with a mode that does not verify", () => {
      expectConfigError(
        () =>
          loadRuntimeDatabaseConfig(
            { COMMERCIAL_API_DATABASE_URL: LOCAL_URL, COMMERCIAL_API_DATABASE_TLS: "require", COMMERCIAL_API_DATABASE_CA_FILE: "/ca.pem" },
            "development",
          ),
        /only valid with COMMERCIAL_API_DATABASE_TLS=verify-full/,
      );
    });

    it("maps each mode to explicit pg SSL options", () => {
      const base = loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: LOCAL_URL }, "development")!;
      expect(toPgSslOptions({ ...base, tls: "disable" }, null)).toBe(false);
      expect(toPgSslOptions({ ...base, tls: "require" }, null)).toEqual({ rejectUnauthorized: false });
      expect(toPgSslOptions({ ...base, tls: "verify-full" }, null)).toEqual({ rejectUnauthorized: true });
      expect(toPgSslOptions({ ...base, tls: "verify-full" }, "PEM")).toEqual({ rejectUnauthorized: true, ca: "PEM" });
    });
  });

  describe("pool and timeout settings", () => {
    it("accepts explicit in-range values", () => {
      const config = loadRuntimeDatabaseConfig(
        {
          COMMERCIAL_API_DATABASE_URL: LOCAL_URL,
          COMMERCIAL_API_DATABASE_POOL_MAX: "4",
          COMMERCIAL_API_DATABASE_CONNECT_TIMEOUT_MS: "1500",
          COMMERCIAL_API_DATABASE_STATEMENT_TIMEOUT_MS: "8000",
          COMMERCIAL_API_DATABASE_LOCK_TIMEOUT_MS: "2500",
          COMMERCIAL_API_DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: "12000",
        },
        "development",
      )!;
      expect(config).toMatchObject({
        poolMax: 4,
        connectTimeoutMs: 1500,
        statementTimeoutMs: 8000,
        lockTimeoutMs: 2500,
        idleInTransactionTimeoutMs: 12000,
      });
    });

    it.each([
      ["COMMERCIAL_API_DATABASE_POOL_MAX", ["0", "-1", "101", "", "4.5", "1e1", " 4", "ten"]],
      ["COMMERCIAL_API_DATABASE_CONNECT_TIMEOUT_MS", ["0", "99", "60001", "abc"]],
      ["COMMERCIAL_API_DATABASE_STATEMENT_TIMEOUT_MS", ["0", "600001", "-5"]],
      ["COMMERCIAL_API_DATABASE_LOCK_TIMEOUT_MS", ["0", "x"]],
      ["COMMERCIAL_API_DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS", ["0", "3600001"]],
    ])("rejects malformed or out-of-range %s values", (key, values) => {
      for (const value of values) {
        expectConfigError(
          () => loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: LOCAL_URL, [key]: value }, "development"),
          new RegExp(`${key} must be an integer`),
        );
      }
    });

    it("maps settings to pg pool options with timeouts as session startup parameters", () => {
      const config: RuntimeDatabaseConfig = loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: LOCAL_URL }, "development")!;
      expect(toPgPoolConfig(config, null)).toEqual({
        connectionString: LOCAL_URL,
        ssl: false,
        max: 10,
        connectionTimeoutMillis: 5000,
        statement_timeout: 15000,
        lock_timeout: 5000,
        idle_in_transaction_session_timeout: 30000,
        application_name: "commercial-api",
      });
    });
  });
});

describe("CA file handling", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "commercial-api-ca-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const configWithCa = (caFile: string): RuntimeDatabaseConfig =>
    loadRuntimeDatabaseConfig(
      { COMMERCIAL_API_DATABASE_URL: REMOTE_URL, COMMERCIAL_API_DATABASE_CA_FILE: caFile },
      "development",
    )!;

  it("refuses an unreadable CA file without naming its path", async () => {
    const missing = join(directory, "missing.pem");
    await expect(createRuntimePool(configWithCa(missing), () => {})).rejects.toThrow(
      "COMMERCIAL_API_DATABASE_CA_FILE could not be read.",
    );
  });

  it("refuses a CA file that is not a PEM certificate without echoing its contents", async () => {
    const path = join(directory, "ca.pem");
    await writeFile(path, "private-key-material-not-a-certificate");
    const failure = createRuntimePool(configWithCa(path), () => {});
    await expect(failure).rejects.toThrow("COMMERCIAL_API_DATABASE_CA_FILE does not contain a PEM certificate.");
    await expect(failure).rejects.not.toThrow(/private-key-material/);
  });
});
