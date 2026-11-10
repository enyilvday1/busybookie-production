export type ProviderConnectionErrorCode =
  // Malformed input or a forbidden field; rejected before persistence.
  | "PROVIDER_CONNECTION_INPUT_INVALID"
  // Well-formed provider that the capability registry does not allow.
  | "PROVIDER_UNSUPPORTED"
  // Missing, foreign and malformed connection IDs are indistinguishable.
  | "PROVIDER_CONNECTION_NOT_FOUND"
  // The trusted user or account is no longer active.
  | "ACCOUNT_UNAVAILABLE"
  // The idempotency key was already used for a different request.
  | "IDEMPOTENCY_KEY_CONFLICT"
  // The same credential is already held by a live connection of this account.
  | "DUPLICATE_CREDENTIAL"
  // Rotation supplied the credential that is already active.
  | "CREDENTIAL_UNCHANGED"
  // The connection's lifecycle state does not permit the operation.
  | "CONNECTION_STATE_CONFLICT"
  // Concurrent rotations kept invalidating the prepared version; retry later.
  | "CONCURRENT_MODIFICATION"
  // Sealing or fingerprinting is unavailable.
  | "CREDENTIAL_CRYPTO_UNAVAILABLE"
  // Persisted state contradicts an invariant; nothing is repaired.
  | "PROVIDER_CONNECTION_INVARIANT_VIOLATION"
  // The database operation failed; the transaction was rolled back.
  | "PROVIDER_CONNECTION_DATABASE_FAILURE";

// Messages are generic and never contain a credential, fingerprint, envelope,
// identity value or SQL detail. A database `cause` may contain row values, so
// logs must use `code` and `databaseCode`, never the whole cause.
export class ProviderConnectionError extends Error {
  override readonly name = "ProviderConnectionError";

  constructor(
    readonly code: ProviderConnectionErrorCode,
    options: Readonly<{ cause?: unknown; databaseCode?: string }> = {},
  ) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.databaseCode = options.databaseCode;
  }

  readonly databaseCode: string | undefined;
}
