import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ACCEPTANCE_FAILURE_REPORT_MAX_ATTEMPTS,
  ACCEPTANCE_FAILURE_REPORT_REQUEST_DEADLINE_MS,
  createAcceptanceAdapter,
  LIVE_SUBMITTED_MAX_ATTEMPTS,
  LIVE_SUBMITTED_REQUEST_DEADLINE_MS,
  type AcceptanceAdapterDependencies,
} from "../src/acceptanceAdapter.js";
import {
  AcceptanceNotDurableError,
  createDurableAcceptanceHandler,
  type AcceptanceContext,
  type WorkerProviderAcceptance,
} from "../src/acceptanceHandler.js";
import {
  AcceptanceJournalError,
  buildAcceptanceRecord,
  createAcceptanceJournal,
  serializeAcceptanceRecord,
  type AcceptanceJournal,
  type AcceptanceRecord,
} from "../src/acceptanceJournal.js";
import { ACCEPTANCE_RECOVERY_RETRY_MAX_ATTEMPTS } from "../src/acceptanceRecoveryPolicy.js";
import { createHostFaultLatch, type HostFaultLatch } from "../src/hostFaultLatch.js";
import type { DeadlineTimer } from "../src/preProviderOrchestration.js";
import type {
  LeaseProof,
  SubmissionFailureReport,
  WorkerAcceptanceRecoveryResult,
  WorkerSubmissionFailedAcknowledgement,
  WorkerSubmittedAcknowledgement,
} from "../src/workerControlClient.js";
import { WorkerError, type WorkerErrorCode } from "../src/workerError.js";
import { fakeRecoveryTime } from "./support/fakeRecoveryTime.js";

// R44B6Y: the inner durable acceptance handler, the outer acceptance adapter
// and the host-fault latch (architecture section 18, "Acceptance handler and
// adapter", R44B6Y0). Fake journal, client, deadline timer and recovery time:
// no network, no control plane, no provider and no real waiting. A
// test-local `await adapter(acceptance)` stands in for the future provider
// callback; nothing here is provider execution.

const ATTEMPT = "11111111-2222-4333-8444-555555555555";
const TOKEN = "T".repeat(43);
const PROOF: LeaseProof = Object.freeze({ fencingCounter: 3, leaseToken: TOKEN });
const SUBMITTING_AT = new Date("2026-11-11T10:00:00.000Z");
const ACCEPTED_AT = new Date("2026-11-11T10:00:01.250Z");
const PROVIDER = "EXAMPLE_PROVIDER";
// Opaque and byte-exact: quotes, a backslash and mixed case survive unchanged.
const EXECUTION = 'models/X/operations/op-"q"\\1';
const CONTEXT: AcceptanceContext = Object.freeze({
  lease: Object.freeze({
    executionJobId: "66666666-7777-4888-9999-aaaaaaaaaaaa",
    executionAttemptId: ATTEMPT,
    attemptNumber: 1,
    provider: PROVIDER,
    generationRequestSha256: "c".repeat(64),
  }),
  accountId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
  permit: Object.freeze({ executionAttemptId: ATTEMPT, fencingCounter: 3, submittingAt: SUBMITTING_AT }),
});
const ACCEPTANCE: WorkerProviderAcceptance = Object.freeze({ provider: PROVIDER, providerExecutionId: EXECUTION });
const clock = () => ACCEPTED_AT;
const EXPECTED_RECORD = buildAcceptanceRecord(
  {
    executionAttemptId: ATTEMPT,
    executionJobId: CONTEXT.lease.executionJobId,
    accountId: CONTEXT.accountId,
    attemptNumber: 1,
    fencingCounter: 3,
    provider: PROVIDER,
    generationRequestSha256: "c".repeat(64),
    submittingAt: SUBMITTING_AT,
    providerExecutionId: EXECUTION,
    providerAcceptedAt: ACCEPTED_AT,
  },
  ACCEPTED_AT,
);

const SUBMITTED_ACK: WorkerSubmittedAcknowledgement = Object.freeze({
  executionAttemptId: ATTEMPT,
  fencingCounter: 3,
  state: "SUBMITTED",
  providerExecutionId: EXECUTION,
  submittedAt: new Date("2026-11-11T10:00:02.000Z"),
});
const FAILED_ACK: WorkerSubmissionFailedAcknowledgement = Object.freeze({
  executionAttemptId: ATTEMPT,
  fencingCounter: 3,
  state: "OUTCOME_UNKNOWN",
  failureCode: "PROVIDER_EXECUTION_ID_INVALID",
});
const recovered = (state: "SUBMITTED" | "SUCCEEDED" | "SUBMITTED_FAILED" | "ABANDONED"): WorkerAcceptanceRecoveryResult =>
  Object.freeze({ status: "ACKNOWLEDGED", acknowledgement: Object.freeze({ executionAttemptId: ATTEMPT, fencingCounter: 3, state, providerExecutionId: EXECUTION }) });
