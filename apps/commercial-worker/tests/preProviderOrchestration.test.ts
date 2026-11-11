import { describe, expect, it } from "vitest";

import { AcceptanceJournalError } from "../src/acceptanceJournal.js";
import {
  obtainPreProviderPermit,
  PRE_PROVIDER_MAX_ATTEMPTS,
  PRE_PROVIDER_REQUEST_DEADLINE_MS,
  realDeadlineTimer,
  type DeadlineTimer,
  type PreProviderOrchestrationDependencies,
} from "../src/preProviderOrchestration.js";
import {
  createHttpWorkerControlClient,
  type LeaseProof,
  type WorkerHeartbeatAcknowledgement,
  type WorkerSubmittingAcknowledgement,
} from "../src/workerControlClient.js";
import { WorkerError, type WorkerErrorCode } from "../src/workerError.js";

// R44B6V: the pre-provider orchestration (architecture section 15, R44B6V0
// and R44B6W0), ending at the permit. Fake journal and client dependencies and
// an injected deadline timer: no network, no control plane, no provider, no
// real waiting.

const ATTEMPT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "T".repeat(43);
const PROOF: LeaseProof = Object.freeze({ fencingCounter: 7, leaseToken: TOKEN });
const ACK: WorkerSubmittingAcknowledgement = Object.freeze({
  executionAttemptId: ATTEMPT,
  fencingCounter: 7,
  state: "SUBMITTING",
  submittingAt: new Date("2026-11-11T10:00:00.000Z"),
});
const RENEWAL: WorkerHeartbeatAcknowledgement = Object.freeze({ fencingCounter: 7, leaseExpiresAt: new Date("2026-11-11T10:02:00.000Z") });

type Step<T> = T | WorkerErrorCode | "HANG";
type Call = { kind: "prepare" | "submitting" | "heartbeat"; attemptId?: string; proof?: LeaseProof; signal?: AbortSignal };

// A controllable deadline timer: each started deadline can be fired or is
// cancelled when its request settles.
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

// A scripted journal and client. "HANG" models a request that only ends when
// its signal aborts, which the real client reports as CONTROL_API_UNAVAILABLE.
function harness(script: Readonly<{ prepare?: "fail"; submitting?: readonly Step<WorkerSubmittingAcknowledgement>[]; heartbeat?: readonly Step<WorkerHeartbeatAcknowledgement>[] }>) {
  const calls: Call[] = [];
  const time = fakeTimer();
  const answer = <T>(steps: readonly Step<T>[] | undefined, index: number, signal: AbortSignal): Promise<T> => {
    const step = steps?.[index];
    if (step === undefined) throw new Error("unexpected request");
    if (step === "HANG") {
      return new Promise<T>((_resolve, reject) => signal.addEventListener("abort", () => reject(new WorkerError("CONTROL_API_UNAVAILABLE"))));
    }
    if (typeof step === "string") return Promise.reject(new WorkerError(step as WorkerErrorCode));
    return Promise.resolve(step);
  };
  let submitted = 0;
  let renewed = 0;
  const dependencies: PreProviderOrchestrationDependencies = {
    journal: {
      prepare: async () => {
        calls.push({ kind: "prepare" });
        if (script.prepare === "fail") throw new AcceptanceJournalError("STATE_ROOT_UNSUITABLE");
        return Object.freeze({ directorySyncSupported: true });
      },
    },
    client: {
      acknowledgeSubmitting: (attemptId, proof, signal) => {
        calls.push({ kind: "submitting", attemptId, proof, signal: signal! });
        return answer(script.submitting, submitted++, signal!);
      },
      heartbeat: (attemptId, proof, signal) => {
        calls.push({ kind: "heartbeat", attemptId, proof, signal: signal! });
        return answer(script.heartbeat, renewed++, signal!);
      },
    },
    deadlineTimer: time.timer,
  };
  const kinds = () => calls.map((call) => call.kind);
  const count = (kind: Call["kind"]) => calls.filter((call) => call.kind === kind).length;
  return { dependencies, calls, kinds, count, time };
}

const codeOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(WorkerError);
  expect(`${(error as Error).message} ${JSON.stringify(error)} ${String((error as Error).stack)}`.includes(TOKEN)).toBe(false);
  return (error as WorkerError).code;
};

describe("pre-provider orchestration constants", () => {
  it("names exactly the locked values", () => {
    expect({ maxAttempts: PRE_PROVIDER_MAX_ATTEMPTS, deadlineMs: PRE_PROVIDER_REQUEST_DEADLINE_MS }).toEqual({ maxAttempts: 2, deadlineMs: 10000 });
  });
});

describe("successful path", () => {
  it("prepares the journal, acknowledges SUBMITTING, heartbeats, then returns a secret-free permit", async () => {
    const run = harness({ submitting: [ACK], heartbeat: [RENEWAL] });
    const permit = await obtainPreProviderPermit(run.dependencies, ATTEMPT, PROOF);
    expect(run.kinds()).toEqual(["prepare", "submitting", "heartbeat"]);
    expect(permit).toEqual({ executionAttemptId: ATTEMPT, fencingCounter: 7 });
    expect(Object.isFrozen(permit)).toBe(true);
    expect(JSON.stringify(permit).includes(TOKEN)).toBe(false);
    expect(Object.keys(permit)).toEqual(["executionAttemptId", "fencingCounter"]);
  });

  it("uses one unchanged proof on every request, never the caller's object or the renewal", async () => {
    const caller = { fencingCounter: 7, leaseToken: TOKEN, leaseExpiresAt: new Date(0) } as unknown as LeaseProof;
    const run = harness({ submitting: ["CONTROL_API_UNAVAILABLE", ACK], heartbeat: ["CONTROL_API_UNAVAILABLE", RENEWAL] });
    await obtainPreProviderPermit(run.dependencies, ATTEMPT, caller);
    const requests = run.calls.filter((call) => call.kind !== "prepare");
    expect(requests).toHaveLength(4);
    for (const call of requests) {
      expect(call.attemptId).toBe(ATTEMPT);
      expect(call.proof).toEqual({ fencingCounter: 7, leaseToken: TOKEN });
      expect(call.proof).not.toBe(caller);
    }
    // Every request saw the very same frozen proof object.
    expect(new Set(requests.map((call) => call.proof)).size).toBe(1);
    expect(Object.isFrozen(requests[0]!.proof)).toBe(true);
    expect(caller).toEqual({ fencingCounter: 7, leaseToken: TOKEN, leaseExpiresAt: new Date(0) });
  });
});

describe("journal preparation", () => {
  it("fails closed before any request when the per-attempt prepare fails", async () => {
    const run = harness({ prepare: "fail", submitting: [ACK], heartbeat: [RENEWAL] });
    expect(await codeOf(obtainPreProviderPermit(run.dependencies, ATTEMPT, PROOF))).toBe("STATE_ROOT_UNSUITABLE");
    expect(run.kinds()).toEqual(["prepare"]);
    expect(run.time.deadlines).toEqual([]);
  });

  it("prepares exactly once per orchestration, before the first acknowledgement", async () => {
    const run = harness({ submitting: ["CONTROL_API_UNAVAILABLE", ACK], heartbeat: [RENEWAL] });
    await obtainPreProviderPermit(run.dependencies, ATTEMPT, PROOF);
    expect(run.count("prepare")).toBe(1);
    expect(run.kinds()[0]).toBe("prepare");
  });
});

