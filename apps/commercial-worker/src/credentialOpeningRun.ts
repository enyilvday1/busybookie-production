import { parseSealedEnvelope, validateSealingContext, type CredentialOpener, type CredentialSealingContext } from "./credentialContracts.js";
import { assertNoProviderEnvironment, type WorkerEnvironment } from "./providerEnvironment.js";
import type { LeaseProof, WorkerControlClient, WorkerLease } from "./workerControlClient.js";
import { WorkerError, type WorkerErrorCode } from "./workerError.js";
import type { AcceptanceJournal } from "./acceptanceJournal.js";
import { defaultMonotonicNow, defaultRecoverySleep, type MonotonicClock, type RecoverySleep } from "./acceptanceRecoveryPolicy.js";
import { assertStartupJournalClear } from "./startupJournalReconciliation.js";

// One unit of private-worker work for this slice (R44B6I), ending at the
// proof that the exact granted credential can be opened:
//
//   environment check -> prepare/reconcile journal -> recover unresolved acceptance (R44B6S) -> CLEAR ->
//   lease -> exact credential grant -> validate envelope and context -> open in memory -> STOP
//
// It never enters SUBMITTING, never builds a provider client, never calls a
// provider or records a new acceptance. Startup may finish exact publication,
// quarantine invalid temporaries, or remove a record the control plane has
// acknowledged as terminal. The plaintext exists only inside openAndDiscard
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

// The opening run needs leasing, the credential grant and startup acceptance
// recovery (R44B6S); it never reports a submission (R44B6P).
export type CredentialOpeningClient = Pick<WorkerControlClient, "leaseNextAttempt" | "requestCredentialGrant" | "recoverAcceptance">;

