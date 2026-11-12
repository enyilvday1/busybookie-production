import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WorkerProviderAcceptance } from "../src/acceptanceHandler.js";
import type { RecoverySleep } from "../src/acceptanceRecoveryPolicy.js";
import { runConfiguredFakeProviderAttemptOnce, type FakeProviderAttemptDependencies } from "../src/attemptExecution.js";
import type { CredentialOpener } from "../src/credentialContracts.js";
import { openLeasedCredentialOnce, type WorkerLogEvent } from "../src/credentialOpeningRun.js";
import {
  reportSubmissionFailureWithPolicy,
  SUBMISSION_FAILURE_REPORT_MAX_ATTEMPTS,
  SUBMISSION_FAILURE_REPORT_REQUEST_DEADLINE_MS,
} from "../src/failureReportPolicy.js";
import { createFakeProviderOperationFactory, FAKE_PROVIDER_ID, fakeProviderExecutionId } from "../src/fakeProvider.js";
import { createHostFaultLatch } from "../src/hostFaultLatch.js";
import type { DeadlineTimer } from "../src/preProviderOrchestration.js";
import {
  isProviderExecutionId,
  type ProviderSubmissionOperationFactory,
  type ProviderSubmissionOutcome,
  type ProviderSubmissionRequest,
} from "../src/providerExecutionContract.js";
import type { LeaseProof, SubmissionFailureReport, WorkerCredentialGrant, WorkerLease } from "../src/workerControlClient.js";
import type { WorkerConfig } from "../src/workerConfig.js";
import { WorkerError } from "../src/workerError.js";
import { createTestCredentialOpener, createTestCredentialSealer, generateTestKey } from "./support/testCredentialOpening.js";

// R44B9: the production fake provider, the shared failure-report policy, the
// lease admission seam and the one-attempt composer, without a database or
// network: a recording fake control client, the test opener and a real
// development journal under a fresh temporary state root.

const key = generateTestKey("worker-unit-encryption/v1");
const sealer = createTestCredentialSealer(key);
const testOpener = createTestCredentialOpener(key);

const ACCOUNT = randomUUID();
const CONNECTION = randomUUID();
const ATTEMPT = randomUUID();
const JOB = randomUUID();
const PLAINTEXT = `fixture-credential-${randomBytes(18).toString("hex")}`;
const LEASE_TOKEN = randomBytes(32).toString("base64url");
const FAKE_ID = `BUSYBOOKIE_FAKE-${ATTEMPT}`;

const openingContext = (provider: string) => ({ accountId: ACCOUNT, providerConnectionId: CONNECTION, provider, credentialVersion: 1, purpose: "provider-credential" as const });
const fakeEnvelope = await sealer.seal(PLAINTEXT, openingContext(FAKE_PROVIDER_ID));
const exampleEnvelope = await sealer.seal(PLAINTEXT, openingContext("EXAMPLE_PROVIDER"));

const lease = (provider = FAKE_PROVIDER_ID): WorkerLease => ({
  executionJobId: JOB,
  executionAttemptId: ATTEMPT,
  attemptNumber: 1,
  provider,
  model: "example-model-1",
  generationRequest: { prompt: "fixture" },
  generationRequestSha256: "c".repeat(64),
  expectedCostCap: { unit: "MICRO_USD", amount: 1000 },
  leaseToken: LEASE_TOKEN,
  fencingCounter: 1,
  leaseExpiresAt: new Date(Date.now() + 120_000),
});

const grant = (provider = FAKE_PROVIDER_ID): WorkerCredentialGrant => ({
  executionAttemptId: ATTEMPT,
  fencingCounter: 1,
  credentialGrantedAt: new Date(),
  sealedEnvelope: provider === FAKE_PROVIDER_ID ? fakeEnvelope : exampleEnvelope,
  openingContext: openingContext(provider),
});

let scratch: string;
let config: WorkerConfig;
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "bb-worker-attempt-"));
  config = Object.freeze({ mode: "development", stateRoot: scratch });
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

