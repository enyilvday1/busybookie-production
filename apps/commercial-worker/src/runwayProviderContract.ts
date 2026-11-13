import {
  admitRunwayGenerationRequest,
  GenerationContractError,
  parseRunwayGenerationRequest as parseSharedRunwayRequest,
  RUNWAY_DURATION_MAX_SECONDS,
  RUNWAY_DURATION_MIN_SECONDS,
  RUNWAY_EXPECTED_COST_CAP_UNIT,
  RUNWAY_MODEL,
  RUNWAY_PROMPT_MAX_CODE_UNITS,
  RUNWAY_PROVIDER_ID,
  type RunwayGenerationRequest,
} from "commercial-worker-protocol";

import type { WorkerLease } from "./workerControlClient.js";
import { WorkerError } from "./workerError.js";

// The worker side of the second real-provider contract
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 36,
// "Second real-provider adapter: Runway Gen-4.5 (revision R44B10B)"). Since
// R44B11A the provider/model identity, the closed request grammar, the
// duration range, the cost unit and the canonical request hash belong to the
// shared protocol package; this module re-exports them, keeps only the
// adapter-owned values and maps shared refusals to the worker's existing
// failure codes. No SDK, network or environment.

export {
  RUNWAY_DURATION_MAX_SECONDS,
  RUNWAY_DURATION_MIN_SECONDS,
  RUNWAY_EXPECTED_COST_CAP_UNIT,
  RUNWAY_MODEL,
  RUNWAY_PROMPT_MAX_CODE_UNITS,
  RUNWAY_PROVIDER_ID,
  type RunwayGenerationRequest,
};

export const RUNWAY_RATIO = "1280:720";
export const RUNWAY_OUTPUT_FORMAT = "mp4";
// The final inline data-URI string limit, and the uniform raw-byte retrieval
// ceiling that guarantees it for every allowed media-type prefix
// (base64 of 3,932,142 bytes is 5,242,856 characters; the longest prefix,
// "data:image/jpeg;base64," or "data:image/webp;base64,", is 23).
export const RUNWAY_DATA_URI_MAX_CHARS = 5_242_880;
export const RUNWAY_MAX_REFERENCE_IMAGE_BYTES = 3_932_142;
export const RUNWAY_CREATE_TIMEOUT_MS = 60000;
export const RUNWAY_CREATE_MAX_RETRIES = 0;
// Set explicitly so no SDK environment variable can select another origin or
// API version.
export const RUNWAY_API_BASE_URL = "https://api.dev.runwayml.com";
export const RUNWAY_API_VERSION = "2024-11-06";

// An unsupported provider or model is incompatible work; every other shared
// refusal (grammar, cost unit, a value no issuer could canonicalize, a hash
// mismatch) is an issuer invariant violation. Neither is a provider rejection
// or an input failure.
function workerErrorFor(error: unknown): unknown {
  if (!(error instanceof GenerationContractError)) return error;
  return new WorkerError(error.code === "PROVIDER_MODEL_UNSUPPORTED" ? "LEASED_PROVIDER_INCOMPATIBLE" : "LEASED_REQUEST_INVALID");
}

// The shared closed-request parser, refusing with LEASED_REQUEST_INVALID.
export function parseRunwayGenerationRequest(value: unknown): RunwayGenerationRequest {
  try {
    return parseSharedRunwayRequest(value);
  } catch (error) {
    throw workerErrorFor(error);
  }
}

// Admission on the authoritative lease, before any grant: the shared
// provider/model, cost-unit, grammar and canonical-hash checks, in that order.
export function admitRunwayLease(
  lease: Pick<WorkerLease, "provider" | "model" | "generationRequest" | "generationRequestSha256" | "expectedCostCap">,
): RunwayGenerationRequest {
  try {
    return admitRunwayGenerationRequest({
      provider: lease.provider,
      model: lease.model,
      expectedCostCapUnit: lease.expectedCostCap.unit,
      generationRequest: lease.generationRequest,
      generationRequestSha256: lease.generationRequestSha256,
    });
  } catch (error) {
    throw workerErrorFor(error);
  }
}
