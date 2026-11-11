// Closed worker-side error taxonomy. Messages are fixed text: they never
// contain the machine credential, a lease token, a sealed envelope, a
// provider credential, a response body or a URL. No cause is retained, so
// nothing from a transport, the control plane or an opener can be logged by
// accident.
export type WorkerErrorCode =
  // The provider-global environment fallback is present (startup refusal).
  | "FORBIDDEN_PROVIDER_ENVIRONMENT"
  // Worker configuration is unusable (control-plane URL or machine credential shape).
  | "WORKER_CONFIGURATION_INVALID"
  // The control plane could not be reached or answered 5xx.
  | "CONTROL_API_UNAVAILABLE"
  // The control plane refused the worker's machine authentication.
  | "WORKER_AUTHENTICATION_REJECTED"
  // Lease acquisition was refused (for example the worker is at capacity).
  | "LEASE_REJECTED"
  // The lease expired before the credential could be obtained.
  | "LEASE_EXPIRED"
  // A control-plane response did not match the protocol exactly.
  | "MALFORMED_CONTROL_RESPONSE"
  // The credential grant was refused (stale or foreign lease, ineligible credential, ...).
  | "CREDENTIAL_GRANT_REJECTED"
  // The granted sealed envelope or opening context is not the supported format.
  | "ENVELOPE_INVALID"
  // The opener refused the envelope under the granted context.
  | "CREDENTIAL_OPEN_FAILED"
  // A submitted report was not sent because its input is not the contract.
  | "SUBMITTED_REPORT_INVALID"
  // The control plane refused a submitted report (stale or foreign lease,
  // replacement epoch, conflicting or already-adopted provider execution ID).
  | "SUBMITTED_REPORT_REJECTED";

const MESSAGES: Readonly<Record<WorkerErrorCode, string>> = {
  FORBIDDEN_PROVIDER_ENVIRONMENT: "Provider credential or provider configuration variables must not be present in the commercial worker environment.",
  WORKER_CONFIGURATION_INVALID: "The commercial worker configuration is invalid.",
  CONTROL_API_UNAVAILABLE: "The worker-control API is unavailable.",
  WORKER_AUTHENTICATION_REJECTED: "The worker-control API rejected the worker's authentication.",
  LEASE_REJECTED: "The worker-control API rejected the lease request.",
  LEASE_EXPIRED: "The lease expired before the credential was obtained.",
  MALFORMED_CONTROL_RESPONSE: "The worker-control API returned a malformed response.",
  CREDENTIAL_GRANT_REJECTED: "The worker-control API rejected the credential grant.",
  ENVELOPE_INVALID: "The granted credential envelope is invalid.",
  CREDENTIAL_OPEN_FAILED: "The granted credential could not be opened.",
  SUBMITTED_REPORT_INVALID: "The submitted report is invalid and was not sent.",
  SUBMITTED_REPORT_REJECTED: "The worker-control API rejected the submitted report.",
};

export class WorkerError extends Error {
  override readonly name = "WorkerError";

  constructor(readonly code: WorkerErrorCode) {
    super(MESSAGES[code]);
  }
}
