export type ProductionCreationErrorCode =
  // The input is malformed or names a forbidden field; rejected before SQL.
  | "PRODUCTION_INPUT_INVALID"
  // The trusted user, or that user's PERSONAL account, is missing or disabled.
  | "PRODUCTION_ACCOUNT_UNAVAILABLE"
  // No AVAILABLE FREE_BYO grant, or its policy permits no further Production.
  | "ENTITLEMENT_NOT_AVAILABLE"
  // The grant was issued under a policy version this code does not know.
  | "ENTITLEMENT_POLICY_UNSUPPORTED"
  // The idempotency key was already used for a different creation request.
  | "IDEMPOTENCY_KEY_CONFLICT"
  // Persisted state contradicts a locked invariant; nothing is repaired.
  | "PRODUCTION_INVARIANT_VIOLATION"
  // The database operation failed; the transaction was rolled back.
  | "PRODUCTION_DATABASE_FAILURE";

export type AccountUnavailableReason = "USER_NOT_FOUND" | "USER_DISABLED" | "ACCOUNT_NOT_FOUND" | "ACCOUNT_DISABLED";

// Messages are safe for a future HTTP boundary: no SQL, parameters, titles,
// identity values or connection details. A database `cause` can contain row
// values (for example a constraint violation's detail), so logs must use
// `code` and `databaseCode`, never the whole cause.
export class ProductionCreationError extends Error {
  override readonly name = "ProductionCreationError";

  constructor(
    readonly code: ProductionCreationErrorCode,
    message: string,
    options: Readonly<{ cause?: unknown; reason?: AccountUnavailableReason; databaseCode?: string }> = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.reason = options.reason;
    this.databaseCode = options.databaseCode;
  }

  readonly reason: AccountUnavailableReason | undefined;
  readonly databaseCode: string | undefined;
}
