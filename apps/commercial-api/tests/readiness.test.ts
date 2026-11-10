import { afterEach, describe, expect, it } from "vitest";

import { startCommercialApiServer, type RunningCommercialApiServer } from "../src/startCommercialApiServer.js";
import { send } from "./httpClient.js";

const READY = '{"status":"ready","service":"commercial-api"}\n';
const NOT_READY = '{"status":"error","code":"NOT_READY"}\n';

let running: RunningCommercialApiServer | undefined;

async function start(checkReadiness?: () => Promise<boolean>) {
  running = await startCommercialApiServer({
    host: "127.0.0.1",
    port: 0,
    ...(checkReadiness === undefined ? {} : { dependencies: { checkReadiness } }),
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

describe("GET /__ready", () => {
  it("returns 200 with the exact ready contract when ready", async () => {
    const port = await start(async () => true);
    const response = await send(port, "GET", "/__ready");

    expect(response.status).toBe(200);
    expectJsonHeaders(response.headers);
    expect(response.body).toBe(READY);
  });

  it("returns 503 NOT_READY when not ready", async () => {
    const port = await start(async () => false);
    const response = await send(port, "GET", "/__ready");

    expect(response.status).toBe(503);
    expectJsonHeaders(response.headers);
    expect(response.body).toBe(NOT_READY);
  });

  it("defaults to not ready when no readiness check is supplied", async () => {
    const port = await start();
    expect((await send(port, "GET", "/__ready")).body).toBe(NOT_READY);
  });

  it("turns a failing check into 503 without exposing the failure", async () => {
    const port = await start(async () => {
      throw Object.assign(new Error('relation "schema_migrations" does not exist on db.internal:5432 as app_runtime'), {
        code: "42P01",
      });
    });
    const response = await send(port, "GET", "/__ready");

    expect(response.status).toBe(503);
    expect(response.body).toBe(NOT_READY);
    expect(response.body).not.toMatch(/schema_migrations|db\.internal|5432|app_runtime|42P01|relation/);
  });

  it("reflects the current state on every request", async () => {
    let ready = true;
    const port = await start(async () => ready);

    expect((await send(port, "GET", "/__ready")).status).toBe(200);
    ready = false;
    expect((await send(port, "GET", "/__ready")).status).toBe(503);
    ready = true;
    expect((await send(port, "GET", "/__ready")).status).toBe(200);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])("rejects %s with 405 and Allow: GET without probing", async (method) => {
    let probes = 0;
    const port = await start(async () => {
      probes += 1;
      return true;
    });
    const response = await send(port, method, "/__ready");

    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe("GET");
    expect(probes).toBe(0);
  });

  it.each(["/__ready/", "/__READY", "/__ready/extra", "/ready"])("returns 404 for the near-miss path %s", async (path) => {
    const port = await start(async () => true);
    expect((await send(port, "GET", path)).status).toBe(404);
  });
});

describe("GET /__health is unchanged by readiness", () => {
  it("stays 200 with the exact liveness body while not ready, and never probes", async () => {
    let probes = 0;
    const port = await start(async () => {
      probes += 1;
      return false;
    });
    const response = await send(port, "GET", "/__health");

    expect(response.status).toBe(200);
    expect(response.body).toBe('{"status":"ok","service":"commercial-api"}\n');
    expect(probes).toBe(0);
  });
});
