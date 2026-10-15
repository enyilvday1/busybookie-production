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

const clipIn = (asset: number, sourceInFrame: number, sourceOutFrame: number) => ({ assetDurationFrames: asset, sourceInFrame, sourceOutFrame });
const CUT = { type: "CUT" } as const;
const xd = (overlapFrames: number) => ({ type: "CROSS_DISSOLVE", overlapFrames }) as const;

function rangesOf(plan: EditorialPlanV2) {
  return {
    video: plan.tracks[0].clips.map((c) => [c.sourceInFrame, c.sourceOutFrame, c.timelineStartFrame]),
    audio: plan.tracks[1].clips.map((c) => [c.sourceInFrame, c.sourceOutFrame, c.timelineStartFrame]),
  };
}

describe("E3 trims through the 2.0 builder", () => {
  it("T3-09 head trim selects [in, asset) and shifts later starts", () => {
    const input = fixture([{}, {}]);
    const plan = buildEditorialPlanV2(input, decisionsFor(input, [trim("S01", 10, 100)]));
    expect(rangesOf(plan)).toStrictEqual({ video: [[10, 100, 0], [0, 100, 90]], audio: [[10, 100, 0], [0, 100, 90]] });
    expect(plan.timelineDurationFrames).toBe(190);
  });
  it("T3-10 tail trim selects [0, out)", () => {
    const input = fixture([{}, {}]);
    const plan = buildEditorialPlanV2(input, decisionsFor(input, [trim("S01", 0, 80)]));
    expect(rangesOf(plan).video).toStrictEqual([[0, 80, 0], [0, 100, 80]]);
    expect(plan.timelineDurationFrames).toBe(180);
  });
  it("T3-11 both-side trim", () => {
    const input = fixture([{}, {}]);
    const plan = buildEditorialPlanV2(input, decisionsFor(input, [trim("S02", 10, 90)]));
    expect(rangesOf(plan).video).toStrictEqual([[0, 100, 0], [10, 90, 100]]);
    expect(plan.timelineDurationFrames).toBe(180);
  });
  it("T3-12 explicit full range resolves to the same edit as defaults", () => {
    const input = fixture([{}, {}]);
    const explicit = buildEditorialPlanV2(input, decisionsFor(input, [trim("S01", 0, 100), trim("S02", 0, 100)]));
    const defaults = buildEditorialPlanV2(input, null);
    expect(explicit.tracks).toStrictEqual(defaults.tracks);
    expect(explicit.transitions).toStrictEqual(defaults.transitions);
    expect(explicit.editorialDecisionsSha256).not.toBeNull();
    expect(defaults.editorialDecisionsSha256).toBeNull();
  });
  it("T3-13 one-frame clip is legal", () => {
    const input = fixture([{}, {}]);
    const plan = buildEditorialPlanV2(input, decisionsFor(input, [trim("S01", 50, 51)]));
    expect(rangesOf(plan).video).toStrictEqual([[50, 51, 0], [0, 100, 1]]);
    expect(plan.timelineDurationFrames).toBe(101);
  });
});

describe("E3 source reserve (derived, never stored)", () => {
  it("T3-17 head source reserve equals sourceInFrame", () => {
    const timeline = deriveEditorialTimeline([clipIn(100, 12, 100)], []);
    expect(timeline.video[0]!.headSourceReserveFrames).toBe(12);
  });
  it("T3-18 tail source reserve equals asset minus sourceOutFrame", () => {
    const timeline = deriveEditorialTimeline([clipIn(100, 0, 73)], []);
    expect(timeline.video[0]!.tailSourceReserveFrames).toBe(27);
  });
  it("T3-19 full range has zero reserve on both sides", () => {
    const plan = buildEditorialPlanV2(fixture([{}]), null);
    const derived = deriveEditorialPlanV2Timeline(plan).video[0]!;
    expect([derived.headSourceReserveFrames, derived.tailSourceReserveFrames]).toStrictEqual([0, 0]);
  });
  it("T3-20 no media exists beyond the admitted asset range and no handle fields are accepted", () => {
    expect(() => deriveEditorialTimeline([clipIn(100, 0, 101)], [])).toThrow(/exceeds the admitted asset/);
    expect(() => deriveEditorialTimeline([clipIn(100, -1, 50)], [])).toThrow(/Editorial plan/);
    const plan = structuredClone(buildEditorialPlanV2(fixture([{}]), null)) as any;
    plan.tracks[0].clips[0].handleFrames = 5;
    expect(() => validateEditorialPlanV2(plan)).toThrow(/Editorial plan/);
    const asset = structuredClone(buildEditorialPlanV2(fixture([{}]), null)) as any;
    asset.assets[0].syntheticTailFrames = 0;
    expect(() => validateEditorialPlanV2(asset)).toThrow(/Editorial plan/);
  });
});

