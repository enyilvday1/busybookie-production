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
  const MIGRATION_0011_SHA256 = "4935da7090351235cf73f08699d9bcce87ed685a85b9ba52b8b43db9c087027f";

  it("discovers 0001 to 0011 in order, contiguously, with LF bytes and stable checksums", async () => {
    const migrations = await discoverMigrations();

    expect(migrations.map((entry) => entry.fileName)).toEqual([
      "0001_commercial_schema_v1.sql",
      "0002_provider_connections.sql",
      "0003_generation_authorizations.sql",
      "0004_worker_bridge_persistence.sql",
      "0005_submission_authority_provenance.sql",
      "0006_submission_lease_epoch_provenance.sql",
      "0007_input_failure_provenance.sql",
      "0008_generation_usage_ledger.sql",
      "0009_provider_connection_disconnect_convergence.sql",
      "0010_provider_connection_verification_workflow.sql",
      "0011_provider_verification_unsupported_deferral.sql",
    ]);
    expect(migrations.map((entry) => entry.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(migrations.at(-1)).toMatchObject({ version: 11, name: "provider_verification_unsupported_deferral" });
    for (const migration of migrations) {
      const raw = await readFile(join(DEFAULT_MIGRATIONS_DIRECTORY, migration.fileName));
      expect(migration.sha256).toBe(sha256Hex(raw));
      expect(raw.includes(0x0d)).toBe(false);
    }
    // Earlier migrations are byte-for-byte unchanged.
    expect(migrations[0]?.sha256).toBe(SCHEMA_V1_SHA256);
    expect(migrations.slice(1, 10).map((entry) => entry.sha256)).toEqual([
      "599dcc34eaf046ab942e8b2f575531cd98499a1790a4ae5df12ff6c36d697f06",
      "639f300b96592064d03659b09da99f84ad242be8c41829e8bbedebb24c819868",
      "c19113d3e3022f26e17cb4eeba9cee2719a387914549d5c2996fc66fcd8cfe49",
      "ff12efddc15441e2c529796632ca3e1ad188ebb6c7df5ddfb1058426065934ec",
      "99121d3d19b6044b309be149c0d1376a79f55f4f52b34cd90930cc3664d2813a",
      "4471e20d206719de8f2418bf69e471d168bc49d5a4d785dd3c0f59e07b1e7e9f",
      "087c2d4512180bfd8607663120e90c8928ab48fefe8ca4ca1c4063ef5d9cfee5",
      "bfda9520641dd1b0e4789ad57766e0f9e0efcc899c98babcca6e0daafa090223",
      "5edfa48f485bda7795ee10d1f6405bad407f289af2493a0fca2a9dbe1af82bea",
    ]);
    expect(migrations[9]?.sha256).toBe("5edfa48f485bda7795ee10d1f6405bad407f289af2493a0fca2a9dbe1af82bea");
    expect(migrations[10]?.sha256).toBe(MIGRATION_0011_SHA256);
  });

  it("adds unsupported-verification deferral in 0011 only: three columns, four checks, one index and one new guard, no backfill, grant or terminal path", async () => {
    const migrations = await discoverMigrations();
    const withoutComments = (sql: string) => sql.replace(/--.*$/gm, "");
    const deferral = migrations[10]!;
    const statements = withoutComments(deferral.sql);

    expect(deferral.fileName).toBe("0011_provider_verification_unsupported_deferral.sql");
    expect(deferral.sha256).toBe(MIGRATION_0011_SHA256);
    expect(migrations.slice(0, 10).some((migration) => /deferred_until|unsupported_deferral|last_unsupported_refusal/.test(migration.sql))).toBe(
      false,
    );

    // No table; exactly the three columns with their types, nullability and default.
    expect(statements).not.toMatch(/CREATE TABLE/i);
    expect([...statements.matchAll(/^\s*ALTER TABLE (\w+)/gm)].map((match) => match[1])).toEqual(["provider_verification_jobs"]);
    expect([...statements.matchAll(/ADD COLUMN (\w+) (.+?),?$/gm)].map((match) => [match[1], match[2]])).toEqual([
      ["deferred_until", "timestamptz NULL"],
      ["unsupported_deferral_count", "integer NOT NULL DEFAULT 0"],
      ["last_unsupported_refusal", "text NULL"],
    ]);
    // Exactly the four published constraint names, in order.
    expect([...statements.matchAll(/ADD CONSTRAINT (\w+)/g)].map((match) => match[1])).toEqual([
      "provider_verification_jobs_unsupported_deferral_count_ck",
      "provider_verification_jobs_last_unsupported_refusal_ck",
      "provider_verification_jobs_unsupported_deferral_presence_ck",
      "provider_verification_jobs_deferred_after_creation_ck",
    ]);
    expect(statements).toMatch(/CHECK \(unsupported_deferral_count >= 0\)/);
    // The closed refusal vocabulary: exactly these three values.
    expect([...new Set(statements.match(/'(UNSUPPORTED_PROVIDER|UNSUPPORTED_POLICY|PROVIDER_POLICY_MISMATCH)'/g))].sort()).toEqual([
      "'PROVIDER_POLICY_MISMATCH'",
      "'UNSUPPORTED_POLICY'",
      "'UNSUPPORTED_PROVIDER'",
    ]);
    expect(statements).toMatch(
      /\(\(unsupported_deferral_count = 0\) = \(last_unsupported_refusal IS NULL\)\)\s+AND \(\(unsupported_deferral_count = 0\) = \(deferred_until IS NULL\)\)/,
    );
    expect(statements).toMatch(/deferred_until IS NULL\s+OR deferred_until > created_at/);

    // The eligible-queue index, built in the runner's transaction; queue_ix is not dropped.
    expect([...statements.matchAll(/CREATE (?:UNIQUE )?INDEX (\w+)/g)].map((match) => match[1])).toEqual([
      "provider_verification_jobs_eligible_queue_ix",
    ]);
    expect(statements).toMatch(
      /CREATE INDEX provider_verification_jobs_eligible_queue_ix\s+ON provider_verification_jobs \(\(COALESCE\(deferred_until, created_at\)\), id\)\s+WHERE state = 'QUEUED';/,
    );
    expect(statements).not.toMatch(/CONCURRENTLY/i);

    // One new guard function and trigger; the 0010 guard is neither replaced nor dropped.
    expect([...statements.matchAll(/CREATE (?:OR REPLACE )?FUNCTION (\w+)/g)].map((match) => match[1])).toEqual([
      "provider_verification_jobs_deferral_guard",
    ]);
    expect([...statements.matchAll(/CREATE TRIGGER (\w+)/g)].map((match) => match[1])).toEqual(["provider_verification_jobs_deferral_guard"]);
    expect(statements).toMatch(
      /CREATE TRIGGER provider_verification_jobs_deferral_guard\s+BEFORE INSERT OR UPDATE ON provider_verification_jobs\s+FOR EACH ROW EXECUTE FUNCTION provider_verification_jobs_deferral_guard\(\);/,
    );
    expect(statements).toMatch(/^REVOKE ALL ON FUNCTION provider_verification_jobs_deferral_guard\(\) FROM PUBLIC;$/m);
    expect(statements).not.toMatch(/OR REPLACE|\bDROP\b|ALTER FUNCTION|DISABLE TRIGGER/i);
    expect(statements).not.toMatch(/FUNCTION provider_verification_jobs_guard\(\)/);

    // The guard: transaction-start now(), check_violation, the exact backoff, and it never assigns NEW.
    const body = statements.slice(statements.indexOf("AS $$"), statements.lastIndexOf("$$;"));
    expect(body).not.toMatch(/\bNEW\.\w+\s*:=/);
    expect(body).not.toMatch(/clock_timestamp|statement_timestamp|transaction_timestamp|current_timestamp/i);
    expect(body).toMatch(/OLD\.state = 'LEASED'\s+AND NEW\.state = 'QUEUED'\s+AND OLD\.credential_granted_at IS NULL\s+AND OLD\.lease_expires_at > now\(\)/);
    expect(body).toMatch(/NEW\.unsupported_deferral_count = OLD\.unsupported_deferral_count \+ 1/);
    expect(body).toMatch(/NEW\.last_unsupported_refusal IS NOT NULL/);
    expect(body).toMatch(/NEW\.deferred_until > now\(\)/);
    expect(body).toMatch(/WHEN NEW\.unsupported_deferral_count >= 5 THEN 3600\s+ELSE 300 \* \(1 << \(NEW\.unsupported_deferral_count - 1\)\)/);
    expect(body).toMatch(/NEW\.deferred_until <= now\(\) \+ make_interval\(secs => bound_seconds\)/);
    expect(body.match(/ERRCODE = 'check_violation'/g)).toHaveLength(3);
    expect(body).not.toMatch(/ERRCODE = '(?!check_violation')/);

    // No terminal path, threshold or new terminal reason.
    expect(statements).not.toMatch(/CANCELLED|COMPLETED|terminal_reason_code|completed_at|result_|VERIFICATION_UNSCHEDULABLE/);
    expect(statements).not.toMatch(/unsupported_deferral_count\s*(>=|>|=)\s*(?!0\b|5 THEN)\d+/);
    // No backfill, grant, role, secret, provider brand or transaction control.
    expect(statements).not.toMatch(/^\s*(UPDATE|INSERT|DELETE)\b/im);
    expect(statements).not.toMatch(/\bTRUNCATE\b|\bCASCADE\b|audit_events/i);
    expect(statements).not.toMatch(/\bCREATE\s+(ROLE|USER)\b|^\s*GRANT\b/im);
    expect(deferral.sql).not.toMatch(/runway|gemini|genai|veo|google/i);
    const SECRET_COLUMN = /\w*(secret|plaintext|password|api_key|sealed|fingerprint|bearer|token)\w*\s+(text|jsonb|bytea|uuid)\b/i;
    expect(statements).not.toMatch(SECRET_COLUMN);

    // Every added column is runtime-updatable through the manifest (granted only by grant-runtime).
    const updateColumns = RUNTIME_TABLE_PRIVILEGES.provider_verification_jobs!.updateColumns;
    for (const [, column] of statements.matchAll(/ADD COLUMN (\w+)/g)) {
      expect(updateColumns).toContain(column);
    }

    // Guard the guards.
    expect("  NEW.deferred_until := now();").toMatch(/\bNEW\.\w+\s*:=/);
    expect("unsupported_deferral_count >= 10").toMatch(/unsupported_deferral_count\s*(>=|>|=)\s*(?!0\b|5 THEN)\d+/);
    expect("unsupported_deferral_count >= 5 THEN 3600").not.toMatch(/unsupported_deferral_count\s*(>=|>|=)\s*(?!0\b|5 THEN)\d+/);
    expect("CREATE INDEX CONCURRENTLY x").toMatch(/CONCURRENTLY/i);
    expect("  UPDATE provider_verification_jobs SET x = 1;").toMatch(/^\s*(UPDATE|INSERT|DELETE)\b/im);
  });

  it("adds input-failure provenance in 0007 only: a uuid and a bigint column, no backfill, token verifier, table, role, grant, secret or provider brand", async () => {
    const migrations = await discoverMigrations();
    const withoutComments = (sql: string) => sql.replace(/--.*$/gm, "");
    const provenance = migrations[6]!;
    const statements = withoutComments(provenance.sql);
    expect(migrations.slice(0, 6).some((migration) => /input_failed_/.test(migration.sql))).toBe(false);

    expect(statements).not.toMatch(/^CREATE TABLE/m);
    // Exactly the two provenance columns, nullable, no default; the counter has lease_fencing_counter's type.
    expect([...statements.matchAll(/ADD COLUMN (\w+) (\w+) (\w+)/g)].map((match) => [match[1], match[2], match[3]])).toEqual([
      ["input_failed_worker_principal_id", "uuid", "NULL"],
      ["input_failed_fencing_counter", "bigint", "NULL"],
    ]);
    expect(statements).not.toMatch(/\bDEFAULT\b/);
    expect(statements).toMatch(/FOREIGN KEY \(input_failed_worker_principal_id\) REFERENCES worker_principals \(id\) ON DELETE RESTRICT/);
    // No lease-token verifier of any name is kept.
    expect(statements).not.toMatch(/ADD COLUMN \w*token\w*/i);
    // No backfill: nothing is written to execution_attempts except through the guard.
    expect(statements).not.toMatch(/^\s*UPDATE\b/im);
    expect(statements).not.toMatch(/audit_events/);
    expect(provenance.sql).not.toMatch(/runway|gemini|genai|veo|google/i);
    expect(statements).not.toMatch(/\bCREATE\s+(ROLE|USER)\b|^\s*GRANT\b|\bREVOKE\b/im);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b|\bCASCADE\b/i);
    // Fail closed on any unprovable pre-provider failure row.
    expect(statements).toMatch(/WHERE state = 'FAILED_BEFORE_SUBMISSION' AND submitting_at IS NULL;/);
    // Exactly the five closed codes, the pairing, state, code and epoch checks.
    expect([...statements.matchAll(/ADD CONSTRAINT (\w+)/g)].map((match) => match[1])).toEqual([
      "execution_attempts_input_failed_worker_fk",
      "execution_attempts_input_failed_pair_ck",
      "execution_attempts_input_failed_state_ck",
      "execution_attempts_input_failed_code_ck",
      "execution_attempts_input_failed_epoch_ck",
    ]);
    expect(statements).toMatch(
      /failure_code IN \('INPUT_REFERENCE_INVALID', 'INPUT_OBJECT_NOT_FOUND', 'INPUT_OBJECT_TOO_LARGE',\s+'INPUT_OBJECT_INTEGRITY_MISMATCH', 'INPUT_MEDIA_TYPE_INVALID'\)/,
    );
    // The guard is replaced in place, never dropped or duplicated, and stamps from OLD.
    expect(statements).toMatch(/^CREATE OR REPLACE FUNCTION execution_attempts_guard\(\) RETURNS trigger/m);
    expect(statements).not.toMatch(/\bDROP\b|CREATE TRIGGER/i);
    expect(statements).toMatch(/NEW\.input_failed_worker_principal_id := OLD\.lease_worker_principal_id;/);
    expect(statements).toMatch(/NEW\.input_failed_fencing_counter := OLD\.lease_fencing_counter;/);
    // The 0006 guard is carried over unchanged: every line of it is still present, in order.
    const guardOf = (sql: string) => withoutComments(sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION"))).split("\n").filter((line) => line.trim() !== "");
    const previous = guardOf(migrations[5]!.sql);
    const current = guardOf(provenance.sql);
    let cursor = 0;
    for (const line of previous) {
      cursor = current.indexOf(line, cursor);
      expect(cursor, line).toBeGreaterThanOrEqual(0);
      cursor += 1;
    }
  });

  it("adds submission-authority provenance in 0005 only: one column, no table, role, grant, secret or provider brand", async () => {
    const migrations = await discoverMigrations();
    const withoutComments = (sql: string) => sql.replace(/--.*$/gm, "");
    const provenance = migrations[4]!;
    const statements = withoutComments(provenance.sql);
    expect(migrations.slice(0, 4).some((migration) => /submitting_worker_principal_id/.test(migration.sql))).toBe(false);

    expect(statements).not.toMatch(/^CREATE TABLE/m);
    expect([...statements.matchAll(/ADD COLUMN (\w+) (\w+)/g)].map((match) => [match[1], match[2]])).toEqual([
      ["submitting_worker_principal_id", "uuid"],
    ]);
    expect(statements).toMatch(/REFERENCES worker_principals \(id\) ON DELETE RESTRICT/);
    expect(statements).not.toMatch(/\bCASCADE\b|SET NULL|SET DEFAULT/i);
    expect(provenance.sql).not.toMatch(/runway|gemini|genai|veo|google/i);
    expect(statements).not.toMatch(/\bCREATE\s+(ROLE|USER)\b|^\s*GRANT\b|\bREVOKE\b/im);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
    const SECRET_COLUMN = /\w*(secret|plaintext|password|api_key|sealed|fingerprint|bearer|token)\w*\s+(text|jsonb|bytea|uuid)\b/i;
    expect(statements).not.toMatch(SECRET_COLUMN);
    // No provenance from audit metadata: the migration never reads audit events.
    expect(statements).not.toMatch(/audit_events/);
    // The 0004 guard is replaced in place, never dropped or duplicated.
    expect(statements).toMatch(/^CREATE OR REPLACE FUNCTION execution_attempts_guard\(\) RETURNS trigger/m);
    expect(statements).not.toMatch(/\bDROP\b|CREATE TRIGGER/i);

    // Guard the guards.
    expect("  ON DELETE CASCADE").toMatch(/\bCASCADE\b|SET NULL|SET DEFAULT/i);
    expect("ADD COLUMN lease_token text").toMatch(SECRET_COLUMN);
    expect("ADD COLUMN sealed_credential jsonb").toMatch(SECRET_COLUMN);
    expect("ADD COLUMN submitting_worker_principal_id uuid").not.toMatch(SECRET_COLUMN);
    expect("GRANT UPDATE (x) ON t TO r;").toMatch(/\bCREATE\s+(ROLE|USER)\b|^\s*GRANT\b|\bREVOKE\b/im);
  });

  it("adds submission lease-epoch provenance in 0006 only: one bigint column, no backfill, no table, role, grant, secret or provider brand", async () => {
    const migrations = await discoverMigrations();
    const withoutComments = (sql: string) => sql.replace(/--.*$/gm, "");
    const epoch = migrations[5]!;
    const statements = withoutComments(epoch.sql);
    expect(migrations.slice(0, 5).some((migration) => /submitting_fencing_counter/.test(migration.sql))).toBe(false);

    expect(statements).not.toMatch(/^CREATE TABLE/m);
    // Exactly the SQL type of lease_fencing_counter (migration 0004), nullable, no default.
    expect(migrations[3]!.sql).toMatch(/^\s+lease_fencing_counter\s+bigint\s+NOT NULL DEFAULT 0,$/m);
    expect([...statements.matchAll(/ADD COLUMN (\w+) (\w+) (\w+)/g)].map((match) => [match[1], match[2], match[3]])).toEqual([
      ["submitting_fencing_counter", "bigint", "NULL"],
    ]);
    expect(statements).not.toMatch(/\bDEFAULT\b/);
    // No backfill: nothing is written to execution_attempts except through the guard.
    expect(statements).not.toMatch(/^\s*UPDATE\b/im);
    expect(statements).not.toMatch(/audit_events/);
    expect(epoch.sql).not.toMatch(/runway|gemini|genai|veo|google/i);
    expect(statements).not.toMatch(/\bCREATE\s+(ROLE|USER)\b|^\s*GRANT\b|\bREVOKE\b/im);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b|\bCASCADE\b/i);
    expect(statements).toMatch(/^CREATE OR REPLACE FUNCTION execution_attempts_guard\(\) RETURNS trigger/m);
    expect(statements).not.toMatch(/\bDROP\b|CREATE TRIGGER/i);
    // Guard the guards.
    expect("UPDATE execution_attempts SET x = 1").toMatch(/^\s*UPDATE\b/im);
    expect("  ADD COLUMN submitting_fencing_counter bigint NULL;").toMatch(/ADD COLUMN (\w+) (\w+) (\w+)/);
  });

  it("adds provider-verification persistence in 0010 only, without generation binding, provider brands or plaintext lease tokens", async () => {
    const migrations = await discoverMigrations();
    const verification = migrations[9]!;
    const withoutComments = (sql: string) => sql.replace(/--.*$/gm, "");
    const statements = withoutComments(verification.sql);

    expect(verification.fileName).toBe("0010_provider_connection_verification_workflow.sql");
    expect(verification.sha256).toBe("5edfa48f485bda7795ee10d1f6405bad407f289af2493a0fca2a9dbe1af82bea");
    expect([...statements.matchAll(/^CREATE TABLE (\w+)/gm)].map((match) => match[1])).toEqual([
      "provider_verification_jobs",
    ]);

    expect(statements).not.toMatch(/generation_authorization_id|execution_job_id|execution_attempt_id/);
    expect(verification.sql).not.toMatch(/runway|google|gemini|genai|veo/i);
    expect(statements).not.toMatch(/\bCREATE\s+(ROLE|USER)\b|^\s*GRANT\b/im);

    const PLAIN_TOKEN_COLUMN = /^\s+\w*lease_token\s+(text|jsonb|bytea)/im;
    expect(statements).not.toMatch(PLAIN_TOKEN_COLUMN);
    expect(statements).toMatch(/^\s+lease_token_sha256\s+text\s+NULL,/m);

    expect(statements).toMatch(/CREATE UNIQUE INDEX provider_verification_jobs_one_open_per_version_uq/);
    expect(statements).toMatch(/WHERE state IN \('QUEUED', 'LEASED', 'VERIFYING'\)/);
    expect(statements).toMatch(/CREATE FUNCTION provider_verification_jobs_guard\(\) RETURNS trigger/);
    expect(statements).toMatch(/CREATE TRIGGER provider_verification_jobs_guard/);

    // Terminal history preserves credential_granted_at after the live lease is
    // cleared; while leased, grant time must still be at or after leased_at.
    expect(statements).toMatch(
      /credential_granted_at IS NULL\s+OR leased_at IS NULL\s+OR credential_granted_at >= leased_at/,
    );
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
      "generation_usage_events",
      "generation_usage_ledger",
      "productions",
      "provider_connections",
      "provider_credential_versions",
      "provider_verification_jobs",
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
