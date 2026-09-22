import RunwayML from "@runwayml/sdk";

import type {
  RunwayCredentialSource,
} from "./runway.types.js";

import {
  RUNWAY_API_VERSION,
  RUNWAY_HTTP_MAX_RETRIES,
  RUNWAY_REQUEST_TIMEOUT_MS,
} from "./runway.types.js";

import {
  requireRunwayCredentials,
} from "./runwayCredentials.js";

export function createRunwayClient(
  source: RunwayCredentialSource,
): RunwayML {
  const credentials =
    requireRunwayCredentials(source);

  return new RunwayML({
    apiKey: credentials.apiKey,
    runwayVersion: RUNWAY_API_VERSION,
    timeout: RUNWAY_REQUEST_TIMEOUT_MS,
    maxRetries: RUNWAY_HTTP_MAX_RETRIES,
    logLevel: "warn",
  });
}
