import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_RECOVERY_RETRY_INITIAL_BACKOFF_MS,
  ACCEPTANCE_RECOVERY_RETRY_MAX_ATTEMPTS,
  ACCEPTANCE_RECOVERY_RETRY_MAX_BACKOFF_MS,
  ACCEPTANCE_RECOVERY_RETRY_MAX_ELAPSED_MS,
  ACCEPTANCE_RECOVERY_RETRY_MULTIPLIER,
  classifyRecoveryAttempt,
  defaultRecoverySleep,
  runAcceptanceRecoveryWithRetry,
  type AcceptanceRecoveryResponse,
} from "../src/acceptanceRecoveryPolicy.js";
import { WorkerError, type WorkerErrorCode } from "../src/workerError.js";
import { fakeRecoveryTime } from "./support/fakeRecoveryTime.js";

// Section 17 "Startup acceptance-recovery retry policy" (R44B6S0), driven
// entirely by injected time: no test waits in real time.

const ACK = Object.freeze({ state: "SUBMITTED" });
const STILL: AcceptanceRecoveryResponse<typeof ACK> = Object.freeze({ status: "ATTEMPT_STILL_SUBMITTING" });
const ACKNOWLEDGED: AcceptanceRecoveryResponse<typeof ACK> = Object.freeze({ status: "ACKNOWLEDGED", acknowledgement: ACK });

type Step = AcceptanceRecoveryResponse<typeof ACK> | WorkerErrorCode | Error;

// A request that records its start time, optionally takes time, then answers.
function scripted(time: ReturnType<typeof fakeRecoveryTime>, answer: (attempt: number) => Step, durationMs = 0) {
  const starts: number[] = [];
  const signals: AbortSignal[] = [];
  const request = async (signal: AbortSignal) => {
    starts.push(time.now());
    signals.push(signal);
    time.advance(durationMs);
    const step = answer(starts.length);
    if (step instanceof Error) throw step;
    if (typeof step === "string") throw new WorkerError(step);
    return step;
  };
  return { request, starts, signals };
}

const codeOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(WorkerError);
  return (error as WorkerError).code;
};

describe("acceptance-recovery retry policy constants", () => {
  it("names exactly the locked values", () => {
    expect({
      maxAttempts: ACCEPTANCE_RECOVERY_RETRY_MAX_ATTEMPTS,
      maxElapsedMs: ACCEPTANCE_RECOVERY_RETRY_MAX_ELAPSED_MS,
      initialBackoffMs: ACCEPTANCE_RECOVERY_RETRY_INITIAL_BACKOFF_MS,
      multiplier: ACCEPTANCE_RECOVERY_RETRY_MULTIPLIER,
      maxBackoffMs: ACCEPTANCE_RECOVERY_RETRY_MAX_BACKOFF_MS,
    }).toEqual({ maxAttempts: 18, maxElapsedMs: 150000, initialBackoffMs: 1000, multiplier: 2, maxBackoffMs: 10000 });
  });
});