const STILL_SUBMITTING: WorkerAcceptanceRecoveryResult = Object.freeze({ status: "ATTEMPT_STILL_SUBMITTING" });

// ---------------------------------------------------------------------------
// Test doubles

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

// A step is a value, a closed error, "HANG" (ends only when its signal
// aborts, reported as the real client does) or a deferred the test settles.
type Step<T> = T | WorkerErrorCode | "HANG" | Deferred<T>;
const isDeferred = <T>(step: Step<T>): step is Deferred<T> => typeof step === "object" && step !== null && "promise" in step && "resolve" in step;

function answer<T>(steps: readonly Step<T>[], index: number, signal?: AbortSignal): Promise<T> {
  const step = steps[index];
  if (step === undefined) return Promise.reject(new Error(`unexpected request ${index + 1}`));
  if (step === "HANG") {
    return new Promise<T>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new WorkerError("CONTROL_API_UNAVAILABLE"))));
  }
  if (isDeferred(step)) return step.promise;
  if (typeof step === "string") return Promise.reject(new WorkerError(step as WorkerErrorCode));
  return Promise.resolve(step);
}

type JournalMode = "ok" | "write-failed" | "conflict" | Deferred<void>;

function fakeJournal(mode: JournalMode = "ok") {
  const published: AcceptanceRecord[] = [];
  const removed: AcceptanceRecord[] = [];
  const calls: string[] = [];
  const journal: Pick<AcceptanceJournal, "publish" | "removeAcknowledgedRecord"> & Pick<AcceptanceJournal, "prepare"> = {
    prepare: async () => {
      calls.push("prepare");
      return Object.freeze({ directorySyncSupported: true });
    },
    publish: async (record) => {
      calls.push("publish");
      published.push(record);
      if (mode === "write-failed") throw new AcceptanceJournalError("ACCEPTANCE_JOURNAL_WRITE_FAILED");
      if (mode === "conflict") throw new AcceptanceJournalError("ACCEPTANCE_JOURNAL_CONFLICT");
      if (typeof mode === "object") await mode.promise;
      return Object.freeze({ outcome: "PUBLISHED", record, directorySynced: true, temporaryRemoved: true });
    },
    removeAcknowledgedRecord: async (record) => {
      calls.push("remove");
      removed.push(record);
    },
  };
  return { journal, published, removed, calls };
}

type ClientScript = Readonly<{
  submitted?: readonly Step<WorkerSubmittedAcknowledgement>[];
  failed?: readonly Step<WorkerSubmissionFailedAcknowledgement>[];
  recovery?: readonly Step<WorkerAcceptanceRecoveryResult>[];
}>;

type ClientCall =
  | { kind: "submitted"; attemptId: string; proof: LeaseProof; providerExecutionId: string; signal?: AbortSignal }
  | { kind: "failed"; attemptId: string; proof: LeaseProof; report: SubmissionFailureReport; signal?: AbortSignal }
  | { kind: "recovery"; attemptId: string; fencingCounter: number; providerExecutionId: string; signal?: AbortSignal };

function fakeClient(script: ClientScript) {
  const calls: ClientCall[] = [];
  let submitted = 0;
  let failed = 0;
  let recovery = 0;
  const client: AcceptanceAdapterDependencies["client"] = {
    reportSubmitted: (attemptId, proof, providerExecutionId, signal) => {
      calls.push({ kind: "submitted", attemptId, proof, providerExecutionId, ...(signal === undefined ? {} : { signal }) });
      return answer(script.submitted ?? [], submitted++, signal);
    },
    reportSubmissionFailed: (attemptId, proof, report, signal) => {
      calls.push({ kind: "failed", attemptId, proof, report, ...(signal === undefined ? {} : { signal }) });
      return answer(script.failed ?? [], failed++, signal);
    },
    recoverAcceptance: (attemptId, fencingCounter, providerExecutionId, signal) => {
      calls.push({ kind: "recovery", attemptId, fencingCounter, providerExecutionId, ...(signal === undefined ? {} : { signal }) });
      return answer(script.recovery ?? [], recovery++, signal);
    },
  };
  const of = <K extends ClientCall["kind"]>(kind: K) => calls.filter((call): call is Extract<ClientCall, { kind: K }> => call.kind === kind);
  return { client, calls, of, kinds: () => calls.map((call) => call.kind) };
}

