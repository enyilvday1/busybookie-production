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

const parityFixtures: [string, Spec[]][] = [
  ["native", [{ native: true }]],
  ["silence", [{}]],
  ["dialogue", [{ dialogue: true }]],
  ["mixed multi-scene", [{ native: true, scene: "SC02" }, { dialogue: true }, {}, { dialogue: true, native: true, scene: "SC02" }]],
  ["noisy fractional", [{ seconds: 0.28 }, { seconds: 1.12 }, { seconds: 2.2 }]],
];
const roots = ["D:/Busybookie/Production", "D:\\Busybookie\\Production"];
const exe = "C:/controlled/never-launched/ffmpeg.exe";

function legacyCommand(plan: ReturnType<typeof buildEpisodeRoughCutRenderPlan>) {
  return buildEpisodeRoughCutFfmpegCommand({ ffmpegExecutable: exe, plan, outputPath: plan.outputPath.replace(/\.mp4$/, ".parity.mp4") });
}
function e3(input: BuildEditorialPlanInput, document: unknown, mediaRoot = input.mediaRoot) {
  const route = planEditorialRenderV2({ plan: buildEditorialPlanV2(input, document), mediaRoot });
  expect(route.route).toBe("E3_EDIT");
  return route.renderPlan as EditorialEditRenderPlan;
}
function commandFor(renderPlan: EditorialEditRenderPlan) {
  const preflight = assertEditorialEditRenderPreflight({ renderPlan, evidence: evidenceFor(renderPlan) });
  return buildEditorialEditFfmpegCommand({ ffmpegExecutable: exe, renderPlan, preflight, outputPath: renderPlan.outputPath });
}

describe("E3 E2-compatibility route", () => {
  for (const root of roots) {
    it.each(parityFixtures)(`T3-03 E2-equivalent 2.0 plans route to the exact legacy render plan (root ${JSON.stringify(root)}): %s`, (_label, specs) => {
      const source = fixture(specs, root);
      const v1 = buildEditorialPlan(source);
      const route = planEditorialRenderV2({ plan: migrateEditorialPlanV1ToV2(v1), mediaRoot: root });
      expect(route.route).toBe("E2_ROUGH_CUT");
      if (route.route !== "E2_ROUGH_CUT") throw new Error("route");
      const legacy = buildEpisodeRoughCutRenderPlan(source);
      expect(route.renderPlan).toStrictEqual(legacy);
      expect(route.renderPlan).toStrictEqual(buildEditorialRoughCutRenderPlan({ plan: v1, mediaRoot: root }));
      expect(route.renderPlan.renderKey).toBe(legacy.renderKey);
      expect(route.renderPlan.outputPath).toBe(legacy.outputPath);
      expect(route.renderPlan.shots.map((s) => [s.shotId, s.sourceVideoPath])).toStrictEqual(legacy.shots.map((s) => [s.shotId, s.sourceVideoPath]));
      expect(route.renderPlan.totalDurationSeconds).toBe(legacy.totalDurationSeconds);
    });
  }
  it.each(parityFixtures)("T3-04 E2 FFmpeg executable and argv are exactly equal through the caller-side legacy builder: %s", (_label, specs) => {
    const source = fixture(specs);
    const route = planEditorialRenderV2({ plan: buildEditorialPlanV2(source, null), mediaRoot: source.mediaRoot });
    if (route.route !== "E2_ROUGH_CUT") throw new Error("expected the E2 route");
    const fresh = legacyCommand(route.renderPlan);
    const legacy = legacyCommand(buildEpisodeRoughCutRenderPlan(source));
    expect(fresh.executable).toBe(legacy.executable);
    expect(fresh.args).toStrictEqual(legacy.args);
    expect(fresh).toStrictEqual(legacy);
  });
});

