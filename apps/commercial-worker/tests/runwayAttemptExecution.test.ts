import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import RunwayML from "@runwayml/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecoverySleep } from "../src/acceptanceRecoveryPolicy.js";
import type { CredentialOpener } from "../src/credentialContracts.js";
import { openLeasedCredentialOnce, SealedCredentialCapability, type WorkerLogEvent } from "../src/credentialOpeningRun.js";
import { runRunwayProviderAttemptOnce, type RunwayProviderAttemptDependencies } from "../src/runwayAttemptExecution.js";
import { createHostFaultLatch } from "../src/hostFaultLatch.js";
import type { DeadlineTimer } from "../src/preProviderOrchestration.js";
import type { InputFailureCode, LeaseProof, SubmissionFailureReport, WorkerCredentialGrant, WorkerLease } from "../src/workerControlClient.js";
import type { WorkerConfig } from "../src/workerConfig.js";
import { WorkerError } from "../src/workerError.js";
import { createInMemoryObjectStore } from "./support/inMemoryObjectStore.js";
import { createTestCredentialOpener, createTestCredentialSealer, generateTestKey } from "./support/testCredentialOpening.js";

// R44B10B: the library-only real Runway composer without a database or real
// network: a recording fake control client, the test opener, the in-memory
// object store, a real development journal, and the ACTUAL @runwayml/sdk
// 4.20.0 client behind an injected counting transport.

const key = generateTestKey("runway-composer-encryption/v1");
const sealer = createTestCredentialSealer(key);
const testOpener = createTestCredentialOpener(key);

const ACCOUNT = randomUUID();
const CONNECTION = randomUUID();
const ATTEMPT = randomUUID();
const JOB = randomUUID();
const PLAINTEXT = `fixture-credential-${randomBytes(18).toString("hex")}`;
const LEASE_TOKEN = randomBytes(32).toString("base64url");
const TASK_ID = "17f20503-6c24-4c16-946b-35dbbce2af2f";
const KEY = "inputs/reference.png";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const reference = (overrides: Record<string, unknown> = {}) => ({ key: KEY, sha256: sha(PNG), byteCount: PNG.length, contentType: "image/png", ...overrides });
const request = (overrides: Record<string, unknown> = {}) => ({ prompt: "A red kite over a quiet harbour.", referenceImage: reference(), durationSeconds: 4, ...overrides });

const openingContext = (provider: string) => ({ accountId: ACCOUNT, providerConnectionId: CONNECTION, provider, credentialVersion: 1, purpose: "provider-credential" as const });
const runwayEnvelope = await sealer.seal(PLAINTEXT, openingContext("RUNWAY"));

const lease = (overrides: Partial<WorkerLease> = {}): WorkerLease => ({
  executionJobId: JOB,
  executionAttemptId: ATTEMPT,
  attemptNumber: 1,
  provider: "RUNWAY",
  model: "gen4.5",
  generationRequest: request(),
  generationRequestSha256: "c".repeat(64),
  expectedCostCap: { unit: "PROVIDER_CREDITS", amount: 48 },
  leaseToken: LEASE_TOKEN,
  fencingCounter: 1,
  leaseExpiresAt: new Date(Date.now() + 120_000),
  ...overrides,
});

const grant = (): WorkerCredentialGrant => ({
  executionAttemptId: ATTEMPT,
  fencingCounter: 1,
  credentialGrantedAt: new Date(),
  sealedEnvelope: runwayEnvelope,
  openingContext: openingContext("RUNWAY"),
});

let scratch: string;
let config: WorkerConfig;
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "bb-worker-runway-"));
  config = Object.freeze({ mode: "development", stateRoot: scratch });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

const quietTimer: DeadlineTimer = () => () => {};
const parkedSleep: RecoverySleep = (_ms, signal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    signal?.addEventListener("abort", () => resolve(), { once: true });
  });

type Overrides = Partial<{
  lease: () => Promise<WorkerLease | null>;
  submitting: () => Promise<unknown>;
  heartbeat: (call: number) => Promise<unknown>;
  submitted: () => Promise<unknown>;
  recover: () => Promise<unknown>;
}>;

