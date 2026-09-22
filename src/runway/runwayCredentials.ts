import type {
  RunwayCredentials,
  RunwayCredentialSource,
} from "./runway.types.js";

export function requireRunwayCredentials(
  source: RunwayCredentialSource,
): RunwayCredentials {
  const apiKey =
    source.RUNWAYML_API_SECRET?.trim();

  if (!apiKey) {
    throw new Error(
      "Runway API access is not configured. " +
      "Set RUNWAYML_API_SECRET in the local .env file before using Runway operations.",
    );
  }

  return Object.freeze({
    apiKey,
  });
}