describe("E3 defaults and routing", () => {
  it("T3-44 absent vs explicit all-default decisions: same resolved edit, different plan hashes, identical E2 render", () => {
    const input = fixture([{}, { dialogue: true }]);
    const absent = buildEditorialPlanV2(input, null);
    const explicit = buildEditorialPlanV2(input, decisionsFor(input));
    expect({ ...explicit, editorialDecisionsSha256: null }).toStrictEqual(absent);
    expect(hashEditorialPlanV2(explicit)).not.toBe(hashEditorialPlanV2(absent));
    const a = planEditorialRenderV2({ plan: absent, mediaRoot: input.mediaRoot });
    const b = planEditorialRenderV2({ plan: explicit, mediaRoot: input.mediaRoot });
    expect(a.route).toBe("E2_ROUGH_CUT");
    expect(b).toStrictEqual(a);
    if (a.route !== "E2_ROUGH_CUT" || b.route !== "E2_ROUGH_CUT") throw new Error("route");
    expect(legacyCommand(b.renderPlan)).toStrictEqual(legacyCommand(a.renderPlan));
  });

  it("T3-47 mixed join chains, golden filter graph, normalization on every join operand and E2-equivalence negatives", () => {
    const N = EDITORIAL_EDIT_VIDEO_JOIN_NORMALIZATION;
    const A = EDITORIAL_EDIT_AUDIO_SEGMENT_NORMALIZATION;
    // CUT -> CROSS_DISSOLVE with an exact, independently written filter graph.
    const three = fixture([{}, {}, {}]);
    const cutThenDissolve = e3(three, decisionsFor(three, [trim("S01", 10, 100)], [cut("S01", "S02"), dissolve("S02", "S03", 9)]));
    const graph = commandFor(cutThenDissolve).args[commandFor(cutThenDissolve).args.indexOf("-filter_complex") + 1];
    expect(graph).toBe([
      `[0:v:0]trim=start_frame=10:end_frame=100,${N}[v0]`,
      `[1:v:0]trim=start_frame=0:end_frame=100,${N}[v1]`,
      `[2:v:0]trim=start_frame=0:end_frame=100,${N}[v2]`,
      `[v0][v1]concat=n=2:v=1:a=0,${N}[vj0]`,
      `[vj0][v2]xfade=transition=fade:duration=0.36:offset=7.24,${N}[vout]`,
      `[0:a:0]atrim=start_sample=19200:end_sample=192000,${A}[a0]`,
      `[1:a:0]atrim=start_sample=0:end_sample=182400,${A}[a1]`,
      `[2:a:0]atrim=start_sample=7680:end_sample=192000,${A}[a2]`,
      "[a0][a1][a2]concat=n=3:v=0:a=1[aout]",
    ].join(";"));
    expect(cutThenDissolve.videoSegments.map((s) => s.timelineStartFrame)).toStrictEqual([0, 90, 181]);
    expect(formatFrameSeconds25(181)).toBe("7.24");
    // DISSOLVE -> CUT, DISSOLVE -> DISSOLVE and a longer mixed chain.
    const chains: [string, TransitionDecision[], number, string[]][] = [
      ["dissolve->cut", [dissolve("S01", "S02", 10), cut("S02", "S03")], 3, ["xfade", "concat"]],
      ["dissolve->dissolve", [dissolve("S01", "S02", 10), dissolve("S02", "S03", 7)], 3, ["xfade", "xfade"]],
      ["longer mixed", [dissolve("S01", "S02", 6), cut("S02", "S03"), dissolve("S03", "S04", 5), cut("S04", "S05")], 5, ["xfade", "concat", "xfade", "concat"]],
    ];
    for (const [label, transitions, shots, operations] of chains) {
      const input = fixture(Array.from({ length: shots }, () => ({})));
      const renderPlan = e3(input, decisionsFor(input, [], transitions));
      const args = commandFor(renderPlan).args;
      const filters = args[args.indexOf("-filter_complex") + 1]!.split(";");
      const joins = filters.filter((f) => f.startsWith("[v") && (f.includes("concat=n=2") || f.includes("xfade=")));
      expect(joins.map((f) => (f.includes("xfade=") ? "xfade" : "concat")), label).toStrictEqual(operations);
      expect(filters.filter((f) => f.includes(N)).length, label).toBe(shots + (shots - 1));
      renderPlan.videoJoins.forEach((join, index) => {
        if (join.type === "CROSS_DISSOLVE") {
          expect(joins[index], label).toContain(`offset=${formatFrameSeconds25(join.incomingStartFrame)}`);
          expect(joins[index], label).toContain(`duration=${formatFrameSeconds25(join.overlapFrames)}`);
          expect(join.incomingStartFrame).toBe(renderPlan.videoSegments[index + 1]!.timelineStartFrame);
        }
      });
      expect(args.join(" "), label).not.toMatch(/amix|acrossfade|volume=|loudnorm|afade/);
    }
    // E2-equivalence negatives: each is routed to the edit profile.
    const pair = fixture([{}, {}]);
    const headTrim = buildEditorialPlanV2(pair, decisionsFor(pair, [trim("S01", 1, 100)]));
    expect(isE2EquivalentEditorialPlanV2(headTrim)).toBe(false);
    expect(planEditorialRenderV2({ plan: headTrim, mediaRoot: pair.mediaRoot }).route).toBe("E3_EDIT");
    const tailTrim = buildEditorialPlanV2(pair, decisionsFor(pair, [trim("S02", 0, 99)]));
    expect(isE2EquivalentEditorialPlanV2(tailTrim)).toBe(false);
    expect(planEditorialRenderV2({ plan: tailTrim, mediaRoot: pair.mediaRoot }).route).toBe("E3_EDIT");
    const oneFrameDissolve = buildEditorialPlanV2(pair, decisionsFor(pair, [], [dissolve("S01", "S02", 1)]));
    expect(isE2EquivalentEditorialPlanV2(oneFrameDissolve)).toBe(false);
    const wrongRange = structuredClone(buildEditorialPlanV2(pair, null)) as any;
    wrongRange.tracks[0].clips[1].sourceOutFrame = 99;
    wrongRange.tracks[1].clips[1].sourceOutFrame = 99;
    wrongRange.timelineDurationFrames = 199;
    expect(isE2EquivalentEditorialPlanV2(wrongRange)).toBe(false);
    const wrongA1 = structuredClone(buildEditorialPlanV2(pair, null)) as any;
    wrongA1.tracks[1].clips[0].sourceInFrame = 1;
    expect(() => isE2EquivalentEditorialPlanV2(wrongA1)).toThrow(/Editorial plan/);
    expect(() => planEditorialRenderV2({ plan: wrongA1, mediaRoot: pair.mediaRoot })).toThrow(/Editorial plan/);
    const defaults = buildEditorialPlanV2(pair, decisionsFor(pair));
    expect(isE2EquivalentEditorialPlanV2(defaults)).toBe(true);
    expect(() => buildEditorialEditRenderPlan({ plan: defaults, mediaRoot: pair.mediaRoot })).toThrow(/compatibility route/);
  });
});

