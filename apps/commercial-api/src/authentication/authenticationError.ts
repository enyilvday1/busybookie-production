export type AuthenticationErrorCode =
  // No credential was supplied.
  | "AUTHENTICATION_REQUIRED"
  // A credential was supplied but is malformed, duplicated or of an unsupported scheme.
  | "AUTHENTICATION_MALFORMED"
  // The credential is well formed but not valid (unknown, bad signature, wrong issuer/audience, ...).
  | "AUTHENTICATION_INVALID"
  // The credential was valid but has expired.
  | "AUTHENTICATION_EXPIRED"
  // The credential was valid but has been revoked.
  | "AUTHENTICATION_REVOKED"
  // The verifier could not reach a decision (outage, misconfiguration, adapter fault).
  | "AUTHENTICATION_UNAVAILABLE";

// Fixed, generic messages: they never contain the credential, the
// Authorization header, issuer, subject, email or configuration.
const MESSAGES: Readonly<Record<AuthenticationErrorCode, string>> = {
  AUTHENTICATION_REQUIRED: "Authentication is required.",
  AUTHENTICATION_MALFORMED: "The authentication credential is malformed.",
  AUTHENTICATION_INVALID: "The authentication credential is not valid.",
  AUTHENTICATION_EXPIRED: "The authentication credential has expired.",
  AUTHENTICATION_REVOKED: "The authentication credential has been revoked.",
  AUTHENTICATION_UNAVAILABLE: "Authentication is temporarily unavailable.",
};

// A retained `cause` is for server-side diagnosis only. It may come from a
// verifier or SDK and can contain credential or identity material, so
// callers must log `code`, never the whole cause.
export class AuthenticationError extends Error {
  override readonly name = "AuthenticationError";

  constructor(
    readonly code: AuthenticationErrorCode,
    options: Readonly<{ cause?: unknown }> = {},
  ) {
    super(MESSAGES[code], options.cause === undefined ? undefined : { cause: options.cause });
  }
}
