import { describe, expect, it } from "vitest";

import {
  admitGoogleLease,
  GOOGLE_API_BASE_URL,
  GOOGLE_API_VERSION,
  GOOGLE_CREATE_MAX_RETRIES,
  GOOGLE_CREATE_TIMEOUT_MS,
  GOOGLE_EXPECTED_COST_CAP_UNIT,
  GOOGLE_INTERACTION_FLAGS,
  GOOGLE_MAX_REFERENCE_IMAGE_BYTES,
  GOOGLE_MODEL,
  GOOGLE_PROMPT_MAX_CODE_UNITS,
  GOOGLE_PROVIDER_ID,
  GOOGLE_RESOLUTION,
  GOOGLE_RESPONSE_FORMAT,
  parseGoogleGenerationRequest,
} from "../src/googleProviderContract.js";
import { WorkerError } from "../src/workerError.js";

// R44B10A: the closed first real-provider contract and its admission parser.
// Pure: no SDK, network, credential, storage or environment.

const REFERENCE = Object.freeze({ key: "inputs/ref.png", sha256: "a".repeat(64), byteCount: 16, contentType: "image/png" });
const valid = (overrides: Record<string, unknown> = {}) => ({ prompt: "A red kite over a quiet harbour.", referenceImage: REFERENCE, resolution: "720p", ...overrides });

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(WorkerError);
    return (error as WorkerError).code;
  }
  throw new Error("expected a refusal");
};

describe("locked first-slice constants", () => {
  it("are exactly the published values", () => {
    expect(GOOGLE_PROVIDER_ID).toBe("GOOGLE_GENAI");
    expect(GOOGLE_MODEL).toBe("gemini-omni-1.1-flash");
    expect(GOOGLE_PROMPT_MAX_CODE_UNITS).toBe(1000);
    expect(GOOGLE_RESOLUTION).toBe("720p");
    expect(GOOGLE_MAX_REFERENCE_IMAGE_BYTES).toBe(10_485_760);
    expect(GOOGLE_CREATE_TIMEOUT_MS).toBe(60000);
    expect(GOOGLE_CREATE_MAX_RETRIES).toBe(0);
    expect(GOOGLE_API_BASE_URL).toBe("https://generativelanguage.googleapis.com/");
    expect(GOOGLE_API_VERSION).toBe("v1beta");
    expect(GOOGLE_RESPONSE_FORMAT).toEqual({ type: "video", delivery: "uri", resolution: "720p" });
    expect(GOOGLE_INTERACTION_FLAGS).toEqual({ background: true, store: true, stream: false });
    expect(GOOGLE_EXPECTED_COST_CAP_UNIT).toBe("MICRO_USD");
    expect(Object.isFrozen(GOOGLE_RESPONSE_FORMAT) && Object.isFrozen(GOOGLE_INTERACTION_FLAGS)).toBe(true);
  });
});

describe("closed generation request parser", () => {
  it("accepts exactly the three members and returns them unchanged and frozen", () => {
    const parsed = parseGoogleGenerationRequest(valid());
    expect(parsed).toEqual(valid());
    expect(Object.isFrozen(parsed)).toBe(true);
    // The reference member is passed through untouched for the R44B10P1 parser at retrieval.
    expect(parsed.referenceImage).toBe(REFERENCE);
  });

  it("accepts a prompt of exactly 1000 UTF-16 code units, including surrogate pairs counted as two", () => {
    expect(parseGoogleGenerationRequest(valid({ prompt: "p".repeat(1000) })).prompt).toHaveLength(1000);
    const astral = "\u{1F3AC}".repeat(500);
    expect(astral.length).toBe(1000);
    expect(parseGoogleGenerationRequest(valid({ prompt: astral })).prompt).toBe(astral);
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
    ["a 1080p resolution", { resolution: "1080p" }],
    ["a 360p resolution", { resolution: "360p" }],
    ["a 4k resolution", { resolution: "4k" }],
    ["an uppercase resolution", { resolution: "720P" }],
    ["a padded resolution", { resolution: " 720p" }],
    ["a numeric resolution", { resolution: 720 }],
  ])("refuses %s without repairing it", (_label, overrides) => {
    expect(codeOf(() => parseGoogleGenerationRequest(valid(overrides)))).toBe("LEASED_REQUEST_INVALID");
  });

  it.each(["duration", "aspectRatio", "seed", "audio", "negativePrompt", "options", "responseFormat", "model", "tools", "url", "sourceImagePath"])(
    "refuses the unknown member %s",
    (member) => {
      expect(codeOf(() => parseGoogleGenerationRequest({ ...valid(), [member]: "x" }))).toBe("LEASED_REQUEST_INVALID");
    },
  );

  it("refuses a missing member, and a request that is not a plain object", () => {
    const { referenceImage: _omitted, ...missingReference } = valid();
    const { resolution: _also, ...missingResolution } = valid();
    for (const value of [missingReference, missingResolution, null, undefined, "prompt", 7, [valid()], Object.create(null), new Map()]) {
      expect(codeOf(() => parseGoogleGenerationRequest(value))).toBe("LEASED_REQUEST_INVALID");
    }
  });

  it("does not judge the reference grammar: a malformed reference is an R44B10P2 input failure after the grant", () => {
    for (const referenceImage of [{ key: "../escape" }, "inputs/ref.png", null, 7]) {
      expect(parseGoogleGenerationRequest(valid({ referenceImage })).referenceImage).toBe(referenceImage);
    }
  });
});