function recordingClient(overrides: Overrides = {}) {
  const calls: string[] = [];
  const proofs: LeaseProof[] = [];
  const failureReports: SubmissionFailureReport[] = [];
  const inputFailures: InputFailureCode[] = [];
  const submittedIds: string[] = [];
  let heartbeats = 0;
  const now = new Date();
  const client: RunwayProviderAttemptDependencies["client"] = {
    leaseNextAttempt: async () => {
      calls.push("lease");
      return (overrides.lease ?? (async () => lease()))();
    },
    requestCredentialGrant: async (_id, proof) => {
      calls.push("grant");
      proofs.push(proof);
      return grant();
    },
    acknowledgeSubmitting: async (id, proof) => {
      calls.push("submitting");
      if (overrides.submitting) await overrides.submitting();
      return { executionAttemptId: id, fencingCounter: proof.fencingCounter, state: "SUBMITTING", submittingAt: now };
    },
    heartbeat: async (_id, proof) => {
      calls.push("heartbeat");
      heartbeats += 1;
      if (overrides.heartbeat) await overrides.heartbeat(heartbeats);
      return { fencingCounter: proof.fencingCounter, leaseExpiresAt: new Date(now.getTime() + 120_000) };
    },
    reportSubmitted: async (id, proof, providerExecutionId) => {
      calls.push("submitted");
      submittedIds.push(providerExecutionId);
      if (overrides.submitted) await overrides.submitted();
      return { executionAttemptId: id, fencingCounter: proof.fencingCounter, state: "SUBMITTED", providerExecutionId, submittedAt: now };
    },
    reportSubmissionFailed: async (id, proof, report) => {
      calls.push("failed");
      failureReports.push(report);
      const state = report.outcome === "DEFINITIVELY_REJECTED" ? "FAILED_BEFORE_SUBMISSION" : "OUTCOME_UNKNOWN";
      return { executionAttemptId: id, fencingCounter: proof.fencingCounter, state, failureCode: report.failureCode };
    },
    reportInputFailed: async (id, proof, failureCode) => {
      calls.push("inputFailed");
      inputFailures.push(failureCode);
      return { executionAttemptId: id, fencingCounter: proof.fencingCounter, state: "FAILED_BEFORE_SUBMISSION", failureCode };
    },
    recoverAcceptance: async (id, fencingCounter, providerExecutionId) => {
      calls.push("recover");
      if (overrides.recover) await overrides.recover();
      return { status: "ACKNOWLEDGED", acknowledgement: { executionAttemptId: id, fencingCounter, state: "SUBMITTED", providerExecutionId } };
    },
  };
  return { client, calls, proofs, failureReports, inputFailures, submittedIds };
}

type Answer = (request: Request) => Response | Promise<Response>;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

// The real SDK class, counted, behind a counting transport.
function provider(answer: Answer = () => json(200, { id: TASK_ID, estimatedCost: { credits: 48 } }), failConstruction = false) {
  const counts = { constructed: 0, dispatched: 0 };
  const keys: string[] = [];
  const bodies: unknown[] = [];
  class CountingRunwayML extends RunwayML {
    constructor(options: ConstructorParameters<typeof RunwayML>[0]) {
      if (failConstruction) throw new Error("construction failed");
      super(options);
      counts.constructed += 1;
    }
  }
  const transport = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const sent = input instanceof Request ? input : new Request(input, init);
    counts.dispatched += 1;
    keys.push((sent.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
    bodies.push(JSON.parse(await sent.clone().text()));
    return answer(sent);
  }) as typeof fetch;
  return { dependencies: { transport, clientConstructor: CountingRunwayML as unknown as typeof RunwayML }, counts, keys, bodies };
}

function countingOpener(failOn?: number) {
  const seen = { opened: 0 };
  const opener: CredentialOpener = {
    open: async (sealed, context) => {
      seen.opened += 1;
      if (seen.opened === failOn) throw new Error(`opener detail ${PLAINTEXT}`);
      return testOpener.open(sealed, context);
    },
  };
  return { opener, seen };
}

