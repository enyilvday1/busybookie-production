import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  describeDatabaseFailure,
  loadMigrationDatabaseUrl,
  loadRuntimeDatabaseRole,
  redactConnectionSecrets,
} from "../../src/database/databaseConfig.js";
import { MigrationError } from "../../src/database/migrationError.js";
import { deriveAdvisoryLockKey, MIGRATION_LOCK_KEY, MIGRATION_LOCK_NAME } from "../../src/database/migrationLock.js";
import { runtimeGrantStatements } from "../../src/database/runtimeGrants.js";
import { runDatabaseCommand } from "../../src/database/runDatabaseCommand.js";
import {
  assertServerIdentity,
  loadTestDatabaseConfig,
  TestDatabaseGuardError,
} from "../db/support/testDatabaseGuard.js";

describe("migration advisory lock", () => {
  it("derives the key from the first 8 bytes of SHA-256(name) as a signed big-endian bigint", () => {
    const digest = createHash("sha256").update("busybookie:commercial-api:schema-migrations:v1").digest();
    const independent = BigInt.asIntN(64, BigInt(`0x${digest.subarray(0, 8).toString("hex")}`));

    expect(MIGRATION_LOCK_NAME).toBe("busybookie:commercial-api:schema-migrations:v1");
    expect(deriveAdvisoryLockKey(MIGRATION_LOCK_NAME)).toBe(independent);
    expect(MIGRATION_LOCK_KEY).toBe(independent.toString());
  });

  it("is stable, inside the PostgreSQL bigint domain, and not the R44B2C probe value", () => {
    const key = BigInt(MIGRATION_LOCK_KEY);
    expect(key).toBe(deriveAdvisoryLockKey(MIGRATION_LOCK_NAME));
    expect(key >= -(2n ** 63n) && key < 2n ** 63n).toBe(true);
    expect(key).not.toBe(74144201n);
    expect(deriveAdvisoryLockKey("another-name")).not.toBe(key);
  });
});

describe("database configuration", () => {
  it("requires the migration URL and never echoes it", () => {
    expect(() => loadMigrationDatabaseUrl({})).toThrow("COMMERCIAL_API_MIGRATION_DATABASE_URL is required.");

    for (const value of ["not a url secret-value", "https://host/db?secret-value", "postgres://host", "postgres:///db"]) {
      try {
        loadMigrationDatabaseUrl({ COMMERCIAL_API_MIGRATION_DATABASE_URL: value });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(MigrationError);
        expect((error as Error).message).not.toContain("secret-value");
        expect((error as Error).message).not.toContain(value);
      }
    }

    expect(loadMigrationDatabaseUrl({ COMMERCIAL_API_MIGRATION_DATABASE_URL: "postgresql://user@127.0.0.1:5433/db" })).toBe(
      "postgresql://user@127.0.0.1:5433/db",
    );
  });

  it("requires the runtime role for the grant command", () => {
    expect(() => loadRuntimeDatabaseRole({})).toThrow("COMMERCIAL_API_RUNTIME_DATABASE_ROLE is required.");
    expect(loadRuntimeDatabaseRole({ COMMERCIAL_API_RUNTIME_DATABASE_ROLE: "app_runtime" })).toBe("app_runtime");
  });

  it("redacts the connection string and both encoded and decoded passwords", () => {
    const url = "postgres://user:p%40ss%3Aword@127.0.0.1:5433/db";
    const text = `failed for ${url} with p@ss:word and p%40ss%3Aword`;

    const redacted = redactConnectionSecrets(text, url);

    expect(redacted).not.toContain("p@ss:word");
    expect(redacted).not.toContain("p%40ss%3Aword");
    expect(redacted).toContain("[redacted]");
  });

  it("describes failures by kind without leaking unknown errors", () => {
    expect(describeDatabaseFailure(new MigrationError("MIGRATION_LOCKED", "busy"), undefined)).toBe("MIGRATION_LOCKED: busy");
    expect(describeDatabaseFailure(Object.assign(new Error("relation missing"), { code: "42P01" }), undefined)).toBe(
      "database error 42P01: relation missing",
    );
    expect(describeDatabaseFailure(new Error("internal detail"), undefined)).toBe("unexpected failure");
  });

  it("fails the migrate command with exit code 1 when unconfigured, without connecting", async () => {
    const stderr: string[] = [];
    const exitCodes: number[] = [];

    await runDatabaseCommand("migrate", {
      environment: {},
      writeStdout: () => {},
      writeStderr: (text) => stderr.push(text),
      setExitCode: (code) => exitCodes.push(code),
    });

    expect(exitCodes).toEqual([1]);
    expect(stderr).toEqual(["commercial-api migrate: DATABASE_CONFIG_INVALID: COMMERCIAL_API_MIGRATION_DATABASE_URL is required.\n"]);
  });
});

