import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

export const EDITORIAL_FRAME_RATE = 25;
export const EDITORIAL_SAMPLE_RATE_HZ = 48_000;
export const EDITORIAL_SAMPLES_PER_FRAME = 1_920;
export const EDITORIAL_MAX_TIMELINE_FRAMES = 22_275_000;

export type EditorialTimelineClipInput = Readonly<{
  assetDurationFrames: number; sourceInFrame: number; sourceOutFrame: number;
}>;
export type EditorialTimelineEdgeInput = Readonly<{ type: "CUT" } | { type: "CROSS_DISSOLVE"; overlapFrames: number }>;

export type DerivedEditorialVideoClip = Readonly<{
  sourceInFrame: number; sourceOutFrame: number; selectedDurationFrames: number;
  headSourceReserveFrames: number; tailSourceReserveFrames: number;
  leftOverlapFrames: number; rightOverlapFrames: number;
  timelineStartFrame: number; timelineEndFrame: number;
}>;
export type DerivedEditorialAudioClip = Readonly<{
  sourceInFrame: number; sourceOutFrame: number; sourceInSample: number; sourceOutSample: number;
  timelineStartFrame: number; timelineEndFrame: number;
}>;
export type DerivedEditorialEdge = Readonly<{
  type: "CUT" | "CROSS_DISSOLVE"; overlapFrames: number; incomingStartFrame: number; audioCutFrame: number;
}>;
export type DerivedEditorialTimeline = Readonly<{
  video: readonly DerivedEditorialVideoClip[];
  audio: readonly DerivedEditorialAudioClip[];
  edges: readonly DerivedEditorialEdge[];
  timelineDurationFrames: number;
}>;

function requireSafe(value: number, detail: string): number {
  assertEditorial(Number.isSafeInteger(value), `${detail} must be a safe integer`);
  return value;
}

// Exact frame-aligned audio position: 48000 / 25 = 1920 samples per frame.
export function frameToSample(frame: number): number {
  assertEditorial(Number.isSafeInteger(frame) && frame >= 0, "frame-to-sample conversion requires a non-negative safe-integer frame");
  return requireSafe(frame * EDITORIAL_SAMPLES_PER_FRAME, "sample position");
}

// Integer-frame timeline: start[k+1] = start[k] + D[k] - T[k]; A1 cuts at incoming start + floor(T / 2).
export function deriveEditorialTimeline(
  clips: readonly EditorialTimelineClipInput[], edges: readonly EditorialTimelineEdgeInput[],
): DerivedEditorialTimeline {
  const count = clips.length;
  assertEditorial(count >= 1, "timeline requires at least one clip");
  assertEditorial(edges.length === count - 1, "timeline requires exactly one transition per adjacent clip pair");
  const overlaps = edges.map((edge, index) => {
    if (edge.type === "CUT") return 0;
    assertEditorial(Number.isSafeInteger(edge.overlapFrames) && edge.overlapFrames >= 1,
      `cross dissolve ${index + 1} requires a positive safe-integer overlap`);
    return edge.overlapFrames;
  });
  const video: DerivedEditorialVideoClip[] = [];
  let start = 0;
  for (const [index, clip] of clips.entries()) {
    const label = `clip ${index + 1}`;
    assertEditorial(Number.isSafeInteger(clip.assetDurationFrames) && clip.assetDurationFrames >= 1,
      `${label} requires a positive safe-integer asset duration`);
    assertEditorial(Number.isSafeInteger(clip.sourceInFrame) && clip.sourceInFrame >= 0,
      `${label} source in frame must be a non-negative safe integer`);
    assertEditorial(Number.isSafeInteger(clip.sourceOutFrame) && clip.sourceInFrame < clip.sourceOutFrame,
      `${label} source range must be non-empty`);
    assertEditorial(clip.sourceOutFrame <= clip.assetDurationFrames, `${label} source range exceeds the admitted asset`);
    const selected = clip.sourceOutFrame - clip.sourceInFrame;
    const left = index > 0 ? overlaps[index - 1]! : 0;
    const right = index < count - 1 ? overlaps[index]! : 0;
    assertEditorial(left + right <= selected - 1, `${label} transition overlaps must leave at least one independent frame`);
    const end = requireSafe(start + selected, `${label} timeline end`);
    video.push(freezeEditorial({
      sourceInFrame: clip.sourceInFrame, sourceOutFrame: clip.sourceOutFrame, selectedDurationFrames: selected,
      headSourceReserveFrames: clip.sourceInFrame, tailSourceReserveFrames: clip.assetDurationFrames - clip.sourceOutFrame,
      leftOverlapFrames: left, rightOverlapFrames: right, timelineStartFrame: start, timelineEndFrame: end,
    }));
    if (index < count - 1) start = requireSafe(start + selected - right, `${label} next timeline start`);
  }
  const timelineDurationFrames = video[count - 1]!.timelineEndFrame;
  assertEditorial(timelineDurationFrames > 0 && timelineDurationFrames <= EDITORIAL_MAX_TIMELINE_FRAMES,
    `timeline duration must be within 1..${EDITORIAL_MAX_TIMELINE_FRAMES} frames`);
  const cuts = [0];
  for (let index = 0; index < count - 1; index += 1) {
    cuts.push(video[index + 1]!.timelineStartFrame + Math.floor(overlaps[index]! / 2));
  }
  cuts.push(timelineDurationFrames);
  const audio = video.map((clip, index) => {
    const sourceInFrame = clip.sourceInFrame + Math.floor(clip.leftOverlapFrames / 2);
    const sourceOutFrame = clip.sourceOutFrame - Math.ceil(clip.rightOverlapFrames / 2);
    const timelineStartFrame = cuts[index]!;
    const timelineEndFrame = cuts[index + 1]!;
    assertEditorial(sourceOutFrame - sourceInFrame === timelineEndFrame - timelineStartFrame && sourceOutFrame > sourceInFrame,
      `clip ${index + 1} audio hard cut is inconsistent`);
    assertEditorial(sourceInFrame === clip.sourceInFrame + (timelineStartFrame - clip.timelineStartFrame),
      `clip ${index + 1} audio is not sync-locked to its picture`);
    return freezeEditorial({
      sourceInFrame, sourceOutFrame, sourceInSample: frameToSample(sourceInFrame), sourceOutSample: frameToSample(sourceOutFrame),
      timelineStartFrame, timelineEndFrame,
    });
  });
  const derivedEdges = overlaps.map((overlap, index) => freezeEditorial({
    type: edges[index]!.type, overlapFrames: overlap,
    incomingStartFrame: video[index + 1]!.timelineStartFrame, audioCutFrame: cuts[index + 1]!,
  }));
  return freezeEditorial({ video, audio, edges: derivedEdges, timelineDurationFrames });
}