describe("SUBMITTING acknowledgement attempts", () => {
  it("retries CONTROL_API_UNAVAILABLE once, immediately, then continues", async () => {
    const run = harness({ submitting: ["CONTROL_API_UNAVAILABLE", ACK], heartbeat: [RENEWAL] });
    expect(await obtainPreProviderPermit(run.dependencies, ATTEMPT, PROOF)).toEqual({ executionAttemptId: ATTEMPT, fencingCounter: 7 });
    expect(run.kinds()).toEqual(["prepare", "submitting", "submitting", "heartbeat"]);
  });

  it("stops after two unavailable attempts with no heartbeat and no permit", async () => {
    const run = harness({ submitting: ["CONTROL_API_UNAVAILABLE", "CONTROL_API_UNAVAILABLE"], heartbeat: [RENEWAL] });
    expect(await codeOf(obtainPreProviderPermit(run.dependencies, ATTEMPT, PROOF))).toBe("CONTROL_API_UNAVAILABLE");
    expect(run.count("submitting")).toBe(2);
    expect(run.count("heartbeat")).toBe(0);
  });

  it.each(["SUBMITTING_REJECTED", "WORKER_AUTHENTICATION_REJECTED", "MALFORMED_CONTROL_RESPONSE"] as const)(
    "never retries %s and never heartbeats",
    async (code) => {
      const run = harness({ submitting: [code, ACK], heartbeat: [RENEWAL] });
      expect(await codeOf(obtainPreProviderPermit(run.dependencies, ATTEMPT, PROOF))).toBe(code);
      expect(run.count("submitting")).toBe(1);
      expect(run.count("heartbeat")).toBe(0);
    },
  );

  it.each(["SUBMITTING_REJECTED", "WORKER_AUTHENTICATION_REJECTED", "MALFORMED_CONTROL_RESPONSE"] as const)(
    "ends after an unavailable attempt followed by %s, with no heartbeat",
    async (code) => {
      const run = harness({ submitting: ["CONTROL_API_UNAVAILABLE", code], heartbeat: [RENEWAL] });
      expect(await codeOf(obtainPreProviderPermit(run.dependencies, ATTEMPT, PROOF))).toBe(code);
      expect(run.count("submitting")).toBe(2);
      expect(run.count("heartbeat")).toBe(0);
    },
  );
});

describe("mandatory heartbeat attempts", () => {
  it("retries CONTROL_API_UNAVAILABLE once, immediately, then returns the permit", async () => {
    const run = harness({ submitting: [ACK], heartbeat: ["CONTROL_API_UNAVAILABLE", RENEWAL] });
    expect(await obtainPreProviderPermit(run.dependencies, ATTEMPT, PROOF)).toEqual({ executionAttemptId: ATTEMPT, fencingCounter: 7 });
    expect(run.kinds()).toEqual(["prepare", "submitting", "heartbeat", "heartbeat"]);
  });

  it("stops after two unavailable heartbeats with no permit, leaving SUBMITTING untouched", async () => {
    const run = harness({ submitting: [ACK], heartbeat: ["CONTROL_API_UNAVAILABLE", "CONTROL_API_UNAVAILABLE"] });
    expect(await codeOf(obtainPreProviderPermit(run.dependencies, ATTEMPT, PROOF))).toBe("CONTROL_API_UNAVAILABLE");
    // Only the two control-plane methods exist: nothing else (no submission-failed,
    // no other lifecycle report, no provider) could have been called.
    expect(run.kinds()).toEqual(["prepare", "submitting", "heartbeat", "heartbeat"]);
  });

  it.each(["HEARTBEAT_REJECTED", "WORKER_AUTHENTICATION_REJECTED", "MALFORMED_CONTROL_RESPONSE"] as const)(
    "never retries %s after a committed SUBMITTING and returns no permit",
    async (code) => {
      const run = harness({ submitting: [ACK], heartbeat: [code, RENEWAL] });
      expect(await codeOf(obtainPreProviderPermit(run.dependencies, ATTEMPT, PROOF))).toBe(code);
      expect(run.kinds()).toEqual(["prepare", "submitting", "heartbeat"]);
    },
  );
});

