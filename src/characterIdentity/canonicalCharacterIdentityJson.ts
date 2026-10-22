import { createHash } from "node:crypto";

// Byte-compatible with canonicalEditorialJson/editorialSha256 (src/editorial/canonicalizeEditorialPlan.ts).
// Reimplemented, not imported: the E2/E4/E5/E6 architecture guards forbid any production importer of
// src/editorial. A parity test pins the two algorithms to identical output.

function fail(detail: string): never {
  throw new Error(`Character identity canonical JSON ${detail}.`);
}

// Serialize keys directly: JSON.stringify(object) would reorder integer-like keys.
export function canonicalCharacterIdentityJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail("numbers must be finite and not negative zero");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let i = 0; i < value.length; i += 1) items.push(canonicalCharacterIdentityJson(value[i]));
    return `[${items.join(",")}]`;
  }
  if (!(typeof value === "object" && value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null))) {
    fail("requires plain JSON values");
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalCharacterIdentityJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function characterIdentitySha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function freezeCharacterIdentity<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeCharacterIdentity(child);
    Object.freeze(value);
  }
  return value;
}
