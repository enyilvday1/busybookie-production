export type GenerationAuthorizationClaimErrorCode =
  | "GENERATION_AUTHORIZATION_CLAIM_INPUT_INVALID"
  | "PRINCIPAL_UNAVAILABLE"
  | "GENERATION_AUTHORIZATION_UNAVAILABLE"
  | "GENERATION_AUTHORIZATION_NOT_CLAIMABLE"
  | "GENERATION_AUTHORIZATION_CLAIM_EXPIRED"
  | "PRODUCTION_UNAVAILABLE"
  | "ENTITLEMENT_NOT_AVAILABLE"
  | "ENTITLEMENT_POLICY_UNSUPPORTED"
  | "PROVIDER_CONNECTION_UNAVAILABLE"
  | "CREDENTIAL_UNAVAILABLE"
  | "GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION"
  | "GENERATION_AUTHORIZATION_CLAIM_DATABASE_FAILURE";

export type ClaimPrincipalUnavailableReason =
  | "USER_NOT_FOUND"
  | "USER_DISABLED"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_DISABLED"
  | "ACCOUNT_NOT_OWNED";

const MESSAGES: Readonly<Record<GenerationAuthorizationClaimErrorCode, string>> = {
  GENERATION_AUTHORIZATION_CLAIM_INPUT_INVALID:
    "The generation authorization claim request is invalid.",
  PRINCIPAL_UNAVAILABLE:
    "No active account is available for this user.",
  GENERATION_AUTHORIZATION_UNAVAILABLE:
    "The generation authorization is not available.",
  GENERATION_AUTHORIZATION_NOT_CLAIMABLE:
    "The generation authorization cannot be claimed.",
  GENERATION_AUTHORIZATION_CLAIM_EXPIRED:
    "The generation authorization can no longer be claimed.",
  PRODUCTION_UNAVAILABLE:
    "The production is not available.",
  ENTITLEMENT_NOT_AVAILABLE:
    "No entitlement is available for this production.",
  ENTITLEMENT_POLICY_UNSUPPORTED:
    "The entitlement policy is not supported.",
  PROVIDER_CONNECTION_UNAVAILABLE:
    "The provider connection is not available for generation.",
  CREDENTIAL_UNAVAILABLE:
    "The bound provider credential is not available for generation.",
  GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION:
    "The generation authorization claim could not be completed.",
  GENERATION_AUTHORIZATION_CLAIM_DATABASE_FAILURE:
    "The generation authorization claim could not be completed.",
};

export class GenerationAuthorizationClaimError extends Error {
  override readonly name = "GenerationAuthorizationClaimError";

  constructor(
    readonly code: GenerationAuthorizationClaimErrorCode,
    options: Readonly<{
      cause?: unknown;
      reason?: ClaimPrincipalUnavailableReason;
      databaseCode?: string;
    }> = {},
  ) {
    super(
      MESSAGES[code],
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.reason = options.reason;
    this.databaseCode = options.databaseCode;
  }

  readonly reason: ClaimPrincipalUnavailableReason | undefined;
  readonly databaseCode: string | undefined;
}
