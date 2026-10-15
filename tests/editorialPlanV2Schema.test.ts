import { describe, expect, it } from "vitest";
import { buildCompositionShotNormalizationPlan } from "../src/composition/buildCompositionShotNormalizationPlan.js";
import { buildDialogueCompositionShotNormalizationPlan } from "../src/composition/buildDialogueCompositionShotNormalizationPlan.js";
import type { PreparedEpisodeCompositionShot } from "../src/composition/prepareEpisodeComposition.js";
import { buildEpisodeRoughCutRenderPlan } from "../src/composition/buildEpisodeRoughCutRenderPlan.js";
import { buildEpisodeRoughCutFfmpegCommand } from "../src/composition/buildEpisodeRoughCutFfmpegCommand.js";
import { EpisodeManifestSchema } from "../src/schemas/episodeManifest.schema.js";
import { buildEditorialPlan, type BuildEditorialPlanInput } from "../src/editorial/buildEditorialPlan.js";
import { validateEditorialPlan } from "../src/editorial/validateEditorialPlan.js";
import { validateEditorialPlanAgainstSource } from "../src/editorial/validateEditorialPlanAgainstSource.js";
import { canonicalizeEditorialPlan, canonicalEditorialJson, hashEditorialPlan, editorialSha256 } from "../src/editorial/canonicalizeEditorialPlan.js";
import { resolveEditorialAssetPath } from "../src/editorial/resolveEditorialAssetPath.js";
import { buildEditorialRoughCutRenderPlan } from "../src/editorial/buildEditorialRoughCutRenderPlan.js";
import { buildEditorialPlanV2 } from "../src/editorial/buildEditorialPlanV2.js";
import { deriveEditorialPlanV2Timeline, validateEditorialPlanV2 } from "../src/editorial/validateEditorialPlanV2.js";
import { validateEditorialPlanV2AgainstSource } from "../src/editorial/validateEditorialPlanV2AgainstSource.js";
import { canonicalizeEditorialDecisions, canonicalizeEditorialPlanV2, hashEditorialDecisions, hashEditorialPlanV2 } from "../src/editorial/canonicalizeEditorialPlanV2.js";
import { downgradeE2EquivalentEditorialPlanV2ToV1, isE2EquivalentEditorialPlanV2, migrateEditorialPlanV1ToV2 } from "../src/editorial/migrateEditorialPlan.js";
import { parseEditorialDecisions, referencedEditorialDecisionShotIds, validateEditorialDecisionsAgainstSource } from "../src/editorial/validateEditorialDecisions.js";
import { ceilSnapToInteger, deriveEditorialTimeline, dialogueLineProtectedSampleRange, frameToSample, locateEditorialTimelineFrame } from "../src/editorial/deriveEditorialTimeline.js";
import { projectEditorialAssetV2ToV1, resolveEditorialAssetPathV2 } from "../src/editorial/resolveEditorialAssetPathV2.js";
import { buildEditorialEditRenderPlan, EDITORIAL_EDIT_RENDER_PROFILE_ID, hashE3RenderIdentityV1, planEditorialRenderV2, type EditorialEditRenderPlan } from "../src/editorial/buildEditorialEditRenderPlan.js";
import { assertEditorialEditRenderPreflight, EDITORIAL_EDIT_AUDIO_PREFLIGHT_STATUS } from "../src/editorial/editorialEditRenderPreflight.js";
import { buildEditorialEditFfmpegCommand, EDITORIAL_EDIT_AUDIO_SEGMENT_NORMALIZATION, EDITORIAL_EDIT_VIDEO_JOIN_NORMALIZATION, formatFrameSeconds25 } from "../src/editorial/buildEditorialEditFfmpegCommand.js";
import type { EditorialPlanV2 } from "../src/editorial/editorialPlanV2.schema.js";

