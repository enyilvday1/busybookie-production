import { describe, expect, it } from "vitest";
import { buildCompositionShotNormalizationPlan } from "../src/composition/buildCompositionShotNormalizationPlan.js";
import { buildDialogueCompositionShotNormalizationPlan } from "../src/composition/buildDialogueCompositionShotNormalizationPlan.js";
import type { PreparedEpisodeCompositionShot } from "../src/composition/prepareEpisodeComposition.js";
import { EpisodeManifestSchema } from "../src/schemas/episodeManifest.schema.js";
import { buildEditorialPlan, type BuildEditorialPlanInput } from "../src/editorial/buildEditorialPlan.js";
import { validateEditorialPlan, editorialDurationFrames } from "../src/editorial/validateEditorialPlan.js";
import { validateEditorialPlanAgainstSource } from "../src/editorial/validateEditorialPlanAgainstSource.js";
import { canonicalizeEditorialPlan, canonicalEditorialJson, hashEditorialPlan, editorialSha256 } from "../src/editorial/canonicalizeEditorialPlan.js";
import { resolveEditorialAssetPath } from "../src/editorial/resolveEditorialAssetPath.js";
import { buildEditorialRoughCutRenderPlan } from "../src/editorial/buildEditorialRoughCutRenderPlan.js";
import { buildEpisodeRoughCutRenderPlan } from "../src/composition/buildEpisodeRoughCutRenderPlan.js";
import { buildEpisodeRoughCutFfmpegCommand } from "../src/composition/buildEpisodeRoughCutFfmpegCommand.js";
import type { EditorialPlan } from "../src/editorial/editorialPlan.schema.js";