// A deadline timer that never fires: every request here settles on its own.
const quietTimer: DeadlineTimer = () => () => {};
// The keeper's cadence sleep parks until stopped, so no tick runs unless a test asks.
const parkedSleep: RecoverySleep = (_ms, signal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    signal?.addEventListener("abort", () => resolve(), { once: true });
  });

type Overrides = Partial<{
  lease: () => Promise<WorkerLease | null>;
  grant: () => Promise<WorkerCredentialGrant>;
  submitting: () => Promise<unknown>;
  heartbeat: () => Promise<unknown>;
  submitted: (providerExecutionId: string) => Promise<unknown>;
  failed: (report: SubmissionFailureReport) => Promise<unknown>;
  recover: (providerExecutionId: string) => Promise<unknown>;
}>;

function recordingClient(overrides: Overrides = {}) {
  const calls: string[] = [];
  const proofs: LeaseProof[] = [];
  const failureReports: SubmissionFailureReport[] = [];
  const submittedIds: string[] = [];
  const now = new Date();
  const client: FakeProviderAttemptDependencies["client"] = {
    leaseNextAttempt: async () => {
      calls.push("lease");
      return (overrides.lease ?? (async () => lease()))();
    },
    requestCredentialGrant: async (_id, proof) => {
      calls.push("grant");
      proofs.push(proof);
      return (overrides.grant ?? (async () => grant()))();
    },
    acknowledgeSubmitting: async (id, proof) => {
      calls.push("submitting");
      proofs.push(proof);
      if (overrides.submitting) await overrides.submitting();
      return { executionAttemptId: id, fencingCounter: proof.fencingCounter, state: "SUBMITTING", submittingAt: now };
    },
    heartbeat: async (_id, proof) => {
      calls.push("heartbeat");
      proofs.push(proof);
      if (overrides.heartbeat) await overrides.heartbeat();
      return { fencingCounter: proof.fencingCounter, leaseExpiresAt: new Date(now.getTime() + 120_000) };
    },
    reportSubmitted: async (id, proof, providerExecutionId) => {
      calls.push("submitted");
      proofs.push(proof);
      submittedIds.push(providerExecutionId);
      if (overrides.submitted) await overrides.submitted(providerExecutionId);
      return { executionAttemptId: id, fencingCounter: proof.fencingCounter, state: "SUBMITTED", providerExecutionId, submittedAt: now };
    },
    reportSubmissionFailed: async (id, proof, report) => {
      calls.push("failed");
      proofs.push(proof);
      failureReports.push(report);
      if (overrides.failed) await overrides.failed(report);
      const state = report.outcome === "DEFINITIVELY_REJECTED" ? "FAILED_BEFORE_SUBMISSION" : "OUTCOME_UNKNOWN";
      return { executionAttemptId: id, fencingCounter: proof.fencingCounter, state, failureCode: report.failureCode };
    },
    recoverAcceptance: async (id, fencingCounter, providerExecutionId) => {
      calls.push("recover");
      if (overrides.recover) await overrides.recover(providerExecutionId);
      return { status: "ACKNOWLEDGED", acknowledgement: { executionAttemptId: id, fencingCounter, state: "SUBMITTED", providerExecutionId } };
    },
  };
  return { client, calls, proofs, failureReports, submittedIds };
}

function countingOpener() {
  const seen = { opened: 0 };
  const opener: CredentialOpener = {
    open: async (sealed, context) => {
      seen.opened += 1;
      return testOpener.open(sealed, context);
    },
  };
  return { opener, seen };
}

// Counts constructions and dispatches around any operation factory.
function countingFactory(inner: ProviderSubmissionOperationFactory = createFakeProviderOperationFactory()) {
  const counts = { constructed: 0, executed: 0 };
  const requests: ProviderSubmissionRequest[] = [];
  const factory: ProviderSubmissionOperationFactory = (request) => {
    counts.constructed += 1;
    requests.push(request);
    const operation = inner(request);
    return Object.freeze({
      execute: (onAccepted) => {
        counts.executed += 1;
        return operation.execute(onAccepted);
      },
    });
  };
  return { factory, counts, requests };
}

