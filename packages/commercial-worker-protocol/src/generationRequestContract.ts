import { createHash } from "node:crypto";

// The shared generation-request authority (R44B11A;
// docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md, "Shared
// generation-request contract and canonical-hash authority"). The single
// issuer/worker copy of the locked provider/model identities, the closed
// request grammars, the expected-cost units and the canonical request hash.
// Pure: no provider SDK, network, database, environment, filesystem,
// credential implementation or worker type. Adapter-only values (origins, API
// versions, timeouts, retries, output settings, byte ceilings) stay with the
// worker adapters.

export const GOOGLE_PROVIDER_ID = "GOOGLE_GENAI";
export const GOOGLE_MODEL = "gemini-omni-1.1-flash";
export const GOOGLE_PROMPT_MAX_CODE_UNITS = 1000;
export const GOOGLE_RESOLUTION = "720p";
export const GOOGLE_EXPECTED_COST_CAP_UNIT = "MICRO_USD";

export const RUNWAY_PROVIDER_ID = "RUNWAY";
export const RUNWAY_MODEL = "gen4.5";
export const RUNWAY_PROMPT_MAX_CODE_UNITS = 1000;
export const RUNWAY_DURATION_MIN_SECONDS = 2;
export const RUNWAY_DURATION_MAX_SECONDS = 5;
export const RUNWAY_EXPECTED_COST_CAP_UNIT = "PROVIDER_CREDITS";

// referenceImage stays the untrusted, opaque member: its inner grammar is the
// R44B10P1 parser's, applied after the credential grant, so a malformed
// reference is an R44B10P2 input failure, never a contract failure here.
export type GoogleGenerationRequest = Readonly<{
  prompt: string;
  referenceImage: unknown;
  resolution: typeof GOOGLE_RESOLUTION;
}>;

export type RunwayGenerationRequest = Readonly<{
  prompt: string;
  referenceImage: unknown;
  durationSeconds: number;
}>;

export type GenerationContractFailureCode =
  // Not the provider and model this contract admits.
  | "PROVIDER_MODEL_UNSUPPORTED"
  // Outside the closed request grammar.
  | "REQUEST_INVALID"
  // The expected-cost cap is not in this provider's unit.
  | "COST_UNIT_INCOMPATIBLE"
  // A value outside the JSON/JCS domain, which no issuer could have hashed.
  | "VALUE_NOT_CANONICALIZABLE"
  // The recomputed canonical hash differs from the issued hash.
  | "REQUEST_HASH_MISMATCH";

const MESSAGES: Readonly<Record<GenerationContractFailureCode, string>> = {
  PROVIDER_MODEL_UNSUPPORTED: "The provider and model are not supported by this generation contract.",
  REQUEST_INVALID: "The generation request is outside the closed contract.",
  COST_UNIT_INCOMPATIBLE: "The expected-cost unit is not compatible with the provider.",
  VALUE_NOT_CANONICALIZABLE: "The generation request cannot be canonicalized.",
  REQUEST_HASH_MISMATCH: "The generation request does not match its issued hash.",
};

// Fixed messages and no cause: the code is the whole diagnostic, and no
// request value is ever echoed.
export class GenerationContractError extends Error {
  override readonly name = "GenerationContractError";

  constructor(readonly code: GenerationContractFailureCode) {
    super(MESSAGES[code]);
  }
}

function fail(code: GenerationContractFailureCode): never {
  throw new GenerationContractError(code);
}

const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const EDGE_WHITESPACE = /^\s|\s$/;
const GOOGLE_REQUEST_MEMBERS = Object.freeze(["prompt", "referenceImage", "resolution"]);
const RUNWAY_REQUEST_MEMBERS = Object.freeze(["durationSeconds", "prompt", "referenceImage"]);

// Every own member of an object, read from its property descriptor so no
// getter ever runs. Only enumerable string-keyed data members are JSON data: a
// symbol key, an accessor or a hidden (non-enumerable) member is refused
// rather than silently dropped.
function ownDataMembers(value: object): Map<string, unknown> {
  const members = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) {
      return fail("VALUE_NOT_CANONICALIZABLE");
    }
    members.set(key, descriptor.value);
  }
  return members;
}

// Exactly the named members (sorted), no more and no fewer, as data values.
// The request's structure is judged from its descriptors before any member is
// read, so nothing is projected away before the canonical hash.
function closedMembers(value: unknown, names: readonly string[]): ReadonlyMap<string, unknown> {
  if (!isPlainObject(value)) return fail("REQUEST_INVALID");
  const members = ownDataMembers(value);
  const present = [...members.keys()].sort();
  if (present.length !== names.length || present.some((name, index) => name !== names[index])) fail("REQUEST_INVALID");
  return members;
}

// Non-empty, at most the limit in UTF-16 code units, no edge whitespace.
// Never trimmed: an edge space is refused, not repaired.
function validPrompt(prompt: unknown, maxCodeUnits: number): string {
  if (typeof prompt !== "string" || prompt.length === 0 || prompt.length > maxCodeUnits || EDGE_WHITESPACE.test(prompt)) return fail("REQUEST_INVALID");
  return prompt;
}

