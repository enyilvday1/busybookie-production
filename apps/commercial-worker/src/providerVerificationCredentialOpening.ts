import {
  parseSealedEnvelope,
  validateSealingContext,
  type CredentialOpener,
  type CredentialSealingContext,
  type SealedCredentialEnvelope,
} from "./credentialContracts.js";
import { assertNoProviderEnvironment, type WorkerEnvironment } from "./providerEnvironment.js";
import { classifyProviderVerificationLease } from "./providerVerificationContract.js";
import {
  isIssuedProviderVerificationCredentialGrant,
  isIssuedProviderVerificationLease,
  isIssuedProviderVerificationVerifyingAcknowledgement,
  type ProviderVerificationCredentialGrant,
  type ProviderVerificationLease,
  type ProviderVerificationVerifyingAcknowledgement,
} from "./workerControlClient.js";
import { WorkerError } from "./workerError.js";

// R44B11F Phase 5: the worker-side VERIFYING barrier owner and the single
// verification credential capability (architecture "Worker-side VERIFYING
// barrier owner and credential capability", "Bound-acknowledgement record and
// replay semantics", "Capability runtime provenance").
//
// The only worker module that may open a verification credential and the
// only one that may construct the capability. It reuses no generation
// credential-opening, lease, attempt or journal code, logs nothing, and holds
// plaintext only inside openOnceFor for the duration of `use`.
//
// Locked order: lease -> credential grant -> VERIFYING acknowledgement ->
// bindProviderVerificationCredential -> capability.openOnceFor.

// The module-private construction token: an unregistered symbol, never
// exported, returned, stored on an object or passed outside this module.
const CONSTRUCTION_TOKEN: unique symbol = Symbol("provider verification credential capability");

// The VERIFYING acknowledgement objects already bound, by exact identity. A
// WeakSet only, so the record never prolongs an acknowledgement's lifetime.
// Never exported.
const boundAcknowledgements = new WeakSet<object>();

type CapabilityBinding = Readonly<{ providerVerificationJobId: string; provider: string; verificationPolicyId: string; fencingCounter: number }>;

class ProviderVerificationCredentialCapability {
  // Declared without initializers: nothing runs before the token check.
  readonly #opener: CredentialOpener;
  readonly #envelope: SealedCredentialEnvelope;
  readonly #context: CredentialSealingContext;
  readonly #providerVerificationJobId: string;
  readonly #provider: string;
  readonly #verificationPolicyId: string;
  readonly #fencingCounter: number;
  #used: boolean;

