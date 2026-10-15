import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import { parseEditorialDecisions } from "./validateEditorialDecisions.js";
import { validateEditorialPlanV2 } from "./validateEditorialPlanV2.js";

// Full authoritative-record identity of a 2.0 plan (provenance-sensitive by design).
export function canonicalizeEditorialPlanV2(plan: unknown): string {
  return canonicalEditorialJson(validateEditorialPlanV2(plan));
}

export function hashEditorialPlanV2(plan: unknown): string {
  return editorialSha256(canonicalizeEditorialPlanV2(plan));
}

// Decisions identity includes the source binding, so documents bound to different media hash differently.
export function canonicalizeEditorialDecisions(decisions: unknown): string {
  return canonicalEditorialJson(parseEditorialDecisions(decisions));
}

export function hashEditorialDecisions(decisions: unknown): string {
  return editorialSha256(canonicalizeEditorialDecisions(decisions));
}
