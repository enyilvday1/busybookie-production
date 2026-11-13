import {
  admitGoogleGenerationRequest,
  GenerationContractError,
  GOOGLE_EXPECTED_COST_CAP_UNIT,
  GOOGLE_MODEL,
  GOOGLE_PROMPT_MAX_CODE_UNITS,
  GOOGLE_PROVIDER_ID,
  GOOGLE_RESOLUTION,
  parseGoogleGenerationRequest as parseSharedGoogleRequest,
  type GoogleGenerationRequest,
} from "commercial-worker-protocol";

import type { WorkerLease } from "./workerControlClient.js";
import { WorkerError } from "./workerError.js";

// The worker side of the first real-provider contract
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 36,
// "First real-provider adapter: Google GenAI (revision R44B10A)"). Since
// R44B11A the provider/model identity, the closed request grammar, the cost
// unit and the canonical request hash belong to the shared protocol package;
// this module re-exports them, keeps only the adapter-owned values and maps
// shared refusals to the worker's existing failure codes. No SDK, network or
// environment.

export { GOOGLE_EXPECTED_COST_CAP_UNIT, GOOGLE_MODEL, GOOGLE_PROMPT_MAX_CODE_UNITS, GOOGLE_PROVIDER_ID, GOOGLE_RESOLUTION, type GoogleGenerationRequest };

export const GOOGLE_MAX_REFERENCE_IMAGE_BYTES = 10_485_760;
export const GOOGLE_CREATE_TIMEOUT_MS = 60000;
export const GOOGLE_CREATE_MAX_RETRIES = 0;
// Gemini Developer API only, set explicitly so no SDK environment variable
// can select another backend, endpoint or API version.
export const GOOGLE_API_BASE_URL = "https://generativelanguage.googleapis.com/";
export const GOOGLE_API_VERSION = "v1beta";
// Adapter-owned response constants; never taken from the generation request.
export const GOOGLE_RESPONSE_FORMAT = Object.freeze({ type: "video", delivery: "uri", resolution: GOOGLE_RESOLUTION } as const);
export const GOOGLE_INTERACTION_FLAGS = Object.freeze({ background: true, store: true, stream: false } as const);

// An unsupported provider or model is incompatible work; every other shared
// refusal (grammar, cost unit, a value no issuer could canonicalize, a hash
// mismatch) is an issuer invariant violation. Neither is a provider rejection
// or an input failure.
function workerErrorFor(error: unknown): unknown {
  if (!(error instanceof GenerationContractError)) return error;
  return new WorkerError(error.code === "PROVIDER_MODEL_UNSUPPORTED" ? "LEASED_PROVIDER_INCOMPATIBLE" : "LEASED_REQUEST_INVALID");
}

// The shared closed-request parser, refusing with LEASED_REQUEST_INVALID.
export function parseGoogleGenerationRequest(value: unknown): GoogleGenerationRequest {
  try {
    return parseSharedGoogleRequest(value);
  } catch (error) {
    throw workerErrorFor(error);
  }
}

// Admission on the authoritative lease, before any grant: the shared
// provider/model, cost-unit, grammar and canonical-hash checks, in that order.
export function admitGoogleLease(
  lease: Pick<WorkerLease, "provider" | "model" | "generationRequest" | "generationRequestSha256" | "expectedCostCap">,
): GoogleGenerationRequest {
  try {
    return admitGoogleGenerationRequest({
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
