import { createHash } from "node:crypto";
import { fail, wellFormed } from "./errors.js";

// Versioned, unambiguous preimage: prefix + ASCII domain + NUL + UTF-8 JCS.
// These constants are protocol v1 and must never be altered in place.
const HASH_PREFIX = "busybookie.r44b11g.f6.v1\u0000";
const MAX_COMPONENTS = 4096;
const MAX_CANONICAL_BYTES = 65_536;
const DOMAINS = Object.freeze({
  RUN_MANIFEST: "RUN_MANIFEST",
  ADMISSION_RECEIPT: "ADMISSION_RECEIPT",
  LEASE: "LEASE",
  CONTAINMENT: "CONTAINMENT",
  RESOURCE_POLICY: "RESOURCE_POLICY",
  SCENARIO: "SCENARIO",
  IAM_VERIFICATION: "IAM_VERIFICATION",
  CLEANUP_READY: "CLEANUP_READY",
  STATE_TRANSITION: "STATE_TRANSITION",
} as const);
export type F6HashDomain = keyof typeof DOMAINS;

// Never construct an oversized aggregate string and then test its length.
// Every token, including punctuation, quotes, escaped characters and UTF-8
// scalar values, is charged BEFORE it is added to the output.
class ByteBoundedWriter {
  private readonly parts: string[] = [];
  private used = 0;

  append(fragment: string): void {
    const bytes = Buffer.byteLength(fragment, "utf8");
    if (bytes > MAX_CANONICAL_BYTES - this.used) return fail("F6_VALUE_NOT_CANONICALIZABLE");
    this.used += bytes;
    this.parts.push(fragment);
  }

  finish(): string {
    return this.parts.join("");
  }
}

// JSON.stringify handles escapes according to JCS. This equivalent bounded
// emitter deliberately never stringifies the WHOLE untrusted input string:
// a 64 KiB string of control characters would expand sixfold before rejection.
function writeString(text: string, writer: ByteBoundedWriter): void {
  if (text.length > MAX_CANONICAL_BYTES || !wellFormed(text)) return fail("F6_VALUE_NOT_CANONICALIZABLE");
  writer.append('"');
  for (const scalar of text) {
    switch (scalar) {
      case '"': writer.append('\\"'); break;
      case "\\": writer.append("\\\\"); break;
      case "\b": writer.append("\\b"); break;
      case "\t": writer.append("\\t"); break;
      case "\n": writer.append("\\n"); break;
      case "\f": writer.append("\\f"); break;
      case "\r": writer.append("\\r"); break;
      default: {
        const code = scalar.charCodeAt(0);
        if (code < 0x20) {
          writer.append(`\\u${code.toString(16).padStart(4, "0")}`);
        } else {
          writer.append(scalar);
        }
      }
    }
  }
  writer.append('"');
}

function writeValue(value: unknown, writer: ByteBoundedWriter, stack: Set<object>, depth: number, budget: { nodes: number }): void {
  budget.nodes += 1;
  if (budget.nodes > MAX_COMPONENTS || depth > 32) return fail("F6_VALUE_NOT_CANONICALIZABLE");
  if (value === null) { writer.append("null"); return; }
  switch (typeof value) {
    case "string": writeString(value, writer); return;
    case "number": {
      // F6 v1 deliberately accepts a strict I-JSON subset. Exact integers
      // outside the safe range must use validated decimal strings, matching
      // strictJsonDecode rather than rounding a raw input silently.
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) return fail("F6_VALUE_NOT_CANONICALIZABLE");
      writer.append(JSON.stringify(value));
      return;
    }
    case "boolean": writer.append(value ? "true" : "false"); return;
    case "object": break;
    default: return fail("F6_VALUE_NOT_CANONICALIZABLE");
  }
  if (stack.has(value)) return fail("F6_VALUE_NOT_CANONICALIZABLE");
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_COMPONENTS || Reflect.ownKeys(value).length !== value.length + 1) return fail("F6_VALUE_NOT_CANONICALIZABLE");
      writer.append("[");
      for (let i = 0; i < value.length; i += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return fail("F6_VALUE_NOT_CANONICALIZABLE");
        if (i !== 0) writer.append(",");
        writeValue(descriptor.value, writer, stack, depth + 1, budget);
      }
      writer.append("]");
      return;
    }
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return fail("F6_VALUE_NOT_CANONICALIZABLE");
    const fields: [string, unknown][] = [];
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || key.length > MAX_CANONICAL_BYTES || !wellFormed(key)) return fail("F6_VALUE_NOT_CANONICALIZABLE");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return fail("F6_VALUE_NOT_CANONICALIZABLE");
      fields.push([key, descriptor.value]);
    }
    fields.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    writer.append("{");
    for (let i = 0; i < fields.length; i += 1) {
      const [key, data] = fields[i]!;
      if (i !== 0) writer.append(",");
      writeString(key, writer);
      writer.append(":");
      writeValue(data, writer, stack, depth + 1, budget);
    }
    writer.append("}");
  } finally {
    stack.delete(value);
  }
}

// RFC 8785 encoding conventions for the F6-v1 strict I-JSON SUBSET. Raw JSON
// must first pass strictJsonDecode; no object reflection can safely execute
// against an arbitrary hostile in-process Proxy.
export function canonicalizeF6Document(value: unknown): string {
  const writer = new ByteBoundedWriter();
  writeValue(value, writer, new Set<object>(), 0, { nodes: 0 });
  return writer.finish();
}

// SHA-256 is content integrity only. This function is not a signer/verifier.
export function sha256F6Document(value: unknown, kind: F6HashDomain): string {
  if (!Object.prototype.hasOwnProperty.call(DOMAINS, kind)) return fail("F6_STRUCTURE_INVALID");
  return createHash("sha256")
    .update(HASH_PREFIX + DOMAINS[kind] + "\u0000" + canonicalizeF6Document(value), "utf8")
    .digest("hex");
}