function setup(options: Partial<{ overrides: Overrides; answer: Answer; failConstruction: boolean; openerFailOn: number; seed: Uint8Array | null; keeperSleep: RecoverySleep }> = {}) {
  const recorded = recordingClient(options.overrides);
  const opener = countingOpener(options.openerFailOn);
  const memory = createInMemoryObjectStore();
  if (options.seed !== null) memory.seed(ACCOUNT, KEY, options.seed ?? PNG);
  const real = provider(options.answer, options.failConstruction);
  const latch = createHostFaultLatch();
  const events: WorkerLogEvent[] = [];
  const dependencies: RunwayProviderAttemptDependencies = {
    environment: {},
    client: recorded.client,
    opener: opener.opener,
    latch,
    store: memory.store,
    provider: real.dependencies,
    deadlineTimer: quietTimer,
    keeperSleep: options.keeperSleep ?? parkedSleep,
    log: (event) => events.push(event),
  };
  return { ...recorded, opened: opener.seen, memory, counts: real.counts, keys: real.keys, bodies: real.bodies, latch, events, dependencies };
}

async function rejection(promise: Promise<unknown>): Promise<WorkerError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(WorkerError);
  return error as WorkerError;
}

function expectNoSecret(...values: unknown[]) {
  const visible = values.map((value) => (value instanceof Error ? `${value.message} ${String(value.stack)} ${JSON.stringify(value)}` : JSON.stringify(value))).join(" ");
  for (const secret of [PLAINTEXT, LEASE_TOKEN, (runwayEnvelope as { ciphertext: string }).ciphertext]) expect(visible.includes(secret)).toBe(false);
}

describe("accepted path", () => {
  it("runs the locked order and reaches SUBMITTED with one client, one dispatch and the raw task.id", async () => {
    const run = setup();
    const result = await runRunwayProviderAttemptOnce(config, run.dependencies);
    expect(result).toEqual({ status: "SUBMITTED", executionAttemptId: ATTEMPT });
    expect(run.calls).toEqual(["lease", "grant", "submitting", "heartbeat", "submitted"]);
    expect(run.counts).toEqual({ constructed: 1, dispatched: 1 });
    // The first open before the permit, the single re-open after it; one grant.
    expect(run.opened.opened).toBe(2);
    expect(run.calls.filter((call) => call === "grant")).toHaveLength(1);
    // The client got exactly the re-opened granted credential.
    expect(run.keys).toEqual([PLAINTEXT]);
    expect(run.memory.calls).toHaveLength(1);
    expect(run.memory.calls[0]).toMatchObject({ accountId: ACCOUNT, key: KEY, maxBytes: 3_932_142 });
    // The exact locked body, built from the verified bytes and the authorised values.
    expect(run.bodies).toEqual([
      {
        model: "gen4.5",
        promptImage: `data:image/png;base64,${PNG.toString("base64")}`,
        promptText: "A red kite over a quiet harbour.",
        ratio: "1280:720",
        duration: 4,
        outputFormat: "mp4",
      },
    ]);
    // The raw task.id is what the control plane received.
    expect(run.submittedIds).toEqual([TASK_ID]);
    expect(run.latch.isTripped()).toBe(false);
    expectNoSecret(result, run.events, run.proofs.length);
  });
});

describe("Runway raw-byte ceiling at retrieval", () => {
  it("submits a reference of exactly 3,932,142 bytes, whose data URI is within the final limit", async () => {
    const big = Buffer.alloc(3_932_142);
    JPEG.copy(big);
    const run = setup({ overrides: { lease: async () => lease({ generationRequest: request({ referenceImage: { key: KEY, sha256: sha(big), byteCount: big.length, contentType: "image/jpeg" } }) }) }, seed: big });
    await expect(runRunwayProviderAttemptOnce(config, run.dependencies)).resolves.toEqual({ status: "SUBMITTED", executionAttemptId: ATTEMPT });
    const promptImage = (run.bodies[0] as { promptImage: string }).promptImage;
    expect(promptImage).toBe(`data:image/jpeg;base64,${big.toString("base64")}`);
    expect(promptImage.length).toBeLessThanOrEqual(5_242_880);
  });

  it("stops one byte above it through R44B10P2 INPUT_OBJECT_TOO_LARGE, before any permit, client or dispatch", async () => {
    const big = Buffer.alloc(3_932_143);
    JPEG.copy(big);
    const run = setup({ overrides: { lease: async () => lease({ generationRequest: request({ referenceImage: { key: KEY, sha256: sha(big), byteCount: big.length, contentType: "image/jpeg" } }) }) }, seed: big });
    await expect(runRunwayProviderAttemptOnce(config, run.dependencies)).resolves.toEqual({
      status: "STOPPED_ON_INPUT_MEDIA",
      executionAttemptId: ATTEMPT,
      input: { status: "PERMANENT_INPUT_REPORTED", failureCode: "INPUT_OBJECT_TOO_LARGE" },
    });
    expect(run.calls).toEqual(["lease", "grant", "inputFailed"]);
    expect(run.counts).toEqual({ constructed: 0, dispatched: 0 });
  });
});