// A hand-written operation for contract-violation cases.
const operationFactory =
  (execute: (onAccepted: (acceptance: WorkerProviderAcceptance) => Promise<void>) => Promise<ProviderSubmissionOutcome>): ProviderSubmissionOperationFactory =>
  () =>
    Object.freeze({ execute });

function setup(overrides: Overrides = {}, extra: Partial<FakeProviderAttemptDependencies> = {}) {
  const recorded = recordingClient(overrides);
  const counted = countingOpener();
  const latch = createHostFaultLatch();
  const events: WorkerLogEvent[] = [];
  const dependencies: FakeProviderAttemptDependencies = {
    environment: {},
    client: recorded.client,
    opener: counted.opener,
    latch,
    deadlineTimer: quietTimer,
    keeperSleep: parkedSleep,
    log: (event) => events.push(event),
    ...extra,
  };
  return { ...recorded, opened: counted.seen, latch, events, dependencies };
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
  for (const secret of [PLAINTEXT, LEASE_TOKEN, (fakeEnvelope as { ciphertext: string }).ciphertext]) expect(visible.includes(secret)).toBe(false);
}

describe("production fake provider", () => {
  it("mints the attempt-bound, shared-rule-valid execution ID", () => {
    expect(FAKE_PROVIDER_ID).toBe("BUSYBOOKIE_FAKE");
    expect(FAKE_PROVIDER_ID).toMatch(/^[A-Z][A-Z0-9_]{0,31}$/);
    expect(fakeProviderExecutionId(ATTEMPT)).toBe(FAKE_ID);
    expect(isProviderExecutionId(FAKE_ID)).toBe(true);
    expect(() => fakeProviderExecutionId("not visible\u0000")).toThrow(WorkerError);
    expect(() => fakeProviderExecutionId("x".repeat(300))).toThrow(WorkerError);
  });

  it("accepts by default and settles ACCEPTED only after the awaited callback", async () => {
    const operation = createFakeProviderOperationFactory()({ executionAttemptId: ATTEMPT, provider: FAKE_PROVIDER_ID });
    let release!: () => void;
    const seen: WorkerProviderAcceptance[] = [];
    let settled = false;
    const pending = operation
      .execute(async (acceptance) => {
        seen.push(acceptance);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      .then((outcome) => {
        settled = true;
        return outcome;
      });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(seen).toEqual([{ provider: FAKE_PROVIDER_ID, providerExecutionId: FAKE_ID }]);
    expect(settled).toBe(false);
    release();
    await expect(pending).resolves.toEqual({ kind: "ACCEPTED" });
  });

  it.each(["DEFINITIVE_FAILURE", "AMBIGUOUS_FAILURE"] as const)("returns the typed %s through the explicit seam, without the callback", async (behavior) => {
    const operation = createFakeProviderOperationFactory({ behavior })({ executionAttemptId: ATTEMPT, provider: FAKE_PROVIDER_ID });
    let invoked = 0;
    await expect(operation.execute(async () => void (invoked += 1))).resolves.toEqual({ kind: behavior });
    expect(invoked).toBe(0);
  });

  it("refuses a non-fake provider at construction and a second dispatch", async () => {
    const factory = createFakeProviderOperationFactory();
    expect(() => factory({ executionAttemptId: ATTEMPT, provider: "EXAMPLE_PROVIDER" })).toThrow(expect.objectContaining({ code: "LEASED_PROVIDER_INCOMPATIBLE" }));
    const operation = factory({ executionAttemptId: ATTEMPT, provider: FAKE_PROVIDER_ID });
    await operation.execute(async () => {});
    await expect(operation.execute(async () => {})).rejects.toMatchObject({ code: "PROVIDER_CONTRACT_VIOLATION" });
  });
});

describe("shared submission failure-report policy", () => {
  const proof: LeaseProof = Object.freeze({ fencingCounter: 1, leaseToken: LEASE_TOKEN });
  const report: SubmissionFailureReport = Object.freeze({ outcome: "DEFINITIVELY_REJECTED", failureCode: "PROVIDER_REJECTED_DEFINITIVELY" });

  it("keeps the locked limits", () => {
    expect(SUBMISSION_FAILURE_REPORT_MAX_ATTEMPTS).toBe(2);
    expect(SUBMISSION_FAILURE_REPORT_REQUEST_DEADLINE_MS).toBe(10000);
  });

  it("reports once, and retries once only on CONTROL_API_UNAVAILABLE with the same report and proof", async () => {
    const ok = recordingClient();
    await expect(reportSubmissionFailureWithPolicy({ client: ok.client, deadlineTimer: quietTimer }, ATTEMPT, proof, report)).resolves.toMatchObject({
      status: "REPORTED",
      acknowledgement: { state: "FAILED_BEFORE_SUBMISSION" },
    });
    expect(ok.calls).toEqual(["failed"]);

    let first = true;
    const flaky = recordingClient({
      failed: async () => {
        if (first) {
          first = false;
          throw new WorkerError("CONTROL_API_UNAVAILABLE");
        }
      },
    });
    await expect(reportSubmissionFailureWithPolicy({ client: flaky.client, deadlineTimer: quietTimer }, ATTEMPT, proof, report)).resolves.toMatchObject({ status: "REPORTED" });
    expect(flaky.failureReports).toEqual([report, report]);
    expect(flaky.proofs).toEqual([proof, proof]);
  });

  it.each([
    ["unavailable twice", () => new WorkerError("CONTROL_API_UNAVAILABLE"), 2],
    ["refused", () => new WorkerError("SUBMISSION_FAILED_REJECTED"), 1],
    ["malformed", () => new WorkerError("MALFORMED_CONTROL_RESPONSE"), 1],
    ["an untyped throw", () => new Error("transport"), 1],
  ] as const)("establishes nothing and never throws when %s", async (_name, error, attempts) => {
    const failing = recordingClient({
      failed: async () => {
        throw error();
      },
    });
    await expect(reportSubmissionFailureWithPolicy({ client: failing.client, deadlineTimer: quietTimer }, ATTEMPT, proof, report)).resolves.toEqual({ status: "UNREPORTED" });
    expect(failing.calls).toHaveLength(attempts);
  });

  it("gives every request its own 10000 ms deadline that aborts it", async () => {
    const deadlines: number[] = [];
    const firing: DeadlineTimer = (ms, onExpiry) => {
      deadlines.push(ms);
      queueMicrotask(onExpiry);
      return () => {};
    };
    const signals: AbortSignal[] = [];
    const client = {
      reportSubmissionFailed: (_id: string, _proof: LeaseProof, _report: SubmissionFailureReport, signal?: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          signals.push(signal!);
          signal!.addEventListener("abort", () => reject(new WorkerError("CONTROL_API_UNAVAILABLE")), { once: true });
        }),
    };
    await expect(reportSubmissionFailureWithPolicy({ client, deadlineTimer: firing }, ATTEMPT, proof, report)).resolves.toEqual({ status: "UNREPORTED" });
    expect(deadlines).toEqual([10000, 10000]);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});

describe("lease admission in the shared opening path", () => {
  it("returns the in-memory attempt context with the proof and no secret", async () => {
    const { client, calls } = recordingClient();
    const { createAcceptanceJournal } = await import("../src/acceptanceJournal.js");
    const journal = createAcceptanceJournal({ stateRoot: scratch, directorySync: "DEVELOPMENT_BEST_EFFORT" });
    const outcome = await openLeasedCredentialOnce({ journal, environment: {}, client, opener: testOpener });
    expect(outcome.status).toBe("CREDENTIAL_OPENED");
    if (outcome.status !== "CREDENTIAL_OPENED") return;
    expect(Object.isFrozen(outcome.context)).toBe(true);
    expect(outcome.context.accountId).toBe(ACCOUNT);
    expect(outcome.context.proof).toEqual({ fencingCounter: 1, leaseToken: LEASE_TOKEN });
    expect(outcome.context.lease).toEqual({
      executionJobId: JOB,
      executionAttemptId: ATTEMPT,
      attemptNumber: 1,
      provider: FAKE_PROVIDER_ID,
      generationRequestSha256: "c".repeat(64),
    });
    expect(JSON.stringify(outcome).includes(PLAINTEXT)).toBe(false);
    expect(calls).toEqual(["lease", "grant"]);
  });

  it("stops before the grant when the admission refuses, and logs only safe fields", async () => {
    const { client, calls } = recordingClient();
    const counted = countingOpener();
    const events: WorkerLogEvent[] = [];
    const { createAcceptanceJournal } = await import("../src/acceptanceJournal.js");
    const journal = createAcceptanceJournal({ stateRoot: scratch, directorySync: "DEVELOPMENT_BEST_EFFORT" });
    const error = await rejection(
      openLeasedCredentialOnce({ journal, environment: {}, client, opener: counted.opener, log: (event) => events.push(event) }, () => {
        throw new WorkerError("LEASED_PROVIDER_INCOMPATIBLE");
      }),
    );
    expect(error.code).toBe("LEASED_PROVIDER_INCOMPATIBLE");
    expect(calls).toEqual(["lease"]);
    expect(counted.seen.opened).toBe(0);
    expect(events.at(-1)).toEqual({ stage: "LEASE", outcome: "FAILED", code: "LEASED_PROVIDER_INCOMPATIBLE", executionAttemptId: ATTEMPT, provider: FAKE_PROVIDER_ID });
    expectNoSecret(error, events);
  });
});

describe("one fake-provider attempt", () => {
  it("leases, opens, acknowledges, renews, then constructs and dispatches once and reports SUBMITTED", async () => {
    const run = setup();
    const counted = countingFactory();
    const result = await runConfiguredFakeProviderAttemptOnce(config, { ...run.dependencies, operationFactory: counted.factory });
    expect(result).toEqual({ status: "SUBMITTED", executionAttemptId: ATTEMPT });
    expect(run.calls).toEqual(["lease", "grant", "submitting", "heartbeat", "submitted"]);
    expect(run.submittedIds).toEqual([FAKE_ID]);
    expect(run.opened.opened).toBe(1);
    expect(counted.counts).toEqual({ constructed: 1, executed: 1 });
    // The operation sees only non-secret identity.
    expect(counted.requests).toEqual([{ executionAttemptId: ATTEMPT, provider: FAKE_PROVIDER_ID }]);
    expectNoSecret(counted.requests, run.events, result);
    // Every request carries the same lease proof.
    expect(new Set(run.proofs.map((proof) => JSON.stringify(proof)))).toEqual(new Set([JSON.stringify({ fencingCounter: 1, leaseToken: LEASE_TOKEN })]));
    expect(run.latch.isTripped()).toBe(false);
    expect(run.failureReports).toEqual([]);
  });

  it("uses the production fake by default", async () => {
    const run = setup();
    await expect(runConfiguredFakeProviderAttemptOnce(config, run.dependencies)).resolves.toEqual({ status: "SUBMITTED", executionAttemptId: ATTEMPT });
    expect(run.submittedIds).toEqual([FAKE_ID]);
  });

  it("returns NO_WORK with nothing constructed", async () => {
    const run = setup({ lease: async () => null });
    const counted = countingFactory();
    await expect(runConfiguredFakeProviderAttemptOnce(config, { ...run.dependencies, operationFactory: counted.factory })).resolves.toEqual({ status: "NO_WORK" });
    expect(run.calls).toEqual(["lease"]);
    expect(counted.counts).toEqual({ constructed: 0, executed: 0 });
  });

  it("refuses production configuration before any request", async () => {
    const run = setup();
    const counted = countingFactory();
    const error = await rejection(
      runConfiguredFakeProviderAttemptOnce(Object.freeze({ mode: "production", stateRoot: "/var/lib/busybookie/commercial-worker" }), {
        ...run.dependencies,
        operationFactory: counted.factory,
      }),
    );
    expect(error.code).toBe("WORKER_CONFIGURATION_INVALID");
    expect(run.calls).toEqual([]);
    expect(run.events).toEqual([]);
    expect(counted.counts).toEqual({ constructed: 0, executed: 0 });
  });

  it("refuses an unsuitable state root with the closed startup log before any request", async () => {
    const run = setup();
    const error = await rejection(runConfiguredFakeProviderAttemptOnce(Object.freeze({ mode: "development", stateRoot: join(scratch, "missing") }), run.dependencies));
    expect(error.code).toBe("STATE_ROOT_UNSUITABLE");
    expect(run.events).toEqual([{ stage: "STARTUP", outcome: "FAILED", code: "STATE_ROOT_UNSUITABLE" }]);
    expect(run.calls).toEqual([]);
  });

  it("stops a non-fake lease before any grant, opening, report or construction, and latches", async () => {
    const run = setup({ lease: async () => lease("EXAMPLE_PROVIDER"), grant: async () => grant("EXAMPLE_PROVIDER") });
    const counted = countingFactory();
    const error = await rejection(runConfiguredFakeProviderAttemptOnce(config, { ...run.dependencies, operationFactory: counted.factory }));
    expect(error.code).toBe("LEASED_PROVIDER_INCOMPATIBLE");
    expect(run.calls).toEqual(["lease"]);
    expect(run.opened.opened).toBe(0);
    expect(counted.counts).toEqual({ constructed: 0, executed: 0 });
    expect(run.latch.isTripped()).toBe(true);
    expectNoSecret(error, run.events);
  });

  it.each([
    ["the SUBMITTING acknowledgement is refused", { submitting: async () => { throw new WorkerError("SUBMITTING_REJECTED"); } }, "SUBMITTING_REJECTED", ["lease", "grant", "submitting"]],
    ["the mandatory renewal is refused", { heartbeat: async () => { throw new WorkerError("HEARTBEAT_REJECTED"); } }, "HEARTBEAT_REJECTED", ["lease", "grant", "submitting", "heartbeat"]],
  ] as const)("constructs and dispatches nothing when %s", async (_name, overrides, code, calls) => {
    const run = setup(overrides);
    const counted = countingFactory();
    const error = await rejection(runConfiguredFakeProviderAttemptOnce(config, { ...run.dependencies, operationFactory: counted.factory }));
    expect(error.code).toBe(code);
    expect(run.calls).toEqual(calls);
    expect(counted.counts).toEqual({ constructed: 0, executed: 0 });
    expect(run.failureReports).toEqual([]);
  });

  it.each([
    ["DEFINITIVE_FAILURE", { outcome: "DEFINITIVELY_REJECTED", failureCode: "PROVIDER_REJECTED_DEFINITIVELY" }, "FAILED_BEFORE_SUBMISSION"],
    ["AMBIGUOUS_FAILURE", { outcome: "OUTCOME_UNKNOWN", failureCode: "PROVIDER_SUBMISSION_AMBIGUOUS" }, "OUTCOME_UNKNOWN"],
  ] as const)("reports %s once through the shared policy, with no retry and no host fault", async (behavior, report, state) => {
    const run = setup();
    const counted = countingFactory(createFakeProviderOperationFactory({ behavior }));
    const result = await runConfiguredFakeProviderAttemptOnce(config, { ...run.dependencies, operationFactory: counted.factory });
    expect(result).toEqual({ status: "PROVIDER_FAILURE_REPORTED", executionAttemptId: ATTEMPT, outcome: behavior, state });
    expect(run.failureReports).toEqual([report]);
    expect(run.calls).toEqual(["lease", "grant", "submitting", "heartbeat", "failed"]);
    expect(counted.counts).toEqual({ constructed: 1, executed: 1 });
    expect(run.latch.isTripped()).toBe(false);
  });

  it("leaves an unreported provider failure to the authoritative sweep", async () => {
    const run = setup({
      failed: async () => {
        throw new WorkerError("CONTROL_API_UNAVAILABLE");
      },
    });
    const result = await runConfiguredFakeProviderAttemptOnce(config, { ...run.dependencies, operationFactory: createFakeProviderOperationFactory({ behavior: "AMBIGUOUS_FAILURE" }) });
    expect(result).toEqual({ status: "PROVIDER_FAILURE_UNREPORTED", executionAttemptId: ATTEMPT, outcome: "AMBIGUOUS_FAILURE" });
    expect(run.calls.filter((call) => call === "failed")).toHaveLength(2);
    expect(run.latch.isTripped()).toBe(false);
  });

  it("does not settle the dispatch until the durable acceptance and its report have resolved", async () => {
    let release!: () => void;
    const run = setup({
      submitted: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    const order: string[] = [];
    const counted = countingFactory();
    const attempt = runConfiguredFakeProviderAttemptOnce(config, {
      ...run.dependencies,
      operationFactory: (request) => {
        const operation = counted.factory(request);
        return Object.freeze({
          execute: async (onAccepted) => {
            const outcome = await operation.execute(async (acceptance) => {
              await onAccepted(acceptance);
              order.push("acceptance resolved");
            });
            order.push("dispatch settled");
            return outcome;
          },
        });
      },
    });
    while (!run.calls.includes("submitted")) await new Promise<void>((resolve) => setImmediate(resolve));
    expect(order).toEqual([]);
    release();
    await expect(attempt).resolves.toEqual({ status: "SUBMITTED", executionAttemptId: ATTEMPT });
    expect(order).toEqual(["acceptance resolved", "dispatch settled"]);
  });

  it("treats ACCEPTED without the callback as ambiguous and a contract violation", async () => {
    const run = setup();
    const error = await rejection(runConfiguredFakeProviderAttemptOnce(config, { ...run.dependencies, operationFactory: operationFactory(async () => ({ kind: "ACCEPTED" })) }));
    expect(error.code).toBe("PROVIDER_CONTRACT_VIOLATION");
    expect(run.failureReports).toEqual([{ outcome: "OUTCOME_UNKNOWN", failureCode: "PROVIDER_SUBMISSION_AMBIGUOUS" }]);
    expect(run.calls).not.toContain("submitted");
    expect(run.latch.isTripped()).toBe(true);
  });

  it("treats an un-awaited callback as a contract violation with no failure report", async () => {
    let release!: () => void;
    const run = setup({
      submitted: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    const error = await rejection(
      runConfiguredFakeProviderAttemptOnce(config, {
        ...run.dependencies,
        operationFactory: operationFactory(async (onAccepted) => {
          void onAccepted({ provider: FAKE_PROVIDER_ID, providerExecutionId: FAKE_ID }).catch(() => {});
          return { kind: "ACCEPTED" };
        }),
      }),
    );
    expect(error.code).toBe("PROVIDER_CONTRACT_VIOLATION");
    expect(run.latch.isTripped()).toBe(true);
    while (release === undefined) await new Promise<void>((resolve) => setImmediate(resolve));
    release();
    expect(run.failureReports).toEqual([]);
  });

  it("propagates a callback failure once, with only the adapter's own report", async () => {
    const run = setup();
    // An ID the shared rule refuses: no durable acceptance, one adapter report.
    const error = await rejection(
      runConfiguredFakeProviderAttemptOnce(config, {
        ...run.dependencies,
        operationFactory: operationFactory(async (onAccepted) => {
          await onAccepted({ provider: FAKE_PROVIDER_ID, providerExecutionId: "not a valid id" }).catch(() => {});
          return { kind: "DEFINITIVE_FAILURE" };
        }),
      }),
    );
    expect(error.code).toBe("PROVIDER_ACCEPTANCE_INVALID");
    expect(run.failureReports).toEqual([{ outcome: "OUTCOME_UNKNOWN", failureCode: "PROVIDER_EXECUTION_ID_INVALID" }]);
    expect(run.calls).not.toContain("submitted");
    expect(run.latch.isTripped()).toBe(true);
  });

  it("propagates the adapter's fail-closed error when the post-durable report breaks the contract", async () => {
    const run = setup({
      submitted: async () => {
        throw new WorkerError("MALFORMED_CONTROL_RESPONSE");
      },
    });
    const error = await rejection(runConfiguredFakeProviderAttemptOnce(config, run.dependencies));
    expect(error.code).toBe("MALFORMED_CONTROL_RESPONSE");
    expect(run.failureReports).toEqual([]);
    expect(run.latch.isTripped()).toBe(true);
  });

  it("hands a refused live report to acceptance recovery and still reaches SUBMITTED", async () => {
    const run = setup({
      submitted: async () => {
        throw new WorkerError("SUBMITTED_REPORT_REJECTED");
      },
    });
    await expect(runConfiguredFakeProviderAttemptOnce(config, run.dependencies)).resolves.toEqual({ status: "SUBMITTED", executionAttemptId: ATTEMPT });
    expect(run.calls).toEqual(["lease", "grant", "submitting", "heartbeat", "submitted", "recover"]);
    expect(run.failureReports).toEqual([]);
    expect(run.latch.isTripped()).toBe(false);
  });

  it.each(["DEFINITIVE_FAILURE", "AMBIGUOUS_FAILURE"] as const)("treats %s after durable acceptance as a violation that reports nothing", async (kind) => {
    const run = setup();
    const error = await rejection(
      runConfiguredFakeProviderAttemptOnce(config, {
        ...run.dependencies,
        operationFactory: operationFactory(async (onAccepted) => {
          await onAccepted({ provider: FAKE_PROVIDER_ID, providerExecutionId: FAKE_ID });
          return { kind };
        }),
      }),
    );
    expect(error.code).toBe("PROVIDER_CONTRACT_VIOLATION");
    expect(run.calls.filter((call) => call === "submitted")).toHaveLength(1);
    expect(run.failureReports).toEqual([]);
    expect(run.latch.isTripped()).toBe(true);
  });

  it.each([
    ["before acceptance", false],
    ["after acceptance", true],
  ] as const)("treats an untyped throw %s as a violation that reports nothing", async (_name, accept) => {
    const run = setup();
    const error = await rejection(
      runConfiguredFakeProviderAttemptOnce(config, {
        ...run.dependencies,
        operationFactory: operationFactory(async (onAccepted) => {
          if (accept) await onAccepted({ provider: FAKE_PROVIDER_ID, providerExecutionId: FAKE_ID });
          throw new Error(`transport detail ${LEASE_TOKEN}`);
        }),
      }),
    );
    expect(error.code).toBe("PROVIDER_CONTRACT_VIOLATION");
    expectNoSecret(error);
    expect(run.failureReports).toEqual([]);
    expect(run.latch.isTripped()).toBe(true);
  });

  it("treats an unknown outcome as a violation", async () => {
    const run = setup();
    const error = await rejection(
      runConfiguredFakeProviderAttemptOnce(config, {
        ...run.dependencies,
        operationFactory: operationFactory(async () => ({ kind: "RETRY" }) as unknown as ProviderSubmissionOutcome),
      }),
    );
    expect(error.code).toBe("PROVIDER_CONTRACT_VIOLATION");
    expect(run.failureReports).toEqual([]);
  });

  it("keeps the lease alive while the dispatch is pending", async () => {
    const sleeps: number[] = [];
    let ticks = 0;
    let finish!: () => void;
    // The first cadence wait elapses at once; later waits park until stopped.
    const keeperSleep: RecoverySleep = async (ms, signal) => {
      sleeps.push(ms);
      ticks += 1;
      if (ticks === 1) return;
      await parkedSleep(ms, signal);
    };
    const run = setup({}, { keeperSleep });
    const attempt = runConfiguredFakeProviderAttemptOnce(config, {
      ...run.dependencies,
      operationFactory: operationFactory(async (onAccepted) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        await onAccepted({ provider: FAKE_PROVIDER_ID, providerExecutionId: FAKE_ID });
        return { kind: "ACCEPTED" };
      }),
    });
    while (run.calls.filter((call) => call === "heartbeat").length < 2) await new Promise<void>((resolve) => setImmediate(resolve));
    expect(run.calls).toEqual(["lease", "grant", "submitting", "heartbeat", "heartbeat"]);
    expect(sleeps[0]).toBe(30000);
    finish();
    await expect(attempt).resolves.toEqual({ status: "SUBMITTED", executionAttemptId: ATTEMPT });
    expect(run.latch.isTripped()).toBe(false);
  });
});
