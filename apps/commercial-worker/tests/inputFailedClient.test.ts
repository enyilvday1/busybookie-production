import { describe, expect, it } from "vitest";

import {
  INPUT_FAILURE_REPORT_MAX_ATTEMPTS,
  INPUT_FAILURE_REPORT_REQUEST_DEADLINE_MS,
  reportInputFailureWithPolicy,
} from "../src/inputMediaFailurePolicy.js";
import type { DeadlineTimer } from "../src/preProviderOrchestration.js";
import {
  createHttpWorkerControlClient,
  INPUT_FAILURE_CODES,
  parseInputFailedResponse,
  type InputFailureCode,
  type WorkerControlClient,
} from "../src/workerControlClient.js";
import { WorkerError } from "../src/workerError.js";

// R44B10P2: the worker-side client for the input-failed route and its
// two-attempt report policy (architecture section 18, "input-failed route").
// A fake fetch only: no network, no control plane, no provider.

const MACHINE = "fixture-machine-credential";
const ATTEMPT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PROOF = Object.freeze({ fencingCounter: 3, leaseToken: "A".repeat(43) });
const CODE: InputFailureCode = "INPUT_OBJECT_NOT_FOUND";
const OK_BODY = { executionAttemptId: ATTEMPT, fencingCounter: 3, state: "FAILED_BEFORE_SUBMISSION", failureCode: CODE };

type Captured = { url: string; init: RequestInit };

// Answers each request with the next scripted status (the last one repeats).
function clientAnswering(...answers: ReadonlyArray<readonly [number, unknown] | "TRANSPORT">) {
  const captured: Captured[] = [];
  const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    const answer = answers[Math.min(captured.length - 1, answers.length - 1)]!;
    if (answer === "TRANSPORT") throw new TypeError("fetch failed");
    const [status, body] = answer;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { client: createHttpWorkerControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: MACHINE, fetchImpl }), captured };
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(WorkerError);
    const text = `${(error as Error).message} ${JSON.stringify(error)} ${String((error as Error).stack)}`;
    expect(text.includes(PROOF.leaseToken) || text.includes(MACHINE) || text.includes("leak-marker")).toBe(false);
    return (error as WorkerError).code;
  }
  throw new Error("expected a rejection");
};

