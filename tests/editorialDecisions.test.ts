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

function withArtifactSha(input: BuildEditorialPlanInput, shotIndex: number, sha: string): BuildEditorialPlanInput {
  const copy = mutable(input);
  copy.preparedComposition.shots[shotIndex]!.normalizedArtifact.sha256 = sha;
  return copy as BuildEditorialPlanInput;
}
function bindings(document: any): string[] {
  return document.sourceBinding.shotAssets.map((b: any) => b.shotId);
}

describe("T3-45 EditorialDecisions source binding (B1): closure, stale media and binding exactness", () => {
  const input = fixture([{}, {}, {}]);

  it("accepts a trim on S01 bound to S01 only", () => {
    const document = decisionsFor(input, [trim("S01", 5, 100)]);
    expect(bindings(document)).toStrictEqual(["S01"]);
    expect(buildEditorialPlanV2(input, document).tracks[0].clips[0]!.sourceInFrame).toBe(5);
  });
  it("binds both endpoints of a dissolve and of an explicit CUT", () => {
    expect(bindings(decisionsFor(input, [], [dissolve("S01", "S02", 4)]))).toStrictEqual(["S01", "S02"]);
    const cutDocument = decisionsFor(input, [], [cut("S02", "S03")]);
    expect(bindings(cutDocument)).toStrictEqual(["S02", "S03"]);
    expect(buildEditorialPlanV2(input, cutDocument).transitions.map((t) => t.type)).toStrictEqual(["CUT", "CUT"]);
  });
  it("a shot reached through several decisions needs exactly one binding", () => {
    const document = decisionsFor(input, [trim("S02", 2, 98)], [dissolve("S01", "S02", 4), cut("S02", "S03")]);
    expect(bindings(document)).toStrictEqual(["S01", "S02", "S03"]);
    expect(referencedEditorialDecisionShotIds(parseEditorialDecisions(document), ["S01", "S02", "S03"])).toStrictEqual(["S01", "S02", "S03"]);
    expect(() => buildEditorialPlanV2(input, document)).not.toThrow();
    const doubled = structuredClone(document);
    doubled.sourceBinding.shotAssets.splice(1, 0, structuredClone(doubled.sourceBinding.shotAssets[1]!));
    expect(() => buildEditorialPlanV2(input, doubled)).toThrow(/duplicate the source binding/);
  });
  it("accepts an explicit default document with an empty referenced closure (manifest still bound)", () => {
    const document = decisionsFor(input);
    expect(document.sourceBinding.shotAssets).toStrictEqual([]);
    const plan = buildEditorialPlanV2(input, document);
    expect(plan.tracks).toStrictEqual(buildEditorialPlanV2(input, null).tracks);
    expect(plan.editorialDecisionsSha256).toBe(hashEditorialDecisions(document));
  });
  it("absent document resolves to defaults with a null decisions hash and no fabricated binding", () => {
    const plan = buildEditorialPlanV2(input, null);
    expect(plan.editorialDecisionsSha256).toBeNull();
    expect(canonicalizeEditorialPlanV2(plan)).not.toContain("sourceBinding");
  });
  it("rejects a stale manifest with the same episode and shot ids", () => {
    const document = decisionsFor(input, [trim("S01", 5, 100)]);
    const changed = mutable(input);
    changed.episode.title = "Edited title";
    changed.preparedComposition.title = "Edited title";
    expect(() => buildEditorialPlanV2(changed as BuildEditorialPlanInput, document)).toThrow(/manifest binding is stale/);
  });
  it("rejects a regenerated normalized asset under the same manifest", () => {
    const document = decisionsFor(input, [trim("S01", 5, 100)]);
    expect(() => buildEditorialPlanV2(withArtifactSha(input, 0, "e".repeat(64)), document)).toThrow(/normalized asset binding for S01 is stale/);
  });
  it("rejects a dissolve whose incoming endpoint asset was regenerated", () => {
    const document = decisionsFor(input, [], [dissolve("S01", "S02", 4)]);
    expect(() => buildEditorialPlanV2(withArtifactSha(input, 1, "e".repeat(64)), document)).toThrow(/binding for S02 is stale/);
  });
  it("rejects missing, extra and unknown bindings", () => {
    const missing = decisionsFor(input, [], [dissolve("S01", "S02", 4)]);
    missing.sourceBinding.shotAssets.pop();
    expect(() => buildEditorialPlanV2(input, missing)).toThrow(/referenced-shot closure/);
    const extra = decisionsFor(input, [trim("S01", 5, 100)]);
    extra.sourceBinding.shotAssets.push({ shotId: "S03", normalizedAssetSha256: "d".repeat(64) });
    expect(() => buildEditorialPlanV2(input, extra)).toThrow(/referenced-shot closure/);
    const unknown = decisionsFor(input, [trim("S01", 5, 100)]);
    unknown.sourceBinding.shotAssets.push({ shotId: "S99", normalizedAssetSha256: "d".repeat(64) });
    expect(() => buildEditorialPlanV2(input, unknown)).toThrow(/unknown shot S99/);
    expect(() => buildEditorialPlanV2(input, decisionsFor(input, [trim("S77", 0, 10)]))).toThrow(/unknown shot S77/);
  });
  it("rejects bindings that are not in manifest order", () => {
    const document = decisionsFor(input, [], [dissolve("S01", "S02", 4)]);
    document.sourceBinding.shotAssets.reverse();
    expect(bindings(document)).toStrictEqual(["S02", "S01"]);
    expect(() => buildEditorialPlanV2(input, document)).toThrow(/follow manifest shot order/);
  });
  it("rejects episode mismatch, non-adjacent transitions and repeated decisions; never rebinds", () => {
    const episode = decisionsFor(input, [trim("S01", 5, 100)]);
    episode.episodeId = "EP03";
    expect(() => buildEditorialPlanV2(input, episode)).toThrow(/episode identity/);
    expect(() => buildEditorialPlanV2(input, decisionsFor(input, [], [dissolve("S01", "S03", 4)]))).toThrow(/manifest-adjacent/);
    expect(() => buildEditorialPlanV2(input, decisionsFor(input, [trim("S01", 1, 99), trim("S01", 2, 98)]))).toThrow(/repeat a source-range/);
    const stale = decisionsFor(input, [trim("S01", 5, 100)]);
    const before = structuredClone(stale);
    expect(() => buildEditorialPlanV2(withArtifactSha(input, 0, "f".repeat(64)), stale)).toThrow();
    expect(stale).toStrictEqual(before);
  });
  it("source validation alone also enforces the binding against authority", () => {
    const authority = { episodeId: "EP02", manifestSha256: manifestShaOf(input),
      shots: shotOrderOf(input).map((shotId) => ({ shotId, normalizedAssetSha256: "d".repeat(64) })) };
    expect(() => validateEditorialDecisionsAgainstSource(decisionsFor(input, [trim("S02", 1, 100)]), authority)).not.toThrow();
    expect(() => validateEditorialDecisionsAgainstSource(decisionsFor(input, [trim("S02", 1, 100)]),
      { ...authority, manifestSha256: "0".repeat(64) })).toThrow(/manifest binding/);
  });
});

