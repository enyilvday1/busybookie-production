import { describe, expect, it } from "vitest";

import { createHttpWorkerControlClient, parseAcceptanceRecoveryConflict, parseAcceptanceRecoveryResponse } from "../src/workerControlClient.js";
import { WorkerError } from "../src/workerError.js";

// R44B6S: the worker-side client for token-less acceptance recovery (R44B6R
// contract, architecture section 18). A fake fetch only: no network, no
// control plane, no provider.

const MACHINE = "fixture-machine-credential";
const ATTEMPT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const EXECUTION = "models/x/operations/op-1";
const OK_BODY = { executionAttemptId: ATTEMPT, fencingCounter: 3, state: "SUBMITTED", providerExecutionId: EXECUTION };
const EXPECTED = { executionAttemptId: ATTEMPT, fencingCounter: 3, providerExecutionId: EXECUTION };

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
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(WorkerError);
  const visible = `${(error as Error).message} ${JSON.stringify(error)}`;
  expect(visible.includes(EXECUTION) || visible.includes(MACHINE)).toBe(false);
  return (error as WorkerError).code;
};

describe("acceptance-recovery client request", () => {
  it("posts exactly the two-member body to the recovery path with Bearer authentication and no lease token", async () => {
    const { client, captured } = clientAnswering(200, OK_BODY);
    await client.recoverAcceptance(ATTEMPT, 3, EXECUTION);
    expect(captured).toHaveLength(1);
    const [request] = captured;
    expect(request!.url).toBe(`http://127.0.0.1:9/worker-control/v1/attempts/${ATTEMPT}/acceptance-recovery`);
    expect(request!.init.method).toBe("POST");
    expect(request!.init.redirect).toBe("error");
    expect(request!.init.headers).toEqual({ Authorization: `Bearer ${MACHINE}`, "Content-Type": "application/json" });
    expect(request!.init.body).toBe(JSON.stringify({ fencingCounter: 3, providerExecutionId: EXECUTION }));
    expect(Object.keys(JSON.parse(String(request!.init.body)) as object)).toEqual(["fencingCounter", "providerExecutionId"]);
    expect(String(request!.init.body)).not.toMatch(/leaseToken|recordSha256|recordedAt/);
    expect("signal" in request!.init).toBe(false);
  });

  it("passes the caller's abort signal to fetch, and an abort is a transport failure", async () => {
    let seen: AbortSignal | undefined;
    const fetchImpl = (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }) as typeof fetch;
    const client = createHttpWorkerControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: MACHINE, fetchImpl });
    const controller = new AbortController();
    const pending = client.recoverAcceptance(ATTEMPT, 3, EXECUTION, controller.signal);
    controller.abort();
    expect(await codeOf(pending)).toBe("CONTROL_API_UNAVAILABLE");
    expect(seen).toBe(controller.signal);
  });

  it.each([
    ["an uppercase attempt", ATTEMPT.toUpperCase(), 3, EXECUTION],
    ["a zero fencing counter", ATTEMPT, 0, EXECUTION],
    ["a fractional fencing counter", ATTEMPT, 1.5, EXECUTION],
    ["an empty provider execution ID", ATTEMPT, 3, ""],
    ["a URL as provider execution ID", ATTEMPT, 3, "https://example.test/op"],
  ])("sends nothing for %s", async (_label, attempt, fencing, execution) => {
    const { client, captured } = clientAnswering(200, OK_BODY);
    expect(await codeOf(client.recoverAcceptance(attempt, fencing, execution))).toBe("ACCEPTANCE_RECONCILIATION_FAILED");
    expect(captured).toEqual([]);
  });
});

