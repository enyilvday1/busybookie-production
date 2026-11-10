export type MigrationErrorCode =
  | "MIGRATION_FILENAME_INVALID"
  | "MIGRATION_ENTRY_INVALID"
  | "MIGRATION_VERSION_DUPLICATE"
  | "MIGRATION_CONTENT_INVALID"
  | "MIGRATION_LOCKED"
  | "MIGRATION_LOCK_RELEASE_FAILED"
  | "MIGRATION_NAME_MISMATCH"
  | "MIGRATION_CHECKSUM_DRIFT"
  | "MIGRATION_UNKNOWN_APPLIED"
  | "MIGRATION_OUT_OF_ORDER"
  | "RUNTIME_ROLE_INVALID"
  | "RUNTIME_GRANT_SCHEMA_MISMATCH"
  | "DATABASE_CONFIG_INVALID";

// Expected, operator-actionable failures. Messages never contain credentials.
export class MigrationError extends Error {
  override readonly name = "MigrationError";

  constructor(
    readonly code: MigrationErrorCode,
    message: string,
  ) {
    super(message);
  }
}
