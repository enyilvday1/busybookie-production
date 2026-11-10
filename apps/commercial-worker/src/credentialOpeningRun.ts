import { parseSealedEnvelope, validateSealingContext, type CredentialOpener } from "./credentialContracts.js";
import { assertNoProviderEnvironment, type WorkerEnvironment } from "./providerEnvironment.js";
import type { WorkerControlClient } from "./workerControlClient.js";
import { WorkerError, type WorkerErrorCode } from "./workerError.js";

// One unit of private-worker work for this slice (R44B6I), ending at the
// proof that the exact granted credential can be opened:
//
//   startup check -> lease -> exact credential grant -> validate envelope and
//   context -> open in memory -> STOP
//
// It never enters SUBMITTING, never builds a provider client, never calls a
// provider, writes nothing to disk and keeps no journal (there is no provider
// acceptance to record yet). The plaintext exists only inside openAndDiscard
// and is never returned, logged, persisted or placed in an error; JavaScript
// gives no zeroisation guarantee, so the code only drops every reference as
// soon as the check is done.

export type WorkerLogEvent = Readonly<{
  stage: "STARTUP" | "LEASE" | "GRANT" | "OPEN" | "DONE";
  outcome: "OK" | "NO_WORK" | "FAILED";
  code?: WorkerErrorCode;
  executionAttemptId?: string;
  provider?: string;
}>;

export type CredentialOpeningRunDependencies = Readonly<{
  environment: WorkerEnvironment;
  client: WorkerControlClient;
  // Injected; only a test implementation exists in this slice.
  opener: CredentialOpener;
  now?: () => Date;
  // Optional, safe fields only (never a token, envelope, context or credential).
  log?: (event: WorkerLogEvent) => void;
}>;

export type CredentialOpeningRunResult =
  | Readonly<{ status: "NO_WORK" }>
  | Readonly<{
      status: "CREDENTIAL_OPENED";
      executionJobId: string;
      executionAttemptId: string;
      provider: string;
      fencingCounter: number;
      credentialOpened: true;
    }>;

// Conservative retries: only transport or 5xx failures, a fixed small number
// of times, and the grant retry reuses exactly the same attempt, fencing
// generation and lease token (the grant is idempotent under the same lease).
// Authentication refusals, protocol refusals and malformed responses are
// never retried, and no second lease is ever requested while one is held.
const MAX_ATTEMPTS = 2;

async function retryUnavailable<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof WorkerError) || error.code !== "CONTROL_API_UNAVAILABLE" || attempt >= MAX_ATTEMPTS) throw error;
    }
  }
}

// Opens the credential and runs `use` while the plaintext is in scope. In
// this slice `use` only proves a non-empty credential was obtained.
async function openAndDiscard(opener: CredentialOpener, envelope: unknown, context: unknown, use: (credential: string) => boolean): Promise<boolean> {
  let credential: string | null = null;
  try {
    credential = await opener.open(envelope, context as Parameters<CredentialOpener["open"]>[1]);
    return use(credential);
  } catch {
    throw new WorkerError("CREDENTIAL_OPEN_FAILED");
  } finally {
    credential = null;
  }
}

export async function runCredentialOpeningOnce(dependencies: CredentialOpeningRunDependencies): Promise<CredentialOpeningRunResult> {
  const log = dependencies.log ?? (() => {});
  const now = dependencies.now ?? (() => new Date());
  const fail = (stage: WorkerLogEvent["stage"], error: unknown, context: Pick<WorkerLogEvent, "executionAttemptId" | "provider"> = {}): never => {
    const code = error instanceof WorkerError ? error.code : "CONTROL_API_UNAVAILABLE";
    log({ stage, outcome: "FAILED", code, ...context });
    throw error instanceof WorkerError ? error : new WorkerError(code);
  };

  try {
    assertNoProviderEnvironment(dependencies.environment);
  } catch (error) {
    return fail("STARTUP", error);
  }

  let lease;
  try {
    lease = await retryUnavailable(() => dependencies.client.leaseNextAttempt());
  } catch (error) {
    return fail("LEASE", error);
  }
  if (lease === null) {
    log({ stage: "LEASE", outcome: "NO_WORK" });
    return Object.freeze({ status: "NO_WORK" });
  }
  const safe = { executionAttemptId: lease.executionAttemptId, provider: lease.provider };
  log({ stage: "LEASE", outcome: "OK", ...safe });

  // Never continue on an expired lease; the control plane enforces this too.
  if (lease.leaseExpiresAt.getTime() <= now().getTime()) return fail("GRANT", new WorkerError("LEASE_EXPIRED"), safe);

  let grant;
  try {
    const proof = { fencingCounter: lease.fencingCounter, leaseToken: lease.leaseToken };
    grant = await retryUnavailable(() => dependencies.client.requestCredentialGrant(lease.executionAttemptId, proof));
  } catch (error) {
    return fail("GRANT", error, safe);
  }
  log({ stage: "GRANT", outcome: "OK", ...safe });

  // The grant response is the only authority for the opening context; it is
  // never reconstructed from the lease, the provider name, local state or the
  // environment. Both envelope and context must be exactly the shared formats.
  let envelope: unknown;
  let context: ReturnType<typeof validateSealingContext>;
  try {
    envelope = parseSealedEnvelope(grant.sealedEnvelope).envelope;
    context = validateSealingContext(grant.openingContext);
  } catch {
    return fail("OPEN", new WorkerError("ENVELOPE_INVALID"), safe);
  }
  if (context.provider !== lease.provider) return fail("OPEN", new WorkerError("ENVELOPE_INVALID"), safe);

  let opened: boolean;
  try {
    opened = await openAndDiscard(dependencies.opener, envelope, context, (credential) => credential.length > 0);
  } catch (error) {
    return fail("OPEN", error, safe);
  }
  if (!opened) return fail("OPEN", new WorkerError("CREDENTIAL_OPEN_FAILED"), safe);

  log({ stage: "DONE", outcome: "OK", ...safe });
  return Object.freeze({
    status: "CREDENTIAL_OPENED",
    executionJobId: lease.executionJobId,
    executionAttemptId: lease.executionAttemptId,
    provider: lease.provider,
    fencingCounter: grant.fencingCounter,
    credentialOpened: true,
  });
}