describe("zero construction and zero dispatch before the permit", () => {
  it.each([
    ["another provider", { provider: "BUSYBOOKIE_FAKE" }, "LEASED_PROVIDER_INCOMPATIBLE"],
    ["the Google provider", { provider: "GOOGLE_GENAI", model: "gemini-omni-1.1-flash" }, "LEASED_PROVIDER_INCOMPATIBLE"],
    ["another model", { model: "gen4_turbo" }, "LEASED_PROVIDER_INCOMPATIBLE"],
    ["a malformed request", { generationRequest: { prompt: "A kite." } }, "LEASED_REQUEST_INVALID"],
    ["an unknown request member", { generationRequest: { ...request(), seed: 7 } }, "LEASED_REQUEST_INVALID"],
    ["a lease-supplied ratio", { generationRequest: { ...request(), ratio: "720:1280" } }, "LEASED_REQUEST_INVALID"],
    ["a duration below 2", { generationRequest: request({ durationSeconds: 1 }) }, "LEASED_REQUEST_INVALID"],
    ["a duration above 5", { generationRequest: request({ durationSeconds: 6 }) }, "LEASED_REQUEST_INVALID"],
    ["a non-integer duration", { generationRequest: request({ durationSeconds: 2.5 }) }, "LEASED_REQUEST_INVALID"],
    ["a 1001-unit prompt", { generationRequest: request({ prompt: "p".repeat(1001) }) }, "LEASED_REQUEST_INVALID"],
    ["a micro-USD cost cap", { expectedCostCap: { unit: "MICRO_USD" as const, amount: 2_000_000 } }, "LEASED_REQUEST_INVALID"],
  ] as const)("refuses %s before any grant, latches, and reports nothing", async (_label, overrides, code) => {
    const run = setup({ overrides: { lease: async () => lease(overrides as Partial<WorkerLease>) } });
    expect((await rejection(runRunwayProviderAttemptOnce(config, run.dependencies))).code).toBe(code);
    expect(run.calls).toEqual(["lease"]);
    expect(run.opened.opened).toBe(0);
    expect(run.counts).toEqual({ constructed: 0, dispatched: 0 });
    expect(run.memory.calls).toHaveLength(0);
    expect(run.latch.isTripped()).toBe(true);
  });

  it.each([
    ["INPUT_REFERENCE_INVALID", { referenceImage: reference({ key: "https://bucket.example/a.png" }) }, PNG],
    ["INPUT_OBJECT_NOT_FOUND", {}, null],
    ["INPUT_OBJECT_TOO_LARGE", { referenceImage: reference({ byteCount: 3_932_143 }) }, PNG],
    ["INPUT_OBJECT_INTEGRITY_MISMATCH", { referenceImage: reference({ sha256: sha(JPEG) }) }, PNG],
    ["INPUT_MEDIA_TYPE_INVALID", { referenceImage: reference({ sha256: sha(JPEG), byteCount: JPEG.length }) }, JPEG],
  ] as const)("reports %s through the input-failed policy with no permit, client or dispatch", async (code, requestOverrides, seed) => {
    const run = setup({ overrides: { lease: async () => lease({ generationRequest: request(requestOverrides) }) }, seed });
    const result = await runRunwayProviderAttemptOnce(config, run.dependencies);
    expect(result).toEqual({ status: "STOPPED_ON_INPUT_MEDIA", executionAttemptId: ATTEMPT, input: { status: "PERMANENT_INPUT_REPORTED", failureCode: code } });
    expect(run.calls).toEqual(["lease", "grant", "inputFailed"]);
    expect(run.inputFailures).toEqual([code]);
    expect(run.counts).toEqual({ constructed: 0, dispatched: 0 });
    expect(run.opened.opened).toBe(1);
    expect(run.latch.isTripped()).toBe(false);
  });

  it("leaves transient storage to expiry: no report, no latch, no permit, no client", async () => {
    const run = setup();
    run.memory.forceNext("UNAVAILABLE", "UNAVAILABLE");
    const result = await runRunwayProviderAttemptOnce(config, run.dependencies);
    expect(result).toEqual({ status: "STOPPED_ON_INPUT_MEDIA", executionAttemptId: ATTEMPT, input: { status: "TRANSIENT_STORAGE" } });
    expect(run.calls).toEqual(["lease", "grant"]);
    expect(run.counts).toEqual({ constructed: 0, dispatched: 0 });
    expect(run.latch.isTripped()).toBe(false);
  });

  it("latches an object-store host fault with no report, permit or client", async () => {
    const run = setup();
    run.memory.forceNext("ACCESS_DENIED");
    const result = await runRunwayProviderAttemptOnce(config, run.dependencies);
    expect(result).toEqual({ status: "STOPPED_ON_INPUT_MEDIA", executionAttemptId: ATTEMPT, input: { status: "HOST_FAULT" } });
    expect(run.calls).toEqual(["lease", "grant"]);
    expect(run.counts).toEqual({ constructed: 0, dispatched: 0 });
    expect(run.latch.isTripped()).toBe(true);
  });

  it.each([
    ["a SUBMITTING refusal", { submitting: async () => Promise.reject(new WorkerError("SUBMITTING_REJECTED")) }, "SUBMITTING_REJECTED"],
    ["a mandatory heartbeat refusal", { heartbeat: async () => Promise.reject(new WorkerError("HEARTBEAT_REJECTED")) }, "HEARTBEAT_REJECTED"],
    ["an unavailable permit", { submitting: async () => Promise.reject(new WorkerError("CONTROL_API_UNAVAILABLE")) }, "CONTROL_API_UNAVAILABLE"],
  ] as const)("constructs nothing and dispatches nothing on %s", async (_label, overrides, code) => {
    const run = setup({ overrides });
    expect((await rejection(runRunwayProviderAttemptOnce(config, run.dependencies))).code).toBe(code);
    expect(run.counts).toEqual({ constructed: 0, dispatched: 0 });
    expect(run.opened.opened).toBe(1);
    expect(run.calls).not.toContain("failed");
  });

  it("returns NO_WORK with nothing opened or constructed", async () => {
    const run = setup({ overrides: { lease: async () => null } });
    await expect(runRunwayProviderAttemptOnce(config, run.dependencies)).resolves.toEqual({ status: "NO_WORK" });
    expect(run.counts).toEqual({ constructed: 0, dispatched: 0 });
  });

  it.each(["RUNWAYML_API_SECRET", "RUNWAYML_BASE_URL", "RUNWAYML_CUSTOM_HEADERS", "RUNWAYML_LOG"])("refuses %s present (even empty) in the actual process environment before any request", async (name) => {
    vi.stubEnv(name, "");
    const run = setup();
    expect((await rejection(runRunwayProviderAttemptOnce(config, run.dependencies))).code).toBe("FORBIDDEN_PROVIDER_ENVIRONMENT");
    expect(run.calls).toEqual([]);
    expect(run.counts).toEqual({ constructed: 0, dispatched: 0 });
    expect(run.events).toEqual([{ stage: "STARTUP", outcome: "FAILED", code: "FORBIDDEN_PROVIDER_ENVIRONMENT" }]);
  });
});

