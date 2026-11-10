// Closed taxonomy for machine (worker) authentication, deliberately separate
// from customer authentication.
//
// `code` is what a future worker route may act on, and it is coarse on
// purpose: every credential or principal problem is WORKER_AUTHENTICATION_REJECTED,
// so a caller cannot learn whether a credential was malformed or revoked,
// whether the adapter recognised it, or whether a worker principal exists or
// is disabled. `reason` is a closed, server-side diagnostic for operators; it
// never contains a token, header value or database identifier.
export type WorkerAuthenticationErrorCode =
  // No Authorization credential was supplied.
  | "WORKER_AUTHENTICATION_REQUIRED"
  // A credential was supplied and was not accepted, for any reason.
  | "WORKER_AUTHENTICATION_REJECTED"
  // No decision could be reached (no adapter configured, adapter or database fault).
  | "WORKER_AUTHENTICATION_UNAVAILABLE";

export type WorkerAuthenticationFailureReason =
  | "CREDENTIAL_ABSENT"
  | "CREDENTIAL_MALFORMED"
  | "ADAPTER_REJECTED"
  | "IDENTITY_INVALID"
  | "PRINCIPAL_UNKNOWN"
  | "PRINCIPAL_DISABLED"
  | "ADAPTER_NOT_CONFIGURED"
  | "ADAPTER_FAULT"
  | "DATABASE_FAILURE";

const MESSAGES: Readonly<Record<WorkerAuthenticationErrorCode, string>> = {
  WORKER_AUTHENTICATION_REQUIRED: "Worker authentication is required.",
  WORKER_AUTHENTICATION_REJECTED: "Worker authentication was rejected.",
  WORKER_AUTHENTICATION_UNAVAILABLE: "Worker authentication is temporarily unavailable.",
};

// A retained `cause` is for server-side diagnosis only and may come from an
// adapter or the database; log `code` and `reason`, never the cause.
export class WorkerAuthenticationError extends Error {
  override readonly name = "WorkerAuthenticationError";

  constructor(
    readonly code: WorkerAuthenticationErrorCode,
    readonly reason: WorkerAuthenticationFailureReason,
    options: Readonly<{ cause?: unknown }> = {},
  ) {
    super(MESSAGES[code], options.cause === undefined ? undefined : { cause: options.cause });
  }
}