function fakeTimer() {
  const deadlines: { ms: number; fire: () => void; cancelled: boolean }[] = [];
  const timer: DeadlineTimer = (ms, onExpiry) => {
    const entry = { ms, fire: onExpiry, cancelled: false };
    deadlines.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  return { timer, deadlines };
}

function adapterHarness(script: ClientScript, mode: JournalMode = "ok") {
  const journal = fakeJournal(mode);
  const client = fakeClient(script);
  const time = fakeTimer();
  const recoveryTime = fakeRecoveryTime();
  const latch = createHostFaultLatch();
  const adapter = createAcceptanceAdapter(CONTEXT, PROOF, {
    journal: journal.journal,
    client: client.client,
    latch,
    clock,
    deadlineTimer: time.timer,
    monotonicNow: recoveryTime.monotonicNow,
    sleep: recoveryTime.sleep,
  });
  return { adapter, journal, client, time, recoveryTime, latch };
}

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> => promise.then(() => new Error("expected a rejection"), (error: unknown) => error);

const codeOf = async (promise: Promise<unknown>) => {
  const error = await rejectionOf(promise);
  expect(error).toBeInstanceOf(WorkerError);
  const text = `${(error as Error).message} ${JSON.stringify(error)} ${String((error as Error).stack)}`;
  expect(text.includes(TOKEN) || text.includes(EXECUTION)).toBe(false);
  return (error as WorkerError).code;
};

// Lets every queued callback run; a promise still unsettled afterwards is
// genuinely waiting on the test.
const flush = async () => {
  for (let index = 0; index < 25; index += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};
const track = (promise: Promise<unknown>) => {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  return () => settled;
};

const newInner = (mode: JournalMode = "ok", latch: HostFaultLatch = createHostFaultLatch()) => {
  const journal = fakeJournal(mode);
  return { handler: createDurableAcceptanceHandler(CONTEXT, { journal: journal.journal, latch, clock }), journal, latch };
};

// ---------------------------------------------------------------------------

describe("host-fault latch", () => {
  it("starts clear, trips once and stays tripped, with no reset of any kind", () => {
    const latch = createHostFaultLatch();
    expect(latch.isTripped()).toBe(false);
    latch.trip();
    expect(latch.isTripped()).toBe(true);
    latch.trip();
    expect(latch.isTripped()).toBe(true);
    expect(Object.keys(latch).sort()).toEqual(["isTripped", "trip"]);
    expect(Object.isFrozen(latch)).toBe(true);
    expect(() => {
      (latch as { reset?: unknown }).reset = () => undefined;
    }).toThrow(TypeError);
    // It records no reason, so it can hold no secret.
    expect(JSON.stringify(latch)).toBe("{}");
  });

  it("is per instance: one latch tripping never trips another", () => {
    const first = createHostFaultLatch();
    const second = createHostFaultLatch();
    first.trip();
    expect(second.isTripped()).toBe(false);
  });
});

describe("inner durable acceptance handler", () => {
  it("validates, builds the record once, publishes it once and returns that exact record", async () => {
    const { handler, journal, latch } = newInner();
    const record = await handler(ACCEPTANCE);
    expect(record).toEqual(EXPECTED_RECORD);
    expect(serializeAcceptanceRecord(record)).toBe(serializeAcceptanceRecord(EXPECTED_RECORD));
    expect(journal.calls).toEqual(["publish"]);
    expect(journal.published[0]).toBe(record);
    // Byte-for-byte: never trimmed, re-cased or otherwise normalised.
    expect(record.providerExecutionId).toBe(EXECUTION);
    expect(record.fencingCounter).toBe(3);
    expect(record.submittingAt).toBe(SUBMITTING_AT.toISOString());
    expect(latch.isTripped()).toBe(false);
    expect(serializeAcceptanceRecord(record).includes(TOKEN)).toBe(false);
  });

  it("never prepares the journal and has no control-plane client to report with", async () => {
    const { handler, journal } = newInner();
    await handler(ACCEPTANCE);
    expect(journal.calls).not.toContain("prepare");
    expect(journal.calls).not.toContain("remove");
  });

  it.each([
    ["a different provider", { provider: "OTHER_PROVIDER", providerExecutionId: EXECUTION }],
    ["a provider differing only in case", { provider: PROVIDER.toLowerCase(), providerExecutionId: EXECUTION }],
    ["leading whitespace", { provider: PROVIDER, providerExecutionId: ` ${EXECUTION}` }],
    ["trailing whitespace", { provider: PROVIDER, providerExecutionId: `${EXECUTION} ` }],
    ["a trailing newline", { provider: PROVIDER, providerExecutionId: `${EXECUTION}\n` }],
    ["an empty ID", { provider: PROVIDER, providerExecutionId: "" }],
    ["a URL", { provider: PROVIDER, providerExecutionId: "https://provider.example/op/1" }],
    ["a 257-character ID", { provider: PROVIDER, providerExecutionId: "x".repeat(257) }],
    ["a non-string ID", { provider: PROVIDER, providerExecutionId: 42 }],
    ["a missing acceptance", undefined],
  ] as const)("refuses %s as PROVIDER_EXECUTION_ID_INVALID, records nothing and trips the latch", async (_label, acceptance) => {
    const { handler, journal, latch } = newInner();
    const error = await rejectionOf(handler(acceptance as unknown as WorkerProviderAcceptance));
    expect(error).toBeInstanceOf(AcceptanceNotDurableError);
    expect((error as AcceptanceNotDurableError).failureCode).toBe("PROVIDER_EXECUTION_ID_INVALID");
    expect((error as AcceptanceNotDurableError).workerError.code).toBe("PROVIDER_ACCEPTANCE_INVALID");
    expect(journal.calls).toEqual([]);
    expect(latch.isTripped()).toBe(true);
  });

  it("classifies a journal write failure as ACCEPTANCE_JOURNAL_WRITE_FAILED after one publication", async () => {
    const { handler, journal, latch } = newInner("write-failed");
    const error = (await rejectionOf(handler(ACCEPTANCE))) as AcceptanceNotDurableError;
    expect(error).toBeInstanceOf(AcceptanceNotDurableError);
    expect(error.failureCode).toBe("ACCEPTANCE_JOURNAL_WRITE_FAILED");
    expect(error.workerError.code).toBe("ACCEPTANCE_JOURNAL_WRITE_FAILED");
    expect(journal.calls).toEqual(["publish"]);
    expect(latch.isTripped()).toBe(true);
  });

  it("keeps a journal conflict local while classifying it upstream as ACCEPTANCE_JOURNAL_WRITE_FAILED", async () => {
    const { handler, journal, latch } = newInner("conflict");
    const error = (await rejectionOf(handler(ACCEPTANCE))) as AcceptanceNotDurableError;
    expect(error.failureCode).toBe("ACCEPTANCE_JOURNAL_WRITE_FAILED");
    expect(error.workerError.code).toBe("ACCEPTANCE_JOURNAL_CONFLICT");
    expect(journal.calls).toEqual(["publish"]);
    expect(latch.isTripped()).toBe(true);
  });

  it("is single use: a later invocation fails closed, publishes nothing and trips the latch", async () => {
    const { handler, journal, latch } = newInner();
    const first = await handler(ACCEPTANCE);
    const error = await rejectionOf(handler({ provider: PROVIDER, providerExecutionId: "op-second" }));
    expect(error).toBeInstanceOf(WorkerError);
    expect(error).not.toBeInstanceOf(AcceptanceNotDurableError);
    expect((error as WorkerError).code).toBe("PROVIDER_ACCEPTANCE_INVALID");
    expect(journal.published).toEqual([first]);
    expect(latch.isTripped()).toBe(true);
  });

  it("is single use under concurrency: the second call is refused before the first has published", async () => {
    const gate = deferred<void>();
    const { handler, journal, latch } = newInner(gate);
    const first = handler(ACCEPTANCE);
    const second = handler(ACCEPTANCE);
    expect((await rejectionOf(second)) as WorkerError).toMatchObject({ code: "PROVIDER_ACCEPTANCE_INVALID" });
    expect(journal.calls).toEqual(["publish"]);
    gate.resolve();
    // The first invocation stays authoritative and completes unchanged.
    expect(await first).toEqual(EXPECTED_RECORD);
    expect(journal.published).toHaveLength(1);
    expect(latch.isTripped()).toBe(true);
  });

  it("refuses a permit that belongs to another attempt", () => {
    const context = { ...CONTEXT, permit: { ...CONTEXT.permit, executionAttemptId: "99999999-2222-4333-8444-555555555555" } };
    expect(() => createDurableAcceptanceHandler(context, { journal: fakeJournal().journal, latch: createHostFaultLatch() })).toThrow(
      expect.objectContaining({ code: "WORKER_CONFIGURATION_INVALID" }),
    );
  });
});

describe("acceptance adapter constants", () => {
  it("names exactly the locked values", () => {
    expect({
      live: LIVE_SUBMITTED_MAX_ATTEMPTS,
      liveDeadline: LIVE_SUBMITTED_REQUEST_DEADLINE_MS,
      report: ACCEPTANCE_FAILURE_REPORT_MAX_ATTEMPTS,
      reportDeadline: ACCEPTANCE_FAILURE_REPORT_REQUEST_DEADLINE_MS,
    }).toEqual({ live: 2, liveDeadline: 10000, report: 2, reportDeadline: 10000 });
  });

  it("refuses a proof from another fencing generation than the permit", () => {
    expect(() =>
      createAcceptanceAdapter(CONTEXT, { ...PROOF, fencingCounter: 4 }, { journal: fakeJournal().journal, client: fakeClient({}).client, latch: createHostFaultLatch() }),
    ).toThrow(expect.objectContaining({ code: "WORKER_CONFIGURATION_INVALID" }));
  });
});

describe("live submitted report", () => {
  it("resolves after one exact acknowledgement, keeps the record and leaves the latch clear", async () => {
    const run = adapterHarness({ submitted: [SUBMITTED_ACK] });
    await run.adapter(ACCEPTANCE);
    expect(run.client.kinds()).toEqual(["submitted"]);
    const [call] = run.client.of("submitted");
    expect(call).toMatchObject({ attemptId: ATTEMPT, proof: { fencingCounter: 3, leaseToken: TOKEN }, providerExecutionId: EXECUTION });
    expect(call!.signal).toBeInstanceOf(AbortSignal);
    expect(run.journal.calls).toEqual(["publish"]);
    expect(run.journal.removed).toEqual([]);
    expect(run.latch.isTripped()).toBe(false);
    expect(run.time.deadlines.map(({ ms, cancelled }) => ({ ms, cancelled }))).toEqual([{ ms: 10000, cancelled: true }]);
  });

  it("retries CONTROL_API_UNAVAILABLE once, immediately, with the same proof and ID and a fresh controller", async () => {
    const run = adapterHarness({ submitted: ["CONTROL_API_UNAVAILABLE", SUBMITTED_ACK] });
    await run.adapter(ACCEPTANCE);
    const calls = run.client.of("submitted");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.proof).toBe(calls[1]!.proof);
    expect(calls[0]!.proof).not.toBe(PROOF);
    expect(calls.map(({ providerExecutionId }) => providerExecutionId)).toEqual([EXECUTION, EXECUTION]);
    expect(calls[0]!.signal).not.toBe(calls[1]!.signal);
    expect(run.time.deadlines.map(({ ms, cancelled }) => ({ ms, cancelled }))).toEqual([
      { ms: 10000, cancelled: true },
      { ms: 10000, cancelled: true },
    ]);
    // No backoff: the recovery time source was never asked to sleep.
    expect(run.recoveryTime.backoffs).toEqual([]);
    expect(run.client.of("recovery")).toEqual([]);
    expect(run.client.of("failed")).toEqual([]);
    expect(run.latch.isTripped()).toBe(false);
  });

  it("treats a deadline abort as unavailable and makes the second attempt under a new deadline", async () => {
    const run = adapterHarness({ submitted: ["HANG", SUBMITTED_ACK] });
    const pending = run.adapter(ACCEPTANCE);
    await flush();
    expect(run.client.of("submitted")).toHaveLength(1);
    run.time.deadlines[0]!.fire();
    await pending;
    const calls = run.client.of("submitted");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.signal!.aborted).toBe(true);
    expect(calls[1]!.signal!.aborted).toBe(false);
  });

  it("hands over to acceptance recovery after two unavailable attempts, never a third live call", async () => {
    const run = adapterHarness({ submitted: ["CONTROL_API_UNAVAILABLE", "CONTROL_API_UNAVAILABLE"], recovery: [recovered("SUBMITTED")] });
    await run.adapter(ACCEPTANCE);
    expect(run.client.kinds()).toEqual(["submitted", "submitted", "recovery"]);
    expect(run.client.of("recovery")[0]).toMatchObject({ attemptId: ATTEMPT, fencingCounter: 3, providerExecutionId: EXECUTION });
    expect(run.journal.removed).toEqual([]);
    expect(run.latch.isTripped()).toBe(false);
  });

  it("hands a 409 refusal straight to acceptance recovery, without a second live attempt or any lease inference", async () => {
    const run = adapterHarness({ submitted: ["SUBMITTED_REPORT_REJECTED"], recovery: [recovered("SUBMITTED")] });
    await run.adapter(ACCEPTANCE);
    expect(run.client.kinds()).toEqual(["submitted", "recovery"]);
    expect(run.client.of("failed")).toEqual([]);
    expect(run.journal.calls).toEqual(["publish"]);
    expect(run.latch.isTripped()).toBe(false);
  });

  it.each(["WORKER_AUTHENTICATION_REJECTED", "MALFORMED_CONTROL_RESPONSE", "SUBMITTED_REPORT_INVALID"] as const)(
    "fails closed on %s: record kept, latch tripped, no recovery, no failure report",
    async (code) => {
      const run = adapterHarness({ submitted: [code] });
      expect(await codeOf(run.adapter(ACCEPTANCE))).toBe(code);
      expect(run.client.kinds()).toEqual(["submitted"]);
      expect(run.journal.removed).toEqual([]);
      expect(run.journal.published).toHaveLength(1);
      expect(run.latch.isTripped()).toBe(true);
    },
  );

  it("fails closed on an unexpected non-worker error from the live report", async () => {
    const run = adapterHarness({ submitted: [] });
    expect(await codeOf(run.adapter(ACCEPTANCE))).toBe("ACCEPTANCE_RECONCILIATION_FAILED");
    expect(run.client.kinds()).toEqual(["submitted"]);
    expect(run.latch.isTripped()).toBe(true);
  });
});