// Local, in-memory fixtures only. Repeated in the six allowed files to avoid an extra helper path
// or importing another test module (which would register its tests more than once).
type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
function mutable<T>(value: T): Mutable<T> { return structuredClone(value) as Mutable<T>; }
type Spec = { seconds?: number; native?: boolean; dialogue?: boolean; scene?: string; overrun?: boolean; lineStart?: number; lineDuration?: number };
function fixture(specs: readonly Spec[] = [{}], mediaRoot = "D:/Busybookie/Production", options: { episodeId?: string; title?: string } = {}): BuildEditorialPlanInput {
  const postProduction = { aspectRatio: "16:9" as const, width: 1920, height: 1080, timelineFps: 25, audioSampleRateHz: 48000 };
  const scenes: { id: string; title: string; summary: string; shots: unknown[] }[] = [];
  specs.forEach((spec, i) => {
    const sceneId = spec.scene ?? "SC01";
    let scene = scenes.find((s) => s.id === sceneId);
    if (!scene) { scene = { id: sceneId, title: sceneId, summary: "Synthetic scene", shots: [] }; scenes.push(scene); }
    scene.shots.push({
      id: `S${String(i + 1).padStart(2, "0")}`, order: i + 1, title: `Shot ${i + 1}`, type: "ACTION",
      durationSeconds: spec.seconds ?? 4, characters: ["OLLIE"], visualAction: "Walk", camera: "Wide",
      dialogue: spec.dialogue ? [{ characterId: "OLLIE", text: "Hello" }] : [],
      audio: { sfx: [], ambience: "Non-rendering intent" },
      references: { required: false, assetIds: [], approvalStatus: "NOT_REQUIRED" },
      generation: { provider: "VEO", nativeAudio: spec.native ?? false, status: "PLANNED" }, continuityNotes: [],
    });
  });
  // Deliberately reverse scene and within-scene storage; global shot.order remains the authority.
  scenes.reverse(); scenes.forEach((s) => s.shots.reverse());
  const episode = EpisodeManifestSchema.parse({
    schemaVersion: "1.0", episodeId: options.episodeId ?? "EP02", title: options.title ?? "Synthetic episode", slug: "synthetic-episode", status: "DRAFT",
    audience: { description: "Children", minAgeYears: 3, maxAgeYears: 6 }, learningGoals: ["Share"],
    emotionalTheme: "Kindness", targetDurationSeconds: 60,
    approvals: { script: "PENDING", storyboard: "PENDING", references: "PENDING", roughCut: "PENDING", finalQc: "PENDING" }, scenes,
  });
  const ordered = episode.scenes.flatMap((s) => s.shots.map((shot) => ({ sceneId: s.id, shot }))).sort((a,b) => a.shot.order-b.shot.order);
  const shots: PreparedEpisodeCompositionShot[] = ordered.map(({sceneId, shot}, i) => {
    const spec = specs[i]!;
    const admitted = {
      sceneId, shotId: shot.id, order: shot.order, title: shot.title, durationSeconds: shot.durationSeconds,
      nativeAudio: shot.generation.nativeAudio, provider: "VEO" as const, providerExecutionId: `task-${i}`,
      sourceVideoPath: `D:/generated/${shot.id}.mp4`, sourceBytes: 100 + i, sourceSha256: String(i % 10).repeat(64), sourceContentType: null,
    };
    const sourceMedia = {
      sourceVideoPath: admitted.sourceVideoPath, formatName: "mp4", durationSeconds: shot.durationSeconds,
      video: { codecName: "h264", profile: "High", width: 1920, height: 1080, pixelFormat: "yuv420p", frameRate: 25 },
      audio: admitted.nativeAudio ? { codecName: "aac", profile: null, sampleRateHz: 48000, channels: 2, channelLayout: "stereo" } : null,
    };
    const args = { mediaRoot, episodeId: episode.episodeId, shot: admitted, sourceMedia, postProduction };
    const startSeconds = spec.lineStart ?? 0.123;
    const durationSeconds = spec.overrun ? shot.durationSeconds - startSeconds + 0.0000005 : (spec.lineDuration ?? 0.537);
    const normalizationPlan = spec.dialogue ? buildDialogueCompositionShotNormalizationPlan({
      ...args,
      dialogueAudio: {
        schemaVersion: "1.0", audioMode: "REPLACE_SOURCE_WITH_DIALOGUE", mixNativeAudio: false,
        episodeId: episode.episodeId, sceneId, shotId: shot.id, dialoguePlanKey: "a".repeat(64),
        shotDurationSeconds: shot.durationSeconds, sourceNativeAudio: admitted.nativeAudio,
        sourceAudioDisposition: admitted.nativeAudio ? "DISCARD_NATIVE_AUDIO" : "NO_SOURCE_AUDIO", audioKey: "b".repeat(64),
        lines: [{ lineNumber: 1, dialogueLineId: `${episode.episodeId}_${sceneId}_${shot.id}_L01`,
          sourceAudioPath: "D:/voice/line.wav", sourceSha256: "c".repeat(64), sourceBytes: 77, startSeconds, durationSeconds,
          endSeconds: Math.min(startSeconds + durationSeconds, shot.durationSeconds) }],
      },
    }) : buildCompositionShotNormalizationPlan(args);
    return { ...admitted, normalizationPlan, normalizationCacheStatus: "HIT",
      normalizedArtifact: { outputPath: normalizationPlan.outputPath, sha256: "d".repeat(64), bytes: 200,
        contentType: "video/mp4", durationSeconds: shot.durationSeconds, durationToleranceSeconds: 1/25 } };
  });
  return { episode, postProduction, mediaRoot, preparedComposition: { episodeId: episode.episodeId, title: episode.title,
    totalShots: shots.length, totalDurationSeconds: shots.reduce((sum, s) => sum + s.durationSeconds, 0), shots } };
}
function assertParity(input: BuildEditorialPlanInput) {
  const plan = buildEditorialPlan(input);
  validateEditorialPlanAgainstSource({ ...input, plan });
  const oldPlan = buildEpisodeRoughCutRenderPlan(input);
  const newPlan = buildEditorialRoughCutRenderPlan({ plan, mediaRoot: input.mediaRoot });
  expect(newPlan).toStrictEqual(oldPlan);
  expect(newPlan.renderKey).toBe(oldPlan.renderKey);
  expect(newPlan.outputPath).toBe(oldPlan.outputPath);
  const command = (p: typeof oldPlan) => buildEpisodeRoughCutFfmpegCommand({ ffmpegExecutable: "controlled-ffmpeg", plan: p, outputPath: p.outputPath });
  expect(command(newPlan)).toStrictEqual(command(oldPlan));
  return { plan, oldPlan, newPlan };
}