// Records each deadline; nothing waits in real time.
function manualTimer() {
  const deadlines: { ms: number; cancelled: boolean; fire: () => void }[] = [];
  const timer: DeadlineTimer = (ms, onExpiry) => {
    const entry = { ms, cancelled: false, fire: onExpiry };
    deadlines.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  return { timer, deadlines };
}

describe("input-failed report client", () => {
  it("sends exactly the published request and returns the strictly parsed acknowledgement", async () => {
    const { client, captured } = clientAnswering([200, OK_BODY]);
    const acknowledgement = await client.reportInputFailed(ATTEMPT, PROOF, CODE);
    expect(acknowledgement).toEqual({ executionAttemptId: ATTEMPT, fencingCounter: 3, state: "FAILED_BEFORE_SUBMISSION", failureCode: CODE });
    expect(Object.isFrozen(acknowledgement)).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe(`http://127.0.0.1:9/worker-control/v1/attempts/${ATTEMPT}/input-failed`);
    expect(captured[0]!.init.method).toBe("POST");
    expect(captured[0]!.init.redirect).toBe("error");
    expect(captured[0]!.init.headers).toEqual({ Authorization: `Bearer ${MACHINE}`, "Content-Type": "application/json" });
    const sent = JSON.parse(String(captured[0]!.init.body)) as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual(["fencingCounter", "leaseToken", "failureCode"]);
    expect(sent).toEqual({ fencingCounter: 3, leaseToken: PROOF.leaseToken, failureCode: CODE });
    // No signal unless the caller supplies one: the client owns no timeout.
    expect("signal" in captured[0]!.init).toBe(false);
  });

  it("locks exactly the five provider-neutral codes", () => {
    expect(INPUT_FAILURE_CODES).toEqual([
      "INPUT_REFERENCE_INVALID",
      "INPUT_OBJECT_NOT_FOUND",
      "INPUT_OBJECT_TOO_LARGE",
      "INPUT_OBJECT_INTEGRITY_MISMATCH",
      "INPUT_MEDIA_TYPE_INVALID",
    ]);
    expect(Object.isFrozen(INPUT_FAILURE_CODES)).toBe(true);
  });

  it.each(INPUT_FAILURE_CODES)("sends and accepts %s", async (code) => {
    const { client, captured } = clientAnswering([200, { ...OK_BODY, failureCode: code }]);
    expect((await client.reportInputFailed(ATTEMPT, PROOF, code)).failureCode).toBe(code);
    expect((JSON.parse(String(captured[0]!.init.body)) as Record<string, unknown>).failureCode).toBe(code);
  });

  it("accepts an exact replay acknowledgement identically", async () => {
    const { client } = clientAnswering([200, OK_BODY]);
    const first = await client.reportInputFailed(ATTEMPT, PROOF, CODE);
    const replay = await client.reportInputFailed(ATTEMPT, PROOF, CODE);
    expect(replay).toEqual(first);
  });

  it.each([
    ["a malformed attempt UUID", ATTEMPT.toUpperCase(), PROOF, CODE],
    ["a path-like attempt", "../leases", PROOF, CODE],
    ["fencing counter 0", ATTEMPT, { ...PROOF, fencingCounter: 0 }, CODE],
    ["a short lease token", ATTEMPT, { ...PROOF, leaseToken: "short" }, CODE],
    ["an unknown INPUT_ code", ATTEMPT, PROOF, "INPUT_OBJECT_EXPIRED"],
    ["a provider code", ATTEMPT, PROOF, "PROVIDER_REJECTED_DEFINITIVELY"],
    ["a storage worker code", ATTEMPT, PROOF, "OBJECT_NOT_FOUND"],
    ["a non-string code", ATTEMPT, PROOF, 7],
  ] as const)("never sends %s", async (_label, attemptId, proof, code) => {
    const { client, captured } = clientAnswering([200, OK_BODY]);
    expect(await codeOf(client.reportInputFailed(attemptId, proof, code as unknown as InputFailureCode))).toBe("MALFORMED_CONTROL_RESPONSE");
    expect(captured).toEqual([]);
  });

  it.each([
    ["another attempt", { ...OK_BODY, executionAttemptId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee" }],
    ["another fencing counter", { ...OK_BODY, fencingCounter: 4 }],
    ["another failure code", { ...OK_BODY, failureCode: "INPUT_MEDIA_TYPE_INVALID" }],
    ["another state", { ...OK_BODY, state: "OUTCOME_UNKNOWN" }],
    ["a provider state", { ...OK_BODY, state: "SUBMITTED" }],
    ["an extra member", { ...OK_BODY, jobState: "FAILED" }],
    ["a provider execution ID", { ...OK_BODY, providerExecutionId: "op-1" }],
    ["a missing member", { executionAttemptId: ATTEMPT, fencingCounter: 3, state: "FAILED_BEFORE_SUBMISSION" }],
    ["a string fencing counter", { ...OK_BODY, fencingCounter: "3" }],
    ["a non-object body", [OK_BODY]],
    ["unparsable JSON", "{not json"],
  ] as const)("rejects a response naming %s as malformed", async (_label, body) => {
    const { client } = clientAnswering([200, body]);
    expect(await codeOf(client.reportInputFailed(ATTEMPT, PROOF, CODE))).toBe("MALFORMED_CONTROL_RESPONSE");
  });

  it.each([
    [409, "INPUT_FAILED_REJECTED"],
    [401, "WORKER_AUTHENTICATION_REJECTED"],
    [403, "WORKER_AUTHENTICATION_REJECTED"],
    [500, "CONTROL_API_UNAVAILABLE"],
    [503, "CONTROL_API_UNAVAILABLE"],
    [400, "MALFORMED_CONTROL_RESPONSE"],
    [404, "MALFORMED_CONTROL_RESPONSE"],
  ] as const)("maps HTTP %i to %s, once, without exposing the body", async (status, code) => {
    const { client, captured } = clientAnswering([status, { status: "error", code: "LEASE_REJECTED", leak: "leak-marker" }]);
    expect(await codeOf(client.reportInputFailed(ATTEMPT, PROOF, CODE))).toBe(code);
    expect(captured).toHaveLength(1);
  });

  it("passes an externally supplied signal through, and its abort is a transport failure", async () => {
    let seen: AbortSignal | undefined;
    const fetchImpl = ((_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException(`aborted Bearer ${MACHINE}`, "AbortError")));
      });
    }) as typeof fetch;
    const client = createHttpWorkerControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: MACHINE, fetchImpl });
    const controller = new AbortController();
    const pending = client.reportInputFailed(ATTEMPT, PROOF, CODE, controller.signal);
    controller.abort();
    expect(await codeOf(pending)).toBe("CONTROL_API_UNAVAILABLE");
    expect(seen).toBe(controller.signal);
  });

  it("parses through the exported strict parser identically", () => {
    expect(parseInputFailedResponse(OK_BODY, { executionAttemptId: ATTEMPT, fencingCounter: 3, failureCode: CODE }).failureCode).toBe(CODE);
    expect(() => parseInputFailedResponse({ ...OK_BODY, state: "SUBMITTED" }, { executionAttemptId: ATTEMPT, fencingCounter: 3, failureCode: CODE })).toThrow(WorkerError);
  });
});