// Exactly { prompt, referenceImage, resolution }; returned unchanged and frozen.
export function parseGoogleGenerationRequest(value: unknown): GoogleGenerationRequest {
  const members = closedMembers(value, GOOGLE_REQUEST_MEMBERS);
  const checked = validPrompt(members.get("prompt"), GOOGLE_PROMPT_MAX_CODE_UNITS);
  const referenceImage = members.get("referenceImage");
  if (members.get("resolution") !== GOOGLE_RESOLUTION) fail("REQUEST_INVALID");
  return Object.freeze({ prompt: checked, referenceImage, resolution: GOOGLE_RESOLUTION });
}

// Exactly { prompt, referenceImage, durationSeconds }; returned unchanged and frozen.
export function parseRunwayGenerationRequest(value: unknown): RunwayGenerationRequest {
  const members = closedMembers(value, RUNWAY_REQUEST_MEMBERS);
  const checked = validPrompt(members.get("prompt"), RUNWAY_PROMPT_MAX_CODE_UNITS);
  const referenceImage = members.get("referenceImage");
  const durationSeconds = members.get("durationSeconds");
  if (
    typeof durationSeconds !== "number" ||
    !Number.isInteger(durationSeconds) ||
    durationSeconds < RUNWAY_DURATION_MIN_SECONDS ||
    durationSeconds > RUNWAY_DURATION_MAX_SECONDS
  ) {
    return fail("REQUEST_INVALID");
  }
  return Object.freeze({ prompt: checked, referenceImage, durationSeconds });
}

// True when every surrogate code unit is part of a high-low pair.
function isWellFormed(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

// RFC 8785 string form: for a well-formed string, ECMAScript JSON string
// serialisation is exactly the JCS escaping (only the quotation mark, the
// reverse solidus and the controls below U+0020 are escaped; everything else
// is emitted literally).
function canonicalString(text: string): string {
  if (!isWellFormed(text)) fail("VALUE_NOT_CANONICALIZABLE");
  return JSON.stringify(text);
}

// Raw UTF-16 code-unit order, never locale collation.
const byCodeUnits = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

function canonicalValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) fail("VALUE_NOT_CANONICALIZABLE");
      // ECMAScript number-to-string, which RFC 8785 adopts; -0 is 0.
      return Object.is(value, -0) ? "0" : String(value);
    case "string":
      return canonicalString(value);
    case "object":
      break;
    default:
      // undefined, function, symbol and bigint are outside the JSON domain.
      return fail("VALUE_NOT_CANONICALIZABLE");
  }
  if (ancestors.has(value)) fail("VALUE_NOT_CANONICALIZABLE");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) fail("VALUE_NOT_CANONICALIZABLE");
      const keys = Reflect.ownKeys(value).filter((key) => key !== "length");
      // Dense and index-only: a hole or any extra own property is refused.
      if (keys.length !== value.length) fail("VALUE_NOT_CANONICALIZABLE");
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (descriptor === undefined || !("value" in descriptor)) return fail("VALUE_NOT_CANONICALIZABLE");
        items.push(canonicalValue(descriptor.value, ancestors));
      }
      return `[${items.join(",")}]`;
    }
    if (!isPlainObject(value)) return fail("VALUE_NOT_CANONICALIZABLE");
    // Only enumerable string-keyed data members; no symbol keys or accessors, and toJSON is never invoked.
    const members = ownDataMembers(value);
    const names = [...members.keys()].sort(byCodeUnits);
    return `{${names.map((name) => `${canonicalString(name)}:${canonicalValue(members.get(name), ancestors)}`).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

// The RFC 8785 JSON Canonicalization Scheme text of a JSON-domain value.
// Anything outside that domain fails closed with VALUE_NOT_CANONICALIZABLE.
export function canonicalizeGenerationRequest(value: unknown): string {
  return canonicalValue(value, new Set());
}

// Lowercase hexadecimal SHA-256 of the UTF-8 bytes of the canonical text:
// the generation_request_sha256 recipe.
export function generationRequestSha256(value: unknown): string {
  return createHash("sha256").update(canonicalizeGenerationRequest(value), "utf8").digest("hex");
}

// The authoritative lease values one admission judges.
export type GenerationRequestAdmissionInput = Readonly<{
  provider: string;
  model: string;
  expectedCostCapUnit: string;
  generationRequest: unknown;
  generationRequestSha256: string;
}>;

// The locked admission order: provider/model, expected-cost unit, closed
// grammar, then the canonical hash of the validated request compared by exact
// string equality (no case folding).
function admit<T>(input: GenerationRequestAdmissionInput, provider: string, model: string, unit: string, parse: (value: unknown) => T): T {
  if (input.provider !== provider || input.model !== model) fail("PROVIDER_MODEL_UNSUPPORTED");
  if (input.expectedCostCapUnit !== unit) fail("COST_UNIT_INCOMPATIBLE");
  const request = parse(input.generationRequest);
  if (generationRequestSha256(request) !== input.generationRequestSha256) fail("REQUEST_HASH_MISMATCH");
  return request;
}

export function admitGoogleGenerationRequest(input: GenerationRequestAdmissionInput): GoogleGenerationRequest {
  return admit(input, GOOGLE_PROVIDER_ID, GOOGLE_MODEL, GOOGLE_EXPECTED_COST_CAP_UNIT, parseGoogleGenerationRequest);
}

export function admitRunwayGenerationRequest(input: GenerationRequestAdmissionInput): RunwayGenerationRequest {
  return admit(input, RUNWAY_PROVIDER_ID, RUNWAY_MODEL, RUNWAY_EXPECTED_COST_CAP_UNIT, parseRunwayGenerationRequest);
}
