import {
  admitGoogleGenerationRequest,
  admitRunwayGenerationRequest,
  canonicalizeGenerationRequest,
  GenerationContractError,
  generationRequestSha256,
  GOOGLE_EXPECTED_COST_CAP_UNIT,
  GOOGLE_MODEL,
  GOOGLE_PROMPT_MAX_CODE_UNITS,
  GOOGLE_PROVIDER_ID,
  GOOGLE_RESOLUTION,
  parseGoogleGenerationRequest,
  parseRunwayGenerationRequest,
  RUNWAY_DURATION_MAX_SECONDS,
  RUNWAY_DURATION_MIN_SECONDS,
  RUNWAY_EXPECTED_COST_CAP_UNIT,
  RUNWAY_MODEL,
  RUNWAY_PROMPT_MAX_CODE_UNITS,
  RUNWAY_PROVIDER_ID,
  type GenerationContractFailureCode,
} from "commercial-worker-protocol";
import { describe, expect, it } from "vitest";

// R44B11A: the shared generation-request authority in the protocol package.
// The closed grammars, the cost units, RFC 8785 canonicalization and the
// canonical SHA-256. Every conformance expectation below is an independently
// pinned literal or a published RFC 8785 expectation, never the output of the
// canonicalizer under test.

const REFERENCE = Object.freeze({ key: "inputs/ref.png", sha256: "a".repeat(64), byteCount: 16, contentType: "image/png" });
const google = (overrides: Record<string, unknown> = {}) => ({ prompt: "A red kite over a quiet harbour.", referenceImage: REFERENCE, resolution: "720p", ...overrides });
const runway = (overrides: Record<string, unknown> = {}) => ({ prompt: "A red kite over a quiet harbour.", referenceImage: REFERENCE, durationSeconds: 5, ...overrides });

// Written by hand (members in UTF-16 order) and hashed outside the code under
// test (sha256sum over these exact UTF-8 bytes).
const GOOGLE_CANONICAL =
  '{"prompt":"A red kite over a quiet harbour.","referenceImage":{"byteCount":16,"contentType":"image/png","key":"inputs/ref.png","sha256":"' +
  "a".repeat(64) +
  '"},"resolution":"720p"}';
const GOOGLE_SHA256 = "29beb243262883d2530f64e22b4de7d2ec145fb527a307856f0383e495c7ce1c";
const RUNWAY_CANONICAL =
  '{"durationSeconds":5,"prompt":"A red kite over a quiet harbour.","referenceImage":{"byteCount":16,"contentType":"image/png","key":"inputs/ref.png","sha256":"' +
  "a".repeat(64) +
  '"}}';
const RUNWAY_SHA256 = "84e74e83e10ba48dfd9a8fc5d1fb89fa77a69cfa3582f03959f9e9d98e1737f3";

const codeOf = (fn: () => unknown): GenerationContractFailureCode => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GenerationContractError);
    return (error as GenerationContractError).code;
  }
  throw new Error("expected a refusal");
};

const googleInput = (overrides: Record<string, unknown> = {}) => ({
  provider: "GOOGLE_GENAI",
  model: "gemini-omni-1.1-flash",
  expectedCostCapUnit: "MICRO_USD",
  generationRequest: google(),
  generationRequestSha256: GOOGLE_SHA256,
  ...overrides,
});
const runwayInput = (overrides: Record<string, unknown> = {}) => ({
  provider: "RUNWAY",
  model: "gen4.5",
  expectedCostCapUnit: "PROVIDER_CREDITS",
  generationRequest: runway(),
  generationRequestSha256: RUNWAY_SHA256,
  ...overrides,
});

describe("locked shared identities", () => {
  it("are exactly the published values", () => {
    expect([GOOGLE_PROVIDER_ID, GOOGLE_MODEL, GOOGLE_PROMPT_MAX_CODE_UNITS, GOOGLE_RESOLUTION, GOOGLE_EXPECTED_COST_CAP_UNIT]).toEqual([
      "GOOGLE_GENAI",
      "gemini-omni-1.1-flash",
      1000,
      "720p",
      "MICRO_USD",
    ]);
    expect([RUNWAY_PROVIDER_ID, RUNWAY_MODEL, RUNWAY_PROMPT_MAX_CODE_UNITS, RUNWAY_DURATION_MIN_SECONDS, RUNWAY_DURATION_MAX_SECONDS, RUNWAY_EXPECTED_COST_CAP_UNIT]).toEqual([
      "RUNWAY",
      "gen4.5",
      1000,
      2,
      5,
      "PROVIDER_CREDITS",
    ]);
  });
});

