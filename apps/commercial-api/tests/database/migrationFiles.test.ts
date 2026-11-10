import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MigrationError } from "../../src/database/migrationError.js";
import {
  DEFAULT_MIGRATIONS_DIRECTORY,
  discoverMigrations,
  orderMigrations,
  parseMigrationFile,
  parseMigrationFileName,
  sha256Hex,
} from "../../src/database/migrationFiles.js";
import { RUNTIME_TABLE_PRIVILEGES } from "../../src/database/runtimeGrants.js";

const bytes = (text: string) => new TextEncoder().encode(text);

function expectCode(fn: () => unknown, code: string) {
  expect(fn).toThrow(MigrationError);
  try {
    fn();
  } catch (error) {
    expect((error as MigrationError).code).toBe(code);
  }
}

describe("parseMigrationFileName", () => {
  it.each([
    ["0001_commercial_schema_v1.sql", 1, "commercial_schema_v1"],
    ["0042_add_index.sql", 42, "add_index"],
    ["9999_x.sql", 9999, "x"],
  ])("accepts %s", (fileName, version, name) => {
    expect(parseMigrationFileName(fileName)).toEqual({ version, name });
  });

  it.each([
    "1_short.sql",
    "00001_too_long_version.sql",
    "0000_zero.sql",
    "0001-dash.sql",
    "0001_Upper.sql",
    "0001_trailing_.sql",
    "0001__double.sql",
    "0001_name.SQL",
    "0001_name.sql.bak",
    "0001_.sql",
    "README.md",
    `0001_${"a".repeat(101)}.sql`,
  ])("rejects %s", (fileName) => {
    expectCode(() => parseMigrationFileName(fileName), "MIGRATION_FILENAME_INVALID");
  });
});

describe("parseMigrationFile", () => {
  it("hashes the exact bytes", () => {
    const content = "SELECT 1;\n";
    const migration = parseMigrationFile("0001_one.sql", bytes(content));

    expect(migration.sha256).toBe(createHash("sha256").update(content).digest("hex"));
    expect(migration.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(parseMigrationFile("0001_one.sql", bytes("SELECT 1; \n")).sha256).not.toBe(migration.sha256);
  });

  it.each([
    ["CR line endings", "SELECT 1;\r\n"],
    ["empty content", "  \n"],
    ["BEGIN;", "BEGIN;\nSELECT 1;\n"],
    ["COMMIT;", "SELECT 1;\nCOMMIT;\n"],
    ["ROLLBACK;", "SELECT 1;\n  rollback ;\n"],
    ["COMMIT WORK;", "SELECT 1;\nCOMMIT WORK;\n"],
    ["START TRANSACTION", "START TRANSACTION;\n"],
  ])("rejects %s", (_label, content) => {
    expectCode(() => parseMigrationFile("0001_one.sql", bytes(content)), "MIGRATION_CONTENT_INVALID");
  });

  it("rejects invalid UTF-8", () => {
    expectCode(() => parseMigrationFile("0001_one.sql", new Uint8Array([0x53, 0xff, 0x3b])), "MIGRATION_CONTENT_INVALID");
  });

  it("allows PL/pgSQL BEGIN and END blocks", () => {
    const sql = "CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n  RETURN NULL;\nEND;\n$$;\n";
    expect(parseMigrationFile("0001_one.sql", bytes(sql)).sql).toBe(sql);
  });
});

describe("orderMigrations", () => {
  const migration = (fileName: string) => parseMigrationFile(fileName, bytes(`SELECT '${fileName}';\n`));

  it("orders by numeric version", () => {
    const ordered = orderMigrations([migration("0010_ten.sql"), migration("0002_two.sql"), migration("0001_one.sql")]);
    expect(ordered.map((entry) => entry.version)).toEqual([1, 2, 10]);
  });

  it("rejects duplicate versions", () => {
    expectCode(() => orderMigrations([migration("0001_one.sql"), migration("0001_uno.sql")]), "MIGRATION_VERSION_DUPLICATE");
  });
});

describe("discoverMigrations", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "commercial-api-discovery-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects any non-migration entry instead of ignoring it", async () => {
    await writeFile(join(directory, "0001_one.sql"), "SELECT 1;\n");
    await writeFile(join(directory, "notes.txt"), "draft\n");
    await expect(discoverMigrations(directory)).rejects.toMatchObject({ code: "MIGRATION_FILENAME_INVALID" });
  });

  it("rejects a subdirectory", async () => {
    await mkdir(join(directory, "0002_folder.sql"));
    await expect(discoverMigrations(directory)).rejects.toMatchObject({ code: "MIGRATION_ENTRY_INVALID" });
  });
});

