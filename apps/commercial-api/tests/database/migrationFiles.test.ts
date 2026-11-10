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
  it("discovers exactly 0001 with LF bytes and a stable checksum", async () => {
    const migrations = await discoverMigrations();
    const raw = await readFile(join(DEFAULT_MIGRATIONS_DIRECTORY, "0001_commercial_schema_v1.sql"));

    expect(migrations.map((entry) => entry.fileName)).toEqual(["0001_commercial_schema_v1.sql"]);
    expect(migrations[0]?.sha256).toBe(sha256Hex(raw));
    expect(raw.includes(0x0d)).toBe(false);
  });

  it("creates exactly the tables the runtime grant manifest covers", async () => {
    const [schemaV1] = await discoverMigrations();
    const created = [...(schemaV1?.sql ?? "").matchAll(/^CREATE TABLE (\w+)/gm)].map((match) => match[1]).sort();

    expect(created).toEqual(["accounts", "audit_events", "entitlement_grants", "productions", "users"]);
    expect(Object.keys(RUNTIME_TABLE_PRIVILEGES).sort()).toEqual([...created, "schema_migrations"].sort());
  });

  it("names no environment-specific role", async () => {
    const [schemaV1] = await discoverMigrations();
    expect(schemaV1?.sql).not.toMatch(/busybookie_commercial_test/i);
    // No GRANT statements: runtime privileges are applied by the runtime-grant command.
    expect(schemaV1?.sql).not.toMatch(/^\s*GRANT\b/im);
  });
});