// E3 helpers (repeated per file; no shared helper path is authorized).
type ClipDecision = { shotId: string; sourceInFrame: number; sourceOutFrame: number };
type TransitionDecision = { outgoingShotId: string; incomingShotId: string; type: "CUT" }
  | { outgoingShotId: string; incomingShotId: string; type: "CROSS_DISSOLVE"; overlapFrames: number };
function shotOrderOf(input: BuildEditorialPlanInput): string[] {
  return EpisodeManifestSchema.parse(input.episode).scenes.flatMap((s) => s.shots).sort((a, b) => a.order - b.order).map((s) => s.id);
}
function manifestShaOf(input: BuildEditorialPlanInput): string {
  return editorialSha256(canonicalEditorialJson(EpisodeManifestSchema.parse(input.episode)));
}
function decisionsFor(input: BuildEditorialPlanInput, clips: ClipDecision[] = [], transitions: TransitionDecision[] = []) {
  const order = shotOrderOf(input);
  const referenced = new Set([...clips.map((c) => c.shotId), ...transitions.flatMap((t) => [t.outgoingShotId, t.incomingShotId])]);
  return {
    schemaVersion: "1.0", decisionsType: "BUSYBOOKIE_EDITORIAL_DECISIONS", episodeId: input.episode.episodeId,
    sourceBinding: {
      manifestSha256: manifestShaOf(input),
      shotAssets: order.filter((id) => referenced.has(id)).map((id) => ({
        shotId: id, normalizedAssetSha256: input.preparedComposition.shots[order.indexOf(id)]!.normalizedArtifact.sha256,
      })),
    },
    clips, transitions,
  };
}
const dissolve = (outgoingShotId: string, incomingShotId: string, overlapFrames: number): TransitionDecision =>
  ({ outgoingShotId, incomingShotId, type: "CROSS_DISSOLVE", overlapFrames });