describe("T3-56 EditorialDecisions canonical hash", () => {
  it("is deterministic, key-order independent and sensitive to every source binding", () => {
    const input = fixture([{}, {}, {}]);
    const document = decisionsFor(input, [trim("S01", 5, 100)], [dissolve("S01", "S02", 4)]);
    const hash = hashEditorialDecisions(document);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashEditorialDecisions(structuredClone(document))).toBe(hash);
    const reordered = JSON.parse(JSON.stringify({ transitions: document.transitions, clips: document.clips,
      sourceBinding: { shotAssets: document.sourceBinding.shotAssets, manifestSha256: document.sourceBinding.manifestSha256 },
      episodeId: document.episodeId, decisionsType: document.decisionsType, schemaVersion: document.schemaVersion }));
    expect(hashEditorialDecisions(reordered)).toBe(hash);
    expect(canonicalizeEditorialDecisions(document)).toContain("sourceBinding");
    const manifest = structuredClone(document);
    manifest.sourceBinding.manifestSha256 = "0".repeat(64);
    expect(hashEditorialDecisions(manifest)).not.toBe(hash);
    const asset = structuredClone(document);
    asset.sourceBinding.shotAssets[1]!.normalizedAssetSha256 = "e".repeat(64);
    expect(hashEditorialDecisions(asset)).not.toBe(hash);
    expect(buildEditorialPlanV2(input, document).editorialDecisionsSha256).toBe(hash);
    expect(() => hashEditorialDecisions({ ...document, runtimePath: "C:/x" })).toThrow(/Editorial plan/);
  });
});
