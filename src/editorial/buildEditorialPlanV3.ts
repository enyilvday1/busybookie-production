import { hashAudioMixDecisions } from "./canonicalizeEditorialPlanV3.js";
import { referencedAudioAssetIds } from "./deriveEditorialAudioMix.js";
import type { EditorialPlanV3 } from "./editorialPlanV3.schema.js";
import { validateAudioMixDecisionsAgainstSource } from "./validateAudioMixDecisions.js";
import { assertEditorial } from "./validateEditorialPlan.js";
import { validateEditorialPlanV2 } from "./validateEditorialPlanV2.js";
import { validateEditorialPlanV3, validateExternalAudioAsset } from "./validateEditorialPlanV3.js";
import { validateEditorialPlanV3AgainstSource } from "./validateEditorialPlanV3AgainstSource.js";

export type BuildEditorialPlanV3Input = Readonly<{
  basePlan: unknown;
  // Admitted in-memory external audio records; only the referenced closure enters the plan.
  externalAudioAssets: readonly unknown[];
  // null or undefined means no decisions document (default bed, no layers, null provenance).
  audioMixDecisions: unknown;
}>;

// Pure synchronous 3.0 resolution. The result is self-contained: rendering never needs the decisions again.
export function buildEditorialPlanV3(input: BuildEditorialPlanV3Input): EditorialPlanV3 {
  const basePlan = validateEditorialPlanV2(input.basePlan);
  const sources = input.externalAudioAssets.map((asset) => validateExternalAudioAsset(asset));
  const absent = input.audioMixDecisions === null || input.audioMixDecisions === undefined;
  const decisions = absent ? null
    : validateAudioMixDecisionsAgainstSource(input.audioMixDecisions, { basePlan, externalAudioAssets: sources });
  const layers = decisions?.layers ?? [];
  const externalAudioAssets = referencedAudioAssetIds(layers).map((assetId) => {
    const asset = sources.find((candidate) => candidate.assetId === assetId);
    assertEditorial(asset !== undefined, `3.0 build requires admitted asset ${assetId}`);
    return asset;
  });
  const plan = validateEditorialPlanV3({
    planType: "BUSYBOOKIE_EDITORIAL_PLAN",
    schemaVersion: "3.0",
    basePlan,
    audioMixDecisionsSha256: decisions ? hashAudioMixDecisions(decisions) : null,
    audioMix: { bed: decisions?.bed ?? { bedGainCentiDb: 0, bedMuted: false }, externalAudioAssets, layers },
  });
  validateEditorialPlanV3AgainstSource({ plan, basePlan, externalAudioAssets: sources, audioMixDecisions: decisions });
  return plan;
}
