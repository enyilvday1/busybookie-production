import { AudioMixDecisionsSchema, type AudioMixDecisions } from "./audioMixDecisions.schema.js";
import { hashEditorialPlanV2 } from "./canonicalizeEditorialPlanV2.js";
import { editorialTimelineDurationSamples, referencedAudioAssetIds } from "./deriveEditorialAudioMix.js";
import type { EditorialPlanV2 } from "./editorialPlanV2.schema.js";
import type { ExternalAudioAssetV1 } from "./editorialPlanV3.schema.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";
import { validateEditorialPlanV2 } from "./validateEditorialPlanV2.js";
import { assertAudioLayers, assertExternalAudioAssetSet, validateExternalAudioAsset } from "./validateEditorialPlanV3.js";

export type AudioMixDecisionsSourceAuthority = Readonly<{
  // The exact current base plan; its canonical hash is the staleness anchor for absolute sample placement.
  basePlan: unknown;
  // Admitted logical external audio assets supplied in memory by the caller (admission happens outside editorial).
  externalAudioAssets: readonly unknown[];
}>;

const BOUND_FIELDS = [
  "sha256", "bytes", "contentType", "codec", "sampleFormat", "sampleRateHz", "channelCount", "assetDurationSamples",
] as const;

export function parseAudioMixDecisions(input: unknown): AudioMixDecisions {
  const parsed = AudioMixDecisionsSchema.safeParse(input);
  assertEditorial(parsed.success, `audio mix decisions schema validation failed: ${parsed.error?.message ?? ""}`);
  const decisions = parsed.data;
  const bound = new Set<string>();
  for (const binding of decisions.sourceBinding.externalAudioAssets) {
    assertEditorial(!bound.has(binding.assetId), `audio mix decisions duplicate the binding for ${binding.assetId}`);
    bound.add(binding.assetId);
  }
  const layers = new Set<string>();
  for (const layer of decisions.layers) {
    assertEditorial(!layers.has(layer.layerId), `audio mix decisions repeat layer ${layer.layerId}`);
    layers.add(layer.layerId);
  }
  return freezeEditorial(decisions);
}

// Fail-closed technical staleness check only; there is no refresh, rebinding or approval semantics here.
export function validateAudioMixDecisionsAgainstSource(
  input: unknown, authority: AudioMixDecisionsSourceAuthority,
): AudioMixDecisions {
  const decisions = parseAudioMixDecisions(input);
  const basePlan: EditorialPlanV2 = validateEditorialPlanV2(authority.basePlan);
  assertEditorial(decisions.sourceBinding.baseEditorialPlanSha256 === hashEditorialPlanV2(basePlan),
    "audio mix decisions base plan binding is stale or mismatched");
  const sources = authority.externalAudioAssets.map((asset) => validateExternalAudioAsset(asset));
  assertExternalAudioAssetSet(sources);
  const closure = referencedAudioAssetIds(decisions.layers);
  const bound = decisions.sourceBinding.externalAudioAssets.map((binding) => binding.assetId);
  for (const assetId of bound) {
    assertEditorial(sources.some((source) => source.assetId === assetId), `audio mix decisions bind unknown asset ${assetId}`);
  }
  assertEditorial(bound.length === closure.length && bound.every((assetId) => closure.includes(assetId)),
    "audio mix decisions bindings must equal the referenced asset closure exactly");
  assertEditorial(bound.every((assetId, index) => assetId === closure[index]),
    "audio mix decisions bindings must follow first-reference order");
  for (const binding of decisions.sourceBinding.externalAudioAssets) {
    const source: ExternalAudioAssetV1 = sources.find((candidate) => candidate.assetId === binding.assetId)!;
    for (const field of BOUND_FIELDS) {
      assertEditorial(binding[field] === source[field], `audio mix decisions binding ${field} for ${binding.assetId} is stale or mismatched`);
    }
  }
  assertAudioLayers(decisions.layers, new Map(sources.map((source) => [source.assetId, source])),
    editorialTimelineDurationSamples(basePlan.timelineDurationFrames));
  return decisions;
}