describe("acceptance-recovery retry schedule", () => {
  it("starts attempt 1 at 0 ms and stops at once on acknowledgement, with no sleep", async () => {
    const time = fakeRecoveryTime();
    const run = scripted(time, () => ACKNOWLEDGED);
    expect(await runAcceptanceRecoveryWithRetry(run.request, time)).toBe(ACK);
    expect(run.starts).toEqual([0]);
    expect(time.backoffs).toEqual([]);
  });

  it("follows the exact zero-duration start schedule, never starts attempt 19, and exhausts as unresolved", async () => {
    const time = fakeRecoveryTime();
    const run = scripted(time, () => STILL);
    expect(await codeOf(runAcceptanceRecoveryWithRetry(run.request, time))).toBe("ACCEPTANCE_RECONCILIATION_FAILED");
    expect(run.starts.map((ms) => ms / 1000)).toEqual([0, 1, 3, 7, 15, 25, 35, 45, 55, 65, 75, 85, 95, 105, 115, 125, 135, 145]);
    expect(run.starts).toHaveLength(18);
    // Initial 1 s, doubling, capped at 10 s, no jitter; no sleep after the last attempt.
    expect(time.backoffs).toEqual([1000, 2000, 4000, 8000, ...Array(13).fill(10000)]);
    expect(Math.max(...time.backoffs)).toBe(10000);
  });

  it("is deterministic: two runs produce identical schedules (no jitter)", async () => {
    const schedules = [];
    for (let run = 0; run < 2; run += 1) {
      const time = fakeRecoveryTime();
      const script = scripted(time, () => "CONTROL_API_UNAVAILABLE");
      await codeOf(runAcceptanceRecoveryWithRetry(script.request, time));
      schedules.push({ starts: script.starts, backoffs: time.backoffs });
    }
    expect(schedules[0]).toEqual(schedules[1]);
  });

  it("retries CONTROL_API_UNAVAILABLE (transport or 5xx) and then succeeds", async () => {
    const time = fakeRecoveryTime();
    const run = scripted(time, (attempt) => (attempt < 3 ? "CONTROL_API_UNAVAILABLE" : ACKNOWLEDGED));
    expect(await runAcceptanceRecoveryWithRetry(run.request, time)).toBe(ACK);
    expect(run.starts).toEqual([0, 1000, 3000]);
    expect(time.backoffs).toEqual([1000, 2000]);
  });

  it("retries ATTEMPT_STILL_SUBMITTING and never treats it as acknowledgement", async () => {
    const time = fakeRecoveryTime();
    const run = scripted(time, (attempt) => (attempt < 5 ? STILL : ACKNOWLEDGED));
    expect(await runAcceptanceRecoveryWithRetry(run.request, time)).toBe(ACK);
    expect(run.starts).toHaveLength(5);
  });

  it("exhausts transient unavailability as ACCEPTANCE_RECONCILIATION_FAILED", async () => {
    const time = fakeRecoveryTime();
    const run = scripted(time, () => "CONTROL_API_UNAVAILABLE");
    expect(await codeOf(runAcceptanceRecoveryWithRetry(run.request, time))).toBe("ACCEPTANCE_RECONCILIATION_FAILED");
    expect(run.starts).toHaveLength(18);
  });

  it.each(["WORKER_AUTHENTICATION_REJECTED", "ACCEPTANCE_RECONCILIATION_FAILED", "MALFORMED_CONTROL_RESPONSE"] as const)(
    "stops immediately on %s with no sleep",
    async (code) => {
      const time = fakeRecoveryTime();
      const run = scripted(time, (attempt) => (attempt === 1 ? STILL : code));
      expect(await codeOf(runAcceptanceRecoveryWithRetry(run.request, time))).toBe(code);
      expect(run.starts).toEqual([0, 1000]);
      expect(time.backoffs).toEqual([1000]);
    },
  );

  it("fails closed on an unknown error without retrying", async () => {
    const time = fakeRecoveryTime();
    const run = scripted(time, () => new Error("unexpected"));
    expect(await codeOf(runAcceptanceRecoveryWithRetry(run.request, time))).toBe("ACCEPTANCE_RECONCILIATION_FAILED");
    expect(run.starts).toEqual([0]);
    expect(time.backoffs).toEqual([]);
  });
});

