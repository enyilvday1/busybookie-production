import { describe, expect, it } from "vitest";

import { createHttpWorkerControlClient, parseSubmissionFailedResponse, type SubmissionFailureReport } from "../src/workerControlClient.js";
import { WorkerError } from "../src/workerError.js";

// R44B6Y: the worker-side client for the existing submission-failed route
// (R44B6T0 contract; client locked by R44B6Y0, architecture section 18). A
// fake fetch only: no network, no control plane, no provider.

const MACHINE = "fixture-machine-credential";
const ATTEMPT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PROOF = Object.freeze({ fencingCounter: 3, leaseToken: "A".repeat(43) });
const UNKNOWN: SubmissionFailureReport = Object.freeze({ outcome: "OUTCOME_UNKNOWN", failureCode: "ACCEPTANCE_JOURNAL_WRITE_FAILED" });
const OK_BODY = { executionAttemptId: ATTEMPT, fencingCounter: 3, state: "OUTCOME_UNKNOWN", failureCode: "ACCEPTANCE_JOURNAL_WRITE_FAILED" };

type Captured = { url: string; init: RequestInit };

function clientAnswering(status: number, body: unknown) {
  const captured: Captured[] = [];
  const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
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
    expect(text.includes(PROOF.leaseToken) || text.includes(MACHINE)).toBe(false);
    return (error as WorkerError).code;
  }
  throw new Error("expected a rejection");
};