// The canonical hash of valid(), pinned independently of the code under test
// (sha256sum over its hand-written RFC 8785 text).
const VALID_SHA256 = "29beb243262883d2530f64e22b4de7d2ec145fb527a307856f0383e495c7ce1c";

describe("lease admission (before any grant)", () => {
  const lease = (overrides: Record<string, unknown> = {}) => ({
    provider: "GOOGLE_GENAI",
    model: "gemini-omni-1.1-flash",
    generationRequest: valid(),
    generationRequestSha256: VALID_SHA256,
    expectedCostCap: { unit: "MICRO_USD" as const, amount: 2_000_000 },
    ...overrides,
  });

  it("admits the one provider, the one model, the closed request, the issuer's cost unit and the exact canonical hash", () => {
    expect(admitGoogleLease(lease())).toEqual(valid());
  });

  // R44B11A: every shared refusal maps onto the existing worker codes.
  it.each([
    ["an incorrect lowercase hash", { generationRequestSha256: "0".repeat(64) }],
    ["the uppercase form of the right hash", { generationRequestSha256: VALID_SHA256.toUpperCase() }],
    ["a request mutated after hashing", { generationRequest: valid({ prompt: "A red kite over a quiet harbour, mutated." }) }],
    ["a reference mutated after hashing", { generationRequest: valid({ referenceImage: { ...REFERENCE, key: "inputs/other.png" } }) }],
    ["a lone surrogate inside the reference", { generationRequest: valid({ referenceImage: { ...REFERENCE, key: `inputs/${String.fromCharCode(0xd800)}.png` } }) }],
  ])("refuses %s as LEASED_REQUEST_INVALID", (_label, overrides) => {
    expect(codeOf(() => admitGoogleLease(lease(overrides)))).toBe("LEASED_REQUEST_INVALID");
  });

  it("keeps the incompatibility, grammar and cost-unit codes even when the hash is also wrong", () => {
    const wrong = { generationRequestSha256: "0".repeat(64) };
    expect(codeOf(() => admitGoogleLease(lease({ ...wrong, provider: "RUNWAY" })))).toBe("LEASED_PROVIDER_INCOMPATIBLE");
    expect(codeOf(() => admitGoogleLease(lease({ ...wrong, model: "gemini-omni-1.1-pro" })))).toBe("LEASED_PROVIDER_INCOMPATIBLE");
    expect(codeOf(() => admitGoogleLease(lease({ ...wrong, generationRequest: { prompt: "x" } })))).toBe("LEASED_REQUEST_INVALID");
    expect(codeOf(() => admitGoogleLease(lease({ ...wrong, expectedCostCap: { unit: "PROVIDER_CREDITS", amount: 10 } })))).toBe("LEASED_REQUEST_INVALID");
  });

  it("does not parse the reference grammar: a malformed reference with its exact hash is admitted", () => {
    // sha256sum of {"prompt":"A red kite over a quiet harbour.","referenceImage":{"key":"../escape"},"resolution":"720p"}
    const malformed = valid({ referenceImage: { key: "../escape" } });
    expect(admitGoogleLease(lease({ generationRequest: malformed, generationRequestSha256: "0a4000c2780cfe9961a348ae2db9a913036e8e354dd0274b41356ea1e5d67eb7" }))).toEqual(malformed);
  });

  it.each([
    ["another provider", { provider: "BUSYBOOKIE_FAKE" }, "LEASED_PROVIDER_INCOMPATIBLE"],
    ["a Runway-style provider", { provider: "RUNWAY" }, "LEASED_PROVIDER_INCOMPATIBLE"],
    ["another model", { model: "gemini-omni-1.1-pro" }, "LEASED_PROVIDER_INCOMPATIBLE"],
    ["a padded model", { model: " gemini-omni-1.1-flash" }, "LEASED_PROVIDER_INCOMPATIBLE"],
    ["a provider-credit cost cap", { expectedCostCap: { unit: "PROVIDER_CREDITS", amount: 10 } }, "LEASED_REQUEST_INVALID"],
    ["a malformed request", { generationRequest: { prompt: "x" } }, "LEASED_REQUEST_INVALID"],
  ])("refuses %s as an issuer or compatibility fault, never a provider or input failure", (_label, overrides, code) => {
    expect(codeOf(() => admitGoogleLease(lease(overrides)))).toBe(code);
  });
});
