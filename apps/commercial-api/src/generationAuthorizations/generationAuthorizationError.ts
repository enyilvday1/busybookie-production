export type GenerationAuthorizationErrorCode =
  // Malformed input, an unknown member or a forbidden authority field;
  // rejected before any SQL.
  | "GENERATION_AUTHORIZATION_INPUT_INVALID"
  // The trusted User or its PERSONAL Account is missing, disabled or no longer
  // owned by that User.
  | "PRINCIPAL_UNAVAILABLE"
  // Missing, foreign or archived Production; indistinguishable to the caller.
  | "PRODUCTION_UNAVAILABLE"
  // The Production's exact creation grant is not an AVAILABLE FREE_BYO grant
  // of this Account.
  | "ENTITLEMENT_NOT_AVAILABLE"
  // The grant was issued under a FREE_BYO policy version this code does not know.
  | "ENTITLEMENT_POLICY_UNSUPPORTED"
  // Missing, foreign, non-ACTIVE or non-VERIFIED ProviderConnection.
  | "PROVIDER_CONNECTION_UNAVAILABLE"
  // The connection has no credential version, or its newest one is not ACTIVE.
  | "CREDENTIAL_UNAVAILABLE"
  // No enabled generation capability for the derived provider and the model.
  | "GENERATION_CAPABILITY_UNAVAILABLE"
  // The generation request is outside the shared contract or cannot be
  // canonicalized.
  | "GENERATION_REQUEST_INVALID"
  // The idempotency key was already used for a different issuance intent.
  | "IDEMPOTENCY_KEY_CONFLICT"
  // A generation-policy entry or its output violates the locked policy shape.
  | "GENERATION_POLICY_INVALID"
  // Persisted or derived state contradicts a locked invariant; nothing is repaired.
  | "GENERATION_AUTHORIZATION_INVARIANT_VIOLATION"
  // The database operation failed; the transaction was rolled back.
  | "GENERATION_AUTHORIZATION_DATABASE_FAILURE";

export type PrincipalUnavailableReason = "USER_NOT_FOUND" | "USER_DISABLED" | "ACCOUNT_NOT_FOUND" | "ACCOUNT_DISABLED" | "ACCOUNT_NOT_OWNED";

const MESSAGES: Readonly<Record<GenerationAuthorizationErrorCode, string>> = {
  GENERATION_AUTHORIZATION_INPUT_INVALID: "The generation authorization request is invalid.",
  PRINCIPAL_UNAVAILABLE: "No active account is available for this user.",
  PRODUCTION_UNAVAILABLE: "The production is not available.",
  ENTITLEMENT_NOT_AVAILABLE: "No entitlement is available for this production.",
  ENTITLEMENT_POLICY_UNSUPPORTED: "The entitlement policy is not supported.",
  PROVIDER_CONNECTION_UNAVAILABLE: "The provider connection is not available for generation.",
  CREDENTIAL_UNAVAILABLE: "The provider credential is not available for generation.",
  GENERATION_CAPABILITY_UNAVAILABLE: "Generation is not available for this provider and model.",
  GENERATION_REQUEST_INVALID: "The generation request is invalid.",
  IDEMPOTENCY_KEY_CONFLICT: "The idempotency key was already used for a different request.",
  GENERATION_POLICY_INVALID: "The generation policy is invalid.",
  GENERATION_AUTHORIZATION_INVARIANT_VIOLATION: "The generation authorization could not be issued.",
  GENERATION_AUTHORIZATION_DATABASE_FAILURE: "The generation authorization could not be issued.",
};

// Messages are fixed per code and safe for a future HTTP boundary: no SQL,
// parameters, prompt, object reference, credential material, identity or row
// value. A database `cause` can contain row values (for example a constraint
// violation's detail), so logs must use `code`, `reason` and `databaseCode`,
// never the whole cause.
export class GenerationAuthorizationError extends Error {
  override readonly name = "GenerationAuthorizationError";

  constructor(
    readonly code: GenerationAuthorizationErrorCode,
    options: Readonly<{ cause?: unknown; reason?: PrincipalUnavailableReason; databaseCode?: string }> = {},
  ) {
    super(MESSAGES[code], options.cause === undefined ? undefined : { cause: options.cause });
    this.reason = options.reason;
    this.databaseCode = options.databaseCode;
  }

  readonly reason: PrincipalUnavailableReason | undefined;
  readonly databaseCode: string | undefined;
}
