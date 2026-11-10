import type {
  VerifiedWorkerIdentity,
  WorkerAuthenticationAdapter,
  WorkerAuthenticationCredential,
} from "../../src/workerAuthentication/workerAuthenticationAdapter.js";
import { WorkerAuthenticationError } from "../../src/workerAuthentication/workerAuthenticationError.js";

// TEST FIXTURE ONLY. A machine-authentication adapter for exercising the
// worker-authentication seam; production source cannot import it (boundary
// test). Tokens are opaque fixture keys, not secrets: a token is only looked
// up, never parsed, so nothing in it can choose the principal it maps to.
// Mappings are defined server-side by the test at construction.
//
// It can name an internal worker principal ID only because it is test-only:
// no durable external-identity binding exists yet.

export type TestWorkerCredentialFixture = Readonly<{
  token: string;
  workerPrincipalId: string;
  // Defaults to "active". A revoked credential is refused by the adapter
  // itself, independently of the principal's database status.
  status?: "active" | "revoked";
}>;

export type TestWorkerAuthenticationOptions = Readonly<{
  // Simulates a verifier outage.
  available?: () => boolean;
}>;

export function createTestWorkerAuthenticationAdapter(
  fixtures: readonly TestWorkerCredentialFixture[],
  options: TestWorkerAuthenticationOptions = {},
): WorkerAuthenticationAdapter {
  const available = options.available ?? (() => true);
  const entries = new Map<string, Readonly<{ workerPrincipalId: string; status: "active" | "revoked" }>>();
  for (const fixture of fixtures) {
    if (typeof fixture.token !== "string" || fixture.token === "") throw new Error("Test worker fixtures need a non-empty token.");
    if (entries.has(fixture.token)) throw new Error("Duplicate test worker fixture token.");
    entries.set(fixture.token, { workerPrincipalId: fixture.workerPrincipalId, status: fixture.status ?? "active" });
  }

  return Object.freeze({
    verify: async (credential: WorkerAuthenticationCredential): Promise<VerifiedWorkerIdentity> => {
      if (!available()) throw new Error("test worker authentication is unavailable");
      const entry = entries.get(credential.token);
      if (entry === undefined || entry.status === "revoked") {
        throw new WorkerAuthenticationError("WORKER_AUTHENTICATION_REJECTED", "ADAPTER_REJECTED");
      }
      return Object.freeze({ workerPrincipalId: entry.workerPrincipalId });
    },
  });
}
