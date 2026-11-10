import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MigrationError } from "./migrationError.js";

// Committed migrations live beside src/ and dist/ at the app root.
export const DEFAULT_MIGRATIONS_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

export type MigrationFile = Readonly<{
  version: number;
  name: string;
  fileName: string;
  sql: string;
  sha256: string;
}>;

// NNNN_lowercase_words.sql, for example 0001_commercial_schema_v1.sql.
const FILE_NAME_PATTERN = /^([0-9]{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
const MAX_NAME_LENGTH = 100;

// The runner owns each migration's transaction; a file must not end or open one.
const TRANSACTION_CONTROL_PATTERN = /^\s*(?:(?:BEGIN|COMMIT|ROLLBACK)(?:\s+(?:WORK|TRANSACTION))?\s*;|START\s+TRANSACTION\b)/im;

export function parseMigrationFileName(fileName: string): Readonly<{ version: number; name: string }> {
  const match = FILE_NAME_PATTERN.exec(fileName);
  const version = match ? Number(match[1]) : 0;
  const name = match?.[2] ?? "";

  if (!match || version < 1 || name.length > MAX_NAME_LENGTH) {
    throw new MigrationError("MIGRATION_FILENAME_INVALID", `Migration file name is not NNNN_name.sql: ${fileName}`);
  }

  return { version, name };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseMigrationFile(fileName: string, bytes: Uint8Array): MigrationFile {
  const { version, name } = parseMigrationFileName(fileName);

  let sql: string;
  try {
    sql = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new MigrationError("MIGRATION_CONTENT_INVALID", `Migration ${fileName} is not valid UTF-8.`);
  }

  // Checksums are over exact bytes, so line endings must be platform-stable.
  if (sql.includes("\r")) {
    throw new MigrationError("MIGRATION_CONTENT_INVALID", `Migration ${fileName} contains CR characters; use LF line endings.`);
  }

  if (sql.trim() === "") {
    throw new MigrationError("MIGRATION_CONTENT_INVALID", `Migration ${fileName} is empty.`);
  }

  if (TRANSACTION_CONTROL_PATTERN.test(sql)) {
    throw new MigrationError("MIGRATION_CONTENT_INVALID", `Migration ${fileName} contains transaction control statements.`);
  }

  return Object.freeze({ version, name, fileName, sql, sha256: sha256Hex(bytes) });
}

// Validates a whole set: no duplicate versions; returned in ascending version order.
export function orderMigrations(migrations: readonly MigrationFile[]): readonly MigrationFile[] {
  const seen = new Map<number, string>();

  for (const migration of migrations) {
    const previous = seen.get(migration.version);
    if (previous !== undefined) {
      throw new MigrationError(
        "MIGRATION_VERSION_DUPLICATE",
        `Migration version ${migration.version} is used by both ${previous} and ${migration.fileName}.`,
      );
    }
    seen.set(migration.version, migration.fileName);
  }

  return Object.freeze([...migrations].sort((left, right) => left.version - right.version));
}

// Every directory entry must be a well-formed migration file; nothing is ignored.
export async function discoverMigrations(directory: string = DEFAULT_MIGRATIONS_DIRECTORY): Promise<readonly MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const migrations: MigrationFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      throw new MigrationError("MIGRATION_ENTRY_INVALID", `Unexpected non-file entry in migrations directory: ${entry.name}`);
    }
    migrations.push(parseMigrationFile(entry.name, await readFile(join(directory, entry.name))));
  }

  return orderMigrations(migrations);
}
