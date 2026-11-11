import { describe, expect, it } from "vitest";

import { createHttpWorkerControlClient, parseSubmittedResponse } from "../src/workerControlClient.js";
import { WorkerError } from "../src/workerError.js";

// R44B6P: the worker-side client for the live submitted acknowledgement
// (R44B6O contract, architecture section 18). A fake fetch only: no network,
// no control plane, no provider. Nothing in worker source calls this method.

const MACHINE = "fixture-machine-credential";
const ATTEMPT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PROOF = Object.freeze({ fencingCounter: 3, leaseToken: "A".repeat(43) });
const EXECUTION = "models/x/operations/op-1";
const SUBMITTED_AT = "2026-11-11T10:00:02.000Z";
const OK_BODY = { executionAttemptId: ATTEMPT, fencingCounter: 3, state: "SUBMITTED", providerExecutionId: EXECUTION, submittedAt: SUBMITTED_AT };

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
    return (error as WorkerError).code;
  }
  throw new Error("expected a rejection");
};

describe("submitted report client", () => {
  it("sends exactly the published request and returns the strictly parsed acknowledgement", async () => {
    const { client, captured } = clientAnswering(200, OK_BODY);
    const acknowledgement = await client.reportSubmitted(ATTEMPT, PROOF, EXECUTION);
    expect(acknowledgement).toEqual({
      executionAttemptId: ATTEMPT,
      fencingCounter: 3,
      state: "SUBMITTED",
      providerExecutionId: EXECUTION,
      submittedAt: new Date(SUBMITTED_AT),
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe(`http://127.0.0.1:9/worker-control/v1/attempts/${ATTEMPT}/submitted`);
    expect(captured[0]!.init.method).toBe("POST");
    expect(captured[0]!.init.redirect).toBe("error");
    expect(captured[0]!.init.headers).toEqual({ Authorization: `Bearer ${MACHINE}`, "Content-Type": "application/json" });
    const sent = JSON.parse(String(captured[0]!.init.body)) as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual(["fencingCounter", "leaseToken", "providerExecutionId"]);
    // fencingCounter keeps its existing JSON type: a number.
    expect(sent).toEqual({ fencingCounter: 3, leaseToken: PROOF.leaseToken, providerExecutionId: EXECUTION });
  });

  it.each([
    ["a malformed attempt UUID", ATTEMPT.toUpperCase(), PROOF, EXECUTION],
    ["a path-like attempt", "../leases", PROOF, EXECUTION],
    ["fencing counter 0", ATTEMPT, { ...PROOF, fencingCounter: 0 }, EXECUTION],
    ["a short lease token", ATTEMPT, { ...PROOF, leaseToken: "short" }, EXECUTION],
    ["an empty provider execution ID", ATTEMPT, PROOF, ""],
    ["a provider execution ID with a space", ATTEMPT, PROOF, "op 1"],
    ["a URL as provider execution ID", ATTEMPT, PROOF, "https://provider.example/op/1"],
    ["a 257-character provider execution ID", ATTEMPT, PROOF, "x".repeat(257)],
  ] as const)("never sends %s", async (_label, attemptId, proof, executionId) => {
    const { client, captured } = clientAnswering(200, OK_BODY);
    expect(await codeOf(client.reportSubmitted(attemptId, proof, executionId))).toBe("SUBMITTED_REPORT_INVALID");
    expect(captured).toEqual([]);
  });

  it.each([
    ["another attempt", { ...OK_BODY, executionAttemptId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee" }],
    ["another fencing counter", { ...OK_BODY, fencingCounter: 4 }],
    ["another provider execution ID", { ...OK_BODY, providerExecutionId: "op-other" }],
    ["a state other than SUBMITTED", { ...OK_BODY, state: "SUBMITTING" }],
    ["an extra member", { ...OK_BODY, recoveryExpiresAt: null }],
    ["a missing member", { executionAttemptId: ATTEMPT, fencingCounter: 3, state: "SUBMITTED", providerExecutionId: EXECUTION }],
    ["a non-canonical timestamp", { ...OK_BODY, submittedAt: "2026-11-11T10:00:02Z" }],
    ["a string fencing counter", { ...OK_BODY, fencingCounter: "3" }],
    ["a non-object body", [OK_BODY]],
    ["unparsable JSON", "{not json"],
  ] as const)("rejects a response naming %s as malformed", async (_label, body) => {
    const { client } = clientAnswering(200, body);
    expect(await codeOf(client.reportSubmitted(ATTEMPT, PROOF, EXECUTION))).toBe("MALFORMED_CONTROL_RESPONSE");
  });

  it.each([
    [409, "SUBMITTED_REPORT_REJECTED"],
    [401, "WORKER_AUTHENTICATION_REJECTED"],
    [403, "WORKER_AUTHENTICATION_REJECTED"],
    [503, "CONTROL_API_UNAVAILABLE"],
    [500, "CONTROL_API_UNAVAILABLE"],
    [400, "MALFORMED_CONTROL_RESPONSE"],
    [404, "MALFORMED_CONTROL_RESPONSE"],
  ] as const)("maps HTTP %i to %s without exposing the body", async (status, code) => {
    const { client } = clientAnswering(status, { status: "error", code: "LEASE_REJECTED", leak: PROOF.leaseToken });
    const promise = client.reportSubmitted(ATTEMPT, PROOF, EXECUTION);
    expect(await codeOf(promise)).toBe(code);
    const message = await promise.catch((error: Error) => error.message);
    expect(String(message).includes(PROOF.leaseToken) || String(message).includes(EXECUTION)).toBe(false);
  });

  it("maps a transport failure to CONTROL_API_UNAVAILABLE", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const client = createHttpWorkerControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: MACHINE, fetchImpl });
    expect(await codeOf(client.reportSubmitted(ATTEMPT, PROOF, EXECUTION))).toBe("CONTROL_API_UNAVAILABLE");
  });

  it("sends no signal unless the caller supplies one (R44B6Y: no timeout of its own)", async () => {
    const { client, captured } = clientAnswering(200, OK_BODY);
    await client.reportSubmitted(ATTEMPT, PROOF, EXECUTION);
    expect("signal" in captured[0]!.init).toBe(false);
  });

  it("passes an externally supplied signal through, and its abort is a transport failure", async () => {
    let seen: AbortSignal | undefined;
    const fetchImpl = ((_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException(`aborted ${PROOF.leaseToken}`, "AbortError")));
      });
    }) as typeof fetch;
    const client = createHttpWorkerControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: MACHINE, fetchImpl });
    const controller = new AbortController();
    const pending = client.reportSubmitted(ATTEMPT, PROOF, EXECUTION, controller.signal);
    controller.abort();
    expect(await codeOf(pending)).toBe("CONTROL_API_UNAVAILABLE");
    expect(seen).toBe(controller.signal);
  });

  it("parses through the exported strict parser identically", () => {
    expect(parseSubmittedResponse(OK_BODY, { executionAttemptId: ATTEMPT, fencingCounter: 3, providerExecutionId: EXECUTION }).state).toBe("SUBMITTED");
    expect(() => parseSubmittedResponse({ ...OK_BODY, state: "SUCCEEDED" }, { executionAttemptId: ATTEMPT, fencingCounter: 3, providerExecutionId: EXECUTION })).toThrow(
      WorkerError,
    );
  });
});
