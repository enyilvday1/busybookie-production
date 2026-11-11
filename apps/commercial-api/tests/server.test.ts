import { afterEach, describe, expect, it, vi } from "vitest";

import { HEALTH_BODY } from "../src/createCommercialApiServer.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../src/startCommercialApiServer.js";
import { send, sendRaw } from "./httpClient.js";

const NOT_FOUND = '{"status":"error","code":"NOT_FOUND"}\n';
const METHOD_NOT_ALLOWED = '{"status":"error","code":"METHOD_NOT_ALLOWED"}\n';
const INTERNAL_ERROR = '{"status":"error","code":"INTERNAL_ERROR"}\n';
const BAD_REQUEST = '{"status":"error","code":"BAD_REQUEST"}\n';

let running: RunningCommercialApiServer | undefined;

async function start(dependencies?: Parameters<typeof startCommercialApiServer>[0]["dependencies"]) {
  running = await startCommercialApiServer({
    host: "127.0.0.1",
    port: 0,
    ...(dependencies === undefined ? {} : { dependencies }),
  });
  return running.port;
}

afterEach(async () => {
  await running?.close();
  running = undefined;
});

function expectJsonHeaders(headers: Readonly<Record<string, string | string[] | undefined>>) {
  expect(headers["content-type"]).toBe("application/json; charset=utf-8");
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers["x-content-type-options"]).toBe("nosniff");
}

describe("GET /__health", () => {
  it("returns 200 with the exact stable JSON contract", async () => {
    const port = await start();
    const response = await send(port, "GET", "/__health");

    expect(response.status).toBe(200);
    expectJsonHeaders(response.headers);
    expect(response.body).toBe('{"status":"ok","service":"commercial-api"}\n');
    expect(JSON.parse(response.body)).toEqual({ status: "ok", service: "commercial-api" });
    expect(Object.keys(JSON.parse(response.body))).toEqual(["status", "service"]);
  });

  it("ignores a query string without reflecting it", async () => {
    const port = await start();
    const response = await send(port, "GET", "/__health?probe=secret-value");

    expect(response.status).toBe(200);
    expect(response.body).not.toContain("secret-value");
  });

  it("exposes a frozen health body", () => {
    expect(Object.isFrozen(HEALTH_BODY)).toBe(true);
  });
});

describe("method handling", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])("rejects %s on /__health with 405 and Allow: GET", async (method) => {
    const port = await start();
    const response = await send(port, method, "/__health");

    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe("GET");
    expectJsonHeaders(response.headers);
    if (method !== "HEAD") {
      expect(response.body).toBe(METHOD_NOT_ALLOWED);
    }
  });

  it("rejects a bodyless POST", async () => {
    const port = await start();
    expect((await send(port, "POST", "/__health")).status).toBe(405);
  });

  it("rejects a POST with a body", async () => {
    const port = await start();
    const response = await send(port, "POST", "/__health", '{"status":"ok"}');

    expect(response.status).toBe(405);
    expect(response.body).toBe(METHOD_NOT_ALLOWED);
  });
});

describe("unknown routes", () => {
  it("does not expose acceptance recovery in the default composition", async () => {
    const port = await start();
    expect((await send(port, "POST", "/worker-control/v1/attempts/11111111-2222-4333-8444-555555555555/acceptance-recovery", "{}", { "Content-Type": "application/json" })).status).toBe(404);
  });
  it("does not expose submission-failed in the default composition", async () => {
    const port = await start();
    expect((await send(port, "POST", "/worker-control/v1/attempts/11111111-2222-4333-8444-555555555555/submission-failed", "{}", { "Content-Type": "application/json" })).status).toBe(404);
  });
  it.each(["/", "/api", "/api/v1/health", "/__health/", "/__HEALTH", "/__health/extra", "/health", "/index.html"])(
    "returns JSON 404 for %s",
    async (path) => {
      const port = await start();
      const response = await send(port, "GET", path);

      expect(response.status).toBe(404);
      expectJsonHeaders(response.headers);
      expect(response.body).toBe(NOT_FOUND);
    },
  );

  it("does not reflect the path, query or method", async () => {
    const port = await start();
    const response = await send(port, "DELETE", "/C:/Projects/private-marker?token=leak-marker");

    expect(response.status).toBe(404);
    expect(response.body).toBe(NOT_FOUND);
    expect(response.body).not.toMatch(/private-marker|leak-marker|DELETE|Projects/);
  });

  it("rejects a non-origin-form request target with JSON 400", async () => {
    const port = await start();
    const raw = await sendRaw(port, "GET http://example.test/__health HTTP/1.1\r\nHost: example.test\r\nConnection: close\r\n\r\n");

    expect(raw.startsWith("HTTP/1.1 400")).toBe(true);
    expect(raw.endsWith(BAD_REQUEST)).toBe(true);
  });

  it("answers malformed HTTP with JSON 400", async () => {
    const port = await start();
    const raw = await sendRaw(port, "NOT A VALID REQUEST\r\n\r\n");

    expect(raw.startsWith("HTTP/1.1 400 Bad Request")).toBe(true);
    expect(raw).toContain("Content-Type: application/json; charset=utf-8");
    expect(raw.endsWith(BAD_REQUEST)).toBe(true);
  });
});

describe("error boundary", () => {
  it("turns a handler failure into a generic 500 without the error text", async () => {
    const reportError = vi.fn();
    const port = await start({
      readHealth: () => {
        throw new Error("internal detail at C:\\private\\path with credential-marker");
      },
      reportError,
    });
    const response = await send(port, "GET", "/__health");

    expect(response.status).toBe(500);
    expectJsonHeaders(response.headers);
    expect(response.body).toBe(INTERNAL_ERROR);
    expect(response.body).not.toMatch(/internal detail|private|credential-marker|Error|at /);
    expect(reportError).toHaveBeenCalledOnce();
  });

  it("returns a generic 500 when the body cannot be serialised", async () => {
    const port = await start({ readHealth: () => ({ size: 1n }), reportError: () => {} });
    const response = await send(port, "GET", "/__health");

    expect(response.status).toBe(500);
    expect(response.body).toBe(INTERNAL_ERROR);
  });

  it("keeps serving after a failure", async () => {
    let fail = true;
    const port = await start({
      readHealth: () => {
        if (fail) {
          fail = false;
          throw new Error("once");
        }
        return HEALTH_BODY;
      },
      reportError: () => {},
    });

    expect((await send(port, "GET", "/__health")).status).toBe(500);
    expect((await send(port, "GET", "/__health")).status).toBe(200);
  });
});
