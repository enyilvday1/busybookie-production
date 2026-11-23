import { randomBytes, randomUUID } from "node:crypto";

import { GOOGLE_PROVIDER_ID, RUNWAY_PROVIDER_ID } from "commercial-worker-protocol";
import { describe, expect, it } from "vitest";

import type { CredentialOpener } from "../src/credentialContracts.js";
import { FORBIDDEN_PROVIDER_ENVIRONMENT_VARIABLES } from "../src/providerEnvironment.js";
import { bindProviderVerificationCredential, type ProviderVerificationCredentialCapability } from "../src/providerVerificationCredentialOpening.js";
import {
  createHttpProviderVerificationControlClient,
  parseProviderVerificationCredentialGrantResponse,
  parseProviderVerificationLeaseResponse,
  parseProviderVerificationVerifyingResponse,
  type ProviderVerificationCredentialGrant,
  type ProviderVerificationLease,
  type ProviderVerificationVerifyingAcknowledgement,
} from "../src/workerControlClient.js";
import { WorkerError, type WorkerErrorCode } from "../src/workerError.js";
import { createTestCredentialOpener, createTestCredentialSealer, generateTestKey } from "./support/testCredentialOpening.js";

// R44B11F Phase 5: the worker-side VERIFYING barrier owner and the single-use
// verification credential capability (architecture "Worker-side VERIFYING
// barrier owner and credential capability", "Bound-acknowledgement record and
// replay semantics", "Capability runtime provenance"). Fake opener and test
// crypto only; leases, grants and acknowledgements come from the real client
// with an injected fetch. No network, no control plane, no provider.

const key = generateTestKey("worker-verification-unit/v1");
const sealer = createTestCredentialSealer(key);
const realOpener = createTestCredentialOpener(key);

const MACHINE = `fixture-machine-${randomBytes(12).toString("hex")}`;
const PLAINTEXT = `fixture-verification-credential-${randomBytes(18).toString("hex")}`;
const LEASE_TOKEN = randomBytes(32).toString("base64url");
const JOB = randomUUID();
const OTHER_JOB = randomUUID();
const FENCE = 7;
const GOOGLE_POLICY = "GOOGLE_GENAI_MODELS_LIST_V1BETA";
const RUNWAY_POLICY = "RUNWAY_ORGANIZATION_GET_V1_2024_11_06";
const MARKER = "[provider verification credential capability]";

const contextFor = (provider: string) => ({
  accountId: randomUUID(),
  providerConnectionId: randomUUID(),
  provider,
  credentialVersion: 3,
  purpose: "provider-credential" as const,
});
const GOOGLE_CONTEXT = contextFor(GOOGLE_PROVIDER_ID);
const GOOGLE_ENVELOPE = await sealer.seal(PLAINTEXT, GOOGLE_CONTEXT);
const RUNWAY_CONTEXT = contextFor(RUNWAY_PROVIDER_ID);
const RUNWAY_ENVELOPE = await sealer.seal(PLAINTEXT, RUNWAY_CONTEXT);

type Scenario = Readonly<{
  job?: string;
  fence?: number;
  provider?: string;
  policy?: string;
  envelope?: unknown;
  context?: unknown;
  grantJob?: string;
  grantFence?: number;
  ackJob?: string;
  ackFence?: number;
  // Answer the grant route with the body object itself rather than JSON
  // text, so accessors on the credential data survive into the issued grant.
  liveGrant?: boolean;
}>;

const leaseBody = (s: Scenario) => ({
  lease: {
    providerVerificationJobId: s.job ?? JOB,
    provider: s.provider ?? GOOGLE_PROVIDER_ID,
    verificationPolicyId: s.policy ?? GOOGLE_POLICY,
    leaseToken: LEASE_TOKEN,
    fencingCounter: s.fence ?? FENCE,
    leaseExpiresAt: "2026-11-23T10:00:30.000Z",
  },
});
const grantBody = (s: Scenario) => ({
  providerVerificationJobId: s.grantJob ?? s.job ?? JOB,
  fencingCounter: s.grantFence ?? s.fence ?? FENCE,
  credentialGrantedAt: "2026-11-23T10:00:01.000Z",
  // "in", not ??, so a deliberate null envelope or context is sent as null.
  credential: { sealedEnvelope: "envelope" in s ? s.envelope : GOOGLE_ENVELOPE, openingContext: "context" in s ? s.context : GOOGLE_CONTEXT },
});
const verifyingBody = (s: Scenario) => ({
  providerVerificationJobId: s.ackJob ?? s.job ?? JOB,
  fencingCounter: s.ackFence ?? s.fence ?? FENCE,
  state: "VERIFYING",
  verifyingAt: "2026-11-23T10:00:02.000Z",
});