export type CredentialOpeningRunDependencies = Readonly<{
  environment: WorkerEnvironment;
  client: CredentialOpeningClient;
  // Required explicit composition; no state-root environment binding or bypass.
  journal: AcceptanceJournal;
  // Injected; only a test implementation exists in this slice.
  opener: CredentialOpener;
  now?: () => Date;
  // Startup acceptance-recovery time (R44B6S): a monotonic clock in
  // milliseconds and a sleep that also bounds an in-flight recovery request.
  // Never used for lease expiry.
  monotonicNow?: MonotonicClock;
  sleep?: RecoverySleep;
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

// R44B9: the non-secret continuation of a completed opening, for the
// fake-provider execution composer (R44B9A). In memory only, frozen, never
// logged or persisted as a whole. It holds the lease proof the control-plane
// requests need, and never the plaintext credential, envelope or opening
// context.
// R44B10A: it also carries the lease's authoritative model, generation
// request and expected-cost cap, which a real-provider composer needs; all
// are non-secret lease data.
export type OpenedAttemptContext = Readonly<{
  lease: Readonly<
    Pick<
      WorkerLease,
      "executionJobId" | "executionAttemptId" | "attemptNumber" | "provider" | "model" | "generationRequest" | "generationRequestSha256" | "expectedCostCap"
    >
  >;
  // From the grant's validated opening context.
  accountId: string;
  proof: LeaseProof;
}>;

// R44B10A: the scoped sealed-credential capability. It keeps only the
// validated sealed envelope, the validated opening context and the opener,
// bound to the exact granted attempt and provider, so the same single grant
// can be opened once more after the pre-provider permit. It never holds
// plaintext, makes no grant request, and serialises to a fixed marker; its
// fields are private, so no log, audit or journal can carry them.
export class SealedCredentialCapability {
  readonly #opener: CredentialOpener;
  readonly #envelope: unknown;
  readonly #context: CredentialSealingContext;
  readonly #executionAttemptId: string;
  readonly #provider: string;
  #used = false;

  constructor(opener: CredentialOpener, envelope: unknown, context: CredentialSealingContext, binding: Readonly<{ executionAttemptId: string; provider: string }>) {
    this.#opener = opener;
    this.#envelope = envelope;
    this.#context = context;
    this.#executionAttemptId = binding.executionAttemptId;
    this.#provider = binding.provider;
  }

  // Opens the exact granted credential at most once, for `use` only, and only
  // for the bound attempt and provider. The plaintext reference is dropped as
  // soon as `use` returns; JavaScript gives no zeroisation guarantee.
  async openOnceFor<T>(binding: Readonly<{ executionAttemptId: string; provider: string }>, use: (credential: string) => T): Promise<T> {
    if (this.#used || binding.executionAttemptId !== this.#executionAttemptId || binding.provider !== this.#provider) {
      throw new WorkerError("CREDENTIAL_OPEN_FAILED");
    }
    this.#used = true;
    let credential: string | null = null;
    try {
      credential = await this.#opener.open(this.#envelope, this.#context as Parameters<CredentialOpener["open"]>[1]);
    } catch {
      throw new WorkerError("CREDENTIAL_OPEN_FAILED");
    }
    try {
      if (typeof credential !== "string" || credential.length === 0) throw new WorkerError("CREDENTIAL_OPEN_FAILED");
      return use(credential);
    } finally {
      credential = null;
    }
  }

  toJSON(): string {
    return "[sealed credential capability]";
  }
}

export type CredentialOpeningOutcome =
  | Readonly<{ status: "NO_WORK" }>
  // `sealedCredential` exists only when the caller asked to retain it.
  | Readonly<{ status: "CREDENTIAL_OPENED"; context: OpenedAttemptContext; sealedCredential?: SealedCredentialCapability }>;

export type CredentialOpeningOptions = Readonly<{
  // R44B10A: keep the scoped sealed capability for one post-permit re-open.
  retainSealedCredential?: boolean;
}>;

// Runs on the authoritative lease before any credential grant; a throw stops
// the run there (the grant, opening and everything after never happen).
export type LeaseAdmission = (lease: WorkerLease) => void;

export async function runCredentialOpeningOnce(dependencies: CredentialOpeningRunDependencies): Promise<CredentialOpeningRunResult> {
  const outcome = await openLeasedCredentialOnce(dependencies);
  if (outcome.status === "NO_WORK") return outcome;
  const { lease, proof } = outcome.context;
  return Object.freeze({
    status: "CREDENTIAL_OPENED",
    executionJobId: lease.executionJobId,
    executionAttemptId: lease.executionAttemptId,
    provider: lease.provider,
    fencingCounter: proof.fencingCounter,
    credentialOpened: true,
  });
}

// The one authoritative startup -> lease -> admission -> grant -> open path,
// shared by runCredentialOpeningOnce and the fake-provider composer.
export async function openLeasedCredentialOnce(
  dependencies: CredentialOpeningRunDependencies,
  admitLease?: LeaseAdmission,
  options: CredentialOpeningOptions = {},
): Promise<CredentialOpeningOutcome> {
  const log = dependencies.log ?? (() => {});
  const now = dependencies.now ?? (() => new Date());
  const fail = (stage: WorkerLogEvent["stage"], error: unknown, context: Pick<WorkerLogEvent, "executionAttemptId" | "provider"> = {}): never => {
    const code = error instanceof WorkerError ? error.code : "CONTROL_API_UNAVAILABLE";
    log({ stage, outcome: "FAILED", code, ...context });
    throw error instanceof WorkerError ? error : new WorkerError(code);
  };

  try {
    assertNoProviderEnvironment(dependencies.environment);
    const recovery = {
      client: dependencies.client,
      monotonicNow: dependencies.monotonicNow ?? defaultMonotonicNow,
      sleep: dependencies.sleep ?? defaultRecoverySleep,
    };
    await assertStartupJournalClear(dependencies.journal, recovery, () => log({ stage: "STARTUP", outcome: "OK", code: "ACCEPTANCE_JOURNAL_CORRUPT" }));
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

  if (admitLease !== undefined) {
    try {
      admitLease(lease);
    } catch (error) {
      return fail("LEASE", error, safe);
    }
  }

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
  const sealedCredential =
    options.retainSealedCredential === true
      ? new SealedCredentialCapability(dependencies.opener, envelope, context, { executionAttemptId: lease.executionAttemptId, provider: lease.provider })
      : undefined;
  return Object.freeze({
    status: "CREDENTIAL_OPENED",
    ...(sealedCredential === undefined ? {} : { sealedCredential }),
    context: Object.freeze({
      lease: Object.freeze({
        executionJobId: lease.executionJobId,
        executionAttemptId: lease.executionAttemptId,
        attemptNumber: lease.attemptNumber,
        provider: lease.provider,
        model: lease.model,
        generationRequest: lease.generationRequest,
        generationRequestSha256: lease.generationRequestSha256,
        expectedCostCap: lease.expectedCostCap,
      }),
      accountId: context.accountId,
      // The grant already answered exactly this attempt and fencing generation.
      proof: Object.freeze({ fencingCounter: grant.fencingCounter, leaseToken: lease.leaseToken }),
    }),
  });
}
