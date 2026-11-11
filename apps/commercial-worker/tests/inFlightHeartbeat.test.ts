import { describe, expect, it } from "vitest";

import type { RecoverySleep } from "../src/acceptanceRecoveryPolicy.js";
import { createHostFaultLatch } from "../src/hostFaultLatch.js";
import {
  IN_FLIGHT_HEARTBEAT_FIRST_TICK_DELAY_MS,
  IN_FLIGHT_HEARTBEAT_MAX_ATTEMPTS_PER_TICK,
  IN_FLIGHT_HEARTBEAT_QUIET_INTERVAL_MS,
  IN_FLIGHT_HEARTBEAT_REQUEST_DEADLINE_MS,
  runWithInFlightHeartbeat,
} from "../src/inFlightHeartbeat.js";
import type { DeadlineTimer } from "../src/preProviderOrchestration.js";
import type { LeaseProof, WorkerHeartbeatAcknowledgement } from "../src/workerControlClient.js";
import { WorkerError, type WorkerErrorCode } from "../src/workerError.js";

// R44B6Z: the generic in-flight lease keeper (architecture section 15,
// "In-flight provider heartbeat", R44B6Z0). A fake heartbeat client, deadline
// timer and abortable sleep, and a test-local operation: no network, no
// control plane, no provider and no real waiting. The operation stands in
// for a future provider-submission phase; nothing here is provider execution.

const ATTEMPT = "11111111-2222-4333-8444-555555555555";
const TOKEN = "T".repeat(43);
const PROOF: LeaseProof = Object.freeze({ fencingCounter: 3, leaseToken: TOKEN });
const RENEWAL: WorkerHeartbeatAcknowledgement = Object.freeze({ fencingCounter: 3, leaseExpiresAt: new Date("2026-11-11T10:02:00.000Z") });

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

// A request step: an acknowledgement, a closed error, "HANG" (ends only when
// its signal aborts, reported as the real client does: CONTROL_API_UNAVAILABLE),
// "THROW" (an unexpected non-worker error) or a deferred the test settles.
type Step = WorkerHeartbeatAcknowledgement | WorkerErrorCode | "HANG" | "THROW" | Deferred<WorkerHeartbeatAcknowledgement>;