describe("acceptance-recovery fallback", () => {
  it("resolves on an exact SUBMITTED recovery, keeping the record and leaving the latch clear", async () => {
    const run = adapterHarness({ submitted: ["SUBMITTED_REPORT_REJECTED"], recovery: [STILL_SUBMITTING, recovered("SUBMITTED")] });
    await run.adapter(ACCEPTANCE);
    // ATTEMPT_STILL_SUBMITTING is waited on only by the shared policy's backoff.
    expect(run.recoveryTime.backoffs).toEqual([1000]);
    expect(run.journal.removed).toEqual([]);
    expect(run.latch.isTripped()).toBe(false);
  });

  it.each(["SUCCEEDED", "SUBMITTED_FAILED", "ABANDONED"] as const)(
    "honours a terminal %s recovery through the shared retention rule and resolves without resubmission",
    async (state) => {
      const run = adapterHarness({ submitted: ["SUBMITTED_REPORT_REJECTED"], recovery: [recovered(state)] });
      await run.adapter(ACCEPTANCE);
      expect(run.journal.removed).toHaveLength(1);
      expect(run.journal.removed[0]).toBe(run.journal.published[0]);
      expect(run.client.kinds()).toEqual(["submitted", "recovery"]);
      expect(run.latch.isTripped()).toBe(false);
    },
  );

  it("fails closed when recovery exhausts: record kept, latch tripped", async () => {
    const steps = Array.from({ length: ACCEPTANCE_RECOVERY_RETRY_MAX_ATTEMPTS }, () => STILL_SUBMITTING);
    const run = adapterHarness({ submitted: ["SUBMITTED_REPORT_REJECTED"], recovery: steps });
    expect(await codeOf(run.adapter(ACCEPTANCE))).toBe("ACCEPTANCE_RECONCILIATION_FAILED");
    expect(run.client.of("recovery")).toHaveLength(ACCEPTANCE_RECOVERY_RETRY_MAX_ATTEMPTS);
    expect(run.journal.removed).toEqual([]);
    expect(run.client.of("failed")).toEqual([]);
    expect(run.latch.isTripped()).toBe(true);
  });

  it("fails closed on a non-retryable recovery refusal", async () => {
    const run = adapterHarness({ submitted: ["SUBMITTED_REPORT_REJECTED"], recovery: ["ACCEPTANCE_RECONCILIATION_FAILED"] });
    expect(await codeOf(run.adapter(ACCEPTANCE))).toBe("ACCEPTANCE_RECONCILIATION_FAILED");
    expect(run.client.of("recovery")).toHaveLength(1);
    expect(run.journal.removed).toEqual([]);
    expect(run.latch.isTripped()).toBe(true);
  });

  it("feeds the one published record to both the live report and recovery, never a rebuilt one", async () => {
    const run = adapterHarness({ submitted: ["SUBMITTED_REPORT_REJECTED"], recovery: [recovered("SUCCEEDED")] });
    await run.adapter(ACCEPTANCE);
    const record = run.journal.published[0]!;
    expect(run.journal.published).toHaveLength(1);
    expect(run.client.of("submitted")[0]).toMatchObject({ attemptId: record.executionAttemptId, providerExecutionId: record.providerExecutionId });
    expect(run.client.of("submitted")[0]!.proof.fencingCounter).toBe(record.fencingCounter);
    expect(run.client.of("recovery")[0]).toMatchObject({
      attemptId: record.executionAttemptId,
      fencingCounter: record.fencingCounter,
      providerExecutionId: record.providerExecutionId,
    });
    expect(run.journal.removed[0]).toBe(record);
  });
});