describe("E3 transitions", () => {
  it("T3-21 all-CUT default plan has contiguous starts", () => {
    const plan = buildEditorialPlanV2(fixture([{}, {}, {}]), null);
    expect(plan.transitions.map((t) => t.type)).toStrictEqual(["CUT", "CUT"]);
    expect(plan.tracks[0].clips.map((c) => c.timelineStartFrame)).toStrictEqual([0, 100, 200]);
  });
  it("T3-22 single cross dissolve overlaps the clips by T frames", () => {
    const input = fixture([{}, {}]);
    const plan = buildEditorialPlanV2(input, decisionsFor(input, [], [dissolve("S01", "S02", 10)]));
    expect(plan.transitions).toStrictEqual([{ outgoingClipId: "V1-S01", incomingClipId: "V1-S02", type: "CROSS_DISSOLVE", overlapFrames: 10 }]);
    expect(plan.tracks[0].clips.map((c) => c.timelineStartFrame)).toStrictEqual([0, 90]);
    expect(plan.timelineDurationFrames).toBe(190);
  });
  it("T3-23 first adjacency edge (1->2) may dissolve", () => {
    const input = fixture([{}, {}, {}]);
    const plan = buildEditorialPlanV2(input, decisionsFor(input, [], [dissolve("S01", "S02", 8)]));
    expect(plan.transitions.map((t) => t.type)).toStrictEqual(["CROSS_DISSOLVE", "CUT"]);
    expect(plan.tracks[0].clips.map((c) => c.timelineStartFrame)).toStrictEqual([0, 92, 192]);
  });
  it("T3-24 last adjacency edge (N-1->N) may dissolve", () => {
    const input = fixture([{}, {}, {}]);
    const plan = buildEditorialPlanV2(input, decisionsFor(input, [], [dissolve("S02", "S03", 8)]));
    expect(plan.transitions.map((t) => t.type)).toStrictEqual(["CUT", "CROSS_DISSOLVE"]);
    expect(plan.tracks[0].clips.map((c) => c.timelineStartFrame)).toStrictEqual([0, 100, 192]);
  });
  it("T3-25 three-plus clips with mixed edges", () => {
    const input = fixture([{}, {}, {}, {}]);
    const plan = buildEditorialPlanV2(input, decisionsFor(input, [trim("S03", 5, 95)], [dissolve("S01", "S02", 10), dissolve("S03", "S04", 6)]));
    expect(plan.tracks[0].clips.map((c) => c.timelineStartFrame)).toStrictEqual([0, 90, 190, 274]);
    expect(plan.timelineDurationFrames).toBe(374);
  });
  it("T3-26 adjacent dissolves on one clip are allowed while a solo frame remains", () => {
    const timeline = deriveEditorialTimeline([clipIn(100, 0, 100), clipIn(30, 0, 30), clipIn(100, 0, 100)], [xd(14), xd(15)]);
    expect(timeline.video[1]!.leftOverlapFrames + timeline.video[1]!.rightOverlapFrames).toBe(29);
    expect(timeline.video.map((v) => v.timelineStartFrame)).toStrictEqual([0, 86, 101]);
  });
  it("T3-27 minimum dissolve overlap is one frame", () => {
    const timeline = deriveEditorialTimeline([clipIn(2, 0, 2), clipIn(2, 0, 2)], [xd(1)]);
    expect(timeline.video.map((v) => v.timelineStartFrame)).toStrictEqual([0, 1]);
    expect(timeline.timelineDurationFrames).toBe(3);
    expect(() => deriveEditorialTimeline([clipIn(2, 0, 2), clipIn(2, 0, 2)], [{ type: "CROSS_DISSOLVE", overlapFrames: 0 }])).toThrow(/positive/);
  });
  it("T3-28 maximum valid overlap satisfies L + R = D - 1 exactly", () => {
    expect(deriveEditorialTimeline([clipIn(10, 0, 10), clipIn(10, 0, 10)], [xd(9)]).timelineDurationFrames).toBe(11);
    expect(deriveEditorialTimeline([clipIn(100, 0, 100), clipIn(10, 0, 10), clipIn(100, 0, 100)], [xd(4), xd(5)]).timelineDurationFrames).toBe(201);
  });
  it("T3-29 excessive overlap is rejected (including abutting double dissolves)", () => {
    expect(() => deriveEditorialTimeline([clipIn(10, 0, 10), clipIn(10, 0, 10)], [xd(10)])).toThrow(/independent frame/);
    expect(() => deriveEditorialTimeline([clipIn(100, 0, 100), clipIn(10, 0, 10), clipIn(100, 0, 100)], [xd(4), xd(6)])).toThrow(/independent frame/);
    const input = fixture([{}, {}]);
    expect(() => buildEditorialPlanV2(input, decisionsFor(input, [trim("S01", 0, 10)], [dissolve("S01", "S02", 10)]))).toThrow(/independent frame/);
  });
});