describe.each([
  ["Google", parseGoogleGenerationRequest as (value: unknown) => unknown, google],
  ["Runway", parseRunwayGenerationRequest as (value: unknown) => unknown, runway],
] as const)("closed %s request grammar", (_name, parse, valid) => {
  it("accepts a valid request unchanged and frozen, passing the reference through by identity", () => {
    const parsed = parse(valid()) as Readonly<Record<string, unknown>>;
    expect(parsed).toEqual(valid());
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parsed.referenceImage).toBe(REFERENCE);
  });

  it("accepts a prompt of exactly 1000 UTF-16 code units, a surrogate pair counting as two", () => {
    expect(parse(valid({ prompt: "p".repeat(1000) }))).toBeTruthy();
    expect(parse(valid({ prompt: "\u{1F3AC}".repeat(500) }))).toBeTruthy();
    expect(parse(valid({ prompt: "x" }))).toBeTruthy();
  });

  it.each([
    ["an empty prompt", { prompt: "" }],
    ["a 1001-code-unit prompt", { prompt: "p".repeat(1001) }],
    ["a 1001-code-unit astral prompt", { prompt: `${"\u{1F3AC}".repeat(500)}p` }],
    ["leading whitespace", { prompt: " A kite." }],
    ["trailing whitespace", { prompt: "A kite. " }],
    ["a trailing newline", { prompt: "A kite.\n" }],
    ["a leading no-break space", { prompt: " A kite." }],
    ["a non-string prompt", { prompt: 7 }],
  ])("refuses %s without trimming or repairing it", (_label, overrides) => {
    expect(codeOf(() => parse(valid(overrides)))).toBe("REQUEST_INVALID");
  });

  it("refuses an unknown member, a missing member and a request that is not a plain object", () => {
    expect(codeOf(() => parse({ ...valid(), seed: 7 }))).toBe("REQUEST_INVALID");
    const { referenceImage: _dropped, ...missing } = valid();
    for (const value of [missing, null, undefined, "request", 7, [valid()], Object.create(null), new Map()]) {
      expect(codeOf(() => parse(value))).toBe("REQUEST_INVALID");
    }
  });

  it("does not parse the reference grammar: a malformed reference is passed through untouched", () => {
    for (const referenceImage of [{ key: "../escape" }, " inputs/ref.png ", null, 7, []]) {
      expect((parse(valid({ referenceImage })) as { referenceImage: unknown }).referenceImage).toBe(referenceImage);
    }
  });
});

describe("Google resolution and Runway duration", () => {
  it("accepts exactly 720p", () => {
    for (const resolution of ["1080p", "720P", " 720p", "720p ", 720, null]) {
      expect(codeOf(() => parseGoogleGenerationRequest(google({ resolution })))).toBe("REQUEST_INVALID");
    }
  });

  it.each([2, 3, 4, 5])("accepts the integer duration %i", (durationSeconds) => {
    expect(parseRunwayGenerationRequest(runway({ durationSeconds })).durationSeconds).toBe(durationSeconds);
  });

  it.each([
    ["below the minimum", 1],
    ["zero", 0],
    ["above the maximum", 6],
    ["the provider's own 10-second maximum", 10],
    ["a non-integer", 4.5],
    ["a near-integer", 5.000001],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["a string", "5"],
  ])("refuses a duration %s", (_label, durationSeconds) => {
    expect(codeOf(() => parseRunwayGenerationRequest(runway({ durationSeconds })))).toBe("REQUEST_INVALID");
  });
});

