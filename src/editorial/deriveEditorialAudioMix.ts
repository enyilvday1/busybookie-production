import { EDITORIAL_MAX_TIMELINE_FRAMES, frameToSample } from "./deriveEditorialTimeline.js";
import type { AudioLayerPlacementV1, AudioMixBed } from "./editorialPlanV3.schema.js";
import { assertEditorial } from "./validateEditorialPlan.js";

// 22,275,000 frames x 1920 samples per frame; a safe integer.
export const E4_MAX_TIMELINE_SAMPLES = EDITORIAL_MAX_TIMELINE_FRAMES * 1_920;

export function editorialTimelineDurationSamples(timelineDurationFrames: number): number {
  return frameToSample(timelineDurationFrames);
}

export function audioLayerSelectedLength(layer: Pick<AudioLayerPlacementV1, "sourceInSample" | "sourceOutSample">): number {
  return layer.sourceOutSample - layer.sourceInSample;
}

// effectiveMix = bedMuted || bedGain != 0 || any unmuted layer.
export function isEffectiveAudioMix(audioMix: Readonly<{ bed: AudioMixBed; layers: readonly AudioLayerPlacementV1[] }>): boolean {
  return audioMix.bed.bedMuted || audioMix.bed.bedGainCentiDb !== 0 || audioMix.layers.some((layer) => !layer.muted);
}

export function effectiveAudioLayers(layers: readonly AudioLayerPlacementV1[]): readonly AudioLayerPlacementV1[] {
  return layers.filter((layer) => !layer.muted);
}

// Unique asset ids in first-reference order over all layers, muted layers included (the binding closure).
export function referencedAudioAssetIds(layers: readonly AudioLayerPlacementV1[]): readonly string[] {
  const ids: string[] = [];
  for (const layer of layers) if (!ids.includes(layer.assetId)) ids.push(layer.assetId);
  return ids;
}

// Unique asset ids in first EFFECTIVE reference order; muted-only references never allocate an input slot.
export function effectiveAudioAssetIds(layers: readonly AudioLayerPlacementV1[]): readonly string[] {
  return referencedAudioAssetIds(effectiveAudioLayers(layers));
}

// Maximum number of simultaneously active unmuted layers over half-open [start, start+L); the bed is not counted.
export function maxConcurrentEffectiveLayers(layers: readonly AudioLayerPlacementV1[]): number {
  const events: [number, number][] = [];
  for (const layer of effectiveAudioLayers(layers)) {
    events.push([layer.timelineStartSample, 1], [layer.timelineStartSample + audioLayerSelectedLength(layer), -1]);
  }
  // Ends sort before starts at the same sample, so abutting layers are not concurrent.
  events.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let active = 0;
  let peak = 0;
  for (const [, delta] of events) {
    active += delta;
    peak = Math.max(peak, active);
  }
  return peak;
}

// Canonical vendor-neutral fade law (linear amplitude, endpoint-complete) at local index i of a layer of length L.
export function linearFadeFactor(i: number, length: number, fadeInSamples: number, fadeOutSamples: number): number {
  assertEditorial(Number.isSafeInteger(i) && i >= 0 && i < length, "fade index must lie inside the layer");
  assertEditorial(fadeInSamples !== 1 && fadeOutSamples !== 1 && fadeInSamples + fadeOutSamples <= length,
    "fade lengths must be 0 or >= 2 and fit the layer");
  const fadeIn = fadeInSamples === 0 || i >= fadeInSamples - 1 ? 1 : i / (fadeInSamples - 1);
  const fadeOut = fadeOutSamples === 0 || i < length - fadeOutSamples ? 1 : (length - 1 - i) / (fadeOutSamples - 1);
  return fadeIn * fadeOut;
}