// Representation-noise snap used for the conservative dialogue end bound (never under-protects).
export function ceilSnapToInteger(value: number): number {
  const nearest = Math.round(value);
  return Math.abs(value - nearest) <= Number.EPSILON * Math.max(1, Math.abs(value)) ? nearest : Math.ceil(value);
}

// Protected sample interval of a baked dialogue line inside its normalized asset. The start mirrors the
// existing adelay placement; the end may exceed the audible end by at most one sample (fail closed).
export function dialogueLineProtectedSampleRange(
  line: Readonly<{ startSeconds: number; durationSeconds: number }>, assetDurationFrames: number,
): Readonly<{ startSample: number; endSample: number }> {
  const startSample = requireSafe(Math.round(line.startSeconds * EDITORIAL_SAMPLE_RATE_HZ), "dialogue start sample");
  const rawEnd = requireSafe(startSample + ceilSnapToInteger(line.durationSeconds * EDITORIAL_SAMPLE_RATE_HZ),
    "dialogue end sample");
  return freezeEditorial({ startSample, endSample: Math.min(rawEnd, frameToSample(assetDurationFrames)) });
}

export type EditorialFrameContribution = Readonly<{ clipIndex: number; sourceFrame: number }>;

// Normalized-asset frame provenance for a timeline frame: one contributor, or two inside a dissolve.
export function locateEditorialTimelineFrame(
  timeline: DerivedEditorialTimeline, frame: number,
): Readonly<{ contributions: readonly EditorialFrameContribution[]; edgeIndex: number | null; audibleClipIndex: number }> {
  assertEditorial(Number.isSafeInteger(frame) && frame >= 0 && frame < timeline.timelineDurationFrames,
    "provenance frame must lie inside the timeline");
  const contributions = timeline.video.flatMap((clip, clipIndex) => (frame >= clip.timelineStartFrame && frame < clip.timelineEndFrame
    ? [freezeEditorial({ clipIndex, sourceFrame: clip.sourceInFrame + (frame - clip.timelineStartFrame) })] : []));
  assertEditorial(contributions.length === 1 || contributions.length === 2, "timeline frame must have one or two contributors");
  const audibleClipIndex = timeline.audio.findIndex((clip) => frame >= clip.timelineStartFrame && frame < clip.timelineEndFrame);
  assertEditorial(audibleClipIndex >= 0, "timeline frame must have exactly one audible clip");
  return freezeEditorial({
    contributions, edgeIndex: contributions.length === 2 ? contributions[0]!.clipIndex : null, audibleClipIndex,
  });
}
