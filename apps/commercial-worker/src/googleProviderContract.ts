import type { WorkerLease } from "./workerControlClient.js";
import { WorkerError } from "./workerError.js";

// The closed first real-provider contract
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 36,
// "First real-provider adapter: Google GenAI (revision R44B10A)"). Pure data
// and one admission parser: no SDK, network, credential or environment.
//
// The worker's only copy of these values; they are never imported from the
// engine. The prompt cap preserves BusyBookie's existing local Google
// operational limit (the engine's single-shot prompt builder enforces the same
// 1000 code units), which is not a Google API maximum.

export const GOOGLE_PROVIDER_ID = "GOOGLE_GENAI";
export const GOOGLE_MODEL = "gemini-omni-1.1-flash";
export const GOOGLE_PROMPT_MAX_CODE_UNITS = 1000;
export const GOOGLE_RESOLUTION = "720p";
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
// The cost unit of the issuer's expected-cost cap for this provider; the
// worker never computes a cost or an entitlement decision.
export const GOOGLE_EXPECTED_COST_CAP_UNIT = "MICRO_USD";

// The closed first-slice request. referenceImage stays the untrusted member:
// its grammar is the R44B10P1 parser's, applied by input-media retrieval
// after the grant, so a malformed reference is an R44B10P2 input failure.
export type GoogleGenerationRequest = Readonly<{
  prompt: string;
  referenceImage: unknown;
  resolution: typeof GOOGLE_RESOLUTION;
}>;

const REQUEST_MEMBERS = Object.freeze(["prompt", "referenceImage", "resolution"]);
const EDGE_WHITESPACE = /^\s|\s$/;

const invalid = () => new WorkerError("LEASED_REQUEST_INVALID");

const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

// Exactly { prompt, referenceImage, resolution }. No trimming, case folding
// or other normalisation: anything else is refused, never repaired.
export function parseGoogleGenerationRequest(value: unknown): GoogleGenerationRequest {
  if (!isPlainObject(value)) throw invalid();
  const members = Object.keys(value).sort();
  if (members.length !== REQUEST_MEMBERS.length || members.some((name, index) => name !== REQUEST_MEMBERS[index])) throw invalid();
  const { prompt, referenceImage, resolution } = value;
  if (typeof prompt !== "string" || prompt.length === 0 || prompt.length > GOOGLE_PROMPT_MAX_CODE_UNITS || EDGE_WHITESPACE.test(prompt)) throw invalid();
  if (resolution !== GOOGLE_RESOLUTION) throw invalid();
  return Object.freeze({ prompt, referenceImage, resolution });
}

// Admission on the authoritative lease, before any credential grant: the one
// provider, the one model, the closed request and the issuer's cost unit.
// Another provider or model is incompatible work; a request outside the
// closed contract is an issuer invariant violation. Neither is a provider
// rejection or an input failure.
export function admitGoogleLease(lease: Pick<WorkerLease, "provider" | "model" | "generationRequest" | "expectedCostCap">): GoogleGenerationRequest {
  if (lease.provider !== GOOGLE_PROVIDER_ID || lease.model !== GOOGLE_MODEL) throw new WorkerError("LEASED_PROVIDER_INCOMPATIBLE");
  if (lease.expectedCostCap.unit !== GOOGLE_EXPECTED_COST_CAP_UNIT) throw invalid();
  return parseGoogleGenerationRequest(lease.generationRequest);
}
