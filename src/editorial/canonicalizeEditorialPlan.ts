import { createHash } from "node:crypto";
import { assertEditorial, validateEditorialPlan } from "./validateEditorialPlan.js";

// Serialize keys directly: JSON.stringify(object) would reorder integer-like keys.
export function canonicalEditorialJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    assertEditorial(Number.isFinite(value) && !Object.is(value, -0), "canonical numbers must be finite and not negative zero");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let i = 0; i < value.length; i += 1) items.push(canonicalEditorialJson(value[i]));
    return `[${items.join(",")}]`;
  }
  assertEditorial(typeof value === "object" && value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null),
  "canonical JSON requires plain JSON values");
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalEditorialJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function editorialSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function canonicalizeEditorialPlan(plan: unknown): string {
  return canonicalEditorialJson(validateEditorialPlan(plan));
}

export function hashEditorialPlan(plan: unknown): string {
  return editorialSha256(canonicalizeEditorialPlan(plan));
}
