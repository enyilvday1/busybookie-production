import type { EditorialPlan } from "./editorialPlan.schema.js";
import type { EditorialPlanV2 } from "./editorialPlanV2.schema.js";
import { projectEditorialAssetV2ToV1 } from "./resolveEditorialAssetPathV2.js";
import { assertEditorial, validateEditorialPlan } from "./validateEditorialPlan.js";
import { validateEditorialPlanV2 } from "./validateEditorialPlanV2.js";

// Pure 1.0 -> 2.0 conversion: full ranges, all CUT, E2 starts and A1, no decisions provenance.
export function migrateEditorialPlanV1ToV2(input: unknown): EditorialPlanV2 {
  const plan = validateEditorialPlan(input);
  const [video, audio] = plan.tracks;
  return validateEditorialPlanV2({
    schemaVersion: "2.0",
    planType: plan.planType,
    episode: plan.episode,
    editorialDecisionsSha256: null,
    profile: plan.profile,
    timelineDurationFrames: plan.durationFrames,
    shots: plan.shots.map((shot) => ({
      shotId: shot.shotId, sceneId: shot.sceneId, order: shot.order, title: shot.title, assetId: shot.assetId,
    })),
    assets: plan.assets.map((asset, index) => ({ ...asset, assetDurationFrames: plan.shots[index]!.durationFrames })),
    tracks: [
      { trackId: "V1", kind: "VIDEO", clips: video.clips.map((clip) => ({
        clipId: clip.clipId, shotId: clip.shotId, assetId: clip.assetId,
        sourceInFrame: clip.sourceInFrame, sourceOutFrame: clip.sourceOutFrame, timelineStartFrame: clip.timelineStartFrame,
      })) },
      { trackId: "A1", kind: "SHOT_AUDIO", clips: audio.clips.map((clip) => ({
        clipId: clip.clipId, shotId: clip.shotId, assetId: clip.assetId,
        sourceInFrame: clip.sourceInFrame, sourceOutFrame: clip.sourceOutFrame, timelineStartFrame: clip.timelineStartFrame,
        linkedClipId: clip.linkedClipId, audio: clip.audio,
      })) },
    ],
    transitions: video.clips.slice(1).map((clip, index) => ({
      outgoingClipId: video.clips[index]!.clipId, incomingClipId: clip.clipId, type: "CUT",
    })),
  });
}

// Defined only on validated 2.0 plans; decisions provenance alone never disqualifies a plan.
export function isE2EquivalentEditorialPlanV2(input: unknown): boolean {
  const plan = validateEditorialPlanV2(input);
  return plan.transitions.every((transition) => transition.type === "CUT") &&
    plan.tracks[0].clips.every((clip, index) => clip.sourceInFrame === 0 &&
      clip.sourceOutFrame === plan.assets[index]!.assetDurationFrames);
}

export function downgradeE2EquivalentEditorialPlanV2ToV1(input: unknown): EditorialPlan {
  const plan = validateEditorialPlanV2(input);
  assertEditorial(isE2EquivalentEditorialPlanV2(plan), "only E2-equivalent 2.0 plans can be expressed as 1.0 plans");
  const [video, audio] = plan.tracks;
  return validateEditorialPlan({
    schemaVersion: "1.0",
    planType: plan.planType,
    episode: plan.episode,
    profile: plan.profile,
    assemblyMode: "STRAIGHT_CUT",
    durationFrames: plan.timelineDurationFrames,
    shots: plan.shots.map((shot, index) => ({ ...shot, durationFrames: plan.assets[index]!.assetDurationFrames })),
    assets: plan.assets.map((asset) => projectEditorialAssetV2ToV1(asset)),
    tracks: [
      { trackId: "V1", kind: "VIDEO", clips: video.clips.map((clip) => ({
        clipId: clip.clipId, shotId: clip.shotId, assetId: clip.assetId, timelineStartFrame: clip.timelineStartFrame,
        durationFrames: clip.sourceOutFrame - clip.sourceInFrame, sourceInFrame: clip.sourceInFrame, sourceOutFrame: clip.sourceOutFrame,
      })) },
      { trackId: "A1", kind: "SHOT_AUDIO", clips: audio.clips.map((clip) => ({
        clipId: clip.clipId, shotId: clip.shotId, assetId: clip.assetId, timelineStartFrame: clip.timelineStartFrame,
        durationFrames: clip.sourceOutFrame - clip.sourceInFrame, sourceInFrame: clip.sourceInFrame, sourceOutFrame: clip.sourceOutFrame,
        linkedClipId: clip.linkedClipId, audio: clip.audio,
      })) },
    ],
  });
}