describe("acceptance-recovery client responses", () => {
  it.each(["SUBMITTED", "SUCCEEDED", "SUBMITTED_FAILED", "ABANDONED"] as const)("acknowledges exact %s", async (state) => {
    const { client } = clientAnswering(200, { ...OK_BODY, state });
    expect(await client.recoverAcceptance(ATTEMPT, 3, EXECUTION)).toEqual({
      status: "ACKNOWLEDGED",
      acknowledgement: { executionAttemptId: ATTEMPT, fencingCounter: 3, state, providerExecutionId: EXECUTION },
    });
  });

  it.each([
    ["another attempt", { ...OK_BODY, executionAttemptId: "11111111-2222-4333-8444-555555555555" }],
    ["another fencing counter", { ...OK_BODY, fencingCounter: 4 }],
    ["another provider execution ID", { ...OK_BODY, providerExecutionId: "models/x/operations/op-2" }],
    ["an unknown state", { ...OK_BODY, state: "OUTCOME_UNKNOWN" }],
    ["a SUBMITTING state", { ...OK_BODY, state: "SUBMITTING" }],
    ["an extra member", { ...OK_BODY, submittedAt: "2026-11-11T10:00:02.000Z" }],
    ["a missing member", { executionAttemptId: ATTEMPT, fencingCounter: 3, state: "SUBMITTED" }],
    ["a string fencing counter", { ...OK_BODY, fencingCounter: "3" }],
    ["an array", [OK_BODY]],
    ["non-JSON", "not json"],
  ])("refuses a 200 with %s as malformed", async (_label, body) => {
    const { client } = clientAnswering(200, body);
    expect(await codeOf(client.recoverAcceptance(ATTEMPT, 3, EXECUTION))).toBe("MALFORMED_CONTROL_RESPONSE");
  });

  it("returns ATTEMPT_STILL_SUBMITTING as a value, not an acknowledgement or error", async () => {
    const { client } = clientAnswering(409, { status: "error", code: "ATTEMPT_STILL_SUBMITTING" });
    expect(await client.recoverAcceptance(ATTEMPT, 3, EXECUTION)).toEqual({ status: "ATTEMPT_STILL_SUBMITTING" });
  });

  it("maps the uniform 409 LEASE_REJECTED to a definitive ACCEPTANCE_RECONCILIATION_FAILED", async () => {
    const { client } = clientAnswering(409, { status: "error", code: "LEASE_REJECTED" });
    expect(await codeOf(client.recoverAcceptance(ATTEMPT, 3, EXECUTION))).toBe("ACCEPTANCE_RECONCILIATION_FAILED");
  });

  it.each([
    ["an unknown code", { status: "error", code: "CONCURRENT_MODIFICATION" }],
    ["an extra member", { status: "error", code: "ATTEMPT_STILL_SUBMITTING", detail: "x" }],
    ["a non-error status", { status: "ok", code: "ATTEMPT_STILL_SUBMITTING" }],
    ["no body", ""],
    ["non-JSON", "conflict"],
  ])("refuses a 409 with %s as malformed", async (_label, body) => {
    const { client } = clientAnswering(409, body);
    expect(await codeOf(client.recoverAcceptance(ATTEMPT, 3, EXECUTION))).toBe("MALFORMED_CONTROL_RESPONSE");
  });

  it.each([
    [401, "WORKER_AUTHENTICATION_REJECTED"],
    [403, "WORKER_AUTHENTICATION_REJECTED"],
    [500, "CONTROL_API_UNAVAILABLE"],
    [503, "CONTROL_API_UNAVAILABLE"],
    [400, "MALFORMED_CONTROL_RESPONSE"],
    [404, "MALFORMED_CONTROL_RESPONSE"],
    [413, "MALFORMED_CONTROL_RESPONSE"],
    [415, "MALFORMED_CONTROL_RESPONSE"],
    [201, "MALFORMED_CONTROL_RESPONSE"],
  ] as const)("maps HTTP %d to %s", async (status, code) => {
    // A body that would otherwise look like the submitting wait is never read here.
    const { client } = clientAnswering(status, { status: "error", code: "ATTEMPT_STILL_SUBMITTING" });
    expect(await codeOf(client.recoverAcceptance(ATTEMPT, 3, EXECUTION))).toBe(code);
  });

  it("maps a transport failure to CONTROL_API_UNAVAILABLE without leaking the request", async () => {
    const fetchImpl = (async () => {
      throw new TypeError(`fetch failed for Bearer ${MACHINE} ${EXECUTION}`);
    }) as typeof fetch;
    const client = createHttpWorkerControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: MACHINE, fetchImpl });
    expect(await codeOf(client.recoverAcceptance(ATTEMPT, 3, EXECUTION))).toBe("CONTROL_API_UNAVAILABLE");
  });

  it("leaves established routes' 409 handling unchanged", async () => {
    const { client } = clientAnswering(409, { status: "error", code: "ATTEMPT_STILL_SUBMITTING" });
    expect(await codeOf(client.leaseNextAttempt())).toBe("LEASE_REJECTED");
    expect(await codeOf(client.reportSubmitted(ATTEMPT, { fencingCounter: 3, leaseToken: "A".repeat(43) }, EXECUTION))).toBe("SUBMITTED_REPORT_REJECTED");
  });

  it("parses through the exported strict parsers identically", () => {
    expect(parseAcceptanceRecoveryResponse(OK_BODY, EXPECTED).state).toBe("SUBMITTED");
    expect(() => parseAcceptanceRecoveryResponse({ ...OK_BODY, state: "LEASED" }, EXPECTED)).toThrow(WorkerError);
    expect(parseAcceptanceRecoveryConflict({ status: "error", code: "LEASE_REJECTED" })).toBe("LEASE_REJECTED");
    expect(() => parseAcceptanceRecoveryConflict({ status: "error", code: "NOT_FOUND" })).toThrow(WorkerError);
  });
});