describe("typed provider failures", () => {
  it.each([400, 401, 403, 404, 422, 429])("reports a definitive pre-ID HTTP %i once, as FAILED_BEFORE_SUBMISSION, without a host fault or retry", async (status) => {
    const run = setup({ answer: () => json(status, { error: "x" }, { "retry-after-ms": "1" }) });
    const result = await runRunwayProviderAttemptOnce(config, run.dependencies);
    expect(result).toEqual({ status: "PROVIDER_FAILURE_REPORTED", executionAttemptId: ATTEMPT, outcome: "DEFINITIVE_FAILURE", state: "FAILED_BEFORE_SUBMISSION" });
    expect(run.failureReports).toEqual([{ outcome: "DEFINITIVELY_REJECTED", failureCode: "PROVIDER_REJECTED_DEFINITIVELY" }]);
    expect(run.counts).toEqual({ constructed: 1, dispatched: 1 });
    expect(run.latch.isTripped()).toBe(false);
    expect(run.calls).not.toContain("submitted");
  });

  it.each([
    ["HTTP 408", () => json(408, { error: "x" }, { "retry-after-ms": "1" })],
    ["HTTP 409", () => json(409, { error: "x" }, { "retry-after-ms": "1" })],
    ["HTTP 500", () => json(500, { error: "x" }, { "retry-after-ms": "1" })],
    ["HTTP 503", () => json(503, { error: "x" }, { "retry-after-ms": "1" })],
    ["an unknown status", () => json(418, { error: "x" })],
    [
      "a timeout",
      () => {
        throw new DOMException("timeout", "TimeoutError");
      },
    ],
    [
      "a lost response",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ] as const)("reports %s once as OUTCOME_UNKNOWN, with no fabricated ID and no retry", async (_label, answer) => {
    const run = setup({ answer: answer as Answer });
    const result = await runRunwayProviderAttemptOnce(config, run.dependencies);
    expect(result).toEqual({ status: "PROVIDER_FAILURE_REPORTED", executionAttemptId: ATTEMPT, outcome: "AMBIGUOUS_FAILURE", state: "OUTCOME_UNKNOWN" });
    expect(run.failureReports).toEqual([{ outcome: "OUTCOME_UNKNOWN", failureCode: "PROVIDER_SUBMISSION_AMBIGUOUS" }]);
    expect(run.counts).toEqual({ constructed: 1, dispatched: 1 });
    expect(run.calls).not.toContain("submitted");
    expect(run.latch.isTripped()).toBe(false);
  });

  it("treats a malformed provider success as ambiguous plus a host fault, reported once", async () => {
    const run = setup({ answer: () => json(200, { id: "", estimatedCost: { credits: 48 } }) });
    expect((await rejection(runRunwayProviderAttemptOnce(config, run.dependencies))).code).toBe("PROVIDER_CONTRACT_VIOLATION");
    expect(run.failureReports).toEqual([{ outcome: "OUTCOME_UNKNOWN", failureCode: "PROVIDER_SUBMISSION_AMBIGUOUS" }]);
    expect(run.latch.isTripped()).toBe(true);
    expect(run.counts).toEqual({ constructed: 1, dispatched: 1 });
    expect(run.calls).not.toContain("submitted");
  });
});

describe("post-permit, pre-dispatch host faults", () => {
  it("latches a credential re-open failure after the permit, with no client, dispatch or report", async () => {
    const run = setup({ openerFailOn: 2 });
    const error = await rejection(runRunwayProviderAttemptOnce(config, run.dependencies));
    expect(error.code).toBe("CREDENTIAL_OPEN_FAILED");
    expect(run.calls).toEqual(["lease", "grant", "submitting", "heartbeat"]);
    expect(run.counts).toEqual({ constructed: 0, dispatched: 0 });
    expect(run.latch.isTripped()).toBe(true);
    expectNoSecret(error);
  });

  it("latches a client construction failure after the permit, with no dispatch or report", async () => {
    const run = setup({ failConstruction: true });
    expect((await rejection(runRunwayProviderAttemptOnce(config, run.dependencies))).code).toBe("PROVIDER_CONTRACT_VIOLATION");
    expect(run.calls).toEqual(["lease", "grant", "submitting", "heartbeat"]);
    expect(run.counts.dispatched).toBe(0);
    expect(run.latch.isTripped()).toBe(true);
  });
});

describe("acceptance, heartbeat and restart", () => {
  it("hands a lost submitted response to acceptance recovery and still reaches SUBMITTED with one dispatch", async () => {
    const run = setup({ overrides: { submitted: async () => Promise.reject(new WorkerError("CONTROL_API_UNAVAILABLE")) } });
    await expect(runRunwayProviderAttemptOnce(config, run.dependencies)).resolves.toEqual({ status: "SUBMITTED", executionAttemptId: ATTEMPT });
    expect(run.calls).toEqual(["lease", "grant", "submitting", "heartbeat", "submitted", "submitted", "recover"]);
    expect(run.counts).toEqual({ constructed: 1, dispatched: 1 });
    expect(run.failureReports).toEqual([]);
  });

  it("propagates a failed durable reconciliation after a valid ID once, with no failure report and no second create", async () => {
    const run = setup({
      overrides: {
        submitted: async () => Promise.reject(new WorkerError("SUBMITTED_REPORT_REJECTED")),
        recover: async () => Promise.reject(new WorkerError("ACCEPTANCE_RECONCILIATION_FAILED")),
      },
    });
    const error = await rejection(runRunwayProviderAttemptOnce(config, run.dependencies));
    expect(error.code).toBe("ACCEPTANCE_RECONCILIATION_FAILED");
    expect(run.failureReports).toEqual([]);
    expect(run.counts).toEqual({ constructed: 1, dispatched: 1 });
    expect(run.latch.isTripped()).toBe(true);
  });

  it("keeps the create pending through a heartbeat refusal and never resubmits", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // The keeper's first cadence wait returns at once; the permit's heartbeat (call 1) succeeds and the in-flight one (call 2) is refused.
    const quick: RecoverySleep = async () => {};
    const run = setup({
      keeperSleep: quick,
      overrides: {
        heartbeat: async (call) => {
          if (call >= 2) {
            release();
            throw new WorkerError("HEARTBEAT_REJECTED");
          }
        },
      },
      answer: async () => {
        await gate;
        return json(200, { id: TASK_ID, estimatedCost: { credits: 48 } });
      },
    });
    await expect(runRunwayProviderAttemptOnce(config, run.dependencies)).resolves.toEqual({ status: "SUBMITTED", executionAttemptId: ATTEMPT });
    expect(run.counts).toEqual({ constructed: 1, dispatched: 1 });
    expect(run.calls.filter((call) => call === "heartbeat").length).toBeGreaterThanOrEqual(2);
  });

  it("never re-creates on restart: the next invocation recovers the journalled acceptance and finds no work", async () => {
    const first = setup({
      overrides: {
        submitted: async () => Promise.reject(new WorkerError("SUBMITTED_REPORT_REJECTED")),
        recover: async () => Promise.reject(new WorkerError("ACCEPTANCE_RECONCILIATION_FAILED")),
      },
    });
    await rejection(runRunwayProviderAttemptOnce(config, first.dependencies));
    expect(first.counts.dispatched).toBe(1);
    // A new process, same state root: the durable record is reconciled, nothing is created again.
    const restarted = setup({ overrides: { lease: async () => null } });
    await expect(runRunwayProviderAttemptOnce(config, restarted.dependencies)).resolves.toEqual({ status: "NO_WORK" });
    expect(restarted.calls).toEqual(["recover", "lease"]);
    expect(restarted.counts).toEqual({ constructed: 0, dispatched: 0 });
  });
});