describe("RFC 8785 canonicalization", () => {
  it("matches the published RFC 8785 section 3.2.3 property-sorting vector: raw UTF-16 code-unit order", () => {
    // Input order as published; the expected order is the RFC's.
    const input = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      "דּ": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "\u0080": "Control",
      "ö": "Latin Small Letter O With Diaeresis",
    };
    expect(canonicalizeGenerationRequest(input)).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    );
    // The emoji (a surrogate pair, D83D...) sorts before U+FB33 by UTF-16 code
    // units, but after it by UTF-8 bytes (F0... > EF...) and by code point: the
    // vector separates UTF-16 order from those orders and from insertion order.
    expect(Buffer.compare(Buffer.from("😀", "utf8"), Buffer.from("דּ", "utf8"))).toBe(1);
    // Insertion (enumeration) order puts the Euro sign before the carriage return; the canonical order does not.
    const enumerated = Object.keys(input);
    expect(enumerated.indexOf(String.fromCharCode(0x20ac))).toBeLessThan(enumerated.indexOf(String.fromCharCode(13)));
  });

  it("matches the published RFC 8785 section 3.2.2 example, its UTF-8 bytes hashing to an independently computed SHA-256", () => {
    const input = {
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      // The published input string (U+20AC, $, U+000F, LF, A, apostrophe, B, quote, two reverse solidi, quote, solidus).
      string: String.fromCharCode(0x20ac, 0x24, 0x0f, 0x0a, 0x41, 0x27, 0x42, 0x22, 0x5c, 0x5c, 0x22, 0x2f),
      literals: [null, true, false],
    };
    const expected = String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`;
    expect(canonicalizeGenerationRequest(input)).toBe(expected);
    expect(generationRequestSha256(input)).toBe("2d5e01a318d0f0879ab568c4be289c8b1f64ef8921a53c6277d5e069978baacb");
  });

  // RFC 8785 Appendix B: IEEE-754 bit patterns and their published serialisations.
  it.each([
    ["0000000000000000", "0"],
    ["8000000000000000", "0"],
    ["0000000000000001", "5e-324"],
    ["8000000000000001", "-5e-324"],
    ["7fefffffffffffff", "1.7976931348623157e+308"],
    ["ffefffffffffffff", "-1.7976931348623157e+308"],
    ["4340000000000000", "9007199254740992"],
    ["c340000000000000", "-9007199254740992"],
    ["4430000000000000", "295147905179352830000"],
    ["44b52d02c7e14af5", "9.999999999999997e+22"],
    ["44b52d02c7e14af6", "1e+23"],
    ["44b52d02c7e14af7", "1.0000000000000001e+23"],
    ["444b1ae4d6e2ef4e", "999999999999999700000"],
    ["444b1ae4d6e2ef4f", "999999999999999900000"],
    ["444b1ae4d6e2ef50", "1e+21"],
    ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
    ["3eb0c6f7a0b5ed8d", "0.000001"],
    ["41b3de4355555553", "333333333.3333332"],
    ["41b3de4355555554", "333333333.33333325"],
    ["41b3de4355555555", "333333333.3333333"],
    ["41b3de4355555556", "333333333.3333334"],
    ["41b3de4355555557", "333333333.33333343"],
    ["becbf647612f3696", "-0.0000033333333333333333"],
    ["43143ff3c1cb0959", "1424953923781206.2"],
  ])("serialises the IEEE-754 value %s as %s", (bits, expected) => {
    expect(canonicalizeGenerationRequest(Buffer.from(bits, "hex").readDoubleBE(0))).toBe(expected);
  });

  it("serialises negative zero as 0, and the exponent and trailing-zero boundaries", () => {
    expect(canonicalizeGenerationRequest({ a: -0 })).toBe('{"a":0}');
    expect(canonicalizeGenerationRequest([1e21, 1e20, 1e-7, 1e-6, 4.5, 4.0, 2e-3, 100, -1.5e-10])).toBe("[1e+21,100000000000000000000,1e-7,0.000001,4.5,4,0.002,100,-1.5e-10]");
  });

  it("orders members independently of insertion order, recursively, and preserves array order", () => {
    const left = { b: { y: 1, x: [3, 1, 2] }, a: { d: true, c: null } };
    const right = { a: { c: null, d: true }, b: { x: [3, 1, 2], y: 1 } };
    const expected = '{"a":{"c":null,"d":true},"b":{"x":[3,1,2],"y":1}}';
    expect(canonicalizeGenerationRequest(left)).toBe(expected);
    expect(canonicalizeGenerationRequest(right)).toBe(expected);
    expect(canonicalizeGenerationRequest([{ b: 1, a: 2 }, [2, 1]])).toBe('[{"a":2,"b":1},[2,1]]');
  });

  it("emits non-ASCII literally and escapes only the quotation mark, reverse solidus and controls", () => {
    expect(canonicalizeGenerationRequest({ s: "Café ☕ \u{1F3AC} 日本" })).toBe('{"s":"Café ☕ \u{1F3AC} 日本"}');
    expect(canonicalizeGenerationRequest("\"\\/\b\f\n\r\t\u0000\u001f\u007f ")).toBe('"\\"\\\\/\\b\\f\\n\\r\\t\\u0000\\u001f\u007f "');
    // The UTF-8 bytes 22 43 61 66 c3 a9 22, hashed outside the code under test.
    expect(generationRequestSha256("Café")).toBe("e5e78ae5b702f7fbf134a768c5324df629488749e33950e746131273be7e0e9e");
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a lone high surrogate in a value", { s: "a\ud83d" }],
    ["a lone low surrogate in a value", { s: "\ude00b" }],
    ["reversed surrogates in a value", { s: "\ude00\ud83d" }],
    ["a lone surrogate in a member name", { "k\ud800": 1 }],
    ["undefined", undefined],
    ["an undefined member", { a: undefined }],
    ["a function", { a: () => 1 }],
    ["a symbol", { a: Symbol("s") }],
    ["a bigint", { a: 1n }],
    ["a symbol-keyed member", { [Symbol("s")]: 1 }],
    ["a Date", { a: new Date(0) }],
    ["a Map", new Map()],
    ["a null-prototype object", Object.create(null) as object],
    ["a class instance", new (class Box {})()],
    ["a sparse array", [1, , 3]],
    ["a typed array", new Uint8Array(2)],
  ])("fails closed on %s", (_label, value) => {
    expect(codeOf(() => canonicalizeGenerationRequest(value))).toBe("VALUE_NOT_CANONICALIZABLE");
  });

  it("never invokes toJSON, refuses accessors and refuses cycles", () => {
    let calls = 0;
    const withToJson = { a: 1, toJSON: () => (calls += 1) };
    expect(codeOf(() => canonicalizeGenerationRequest(withToJson))).toBe("VALUE_NOT_CANONICALIZABLE");
    expect(calls).toBe(0);
    const accessor = Object.defineProperty({}, "a", { enumerable: true, get: () => (calls += 1) });
    expect(codeOf(() => canonicalizeGenerationRequest(accessor))).toBe("VALUE_NOT_CANONICALIZABLE");
    expect(calls).toBe(0);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(codeOf(() => canonicalizeGenerationRequest(cycle))).toBe("VALUE_NOT_CANONICALIZABLE");
    // A repeated, non-cyclic value is fine.
    const shared = { k: 1 };
    expect(canonicalizeGenerationRequest({ a: shared, b: shared })).toBe('{"a":{"k":1},"b":{"k":1}}');
  });
});

describe("canonical generation-request hash", () => {
  it("is the stable lowercase SHA-256 of the pinned canonical text", () => {
    expect(canonicalizeGenerationRequest(google())).toBe(GOOGLE_CANONICAL);
    expect(generationRequestSha256(google())).toBe(GOOGLE_SHA256);
    expect(canonicalizeGenerationRequest(runway())).toBe(RUNWAY_CANONICAL);
    expect(generationRequestSha256(runway())).toBe(RUNWAY_SHA256);
    expect(GOOGLE_SHA256).toMatch(/^[0-9a-f]{64}$/);
    // Insertion order does not matter.
    const reordered = { resolution: "720p", referenceImage: { contentType: "image/png", byteCount: 16, sha256: "a".repeat(64), key: "inputs/ref.png" }, prompt: "A red kite over a quiet harbour." };
    expect(generationRequestSha256(reordered)).toBe(GOOGLE_SHA256);
  });

  it("includes the exact referenceImage value: any change to it changes the hash", () => {
    for (const referenceImage of [
      { ...REFERENCE, key: "inputs/ref2.png" },
      { ...REFERENCE, key: " inputs/ref.png" },
      { ...REFERENCE, byteCount: 17 },
      { ...REFERENCE, contentType: "image/PNG" },
      { ...REFERENCE, extra: null },
      "inputs/ref.png",
    ]) {
      expect(generationRequestSha256(google({ referenceImage }))).not.toBe(GOOGLE_SHA256);
    }
  });

  it("changes when any request member changes", () => {
    expect(generationRequestSha256(google({ prompt: "A red kite over a quiet harbour!" }))).not.toBe(GOOGLE_SHA256);
    expect(generationRequestSha256(runway({ durationSeconds: 4 }))).not.toBe(RUNWAY_SHA256);
  });
});

describe.each([
  ["Google", admitGoogleGenerationRequest as (input: never) => unknown, googleInput, google],
  ["Runway", admitRunwayGenerationRequest as (input: never) => unknown, runwayInput, runway],
] as const)("%s admission", (_name, admitFn, input, valid) => {
  const admit = (value: Record<string, unknown>) => admitFn(value as never);

  it("admits the exact canonical hash and returns the validated request", () => {
    expect(admit(input())).toEqual(valid());
  });

  it("refuses a wrong, uppercase or mutated-after-hashing request hash", () => {
    expect(codeOf(() => admit(input({ generationRequestSha256: "0".repeat(64) })))).toBe("REQUEST_HASH_MISMATCH");
    expect(codeOf(() => admit(input({ generationRequestSha256: (input().generationRequestSha256 as string).toUpperCase() })))).toBe("REQUEST_HASH_MISMATCH");
    expect(codeOf(() => admit(input({ generationRequest: valid({ prompt: "A red kite over a quiet harbour, mutated." }) })))).toBe("REQUEST_HASH_MISMATCH");
  });

  it("checks in the locked order: provider/model, cost unit, grammar, then the hash", () => {
    const wrongHash = { generationRequestSha256: "0".repeat(64) };
    expect(codeOf(() => admit(input({ ...wrongHash, provider: "OTHER", expectedCostCapUnit: "OTHER", generationRequest: { x: 1 } })))).toBe("PROVIDER_MODEL_UNSUPPORTED");
    expect(codeOf(() => admit(input({ ...wrongHash, model: "other", expectedCostCapUnit: "OTHER", generationRequest: { x: 1 } })))).toBe("PROVIDER_MODEL_UNSUPPORTED");
    expect(codeOf(() => admit(input({ ...wrongHash, expectedCostCapUnit: "OTHER", generationRequest: { x: 1 } })))).toBe("COST_UNIT_INCOMPATIBLE");
    expect(codeOf(() => admit(input({ ...wrongHash, generationRequest: { x: 1 } })))).toBe("REQUEST_INVALID");
  });

  it("admits a malformed reference with its exact hash: inner reference grammar is not judged here", () => {
    const request = valid({ referenceImage: { key: "../escape" } });
    expect(admit(input({ generationRequest: request, generationRequestSha256: generationRequestSha256(request) }))).toEqual(request);
  });

  it("refuses a lone surrogate anywhere in the request, including inside the reference", () => {
    const inReference = valid({ referenceImage: { key: "inputs/\ud800.png" } });
    expect(codeOf(() => admit(input({ generationRequest: inReference, generationRequestSha256: "0".repeat(64) })))).toBe("VALUE_NOT_CANONICALIZABLE");
    const inPrompt = valid({ prompt: "A kite \udc00." });
    expect(codeOf(() => admit(input({ generationRequest: inPrompt, generationRequestSha256: "0".repeat(64) })))).toBe("VALUE_NOT_CANONICALIZABLE");
  });

  it("never echoes request content in a refusal", () => {
    try {
      admit(input({ generationRequestSha256: "0".repeat(64) }));
    } catch (error) {
      expect(String((error as Error).message)).not.toMatch(/kite|inputs|0000/);
      expect((error as Error).cause).toBeUndefined();
    }
  });
});

// R44B11A correction: the closed root grammar is judged from own property
// descriptors before any member is read. A root structure outside the JSON
// data domain is refused, never projected away before hashing, and no getter
// runs. Each admission below carries the pinned hash of the valid projection,
// so a parser that dropped the structure would admit it.
describe.each([
  ["Google", parseGoogleGenerationRequest as (value: unknown) => unknown, admitGoogleGenerationRequest as (input: never) => unknown, googleInput, google, ["prompt", "referenceImage", "resolution"]],
  ["Runway", parseRunwayGenerationRequest as (value: unknown) => unknown, admitRunwayGenerationRequest as (input: never) => unknown, runwayInput, runway, ["prompt", "referenceImage", "durationSeconds"]],
] as const)("%s root request structure", (_name, parse, admitFn, input, valid, required) => {
  const admit = (value: Record<string, unknown>) => admitFn(value as never);
  const refusedEverywhere = (request: object) => {
    expect(codeOf(() => parse(request))).toBe("VALUE_NOT_CANONICALIZABLE");
    expect(codeOf(() => admit(input({ generationRequest: request })))).toBe("VALUE_NOT_CANONICALIZABLE");
  };

  it("refuses an extra symbol-keyed own member instead of dropping it", () => {
    const request = { ...valid(), [Symbol("extra")]: "hidden" };
    expect(Object.getOwnPropertySymbols(request)).toHaveLength(1);
    refusedEverywhere(request);
  });

  it("refuses an extra non-enumerable own member instead of dropping it", () => {
    const request = Object.defineProperty(valid(), "hidden", { value: "x", enumerable: false, configurable: true, writable: true });
    expect(Object.keys(request).sort()).toEqual([...required].sort());
    refusedEverywhere(request);
  });

  it("refuses a non-enumerable required member", () => {
    for (const member of required) {
      const request: Record<string, unknown> = valid();
      Object.defineProperty(request, member, { value: request[member], enumerable: false, configurable: true, writable: true });
      refusedEverywhere(request);
    }
  });

  it.each(required)("refuses an accessor-backed %s without ever invoking its getter", (member) => {
    const data: Record<string, unknown> = valid();
    let calls = 0;
    const request: Record<string, unknown> = valid();
    Object.defineProperty(request, member, {
      enumerable: true,
      configurable: true,
      get: () => {
        calls += 1;
        return data[member];
      },
    });
    refusedEverywhere(request);
    expect(calls).toBe(0);
  });

  it("refuses an accessor-backed referenceImage returning the exact valid reference, with zero getter calls", () => {
    let calls = 0;
    const request = Object.defineProperty({ ...valid(), referenceImage: undefined }, "referenceImage", {
      enumerable: true,
      configurable: true,
      get: () => {
        calls += 1;
        return REFERENCE;
      },
    });
    refusedEverywhere(request);
    expect(calls).toBe(0);
  });

  it("still admits an ordinary JSON-decoded request under its pinned hash, preserving the reference by identity", () => {
    const decoded = JSON.parse(JSON.stringify(valid())) as Record<string, unknown>;
    const parsed = parse(decoded) as Readonly<Record<string, unknown>>;
    expect(parsed.referenceImage).toBe(decoded.referenceImage);
    const admitted = admit(input({ generationRequest: decoded })) as Readonly<Record<string, unknown>>;
    expect(admitted).toEqual(valid());
    expect(admitted.referenceImage).toBe(decoded.referenceImage);
    expect(Object.isFrozen(admitted)).toBe(true);
  });

  it("keeps the reference's inner grammar unjudged: only the root structure moved, not R44B10P1 validation", () => {
    // A malformed but JSON-shaped reference still parses and, with its exact hash, admits.
    const malformed = valid({ referenceImage: { key: "../escape", extra: [1, 2] } });
    expect((parse(malformed) as { referenceImage: unknown }).referenceImage).toBe(malformed.referenceImage);
    expect(admit(input({ generationRequest: malformed, generationRequestSha256: generationRequestSha256(malformed) }))).toEqual(malformed);
    // An accessor inside the reference is not inspected by the closed parser (no getter call);
    // only the canonical hash, which judges JSON structure and never runs it, refuses it.
    let calls = 0;
    const inner = Object.defineProperty({}, "key", {
      enumerable: true,
      get: () => {
        calls += 1;
        return "inputs/ref.png";
      },
    });
    const withInnerAccessor = valid({ referenceImage: inner });
    expect((parse(withInnerAccessor) as { referenceImage: unknown }).referenceImage).toBe(inner);
    expect(codeOf(() => admit(input({ generationRequest: withInnerAccessor })))).toBe("VALUE_NOT_CANONICALIZABLE");
    expect(calls).toBe(0);
  });
});
