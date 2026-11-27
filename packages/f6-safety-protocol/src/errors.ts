// Internal structural validation helpers, intentionally not all public exports.
// No input values or causes are interpolated into errors.
export type F6ProtocolFailureCode =
  | "F6_SCHEMA_UNSUPPORTED"
  | "F6_STRUCTURE_INVALID"
  | "F6_VALUE_NOT_CANONICALIZABLE"
  | "F6_IDENTITY_MISMATCH"
  | "F6_DIGEST_MISMATCH"
  | "F6_TIME_WINDOW_INVALID"
  | "F6_LEASE_INVALID"
  | "F6_TRANSITION_INVALID"
  | "F6_EVIDENCE_INSUFFICIENT"
  | "F6_AUTHORITY_NOT_ESTABLISHED";

export class F6ProtocolError extends Error {
  override readonly name = "F6ProtocolError";
  constructor(readonly code: F6ProtocolFailureCode) {
    super(code);
  }
}

export function fail(code: F6ProtocolFailureCode): never {
  throw new F6ProtocolError(code);
}

export function wellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    if (ch >= 0xd800 && ch <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (ch >= 0xdc00 && ch <= 0xdfff) return false;
  }
  return true;
}

// Descriptor-based extraction prevents ordinary JavaScript getters running.
// Proxies are NOT safe input: a Proxy can execute its traps during reflection.
export function closedRecord(input: unknown, keys: readonly string[], code: F6ProtocolFailureCode = "F6_STRUCTURE_INVALID"): ReadonlyMap<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return fail(code);
  const proto: unknown = Object.getPrototypeOf(input);
  if (proto !== null && proto !== Object.prototype) return fail(code);
  const actual = Reflect.ownKeys(input);
  if (actual.length !== keys.length) return fail(code);
  const allowed = new Set(keys);
  const fields = new Map<string, unknown>();
  for (const key of actual) {
    if (typeof key !== "string" || !allowed.has(key)) return fail(code);
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return fail(code);
    fields.set(key, descriptor.value);
  }
  if (fields.size !== allowed.size) return fail(code);
  return fields;
}

export function exactString(input: unknown, regex: RegExp, maxLength = 256, code: F6ProtocolFailureCode = "F6_STRUCTURE_INVALID"): string {
  if (typeof input !== "string" || !input.length || input.length > maxLength || !wellFormed(input) || !regex.test(input)) return fail(code);
  return input;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const HEX256 = /^[0-9a-f]{64}$/;
export const DECIMAL_ID = /^[1-9][0-9]{0,19}$/;
export const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
export const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
export const GCP_NAME = /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
export const ZONE = /^[a-z]+(?:-[a-z]+)+[0-9]-[a-z]$/;

export function decimalString(input: unknown, code: F6ProtocolFailureCode = "F6_STRUCTURE_INVALID"): string {
  return exactString(input, DECIMAL_ID, 20, code);
}
export function hex256(input: unknown, code: F6ProtocolFailureCode = "F6_STRUCTURE_INVALID"): string {
  return exactString(input, HEX256, 64, code);
}
export function uuid(input: unknown, code: F6ProtocolFailureCode = "F6_STRUCTURE_INVALID"): string {
  return exactString(input, UUID, 36, code);
}
export function integerBetween(input: unknown, min: number, max: number, code: F6ProtocolFailureCode = "F6_STRUCTURE_INVALID"): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < min || input > max) return fail(code);
  return input;
}
export function boolean(input: unknown, code: F6ProtocolFailureCode = "F6_STRUCTURE_INVALID"): boolean {
  if (typeof input !== "boolean") return fail(code);
  return input;
}
export function literal<T extends string | number | boolean>(input: unknown, expected: T, code: F6ProtocolFailureCode = "F6_STRUCTURE_INVALID"): T {
  if (input !== expected) return fail(code);
  return expected;
}
export function utcTimestamp(input: unknown, code: F6ProtocolFailureCode = "F6_TIME_WINDOW_INVALID"): string {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input)) return fail(code);
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== input) return fail(code);
  return input;
}
export function frozenArray<T>(input: unknown, max: number, parse: (item: unknown) => T, min = 0): readonly T[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length < min || input.length > max) return fail("F6_STRUCTURE_INVALID");
  const keys = Reflect.ownKeys(input);
  if (keys.length !== input.length + 1) return fail("F6_STRUCTURE_INVALID");
  const items: T[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const field = Object.getOwnPropertyDescriptor(input, String(i));
    if (!field || !field.enumerable || !("value" in field)) return fail("F6_STRUCTURE_INVALID");
    items.push(parse(field.value));
  }
  return Object.freeze(items);
}
export function sameIdentity(actual: string, expected: string | undefined): void {
  if (expected !== undefined && actual !== expected) fail("F6_IDENTITY_MISMATCH");
}
