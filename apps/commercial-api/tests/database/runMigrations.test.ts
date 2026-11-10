import type { ClientBase } from "pg";
import { describe, expect, it } from "vitest";

import { MigrationError } from "../../src/database/migrationError.js";
import { parseMigrationFile } from "../../src/database/migrationFiles.js";
import { MIGRATION_LOCK_KEY } from "../../src/database/migrationLock.js";
import { runMigrations } from "../../src/database/runMigrations.js";

// Scripted stand-in for the lock-ordering and error-preservation contract.
// Real PostgreSQL locking is proven in tests/db/migrations.test.ts.

type Script = Readonly<{
  acquired?: boolean;
  unlock?: "released" | "not-held" | "throws";
  failOnSql?: string;
}>;

function fakeClient(script: Script = {}) {
  const queries: string[] = [];
  const applied: { version: number; name: string; sha256: string }[] = [];

  const query = async (sql: string, params: unknown[] = []) => {
    queries.push(sql.trim().split("\n")[0]!.trim());

    if (sql.includes("pg_try_advisory_lock")) {
      expect(params).toEqual([MIGRATION_LOCK_KEY]);
      return { rows: [{ acquired: script.acquired ?? true }] };
    }
    if (sql.includes("pg_advisory_unlock")) {
      expect(params).toEqual([MIGRATION_LOCK_KEY]);
      if (script.unlock === "throws") {
        throw Object.assign(new Error("Connection terminated"), { code: "57P01" });
      }
      return { rows: [{ released: script.unlock !== "not-held" }] };
    }
    if (sql.startsWith("SELECT version, name, sha256")) {
      return { rows: [...applied] };
    }
    if (sql.startsWith("INSERT INTO schema_migrations")) {
      applied.push({ version: params[0] as number, name: params[1] as string, sha256: params[2] as string });
      return { rows: [] };
    }
    if (script.failOnSql !== undefined && sql === script.failOnSql) {
      throw Object.assign(new Error("syntax error"), { code: "42601" });
    }
    return { rows: [] };
  };

  return { client: { query } as unknown as ClientBase, queries };
}

const migrations = [
  parseMigrationFile("0001_first.sql", new TextEncoder().encode("SELECT 1;\n")),
  parseMigrationFile("0002_second.sql", new TextEncoder().encode("SELECT 2;\n")),
];

describe("runMigrations session lock", () => {
  it("acquires the session lock once before any transaction and releases it once at the end", async () => {
    const { client, queries } = fakeClient();

    const result = await runMigrations(client, migrations);

    expect(result).toEqual({ applied: ["0001_first.sql", "0002_second.sql"], latestVersion: 2 });
    expect(queries[0]).toBe("SELECT pg_try_advisory_lock($1::bigint) AS acquired");
    expect(queries.at(-1)).toBe("SELECT pg_advisory_unlock($1::bigint) AS released");
    expect(queries.filter((sql) => sql.includes("advisory"))).toHaveLength(2);
    expect(queries.filter((sql) => sql === "BEGIN")).toHaveLength(3);
    expect(queries.filter((sql) => sql === "COMMIT")).toHaveLength(3);
  });

  it("refuses without bootstrapping or executing anything when the lock is held elsewhere", async () => {
    const { client, queries } = fakeClient({ acquired: false });

    await expect(runMigrations(client, migrations)).rejects.toMatchObject({ code: "MIGRATION_LOCKED" });
    expect(queries).toEqual(["SELECT pg_try_advisory_lock($1::bigint) AS acquired"]);
  });

  it("fails explicitly when a successful run cannot confirm the unlock", async () => {
    const { client } = fakeClient({ unlock: "not-held" });

    const run = runMigrations(client, migrations);
    await expect(run).rejects.toBeInstanceOf(MigrationError);
    await expect(run).rejects.toMatchObject({ code: "MIGRATION_LOCK_RELEASE_FAILED" });
  });

  it("propagates an unlock query failure after an otherwise successful run", async () => {
    const { client } = fakeClient({ unlock: "throws" });

    await expect(runMigrations(client, migrations)).rejects.toMatchObject({ code: "57P01" });
  });

  it.each(["throws", "not-held"] as const)(
    "preserves the primary migration error when the unlock %s",
    async (unlock) => {
      const { client, queries } = fakeClient({ unlock, failOnSql: "SELECT 2;\n" });

      await expect(runMigrations(client, migrations)).rejects.toMatchObject({ code: "42601", message: "syntax error" });
      expect(queries).toContain("ROLLBACK");
      expect(queries.at(-1)).toBe("SELECT pg_advisory_unlock($1::bigint) AS released");
    },
  );

  it("releases the lock after a validation failure", async () => {
    const { client, queries } = fakeClient();
    await runMigrations(client, migrations);
    queries.length = 0;

    // Both versions are now applied but no committed files are supplied.
    await expect(runMigrations(client, [])).rejects.toMatchObject({ code: "MIGRATION_UNKNOWN_APPLIED" });
    expect(queries[0]).toBe("SELECT pg_try_advisory_lock($1::bigint) AS acquired");
    expect(queries).toContain("ROLLBACK");
    expect(queries.at(-1)).toBe("SELECT pg_advisory_unlock($1::bigint) AS released");
  });
});
