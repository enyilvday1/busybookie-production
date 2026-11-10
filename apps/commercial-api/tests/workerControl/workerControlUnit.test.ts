import { randomBytes, randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import type { TransactionalPool } from "../../src/database/runtimePool.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../src/startCommercialApiServer.js";
import { createWorkerControlApplication } from "../../src/workerControl/workerControlApplication.js";
import { send } from "../httpClient.js";
import { createTestWorkerAuthenticationAdapter } from "../support/testWorkerAuthentication.js";
import { createRecordingWorkerSecurityEventSink } from "../support/testWorkerSecurityEvents.js";

// Worker-control routing and request security without a database. The pool
// answers only the worker-principal lookup; a transaction would fail loudly.

const WORKER_ID = randomUUID();
const TOKEN = `fixture-worker-${randomBytes(16).toString("hex")}`;

const pool = {
  query: async <Row extends object>(sql: string) => {
    if (sql.includes("FROM worker_principals")) return { rows: [{ id: WORKER_ID, label: "unit-worker", status: "ACTIVE" }] as unknown as Row[] };
    throw new Error("unexpected query");
  },
  connect: async () => {
    throw new Error("unexpected transaction");
  },
  end: async () => {},
} as TransactionalPool;

let running: RunningCommercialApiServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function start(options: { available?: boolean } = {}) {
  const recording = createRecordingWorkerSecurityEventSink();
  const application = createWorkerControlApplication({
    authentication: createTestWorkerAuthenticationAdapter([{ token: TOKEN, workerPrincipalId: WORKER_ID }], { available: () => options.available ?? true }),
    securityEvents: recording.sink,
    pool,
    reportFailure: () => {},
  });
  running = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { application, checkReadiness: async () => true } });
  return { port: running.port, recording };
}

const attempt = randomUUID();

describe("worker-control composition", () => {
  it("cannot be constructed without a security sink, an adapter or the pool", () => {
    const recording = createRecordingWorkerSecurityEventSink();
    const adapter = createTestWorkerAuthenticationAdapter([]);
    for (const options of [
      { authentication: adapter, pool },
      { securityEvents: recording.sink, pool },
      { authentication: adapter, securityEvents: recording.sink },
    ]) {
      expect(() => createWorkerControlApplication(options as never)).toThrow(/security event sink/);
    }
  });
});

describe("worker-control request security", () => {
  it.each([
    ["POST", "/worker-control/v1/leases"],
    ["POST", `/worker-control/v1/attempts/${attempt}/heartbeat`],
    ["POST", `/worker-control/v1/attempts/${attempt}/release`],
  ])("%s %s refuses a browser Origin before authentication and logs it", async (method, path) => {
    const { port, recording } = await start();
    const response = await send(port, method, path, undefined, { Origin: "https://app.example", Authorization: `Bearer ${TOKEN}` });
    expect(response.status).toBe(403);
    expect(response.body).toBe('{"status":"error","code":"ORIGIN_NOT_ALLOWED"}\n');
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(recording.events.map((event) => [event.type, event.reason, event.workerPrincipalId])).toEqual([["WORKER_ORIGIN_REJECTED", "ORIGIN_PRESENT", undefined]]);
  });

  it("maps missing and rejected credentials to an identical 401 and an unavailable verifier to 503, each logged", async () => {
    const { port, recording } = await start();
    const missing = await send(port, "POST", "/worker-control/v1/leases");
    const rejected = await send(port, "POST", "/worker-control/v1/leases", undefined, { Authorization: "Bearer not-a-fixture" });
    for (const response of [missing, rejected]) {
      expect(response.status).toBe(401);
      expect(response.body).toBe('{"status":"error","code":"AUTHENTICATION_REQUIRED"}\n');
      expect(response.headers["www-authenticate"]).toBe("Bearer");
    }
    expect(recording.events.map((event) => [event.type, event.reason])).toEqual([
      ["WORKER_AUTH_REQUIRED", "CREDENTIAL_ABSENT"],
      ["WORKER_AUTH_REJECTED", "ADAPTER_REJECTED"],
    ]);

    const outage = await start({ available: false });
    const unavailable = await send(outage.port, "POST", "/worker-control/v1/leases", undefined, { Authorization: `Bearer ${TOKEN}` });
    expect(unavailable.status).toBe(503);
    expect(unavailable.body).toBe('{"status":"error","code":"SERVICE_UNAVAILABLE"}\n');
    expect(outage.recording.events.map((event) => [event.type, event.reason])).toEqual([["WORKER_AUTH_UNAVAILABLE", "ADAPTER_FAULT"]]);
  });

  it("fails closed with 503 when the security log cannot accept an event", async () => {
    const { port, recording } = await start();
    recording.setFailing(true);
    const response = await send(port, "POST", "/worker-control/v1/leases");
    expect(response.status).toBe(503);
  });

  it("answers only POST on the four worker paths, and 404 elsewhere", async () => {
    const { port } = await start();
    for (const path of [
      "/worker-control/v1/leases",
      `/worker-control/v1/attempts/${attempt}/heartbeat`,
      `/worker-control/v1/attempts/${attempt}/release`,
      `/worker-control/v1/attempts/${attempt}/credential-grant`,
    ]) {
      const response = await send(port, "GET", path);
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe("POST");
    }
    for (const path of [
      "/worker-control/v1",
      "/worker-control/v1/leases/x",
      "/worker-control/v1/attempts/not-a-uuid/heartbeat",
      `/worker-control/v1/attempts/${attempt.toUpperCase()}/heartbeat`,
      `/worker-control/v1/attempts/${attempt}/credential-grants`,
      `/worker-control/v1/attempts/${attempt}/open`,
      `/worker-control/v1/attempts/${attempt}/submitting`,
      "/worker/leases",
    ]) {
      expect((await send(port, "POST", path, undefined, { Authorization: `Bearer ${TOKEN}` })).status).toBe(404);
    }
  });

  it("never puts the bearer credential into a response or security event", async () => {
    const { port, recording } = await start();
    const responses = [
      await send(port, "POST", "/worker-control/v1/leases", undefined, { Authorization: `Bearer ${TOKEN}x` }),
      await send(port, "POST", "/worker-control/v1/leases", undefined, { Authorization: `Basic ${TOKEN}` }),
      await send(port, "POST", "/worker-control/v1/leases", undefined, { Origin: "https://a.example", Authorization: `Bearer ${TOKEN}` }),
    ];
    const visible = responses.map((response) => response.body + JSON.stringify(response.headers)).join("") + JSON.stringify(recording.events);
    expect(visible.includes(TOKEN)).toBe(false);
  });
});