describe("E3 timeline mathematics", () => {
  it("T3-33 exact starts follow start[k+1] = start[k] + D[k] - T[k]", () => {
    const timeline = deriveEditorialTimeline([clipIn(125, 0, 125), clipIn(150, 0, 150), clipIn(100, 0, 100)], [xd(10), CUT]);
    expect(timeline.video.map((v) => [v.timelineStartFrame, v.timelineEndFrame])).toStrictEqual([[0, 125], [115, 265], [265, 365]]);
  });
  it("T3-34 duration equals sum(D) - sum(T) across many configurations", () => {
    for (let n = 1; n <= 6; n += 1) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const clips = Array.from({ length: n }, (_, k) => { const d = 3 + ((seed * (k + 7)) % 40); return clipIn(d + 5, 2, d + 2); });
        const edges = Array.from({ length: n - 1 }, (_, k) => ((seed + k) % 3 === 0 ? CUT : xd(1)));
        const timeline = deriveEditorialTimeline(clips, edges);
        const sumD = clips.reduce((s, c) => s + c.sourceOutFrame - c.sourceInFrame, 0);
        const sumT = edges.reduce((s, e) => s + (e.type === "CUT" ? 0 : e.overlapFrames), 0);
        expect(timeline.timelineDurationFrames).toBe(sumD - sumT);
        expect(Number.isInteger(timeline.timelineDurationFrames)).toBe(true);
      }
    }
  });
});

