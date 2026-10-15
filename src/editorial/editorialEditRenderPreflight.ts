import type { EditorialEditRenderPlan } from "./buildEditorialEditRenderPlan.js";
import { frameToSample } from "./deriveEditorialTimeline.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

// The audio-sample rule is a fail-closed contract check only; its physical adequacy for real AAC-decoded
// artifacts is not yet proven and remains subject to the separately authorized E3D-R lane.
export const EDITORIAL_EDIT_AUDIO_PREFLIGHT_STATUS = "PROVISIONAL_PENDING_E3D_R";

export type EditorialEditRenderInputEvidence = Readonly<{
  assetId: string;
  decodedVideoFrameCount: number;
  decodedAudioSampleCount: number;
}>;

export type EditorialEditRenderPreflightResult = Readonly<{
  renderKey: string;
  audioRuleStatus: typeof EDITORIAL_EDIT_AUDIO_PREFLIGHT_STATUS;
  inputs: readonly Readonly<{
    inputIndex: number; assetId: string; addressableFrames: number; decodedVideoFrameCount: number;
    inaccessibleExtraVideoFrames: number; requiredAudioSamples: number; decodedAudioSampleCount: number;
  }>[];
}>;

// Pure, synchronous check over already-collected in-memory evidence; it never inspects media itself.
export function assertEditorialEditRenderPreflight(input: Readonly<{
  renderPlan: EditorialEditRenderPlan; evidence: readonly EditorialEditRenderInputEvidence[];
}>): EditorialEditRenderPreflightResult {
  const inputs = input.renderPlan.inputs.map((entry) => {
    const matches = input.evidence.filter((candidate) => candidate.assetId === entry.assetId);
    assertEditorial(matches.length === 1, `preflight requires exactly one evidence record for ${entry.assetId}`);
    const evidence = matches[0]!;
    assertEditorial(Number.isSafeInteger(evidence.decodedVideoFrameCount) && evidence.decodedVideoFrameCount >= 0,
      `preflight video frame evidence for ${entry.assetId} is invalid`);
    assertEditorial(Number.isSafeInteger(evidence.decodedAudioSampleCount) && evidence.decodedAudioSampleCount >= 0,
      `preflight audio sample evidence for ${entry.assetId} is invalid`);
    assertEditorial(evidence.decodedVideoFrameCount >= entry.assetDurationFrames,
      `preflight: ${entry.assetId} decodes fewer frames than its canonical range`);
    const requiredAudioSamples = frameToSample(entry.assetDurationFrames);
    assertEditorial(evidence.decodedAudioSampleCount >= requiredAudioSamples,
      `preflight: ${entry.assetId} decodes fewer audio samples than its canonical range`);
    return {
      inputIndex: entry.inputIndex, assetId: entry.assetId, addressableFrames: entry.assetDurationFrames,
      decodedVideoFrameCount: evidence.decodedVideoFrameCount,
      inaccessibleExtraVideoFrames: evidence.decodedVideoFrameCount - entry.assetDurationFrames,
      requiredAudioSamples, decodedAudioSampleCount: evidence.decodedAudioSampleCount,
    };
  });
  const known = new Set(input.renderPlan.inputs.map((entry) => entry.assetId));
  for (const evidence of input.evidence) assertEditorial(known.has(evidence.assetId), `preflight evidence for unknown asset ${evidence.assetId}`);
  return freezeEditorial({ renderKey: input.renderPlan.renderKey, audioRuleStatus: EDITORIAL_EDIT_AUDIO_PREFLIGHT_STATUS, inputs });
}
