import type { WorkerAuthenticationFailureReason } from "../workerAuthentication/workerAuthenticationError.js";

// The worker security log (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md
// section 30): worker authentication failures, browser-origin refusals and
// stale lease or fencing rejections. It is separate from audit_events (domain
// lifecycle), from HTTP error bodies and from debug output. No vendor is
// selected: a sink is injected, and worker routes cannot be constructed
// without one.
//
// Events are built only from closed vocabularies and server-side identifiers.
// They never carry a bearer credential, Authorization header, lease token,
// lease-token verifier, provider credential, sealed envelope, fingerprint,
// request body or free-form error text.

export type WorkerSecurityEventType =
  | "WORKER_AUTH_REQUIRED"
  | "WORKER_AUTH_REJECTED"
  | "WORKER_AUTH_UNAVAILABLE"
  | "WORKER_ORIGIN_REJECTED"
  | "WORKER_LEASE_REJECTED"
  | "WORKER_FENCING_REJECTED"
  | "WORKER_CREDENTIAL_GRANT_REJECTED"
  | "WORKER_SUBMITTING_REJECTED";

export type WorkerLeaseRejectionReason =
  // The authenticated principal is not ACTIVE when re-checked in the transaction.
  | "WORKER_NOT_ACTIVE"
  // The worker already holds its maximum number of current leases.
  | "WORKER_AT_CAPACITY"
  | "UNKNOWN_ATTEMPT"
  | "NOT_LEASED"
  | "OTHER_WORKER"
  | "FENCING_MISMATCH"
  | "TOKEN_MISMATCH"
  | "LEASE_EXPIRED"
  | "CREDENTIAL_GRANTED"
  // Credential grant only: the bound connection or exact version is no longer
  // eligible for new pre-submission work, or the immutable bindings disagree.
  | "CONNECTION_INELIGIBLE"
  | "CREDENTIAL_VERSION_INELIGIBLE"
  | "AUTHORIZATION_INCONSISTENT"
  // Invariant failure: an already-granted exact version is DESTROYED while its
  // LEASED+grant retention obligation is still open.
  | "GRANTED_VERSION_DESTROYED"
  // SUBMITTING barrier only: no credential was granted under this lease.
  | "CREDENTIAL_NOT_GRANTED"
  // Invariant failure: an already-SUBMITTING attempt's exact version is DESTROYED.
  | "SUBMITTING_VERSION_DESTROYED";

export type WorkerSecurityEventReason = WorkerAuthenticationFailureReason | WorkerLeaseRejectionReason | "ORIGIN_PRESENT";

export type WorkerSecurityEvent = Readonly<{
  type: WorkerSecurityEventType;
  reason: WorkerSecurityEventReason;
  occurredAt: string;
  // Server-generated per request.
  correlationId: string;
  // Present only once authentication has resolved the principal.
  workerPrincipalId?: string;
  // Present only when the request named a syntactically valid attempt.
  executionAttemptId?: string;
}>;

export type WorkerSecurityEventSink = Readonly<{
  // Must durably accept the event or reject; a rejection fails the request
  // closed rather than silently dropping a required security event.
  record: (event: WorkerSecurityEvent) => Promise<void>;
}>;
