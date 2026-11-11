import { describe, expect, it } from "vitest";

import { createHttpWorkerControlClient, parseHeartbeatResponse } from "../src/workerControlClient.js";
import { WorkerError } from "../src/workerError.js";

// R44B6W: the neutral worker-side client for the existing lease heartbeat
// route (client contract R44B6W0, architecture section 15). Single shot,
// client only: a fake fetch, no network, no control plane, no provider.
// Nothing in worker source calls this method.

const MACHINE = "fixture-machine-credential";
const ATTEMPT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PROOF = Object.freeze({ fencingCounter: 3, leaseToken: "A".repeat(43) });
const EXPIRES = "2026-11-11T10:02:00.000Z";
const OK_BODY = { fencingCounter: 3, leaseExpiresAt: EXPIRES };

type Captured = { url: string; init: RequestInit };

function clientAnswering(status: number, body: unknown) {
  const captured: Captured[] = [];
  const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { client: createHttpWorkerControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: MACHINE, fetchImpl }), captured };
}

// The error is a closed WorkerError whose visible text carries no secret.
const codeOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(WorkerError);
  const visible = `${(error as Error).message} ${JSON.stringify(error)} ${String((error as Error).stack)} ${String((error as Error).cause)}`;
  expect(visible.includes(PROOF.leaseToken) || visible.includes(MACHINE) || /Bearer|Authorization/.test(visible)).toBe(false);
  return (error as WorkerError).code;
};

describe("heartbeat client request", () => {
  it("posts exactly the proof to the heartbeat path with Bearer authentication", async () => {
    const { client, captured } = clientAnswering(200, OK_BODY);
    expect(await client.heartbeat(ATTEMPT, PROOF)).toEqual({ fencingCounter: 3, leaseExpiresAt: new Date(EXPIRES) });
    expect(captured).toHaveLength(1);
    const [request] = captured;
    expect(request!.url).toBe(`http://127.0.0.1:9/worker-control/v1/attempts/${ATTEMPT}/heartbeat`);
    expect(request!.url.includes(MACHINE) || request!.url.includes(PROOF.leaseToken)).toBe(false);
    expect(request!.init.method).toBe("POST");
    expect(request!.init.redirect).toBe("error");
    expect(request!.init.headers).toEqual({ Authorization: `Bearer ${MACHINE}`, "Content-Type": "application/json" });
    expect(request!.init.body).toBe(JSON.stringify({ fencingCounter: 3, leaseToken: PROOF.leaseToken }));
    expect(Object.keys(JSON.parse(String(request!.init.body)) as object)).toEqual(["fencingCounter", "leaseToken"]);
    // No signal unless the caller supplies one: the client owns no timeout.
    expect("signal" in request!.init).toBe(false);
  });

  it("sends only the proof members even when the proof object carries more", async () => {
    const { client, captured } = clientAnswering(200, OK_BODY);
    const proof = { ...PROOF, leaseExpiresAt: new Date(0), executionAttemptId: ATTEMPT } as unknown as typeof PROOF;
    await client.heartbeat(ATTEMPT, proof);
    expect(JSON.parse(String(captured[0]!.init.body))).toEqual({ fencingCounter: 3, leaseToken: PROOF.leaseToken });
  });

  it.each([
    ["an uppercase attempt", ATTEMPT.toUpperCase(), PROOF],
    ["a non-UUID attempt", "not-a-uuid", PROOF],
    ["a zero fencing counter", ATTEMPT, { ...PROOF, fencingCounter: 0 }],
    ["a fractional fencing counter", ATTEMPT, { ...PROOF, fencingCounter: 1.5 }],
    ["a short lease token", ATTEMPT, { ...PROOF, leaseToken: "short" }],
  ])("sends nothing for %s", async (_label, attempt, proof) => {
    const { client, captured } = clientAnswering(200, OK_BODY);
    expect(await codeOf(client.heartbeat(attempt, proof))).toBe("MALFORMED_CONTROL_RESPONSE");
    expect(captured).toEqual([]);
  });

  it("passes an externally supplied signal through, and its abort is a transport failure", async () => {
    let seen: AbortSignal | undefined;
    let calls = 0;
    const fetchImpl = (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls += 1;
      seen = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException(`aborted Bearer ${MACHINE}`, "AbortError")));
      });
    }) as typeof fetch;
    const client = createHttpWorkerControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: MACHINE, fetchImpl });
    const controller = new AbortController();
    const pending = client.heartbeat(ATTEMPT, PROOF, controller.signal);
    controller.abort();
    expect(await codeOf(pending)).toBe("CONTROL_API_UNAVAILABLE");
    expect(seen).toBe(controller.signal);
    expect(calls).toBe(1);
  });
});

