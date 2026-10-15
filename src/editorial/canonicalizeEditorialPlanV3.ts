import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import { parseAudioMixDecisions } from "./validateAudioMixDecisions.js";
import { validateEditorialPlanV3 } from "./validateEditorialPlanV3.js";

// Full provenance-sensitive record identity of a 3.0 plan (base plan, decisions hash, muted layers, roles, ids).
export function canonicalizeEditorialPlanV3(plan: unknown): string {
  return canonicalEditorialJson(validateEditorialPlanV3(plan));
}

export function hashEditorialPlanV3(plan: unknown): string {
  return editorialSha256(canonicalizeEditorialPlanV3(plan));
}

// Decisions identity covers intent, bindings, bed, layer order, roles, references, ranges, timing, gain, mute, fades.
export function canonicalizeAudioMixDecisions(decisions: unknown): string {
  return canonicalEditorialJson(parseAudioMixDecisions(decisions));
}

export function hashAudioMixDecisions(decisions: unknown): string {
  return editorialSha256(canonicalizeAudioMixDecisions(decisions));
}
