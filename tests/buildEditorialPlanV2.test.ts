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

function trimmedDialogue(lineStart: number, lineDuration: number, sourceInFrame: number, sourceOutFrame: number) {
  const input = fixture([{ dialogue: true, lineStart, lineDuration }]);
  return () => buildEditorialPlanV2(input, decisionsFor(input, [trim("S01", sourceInFrame, sourceOutFrame)]));
}

describe("E3 dialogue protection in the sample domain", () => {
  it("T3-42 exact boundaries, one-sample crossings, clamped ends, binary64 and conservative one-sample cases", () => {
    // Line samples [9600, 28800) = frames [5, 15).
    expect(trimmedDialogue(0.2, 0.4, 5, 15)).not.toThrow();
    expect(trimmedDialogue(0.2, 0.4, 6, 100)).toThrow(/drop or truncate dialogue/);
    expect(trimmedDialogue(0.2, 0.4, 0, 14)).toThrow(/drop or truncate dialogue/);
    // One sample inside / outside the retained start (frame 5 = sample 9600).
    expect(trimmedDialogue(9601 / 48000, 0.1, 5, 100)).not.toThrow();
    expect(trimmedDialogue(9599 / 48000, 0.1, 5, 100)).toThrow(/drop or truncate dialogue/);
    // One sample inside / outside the retained end (frame 15 = sample 28800).
    expect(trimmedDialogue(0.2, 19199 / 48000, 0, 15)).not.toThrow();
    expect(trimmedDialogue(0.2, 19201 / 48000, 0, 15)).toThrow(/drop or truncate dialogue/);
    // Clamped end at the asset end: full range kept, one-frame tail trim rejected.
    const overrun = fixture([{ dialogue: true, overrun: true }]);
    expect(() => buildEditorialPlanV2(overrun, null)).not.toThrow();
    expect(() => buildEditorialPlanV2(overrun, decisionsFor(overrun, [trim("S01", 0, 99)]))).toThrow(/drop or truncate dialogue/);
    expect(dialogueLineProtectedSampleRange({ startSeconds: 0.123, durationSeconds: 4 - 0.123 + 0.0000005 }, 100).endSample).toBe(192000);
    // Binary64: 1.36 * 48000 = 65280.00000000001; snapping keeps an exact frame-34 boundary.
    expect(1.36 * 48000).not.toBe(65280);
    expect(Math.ceil(1.36 * 48000)).toBe(65281);
    expect(ceilSnapToInteger(1.36 * 48000)).toBe(65280);
    expect(trimmedDialogue(0, 1.36, 0, 34)).not.toThrow();
    // Conservative bound: audible end 1920 samples, protected end 1921 -> a 1-frame cut is (intentionally) rejected.
    expect(dialogueLineProtectedSampleRange({ startSeconds: 0, durationSeconds: 0.0400001 }, 100).endSample).toBe(1921);
    expect(trimmedDialogue(0, 0.0400001, 0, 1)).toThrow(/drop or truncate dialogue/);
    expect(trimmedDialogue(0, 0.0400001, 0, 2)).not.toThrow();
  });

  it("T3-43 midpoint audio cuts through dialogue (odd and even T, outgoing tail and incoming head) are rejected", () => {
    const outgoingTail = fixture([{ dialogue: true, lineStart: 3.85, lineDuration: 0.1 }, {}]);
    expect(() => buildEditorialPlanV2(outgoingTail, null)).not.toThrow();
    expect(() => buildEditorialPlanV2(outgoingTail, decisionsFor(outgoingTail, [], [dissolve("S01", "S02", 10)]))).toThrow(/drop or truncate dialogue/);
    expect(() => buildEditorialPlanV2(outgoingTail, decisionsFor(outgoingTail, [], [dissolve("S01", "S02", 9)]))).toThrow(/drop or truncate dialogue/);
    // Line in the retained half (frames [92.5, 93.5)): kept with T = 10 (audio out 95), cut by odd T = 13 (audio out 93).
    const retained = fixture([{ dialogue: true, lineStart: 3.7, lineDuration: 0.04 }, {}]);
    expect(() => buildEditorialPlanV2(retained, decisionsFor(retained, [], [dissolve("S01", "S02", 10)]))).not.toThrow();
    expect(() => buildEditorialPlanV2(retained, decisionsFor(retained, [], [dissolve("S01", "S02", 13)]))).toThrow(/drop or truncate dialogue/);
    // Incoming head line at frame 5: audio in = floor(T / 2) = 4 (T 9), 5 (T 11, touching), 6 (T 12, rejected).
    const incoming = fixture([{}, { dialogue: true, lineStart: 0.2, lineDuration: 0.1 }]);
    expect(() => buildEditorialPlanV2(incoming, decisionsFor(incoming, [], [dissolve("S01", "S02", 9)]))).not.toThrow();
    expect(() => buildEditorialPlanV2(incoming, decisionsFor(incoming, [], [dissolve("S01", "S02", 11)]))).not.toThrow();
    expect(() => buildEditorialPlanV2(incoming, decisionsFor(incoming, [], [dissolve("S01", "S02", 12)]))).toThrow(/drop or truncate dialogue/);
  });
});

describe("E3 builder purity and self-containment", () => {
  it("builds frozen, self-contained plans without mutating inputs", () => {
    const input = fixture([{}, { dialogue: true }, { native: true }]);
    const document = decisionsFor(input, [trim("S01", 3, 97)], [dissolve("S01", "S02", 6)]);
    const inputBefore = structuredClone(input);
    const documentBefore = structuredClone(document);
    const plan = buildEditorialPlanV2(input, document);
    expect(input).toStrictEqual(inputBefore);
    expect(document).toStrictEqual(documentBefore);
    expect(Object.isFrozen(plan.tracks[0].clips[0])).toBe(true);
    const roundTrip = JSON.parse(canonicalizeEditorialPlanV2(plan));
    const route = planEditorialRenderV2({ plan: roundTrip, mediaRoot: input.mediaRoot });
    expect(route.route).toBe("E3_EDIT");
  });
});