describe("acceptance-recovery elapsed budget", () => {
  it("counts request duration, not only sleeps", async () => {
    const time = fakeRecoveryTime();
    // Each request takes 20 s: starts 0, 21, 43, 67, 95, 125 s; after the
    // sixth (ending at 145 s) a 10 s backoff would reach 155 s: no sleep.
    const run = scripted(time, () => STILL, 20000);
    expect(await codeOf(runAcceptanceRecoveryWithRetry(run.request, time))).toBe("ACCEPTANCE_RECONCILIATION_FAILED");
    expect(run.starts).toEqual([0, 21000, 43000, 67000, 95000, 125000]);
    expect(time.backoffs).toEqual([1000, 2000, 4000, 8000, 10000]);
    expect(time.now()).toBe(145000);
  });

  it("does not sleep when the next backoff would reach the budget (pre-sleep boundary)", async () => {
    const time = fakeRecoveryTime();
    // Attempt 1 ends at exactly 149000 ms; 149000 + 1000 reaches 150000.
    const run = scripted(time, () => STILL, 149000);
    expect(await codeOf(runAcceptanceRecoveryWithRetry(run.request, time))).toBe("ACCEPTANCE_RECONCILIATION_FAILED");
    expect(run.starts).toEqual([0]);
    expect(time.backoffs).toEqual([]);
  });

  it("starts the next request when the backoff ends just inside the budget", async () => {
    const time = fakeRecoveryTime();
    const run = scripted(time, (attempt) => (attempt === 1 ? STILL : ACKNOWLEDGED));
    const request = async (signal: AbortSignal) => {
      if (run.starts.length === 0) time.advance(148999);
      return run.request(signal);
    };
    expect(await runAcceptanceRecoveryWithRetry(request, time)).toBe(ACK);
    expect(run.starts).toEqual([148999, 149999]);
    // The second request is bounded by the 1 ms left.
    expect(time.deadlines).toEqual([150000, 1]);
  });

  it("starts nothing when the sleep itself overruns the budget (post-sleep boundary)", async () => {
    const time = fakeRecoveryTime();
    const run = scripted(time, () => STILL);
    // A sleep that oversleeps far past its request, as a stalled process might.
    const oversleeping = {
      monotonicNow: time.monotonicNow,
      sleep: async (ms: number, signal?: AbortSignal) => {
        await time.sleep(ms, signal);
        if (signal === undefined) time.advance(150000);
      },
    };
    expect(await codeOf(runAcceptanceRecoveryWithRetry(run.request, oversleeping))).toBe("ACCEPTANCE_RECONCILIATION_FAILED");
    expect(run.starts).toEqual([0]);
    expect(time.backoffs).toEqual([1000]);
  });

  it("bounds each in-flight request by the remaining budget", async () => {
    const time = fakeRecoveryTime();
    const run = scripted(time, (attempt) => (attempt < 3 ? STILL : ACKNOWLEDGED), 500);
    expect(await runAcceptanceRecoveryWithRetry(run.request, time)).toBe(ACK);
    // 150000 at 0; 150000 - 1500 at 1.5 s; 150000 - 4000 at 4 s.
    expect(time.deadlines).toEqual([150000, 148500, 146000]);
    // A request that settled cancelled its deadline; nothing was aborted.
    expect(run.signals.every((signal) => !signal.aborted)).toBe(true);
  });

  it("aborts a request that hangs through the remaining budget and starts no other", async () => {
    const time = fakeRecoveryTime({ deadlines: "fire" });
    const starts: number[] = [];
    let aborted: AbortSignal | undefined;
    let settled = false;
    const hanging = (signal: AbortSignal) => {
      starts.push(time.now());
      aborted = signal;
      // Never settles on its own; models a request with no response.
      return new Promise<AcceptanceRecoveryResponse<typeof ACK>>(() => {}).finally(() => {
        settled = true;
      });
    };
    expect(await codeOf(runAcceptanceRecoveryWithRetry(hanging, time))).toBe("ACCEPTANCE_RECONCILIATION_FAILED");
    expect(starts).toEqual([0]);
    expect(aborted?.aborted).toBe(true);
    expect(settled).toBe(false);
    expect(time.now()).toBe(150000);
    expect(time.backoffs).toEqual([]);
  });

  it("aborts a late hanging request after earlier retries, bounded by what is left", async () => {
    const time = fakeRecoveryTime({ deadlines: "fire" });
    const starts: number[] = [];
    let calls = 0;
    const request = async (signal: AbortSignal): Promise<AcceptanceRecoveryResponse<typeof ACK>> => {
      starts.push(time.now());
      calls += 1;
      if (calls === 1) return STILL;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new WorkerError("CONTROL_API_UNAVAILABLE"))));
    };
    expect(await codeOf(runAcceptanceRecoveryWithRetry(request, time))).toBe("ACCEPTANCE_RECONCILIATION_FAILED");
    expect(starts).toEqual([0, 1000]);
    expect(time.deadlines).toEqual([150000, 149000]);
    expect(time.now()).toBe(150000);
  });
});

describe("attempt classification", () => {
  it("separates acknowledgement, the submitting wait, unavailability and every other failure", () => {
    expect(classifyRecoveryAttempt({ value: ACKNOWLEDGED })).toEqual({ kind: "ACKNOWLEDGED", acknowledgement: ACK });
    expect(classifyRecoveryAttempt({ value: STILL })).toEqual({ kind: "STILL_SUBMITTING" });
    expect(classifyRecoveryAttempt({ error: new WorkerError("CONTROL_API_UNAVAILABLE") })).toEqual({ kind: "RETRYABLE_UNAVAILABLE" });
    for (const code of ["WORKER_AUTHENTICATION_REJECTED", "ACCEPTANCE_RECONCILIATION_FAILED", "MALFORMED_CONTROL_RESPONSE"] as const) {
      const outcome = classifyRecoveryAttempt({ error: new WorkerError(code) });
      expect(outcome.kind).toBe("NON_RETRYABLE_FAILURE");
      expect(outcome.kind === "NON_RETRYABLE_FAILURE" && outcome.error.code).toBe(code);
    }
    const unknown = classifyRecoveryAttempt({ error: new TypeError("boom") });
    expect(unknown.kind === "NON_RETRYABLE_FAILURE" && unknown.error.code).toBe("ACCEPTANCE_RECONCILIATION_FAILED");
  });
});

describe("default recovery sleep", () => {
  it("resolves, never rejects, when its signal aborts", async () => {
    const controller = new AbortController();
    const pending = defaultRecoverySleep(60_000, controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    const already = new AbortController();
    already.abort();
    await expect(defaultRecoverySleep(60_000, already.signal)).resolves.toBeUndefined();
  });
});