const cut = (outgoingShotId: string, incomingShotId: string): TransitionDecision => ({ outgoingShotId, incomingShotId, type: "CUT" });
const trim = (shotId: string, sourceInFrame: number, sourceOutFrame: number): ClipDecision => ({ shotId, sourceInFrame, sourceOutFrame });
function evidenceFor(renderPlan: EditorialEditRenderPlan, extraFrames = 0, extraSamples = 0) {
  return renderPlan.inputs.map((entry) => ({
    assetId: entry.assetId, decodedVideoFrameCount: entry.assetDurationFrames + extraFrames,
    decodedAudioSampleCount: entry.assetDurationFrames * 1920 + extraSamples,
  }));
}

function defaultPlan(specs: Spec[] = [{}, {}, {}]): any {
  return structuredClone(buildEditorialPlanV2(fixture(specs), null));
}
function rejects(mutate: (plan: any) => void, specs?: Spec[]) {
  const plan = defaultPlan(specs);
  mutate(plan);
  expect(() => validateEditorialPlanV2(plan)).toThrow(/Editorial plan/);
}

describe("E3 schema 2.0 and intrinsic invariants", () => {
  it("T3-02 default 2.0 plan: strict shape, full ranges, all CUT, null decisions hash", () => {
    const plan = defaultPlan();
    expect(plan.schemaVersion).toBe("2.0");
    expect(plan.editorialDecisionsSha256).toBeNull();
    expect(plan.transitions.every((t: any) => t.type === "CUT" && !("overlapFrames" in t))).toBe(true);
    plan.tracks[0].clips.forEach((c: any, i: number) => {
      expect(c.sourceInFrame).toBe(0);
      expect(c.sourceOutFrame).toBe(plan.assets[i].assetDurationFrames);
    });
    expect(Object.keys(plan.shots[0]).sort()).toStrictEqual(["assetId", "order", "sceneId", "shotId", "title"]);
    expect(plan).not.toHaveProperty("assemblyMode");
    expect(plan).not.toHaveProperty("durationFrames");
    for (const path of [[], ["episode"], ["profile"], ["shots", 0], ["assets", 0], ["assets", 0, "normalization"],
      ["tracks", 0], ["tracks", 0, "clips", 0], ["tracks", 1, "clips", 0], ["tracks", 1, "clips", 0, "audio"], ["transitions", 0]]) {
      rejects((p) => { let node = p; for (const key of path) node = node[key]; node.unapproved = true; });
    }
    rejects((p) => { p.transitions[0].overlapFrames = 0; });
    rejects((p) => { p.schemaVersion = "1.0"; });
  });
  it("T3-14 zero-length clip is rejected", () => {
    rejects((p) => { p.tracks[0].clips[0].sourceOutFrame = p.tracks[0].clips[0].sourceInFrame; });
    const input = fixture([{}, {}]);
    expect(() => buildEditorialPlanV2(input, decisionsFor(input, [trim("S01", 40, 40)]))).toThrow(/Editorial plan/);
  });
  it("T3-15 negative and inverted ranges are rejected", () => {
    rejects((p) => { p.tracks[0].clips[0].sourceInFrame = -1; });
    rejects((p) => { p.tracks[0].clips[0].sourceInFrame = 60; p.tracks[0].clips[0].sourceOutFrame = 50; });
    const input = fixture([{}, {}]);
    expect(() => buildEditorialPlanV2(input, decisionsFor(input, [trim("S01", -3, 50)]))).toThrow(/Editorial plan/);
    expect(() => buildEditorialPlanV2(input, decisionsFor(input, [trim("S01", 70, 20)]))).toThrow(/Editorial plan/);
  });
  it("T3-16 source range past the admitted asset is rejected", () => {
    rejects((p) => { p.tracks[0].clips[2].sourceOutFrame = 101; });
    const input = fixture([{}, {}]);
    expect(() => buildEditorialPlanV2(input, decisionsFor(input, [trim("S02", 0, 101)]))).toThrow(/exceeds the admitted asset/);
  });
  it("T3-30 non-adjacent, out-of-order and duplicate edges are rejected", () => {
    rejects((p) => { p.transitions[0].incomingClipId = "V1-S03"; });
    rejects((p) => { p.transitions.reverse(); });
    rejects((p) => { p.transitions[1] = structuredClone(p.transitions[0]); });
    const input = fixture([{}, {}, {}]);
    expect(() => buildEditorialPlanV2(input, decisionsFor(input, [], [dissolve("S01", "S03", 5)]))).toThrow(/manifest-adjacent/);
  });
  it("T3-31 wrong transition edge count is rejected", () => {
    rejects((p) => { p.transitions.pop(); });
    rejects((p) => { p.transitions.push(structuredClone(p.transitions[0])); });
    expect(() => deriveEditorialTimeline([{ assetDurationFrames: 10, sourceInFrame: 0, sourceOutFrame: 10 }], [{ type: "CUT" }])).toThrow(/Editorial plan/);
  });
  it("T3-32 gaps (stored start or total mismatch) are rejected", () => {
    rejects((p) => { p.tracks[0].clips[1].timelineStartFrame += 1; });
    rejects((p) => { p.tracks[0].clips[1].timelineStartFrame -= 1; });
    rejects((p) => { p.tracks[1].clips[1].timelineStartFrame += 1; });
    rejects((p) => { p.timelineDurationFrames += 1; });
  });
  it("T3-35 unsafe, fractional and negative-zero frame values are rejected", () => {
    rejects((p) => { p.timelineDurationFrames = Number.MAX_SAFE_INTEGER + 1; });
    rejects((p) => { p.tracks[0].clips[0].sourceOutFrame = 99.5; });
    rejects((p) => { p.tracks[0].clips[0].sourceInFrame = -0; });
    rejects((p) => { p.assets[0].assetDurationFrames = 751; });
  });
  it("T3-36 no floating timeline authority: only integer frames are canonical timing", () => {
    const input = fixture([{ seconds: 0.28 }, { seconds: 1.12, dialogue: true, lineStart: 0.01, lineDuration: 0.2 }, { seconds: 2.2 }]);
    const plan = buildEditorialPlanV2(input, decisionsFor(input, [], [dissolve("S02", "S03", 3)]));
    const parsed = JSON.parse(canonicalizeEditorialPlanV2(plan));
    for (const clip of parsed.tracks[1].clips) delete clip.audio.lines;
    // Seconds appear only as baked dialogue evidence; no canonical timing field is expressed in seconds.
    expect(JSON.stringify(parsed)).not.toMatch(/Seconds"/);
    plan.tracks[0].clips.forEach((c) => [c.sourceInFrame, c.sourceOutFrame, c.timelineStartFrame].forEach((v) => expect(Number.isSafeInteger(v)).toBe(true)));
    expect(plan.assets.map((a) => a.assetDurationFrames)).toStrictEqual([7, 28, 55]);
    expect(plan.timelineDurationFrames).toBe(7 + 28 + 55 - 3);
    rejects((p) => { p.tracks[0].clips[1].timelineStartFrame = 100.000001; });
  });
  it("E3-V14 equal-content assets stay distinct logical assets; contradictory byte counts are rejected", () => {
    const plan = defaultPlan();
    expect(new Set(plan.assets.map((a: any) => a.sha256)).size).toBe(1);
    expect(new Set(plan.assets.map((a: any) => a.assetId)).size).toBe(3);
    expect(() => validateEditorialPlanV2(plan)).not.toThrow();
    rejects((p) => { p.assets[1].bytes += 1; });
  });
  it("T3-55 timeline bound 22,275,000 accepted exactly; bound + 1 rejected", () => {
    const full = Array.from({ length: 29_700 }, () => ({ assetDurationFrames: 750, sourceInFrame: 0, sourceOutFrame: 750 }));
    const cuts = Array.from({ length: 29_699 }, () => ({ type: "CUT" }) as const);
    const timeline = deriveEditorialTimeline(full, cuts);
    expect(timeline.timelineDurationFrames).toBe(22_275_000);
    expect(timeline.audio[timeline.audio.length - 1]!.sourceOutSample).toBe(750 * 1920);
    expect(frameToSample(timeline.timelineDurationFrames)).toBe(42_768_000_000);
    expect(() => deriveEditorialTimeline([...full, { assetDurationFrames: 1, sourceInFrame: 0, sourceOutFrame: 1 }], [...cuts, { type: "CUT" }]))
      .toThrow(/timeline duration must be within/);
    rejects((p) => { p.timelineDurationFrames = 22_275_001; });
  });
});
