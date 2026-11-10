import { describe, expect, it } from "vitest";

import { parseMigrationFile } from "../../src/database/migrationFiles.js";
import type { RuntimePool } from "../../src/database/runtimePool.js";
import { createReadinessCheck, RuntimeDatabaseError, verifyRuntimeDatabase } from "../../src/database/verifyRuntimeDatabase.js";

const first = parseMigrationFile("0001_first.sql", new TextEncoder().encode("SELECT 1;\n"));
const second = parseMigrationFile("0002_second.sql", new TextEncoder().encode("SELECT 2;\n"));

const SAFE_FACTS = {
  version_num: 160013,
  rolsuper: false,
  rolcreatedb: false,
  rolcreaterole: false,
  rolreplication: false,
  rolbypassrls: false,
  owns_database: false,
  can_create_in_database: false,
  can_create_in_public: false,
  owned_public_objects: 0,
};

type Applied = { version: number; name: string; sha256: string };

function fakePool(
  options: Readonly<{
    facts?: Partial<typeof SAFE_FACTS>;
    tablePresent?: boolean;
    applied?: Applied[];
    fail?: Error;
  }> = {},
): RuntimePool {
  return {
    query: async <Row extends object>(sql: string) => {
      if (options.fail) {
        throw options.fail;
      }
      if (sql.includes("server_version_num")) {
        return { rows: [{ ...SAFE_FACTS, ...options.facts }] as unknown as Row[] };
      }
      if (sql.includes("to_regclass")) {
        return { rows: [{ present: options.tablePresent ?? true }] as unknown as Row[] };
      }
      return { rows: (options.applied ?? []) as unknown as Row[] };
    },
    end: async () => {},
  };
}

const appliedFirst: Applied = { version: 1, name: first.name, sha256: first.sha256 };

async function expectFailure(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(RuntimeDatabaseError);
  await expect(promise).rejects.toMatchObject({ code, message: code });
}

describe("verifyRuntimeDatabase", () => {
  it("accepts a safe PostgreSQL 16 session at the latest committed migration", async () => {
    await expect(verifyRuntimeDatabase(fakePool({ applied: [appliedFirst] }), [first])).resolves.toEqual({
      latestVersion: 1,
      latestSha256: first.sha256,
    });
  });

  it("reports a connectivity failure with only the driver code", async () => {
    const promise = verifyRuntimeDatabase(fakePool({ fail: Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), { code: "ECONNREFUSED" }) }), [first]);
    await expectFailure(promise, "DATABASE_CONNECTION_FAILED");
    await expect(promise).rejects.toMatchObject({ detail: "ECONNREFUSED" });
  });

  it("rejects a server older than PostgreSQL 16", async () => {
    await expectFailure(verifyRuntimeDatabase(fakePool({ facts: { version_num: 150015 }, applied: [appliedFirst] }), [first]), "DATABASE_VERSION_UNSUPPORTED");
  });

  it.each([
    ["superuser", { rolsuper: true }],
    ["CREATEDB", { rolcreatedb: true }],
    ["CREATEROLE", { rolcreaterole: true }],
    ["REPLICATION", { rolreplication: true }],
    ["BYPASSRLS", { rolbypassrls: true }],
    ["database owner", { owns_database: true }],
    ["database CREATE", { can_create_in_database: true }],
    ["schema CREATE", { can_create_in_public: true }],
    ["object owner", { owned_public_objects: 3 }],
  ])("rejects a runtime session with %s authority", async (_label, facts) => {
    await expectFailure(verifyRuntimeDatabase(fakePool({ facts, applied: [appliedFirst] }), [first]), "DATABASE_ROLE_UNSAFE");
  });

  it("reports a missing schema_migrations table", async () => {
    await expectFailure(verifyRuntimeDatabase(fakePool({ tablePresent: false }), [first]), "SCHEMA_MISSING");
  });

  it("reports an empty schema_migrations table as missing", async () => {
    await expectFailure(verifyRuntimeDatabase(fakePool({ applied: [] }), [first]), "SCHEMA_MISSING");
  });

  it("reports a schema behind the committed migrations", async () => {
    await expectFailure(verifyRuntimeDatabase(fakePool({ applied: [appliedFirst] }), [first, second]), "SCHEMA_BEHIND");
  });

  it("reports a schema ahead of the committed migrations", async () => {
    const applied = [appliedFirst, { version: 2, name: second.name, sha256: second.sha256 }];
    await expectFailure(verifyRuntimeDatabase(fakePool({ applied }), [first]), "SCHEMA_AHEAD");
  });

  it.each([
    ["checksum", { ...appliedFirst, sha256: "0".repeat(64) }],
    ["name", { ...appliedFirst, name: "renamed" }],
  ])("reports %s drift", async (_label, row) => {
    await expectFailure(verifyRuntimeDatabase(fakePool({ applied: [row] }), [first]), "SCHEMA_DRIFT");
  });

  it("reports an unknown applied version below the latest as drift", async () => {
    const third = parseMigrationFile("0003_third.sql", new TextEncoder().encode("SELECT 3;\n"));
    const applied = [appliedFirst, { version: 2, name: "unknown", sha256: "1".repeat(64) }, { version: 3, name: third.name, sha256: third.sha256 }];
    await expectFailure(verifyRuntimeDatabase(fakePool({ applied }), [first, third]), "SCHEMA_DRIFT");
  });
});

describe("createReadinessCheck", () => {
  const verified = { latestVersion: 1, latestSha256: first.sha256 };

  const probePool = (query: RuntimePool["query"]): RuntimePool => ({ query, end: async () => {} });

  it("is ready when the latest applied migration matches the verified one", async () => {
    const check = createReadinessCheck(
      probePool(async <Row extends object>() => ({ rows: [{ version: 1, sha256: first.sha256 }] as unknown as Row[] })),
      verified,
      1000,
    );
    await expect(check()).resolves.toBe(true);
  });

  it.each([
    ["a different checksum", [{ version: 1, sha256: "0".repeat(64) }]],
    ["a newer applied version", [{ version: 2, sha256: first.sha256 }]],
    ["no rows", []],
  ])("is not ready with %s", async (_label, rows) => {
    const check = createReadinessCheck(probePool(async <Row extends object>() => ({ rows: rows as unknown as Row[] })), verified, 1000);
    await expect(check()).resolves.toBe(false);
  });

  it("is not ready when the query fails", async () => {
    const check = createReadinessCheck(
      probePool(async () => {
        throw new Error("Cannot use a pool after calling end on the pool");
      }),
      verified,
      1000,
    );
    await expect(check()).resolves.toBe(false);
  });

  it("is not ready, within its bound, when the query hangs", async () => {
    const check = createReadinessCheck(probePool(() => new Promise(() => {})), verified, 50);
    const started = Date.now();
    await expect(check()).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