// Local, in-memory fixtures only. Repeated in the six allowed files to avoid an extra helper path
// or importing another test module (which would register its tests more than once).
type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
function mutable<T>(value: T): Mutable<T> { return structuredClone(value) as Mutable<T>; }
type Spec = { seconds?: number; native?: boolean; dialogue?: boolean; scene?: string; overrun?: boolean };
function fixture(specs: readonly Spec[] = [{}], mediaRoot = "D:/Busybookie/Production"): BuildEditorialPlanInput {
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
    schemaVersion: "1.0", episodeId: "EP02", title: "Synthetic episode", slug: "synthetic-episode", status: "DRAFT",
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
    const startSeconds = 0.123;
    const durationSeconds = spec.overrun ? shot.durationSeconds - startSeconds + 0.0000005 : 0.537;
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


describe("EditorialPlan strict schema and intrinsic bindings", () => {
  it("T01/T02 admits current plans, strictly rejects unknown nested fields", () => {
    const good = buildEditorialPlan(fixture());
    expect(validateEditorialPlan(good)).toStrictEqual(good);
    for (const path of [[], ["episode"], ["profile"], ["profile","frameRate"], ["shots",0], ["assets",0],
      ["assets",0,"normalization"], ["assets",0,"generatedSource"], ["tracks",0], ["tracks",0,"clips",0],
      ["tracks",1,"clips",0,"audio"]] as const) {
      const bad = mutable(good);
      let node: any = bad;
      for (const key of path) node = node[key];
      node.unapproved = true;
      expect(() => validateEditorialPlan(bad)).toThrow(/Editorial plan/);
    }
  });

  const attacks: [string, (p: Mutable<EditorialPlan>) => void][] = [
    ["T08 duplicate shot", p => { p.shots[1]!.shotId = p.shots[0]!.shotId; }],
    ["T08 duplicate order", p => { p.shots[1]!.order = 1; }],
    ["T08 gap", p => { p.shots[1]!.order = 3; }],
    ["T23 missing V1", p => { p.tracks.splice(0, 1); }],
    ["T23 duplicate V1 track", p => { (p.tracks as any)[1] = p.tracks[0]; }],
    ["T23 duplicate V1 disguised count", p => { p.tracks[0].clips[1] = mutable(p.tracks[0].clips[0]!); }],
    ["T24 coherent V1/A1 swap", p => { p.tracks[0].clips.reverse(); p.tracks[1].clips.reverse(); }],
    ["T24 wrong clip id", p => { p.tracks[0].clips[0]!.clipId = "V1-S99"; }],
    ["T24 wrong clip shot", p => { p.tracks[0].clips[0]!.shotId = "S99"; }],
    ["T24 wrong duration", p => { p.tracks[0].clips[0]!.durationFrames++; }],
    ["T25 asset swap on both tracks", p => {
      p.tracks[0].clips[0]!.assetId = p.assets[1]!.assetId; p.tracks[1].clips[0]!.assetId = p.assets[1]!.assetId;
    }],
    ["T25 duplicate asset id", p => { p.assets[1]!.assetId = p.assets[0]!.assetId; }],
    ["T26 wrong A1 link", p => { p.tracks[1].clips[0]!.linkedClipId = "V1-S99"; }],
    ["T26 wrong A1 shot", p => { p.tracks[1].clips[0]!.shotId = "S99"; }],
    ["T26 wrong A1 asset", p => { p.tracks[1].clips[0]!.assetId = p.assets[1]!.assetId; }],
    ["T26 wrong A1 time", p => { p.tracks[1].clips[0]!.timelineStartFrame++; }],
    ["T26 wrong A1 source", p => { p.tracks[1].clips[0]!.sourceInFrame++; }],
    ["T26 wrong A1 end", p => { p.tracks[1].clips[0]!.sourceOutFrame++; }],
    ["T26 wrong A1 duration", p => { p.tracks[1].clips[0]!.durationFrames++; }],
    ["T26 missing A1", p => { p.tracks.pop(); }],
    ["T26 duplicate A1 clip", p => { p.tracks[1].clips[1] = mutable(p.tracks[1].clips[0]!); }],
    ["T27 orphan asset", p => { p.assets.push(mutable(p.assets[0]!)); }],
    ["T27 extra clip", p => { p.tracks[0].clips.push(mutable(p.tracks[0].clips[0]!)); }],
    ["T27 omitted shot", p => { p.shots.pop(); }],
    ["T27 extra shot", p => { p.shots.push(mutable(p.shots[0]!)); }],
    ["T27 missing asset", p => { p.assets.pop(); }],
    ["T14 unsafe total", p => { p.durationFrames = Number.MAX_SAFE_INTEGER + 1; }],
    ["T14 negative zero", p => { p.tracks[0].clips[0]!.sourceInFrame = -0; }],
    ["timeline gap", p => { p.tracks[0].clips[1]!.timelineStartFrame++; }],
    ["timeline overlap", p => { p.tracks[0].clips[1]!.timelineStartFrame--; }],
    ["wrong aggregate", p => { p.durationFrames++; }],
    ["trim", p => { p.tracks[0].clips[0]!.sourceInFrame = 1; }],
    ["T11 contradictory same content", p => { p.assets[1]!.bytes++; }],
    ["T13 wrong profile pair", p => { (p.assets[0]!.normalization as any).profileId = "busybookie-master-normalization-v2-dialogue"; }],
    ["T13 stereo mismatch", p => { (p.profile as any).audioChannels = 1; }],
    ["T16 absolute locator", p => { p.assets[0]!.mediaRootRelativePath = "C:/Users/sentinel/asset.mp4"; }],
    ["T16 locator wrong owner", p => { p.assets[0]!.mediaRootRelativePath = p.assets[1]!.mediaRootRelativePath; }],
    ["future track", p => { (p.tracks[1] as any).kind = "MUSIC"; }],
    ["future version", p => { (p as any).schemaVersion = "2.0"; }],
  ];
  it.each(attacks)("%s fails closed", (_name, attack) => {
    const plan = mutable(buildEditorialPlan(fixture([{}, {}])));
    attack(plan);
    expect(() => validateEditorialPlan(plan)).toThrow(/Editorial plan/);
    expect(() => canonicalizeEditorialPlan(plan)).toThrow(/Editorial plan/);
    expect(() => buildEditorialRoughCutRenderPlan({plan,mediaRoot:"D:/media"})).toThrow(/Editorial plan/);
  });
  it.each([undefined, "", "A".repeat(64), "z".repeat(64), "1".repeat(63)])("T11 invalid hash %s", sha => {
    const p = mutable(buildEditorialPlan(fixture()));
    (p.assets[0] as any).sha256 = sha;
    expect(() => validateEditorialPlan(p)).toThrow();
  });
  it.each([0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER+1, 1.1])("T11 invalid bytes %s", bytes => {
    const p = mutable(buildEditorialPlan(fixture())); p.assets[0]!.bytes=bytes;
    expect(() => validateEditorialPlan(p)).toThrow();
  });
  it("T15 rejects invalid dialogue identity, ordering, overlap and profile binding", () => {
    const input = fixture([{dialogue:true}]);
    const plan = mutable(buildEditorialPlan(input));
    const clip = plan.tracks[1].clips[0]!;
    if (clip.audio.mode !== "REPLACE_SOURCE_WITH_DIALOGUE") throw Error("fixture");
    const baseline = mutable(plan);
    for (const change of [
      (a: typeof clip.audio) => { if(a.mode==="REPLACE_SOURCE_WITH_DIALOGUE") a.lines[0]!.dialogueLineId="EP02_SC99_S01_L01"; },
      (a: typeof clip.audio) => { if(a.mode==="REPLACE_SOURCE_WITH_DIALOGUE") a.lines[0]!.lineNumber=2; },
      (a: typeof clip.audio) => { if(a.mode==="REPLACE_SOURCE_WITH_DIALOGUE") a.lines[0]!.durationSeconds=5; },
      (a: typeof clip.audio) => { if(a.mode==="REPLACE_SOURCE_WITH_DIALOGUE") {
        a.lines.push({...a.lines[0]!,lineNumber:2,dialogueLineId:"EP02_SC01_S01_L02"});
      }},
      (a: typeof clip.audio) => { if(a.mode==="REPLACE_SOURCE_WITH_DIALOGUE") a.lines=[]; },
    ]) {
      const bad = mutable(baseline); change(bad.tracks[1].clips[0]!.audio as typeof clip.audio);
      expect(() => validateEditorialPlan(bad)).toThrow();
    }
    (plan.tracks[1].clips[0] as any).audio={mode:"PRESERVE_NATIVE"};
    expect(() => validateEditorialPlan(plan)).toThrow();
  });
});
