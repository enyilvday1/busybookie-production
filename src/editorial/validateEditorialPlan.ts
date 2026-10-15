import { EditorialPlanSchema, type EditorialPlan } from "./editorialPlan.schema.js";

export function assertEditorial(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(`Editorial plan ${detail}.`);
}

export function editorialDurationFrames(seconds: unknown): number {
  assertEditorial(typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 && seconds <= 30,
    "NON_FRAME_ALIGNED_DURATION requires finite seconds in (0,30]");
  const x = seconds * 25;
  const candidate = Math.round(x);
  const bound = Number.EPSILON * Math.max(1, Math.abs(x));
  assertEditorial(Number.isSafeInteger(candidate) && candidate >= 1 && candidate <= 750 &&
    Math.abs(x - candidate) <= bound && candidate / 25 === seconds, "NON_FRAME_ALIGNED_DURATION");
  return candidate;
}

export function freezeEditorial<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeEditorial(child);
    Object.freeze(value);
  }
  return value;
}

export function validateEditorialPlan(input: unknown): EditorialPlan {
  const parsed = EditorialPlanSchema.safeParse(input);
  assertEditorial(parsed.success, `schema validation failed: ${parsed.error?.message ?? ""}`);
  const plan = parsed.data;
  const count = plan.shots.length;
  const [video, audio] = plan.tracks;
  assertEditorial(plan.assets.length === count && video.clips.length === count && audio.clips.length === count,
    "requires exactly one asset and one clip per track for each shot");
  const ids = new Set<string>();
  const contents = new Map<string, number>();
  let end = 0;
  for (const [index, shot] of plan.shots.entries()) {
    assertEditorial(!ids.has(shot.shotId) && shot.order === index + 1, "requires unique continuous ordered shots");
    ids.add(shot.shotId);
    const asset = plan.assets[index]!;
    const v = video.clips[index]!;
    const a = audio.clips[index]!;
    const identity = `normalized:${plan.episode.episodeId}:${shot.shotId}`;
    assertEditorial(shot.assetId === identity && asset.assetId === identity, "shot/asset identity or first-use order mismatch");
    const locator = `cache/composition-normalized/${plan.episode.episodeId}/${shot.shotId}/${plan.episode.episodeId}_${shot.shotId}_${asset.normalization.cacheKey}.mp4`;
    assertEditorial(asset.mediaRootRelativePath === locator, "asset locator identity mismatch");
    assertEditorial(v.shotId === shot.shotId && v.clipId === `V1-${shot.shotId}` && v.assetId === identity,
      "V1 shot/clip/asset binding mismatch");
    assertEditorial(v.durationFrames === shot.durationFrames && v.sourceInFrame === 0 &&
      v.sourceOutFrame === shot.durationFrames && v.timelineStartFrame === end, "V1 source range or timeline mismatch");
    end += shot.durationFrames;
    assertEditorial(Number.isSafeInteger(end), "unsafe timeline aggregate");
    assertEditorial(a.shotId === shot.shotId && a.clipId === `A1-${shot.shotId}` && a.linkedClipId === v.clipId &&
      a.assetId === v.assetId && a.timelineStartFrame === v.timelineStartFrame && a.durationFrames === v.durationFrames &&
      a.sourceInFrame === v.sourceInFrame && a.sourceOutFrame === v.sourceOutFrame, "A1 must exactly mirror V1");
    assertEditorial((a.audio.mode === "REPLACE_SOURCE_WITH_DIALOGUE") === (asset.normalization.schemaVersion === "2.0"),
      "audio mode does not match normalization profile");
    if (a.audio.mode === "REPLACE_SOURCE_WITH_DIALOGUE") {
      let previousEnd = 0;
      const seconds = shot.durationFrames / 25;
      for (const [lineIndex, line] of a.audio.lines.entries()) {
        const number = lineIndex + 1;
        assertEditorial(line.lineNumber === number &&
          line.dialogueLineId === `${plan.episode.episodeId}_${shot.sceneId}_${shot.shotId}_L${String(number).padStart(2, "0")}`,
        "dialogue line identity/order mismatch");
        const lineEnd = line.startSeconds + line.durationSeconds;
        assertEditorial(Number.isFinite(lineEnd) && lineEnd <= seconds + 0.000001 && line.startSeconds >= previousEnd,
          "dialogue timing exceeds shot or overlaps");
        previousEnd = Math.min(lineEnd, seconds);
      }
    }
    assertEditorial(!contents.has(asset.sha256) || contents.get(asset.sha256) === asset.bytes,
      "equal-content byte counts contradict each other");
    contents.set(asset.sha256, asset.bytes);
  }
  assertEditorial(end === plan.durationFrames, "durationFrames does not equal the timeline aggregate");
  return freezeEditorial(plan);
}