describe("failure before durable acceptance", () => {
  it.each([
    ["an invalid acceptance", "ok", { provider: PROVIDER, providerExecutionId: ` ${EXECUTION}` }, "PROVIDER_EXECUTION_ID_INVALID", "PROVIDER_ACCEPTANCE_INVALID"],
    ["a provider mismatch", "ok", { provider: "OTHER_PROVIDER", providerExecutionId: EXECUTION }, "PROVIDER_EXECUTION_ID_INVALID", "PROVIDER_ACCEPTANCE_INVALID"],
    ["a journal write failure", "write-failed", ACCEPTANCE, "ACCEPTANCE_JOURNAL_WRITE_FAILED", "ACCEPTANCE_JOURNAL_WRITE_FAILED"],
    ["a journal conflict", "conflict", ACCEPTANCE, "ACCEPTANCE_JOURNAL_WRITE_FAILED", "ACCEPTANCE_JOURNAL_CONFLICT"],
  ] as const)("reports %s once as OUTCOME_UNKNOWN, never SUBMITTED, and fails closed", async (_label, mode, acceptance, failureCode, localCode) => {
    const run = adapterHarness({ failed: [{ ...FAILED_ACK, failureCode }] }, mode);
    expect(await codeOf(run.adapter(acceptance))).toBe(localCode);
    expect(run.client.kinds()).toEqual(["failed"]);
    const [call] = run.client.of("failed");
    expect(call).toMatchObject({ attemptId: ATTEMPT, proof: { fencingCounter: 3, leaseToken: TOKEN }, report: { outcome: "OUTCOME_UNKNOWN", failureCode } });
    expect(Object.keys(call!.report)).toEqual(["outcome", "failureCode"]);
    expect(call!.signal).toBeInstanceOf(AbortSignal);
    expect(run.time.deadlines.map(({ ms, cancelled }) => ({ ms, cancelled }))).toEqual([{ ms: 10000, cancelled: true }]);
    expect(run.latch.isTripped()).toBe(true);
  });

  it("retries an unavailable failure report once, immediately, with the same report and proof", async () => {
    const run = adapterHarness({ failed: ["CONTROL_API_UNAVAILABLE", FAILED_ACK] });
    expect(await codeOf(run.adapter({ provider: "OTHER_PROVIDER", providerExecutionId: EXECUTION }))).toBe("PROVIDER_ACCEPTANCE_INVALID");
    const calls = run.client.of("failed");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.report).toBe(calls[1]!.report);
    expect(calls[0]!.proof).toBe(calls[1]!.proof);
    expect(calls[0]!.signal).not.toBe(calls[1]!.signal);
    expect(run.time.deadlines.map(({ ms }) => ms)).toEqual([10000, 10000]);
    expect(run.recoveryTime.backoffs).toEqual([]);
  });

  it("stops after two unavailable failure reports and still fails closed with the local code", async () => {
    const run = adapterHarness({ failed: ["CONTROL_API_UNAVAILABLE", "CONTROL_API_UNAVAILABLE"] }, "write-failed");
    expect(await codeOf(run.adapter(ACCEPTANCE))).toBe("ACCEPTANCE_JOURNAL_WRITE_FAILED");
    expect(run.client.kinds()).toEqual(["failed", "failed"]);
    expect(run.latch.isTripped()).toBe(true);
  });

  it("aborts a hanging failure report at its deadline and makes the one retry", async () => {
    const run = adapterHarness({ failed: ["HANG", FAILED_ACK] }, "write-failed");
    const pending = run.adapter(ACCEPTANCE);
    await flush();
    run.time.deadlines[0]!.fire();
    expect(await codeOf(pending)).toBe("ACCEPTANCE_JOURNAL_WRITE_FAILED");
    expect(run.client.of("failed").map(({ signal }) => signal!.aborted)).toEqual([true, false]);
  });

  it.each(["SUBMISSION_FAILED_REJECTED", "WORKER_AUTHENTICATION_REJECTED", "MALFORMED_CONTROL_RESPONSE"] as const)(
    "never retries a failure report refused with %s",
    async (code) => {
      const run = adapterHarness({ failed: [code] }, "write-failed");
      expect(await codeOf(run.adapter(ACCEPTANCE))).toBe("ACCEPTANCE_JOURNAL_WRITE_FAILED");
      expect(run.client.kinds()).toEqual(["failed"]);
      expect(run.latch.isTripped()).toBe(true);
    },
  );
});

