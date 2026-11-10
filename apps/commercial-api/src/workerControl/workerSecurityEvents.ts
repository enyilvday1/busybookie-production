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
  | "WORKER_FENCING_REJECTED";

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
  | "CREDENTIAL_GRANTED";

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