describe("committed migrations", () => {
  const SCHEMA_V1_SHA256 = "6e03d9d784278318d1e6586d7c247aef7486d6c5641409cfacab5fc77a5a88ed";

  it("discovers 0001 to 0004 in order, with LF bytes and stable checksums", async () => {
    const migrations = await discoverMigrations();

    expect(migrations.map((entry) => entry.fileName)).toEqual([
      "0001_commercial_schema_v1.sql",
      "0002_provider_connections.sql",
      "0003_generation_authorizations.sql",
      "0004_worker_bridge_persistence.sql",
    ]);
    for (const migration of migrations) {
      const raw = await readFile(join(DEFAULT_MIGRATIONS_DIRECTORY, migration.fileName));
      expect(migration.sha256).toBe(sha256Hex(raw));
      expect(raw.includes(0x0d)).toBe(false);
    }
    // Migration 0001 is byte-for-byte unchanged.
    expect(migrations[0]?.sha256).toBe(SCHEMA_V1_SHA256);
  });

  it("creates exactly the tables the runtime grant manifest covers", async () => {
    const migrations = await discoverMigrations();
    const created = migrations.flatMap((migration) => [...migration.sql.matchAll(/^CREATE TABLE (\w+)/gm)].map((match) => match[1])).sort();

    expect(created).toEqual([
      "accounts",
      "audit_events",
      "entitlement_grants",
      "execution_attempts",
      "execution_jobs",
      "generation_authorizations",
      "productions",
      "provider_connections",
      "provider_credential_versions",
      "users",
      "worker_principals",
    ]);
    expect(Object.keys(RUNTIME_TABLE_PRIVILEGES).sort()).toEqual([...created, "schema_migrations"].sort());
  });

  it("names no environment-specific role and grants nothing", async () => {
    for (const migration of await discoverMigrations()) {
      expect(migration.sql).not.toMatch(/busybookie_commercial_test/i);
      // No GRANT statements: runtime privileges are applied by the runtime-grant command.
      expect(migration.sql).not.toMatch(/^\s*GRANT\b/im);
    }
  });

  it("adds no plaintext credential column and names no provider brand", async () => {
    const [, providerConnections] = await discoverMigrations();
    expect(providerConnections?.sql).not.toMatch(/\bapi_key\b|plaintext\s+text|secret\s+text|credential\s+text/);
    // Guard the guards: these patterns must still detect what they forbid.
    expect("GRANT SELECT ON users TO someone;").toMatch(/^\s*GRANT\b/im);
    expect("  api_key text NOT NULL,").toMatch(/\bapi_key\b|plaintext\s+text|secret\s+text|credential\s+text/);
    expect(providerConnections?.sql).not.toMatch(/runway|gemini|genai|veo|google/i);
  });

  it("adds generation authorizations with no plaintext credential, platform secret or provider brand", async () => {
    const [, , generationAuthorizations] = await discoverMigrations();
    expect(generationAuthorizations?.sql).toMatch(/^CREATE TABLE generation_authorizations \(/m);
    expect(generationAuthorizations?.sql).not.toMatch(/\bapi_key\b|plaintext\s+text|secret\s+text|credential\s+text/);
    expect(generationAuthorizations?.sql).not.toMatch(/runway|gemini|genai|veo|google/i);
    // No execution, worker, lease or platform-secret structures in this slice
    // (checked on the SQL with comments removed; the header comment names them).
    const withoutComments = (sql: string) => sql.replace(/--.*$/gm, "");
    const statements = withoutComments(generationAuthorizations?.sql ?? "");
    expect(statements).toMatch(/generation_authorizations/);
    expect(statements).not.toMatch(/CREATE TABLE (execution_|worker_|platform_)/);
    expect(statements).not.toMatch(/\blease|fencing|recovery_obligation|platform_credential/i);
    // Guard the guards.
    expect("CREATE TABLE execution_jobs (").toMatch(/CREATE TABLE (execution_|worker_|platform_)/);
    expect(withoutComments("  lease_token text, -- note")).toMatch(/\blease|fencing|recovery_obligation|platform_credential/i);
    expect(withoutComments("-- no lease here\n")).not.toMatch(/\blease/i);
    expect("RUNWAY_CREDITS").toMatch(/runway|gemini|genai|veo|google/i);
  });

  it("uses no regular-expression repetition bound PostgreSQL rejects at check time", async () => {
    // PostgreSQL caps {m,n} at 255 and reports a larger bound only when a row
    // is checked, never when the migration is applied.
    const bounds = (sql: string) => [...sql.matchAll(/\{(\d+)(?:,(\d*))?\}/g)].flatMap((match) => [Number(match[1]), Number(match[2] || 0)]);
    for (const migration of await discoverMigrations()) {
      expect(bounds(migration.sql).filter((bound) => bound > 255), migration.fileName).toEqual([]);
    }
    // Guard the guard.
    expect(bounds("x ~ '^[a-z]{1,256}$'")).toContain(256);
  });

  it("introduces worker and execution tables only in 0004, with no secret material or worker database role", async () => {
    const migrations = await discoverMigrations();
    const withoutComments = (sql: string) => sql.replace(/--.*$/gm, "");
    const BRIDGE_TABLE = /CREATE TABLE (execution_|worker_)/;
    for (const migration of migrations.slice(0, 3)) {
      expect(withoutComments(migration.sql)).not.toMatch(BRIDGE_TABLE);
    }

    const statements = withoutComments(migrations[3]?.sql ?? "");
    expect([...statements.matchAll(/^CREATE TABLE (\w+)/gm)].map((match) => match[1])).toEqual([
      "worker_principals",
      "execution_jobs",
      "execution_attempts",
    ]);
    expect(migrations[3]?.sql).not.toMatch(/runway|gemini|genai|veo|google/i);
    // No plaintext token, secret, sealed credential or fingerprint column; the
    // lease token appears only as its SHA-256 verifier.
    const SECRET_COLUMN = /^\s+\w*(secret|plaintext|password|api_key|sealed|fingerprint|bearer)\w*\s+(text|jsonb|bytea)/im;
    const PLAIN_TOKEN_COLUMN = /^\s+\w*token\s+(text|jsonb|bytea)/im;
    expect(statements).not.toMatch(SECRET_COLUMN);
    expect(statements).not.toMatch(PLAIN_TOKEN_COLUMN);
    expect(statements).toMatch(/^\s+lease_token_sha256\s+text/m);
    // The worker never connects to PostgreSQL: no role is created or granted.
    expect(statements).not.toMatch(/\bCREATE\s+(ROLE|USER)\b|^\s*GRANT\b/im);

    // Guard the guards.
    expect("CREATE TABLE execution_jobs (").toMatch(BRIDGE_TABLE);
    expect("  sealed_credential  jsonb NULL,").toMatch(SECRET_COLUMN);
    expect("  lease_token        text NULL,").toMatch(PLAIN_TOKEN_COLUMN);
    expect("  lease_token_sha256 text NULL,").not.toMatch(PLAIN_TOKEN_COLUMN);
    expect("CREATE ROLE commercial_worker;").toMatch(/\bCREATE\s+(ROLE|USER)\b|^\s*GRANT\b/im);
  });
});
