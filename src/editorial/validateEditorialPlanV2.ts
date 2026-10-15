import {
  deriveEditorialTimeline, dialogueLineProtectedSampleRange, frameToSample, type DerivedEditorialTimeline,
} from "./deriveEditorialTimeline.js";
import { EditorialPlanV2Schema, type EditorialPlanV2 } from "./editorialPlanV2.schema.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

// Derives the canonical integer-frame timeline of a structurally valid 2.0 plan.
export function deriveEditorialPlanV2Timeline(plan: EditorialPlanV2): DerivedEditorialTimeline {
  const clips = plan.tracks[0].clips.map((clip, index) => {
    const asset = plan.assets[index];
    assertEditorial(asset !== undefined, "2.0 timeline requires one asset per V1 clip");
    return { assetDurationFrames: asset.assetDurationFrames, sourceInFrame: clip.sourceInFrame, sourceOutFrame: clip.sourceOutFrame };
  });
  return deriveEditorialTimeline(clips, plan.transitions);
}

export function validateEditorialPlanV2(input: unknown): EditorialPlanV2 {
  const parsed = EditorialPlanV2Schema.safeParse(input);
  assertEditorial(parsed.success, `2.0 schema validation failed: ${parsed.error?.message ?? ""}`);
  const plan = parsed.data;
  const count = plan.shots.length;
  const [video, audio] = plan.tracks;
  const episodeId = plan.episode.episodeId;
  assertEditorial(plan.assets.length === count && video.clips.length === count && audio.clips.length === count,
    "2.0 requires exactly one asset and one clip per track for each shot");
  assertEditorial(plan.transitions.length === count - 1, "2.0 requires exactly one transition per adjacent V1 clip pair");
  const shotIds = new Set<string>();
  const contentBytes = new Map<string, number>();
  for (const [index, shot] of plan.shots.entries()) {
    assertEditorial(!shotIds.has(shot.shotId) && shot.order === index + 1, "2.0 requires unique continuous ordered shots");
    shotIds.add(shot.shotId);
    const asset = plan.assets[index]!;
    const v = video.clips[index]!;
    const a = audio.clips[index]!;
    const identity = `normalized:${episodeId}:${shot.shotId}`;
    assertEditorial(shot.assetId === identity && asset.assetId === identity, "2.0 shot/asset identity or first-use order mismatch");
    const locator = `cache/composition-normalized/${episodeId}/${shot.shotId}/${episodeId}_${shot.shotId}_${asset.normalization.cacheKey}.mp4`;
    assertEditorial(asset.mediaRootRelativePath === locator, "2.0 asset locator identity mismatch");
    assertEditorial(v.clipId === `V1-${shot.shotId}` && v.shotId === shot.shotId && v.assetId === identity,
      "2.0 V1 shot/clip/asset binding mismatch");
    assertEditorial(a.clipId === `A1-${shot.shotId}` && a.shotId === shot.shotId && a.assetId === identity && a.linkedClipId === v.clipId,
      "2.0 A1 shot/clip/asset/link binding mismatch");
    assertEditorial(!contentBytes.has(asset.sha256) || contentBytes.get(asset.sha256) === asset.bytes,
      "2.0 equal-content byte counts contradict each other");
    contentBytes.set(asset.sha256, asset.bytes);
  }
  for (const [index, transition] of plan.transitions.entries()) {
    assertEditorial(transition.outgoingClipId === video.clips[index]!.clipId && transition.incomingClipId === video.clips[index + 1]!.clipId,
      `2.0 transition ${index + 1} must join adjacent V1 clips in order`);
  }
  const timeline = deriveEditorialPlanV2Timeline(plan);
  assertEditorial(timeline.timelineDurationFrames === plan.timelineDurationFrames,
    "2.0 timelineDurationFrames does not equal the derived timeline");
  for (const [index, shot] of plan.shots.entries()) {
    const asset = plan.assets[index]!;
    const v = video.clips[index]!;
    const a = audio.clips[index]!;
    const derivedVideo = timeline.video[index]!;
    const derivedAudio = timeline.audio[index]!;
    assertEditorial(v.timelineStartFrame === derivedVideo.timelineStartFrame, "2.0 V1 timeline start does not match recomputation");
    assertEditorial(a.timelineStartFrame === derivedAudio.timelineStartFrame && a.sourceInFrame === derivedAudio.sourceInFrame &&
      a.sourceOutFrame === derivedAudio.sourceOutFrame, "2.0 A1 hard-cut range does not match recomputation");
    assertEditorial((a.audio.mode === "REPLACE_SOURCE_WITH_DIALOGUE") === (asset.normalization.schemaVersion === "2.0"),
      "2.0 audio mode does not match normalization profile");
    if (a.audio.mode === "REPLACE_SOURCE_WITH_DIALOGUE") {
      const assetSeconds = asset.assetDurationFrames / 25;
      const retainedStart = frameToSample(a.sourceInFrame);
      const retainedEnd = frameToSample(a.sourceOutFrame);
      let previousEnd = 0;
      for (const [lineIndex, line] of a.audio.lines.entries()) {
        const number = lineIndex + 1;
        assertEditorial(line.lineNumber === number &&
          line.dialogueLineId === `${episodeId}_${shot.sceneId}_${shot.shotId}_L${String(number).padStart(2, "0")}`,
        "2.0 dialogue line identity/order mismatch");
        const lineEnd = line.startSeconds + line.durationSeconds;
        assertEditorial(Number.isFinite(lineEnd) && lineEnd <= assetSeconds + 0.000001 && line.startSeconds >= previousEnd,
          "2.0 dialogue timing exceeds asset or overlaps");
        previousEnd = Math.min(lineEnd, assetSeconds);
        const protectedRange = dialogueLineProtectedSampleRange(line, asset.assetDurationFrames);
        assertEditorial(retainedStart <= protectedRange.startSample && protectedRange.endSample <= retainedEnd,
          `2.0 edit would drop or truncate dialogue line ${line.dialogueLineId}`);
      }
    }
  }
  return freezeEditorial(plan);
}
