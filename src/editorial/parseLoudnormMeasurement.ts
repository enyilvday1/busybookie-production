import { z } from "zod";
import type { EditorialReadonly } from "./editorialPlan.schema.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;
const int32 = z.number().refine((n) => Number.isSafeInteger(n) && !Object.is(n, -0) && n >= INT32_MIN && n <= INT32_MAX,
  "Expected a signed 32-bit integer.");
const lra = int32.refine((n) => n >= 0, "Expected a non-negative loudness range.");

// Repository-owned measurement value: centi-LUFS / centi-dBTP / centi-LU integers; null exactly where loudnorm reported -inf.
export const LoudnessMeasurementV1Schema = z.discriminatedUnion("class", [
  z.object({
    class: z.literal("MEASURABLE"), integratedCentiLufs: int32, truePeakCentiDbtp: int32,
    loudnessRangeCentiLu: lra, thresholdCentiLufs: int32,
  }).strict(),
  z.object({
    class: z.literal("BELOW_ABSOLUTE_GATE"), integratedCentiLufs: z.null(), truePeakCentiDbtp: int32.nullable(),
    loudnessRangeCentiLu: lra, thresholdCentiLufs: int32.nullable(),
  }).strict(),
]);
export type LoudnessMeasurementV1 = EditorialReadonly<z.infer<typeof LoudnessMeasurementV1Schema>>;

export const LOUDNORM_PARSE_FAILURE_CODES = [
  "INVALID_UTF8", "INVALID_LINE_ENDING", "RESULT_BLOCK_MISSING", "RESULT_BLOCK_MULTIPLE", "RESULT_BLOCK_HEADER_MISSING",
  "RESULT_BLOCK_UNTERMINATED", "STRAY_BLOCK_DELIMITER", "MALFORMED_JSON", "DUPLICATE_KEY", "KEY_SET_MISMATCH",
  "NON_STRING_VALUE", "INVALID_FIELD_VALUE", "NON_FINITE_MEASUREMENT", "MEASUREMENT_INCONSISTENT",
] as const;
export type LoudnormParseFailureCode = (typeof LOUDNORM_PARSE_FAILURE_CODES)[number];
export type LoudnormParseFailureClass =
  "MEASUREMENT_PARSE_FAILURE" | "INVALID_LINE_ENDING" | "NON_FINITE_MEASUREMENT" | "MEASUREMENT_INCONSISTENT";

export type LoudnormParseResult =
  | Readonly<{ ok: true; measurement: LoudnessMeasurementV1 }>
  | Readonly<{ ok: false; code: LoudnormParseFailureCode; class: LoudnormParseFailureClass }>;

export function loudnormFailureClass(code: LoudnormParseFailureCode): LoudnormParseFailureClass {
  if (code === "INVALID_LINE_ENDING" || code === "NON_FINITE_MEASUREMENT" || code === "MEASUREMENT_INCONSISTENT") return code;
  return "MEASUREMENT_PARSE_FAILURE";
}

const RESULT_KEYS = [
  "input_i", "input_lra", "input_thresh", "input_tp", "normalization_type",
  "output_i", "output_lra", "output_thresh", "output_tp", "target_offset",
] as const;
const HEADER_LINE = /^\[Parsed_loudnorm_[0-9]+ @ [^\]]+\]$/;
const CENTI_NUMBER = /^(-?)(0|[1-9][0-9]*)\.([0-9]{2})$/;
const NON_FINITE_TEXT = new Set(["inf", "+inf", "nan", "-nan"]);

function fail(code: LoudnormParseFailureCode): LoudnormParseResult {
  return freezeEditorial({ ok: false, code, class: loudnormFailureClass(code) });
}

// Delimiter normalization trims ASCII SPACE and TAB only.
function delimiterText(line: string): string {
  let start = 0;
  let end = line.length;
  while (start < end && (line[start] === " " || line[start] === "\t")) start += 1;
  while (end > start && (line[end - 1] === " " || line[end - 1] === "\t")) end -= 1;
  return line.slice(start, end);
}

// Exact centi integer by BigInt string arithmetic: no Number(), no parseFloat on field text.
export function parseCentiText(text: string): number | null {
  const match = text.match(CENTI_NUMBER);
  if (match === null) return null;
  const magnitude = BigInt(match[2]!) * 100n + BigInt(match[3]!);
  const centi = match[1] === "-" ? -magnitude : magnitude;
  if (centi < BigInt(INT32_MIN) || centi > BigInt(INT32_MAX)) return null;
  const value = Number(centi);
  return Object.is(value, -0) ? 0 : value;
}

