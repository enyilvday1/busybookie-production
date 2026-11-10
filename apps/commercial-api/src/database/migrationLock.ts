import { createHash } from "node:crypto";

// PostgreSQL advisory-lock identity for commercial schema migrations.
//
// Derivation: the first 8 bytes of SHA-256(MIGRATION_LOCK_NAME), read as a
// big-endian signed 64-bit integer, which is exactly the bigint domain that
// pg_try_advisory_xact_lock(bigint) accepts. Deterministic and reproducible;
// changing the name is the only way to change the key.
export const MIGRATION_LOCK_NAME = "busybookie:commercial-api:schema-migrations:v1";

export function deriveAdvisoryLockKey(name: string): bigint {
  return createHash("sha256").update(name, "utf8").digest().readBigInt64BE(0);
}

// Passed to PostgreSQL as text and cast to bigint, avoiding JavaScript number precision loss.
export const MIGRATION_LOCK_KEY = deriveAdvisoryLockKey(MIGRATION_LOCK_NAME).toString();
