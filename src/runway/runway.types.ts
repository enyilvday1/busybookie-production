export const RUNWAY_API_VERSION = "2024-11-06" as const;

export const RUNWAY_REQUEST_TIMEOUT_MS = 60_000;

export const RUNWAY_HTTP_MAX_RETRIES = 2;

export type RunwayCredentials = Readonly<{
  apiKey: string;
}>;

export type RunwayCredentialSource = Readonly<{
  RUNWAYML_API_SECRET?: string;
}>;