// Pre-scan for duplicate top-level object keys (JSON.parse silently keeps the last one).
function hasDuplicateTopLevelKey(text: string): boolean {
  const seen = new Set<string>();
  let depth = 0;
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "\"") {
      let end = index + 1;
      while (end < text.length && text[end] !== "\"") end += text[end] === "\\" ? 2 : 1;
      if (end >= text.length) return false;
      let next = end + 1;
      while (next < text.length && " \t\n\r".includes(text[next]!)) next += 1;
      if (depth === 1 && text[next] === ":") {
        let key: unknown;
        try { key = JSON.parse(text.slice(index, end + 1)); } catch { return false; }
        if (typeof key !== "string") return false;
        if (seen.has(key)) return true;
        seen.add(key);
      }
      index = end + 1;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") depth -= 1;
    index += 1;
  }
  return false;
}

// Strict loudnorm stderr parser (Step 1080 K, Step 1082 R8/R9). Pure; malformed non-byte input throws.
// Check order is fixed: UTF-8, line endings, block location, duplicate keys, JSON, key set, value types, values.
export function parseLoudnormMeasurement(stderr: Uint8Array): LoudnormParseResult {
  assertEditorial(stderr instanceof Uint8Array, "loudnorm parser requires the raw stderr bytes");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(stderr);
  } catch {
    return fail("INVALID_UTF8");
  }
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.includes("\r")) return fail("INVALID_LINE_ENDING");
    lines.push(line);
  }
  const opens: number[] = [];
  for (const [index, line] of lines.entries()) if (delimiterText(line) === "{") opens.push(index);
  if (opens.length === 0) return fail("RESULT_BLOCK_MISSING");
  if (opens.length > 1) return fail("RESULT_BLOCK_MULTIPLE");
  const open = opens[0]!;
  if (open === 0 || !HEADER_LINE.test(delimiterText(lines[open - 1]!))) return fail("RESULT_BLOCK_HEADER_MISSING");
  let close = -1;
  for (let index = open + 1; index < lines.length; index += 1) {
    if (delimiterText(lines[index]!) === "}") { close = index; break; }
  }
  if (close < 0) return fail("RESULT_BLOCK_UNTERMINATED");
  for (const [index, line] of lines.entries()) {
    if (index !== close && delimiterText(line) === "}") return fail("STRAY_BLOCK_DELIMITER");
  }
  const block = lines.slice(open, close + 1).join("\n");
  if (hasDuplicateTopLevelKey(block)) return fail("DUPLICATE_KEY");
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    return fail("MALFORMED_JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
    (Object.getPrototypeOf(parsed) !== Object.prototype && Object.getPrototypeOf(parsed) !== null)) return fail("KEY_SET_MISMATCH");
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== RESULT_KEYS.length || keys.some((key, index) => key !== RESULT_KEYS[index])) return fail("KEY_SET_MISMATCH");
  if (RESULT_KEYS.some((key) => typeof record[key] !== "string")) return fail("NON_STRING_VALUE");
  // Only the four input_* fields are evidence; output_*, normalization_type and target_offset are presence/type-checked.
  const integrated = record.input_i as string;
  const truePeak = record.input_tp as string;
  const range = record.input_lra as string;
  const threshold = record.input_thresh as string;
  if ([integrated, truePeak, range, threshold].some((value) => NON_FINITE_TEXT.has(value))) return fail("NON_FINITE_MEASUREMENT");
  const rangeCenti = parseCentiText(range);
  if (rangeCenti === null || rangeCenti < 0) return fail("INVALID_FIELD_VALUE");
  const finiteOrInf = (value: string): number | null | "INVALID" => {
    if (value === "-inf") return null;
    const centi = parseCentiText(value);
    return centi === null ? "INVALID" : centi;
  };
  const i = finiteOrInf(integrated);
  const tp = finiteOrInf(truePeak);
  const th = finiteOrInf(threshold);
  if (i === "INVALID" || tp === "INVALID" || th === "INVALID") return fail("INVALID_FIELD_VALUE");
  if (i === null) {
    return freezeEditorial({ ok: true, measurement: {
      class: "BELOW_ABSOLUTE_GATE", integratedCentiLufs: null, truePeakCentiDbtp: tp, loudnessRangeCentiLu: rangeCenti, thresholdCentiLufs: th,
    } });
  }
  if (tp === null || th === null) return fail("MEASUREMENT_INCONSISTENT");
  return freezeEditorial({ ok: true, measurement: {
    class: "MEASURABLE", integratedCentiLufs: i, truePeakCentiDbtp: tp, loudnessRangeCentiLu: rangeCenti, thresholdCentiLufs: th,
  } });
}
