import { AuthenticationError } from "../authentication/authenticationError.js";
import { parseBearerCredential } from "../authentication/bearerCredential.js";
import type { RuntimePool } from "../database/runtimePool.js";
import {
  createVerifiedWorkerIdentity,
  type WorkerAuthenticationAdapter,
  type WorkerAuthenticationCredential,
} from "./workerAuthenticationAdapter.js";
import { WorkerAuthenticationError } from "./workerAuthenticationError.js";

// The authenticated machine principal for a future worker-control request.
// Authentication alone grants no authority: leasing, heartbeats, credential
// grants and attempt transitions each require their own explicit service
// checks (lease, fencing, attempt state), none of which exist yet.
export type AuthenticatedWorker = Readonly<{
  workerPrincipalId: string;
  // Operator-facing label for safe operational context.
  label: string;
}>;

export type WorkerAuthenticationDependencies = Readonly<{
  // Absent in every default composition: worker authentication then fails
  // closed. There is no fallback adapter.
  adapter?: WorkerAuthenticationAdapter;
  database: Pick<RuntimePool, "query">;
}>;

const rejected = (reason: "CREDENTIAL_MALFORMED" | "ADAPTER_REJECTED" | "PRINCIPAL_UNKNOWN" | "PRINCIPAL_DISABLED") =>
  new WorkerAuthenticationError("WORKER_AUTHENTICATION_REJECTED", reason);

// Exactly the scheme, one space and the credential: machine clients have no
// reason to send the extra whitespace RFC 7235 tolerates for browsers.
const SINGLE_SPACE_SHAPE = /^\S+ \S+$/;

// The transport is the generic strict bearer parser shared with customer
// requests (exactly one Authorization value, Bearer scheme case-insensitive,
// one token68 of at most 4096 characters), plus the single-space rule above;
// only its outcome is translated into the worker taxonomy. The Authorization
// header is the only credential source: no other transport is read.
function parseWorkerCredential(authorizationValues: readonly string[]): WorkerAuthenticationCredential {
  let token: string;
  try {
    token = parseBearerCredential(authorizationValues).token;
  } catch (error) {
    if (error instanceof AuthenticationError && error.code === "AUTHENTICATION_REQUIRED") {
      throw new WorkerAuthenticationError("WORKER_AUTHENTICATION_REQUIRED", "CREDENTIAL_ABSENT");
    }
    throw rejected("CREDENTIAL_MALFORMED");
  }
  if (!SINGLE_SPACE_SHAPE.test(authorizationValues[0] ?? "")) throw rejected("CREDENTIAL_MALFORMED");
  return Object.freeze({ scheme: "bearer", token });
}

// Fail-closed machine authentication:
//   1. an adapter must be configured;
//   2. exactly one well-formed bearer credential;
//   3. the adapter verifies it and returns a contract-valid identity;
//   4. the exact worker principal exists and is ACTIVE in PostgreSQL.
// The database status is authoritative: a DISABLED principal is rejected
// however valid its credential, and an adapter can never assert a status.
export async function authenticateWorker(
  dependencies: WorkerAuthenticationDependencies,
  authorizationValues: readonly string[],
): Promise<AuthenticatedWorker> {
  const adapter = dependencies.adapter;
  if (adapter === undefined) {
    throw new WorkerAuthenticationError("WORKER_AUTHENTICATION_UNAVAILABLE", "ADAPTER_NOT_CONFIGURED");
  }

  const credential = parseWorkerCredential(authorizationValues);

  let claims: unknown;
  try {
    claims = await adapter.verify(credential);
  } catch (error) {
    if (error instanceof WorkerAuthenticationError) {
      // An adapter may refuse or report itself unavailable, never more.
      throw error.code === "WORKER_AUTHENTICATION_UNAVAILABLE"
        ? new WorkerAuthenticationError("WORKER_AUTHENTICATION_UNAVAILABLE", "ADAPTER_FAULT", { cause: error })
        : rejected("ADAPTER_REJECTED");
    }
    throw new WorkerAuthenticationError("WORKER_AUTHENTICATION_UNAVAILABLE", "ADAPTER_FAULT", { cause: error });
  }
  const identity = createVerifiedWorkerIdentity(claims);

  let rows: { id: string; label: string; status: string }[];
  try {
    rows = (
      await dependencies.database.query<{ id: string; label: string; status: string }>(
        "SELECT id, label, status FROM worker_principals WHERE id = $1",
        [identity.workerPrincipalId],
      )
    ).rows;
  } catch (error) {
    throw new WorkerAuthenticationError("WORKER_AUTHENTICATION_UNAVAILABLE", "DATABASE_FAILURE", { cause: error });
  }

  const principal = rows[0];
  if (principal === undefined || principal.id !== identity.workerPrincipalId) throw rejected("PRINCIPAL_UNKNOWN");
  if (principal.status !== "ACTIVE") throw rejected("PRINCIPAL_DISABLED");

  return Object.freeze({ workerPrincipalId: principal.id, label: principal.label });
}