describe("request deadlines", () => {
  it("gives every request its own fresh 10000 ms deadline and cancels it when the request settles", async () => {
    const run = harness({ submitting: ["CONTROL_API_UNAVAILABLE", ACK], heartbeat: ["CONTROL_API_UNAVAILABLE", RENEWAL] });
    await obtainPreProviderPermit(run.dependencies, ATTEMPT, PROOF);
    expect(run.time.deadlines.map((deadline) => deadline.ms)).toEqual([10000, 10000, 10000, 10000]);
    expect(run.time.deadlines.every((deadline) => deadline.cancelled)).toBe(true);
    const signals = run.calls.filter((call) => call.kind !== "prepare").map((call) => call.signal);
    expect(new Set(signals).size).toBe(4);
    expect(signals.every((signal) => signal instanceof AbortSignal && !signal.aborted)).toBe(true);
  });

  it("aborts a hanging SUBMITTING request at its deadline, retries once with a fresh signal, then stops", async () => {
    const run = harness({ submitting: ["HANG", "HANG"], heartbeat: [RENEWAL] });
    const pending = obtainPreProviderPermit(run.dependencies, ATTEMPT, PROOF);
    await vi_waitFor(() => run.time.deadlines.length === 1);
    run.time.deadlines[0]!.fire();
    await vi_waitFor(() => run.time.deadlines.length === 2);
    const [first, second] = run.calls.filter((call) => call.kind === "submitting").map((call) => call.signal!);
    expect(first!.aborted).toBe(true);
    expect(second!.aborted).toBe(false);
    expect(second).not.toBe(first);
    run.time.deadlines[1]!.fire();
    expect(await codeOf(pending)).toBe("CONTROL_API_UNAVAILABLE");
    expect(run.count("submitting")).toBe(2);
    expect(run.count("heartbeat")).toBe(0);
    expect(run.time.deadlines).toHaveLength(2);
  });

  it("aborts a hanging heartbeat at its deadline and recovers with one fresh attempt", async () => {
    const run = harness({ submitting: [ACK], heartbeat: ["HANG", RENEWAL] });
    const pending = obtainPreProviderPermit(run.dependencies, ATTEMPT, PROOF);
    await vi_waitFor(() => run.time.deadlines.length === 2);
    run.time.deadlines[1]!.fire();
    expect(await pending).toEqual({ executionAttemptId: ATTEMPT, fencingCounter: 7 });
    const heartbeats = run.calls.filter((call) => call.kind === "heartbeat").map((call) => call.signal!);
    expect(heartbeats[0]!.aborted).toBe(true);
    expect(heartbeats[1]!.aborted).toBe(false);
    // A settled request's deadline can no longer abort anything.
    expect(run.time.deadlines.map((deadline) => deadline.cancelled)).toEqual([true, true, true]);
  });

  it("drives the real HTTP client: a deadline abort is CONTROL_API_UNAVAILABLE and earns the one retry", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      urls.push(String(url));
      if (urls.length === 1) {
        return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      }
      const body = String(url).endsWith("/submitting")
        ? { executionAttemptId: ATTEMPT, fencingCounter: 7, state: "SUBMITTING", submittingAt: "2026-11-11T10:00:00.000Z" }
        : { fencingCounter: 7, leaseExpiresAt: "2026-11-11T10:02:00.000Z" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const client = createHttpWorkerControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: "fixture-machine-credential", fetchImpl });
    const time = fakeTimer();
    const journal = { prepare: async () => Object.freeze({ directorySyncSupported: true }) };
    const pending = obtainPreProviderPermit({ journal, client, deadlineTimer: time.timer }, ATTEMPT, PROOF);
    await vi_waitFor(() => time.deadlines.length === 1);
    time.deadlines[0]!.fire();
    expect(await pending).toEqual({ executionAttemptId: ATTEMPT, fencingCounter: 7 });
    expect(urls.map((url) => url.slice(url.lastIndexOf("/") + 1))).toEqual(["submitting", "submitting", "heartbeat"]);
  });

  it("cancels the real timer when a request settles, so it never fires later", async () => {
    let fired = false;
    const cancel = realDeadlineTimer(5, () => {
      fired = true;
    });
    cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fired).toBe(false);
  });
});

// Polls a condition across microtask and macrotask turns (no fixed waits).
async function vi_waitFor(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("condition not reached");
}