describe("repeated provider acceptance", () => {
  it("refuses a later invocation with no report of any kind and leaves the first lifecycle untouched", async () => {
    const run = adapterHarness({ submitted: [SUBMITTED_ACK] });
    await run.adapter(ACCEPTANCE);
    expect(await codeOf(run.adapter({ provider: PROVIDER, providerExecutionId: "op-second" }))).toBe("PROVIDER_ACCEPTANCE_INVALID");
    expect(run.client.kinds()).toEqual(["submitted"]);
    expect(run.journal.published).toHaveLength(1);
    expect(run.journal.removed).toEqual([]);
    expect(run.latch.isTripped()).toBe(true);
  });

  it("refuses a concurrent invocation while the first is still publishing; the first completes with one report", async () => {
    const gate = deferred<void>();
    const run = adapterHarness({ submitted: [SUBMITTED_ACK] }, gate);
    const first = run.adapter(ACCEPTANCE);
    const second = run.adapter(ACCEPTANCE);
    expect(await codeOf(second)).toBe("PROVIDER_ACCEPTANCE_INVALID");
    expect(run.client.calls).toEqual([]);
    gate.resolve();
    await first;
    expect(run.client.kinds()).toEqual(["submitted"]);
    expect(run.journal.published).toHaveLength(1);
  });
});

