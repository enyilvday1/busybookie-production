import type { WorkerLease } from "./workerControlClient.js";
import { WorkerError } from "./workerError.js";

// The closed second real-provider contract
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 36,
// "Second real-provider adapter: Runway Gen-4.5 (revision R44B10B)"). Pure
// data and one admission parser: no SDK, network, credential or environment.
//
// The worker's only copy of these values; they are never imported from the
// engine. The duration ceiling preserves BusyBookie's existing five-second
// operational limit, narrower than the provider's own range.

export const RUNWAY_PROVIDER_ID = "RUNWAY";
export const RUNWAY_MODEL = "gen4.5";
export const RUNWAY_PROMPT_MAX_CODE_UNITS = 1000;
export const RUNWAY_DURATION_MIN_SECONDS = 2;
export const RUNWAY_DURATION_MAX_SECONDS = 5;
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
// The cost unit of the issuer's expected-cost cap for this provider; the
// worker never computes a price or an entitlement decision.
export const RUNWAY_EXPECTED_COST_CAP_UNIT = "PROVIDER_CREDITS";

// The closed request. referenceImage stays the untrusted member: its grammar
// is the R44B10P1 parser's, applied by input-media retrieval after the grant,
// so a malformed reference is an R44B10P2 input failure.
export type RunwayGenerationRequest = Readonly<{
  prompt: string;
  referenceImage: unknown;
  durationSeconds: number;
}>;

const REQUEST_MEMBERS = Object.freeze(["durationSeconds", "prompt", "referenceImage"]);
const EDGE_WHITESPACE = /^\s|\s$/;

const invalid = () => new WorkerError("LEASED_REQUEST_INVALID");

const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

// Exactly { prompt, referenceImage, durationSeconds }. No trimming, rounding
// or other normalisation: anything else is refused, never repaired.
export function parseRunwayGenerationRequest(value: unknown): RunwayGenerationRequest {
  if (!isPlainObject(value)) throw invalid();
  const members = Object.keys(value).sort();
  if (members.length !== REQUEST_MEMBERS.length || members.some((name, index) => name !== REQUEST_MEMBERS[index])) throw invalid();
  const { prompt, referenceImage, durationSeconds } = value;
  if (typeof prompt !== "string" || prompt.length === 0 || prompt.length > RUNWAY_PROMPT_MAX_CODE_UNITS || EDGE_WHITESPACE.test(prompt)) throw invalid();
  if (
    typeof durationSeconds !== "number" ||
    !Number.isInteger(durationSeconds) ||
    durationSeconds < RUNWAY_DURATION_MIN_SECONDS ||
    durationSeconds > RUNWAY_DURATION_MAX_SECONDS
  ) {
    throw invalid();
  }
  return Object.freeze({ prompt, referenceImage, durationSeconds });
}

// Admission on the authoritative lease, before any credential grant: the one
// provider, the one model, the closed request and the issuer's cost unit.
// Another provider or model is incompatible work; a request outside the
// closed contract is an issuer invariant violation. Neither is a provider
// rejection or an input failure.
export function admitRunwayLease(lease: Pick<WorkerLease, "provider" | "model" | "generationRequest" | "expectedCostCap">): RunwayGenerationRequest {
  if (lease.provider !== RUNWAY_PROVIDER_ID || lease.model !== RUNWAY_MODEL) throw new WorkerError("LEASED_PROVIDER_INCOMPATIBLE");
  if (lease.expectedCostCap.unit !== RUNWAY_EXPECTED_COST_CAP_UNIT) throw invalid();
  return parseRunwayGenerationRequest(lease.generationRequest);
}
