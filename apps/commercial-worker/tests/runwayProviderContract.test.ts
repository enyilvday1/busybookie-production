import { describe, expect, it } from "vitest";

import {
  admitRunwayLease,
  parseRunwayGenerationRequest,
  RUNWAY_API_BASE_URL,
  RUNWAY_API_VERSION,
  RUNWAY_CREATE_MAX_RETRIES,
  RUNWAY_CREATE_TIMEOUT_MS,
  RUNWAY_DATA_URI_MAX_CHARS,
  RUNWAY_DURATION_MAX_SECONDS,
  RUNWAY_DURATION_MIN_SECONDS,
  RUNWAY_EXPECTED_COST_CAP_UNIT,
  RUNWAY_MAX_REFERENCE_IMAGE_BYTES,
  RUNWAY_MODEL,
  RUNWAY_OUTPUT_FORMAT,
  RUNWAY_PROMPT_MAX_CODE_UNITS,
  RUNWAY_PROVIDER_ID,
  RUNWAY_RATIO,
} from "../src/runwayProviderContract.js";
import { WorkerError } from "../src/workerError.js";

// R44B10B: the closed second real-provider contract and its admission parser.
// Pure: no SDK, network, credential, storage or environment.

const REFERENCE = Object.freeze({ key: "inputs/ref.png", sha256: "a".repeat(64), byteCount: 16, contentType: "image/png" });
const valid = (overrides: Record<string, unknown> = {}) => ({ prompt: "A red kite over a quiet harbour.", referenceImage: REFERENCE, durationSeconds: 5, ...overrides });

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(WorkerError);
    return (error as WorkerError).code;
  }
  throw new Error("expected a refusal");
};

describe("locked R44B10B constants", () => {
  it("are exactly the published values", () => {
    expect(RUNWAY_PROVIDER_ID).toBe("RUNWAY");
    expect(RUNWAY_MODEL).toBe("gen4.5");
    expect(RUNWAY_PROMPT_MAX_CODE_UNITS).toBe(1000);
    expect(RUNWAY_DURATION_MIN_SECONDS).toBe(2);
    expect(RUNWAY_DURATION_MAX_SECONDS).toBe(5);
    expect(RUNWAY_RATIO).toBe("1280:720");
    expect(RUNWAY_OUTPUT_FORMAT).toBe("mp4");
    expect(RUNWAY_DATA_URI_MAX_CHARS).toBe(5_242_880);
    expect(RUNWAY_MAX_REFERENCE_IMAGE_BYTES).toBe(3_932_142);
    expect(RUNWAY_CREATE_TIMEOUT_MS).toBe(60000);
    expect(RUNWAY_CREATE_MAX_RETRIES).toBe(0);
    expect(RUNWAY_API_BASE_URL).toBe("https://api.dev.runwayml.com");
    expect(RUNWAY_API_VERSION).toBe("2024-11-06");
    expect(RUNWAY_EXPECTED_COST_CAP_UNIT).toBe("PROVIDER_CREDITS");
  });

  it("chooses the raw-byte ceiling as the largest that keeps every allowed data URI within the limit", () => {
    const encoded = (bytes: number) => Math.ceil(bytes / 3) * 4;
    for (const type of ["image/png", "image/jpeg", "image/webp"]) {
      const prefix = `data:${type};base64,`.length;
      expect(prefix + encoded(RUNWAY_MAX_REFERENCE_IMAGE_BYTES)).toBeLessThanOrEqual(RUNWAY_DATA_URI_MAX_CHARS);
    }
    expect("data:image/jpeg;base64,".length + encoded(RUNWAY_MAX_REFERENCE_IMAGE_BYTES + 1)).toBeGreaterThan(RUNWAY_DATA_URI_MAX_CHARS);
  });
});

