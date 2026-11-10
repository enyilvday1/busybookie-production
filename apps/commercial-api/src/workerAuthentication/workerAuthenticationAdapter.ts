import { WorkerAuthenticationError } from "./workerAuthenticationError.js";

// Machine authentication for the private commercial worker
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 9).
// Separate from customer authentication: a worker is a machine principal,
// never a customer User, and nothing here can yield a user, account, role or
// entitlement.
//
// The production mechanism (signed short-lived token, mTLS, workload identity)
// is undecided, so no production adapter exists. The bearer credential below
// is only the transport used to exercise this seam; it is not a decision that
// workers will use static bearer secrets.

export type WorkerAuthenticationCredential = Readonly<{
  scheme: "bearer";
  // Opaque. Must never be logged, persisted or echoed in an error.
  token: string;
}>;

// The verified machine identity an adapter returns.
//
// worker_principals has no durable external-identity binding yet (migration
// 0004 deliberately left it to the mechanism decision), so this seam carries
// the internal worker principal ID directly. Only the test adapter can produce
// one. A production adapter will instead yield an external machine subject
// that the server maps to a principal through a binding added together with
// the mechanism; it will never be trusted to name a principal itself.
//
// Whether the principal exists and is ACTIVE is never decided by the
// adapter: the database is authoritative on every request.
export type VerifiedWorkerIdentity = Readonly<{
  workerPrincipalId: string;
}>;

export type WorkerAuthenticationAdapter = Readonly<{
  // Resolves with the verified identity, or rejects with a
  // WorkerAuthenticationError (REJECTED for any credential the adapter does
  // not accept). Any other failure is treated as UNAVAILABLE.
  verify: (credential: WorkerAuthenticationCredential) => Promise<VerifiedWorkerIdentity>;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Re-validates adapter output against the contract. Any extra member (an
// account, user, status, scope, lease or credential claim) is rejected rather
// than ignored, so it can never travel onward as if it were trusted.
export function createVerifiedWorkerIdentity(claims: unknown): VerifiedWorkerIdentity {
  if (
    typeof claims !== "object" ||
    claims === null ||
    Array.isArray(claims) ||
    Object.keys(claims).length !== 1 ||
    !("workerPrincipalId" in claims) ||
    typeof claims.workerPrincipalId !== "string" ||
    !UUID_PATTERN.test(claims.workerPrincipalId)
  ) {
    throw new WorkerAuthenticationError("WORKER_AUTHENTICATION_UNAVAILABLE", "IDENTITY_INVALID");
  }
  return Object.freeze({ workerPrincipalId: claims.workerPrincipalId });
}
