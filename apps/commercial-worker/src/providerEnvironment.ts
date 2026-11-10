import { WorkerError } from "./workerError.js";

// COMMERCIAL_WORKER_PROVIDER_ENV_FALLBACK=FORBIDDEN
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 7).
//
// The provider SDKs silently read these variables when a client is built
// without an explicit value: a missing per-job credential would then run on an
// operator key, or be redirected to another endpoint, project or header set.
// The commercial worker refuses to start if any of them is present at all,
// even empty. Discovered from the installed SDKs and the engine:
//
//   @runwayml/sdk: RUNWAYML_API_SECRET, RUNWAYML_BASE_URL,
//                  RUNWAYML_CUSTOM_HEADERS, RUNWAYML_LOG
//   @google/genai: GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_GEMINI_BASE_URL,
//                  GOOGLE_VERTEX_BASE_URL, GOOGLE_GENAI_USE_VERTEXAI,
//                  GOOGLE_GENAI_USE_ENTERPRISE, GOOGLE_CLOUD_PROJECT,
//                  GOOGLE_CLOUD_LOCATION
//   google-auth-library (Vertex/ADC): GOOGLE_APPLICATION_CREDENTIALS,
//                  GCLOUD_PROJECT, GOOGLE_CLOUD_QUOTA_PROJECT,
//                  GOOGLE_EXTERNAL_ACCOUNT_ALLOW_EXECUTABLES
//
// This is the only module that names them; the worker never reads their values.
export const FORBIDDEN_PROVIDER_ENVIRONMENT_VARIABLES: readonly string[] = Object.freeze([
  "RUNWAYML_API_SECRET",
  "RUNWAYML_BASE_URL",
  "RUNWAYML_CUSTOM_HEADERS",
  "RUNWAYML_LOG",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GEMINI_BASE_URL",
  "GOOGLE_VERTEX_BASE_URL",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GOOGLE_GENAI_USE_ENTERPRISE",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_QUOTA_PROJECT",
  "GOOGLE_EXTERNAL_ACCOUNT_ALLOW_EXECUTABLES",
]);

export type WorkerEnvironment = Readonly<Record<string, string | undefined>>;

// Throws before any work if a forbidden variable is present. Only presence is
// checked (case-insensitively, as Windows environments are); no value is read,
// compared or reported.
export function assertNoProviderEnvironment(environment: WorkerEnvironment): void {
  const present = new Set(Object.keys(environment).map((name) => name.toUpperCase()));
  if (FORBIDDEN_PROVIDER_ENVIRONMENT_VARIABLES.some((name) => present.has(name))) {
    throw new WorkerError("FORBIDDEN_PROVIDER_ENVIRONMENT");
  }
}