describe("provider-polling barrier", () => {
  it("stays pending through publication, the live report and recovery, resolving only on an authoritative result", async () => {
    const publication = deferred<void>();
    const live = deferred<WorkerSubmittedAcknowledgement>();
    const recovery = deferred<WorkerAcceptanceRecoveryResult>();
    const run = adapterHarness({ submitted: [live], recovery: [recovery] }, publication);
    const pending = run.adapter(ACCEPTANCE);
    const settled = track(pending);

    await flush();
    expect(settled()).toBe(false);
    expect(run.client.calls).toEqual([]);

    publication.resolve();
    await flush();
    // Durable, but the live report is still pending: not resolved.
    expect(run.client.kinds()).toEqual(["submitted"]);
    expect(settled()).toBe(false);

    live.reject(new WorkerError("SUBMITTED_REPORT_REJECTED"));
    await flush();
    expect(run.client.kinds()).toEqual(["submitted", "recovery"]);
    expect(settled()).toBe(false);

    recovery.resolve(recovered("SUBMITTED"));
    await pending;
    expect(run.latch.isTripped()).toBe(false);
  });

  it("resolves only once the live acknowledgement arrives", async () => {
    const live = deferred<WorkerSubmittedAcknowledgement>();
    const run = adapterHarness({ submitted: [live] });
    const pending = run.adapter(ACCEPTANCE);
    const settled = track(pending);
    await flush();
    expect(run.journal.published).toHaveLength(1);
    expect(settled()).toBe(false);
    live.resolve(SUBMITTED_ACK);
    await pending;
  });
});