describe("submission-failed report client", () => {
  it("sends exactly the published request and returns the strictly parsed acknowledgement", async () => {
    const { client, captured } = clientAnswering(200, OK_BODY);
    const acknowledgement = await client.reportSubmissionFailed(ATTEMPT, PROOF, UNKNOWN);
    expect(acknowledgement).toEqual({ executionAttemptId: ATTEMPT, fencingCounter: 3, state: "OUTCOME_UNKNOWN", failureCode: "ACCEPTANCE_JOURNAL_WRITE_FAILED" });
    expect(Object.isFrozen(acknowledgement)).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe(`http://127.0.0.1:9/worker-control/v1/attempts/${ATTEMPT}/submission-failed`);
    expect(captured[0]!.init.method).toBe("POST");
    expect(captured[0]!.init.redirect).toBe("error");
    expect(captured[0]!.init.headers).toEqual({ Authorization: `Bearer ${MACHINE}`, "Content-Type": "application/json" });
    const sent = JSON.parse(String(captured[0]!.init.body)) as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual(["fencingCounter", "leaseToken", "outcome", "failureCode"]);
    expect(sent).toEqual({ fencingCounter: 3, leaseToken: PROOF.leaseToken, outcome: "OUTCOME_UNKNOWN", failureCode: "ACCEPTANCE_JOURNAL_WRITE_FAILED" });
    // No signal unless the caller supplies one: the client owns no timeout.
    expect("signal" in captured[0]!.init).toBe(false);
  });

  it.each([
    ["DEFINITIVELY_REJECTED", "PROVIDER_REJECTED_DEFINITIVELY", "FAILED_BEFORE_SUBMISSION"],
    ["OUTCOME_UNKNOWN", "PROVIDER_SUBMISSION_AMBIGUOUS", "OUTCOME_UNKNOWN"],
    ["OUTCOME_UNKNOWN", "ACCEPTANCE_JOURNAL_WRITE_FAILED", "OUTCOME_UNKNOWN"],
    ["OUTCOME_UNKNOWN", "PROVIDER_EXECUTION_ID_INVALID", "OUTCOME_UNKNOWN"],
  ] as const)("accepts the contract pair %s + %s committing %s", async (outcome, failureCode, state) => {
    const { client } = clientAnswering(200, { executionAttemptId: ATTEMPT, fencingCounter: 3, state, failureCode });
    expect((await client.reportSubmissionFailed(ATTEMPT, PROOF, { outcome, failureCode })).state).toBe(state);
  });

  it.each([
    ["a malformed attempt UUID", ATTEMPT.toUpperCase(), PROOF, UNKNOWN],
    ["a path-like attempt", "../leases", PROOF, UNKNOWN],
    ["fencing counter 0", ATTEMPT, { ...PROOF, fencingCounter: 0 }, UNKNOWN],
    ["a short lease token", ATTEMPT, { ...PROOF, leaseToken: "short" }, UNKNOWN],
    ["an unknown outcome", ATTEMPT, PROOF, { outcome: "SUCCEEDED", failureCode: "ACCEPTANCE_JOURNAL_WRITE_FAILED" }],
    ["an unknown failure code", ATTEMPT, PROOF, { outcome: "OUTCOME_UNKNOWN", failureCode: "WORKER_LEASE_EXPIRED_DURING_SUBMISSION" }],
    ["a mismatched pair", ATTEMPT, PROOF, { outcome: "DEFINITIVELY_REJECTED", failureCode: "ACCEPTANCE_JOURNAL_WRITE_FAILED" }],
    ["a non-object report", ATTEMPT, PROOF, null],
  ] as const)("never sends %s", async (_label, attemptId, proof, report) => {
    const { client, captured } = clientAnswering(200, OK_BODY);
    expect(await codeOf(client.reportSubmissionFailed(attemptId, proof, report as unknown as SubmissionFailureReport))).toBe("MALFORMED_CONTROL_RESPONSE");
    expect(captured).toEqual([]);
  });

  it("sends only the two report members, even from a richer object", async () => {
    const { client, captured } = clientAnswering(200, OK_BODY);
    const richer = { ...UNKNOWN, providerExecutionId: "op-1", leaseExpiresAt: "x" } as unknown as SubmissionFailureReport;
    await client.reportSubmissionFailed(ATTEMPT, PROOF, richer);
    expect(Object.keys(JSON.parse(String(captured[0]!.init.body)) as object)).toEqual(["fencingCounter", "leaseToken", "outcome", "failureCode"]);
  });

  it.each([
    ["another attempt", { ...OK_BODY, executionAttemptId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee" }],
    ["another fencing counter", { ...OK_BODY, fencingCounter: 4 }],
    ["another failure code", { ...OK_BODY, failureCode: "PROVIDER_EXECUTION_ID_INVALID" }],
    ["the state of the other outcome", { ...OK_BODY, state: "FAILED_BEFORE_SUBMISSION" }],
    ["an extra member", { ...OK_BODY, outcome: "OUTCOME_UNKNOWN" }],
    ["a missing member", { executionAttemptId: ATTEMPT, fencingCounter: 3, state: "OUTCOME_UNKNOWN" }],
    ["a string fencing counter", { ...OK_BODY, fencingCounter: "3" }],
    ["a non-object body", [OK_BODY]],
    ["unparsable JSON", "{not json"],
  ] as const)("rejects a response naming %s as malformed", async (_label, body) => {
    const { client } = clientAnswering(200, body);
    expect(await codeOf(client.reportSubmissionFailed(ATTEMPT, PROOF, UNKNOWN))).toBe("MALFORMED_CONTROL_RESPONSE");
  });

  it.each([
    [409, "SUBMISSION_FAILED_REJECTED"],
    [401, "WORKER_AUTHENTICATION_REJECTED"],
    [403, "WORKER_AUTHENTICATION_REJECTED"],
    [500, "CONTROL_API_UNAVAILABLE"],
    [503, "CONTROL_API_UNAVAILABLE"],
    [400, "MALFORMED_CONTROL_RESPONSE"],
    [404, "MALFORMED_CONTROL_RESPONSE"],
  ] as const)("maps HTTP %i to %s, once, without exposing the body", async (status, code) => {
    const { client, captured } = clientAnswering(status, { status: "error", code: "LEASE_REJECTED", leak: PROOF.leaseToken });
    expect(await codeOf(client.reportSubmissionFailed(ATTEMPT, PROOF, UNKNOWN))).toBe(code);
    // No internal retry, whatever the status.
    expect(captured).toHaveLength(1);
  });

  it("maps a transport failure to CONTROL_API_UNAVAILABLE after exactly one request", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const client = createHttpWorkerControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: MACHINE, fetchImpl });
    expect(await codeOf(client.reportSubmissionFailed(ATTEMPT, PROOF, UNKNOWN))).toBe("CONTROL_API_UNAVAILABLE");
    expect(calls).toBe(1);
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
    const pending = client.reportSubmissionFailed(ATTEMPT, PROOF, UNKNOWN, controller.signal);
    controller.abort();
    expect(await codeOf(pending)).toBe("CONTROL_API_UNAVAILABLE");
    expect(seen).toBe(controller.signal);
  });

  it("parses through the exported strict parser identically", () => {
    expect(parseSubmissionFailedResponse(OK_BODY, { executionAttemptId: ATTEMPT, fencingCounter: 3, report: UNKNOWN }).failureCode).toBe("ACCEPTANCE_JOURNAL_WRITE_FAILED");
    expect(() => parseSubmissionFailedResponse({ ...OK_BODY, state: "SUBMITTED" }, { executionAttemptId: ATTEMPT, fencingCounter: 3, report: UNKNOWN })).toThrow(WorkerError);
  });
});
