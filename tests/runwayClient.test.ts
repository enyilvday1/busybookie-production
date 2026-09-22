import RunwayML from "@runwayml/sdk";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createRunwayClient,
} from "../src/runway/createRunwayClient.js";

import {
  requireRunwayCredentials,
} from "../src/runway/runwayCredentials.js";

import {
  RUNWAY_API_VERSION,
  RUNWAY_HTTP_MAX_RETRIES,
  RUNWAY_REQUEST_TIMEOUT_MS,
} from "../src/runway/runway.types.js";

describe("Busybookie Runway credentials", () => {
  it("rejects a missing Runway API credential", () => {
    expect(() =>
      requireRunwayCredentials({}),
    ).toThrow(
      /Runway API access is not configured/,
    );
  });

  it("rejects a blank Runway API credential", () => {
    expect(() =>
      requireRunwayCredentials({
        RUNWAYML_API_SECRET: "   ",
      }),
    ).toThrow(
      /Runway API access is not configured/,
    );
  });

  it("trims and returns a configured credential", () => {
    const credentials =
      requireRunwayCredentials({
        RUNWAYML_API_SECRET:
          "  test-runway-secret  ",
      });

    expect(credentials.apiKey).toBe(
      "test-runway-secret",
    );
  });
});

describe("Busybookie Runway client", () => {
  it("creates the official Runway SDK client without making an API request", () => {
    const client =
      createRunwayClient({
        RUNWAYML_API_SECRET:
          "test-runway-secret",
      });

    expect(client).toBeInstanceOf(
      RunwayML,
    );

    expect(client.apiKey).toBe(
      "test-runway-secret",
    );

    expect(client.runwayVersion).toBe(
      RUNWAY_API_VERSION,
    );

    expect(client.timeout).toBe(
      RUNWAY_REQUEST_TIMEOUT_MS,
    );

    expect(client.maxRetries).toBe(
      RUNWAY_HTTP_MAX_RETRIES,
    );
  });

  it("uses the locked Busybookie Runway client policy", () => {
    expect(RUNWAY_API_VERSION).toBe(
      "2024-11-06",
    );

    expect(
      RUNWAY_REQUEST_TIMEOUT_MS,
    ).toBe(60_000);

    expect(
      RUNWAY_HTTP_MAX_RETRIES,
    ).toBe(2);
  });
});