describe("input-failed report policy", () => {
  const policy = (client: Pick<WorkerControlClient, "reportInputFailed">) => {
    const time = manualTimer();
    return { time, run: () => reportInputFailureWithPolicy({ client, deadlineTimer: time.timer }, ATTEMPT, PROOF, CODE) };
  };

  it("locks two attempts and a 10000 ms request deadline", () => {
    expect(INPUT_FAILURE_REPORT_MAX_ATTEMPTS).toBe(2);
    expect(INPUT_FAILURE_REPORT_REQUEST_DEADLINE_MS).toBe(10000);
  });

  it("reports once on success, under one fresh 10000 ms deadline", async () => {
    const { client, captured } = clientAnswering([200, OK_BODY]);
    const { time, run } = policy(client);
    expect(await run()).toEqual({ status: "REPORTED", acknowledgement: { executionAttemptId: ATTEMPT, fencingCounter: 3, state: "FAILED_BEFORE_SUBMISSION", failureCode: CODE } });
    expect(captured).toHaveLength(1);
    expect(time.deadlines.map(({ ms, cancelled }) => ({ ms, cancelled }))).toEqual([{ ms: 10000, cancelled: true }]);
    expect(captured[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["a 503", [503, { status: "error" }] as const],
    ["a transport failure", "TRANSPORT" as const],
  ])("retries once after %s, with the same body, a fresh controller and its own deadline", async (_label, unavailable) => {
    const { client, captured } = clientAnswering(unavailable, [200, OK_BODY]);
    const { time, run } = policy(client);
    expect((await run()).status).toBe("REPORTED");
    expect(captured).toHaveLength(2);
    expect(captured[1]!.init.body).toBe(captured[0]!.init.body);
    expect(captured[0]!.init.signal).not.toBe(captured[1]!.init.signal);
    expect(time.deadlines.map(({ ms }) => ms)).toEqual([10000, 10000]);
  });

  it("returns UNREPORTED after exactly two unavailable attempts", async () => {
    const { client, captured } = clientAnswering([503, {}], [503, {}], [200, OK_BODY]);
    const { time, run } = policy(client);
    expect(await run()).toEqual({ status: "UNREPORTED" });
    expect(captured).toHaveLength(2);
    expect(time.deadlines).toHaveLength(2);
  });

  it("treats an expired request deadline as unavailable and retries under a new controller", async () => {
    const signals: AbortSignal[] = [];
    let call = 0;
    const client: Pick<WorkerControlClient, "reportInputFailed"> = {
      reportInputFailed: async (_id, _proof, failureCode, signal) => {
        signals.push(signal!);
        call += 1;
        if (call === 1) {
          await new Promise<void>((resolve) => signal!.addEventListener("abort", () => resolve(), { once: true }));
          throw new WorkerError("CONTROL_API_UNAVAILABLE");
        }
        return Object.freeze({ executionAttemptId: ATTEMPT, fencingCounter: 3, state: "FAILED_BEFORE_SUBMISSION" as const, failureCode });
      },
    };
    const { time, run } = policy(client);
    const pending = run();
    while (time.deadlines.length === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    time.deadlines[0]!.fire();
    expect((await pending).status).toBe("REPORTED");
    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });

  it.each([
    [409, "a refusal"],
    [400, "a validation refusal"],
    [401, "an authentication refusal"],
    [403, "an Origin or authentication refusal"],
  ] as const)("never retries HTTP %i (%s)", async (status, _label) => {
    const { client, captured } = clientAnswering([status, {}], [200, OK_BODY]);
    const { run } = policy(client);
    expect(await run()).toEqual({ status: "UNREPORTED" });
    expect(captured).toHaveLength(1);
  });

  it("never retries a malformed successful acknowledgement", async () => {
    const { client, captured } = clientAnswering([200, { ...OK_BODY, failureCode: "INPUT_MEDIA_TYPE_INVALID" }], [200, OK_BODY]);
    const { run } = policy(client);
    expect(await run()).toEqual({ status: "UNREPORTED" });
    expect(captured).toHaveLength(1);
  });

  it("returns REPORTED for a lost first response followed by the exact replay", async () => {
    // The first request committed but its response was lost (transport failure).
    const { client, captured } = clientAnswering("TRANSPORT", [200, OK_BODY]);
    const { run } = policy(client);
    expect((await run()).status).toBe("REPORTED");
    expect(captured).toHaveLength(2);
  });
});
