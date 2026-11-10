import { afterEach, describe, expect, it } from "vitest";

import { startCommercialApiServer, type RunningCommercialApiServer } from "../src/startCommercialApiServer.js";
import { send } from "./httpClient.js";

// Production creation, provisioning and authentication are service-layer
// only until protected endpoints are added deliberately (R44B4B). No HTTP
// path may reach them, with or without credentials or identity headers.

let running: RunningCommercialApiServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

const NOT_FOUND = '{"status":"error","code":"NOT_FOUND"}\n';

const CANDIDATE_ROUTES: readonly (readonly [string, string])[] = [
  ["POST", "/productions"],
  ["POST", "/projects"],
  ["POST", "/create-production"],
  ["POST", "/api/v1/productions"],
  ["GET", "/productions"],
  ["GET", "/productions/00000000-0000-4000-8000-000000000000"],
  ["PUT", "/productions/00000000-0000-4000-8000-000000000000"],
  ["POST", "/signup"],
  ["POST", "/login"],
  ["POST", "/logout"],
  ["POST", "/provision"],
  ["POST", "/accounts"],
  ["POST", "/users"],
  ["GET", "/me"],
  ["GET", "/session"],
  ["GET", "/auth/callback"],
  ["POST", "/api/v1/auth/token"],
];

describe("no unauthenticated customer or authentication endpoint", () => {
  it.each(CANDIDATE_ROUTES)("%s %s returns the existing JSON 404", async (method, path) => {
    running = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { checkReadiness: async () => true } });
    // Node's client sends a GET body without framing, so only POST/PUT carry one.
    const body = method === "GET" ? undefined : '{"title":"x","accountId":"y"}';
    const response = await send(running.port, method, path, body);

    expect(response.status).toBe(404);
    expect(response.body).toBe(NOT_FOUND);
  });

  it.each(CANDIDATE_ROUTES)("%s %s still returns 404 with a credential and identity headers", async (method, path) => {
    running = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { checkReadiness: async () => true } });
    const response = await send(running.port, method, path, undefined, {
      Authorization: "Bearer fixture-token-alice",
      "X-User-Id": "00000000-0000-4000-8000-000000000000",
      "X-Account-Id": "00000000-0000-4000-8000-000000000001",
      "X-Role": "OWNER",
      "X-Plan": "CREATOR",
      "X-Entitlement": "FREE_BYO",
    });

    expect(response.status).toBe(404);
    expect(response.body).toBe(NOT_FOUND);
    expect(response.body).not.toContain("fixture-token-alice");
  });
});
