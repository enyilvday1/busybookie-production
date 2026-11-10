export type ProvisioningErrorCode =
  // The identity input is malformed; rejected before any SQL.
  | "PROVISIONING_INPUT_INVALID"
  // The identity is valid but must not be provisioned (for example a disabled User).
  | "PROVISIONING_REFUSED"
  // Persisted state contradicts a locked invariant; nothing is repaired.
  | "PROVISIONING_INVARIANT_VIOLATION"
  // The database operation failed; the transaction was rolled back.
  | "PROVISIONING_DATABASE_FAILURE";

export type ProvisioningRefusalReason = "USER_DISABLED" | "ACCOUNT_DISABLED";

// Messages are safe for a future HTTP boundary: no SQL, parameters, host,
// role, connection details or identity values. The originating database
// error, when there is one, is kept as `cause` for server-side diagnostics.
export class ProvisioningError extends Error {
  override readonly name = "ProvisioningError";

  constructor(
    readonly code: ProvisioningErrorCode,
    message: string,
    options: Readonly<{ cause?: unknown; reason?: ProvisioningRefusalReason; databaseCode?: string }> = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.reason = options.reason;
    this.databaseCode = options.databaseCode;
  }

  readonly reason: ProvisioningRefusalReason | undefined;
  // PostgreSQL SQLSTATE or driver code of the underlying failure, when known.
  readonly databaseCode: string | undefined;
}