describe("E3 render identity", () => {
  const three = fixture([{}, {}, {}]);
  const baseDecisions = decisionsFor(three, [trim("S01", 10, 100)], [dissolve("S01", "S02", 6)]);
  const base = e3(three, baseDecisions);

  it("T3-49 renderKey ignores provenance and naming but changes with every render-effective value", () => {
    const sameEditOtherDocument = e3(three, decisionsFor(three, [trim("S01", 10, 100)], [dissolve("S01", "S02", 6), cut("S02", "S03")]));
    expect(buildEditorialPlanV2(three, decisionsFor(three, [trim("S01", 10, 100)], [dissolve("S01", "S02", 6), cut("S02", "S03")])).editorialDecisionsSha256)
      .not.toBe(hashEditorialDecisions(baseDecisions));
    expect(sameEditOtherDocument.renderKey).toBe(base.renderKey);
    const retitled = fixture([{}, {}, {}], "D:/Busybookie/Production", { title: "A different title" });
    expect(e3(retitled, decisionsFor(retitled, [trim("S01", 10, 100)], [dissolve("S01", "S02", 6)])).renderKey).toBe(base.renderKey);
    const otherEpisode = fixture([{}, {}, {}], "D:/Busybookie/Production", { episodeId: "EP03" });
    const otherEpisodePlan = e3(otherEpisode, decisionsFor(otherEpisode, [trim("S01", 10, 100)], [dissolve("S01", "S02", 6)]));
    expect(otherEpisodePlan.renderKey).toBe(base.renderKey);
    expect(otherEpisodePlan.outputPath).not.toBe(base.outputPath);
    const moved = e3(three, baseDecisions, "E:/Relocated/Media");
    expect(moved.renderKey).toBe(base.renderKey);
    expect(moved.inputs[0]!.sourceVideoPath).not.toBe(base.inputs[0]!.sourceVideoPath);
    const regenerated = mutable(three);
    regenerated.preparedComposition.shots[1]!.normalizedArtifact.sha256 = "e".repeat(64);
    const regeneratedInput = regenerated as BuildEditorialPlanInput;
    expect(e3(regeneratedInput, decisionsFor(regeneratedInput, [trim("S01", 10, 100)], [dissolve("S01", "S02", 6)])).renderKey).not.toBe(base.renderKey);
    expect(e3(three, decisionsFor(three, [trim("S01", 11, 100)], [dissolve("S01", "S02", 6)])).renderKey).not.toBe(base.renderKey);
    expect(e3(three, decisionsFor(three, [trim("S01", 10, 100)], [cut("S01", "S02")])).renderKey).not.toBe(base.renderKey);
    expect(e3(three, decisionsFor(three, [trim("S01", 10, 100)], [dissolve("S01", "S02", 8)])).renderKey).not.toBe(base.renderKey);
    const identity = base.renderIdentity;
    expect(hashE3RenderIdentityV1(identity)).toBe(base.renderKey);
    const audio = structuredClone(identity); audio.audioSegments[0]!.sourceOutSample -= 1920;
    expect(hashE3RenderIdentityV1(audio)).not.toBe(base.renderKey);
    const output = structuredClone(identity); output.output.audio.sampleRateHz = 44100;
    expect(hashE3RenderIdentityV1(output)).not.toBe(base.renderKey);
    const profile = structuredClone(identity); profile.renderProfileId = "busybookie-episode-edit-v2";
    expect(hashE3RenderIdentityV1(profile)).not.toBe(base.renderKey);
    // Equal-content logical inputs stay distinct: swapping which occurrence a segment uses changes identity.
    expect(identity.inputs.map((entry) => entry.sha256)).toStrictEqual(["d".repeat(64), "d".repeat(64), "d".repeat(64)]);
    const swapped = structuredClone(identity);
    swapped.videoSegments[0]!.inputIndex = 1; swapped.videoSegments[1]!.inputIndex = 0;
    expect(hashE3RenderIdentityV1(swapped)).not.toBe(base.renderKey);
    expect(base.inputs.map((entry) => entry.inputIndex)).toStrictEqual([0, 1, 2]);
  });

  it("T3-50 E3RenderIdentityV1 field set is exact and free of provenance, naming and paths", () => {
    const identity = base.renderIdentity;
    expect(Object.keys(identity).sort()).toStrictEqual(["audioSegments", "identityType", "identityVersion", "inputs", "output", "renderProfileId", "videoJoins", "videoSegments"]);
    expect(identity.identityType).toBe("BUSYBOOKIE_E3_RENDER_IDENTITY");
    expect(identity.identityVersion).toBe("1");
    expect(identity.renderProfileId).toBe(EDITORIAL_EDIT_RENDER_PROFILE_ID);
    expect(Object.keys(identity.videoSegments[0]!).sort()).toStrictEqual(["inputIndex", "sourceInFrame", "sourceOutFrame"]);
    expect(Object.keys(identity.audioSegments[0]!).sort()).toStrictEqual(["inputIndex", "sourceInSample", "sourceOutSample"]);
    const json = JSON.stringify(identity);
    expect(json).not.toMatch(/EP02|Synthetic episode|S01|Busybookie|Production|editorialDecisions|manifest|bytes|title/);
    for (const extra of ["episodeId", "editorialDecisionsSha256", "outputPath", "ffmpegVersion"]) {
      expect(() => hashE3RenderIdentityV1({ ...identity, [extra]: "x" })).toThrow(/Editorial plan/);
    }
    const missing: Record<string, unknown> = { ...identity }; delete missing.audioSegments;
    expect(() => hashE3RenderIdentityV1(missing)).toThrow(/Editorial plan/);
  });
});