// A client that answers each route from the scenario, so every object below
// is a genuinely issued one.
function clientFor(s: Scenario = {}) {
  const fetchImpl = (async (url: Parameters<typeof fetch>[0]) => {
    const path = new URL(String(url)).pathname;
    const body = path.endsWith("/lease") ? leaseBody(s) : path.endsWith("/credential-grant") ? grantBody(s) : verifyingBody(s);
    if (s.liveGrant === true && path.endsWith("/credential-grant")) {
      const response = new Response(null, { status: 200, headers: { "Content-Type": "application/json" } });
      Object.defineProperty(response, "json", { value: async () => body });
      return response;
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return createHttpProviderVerificationControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: MACHINE, fetchImpl });
}

async function issued(s: Scenario = {}) {
  const client = clientFor(s);
  const lease = (await client.leaseProviderVerification())!;
  const proof = { fencingCounter: s.fence ?? FENCE, leaseToken: LEASE_TOKEN };
  const grant = await client.requestProviderVerificationCredentialGrant(s.grantJob ?? s.job ?? JOB, proof);
  const acknowledgement = await client.acknowledgeProviderVerificationVerifying(s.ackJob ?? s.job ?? JOB, proof);
  return { client, lease, grant, acknowledgement, proof };
}

function countingOpener(behaviour: "REAL" | "THROW" | "EMPTY" | "NON_STRING" = "REAL") {
  const seen = { opened: 0, plaintextMatched: false };
  const opener: CredentialOpener = {
    open: async (envelope, context) => {
      seen.opened += 1;
      if (behaviour === "THROW") throw new Error(`fixture opener failure ${PLAINTEXT}`);
      if (behaviour === "EMPTY") return "";
      if (behaviour === "NON_STRING") return 42 as unknown as string;
      const plaintext = await realOpener.open(envelope, context);
      seen.plaintextMatched = plaintext === PLAINTEXT;
      return plaintext;
    },
  };
  return { opener, seen };
}

const bindingOf = (lease: ProviderVerificationLease) => ({
  providerVerificationJobId: lease.providerVerificationJobId,
  provider: lease.provider,
  verificationPolicyId: lease.verificationPolicyId,
  fencingCounter: lease.fencingCounter,
});

type Parts = Readonly<{ lease: ProviderVerificationLease; grant: ProviderVerificationCredentialGrant; acknowledgement: ProviderVerificationVerifyingAcknowledgement }>;
const bind = (parts: Parts, opener: CredentialOpener = countingOpener().opener, environment: Readonly<Record<string, string | undefined>> = {}) =>
  bindProviderVerificationCredential({ environment, opener, ...parts });

// A closed WorkerError with no cause whose visible text carries no secret.
function inspect(error: unknown): WorkerErrorCode {
  expect(error).toBeInstanceOf(WorkerError);
  expect((error as Error).cause).toBeUndefined();
  const visible = `${(error as Error).message} ${JSON.stringify(error)} ${String((error as Error).stack)}`;
  for (const secret of [PLAINTEXT, LEASE_TOKEN, MACHINE, GOOGLE_ENVELOPE.ciphertext, GOOGLE_ENVELOPE.tag, GOOGLE_CONTEXT.accountId]) {
    expect(visible.includes(secret)).toBe(false);
  }
  return (error as WorkerError).code;
}
function bindFailure(run: () => unknown): WorkerErrorCode {
  try {
    run();
  } catch (error) {
    return inspect(error);
  }
  throw new Error("expected the binding to fail");
}
async function openFailure(promise: Promise<unknown>): Promise<WorkerErrorCode> {
  return inspect(await promise.then(() => undefined, (caught: unknown) => caught));
}

describe("VERIFYING binding (bindProviderVerificationCredential)", () => {
  it("binds a matching issued lease, grant and VERIFYING acknowledgement, synchronously and without opening", async () => {
    const parts = await issued();
    const { opener, seen } = countingOpener();
    const result: unknown = bind(parts, opener);
    expect(result instanceof Promise).toBe(false);
    expect(seen.opened).toBe(0);
    const capability = result as ProviderVerificationCredentialCapability;
    const used = await capability.openOnceFor(bindingOf(parts.lease), (credential) => credential === PLAINTEXT);
    expect(used).toBe(true);
    expect(seen).toEqual({ opened: 1, plaintextMatched: true });
  });

  it("binds a supported Runway lease the same way", async () => {
    const parts = await issued({ provider: RUNWAY_PROVIDER_ID, policy: RUNWAY_POLICY, envelope: RUNWAY_ENVELOPE, context: RUNWAY_CONTEXT });
    const { opener, seen } = countingOpener();
    const capability = bind(parts, opener);
    expect(await capability.openOnceFor(bindingOf(parts.lease), async (credential) => credential.length)).toBe(PLAINTEXT.length);
    expect(seen.opened).toBe(1);
  });

  it("refuses a forbidden provider environment before anything else, and records nothing", async () => {
    const parts = await issued();
    const { opener, seen } = countingOpener();
    for (const name of FORBIDDEN_PROVIDER_ENVIRONMENT_VARIABLES) {
      expect(bindFailure(() => bind(parts, opener, { [name]: "" })), name).toBe("FORBIDDEN_PROVIDER_ENVIRONMENT");
      expect(bindFailure(() => bind(parts, opener, { [name.toLowerCase()]: "x" })), name).toBe("FORBIDDEN_PROVIDER_ENVIRONMENT");
    }
    // Before the issued-object check: even raw inputs fail on the environment first.
    const raw = { lease: parseProviderVerificationLeaseResponse(leaseBody({}))!, grant: parts.grant, acknowledgement: parts.acknowledgement };
    expect(bindFailure(() => bind(raw, opener, { GEMINI_API_KEY: "" }))).toBe("FORBIDDEN_PROVIDER_ENVIRONMENT");
    // The refused acknowledgement was not recorded: it still binds once.
    bind(parts, opener);
    expect(seen.opened).toBe(0);
  });

  it("refuses a raw grant, a missing acknowledgement and look-alike or copied objects", async () => {
    const parts = await issued();
    const rawLease = parseProviderVerificationLeaseResponse(leaseBody({}))!;
    const rawGrant = parseProviderVerificationCredentialGrantResponse(grantBody({}), { providerVerificationJobId: JOB, fencingCounter: FENCE });
    const rawAcknowledgement = parseProviderVerificationVerifyingResponse(verifyingBody({}), { providerVerificationJobId: JOB, fencingCounter: FENCE });
    const literalAcknowledgement = Object.freeze({ providerVerificationJobId: JOB, fencingCounter: FENCE, state: "VERIFYING" as const, verifyingAt: new Date() });
    const copies = <T extends object>(value: T): unknown[] => [{ ...value }, Object.assign({}, value), structuredClone(value), JSON.parse(JSON.stringify(value)), Object.create(value)];
    const { opener, seen } = countingOpener();
    const attempts: Parts[] = [
      { ...parts, grant: rawGrant },
      { ...parts, lease: rawLease },
      { ...parts, acknowledgement: rawAcknowledgement },
      { ...parts, acknowledgement: literalAcknowledgement },
      { ...parts, acknowledgement: undefined as unknown as ProviderVerificationVerifyingAcknowledgement },
      { ...parts, acknowledgement: null as unknown as ProviderVerificationVerifyingAcknowledgement },
      // A grant passed where the acknowledgement belongs, and vice versa.
      { ...parts, acknowledgement: parts.grant as unknown as ProviderVerificationVerifyingAcknowledgement },
      { ...parts, grant: parts.acknowledgement as unknown as ProviderVerificationCredentialGrant },
      ...copies(parts.lease).map((lease) => ({ ...parts, lease: lease as ProviderVerificationLease })),
      ...copies(parts.grant).map((grant) => ({ ...parts, grant: grant as ProviderVerificationCredentialGrant })),
      ...copies(parts.acknowledgement).map((acknowledgement) => ({ ...parts, acknowledgement: acknowledgement as ProviderVerificationVerifyingAcknowledgement })),
    ];
    for (const attempt of attempts) expect(bindFailure(() => bind(attempt, opener))).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    expect(seen.opened).toBe(0);
    // None of the failures recorded the genuine acknowledgement.
    expect(() => bind(parts, opener)).not.toThrow();
  });

  it("refuses a mismatched job or fence", async () => {
    const { opener, seen } = countingOpener();
    const lease = (await issued()).lease;
    const otherJob = await issued({ job: OTHER_JOB });
    const otherFence = await issued({ fence: FENCE + 1 });
    for (const attempt of [
      { lease, grant: otherJob.grant, acknowledgement: (await issued()).acknowledgement },
      { lease, grant: (await issued()).grant, acknowledgement: otherJob.acknowledgement },
      { lease, grant: otherFence.grant, acknowledgement: (await issued()).acknowledgement },
      { lease, grant: (await issued()).grant, acknowledgement: otherFence.acknowledgement },
      { lease: otherJob.lease, grant: (await issued()).grant, acknowledgement: (await issued()).acknowledgement },
      { lease: otherFence.lease, grant: (await issued()).grant, acknowledgement: (await issued()).acknowledgement },
    ]) {
      expect(bindFailure(() => bind(attempt, opener))).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    }
    expect(seen.opened).toBe(0);
  });

  it("maps unsupported providers and policies to their codes before any binding", async () => {
    const { opener, seen } = countingOpener();
    for (const [scenario, expected] of [
      [{ provider: "EXAMPLE_PROVIDER" }, "PROVIDER_VERIFICATION_PROVIDER_UNSUPPORTED"],
      [{ provider: ["BUSYBOOKIE", "FAKE"].join("_") }, "PROVIDER_VERIFICATION_PROVIDER_UNSUPPORTED"],
      [{ policy: "OTHER_POLICY_V1" }, "PROVIDER_VERIFICATION_POLICY_UNSUPPORTED"],
      [{ policy: RUNWAY_POLICY }, "PROVIDER_VERIFICATION_POLICY_UNSUPPORTED"],
      [{ provider: RUNWAY_PROVIDER_ID, policy: GOOGLE_POLICY, envelope: RUNWAY_ENVELOPE, context: RUNWAY_CONTEXT }, "PROVIDER_VERIFICATION_POLICY_UNSUPPORTED"],
    ] as const) {
      const parts = await issued(scenario);
      expect(bindFailure(() => bind(parts, opener)), JSON.stringify(scenario)).toBe(expected);
      // A refusal records nothing, but the lease stays unsupported.
      expect(bindFailure(() => bind(parts, opener)), JSON.stringify(scenario)).toBe(expected);
    }
    expect(seen.opened).toBe(0);
  });

  it("refuses an invalid envelope or context, or an opening context for another provider, as ENVELOPE_INVALID", async () => {
    const { opener, seen } = countingOpener();
    for (const scenario of [
      { envelope: { ...GOOGLE_ENVELOPE, extra: 1 } },
      { envelope: "not an envelope" },
      { envelope: null },
      { context: { ...GOOGLE_CONTEXT, purpose: "other" } },
      { context: { ...GOOGLE_CONTEXT, extra: true } },
      { context: null },
      // The sealed credential belongs to another provider than the lease.
      { context: RUNWAY_CONTEXT, envelope: RUNWAY_ENVELOPE },
      { provider: RUNWAY_PROVIDER_ID, policy: RUNWAY_POLICY },
    ]) {
      const parts = await issued(scenario);
      expect(bindFailure(() => bind(parts, opener)), JSON.stringify(Object.keys(scenario))).toBe("ENVELOPE_INVALID");
    }
    expect(seen.opened).toBe(0);
  });

  it("binds each exact issued acknowledgement object at most once; a later VERIFYING answer binds once more", async () => {
    const parts = await issued();
    const { opener, seen } = countingOpener();
    bind(parts, opener);
    expect(bindFailure(() => bind(parts, opener))).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    // A second explicit, successful VERIFYING call returns a new issued object.
    const replayed = await parts.client.acknowledgeProviderVerificationVerifying(JOB, parts.proof);
    expect(replayed).not.toBe(parts.acknowledgement);
    const capability = bind({ ...parts, acknowledgement: replayed }, opener);
    expect(bindFailure(() => bind({ ...parts, acknowledgement: replayed }, opener))).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    expect(await capability.openOnceFor(bindingOf(parts.lease), () => "used")).toBe("used");
    expect(seen.opened).toBe(1);
  });

  it("records nothing for a binding that fails after the issued-object check", async () => {
    const good = await issued();
    // Same issued job and fence, but a grant whose envelope will not parse.
    const broken = await issued({ envelope: { not: "an envelope" } });
    expect(bindFailure(() => bind({ ...good, grant: broken.grant }))).toBe("ENVELOPE_INVALID");
    // The acknowledgement was not recorded by the failure: it still binds once.
    expect(() => bind(good)).not.toThrow();
    expect(bindFailure(() => bind(good))).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
  });

  it("creates at most one capability per acknowledgement even when an input accessor re-enters the binding", async () => {
    for (const member of ["opener", "lease", "grant", "acknowledgement"] as const) {
      const parts = await issued();
      const { opener, seen } = countingOpener();
      const plain = { environment: {}, opener, lease: parts.lease, grant: parts.grant, acknowledgement: parts.acknowledgement };
      const capabilities: ProviderVerificationCredentialCapability[] = [];
      let reentered = false;
      // A genuine input whose one member is an accessor that, on first read,
      // binds the same issued acknowledgement from inside the outer binding.
      const reentrant = { ...plain };
      Object.defineProperty(reentrant, member, {
        enumerable: true,
        get() {
          if (!reentered) {
            reentered = true;
            capabilities.push(bindProviderVerificationCredential(plain));
          }
          return plain[member];
        },
      });
      let outer: unknown;
      let outerError: unknown;
      try {
        outer = bindProviderVerificationCredential(reentrant);
      } catch (error) {
        outerError = error;
      }
      if (outer !== undefined) capabilities.push(outer as ProviderVerificationCredentialCapability);
      expect(reentered, member).toBe(true);
      // Exactly one capability exists for the acknowledgement; the other bind
      // fails with the closed authority code, never a raw error.
      expect(capabilities, member).toHaveLength(1);
      expect(inspect(outerError), member).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
      // The acknowledgement is recorded exactly once: any further bind fails.
      expect(bindFailure(() => bindProviderVerificationCredential(plain)), member).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
      // The one capability opens once; the opener is never reached twice.
      expect(await capabilities[0]!.openOnceFor(bindingOf(parts.lease), (credential) => credential === PLAINTEXT), member).toBe(true);
      expect(await openFailure(capabilities[0]!.openOnceFor(bindingOf(parts.lease), () => "x")), member).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
      expect(seen.opened, member).toBe(1);
    }
  });

  it("refuses a bind re-entered from issued credential data after the early bound check, at the final bound-record check", async () => {
    // A sealed envelope whose first-read member is an accessor. The issued
    // grant carries it by reference, so it runs only inside step 5's envelope
    // parse, after the outer bind has passed its early bound check.
    let reenter: (() => void) | undefined;
    let reentered = false;
    const envelope = { ...GOOGLE_ENVELOPE };
    Object.defineProperty(envelope, "format", {
      enumerable: true,
      get() {
        const run = reenter;
        reenter = undefined;
        if (run !== undefined) {
          reentered = true;
          run();
        }
        return GOOGLE_ENVELOPE.format;
      },
    });
    const parts = await issued({ envelope, liveGrant: true });
    expect(parts.grant.sealedEnvelope).toBe(envelope);
    const { opener, seen } = countingOpener();
    const capabilities: ProviderVerificationCredentialCapability[] = [];
    let innerError: unknown;
    // Armed after issuance: the accessor binds the same exact issued lease,
    // grant and VERIFYING acknowledgement from inside the outer binding.
    reenter = () => {
      try {
        capabilities.push(bind(parts, opener));
      } catch (error) {
        innerError = error;
      }
    };
    let outerError: unknown;
    try {
      capabilities.push(bind(parts, opener));
    } catch (error) {
      outerError = error;
    }
    expect(reentered).toBe(true);
    // The re-entered bind recorded the acknowledgement first; the outer bind,
    // already past its early check, is refused by the final check.
    expect(innerError).toBeUndefined();
    expect(capabilities).toHaveLength(1);
    expect(inspect(outerError)).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    // No second usable capability: the acknowledgement stays recorded.
    expect(bindFailure(() => bind(parts, opener))).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    // The one capability opens exactly once.
    expect(await capabilities[0]!.openOnceFor(bindingOf(parts.lease), (credential) => credential === PLAINTEXT)).toBe(true);
    expect(await openFailure(capabilities[0]!.openOnceFor(bindingOf(parts.lease), () => "x"))).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    expect(seen).toEqual({ opened: 1, plaintextMatched: true });
  });

  it("reads every top-level bind input member exactly once, and opening never re-reads the input", async () => {
    const parts = await issued();
    const { opener, seen } = countingOpener();
    const values = { environment: {}, opener, lease: parts.lease, grant: parts.grant, acknowledgement: parts.acknowledgement };
    const reads = { environment: 0, opener: 0, lease: 0, grant: 0, acknowledgement: 0 };
    const input = {} as typeof values;
    for (const member of Object.keys(values) as (keyof typeof values)[]) {
      Object.defineProperty(input, member, {
        enumerable: true,
        get() {
          reads[member] += 1;
          return values[member];
        },
      });
    }
    const once = { environment: 1, opener: 1, lease: 1, grant: 1, acknowledgement: 1 };
    const capability = bindProviderVerificationCredential(input);
    expect(reads).toEqual(once);
    expect(await capability.openOnceFor(bindingOf(parts.lease), (credential) => credential === PLAINTEXT)).toBe(true);
    expect(reads).toEqual(once);
    expect(seen).toEqual({ opened: 1, plaintextMatched: true });
  });
});

describe("capability runtime provenance", () => {
  async function capabilityWithOpener() {
    const parts = await issued();
    const { opener, seen } = countingOpener();
    return { parts, capability: bind(parts, opener), seen };
  }

  it("cannot be constructed reflectively with a forged token", async () => {
    const { parts, capability, seen } = await capabilityWithOpener();
    const Capability = (capability as object).constructor as new (...args: unknown[]) => ProviderVerificationCredentialCapability;
    const args = [countingOpener().opener, GOOGLE_ENVELOPE, GOOGLE_CONTEXT, bindingOf(parts.lease)];
    for (const token of [undefined, null, Symbol("provider verification credential capability"), Symbol.for("provider verification credential capability"), Symbol(), "token"]) {
      expect(bindFailure(() => new Capability(token, ...args)), String(token)).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    }
    // A subclass constructor calling super gets no object either.
    class Forged extends Capability {
      constructor() {
        super(Symbol("forged"), ...args);
      }
    }
    expect(bindFailure(() => new Forged())).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    expect(seen.opened).toBe(0);
  });

  it("refuses every object that did not come from a token-checked construction, before any other step", async () => {
    const { parts, capability, seen } = await capabilityWithOpener();
    const prototype = Object.getPrototypeOf(capability) as ProviderVerificationCredentialCapability;
    const binding = bindingOf(parts.lease);
    const receivers: unknown[] = [Object.create(prototype), {}, { openOnceFor: prototype.openOnceFor }, structuredClone({ ...capability }), null, undefined];
    for (const receiver of receivers) {
      expect(await openFailure(Promise.resolve().then(() => prototype.openOnceFor.call(receiver as ProviderVerificationCredentialCapability, binding, () => "x")))).toBe(
        "PROVIDER_VERIFICATION_AUTHORITY_MISMATCH",
      );
    }
    expect(await openFailure((Object.create(prototype) as ProviderVerificationCredentialCapability).openOnceFor(binding, () => "x"))).toBe(
      "PROVIDER_VERIFICATION_AUTHORITY_MISMATCH",
    );
    expect(seen.opened).toBe(0);
    // The genuine capability is untouched by all of it.
    expect(await capability.openOnceFor(binding, () => "ok")).toBe("ok");
    expect(seen.opened).toBe(1);
  });
});

describe("capability single use (openOnceFor)", () => {
  it("A. a binding mismatch fails without consuming; the exact binding then opens exactly once", async () => {
    const parts = await issued();
    const { opener, seen } = countingOpener();
    const capability = bind(parts, opener);
    const exact = bindingOf(parts.lease);
    for (const binding of [
      { ...exact, providerVerificationJobId: OTHER_JOB },
      { ...exact, provider: RUNWAY_PROVIDER_ID },
      { ...exact, verificationPolicyId: RUNWAY_POLICY },
      { ...exact, fencingCounter: FENCE + 1 },
      { ...exact, fencingCounter: String(FENCE) as unknown as number },
      null as unknown as typeof exact,
      "binding" as unknown as typeof exact,
    ]) {
      expect(await openFailure(capability.openOnceFor(binding, () => "x")), JSON.stringify(binding)).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    }
    expect(seen.opened).toBe(0);
    expect(await capability.openOnceFor(exact, (credential) => credential === PLAINTEXT)).toBe(true);
    expect(seen.opened).toBe(1);
    // A second open after a completed one never reaches the opener.
    expect(await openFailure(capability.openOnceFor(exact, () => "x"))).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    expect(seen.opened).toBe(1);
  });

  it("B. an opener failure, an empty or a non-string plaintext consumes the capability", async () => {
    for (const behaviour of ["THROW", "EMPTY", "NON_STRING"] as const) {
      const parts = await issued();
      const { opener, seen } = countingOpener(behaviour);
      const capability = bind(parts, opener);
      let used = 0;
      expect(await openFailure(capability.openOnceFor(bindingOf(parts.lease), () => (used += 1))), behaviour).toBe("CREDENTIAL_OPEN_FAILED");
      expect(await openFailure(capability.openOnceFor(bindingOf(parts.lease), () => (used += 1))), behaviour).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
      expect(seen.opened, behaviour).toBe(1);
      expect(used, behaviour).toBe(0);
    }
  });

  it("C. a concurrent double open reaches the opener exactly once, and consumption is synchronous", async () => {
    const parts = await issued();
    let release: (value: string) => void = () => undefined;
    let opened = 0;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const opener: CredentialOpener = {
      open: async () => {
        opened += 1;
        return gate;
      },
    };
    const capability = bind(parts, opener);
    const binding = bindingOf(parts.lease);
    const first = capability.openOnceFor(binding, (credential) => credential);
    // Before any await: the first call has already consumed and invoked the opener.
    expect(opened).toBe(1);
    const second = capability.openOnceFor(binding, (credential) => credential);
    expect(opened).toBe(1);
    let secondSettled = false;
    void second.then(
      () => (secondSettled = true),
      () => (secondSettled = true),
    );
    await Promise.resolve();
    // The second call rejected without waiting for the opener to resolve.
    expect(secondSettled).toBe(true);
    release(PLAINTEXT);
    const settled = await Promise.allSettled([first, second]);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(settled[0]).toEqual({ status: "fulfilled", value: PLAINTEXT });
    expect(settled[1]!.status).toBe("rejected");
    expect(inspect((settled[1] as PromiseRejectedResult).reason)).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    expect(opened).toBe(1);

    // And with Promise.allSettled over both calls started together.
    const again = await issued();
    let openedAgain = 0;
    let releaseAgain: (value: string) => void = () => undefined;
    const gateAgain = new Promise<string>((resolve) => {
      releaseAgain = resolve;
    });
    const both = bind(again, {
      open: async () => {
        openedAgain += 1;
        return gateAgain;
      },
    });
    const racing = Promise.allSettled([both.openOnceFor(bindingOf(again.lease), () => "one"), both.openOnceFor(bindingOf(again.lease), () => "two")]);
    releaseAgain(PLAINTEXT);
    const outcomes = await racing;
    expect(openedAgain).toBe(1);
    expect(outcomes.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(inspect((outcomes.find(({ status }) => status === "rejected") as PromiseRejectedResult).reason)).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
  });

  it("D. a binding accessor that re-enters openOnceFor reaches the opener exactly once", async () => {
    for (const member of ["providerVerificationJobId", "provider", "verificationPolicyId", "fencingCounter"] as const) {
      const parts = await issued();
      const { opener, seen } = countingOpener();
      const capability = bind(parts, opener);
      const exact = bindingOf(parts.lease);
      let inner: Promise<unknown> | undefined;
      const received: string[] = [];
      // The exact binding, except that one member is an accessor which, on
      // first read, opens the same capability from inside the outer call.
      const reentrant = { ...exact };
      Object.defineProperty(reentrant, member, {
        enumerable: true,
        get() {
          inner ??= capability.openOnceFor(exact, (credential) => {
            received.push(credential);
            return "inner";
          });
          return exact[member];
        },
      });
      const outer = capability.openOnceFor(reentrant, (credential) => {
        received.push(credential);
        return "outer";
      });
      expect(inner, member).toBeDefined();
      const settled = await Promise.allSettled([outer, inner!]);
      // Exactly one opener call, exactly one call given the plaintext.
      expect(seen.opened, member).toBe(1);
      expect(received, member).toEqual([PLAINTEXT]);
      expect(settled.filter(({ status }) => status === "fulfilled"), member).toHaveLength(1);
      const rejected = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      expect(rejected, member).toHaveLength(1);
      expect(inspect(rejected[0]!.reason), member).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
      // The capability stays consumed.
      expect(await openFailure(capability.openOnceFor(exact, () => "again")), member).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
      expect(seen.opened, member).toBe(1);
    }
  });

  it("E. reads each caller-supplied binding member exactly once", async () => {
    const parts = await issued();
    const { opener, seen } = countingOpener();
    const capability = bind(parts, opener);
    const exact = bindingOf(parts.lease);
    const reads = { providerVerificationJobId: 0, provider: 0, verificationPolicyId: 0, fencingCounter: 0 };
    const counted = {} as typeof exact;
    for (const member of Object.keys(exact) as (keyof typeof exact)[]) {
      Object.defineProperty(counted, member, {
        enumerable: true,
        get() {
          reads[member] += 1;
          return exact[member];
        },
      });
    }
    expect(await capability.openOnceFor(counted, (credential) => credential === PLAINTEXT)).toBe(true);
    expect(reads).toEqual({ providerVerificationJobId: 1, provider: 1, verificationPolicyId: 1, fencingCounter: 1 });
    expect(seen).toEqual({ opened: 1, plaintextMatched: true });
  });

  it("propagates an error thrown by use unchanged and stays consumed", async () => {
    const parts = await issued();
    const { opener, seen } = countingOpener();
    const capability = bind(parts, opener);
    const failure = new Error("fixture use failure");
    await expect(capability.openOnceFor(bindingOf(parts.lease), () => Promise.reject(failure))).rejects.toBe(failure);
    expect(await openFailure(capability.openOnceFor(bindingOf(parts.lease), () => "x"))).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
    expect(seen.opened).toBe(1);
  });
});

describe("secret handling", () => {
  it("serializes only to its fixed marker and exposes no enumerable or own properties", async () => {
    const parts = await issued();
    const capability = bind(parts);
    expect(JSON.stringify(capability)).toBe(JSON.stringify(MARKER));
    expect(JSON.stringify({ capability })).toBe(JSON.stringify({ capability: MARKER }));
    expect(Object.keys(capability)).toEqual([]);
    expect(Reflect.ownKeys(capability)).toEqual([]);
    expect({ ...capability }).toEqual({});
    const visible = `${String(capability)} ${JSON.stringify(capability)} ${JSON.stringify(Object.getOwnPropertyDescriptors(capability))}`;
    for (const secret of [PLAINTEXT, LEASE_TOKEN, MACHINE, GOOGLE_ENVELOPE.ciphertext, GOOGLE_ENVELOPE.nonce, GOOGLE_CONTEXT.accountId]) {
      expect(visible.includes(secret)).toBe(false);
    }
  });

  it("keeps plaintext, envelope, context, lease token and machine credential out of every error and log", async () => {
    const logs: unknown[] = [];
    const originals = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
    for (const name of Object.keys(originals) as (keyof typeof originals)[]) console[name] = (...args: unknown[]) => void logs.push(args);
    try {
      const parts = await issued();
      // The opener's own error text includes the plaintext; it must never surface.
      const failing = bind(parts, countingOpener("THROW").opener);
      expect(await openFailure(failing.openOnceFor(bindingOf(parts.lease), () => "x"))).toBe("CREDENTIAL_OPEN_FAILED");
      const fresh = await issued();
      const capability = bind(fresh);
      expect(await openFailure(capability.openOnceFor({ ...bindingOf(fresh.lease), fencingCounter: 99 }, () => "x"))).toBe("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH");
      expect(await capability.openOnceFor(bindingOf(fresh.lease), () => "done")).toBe("done");
    } finally {
      Object.assign(console, originals);
    }
    // Phase 5 modules log nothing.
    expect(logs).toEqual([]);
  });

  it("never holds the lease token in the capability", async () => {
    const parts = await issued();
    const capability = bind(parts);
    expect(`${JSON.stringify(capability)}${String(capability)}`.includes(LEASE_TOKEN)).toBe(false);
    // The binding needs no lease token: the four-field binding opens it.
    expect(Object.keys(bindingOf(parts.lease)).sort()).toEqual(["fencingCounter", "provider", "providerVerificationJobId", "verificationPolicyId"]);
    expect(await capability.openOnceFor(bindingOf(parts.lease), () => true)).toBe(true);
  });
});