describe("with the real acceptance journal", () => {
  let stateRoot: string;
  const POLICY = process.platform === "win32" ? "DEVELOPMENT_BEST_EFFORT" : "REQUIRED";

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "bb-acceptance-handler-"));
  });
  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  const realHarness = async (script: ClientScript, root: string = stateRoot) => {
    const journal = createAcceptanceJournal({ stateRoot: root, directorySync: POLICY, clock });
    await journal.prepare();
    const client = fakeClient(script);
    const recoveryTime = fakeRecoveryTime();
    const latch = createHostFaultLatch();
    const adapter = createAcceptanceAdapter(CONTEXT, PROOF, {
      journal,
      client: client.client,
      latch,
      clock,
      deadlineTimer: fakeTimer().timer,
      monotonicNow: recoveryTime.monotonicNow,
      sleep: recoveryTime.sleep,
    });
    return { journal, client, latch, adapter };
  };

  it("keeps the durable record byte-identical after a SUBMITTED acknowledgement", async () => {
    const run = await realHarness({ submitted: [SUBMITTED_ACK] });
    await run.adapter(ACCEPTANCE);
    const read = await run.journal.read(ATTEMPT);
    expect(read).toEqual({ status: "VALID_RECORD", record: EXPECTED_RECORD });
    const bytes = await readFile(join(stateRoot, "acceptance-journal", "v1", `${ATTEMPT}.json`), "utf8");
    expect(bytes).toBe(serializeAcceptanceRecord(EXPECTED_RECORD));
    expect(bytes.includes(TOKEN)).toBe(false);
    expect(run.latch.isTripped()).toBe(false);
  });

  it("keeps the record after a SUBMITTED recovery and removes it only after a terminal one", async () => {
    const submitted = await realHarness({ submitted: ["SUBMITTED_REPORT_REJECTED"], recovery: [recovered("SUBMITTED")] });
    await submitted.adapter(ACCEPTANCE);
    expect((await submitted.journal.read(ATTEMPT)).status).toBe("VALID_RECORD");

    const otherRoot = await mkdtemp(join(tmpdir(), "bb-acceptance-handler-"));
    try {
      const terminal = await realHarness({ submitted: ["SUBMITTED_REPORT_REJECTED"], recovery: [recovered("SUCCEEDED")] }, otherRoot);
      await terminal.adapter(ACCEPTANCE);
      expect((await terminal.journal.read(ATTEMPT)).status).toBe("NOT_FOUND");
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("leaves no durable record when publication is refused for an invalid acceptance", async () => {
    const run = await realHarness({ failed: [FAILED_ACK] });
    expect(await codeOf(run.adapter({ provider: PROVIDER, providerExecutionId: `${EXECUTION} ` }))).toBe("PROVIDER_ACCEPTANCE_INVALID");
    expect((await run.journal.read(ATTEMPT)).status).toBe("NOT_FOUND");
    expect(await run.journal.enumerate()).toEqual([]);
  });
});