describe("sealed credential capability for Runway", () => {
  it("re-opens the same Runway grant exactly once, refuses another provider's binding without using it up, and requests no second grant", async () => {
    const recorded = recordingClient();
    const opener = countingOpener();
    const { createAcceptanceJournal } = await import("../src/acceptanceJournal.js");
    const journal = createAcceptanceJournal({ stateRoot: scratch, directorySync: "DEVELOPMENT_BEST_EFFORT" });
    const outcome = await openLeasedCredentialOnce({ journal, environment: {}, client: recorded.client, opener: opener.opener }, undefined, { retainSealedCredential: true });
    if (outcome.status !== "CREDENTIAL_OPENED" || outcome.sealedCredential === undefined) throw new Error("expected a capability");
    const capability = outcome.sealedCredential;
    expect(capability).toBeInstanceOf(SealedCredentialCapability);
    const serialised = JSON.stringify(outcome);
    expect(serialised.includes(PLAINTEXT) || serialised.includes((runwayEnvelope as { ciphertext: string }).ciphertext)).toBe(false);

    await expect(capability.openOnceFor({ executionAttemptId: ATTEMPT, provider: "GOOGLE_GENAI" }, () => "x")).rejects.toMatchObject({ code: "CREDENTIAL_OPEN_FAILED" });
    expect(opener.seen.opened).toBe(1);
    const seen: string[] = [];
    await expect(capability.openOnceFor({ executionAttemptId: ATTEMPT, provider: "RUNWAY" }, (credential) => seen.push(credential))).resolves.toBe(1);
    expect(seen).toEqual([PLAINTEXT]);
    await expect(capability.openOnceFor({ executionAttemptId: ATTEMPT, provider: "RUNWAY" }, () => "again")).rejects.toMatchObject({ code: "CREDENTIAL_OPEN_FAILED" });
    expect(recorded.calls.filter((call) => call === "grant")).toHaveLength(1);
    expect(opener.seen.opened).toBe(2);
    expect(JSON.stringify(capability)).toBe('"[sealed credential capability]"');
  });
});