describe("closed generation request parser", () => {
  it("accepts exactly the three members and returns them unchanged and frozen", () => {
    const parsed = parseRunwayGenerationRequest(valid());
    expect(parsed).toEqual(valid());
    expect(Object.isFrozen(parsed)).toBe(true);
    // The reference member is passed through untouched for the R44B10P1 parser at retrieval.
    expect(parsed.referenceImage).toBe(REFERENCE);
  });

  it.each([2, 3, 4, 5])("accepts the integer duration %i", (durationSeconds) => {
    expect(parseRunwayGenerationRequest(valid({ durationSeconds })).durationSeconds).toBe(durationSeconds);
  });

  it("accepts a prompt of exactly 1000 UTF-16 code units, including surrogate pairs counted as two", () => {
    expect(parseRunwayGenerationRequest(valid({ prompt: "p".repeat(1000) })).prompt).toHaveLength(1000);
    const astral = "\u{1F3AC}".repeat(500);
    expect(astral.length).toBe(1000);
    expect(parseRunwayGenerationRequest(valid({ prompt: astral })).prompt).toBe(astral);
  });

  it.each([
    ["an empty prompt", { prompt: "" }],
    ["a 1001-code-unit prompt", { prompt: "p".repeat(1001) }],
    ["a 1001-code-unit astral prompt", { prompt: `${"\u{1F3AC}".repeat(500)}p` }],
    ["leading whitespace", { prompt: " A kite." }],
    ["trailing whitespace", { prompt: "A kite. " }],
    ["a trailing newline", { prompt: "A kite.\n" }],
    ["a leading tab", { prompt: "\tA kite." }],
    ["a non-breaking leading space", { prompt: " A kite." }],
    ["a whitespace-only prompt", { prompt: "   " }],
    ["a non-string prompt", { prompt: 42 }],
    ["a duration below 2", { durationSeconds: 1 }],
    ["a zero duration", { durationSeconds: 0 }],
    ["a negative duration", { durationSeconds: -3 }],
    ["a duration above 5", { durationSeconds: 6 }],
    ["the provider-level 10-second duration", { durationSeconds: 10 }],
    ["a non-integer duration", { durationSeconds: 4.5 }],
    ["a near-integer duration", { durationSeconds: 5.000001 }],
    ["a NaN duration", { durationSeconds: Number.NaN }],
    ["an infinite duration", { durationSeconds: Number.POSITIVE_INFINITY }],
    ["a string duration", { durationSeconds: "5" }],
    ["a boolean duration", { durationSeconds: true }],
    ["a null duration", { durationSeconds: null }],
  ])("refuses %s without repairing it", (_label, overrides) => {
    expect(codeOf(() => parseRunwayGenerationRequest(valid(overrides)))).toBe("LEASED_REQUEST_INVALID");
  });

  it.each(["duration", "ratio", "seed", "outputFormat", "contentModeration", "proresProfile", "model", "promptImage", "promptText", "resolution", "url", "uploadUri", "options"])(
    "refuses the unknown member %s",
    (member) => {
      expect(codeOf(() => parseRunwayGenerationRequest({ ...valid(), [member]: "x" }))).toBe("LEASED_REQUEST_INVALID");
    },
  );

  it("refuses a missing member, and a request that is not a plain object", () => {
    const { referenceImage: _omitted, ...missingReference } = valid();
    const { durationSeconds: _also, ...missingDuration } = valid();
    const { prompt: _too, ...missingPrompt } = valid();
    for (const value of [missingReference, missingDuration, missingPrompt, null, undefined, "prompt", 7, [valid()], Object.create(null), new Map()]) {
      expect(codeOf(() => parseRunwayGenerationRequest(value))).toBe("LEASED_REQUEST_INVALID");
    }
  });

  it("does not judge the reference grammar: a malformed reference is an R44B10P2 input failure after the grant", () => {
    for (const referenceImage of [{ key: "../escape" }, "inputs/ref.png", null, 7]) {
      expect(parseRunwayGenerationRequest(valid({ referenceImage })).referenceImage).toBe(referenceImage);
    }
  });
});

describe("lease admission (before any grant)", () => {
  const lease = (overrides: Record<string, unknown> = {}) => ({
    provider: "RUNWAY",
    model: "gen4.5",
    generationRequest: valid(),
    expectedCostCap: { unit: "PROVIDER_CREDITS" as const, amount: 60 },
    ...overrides,
  });

  it("admits the one provider, the one model, the closed request and the issuer's cost unit", () => {
    expect(admitRunwayLease(lease())).toEqual(valid());
  });

  it.each([
    ["another provider", { provider: "BUSYBOOKIE_FAKE" }, "LEASED_PROVIDER_INCOMPATIBLE"],
    ["the Google provider", { provider: "GOOGLE_GENAI" }, "LEASED_PROVIDER_INCOMPATIBLE"],
    ["a lowercase provider", { provider: "runway" }, "LEASED_PROVIDER_INCOMPATIBLE"],
    ["another model", { model: "gen4_turbo" }, "LEASED_PROVIDER_INCOMPATIBLE"],
    ["a padded model", { model: " gen4.5" }, "LEASED_PROVIDER_INCOMPATIBLE"],
    ["an uppercase model", { model: "GEN4.5" }, "LEASED_PROVIDER_INCOMPATIBLE"],
    ["a micro-USD cost cap", { expectedCostCap: { unit: "MICRO_USD", amount: 2_000_000 } }, "LEASED_REQUEST_INVALID"],
    ["a malformed request", { generationRequest: { prompt: "x" } }, "LEASED_REQUEST_INVALID"],
  ])("refuses %s as an issuer or compatibility fault, never a provider or input failure", (_label, overrides, code) => {
    expect(codeOf(() => admitRunwayLease(lease(overrides)))).toBe(code);
  });

  it("never computes a price: any positive issuer amount in provider credits is admitted unchanged", () => {
    for (const amount of [1, 24, 60, 10_000]) expect(admitRunwayLease(lease({ expectedCostCap: { unit: "PROVIDER_CREDITS", amount } }))).toEqual(valid());
  });
});
