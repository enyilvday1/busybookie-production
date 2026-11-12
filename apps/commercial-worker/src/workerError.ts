// Closed worker-side error taxonomy. Messages are fixed text: they never
// contain the machine credential, a lease token, a sealed envelope, a
// provider credential, a response body or a URL. No cause is retained, so
// nothing from a transport, the control plane or an opener can be logged by
// accident.
export type WorkerErrorCode =
  | "STATE_ROOT_UNSUITABLE"
  | "ACCEPTANCE_RECONCILIATION_FAILED"
  | "ACCEPTANCE_JOURNAL_CORRUPT"
  | "ACCEPTANCE_JOURNAL_CONFLICT"
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
  // The control plane refused the SUBMITTING acknowledgement (R44B6U0); no
  // provider-call authority was granted.
  | "SUBMITTING_REJECTED"
  // The control plane refused a lease renewal (R44B6W0). Never proves that an
  // earlier heartbeat did not renew.
  | "HEARTBEAT_REJECTED"
  // The control plane refused a submitted report (stale or foreign lease,
  // replacement epoch, conflicting or already-adopted provider execution ID).
  | "SUBMITTED_REPORT_REJECTED"
  // The control plane refused a submission failure report (R44B6Y0).
  | "SUBMISSION_FAILED_REJECTED"
  // The control plane refused an input-failed report (R44B10P2): stale or
  // foreign lease, no grant, or a conflicting committed report.
  | "INPUT_FAILED_REJECTED"
  // A provider acceptance was invalid, mismatched or repeated (R44B6Y0); no
  // durable acceptance was recorded for it.
  | "PROVIDER_ACCEPTANCE_INVALID"
  // The acceptance record could not be made durable (R44B6Y0).
  | "ACCEPTANCE_JOURNAL_WRITE_FAILED"
  // R44B9: a fake-only worker leased an attempt for another provider; it
  // stopped before any credential grant and left the lease to expire.
  | "LEASED_PROVIDER_INCOMPATIBLE"
  // R44B10A: the leased attempt's authorized request (generationRequest or
  // cost unit) is outside the locked real-provider contract; an issuer
  // invariant violation refused before any credential grant.
  | "LEASED_REQUEST_INVALID"
  // R44B9: a provider operation broke the submission-phase contract (an
  // untyped throw, ACCEPTED without durable acceptance, or a failure after it).
  | "PROVIDER_CONTRACT_VIOLATION"
  // R44B10P1: commercial input media (section 28, "Object-storage input
  // contract"). None of them is a provider outcome.
  | "OBJECT_REFERENCE_INVALID"
  | "OBJECT_NOT_FOUND"
  | "OBJECT_STORAGE_UNAVAILABLE"
  | "OBJECT_STORAGE_ACCESS_DENIED"
  | "OBJECT_TOO_LARGE"
  | "OBJECT_INTEGRITY_MISMATCH"
  | "OBJECT_MEDIA_TYPE_INVALID";

const MESSAGES: Readonly<Record<WorkerErrorCode, string>> = {
  STATE_ROOT_UNSUITABLE: "The worker state root is unsuitable for the acceptance journal.",
  ACCEPTANCE_RECONCILIATION_FAILED: "Acceptance evidence remains unresolved; new work is blocked.",
  ACCEPTANCE_JOURNAL_CORRUPT: "The acceptance journal requires operator attention; new work is blocked.",
  ACCEPTANCE_JOURNAL_CONFLICT: "The acceptance journal has conflicting evidence; new work is blocked.",
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
  SUBMITTING_REJECTED: "The worker-control API rejected the SUBMITTING acknowledgement.",
  HEARTBEAT_REJECTED: "The worker-control API rejected the lease heartbeat.",
  SUBMITTED_REPORT_INVALID: "The submitted report is invalid and was not sent.",
  SUBMITTED_REPORT_REJECTED: "The worker-control API rejected the submitted report.",
  SUBMISSION_FAILED_REJECTED: "The worker-control API rejected the submission failure report.",
  INPUT_FAILED_REJECTED: "The worker-control API rejected the input failure report.",
  PROVIDER_ACCEPTANCE_INVALID: "The provider acceptance is invalid; new work is blocked.",
  ACCEPTANCE_JOURNAL_WRITE_FAILED: "The acceptance record could not be made durable; new work is blocked.",
  LEASED_PROVIDER_INCOMPATIBLE: "The leased attempt's provider is not supported by this worker; new work is blocked.",
  LEASED_REQUEST_INVALID: "The leased attempt's authorized request is outside the supported contract; new work is blocked.",
  PROVIDER_CONTRACT_VIOLATION: "The provider operation broke its submission contract; new work is blocked.",
  OBJECT_REFERENCE_INVALID: "The input media reference is invalid.",
  OBJECT_NOT_FOUND: "The input media object was not found.",
  OBJECT_STORAGE_UNAVAILABLE: "Object storage is unavailable.",
  OBJECT_STORAGE_ACCESS_DENIED: "Object storage denied access to the input media; new work is blocked.",
  OBJECT_TOO_LARGE: "The input media object exceeds the permitted size.",
  OBJECT_INTEGRITY_MISMATCH: "The input media object does not match its reference.",
  OBJECT_MEDIA_TYPE_INVALID: "The input media content does not match its declared type.",
};

export class WorkerError extends Error {
  override readonly name = "WorkerError";

  constructor(readonly code: WorkerErrorCode) {
    super(MESSAGES[code]);
  }
}