describe("heartbeat client response", () => {
  it("returns the server expiry as data, whatever the local clock says", async () => {
    // A canonical expiry far in the past relative to the local clock is still
    // returned unchanged: the client never judges lease validity locally.
    const { client } = clientAnswering(200, { fencingCounter: 3, leaseExpiresAt: "2001-01-01T00:00:00.000Z" });
    expect(await client.heartbeat(ATTEMPT, PROOF)).toEqual({ fencingCounter: 3, leaseExpiresAt: new Date("2001-01-01T00:00:00.000Z") });
  });

  it.each([
    ["another fencing counter", { ...OK_BODY, fencingCounter: 4 }],
    ["a zero fencing counter", { ...OK_BODY, fencingCounter: 0 }],
    ["a negative fencing counter", { ...OK_BODY, fencingCounter: -3 }],
    ["a fractional fencing counter", { ...OK_BODY, fencingCounter: 3.5 }],
    ["an unsafe fencing counter", { ...OK_BODY, fencingCounter: 2 ** 53 }],
    ["a string fencing counter", { ...OK_BODY, fencingCounter: "3" }],
    ["a missing fencingCounter", { leaseExpiresAt: EXPIRES }],
    ["a missing leaseExpiresAt", { fencingCounter: 3 }],
    ["an extra executionAttemptId", { ...OK_BODY, executionAttemptId: ATTEMPT }],
    ["an extra state", { ...OK_BODY, state: "SUBMITTING" }],
    ["an extra leaseToken", { ...OK_BODY, leaseToken: PROOF.leaseToken }],
    ["a non-ISO expiry", { ...OK_BODY, leaseExpiresAt: "soon" }],
    ["a second-precision expiry", { ...OK_BODY, leaseExpiresAt: "2026-11-11T10:02:00Z" }],
    ["an offset expiry", { ...OK_BODY, leaseExpiresAt: "2026-11-11T10:02:00.000+00:00" }],
    ["an impossible expiry", { ...OK_BODY, leaseExpiresAt: "2026-02-30T10:02:00.000Z" }],
    ["a numeric expiry", { ...OK_BODY, leaseExpiresAt: 1789000000000 }],
    ["an array", [OK_BODY]],
    ["null", null],
    ["non-JSON", "not json"],
  ])("refuses a 200 with %s as malformed", async (_label, body) => {
    const { client, captured } = clientAnswering(200, body);
    expect(await codeOf(client.heartbeat(ATTEMPT, PROOF))).toBe("MALFORMED_CONTROL_RESPONSE");
    expect(captured).toHaveLength(1);
  });

  it.each([
    [409, "HEARTBEAT_REJECTED"],
    [401, "WORKER_AUTHENTICATION_REJECTED"],
    [403, "WORKER_AUTHENTICATION_REJECTED"],
    [500, "CONTROL_API_UNAVAILABLE"],
    [502, "CONTROL_API_UNAVAILABLE"],
    [503, "CONTROL_API_UNAVAILABLE"],
    [400, "MALFORMED_CONTROL_RESPONSE"],
    [404, "MALFORMED_CONTROL_RESPONSE"],
    [415, "MALFORMED_CONTROL_RESPONSE"],
    [201, "MALFORMED_CONTROL_RESPONSE"],
  ] as const)("maps HTTP %d to %s with exactly one request", async (status, code) => {
    // Even a body that looks like success, or leaks the token, is not read.
    const { client, captured } = clientAnswering(status, { ...OK_BODY, status: "error", code: "LEASE_REJECTED", leak: PROOF.leaseToken });
    expect(await codeOf(client.heartbeat(ATTEMPT, PROOF))).toBe(code);
    expect(captured).toHaveLength(1);
  });

  it("maps a refusal to HEARTBEAT_REJECTED only, never a lease, SUBMITTING or local-expiry code", async () => {
    const { client } = clientAnswering(409, { status: "error", code: "LEASE_REJECTED" });
    const error = await client.heartbeat(ATTEMPT, PROOF).then(() => undefined, (caught: WorkerError) => caught);
    expect(error!.code).toBe("HEARTBEAT_REJECTED");
    expect(["LEASE_REJECTED", "SUBMITTING_REJECTED", "LEASE_EXPIRED"]).not.toContain(error!.code);
    expect(error!.message).toBe("The worker-control API rejected the lease heartbeat.");
  });

  it("maps a transport failure to CONTROL_API_UNAVAILABLE with exactly one attempt and no retained cause", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new TypeError(`fetch failed for Bearer ${MACHINE} body ${PROOF.leaseToken}`);
    }) as typeof fetch;
    const client = createHttpWorkerControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: MACHINE, fetchImpl });
    expect(await codeOf(client.heartbeat(ATTEMPT, PROOF))).toBe("CONTROL_API_UNAVAILABLE");
    expect(calls).toBe(1);
  });

  it("parses through the exported strict parser identically", () => {
    expect(parseHeartbeatResponse(OK_BODY, { fencingCounter: 3 })).toEqual({ fencingCounter: 3, leaseExpiresAt: new Date(EXPIRES) });
    expect(() => parseHeartbeatResponse({ ...OK_BODY, fencingCounter: 2 }, { fencingCounter: 3 })).toThrow(WorkerError);
  });
});
