import { canonicalEditorialJson } from "./canonicalizeEditorialPlan.js";
import { hashAudioMixDecisions } from "./canonicalizeEditorialPlanV3.js";
import { validateAudioMixDecisionsAgainstSource } from "./validateAudioMixDecisions.js";
import { assertEditorial } from "./validateEditorialPlan.js";
import { validateEditorialPlanV2 } from "./validateEditorialPlanV2.js";
import { isDefaultAudioMix, validateEditorialPlanV3, validateExternalAudioAsset } from "./validateEditorialPlanV3.js";

export type ValidateEditorialPlanV3AgainstSourceInput = Readonly<{
  plan: unknown;
  // The exact current base plan authority (itself source-validated through the 2.0 path by the caller).
  basePlan: unknown;
  externalAudioAssets: readonly unknown[];
  // null or undefined means no decisions document.
  audioMixDecisions: unknown;
}>;

function same(left: unknown, right: unknown): boolean {
  return canonicalEditorialJson(left) === canonicalEditorialJson(right);
}

// Independent of the 3.0 builder: the expected asset list comes from the binding order, not from layer traversal.
export function validateEditorialPlanV3AgainstSource(input: ValidateEditorialPlanV3AgainstSourceInput): void {
  const plan = validateEditorialPlanV3(input.plan);
  const basePlan = validateEditorialPlanV2(input.basePlan);
  assertEditorial(same(plan.basePlan, basePlan), "3.0 base plan diverges from the current base plan authority");
  if (input.audioMixDecisions === null || input.audioMixDecisions === undefined) {
    assertEditorial(plan.audioMixDecisionsSha256 === null && isDefaultAudioMix(plan.audioMix),
      "3.0 plan without decisions must carry null provenance and the default audio mix");
    return;
  }
  const sources = input.externalAudioAssets.map((asset) => validateExternalAudioAsset(asset));
  const decisions = validateAudioMixDecisionsAgainstSource(input.audioMixDecisions, { basePlan, externalAudioAssets: sources });
  assertEditorial(plan.audioMixDecisionsSha256 === hashAudioMixDecisions(decisions),
    "3.0 plan decisions provenance does not match the supplied decisions document");
  assertEditorial(same(plan.audioMix.bed, decisions.bed), "3.0 bed diverges from the decisions document");
  assertEditorial(same(plan.audioMix.layers, decisions.layers), "3.0 layers diverge from the decisions document");
  const expected = decisions.sourceBinding.externalAudioAssets.map((binding) =>
    sources.find((source) => source.assetId === binding.assetId));
  assertEditorial(same(plan.audioMix.externalAudioAssets, expected), "3.0 external audio assets diverge from source authority");
}
