import {
  audioLayerSelectedLength, editorialTimelineDurationSamples, maxConcurrentEffectiveLayers, referencedAudioAssetIds,
} from "./deriveEditorialAudioMix.js";
import {
  E4_MAX_CONCURRENT_EXTERNAL_LAYERS, EditorialPlanV3Schema, ExternalAudioAssetV1Schema,
  type AudioLayerPlacementV1, type EditorialPlanV3, type ExternalAudioAssetV1,
} from "./editorialPlanV3.schema.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";
import { validateEditorialPlanV2 } from "./validateEditorialPlanV2.js";

// Technical facts of one admitted asset: 16-bit samples must fit inside the declared byte count.
export function validateExternalAudioAsset(input: unknown): ExternalAudioAssetV1 {
  const parsed = ExternalAudioAssetV1Schema.safeParse(input);
  assertEditorial(parsed.success, `external audio asset schema validation failed: ${parsed.error?.message ?? ""}`);
  const asset = parsed.data;
  assertEditorial(Number.isSafeInteger(asset.assetDurationSamples * asset.channelCount * 2) &&
    asset.assetDurationSamples * asset.channelCount * 2 <= asset.bytes,
  `external audio asset ${asset.assetId} declares more PCM samples than its bytes can hold`);
  return freezeEditorial(asset);
}

// Unique logical ids; equal content must agree on every technical fact (content is never merged).
export function assertExternalAudioAssetSet(assets: readonly ExternalAudioAssetV1[]): void {
  const ids = new Set<string>();
  const contents = new Map<string, ExternalAudioAssetV1>();
  for (const asset of assets) {
    assertEditorial(!ids.has(asset.assetId), `external audio asset ${asset.assetId} is duplicated`);
    ids.add(asset.assetId);
    const other = contents.get(asset.sha256);
    assertEditorial(other === undefined || (other.bytes === asset.bytes && other.channelCount === asset.channelCount &&
      other.assetDurationSamples === asset.assetDurationSamples), "equal-content external audio facts contradict each other");
    contents.set(asset.sha256, asset);
  }
}

// Layer rules shared by plan and decisions validation: references, ranges, absolute placement, fades, bounds.
export function assertAudioLayers(
  layers: readonly AudioLayerPlacementV1[], assets: ReadonlyMap<string, Pick<ExternalAudioAssetV1, "assetDurationSamples">>,
  timelineDurationSamples: number,
): void {
  const ids = new Set<string>();
  for (const layer of layers) {
    assertEditorial(!ids.has(layer.layerId), `audio layer ${layer.layerId} is duplicated`);
    ids.add(layer.layerId);
    const asset = assets.get(layer.assetId);
    assertEditorial(asset !== undefined, `audio layer ${layer.layerId} references unknown asset ${layer.assetId}`);
    assertEditorial(layer.sourceInSample < layer.sourceOutSample, `audio layer ${layer.layerId} source range must be non-empty`);
    assertEditorial(layer.sourceOutSample <= asset.assetDurationSamples, `audio layer ${layer.layerId} source range exceeds its asset`);
    const length = audioLayerSelectedLength(layer);
    const end = layer.timelineStartSample + length;
    assertEditorial(Number.isSafeInteger(end) && end <= timelineDurationSamples,
      `audio layer ${layer.layerId} must lie entirely inside the base timeline`);
    assertEditorial(layer.fadeInSamples + layer.fadeOutSamples <= length,
      `audio layer ${layer.layerId} fades exceed its selected length`);
  }
  assertEditorial(maxConcurrentEffectiveLayers(layers) <= E4_MAX_CONCURRENT_EXTERNAL_LAYERS,
    `more than ${E4_MAX_CONCURRENT_EXTERNAL_LAYERS} unmuted external layers are simultaneously active`);
}

export function isDefaultAudioMix(audioMix: EditorialPlanV3["audioMix"]): boolean {
  return audioMix.bed.bedGainCentiDb === 0 && !audioMix.bed.bedMuted &&
    audioMix.externalAudioAssets.length === 0 && audioMix.layers.length === 0;
}

export function validateEditorialPlanV3(input: unknown): EditorialPlanV3 {
  const parsed = EditorialPlanV3Schema.safeParse(input);
  assertEditorial(parsed.success, `3.0 schema validation failed: ${parsed.error?.message ?? ""}`);
  const plan = parsed.data;
  const basePlan = validateEditorialPlanV2(plan.basePlan);
  const audioMix = plan.audioMix;
  // null provenance is reserved for plans built or migrated without any decisions document.
  assertEditorial(plan.audioMixDecisionsSha256 !== null || isDefaultAudioMix(audioMix),
    "3.0 plan without decisions provenance must carry the default audio mix");
  const assets = audioMix.externalAudioAssets.map((asset) => validateExternalAudioAsset(asset));
  assertExternalAudioAssetSet(assets);
  const closure = referencedAudioAssetIds(audioMix.layers);
  assertEditorial(closure.length === assets.length && closure.every((assetId, index) => assets[index]!.assetId === assetId),
    "3.0 external audio assets must equal the layer reference closure in first-reference order");
  assertAudioLayers(audioMix.layers, new Map(assets.map((asset) => [asset.assetId, asset])),
    editorialTimelineDurationSamples(basePlan.timelineDurationFrames));
  return freezeEditorial({ ...plan, basePlan });
}
