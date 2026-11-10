import { afterEach, describe, expect, it } from "vitest";

import { startCommercialApiServer, type RunningCommercialApiServer } from "../src/startCommercialApiServer.js";
import { send } from "./httpClient.js";

// Production creation is service-layer only until an authenticated boundary
// exists. No HTTP path may reach it.

let running: RunningCommercialApiServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe("no unauthenticated production endpoint", () => {
  it.each([
    ["POST", "/productions"],
    ["POST", "/projects"],
    ["POST", "/create-production"],
    ["POST", "/api/v1/productions"],
    ["GET", "/productions"],
    ["PUT", "/productions/00000000-0000-4000-8000-000000000000"],
  ])("%s %s returns the existing JSON 404", async (method, path) => {
    running = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { checkReadiness: async () => true } });
    // Node's client sends a GET body without framing, so only POST/PUT carry one.
    const body = method === "GET" ? undefined : '{"title":"x","accountId":"y"}';
    const response = await send(running.port, method, path, body);

    expect(response.status).toBe(404);
    expect(response.body).toBe('{"status":"error","code":"NOT_FOUND"}\n');
  });
});
