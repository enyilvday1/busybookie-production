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

function referenceSeconds(frames: number): string {
  const scaled = BigInt(frames) * 4n;
  const whole = scaled / 100n;
  const remainder = scaled % 100n;
  return remainder === 0n ? whole.toString() : `${whole}.${remainder.toString().padStart(2, "0").replace(/0+$/, "")}`;
}

describe("E3 FFmpeg command planning", () => {
  it("T3-46 integer frame -> decimal seconds formatter (golden values, residues, large values, bound)", () => {
    expect([0, 1, 7, 24, 25, 26, 28, 750].map(formatFrameSeconds25)).toStrictEqual(["0", "0.04", "0.28", "0.96", "1", "1.04", "1.12", "30"]);
    expect(formatFrameSeconds25(22_275_000)).toBe("891000");
    expect(formatFrameSeconds25(22_274_999)).toBe("890999.96");
    for (let residue = 0; residue < 25; residue += 1) expect(formatFrameSeconds25(1_000_000 + residue)).toBe(referenceSeconds(1_000_000 + residue));
    const large = [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER - 24, Math.floor(Number.MAX_SAFE_INTEGER / 4),
      Math.floor(Number.MAX_SAFE_INTEGER / 4) + 1, 2 ** 40 + 3, 2 ** 52 + 7];
    for (const frames of large) {
      expect(formatFrameSeconds25(frames)).toBe(referenceSeconds(frames));
      expect(formatFrameSeconds25(frames)).not.toMatch(/e|E/);
    }
    for (let frames = 22_275_000 - 5_000; frames <= 22_275_000; frames += 1) expect(formatFrameSeconds25(frames)).toBe(referenceSeconds(frames));
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => formatFrameSeconds25(bad)).toThrow(/Editorial plan/);
    }
  });

  it("T3-51 busybookie-episode-edit-v1 behaviour is pinned (golden argv and render key)", () => {
    const input = fixture([{}, {}]);
    const renderPlan = buildEditorialEditRenderPlan({
      plan: buildEditorialPlanV2(input, decisionsFor(input, [trim("S01", 10, 100)], [dissolve("S01", "S02", 6)])),
      mediaRoot: input.mediaRoot,
    });
    expect(EDITORIAL_EDIT_RENDER_PROFILE_ID).toBe("busybookie-episode-edit-v1");
    expect(renderPlan.profileId).toBe("busybookie-episode-edit-v1");
    expect(renderPlan.renderKey).toBe("7d8d031a49c86f7ec7cdcd172a428b7e993c202e3712b123e866c3fbe6432fa5");
    const preflight = assertEditorialEditRenderPreflight({ renderPlan, evidence: evidenceFor(renderPlan) });
    const command = buildEditorialEditFfmpegCommand({ ffmpegExecutable: " ffmpeg ", renderPlan, preflight, outputPath: renderPlan.outputPath });
    expect(command.executable).toBe("ffmpeg");
    expect(command.args).toStrictEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
      "-i", renderPlan.inputs[0]!.sourceVideoPath, "-i", renderPlan.inputs[1]!.sourceVideoPath,
      "-filter_complex", [
        "[0:v:0]trim=start_frame=10:end_frame=100,fps=25,format=yuv420p,settb=1/25,setpts=PTS-STARTPTS[v0]",
        "[1:v:0]trim=start_frame=0:end_frame=100,fps=25,format=yuv420p,settb=1/25,setpts=PTS-STARTPTS[v1]",
        "[v0][v1]xfade=transition=fade:duration=0.24:offset=3.36,fps=25,format=yuv420p,settb=1/25,setpts=PTS-STARTPTS[vout]",
        "[0:a:0]atrim=start_sample=19200:end_sample=186240,asettb=1/48000,asetpts=PTS-STARTPTS[a0]",
        "[1:a:0]atrim=start_sample=5760:end_sample=192000,asettb=1/48000,asetpts=PTS-STARTPTS[a1]",
        "[a0][a1]concat=n=2:v=0:a=1[aout]",
      ].join(";"),
      "-map", "[vout]", "-map", "[aout]",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", "25",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-t", "7.36",
      "-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart", "-f", "mp4",
      renderPlan.outputPath,
    ]);
    expect(renderPlan.outputPath).toBe(`D:\\Busybookie\\Production\\exports\\EP02\\edit\\EP02_edit_${renderPlan.renderKey}.mp4`);
    expect(() => buildEditorialEditFfmpegCommand({ ffmpegExecutable: " ", renderPlan, preflight, outputPath: renderPlan.outputPath })).toThrow(/Editorial plan/);
    expect(() => buildEditorialEditFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan, preflight, outputPath: "relative/out.mp4" })).toThrow(/absolute output/);
    expect(() => buildEditorialEditFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan, preflight, outputPath: renderPlan.inputs[0]!.sourceVideoPath })).toThrow(/differ from every input/);
    expect(() => buildEditorialEditFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan: { ...renderPlan, profileId: "busybookie-episode-edit-v2" } as any,
      preflight, outputPath: renderPlan.outputPath })).toThrow(/only busybookie-episode-edit-v1/);
    // A single trimmed clip needs no join and no audio concat.
    const single = fixture([{}]);
    const one = buildEditorialEditRenderPlan({ plan: buildEditorialPlanV2(single, decisionsFor(single, [trim("S01", 5, 95)])), mediaRoot: single.mediaRoot });
    const oneCommand = buildEditorialEditFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan: one,
      preflight: assertEditorialEditRenderPreflight({ renderPlan: one, evidence: evidenceFor(one) }), outputPath: one.outputPath });
    expect(oneCommand.args.slice(oneCommand.args.indexOf("-filter_complex"), oneCommand.args.indexOf("-map") + 4)).toStrictEqual([
      "-filter_complex",
      "[0:v:0]trim=start_frame=5:end_frame=95,fps=25,format=yuv420p,settb=1/25,setpts=PTS-STARTPTS[v0];" +
        "[0:a:0]atrim=start_sample=9600:end_sample=182400,asettb=1/48000,asetpts=PTS-STARTPTS[a0]",
      "-map", "[v0]", "-map", "[a0]",
    ]);
    expect(oneCommand.args[oneCommand.args.indexOf("-t") + 1]).toBe("3.6");
  });
});