function harness(steps: readonly Step[]) {
  const calls: { attemptId: string; proof: LeaseProof; signal: AbortSignal }[] = [];
  const client = {
    heartbeat: (attemptId: string, proof: LeaseProof, signal?: AbortSignal): Promise<WorkerHeartbeatAcknowledgement> => {
      calls.push({ attemptId, proof, signal: signal! });
      const step = steps[calls.length - 1];
      if (step === undefined) return Promise.reject(new Error(`unexpected heartbeat ${calls.length}`));
      if (step === "HANG") {
        return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new WorkerError("CONTROL_API_UNAVAILABLE"))));
      }
      if (step === "THROW") return Promise.reject(new TypeError("unexpected"));
      if (typeof step === "string") return Promise.reject(new WorkerError(step as WorkerErrorCode));
      if ("promise" in step) return step.promise;
      return Promise.resolve(step);
    },
  };

  const deadlines: { ms: number; fire: () => void; cancelled: boolean }[] = [];
  const deadlineTimer: DeadlineTimer = (ms, onExpiry) => {
    const entry = { ms, fire: onExpiry, cancelled: false };
    deadlines.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };

  // Each sleep stays pending until the test elapses it or the keeper aborts it.
  const sleeps: { ms: number; aborted: boolean; done: boolean; end: () => void }[] = [];
  const sleep: RecoverySleep = (ms, signal) =>
    new Promise<void>((resolve) => {
      const entry = {
        ms,
        aborted: false,
        done: false,
        end: () => {
          entry.done = true;
          resolve();
        },
      };
      sleeps.push(entry);
      const onAbort = () => {
        entry.aborted = true;
        entry.end();
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
  const elapse = () => {
    const pending = sleeps.find((entry) => !entry.done);
    if (pending === undefined) throw new Error("no pending sleep");
    pending.end();
  };

  const latch = createHostFaultLatch();
  const operation = deferred<string>();
  let started = 0;
  let operationArguments = -1;
  const run = <T>(work: () => Promise<T>) =>
    runWithInFlightHeartbeat({ executionAttemptId: ATTEMPT, proof: PROOF, client, latch, deadlineTimer, sleep }, work);
  const start = () =>
    run(function (this: unknown, ...args: unknown[]) {
      started += 1;
      operationArguments = args.length;
      return operation.promise;
    });
  return { calls, deadlines, sleeps, elapse, latch, operation, start, run, startedCount: () => started, operationArguments: () => operationArguments };
}

// Lets every queued callback run.
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

describe("in-flight heartbeat constants", () => {
  it("names exactly the locked values", () => {
    expect({
      first: IN_FLIGHT_HEARTBEAT_FIRST_TICK_DELAY_MS,
      quiet: IN_FLIGHT_HEARTBEAT_QUIET_INTERVAL_MS,
      deadline: IN_FLIGHT_HEARTBEAT_REQUEST_DEADLINE_MS,
      attempts: IN_FLIGHT_HEARTBEAT_MAX_ATTEMPTS_PER_TICK,
    }).toEqual({ first: 30000, quiet: 30000, deadline: 10000, attempts: 2 });
  });
});

describe("operation ownership", () => {
  it("starts the operation exactly once, with no argument and so no heartbeat signal", async () => {
    const run = harness([]);
    const pending = run.start();
    expect(run.startedCount()).toBe(1);
    expect(run.operationArguments()).toBe(0);
    run.operation.resolve("accepted");
    expect(await pending).toBe("accepted");
    expect(run.startedCount()).toBe(1);
  });

  it("returns an immediately resolved result with no heartbeat and no lingering wait", async () => {
    const run = harness([]);
    const result = { id: "exact" };
    expect(await run.run(() => Promise.resolve(result))).toBe(result);
    expect(run.calls).toEqual([]);
    expect(run.sleeps.map(({ ms, aborted }) => ({ ms, aborted }))).toEqual([{ ms: 30000, aborted: true }]);
    expect(run.latch.isTripped()).toBe(false);
  });

  it("rethrows an immediate rejection exactly, with no heartbeat", async () => {
    const run = harness([]);
    const error = new Error("provider refused");
    await expect(run.run(() => Promise.reject(error))).rejects.toBe(error);
    expect(run.calls).toEqual([]);
    expect(run.sleeps.every(({ done }) => done)).toBe(true);
    expect(run.latch.isTripped()).toBe(false);
  });

  it("propagates a synchronous throw exactly, starting no keeper at all", async () => {
    const run = harness([]);
    const error = new Error("thrown before a promise");
    await expect(
      run.run(() => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(run.calls).toEqual([]);
    expect(run.sleeps).toEqual([]);
    expect(run.deadlines).toEqual([]);
    expect(run.latch.isTripped()).toBe(false);
  });

  it("waits the 30000 ms quiet interval before any heartbeat", async () => {
    const run = harness([RENEWAL]);
    const pending = run.start();
    await flush();
    expect(run.calls).toEqual([]);
    expect(run.sleeps.map(({ ms }) => ms)).toEqual([30000]);
    run.operation.resolve("done");
    expect(await pending).toBe("done");
    expect(run.calls).toEqual([]);
  });
});

describe("cadence and ticks", () => {
  it("sends one exact heartbeat per successful tick, and sleeps again only after it settles", async () => {
    const reply = deferred<WorkerHeartbeatAcknowledgement>();
    const run = harness([reply]);
    const pending = run.start();
    await flush();
    run.elapse();
    await flush();
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0]).toMatchObject({ attemptId: ATTEMPT, proof: { fencingCounter: 3, leaseToken: TOKEN } });
    expect(run.calls[0]!.proof).not.toBe(PROOF);
    expect(Object.isFrozen(run.calls[0]!.proof)).toBe(true);
    expect(run.deadlines.map(({ ms }) => ms)).toEqual([10000]);
    // Still inside the tick: no next sleep yet.
    expect(run.sleeps).toHaveLength(1);
    reply.resolve(RENEWAL);
    await flush();
    expect(run.sleeps.map(({ ms }) => ms)).toEqual([30000, 30000]);
    expect(run.deadlines[0]!.cancelled).toBe(true);
    run.operation.resolve("result");
    expect(await pending).toBe("result");
    expect(run.sleeps[1]!.aborted).toBe(true);
    expect(run.calls).toHaveLength(1);
    expect(run.latch.isTripped()).toBe(false);
  });

  it("retries CONTROL_API_UNAVAILABLE once, immediately, with the same proof and a fresh controller", async () => {
    const run = harness(["CONTROL_API_UNAVAILABLE", RENEWAL]);
    const pending = run.start();
    await flush();
    run.elapse();
    await flush();
    expect(run.calls).toHaveLength(2);
    expect(run.calls[0]!.proof).toBe(run.calls[1]!.proof);
    expect(run.calls[0]!.signal).not.toBe(run.calls[1]!.signal);
    expect(run.deadlines.map(({ ms, cancelled }) => ({ ms, cancelled }))).toEqual([
      { ms: 10000, cancelled: true },
      { ms: 10000, cancelled: true },
    ]);
    // No sleep between the attempts: the second sleep is the next cadence.
    expect(run.sleeps.map(({ ms }) => ms)).toEqual([30000, 30000]);
    run.operation.resolve("ok");
    expect(await pending).toBe("ok");
    expect(run.latch.isTripped()).toBe(false);
  });

  it("keeps the cadence after repeatedly exhausted ticks and renews when the API returns", async () => {
    const run = harness(["CONTROL_API_UNAVAILABLE", "CONTROL_API_UNAVAILABLE", "CONTROL_API_UNAVAILABLE", "CONTROL_API_UNAVAILABLE", RENEWAL]);
    const pending = run.start();
    for (let tick = 0; tick < 3; tick += 1) {
      await flush();
      run.elapse();
    }
    await flush();
    expect(run.calls).toHaveLength(5);
    expect(run.sleeps.map(({ ms }) => ms)).toEqual([30000, 30000, 30000, 30000]);
    expect(run.latch.isTripped()).toBe(false);
    run.operation.resolve("still owned");
    expect(await pending).toBe("still owned");
  });

  it("never overlaps: a slow request blocks the next tick until it settles", async () => {
    const reply = deferred<WorkerHeartbeatAcknowledgement>();
    const run = harness([reply, RENEWAL]);
    const pending = run.start();
    await flush();
    run.elapse();
    await flush();
    // Well past another nominal interval: nothing new starts.
    expect(() => run.elapse()).toThrow("no pending sleep");
    await flush();
    expect(run.calls).toHaveLength(1);
    expect(run.sleeps).toHaveLength(1);
    reply.resolve(RENEWAL);
    await flush();
    expect(run.sleeps).toHaveLength(2);
    run.elapse();
    await flush();
    expect(run.calls).toHaveLength(2);
    run.operation.resolve("x");
    await pending;
  });

  it("treats a request deadline as unavailability and retries at once", async () => {
    const run = harness(["HANG", RENEWAL]);
    const pending = run.start();
    await flush();
    run.elapse();
    await flush();
    expect(run.calls).toHaveLength(1);
    run.deadlines[0]!.fire();
    await flush();
    expect(run.calls).toHaveLength(2);
    expect(run.calls[0]!.signal.aborted).toBe(true);
    expect(run.calls[1]!.signal.aborted).toBe(false);
    expect(run.latch.isTripped()).toBe(false);
    run.operation.resolve("y");
    expect(await pending).toBe("y");
  });
});

describe("heartbeat outcomes while the operation runs", () => {
  it.each([
    ["resolves", true],
    ["rejects", false],
  ] as const)("stops after HEARTBEAT_REJECTED without tripping the latch; the operation later %s", async (_label, resolves) => {
    const run = harness(["HEARTBEAT_REJECTED"]);
    const pending = run.start();
    const settled = track(pending);
    await flush();
    run.elapse();
    await flush();
    expect(run.calls).toHaveLength(1);
    expect(run.sleeps).toHaveLength(1);
    expect(settled()).toBe(false);
    expect(run.latch.isTripped()).toBe(false);
    const error = new Error("provider failure");
    if (resolves) {
      run.operation.resolve("accepted later");
      expect(await pending).toBe("accepted later");
    } else {
      run.operation.reject(error);
      await expect(pending).rejects.toBe(error);
    }
    expect(run.calls).toHaveLength(1);
    expect(run.latch.isTripped()).toBe(false);
  });

  it.each([
    ["WORKER_AUTHENTICATION_REJECTED", "WORKER_AUTHENTICATION_REJECTED"],
    ["MALFORMED_CONTROL_RESPONSE", "MALFORMED_CONTROL_RESPONSE"],
    ["an unexpected error", "THROW"],
  ] as const)("stops and trips the latch on %s, still awaiting and returning the operation's result", async (_label, step) => {
    const run = harness([step]);
    const pending = run.start();
    const settled = track(pending);
    await flush();
    run.elapse();
    await flush();
    expect(run.calls).toHaveLength(1);
    expect(run.latch.isTripped()).toBe(true);
    expect(run.sleeps).toHaveLength(1);
    expect(settled()).toBe(false);
    run.operation.resolve("accepted after the fault");
    expect(await pending).toBe("accepted after the fault");
    expect(run.calls).toHaveLength(1);
  });

  it("never replaces an operation error with a heartbeat fault", async () => {
    const run = harness(["MALFORMED_CONTROL_RESPONSE"]);
    const pending = run.start();
    await flush();
    run.elapse();
    await flush();
    const error = new Error("the operation's own error");
    run.operation.reject(error);
    await expect(pending).rejects.toBe(error);
    expect(run.latch.isTripped()).toBe(true);
  });
});

describe("keeper-owned stop", () => {
  it.each([
    ["resolves", true],
    ["rejects", false],
  ] as const)("aborts a pending request when the operation %s, without retry or latch", async (_label, resolves) => {
    const run = harness(["HANG", RENEWAL]);
    const pending = run.start();
    await flush();
    run.elapse();
    await flush();
    expect(run.calls).toHaveLength(1);
    const error = new Error("rejected");
    if (resolves) run.operation.resolve("r");
    else run.operation.reject(error);
    if (resolves) expect(await pending).toBe("r");
    else await expect(pending).rejects.toBe(error);
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0]!.signal.aborted).toBe(true);
    expect(run.deadlines[0]!.cancelled).toBe(true);
    expect(run.latch.isTripped()).toBe(false);
  });

  it("does not start the second attempt when the operation settles between attempts", async () => {
    const first = deferred<WorkerHeartbeatAcknowledgement>();
    const run = harness([first, RENEWAL]);
    const pending = run.start();
    await flush();
    run.elapse();
    await flush();
    run.operation.resolve("between");
    await flush();
    first.reject(new WorkerError("CONTROL_API_UNAVAILABLE"));
    expect(await pending).toBe("between");
    expect(run.calls).toHaveLength(1);
    expect(run.latch.isTripped()).toBe(false);
  });

  it("aborts the next quiet sleep when the operation settles after a tick", async () => {
    const run = harness([RENEWAL]);
    const pending = run.start();
    await flush();
    run.elapse();
    await flush();
    expect(run.sleeps).toHaveLength(2);
    run.operation.resolve("after tick");
    expect(await pending).toBe("after tick");
    expect(run.sleeps[1]!.aborted).toBe(true);
    expect(run.calls).toHaveLength(1);
  });

  it("does not trip the latch for a rejection that arrives after the operation settled", async () => {
    const reply = deferred<WorkerHeartbeatAcknowledgement>();
    const run = harness([reply]);
    const pending = run.start();
    await flush();
    run.elapse();
    await flush();
    run.operation.resolve("settled first");
    await flush();
    reply.reject(new WorkerError("HEARTBEAT_REJECTED"));
    expect(await pending).toBe("settled first");
    expect(run.calls).toHaveLength(1);
    expect(run.latch.isTripped()).toBe(false);
  });

  it("still records a genuine authentication fault observed after settlement, but its own abort never fabricates one", async () => {
    const reply = deferred<WorkerHeartbeatAcknowledgement>();
    const genuine = harness([reply]);
    const pending = genuine.start();
    await flush();
    genuine.elapse();
    await flush();
    genuine.operation.resolve("result");
    await flush();
    reply.reject(new WorkerError("WORKER_AUTHENTICATION_REJECTED"));
    expect(await pending).toBe("result");
    expect(genuine.latch.isTripped()).toBe(true);

    const aborted = harness(["HANG"]);
    const second = aborted.start();
    await flush();
    aborted.elapse();
    await flush();
    aborted.operation.resolve("result");
    expect(await second).toBe("result");
    expect(aborted.latch.isTripped()).toBe(false);
  });

  it("distinguishes its own stop from a deadline: the deadline retries, the stop does not", async () => {
    const deadline = harness(["HANG", "HANG"]);
    const first = deadline.start();
    await flush();
    deadline.elapse();
    await flush();
    deadline.deadlines[0]!.fire();
    await flush();
    expect(deadline.calls).toHaveLength(2);
    deadline.operation.resolve("a");
    expect(await first).toBe("a");
    expect(deadline.calls).toHaveLength(2);

    const stop = harness(["HANG", "HANG"]);
    const second = stop.start();
    await flush();
    stop.elapse();
    await flush();
    stop.operation.resolve("b");
    expect(await second).toBe("b");
    expect(stop.calls).toHaveLength(1);
    expect(stop.latch.isTripped()).toBe(false);
  });

  it("leaves no pending timer or request behind", async () => {
    const run = harness(["CONTROL_API_UNAVAILABLE", RENEWAL, "HANG"]);
    const pending = run.start();
    await flush();
    run.elapse();
    await flush();
    run.elapse();
    await flush();
    run.operation.resolve("clean");
    await pending;
    expect(run.deadlines.every(({ cancelled }) => cancelled)).toBe(true);
    expect(run.sleeps.every(({ done }) => done)).toBe(true);
    expect(run.calls.every(({ signal }, index) => index < 2 || signal.aborted)).toBe(true);
  });
});