describe("E3 audio hard cut", () => {
  it("T3-37 even overlap: audio cut at incoming start + T/2", () => {
    const t = deriveEditorialTimeline([clipIn(100, 0, 100), clipIn(100, 0, 100)], [xd(10)]);
    expect(t.edges[0]!.audioCutFrame).toBe(95);
    expect(t.audio.map((a) => [a.sourceInFrame, a.sourceOutFrame, a.timelineStartFrame, a.timelineEndFrame])).toStrictEqual([[0, 95, 0, 95], [5, 100, 95, 190]]);
  });
  it("T3-38 odd overlap: floor(T/2) on the incoming side, ceil(T/2) on the outgoing side", () => {
    const t = deriveEditorialTimeline([clipIn(100, 0, 100), clipIn(100, 0, 100)], [xd(9)]);
    expect(t.edges[0]!.incomingStartFrame).toBe(91);
    expect(t.edges[0]!.audioCutFrame).toBe(95);
    expect(t.audio.map((a) => [a.sourceInFrame, a.sourceOutFrame, a.timelineStartFrame, a.timelineEndFrame])).toStrictEqual([[0, 95, 0, 95], [4, 100, 95, 191]]);
  });
  it("T3-39 audio source mapping is sync-locked to its own picture on both sides of every cut", () => {
    const t = deriveEditorialTimeline([clipIn(100, 7, 100), clipIn(120, 3, 120), clipIn(90, 0, 80)], [xd(11), xd(6)]);
    t.audio.forEach((a, k) => {
      const v = t.video[k]!;
      expect(a.sourceInFrame - v.sourceInFrame).toBe(a.timelineStartFrame - v.timelineStartFrame);
      expect(a.sourceOutFrame - v.sourceInFrame).toBe(a.timelineEndFrame - v.timelineStartFrame);
    });
  });
  it("T3-40 A1 is contiguous, gap-free, non-overlapping and positive for every legal configuration", () => {
    for (let d1 = 2; d1 <= 8; d1 += 1) for (let d2 = 2; d2 <= 8; d2 += 1) for (let t1 = 0; t1 < d1; t1 += 1) for (let t2 = 0; t2 < d2; t2 += 1) {
      if (t1 + t2 > d2 - 1 || t2 > 4) continue;
      const t = deriveEditorialTimeline([clipIn(d1, 0, d1), clipIn(d2, 0, d2), clipIn(5, 0, 5)], [t1 ? xd(t1) : CUT, t2 ? xd(t2) : CUT]);
      expect(t.audio[0]!.timelineStartFrame).toBe(0);
      t.audio.forEach((a, k) => {
        expect(a.timelineEndFrame - a.timelineStartFrame).toBeGreaterThanOrEqual(1);
        if (k > 0) expect(a.timelineStartFrame).toBe(t.audio[k - 1]!.timelineEndFrame);
      });
      expect(t.audio[t.audio.length - 1]!.timelineEndFrame).toBe(t.timelineDurationFrames);
    }
  });
  it("T3-41 1920 samples per frame, exact and safe", () => {
    expect(frameToSample(0)).toBe(0);
    expect(frameToSample(1)).toBe(1920);
    expect(frameToSample(750)).toBe(1_440_000);
    expect(frameToSample(22_275_000)).toBe(42_768_000_000);
    expect(Number.isSafeInteger(frameToSample(22_275_000))).toBe(true);
    for (const bad of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER]) expect(() => frameToSample(bad)).toThrow(/Editorial plan/);
    const t = deriveEditorialTimeline([clipIn(100, 0, 100), clipIn(100, 0, 100)], [xd(9)]);
    t.audio.forEach((a) => {
      expect(a.sourceInSample).toBe(a.sourceInFrame * 1920);
      expect(a.sourceOutSample).toBe(a.sourceOutFrame * 1920);
    });
  });
});

describe("E3 provenance", () => {
  it("T3-48 overlap frames identify both contributing clips, the edge and normalized source frames", () => {
    const t = deriveEditorialTimeline([clipIn(100, 10, 100), clipIn(100, 0, 100)], [xd(10)]);
    expect(locateEditorialTimelineFrame(t, 79)).toStrictEqual({ contributions: [{ clipIndex: 0, sourceFrame: 89 }], edgeIndex: null, audibleClipIndex: 0 });
    expect(locateEditorialTimelineFrame(t, 80)).toStrictEqual({ contributions: [{ clipIndex: 0, sourceFrame: 90 }, { clipIndex: 1, sourceFrame: 0 }], edgeIndex: 0, audibleClipIndex: 0 });
    expect(locateEditorialTimelineFrame(t, 85)).toStrictEqual({ contributions: [{ clipIndex: 0, sourceFrame: 95 }, { clipIndex: 1, sourceFrame: 5 }], edgeIndex: 0, audibleClipIndex: 1 });
    expect(locateEditorialTimelineFrame(t, 90)).toStrictEqual({ contributions: [{ clipIndex: 1, sourceFrame: 10 }], edgeIndex: null, audibleClipIndex: 1 });
    expect(() => locateEditorialTimelineFrame(t, t.timelineDurationFrames)).toThrow(/Editorial plan/);
  });
});
