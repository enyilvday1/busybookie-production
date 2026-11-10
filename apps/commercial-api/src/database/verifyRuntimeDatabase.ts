import type { MigrationFile } from "./migrationFiles.js";
import type { RuntimePool } from "./runtimePool.js";

export type RuntimeDatabaseErrorCode =
  | "DATABASE_CONNECTION_FAILED"
  | "DATABASE_VERSION_UNSUPPORTED"
  | "DATABASE_ROLE_UNSAFE"
  | "SCHEMA_MISSING"
  | "SCHEMA_BEHIND"
  | "SCHEMA_AHEAD"
  | "SCHEMA_DRIFT";

// Startup verification failure. The message names the failure class only:
// no host, database, role, version, migration name or checksum.
export class RuntimeDatabaseError extends Error {
  override readonly name = "RuntimeDatabaseError";

  constructor(
    readonly code: RuntimeDatabaseErrorCode,
    readonly detail?: string,
  ) {
    super(code);
  }
}

// PostgreSQL 16 is the locked minimum compatibility baseline.
export const MINIMUM_SERVER_VERSION_NUM = 160000;

export type VerifiedSchema = Readonly<{
  latestVersion: number;
  latestSha256: string;
}>;

type SessionFacts = {
  version_num: number;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  owns_database: boolean;
  can_create_in_database: boolean;
  can_create_in_public: boolean;
  owned_public_objects: number;
};

// Role safety is checked by properties, not by name: the runtime session must
// hold no elevated attribute, must not own the database or any public schema
// object, and must not be able to create objects. A migration-owner URL
// configured by mistake therefore fails here.
const SESSION_FACTS_SQL = `
SELECT current_setting('server_version_num')::int AS version_num,
       r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
       d.datdba = r.oid AS owns_database,
       has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_in_database,
       has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public,
       (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relowner = r.oid) AS owned_public_objects
  FROM pg_roles r, pg_database d
 WHERE r.rolname = current_user AND d.datname = current_database()`;

function connectionFailure(error: unknown): RuntimeDatabaseError {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
  return new RuntimeDatabaseError("DATABASE_CONNECTION_FAILED", code);
}

// Full startup verification: connectivity, server version, runtime-role
// safety, and that every committed migration is applied with the same name
// and checksum and nothing beyond them. Never migrates or repairs anything.
export async function verifyRuntimeDatabase(
  pool: RuntimePool,
  migrations: readonly MigrationFile[],
): Promise<VerifiedSchema> {
  let facts: SessionFacts | undefined;
  try {
    facts = (await pool.query<SessionFacts>(SESSION_FACTS_SQL)).rows[0];
  } catch (error) {
    throw connectionFailure(error);
  }

  if (facts === undefined || facts.version_num < MINIMUM_SERVER_VERSION_NUM) {
    throw new RuntimeDatabaseError("DATABASE_VERSION_UNSUPPORTED");
  }

  if (
    facts.rolsuper ||
    facts.rolcreatedb ||
    facts.rolcreaterole ||
    facts.rolreplication ||
    facts.rolbypassrls ||
    facts.owns_database ||
    facts.can_create_in_database ||
    facts.can_create_in_public ||
    facts.owned_public_objects > 0
  ) {
    throw new RuntimeDatabaseError("DATABASE_ROLE_UNSAFE");
  }

  let applied: { version: number; name: string; sha256: string }[];
  try {
    const exists = await pool.query<{ present: boolean }>(
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present",
    );
    if (exists.rows[0]?.present !== true) {
      throw new RuntimeDatabaseError("SCHEMA_MISSING");
    }
    applied = (
      await pool.query<{ version: number; name: string; sha256: string }>(
        "SELECT version, name, sha256 FROM public.schema_migrations ORDER BY version",
      )
    ).rows;
  } catch (error) {
    if (error instanceof RuntimeDatabaseError) {
      throw error;
    }
    throw connectionFailure(error);
  }

  const latest = migrations.at(-1);
  if (latest === undefined) {
    throw new RuntimeDatabaseError("SCHEMA_DRIFT", "no committed migrations were found");
  }

  const committed = new Map(migrations.map((migration) => [migration.version, migration]));
  for (const row of applied) {
    const local = committed.get(row.version);
    if (local === undefined) {
      throw new RuntimeDatabaseError(row.version > latest.version ? "SCHEMA_AHEAD" : "SCHEMA_DRIFT");
    }
    if (local.name !== row.name || local.sha256 !== row.sha256) {
      throw new RuntimeDatabaseError("SCHEMA_DRIFT");
    }
  }

  const appliedVersions = new Set(applied.map((row) => row.version));
  if (migrations.some((migration) => !appliedVersions.has(migration.version))) {
    throw new RuntimeDatabaseError(applied.length === 0 ? "SCHEMA_MISSING" : "SCHEMA_BEHIND");
  }

  return Object.freeze({ latestVersion: latest.version, latestSha256: latest.sha256 });
}

// Live readiness: one bounded, indexed single-row query that proves the pool
// can reach the database and the latest applied migration is still the one
// verified at startup. Any error or timeout reports not ready.
export function createReadinessCheck(
  pool: RuntimePool,
  verified: VerifiedSchema,
  timeoutMs: number,
): () => Promise<boolean> {
  return async () => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref();
    });

    const probe = pool
      .query<{ version: number; sha256: string }>(
        "SELECT version, sha256 FROM public.schema_migrations ORDER BY version DESC LIMIT 1",
      )
      .then(
        (result) => result.rows[0]?.version === verified.latestVersion && result.rows[0]?.sha256 === verified.latestSha256,
        () => false,
      );

    try {
      return await Promise.race([probe, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}
