import { isEffectiveAudioMix } from "./deriveEditorialAudioMix.js";
import type { EditorialPlanV2 } from "./editorialPlanV2.schema.js";
import type { EditorialPlanV3 } from "./editorialPlanV3.schema.js";
import { assertEditorial } from "./validateEditorialPlan.js";
import { validateEditorialPlanV2 } from "./validateEditorialPlanV2.js";
import { validateEditorialPlanV3 } from "./validateEditorialPlanV3.js";

// Pure 2.0 -> 3.0: default bed, no assets, no layers, no decisions provenance (nothing fabricated).
export function migrateEditorialPlanV2ToV3(input: unknown): EditorialPlanV3 {
  const basePlan = validateEditorialPlanV2(input);
  return validateEditorialPlanV3({
    planType: "BUSYBOOKIE_EDITORIAL_PLAN",
    schemaVersion: "3.0",
    basePlan,
    audioMixDecisionsSha256: null,
    audioMix: { bed: { bedGainCentiDb: 0, bedMuted: false }, externalAudioAssets: [], layers: [] },
  });
}

// Defined only without an effective mix; E4-only provenance (decisions hash, muted layers, their assets) is dropped.
export function downgradeEditorialPlanV3ToV2(input: unknown): EditorialPlanV2 {
  const plan = validateEditorialPlanV3(input);
  assertEditorial(!isEffectiveAudioMix(plan.audioMix), "3.0 plans with an effective audio mix cannot be expressed as 2.0 plans");
  return plan.basePlan;
}