  constructor(token: symbol, opener: CredentialOpener, envelope: SealedCredentialEnvelope, context: CredentialSealingContext, binding: CapabilityBinding) {
    if (token !== CONSTRUCTION_TOKEN) throw new WorkerError("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    this.#opener = opener;
    this.#envelope = envelope;
    this.#context = context;
    this.#providerVerificationJobId = binding.providerVerificationJobId;
    this.#provider = binding.provider;
    this.#verificationPolicyId = binding.verificationPolicyId;
    this.#fencingCounter = binding.fencingCounter;
    this.#used = false;
  }

  // Steps 1 to 4 run in the synchronous prefix: nothing is awaited, and no
  // promise-returning call runs, before the capability is consumed. The
  // opener call is the first await.
  async openOnceFor<T>(binding: CapabilityBinding, use: (credential: string) => Promise<T> | T): Promise<T> {
    // 1. Runtime provenance: only a token-checked construction has the brand
    // (a non-object receiver has none either).
    if (typeof this !== "object" || this === null || !(#used in this)) throw new WorkerError("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    // 2. Consumption.
    if (this.#used) throw new WorkerError("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    // 3. Binding authority; a mismatch does not consume. Reading a
    // caller-supplied member can run caller code (an accessor or a proxy
    // trap), which may re-enter this method, so each member is read exactly
    // once into a local here, before the final consumption check, and only
    // the locals are compared. Strict equality runs no caller code.
    if (typeof binding !== "object" || binding === null) throw new WorkerError("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    const boundJobId: unknown = binding.providerVerificationJobId;
    const boundProvider: unknown = binding.provider;
    const boundPolicyId: unknown = binding.verificationPolicyId;
    const boundFencingCounter: unknown = binding.fencingCounter;
    if (
      boundJobId !== this.#providerVerificationJobId ||
      boundProvider !== this.#provider ||
      boundPolicyId !== this.#verificationPolicyId ||
      boundFencingCounter !== this.#fencingCounter
    ) {
      throw new WorkerError("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    }
    // 4. Consume, synchronously: the final consumption check and the consume
    // are adjacent, with no caller code, callback, promise or await between
    // them, so a call re-entered from step 3 that consumed first fails here.
    if (this.#used) throw new WorkerError("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    this.#used = true;
    // 5. Open. A throw, a non-string or an empty plaintext is
    // CREDENTIAL_OPEN_FAILED with no cause; the capability stays consumed.
    let credential: unknown = null;
    try {
      credential = await this.#opener.open(this.#envelope, this.#context);
    } catch {
      throw new WorkerError("CREDENTIAL_OPEN_FAILED");
    }
    try {
      if (typeof credential !== "string" || credential.length === 0) throw new WorkerError("CREDENTIAL_OPEN_FAILED");
      // Errors thrown by `use` propagate unchanged.
      return await use(credential);
    } finally {
      // JavaScript gives no zeroisation guarantee; drop the reference.
      credential = null;
    }
  }

  toJSON(): string {
    return "[provider verification credential capability]";
  }
}

// Only the type is exported; the class itself never is.
export type { ProviderVerificationCredentialCapability };

// Synchronous; opens nothing. Checks in the locked order and constructs the
// capability only after all six pass. A failed check records nothing.
export function bindProviderVerificationCredential(
  input: Readonly<{
    environment: WorkerEnvironment;
    opener: CredentialOpener;
    lease: ProviderVerificationLease;
    grant: ProviderVerificationCredentialGrant;
    acknowledgement: ProviderVerificationVerifyingAcknowledgement;
  }>,
): ProviderVerificationCredentialCapability {
  // 1. The provider-global environment fallback is refused first.
  assertNoProviderEnvironment(input.environment);
  // Every other caller-supplied member is read exactly once, here, before any
  // authority check. A member read can run caller code (an accessor or a
  // proxy trap) that may re-enter this function, so nothing after the final
  // bound-record check below reads the input again; the issued objects
  // themselves are frozen data produced by the client.
  const opener = input.opener;
  const lease = input.lease;
  const grant = input.grant;
  const acknowledgement = input.acknowledgement;
  // 2. Exactly client-issued objects, and an acknowledgement not yet bound.
  if (
    !isIssuedProviderVerificationLease(lease) ||
    !isIssuedProviderVerificationCredentialGrant(grant) ||
    !isIssuedProviderVerificationVerifyingAcknowledgement(acknowledgement) ||
    boundAcknowledgements.has(acknowledgement)
  ) {
    throw new WorkerError("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
  }
  // 3. Structural admission.
  const admission = classifyProviderVerificationLease(lease);
  if (admission.status === "REFUSED") {
    throw new WorkerError(admission.reason === "UNSUPPORTED_PROVIDER" ? "PROVIDER_VERIFICATION_PROVIDER_UNSUPPORTED" : "PROVIDER_VERIFICATION_POLICY_UNSUPPORTED");
  }
  // 4. One job, one fence, past the barrier.
  if (
    grant.providerVerificationJobId !== lease.providerVerificationJobId ||
    acknowledgement.providerVerificationJobId !== lease.providerVerificationJobId ||
    grant.fencingCounter !== lease.fencingCounter ||
    acknowledgement.fencingCounter !== lease.fencingCounter ||
    acknowledgement.state !== "VERIFYING"
  ) {
    throw new WorkerError("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
  }
  // 5. The supported envelope and opening-context formats.
  let envelope: SealedCredentialEnvelope;
  let context: CredentialSealingContext;
  try {
    envelope = parseSealedEnvelope(grant.sealedEnvelope).envelope;
    context = validateSealingContext(grant.openingContext);
  } catch {
    throw new WorkerError("ENVELOPE_INVALID");
  }
  // 6. The sealed credential belongs to the leased provider.
  if (context.provider !== lease.provider) throw new WorkerError("ENVELOPE_INVALID");

  // Re-check immediately before recording the acknowledgement. The early
  // bound check in step 2 covers re-entry during the input snapshot; steps 5
  // and 6 then parse caller-supplied credential envelope and context data and
  // may execute accessors that synchronously re-enter this binder after that
  // check, so a bind that recorded this acknowledgement first fails here.
  // Nothing caller-controlled may run between this check and add().
  // Construction follows the record and uses only the snapshotted locals and
  // the frozen issued lease.
  if (boundAcknowledgements.has(acknowledgement)) throw new WorkerError("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
  boundAcknowledgements.add(acknowledgement);
  return new ProviderVerificationCredentialCapability(CONSTRUCTION_TOKEN, opener, envelope, context, {
    providerVerificationJobId: lease.providerVerificationJobId,
    provider: lease.provider,
    verificationPolicyId: lease.verificationPolicyId,
    fencingCounter: lease.fencingCounter,
  });
}