describe("runtime grant statements", () => {
  it("revokes everything before granting the manifest and never grants DELETE", () => {
    const statements = runtimeGrantStatements("app_runtime");

    expect(statements.slice(0, 4)).toEqual([
      'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "app_runtime"',
      'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "app_runtime"',
      'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM "app_runtime"',
      'REVOKE CREATE ON SCHEMA public FROM "app_runtime"',
    ]);
    expect(statements).toContain('GRANT SELECT, INSERT ON TABLE "audit_events" TO "app_runtime"');
    expect(statements).toContain('GRANT SELECT ON TABLE "schema_migrations" TO "app_runtime"');
    expect(statements.some((statement) => /DELETE|TRUNCATE|ALL PRIVILEGES|GRANT UPDATE ON|"audit_events" TO.*UPDATE/.test(statement))).toBe(
      false,
    );
    expect(statements.filter((statement) => statement.includes("audit_events") && statement.includes("UPDATE"))).toEqual([]);
  });
});

describe("test database guard", () => {
  const valid = {
    COMMERCIAL_API_ALLOW_TEST_DATABASE_MUTATION: "YES",
    COMMERCIAL_API_TEST_DATABASE_MIGRATION_URL: "postgres://busybookie_commercial_test_migrator@127.0.0.1:5433/busybookie_commercial_test",
    COMMERCIAL_API_TEST_DATABASE_RUNTIME_URL: "postgres://busybookie_commercial_test_runtime@127.0.0.1:5433/busybookie_commercial_test",
  };

  it("accepts the approved loopback test identities", () => {
    expect(loadTestDatabaseConfig(valid)).toEqual({
      migrationUrl: valid.COMMERCIAL_API_TEST_DATABASE_MIGRATION_URL,
      runtimeUrl: valid.COMMERCIAL_API_TEST_DATABASE_RUNTIME_URL,
    });
  });

  it.each([
    ["no opt-in flag", { ...valid, COMMERCIAL_API_ALLOW_TEST_DATABASE_MUTATION: undefined }],
    ["a non-YES flag", { ...valid, COMMERCIAL_API_ALLOW_TEST_DATABASE_MUTATION: "true" }],
    ["a missing migration URL", { ...valid, COMMERCIAL_API_TEST_DATABASE_MIGRATION_URL: undefined }],
    ["a missing runtime URL", { ...valid, COMMERCIAL_API_TEST_DATABASE_RUNTIME_URL: "" }],
    [
      "a remote host",
      { ...valid, COMMERCIAL_API_TEST_DATABASE_MIGRATION_URL: "postgres://busybookie_commercial_test_migrator@db.example.com/busybookie_commercial_test" },
    ],
    [
      "another database",
      { ...valid, COMMERCIAL_API_TEST_DATABASE_MIGRATION_URL: "postgres://busybookie_commercial_test_migrator@127.0.0.1:5433/busybookie_commercial_prod" },
    ],
    [
      "the wrong migration role",
      { ...valid, COMMERCIAL_API_TEST_DATABASE_MIGRATION_URL: "postgres://postgres@127.0.0.1:5433/busybookie_commercial_test" },
    ],
    [
      "runtime and migration roles swapped",
      { ...valid, COMMERCIAL_API_TEST_DATABASE_RUNTIME_URL: valid.COMMERCIAL_API_TEST_DATABASE_MIGRATION_URL },
    ],
    ["a non-postgres URL", { ...valid, COMMERCIAL_API_TEST_DATABASE_RUNTIME_URL: "mysql://busybookie_commercial_test_runtime@127.0.0.1/busybookie_commercial_test" }],
  ])("refuses %s", (_label, environment) => {
    expect(() => loadTestDatabaseConfig(environment)).toThrow(TestDatabaseGuardError);
  });

  it("checks the identity PostgreSQL reports, including the server major version", () => {
    const ok = { database: "busybookie_commercial_test", user: "busybookie_commercial_test_migrator", serverVersionNum: 160013 };
    expect(() => assertServerIdentity(ok, "busybookie_commercial_test_migrator")).not.toThrow();

    for (const identity of [
      { ...ok, database: "busybookie_commercial" },
      { ...ok, database: "busybookie_commercial_test_prod" },
      { ...ok, user: "postgres" },
      { ...ok, serverVersionNum: 150015 },
      { ...ok, serverVersionNum: 170000 },
    ]) {
      expect(() => assertServerIdentity(identity, "busybookie_commercial_test_migrator")).toThrow(TestDatabaseGuardError);
    }
  });
});
