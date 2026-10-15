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


describe("Independent source-authority validation", () => {
  it("T28 validates supplied authority directly without requiring builder invocation", () => {
    const input=fixture([{}, {dialogue:true}]), plan=buildEditorialPlan(input);
    const roundTrip=JSON.parse(canonicalizeEditorialPlan(plan));
    expect(()=>validateEditorialPlanAgainstSource({...input,plan:roundTrip})).not.toThrow();
    const before=structuredClone(input);validateEditorialPlanAgainstSource({...input,plan});
    expect(input).toStrictEqual(before);
  });
  const attacks: [string, (input: Mutable<BuildEditorialPlanInput>)=>void][] = [
    ["T08 duplicate shot", i=>{i.episode.scenes[0]!.shots[1]!.id=i.episode.scenes[0]!.shots[0]!.id;}],
    ["T08 duplicate order", i=>{i.episode.scenes[0]!.shots[1]!.order=i.episode.scenes[0]!.shots[0]!.order;}],
    ["T08 order gap", i=>{i.episode.scenes[0]!.shots[1]!.order=9;}],
    ["T09 scene ownership", i=>{i.preparedComposition.shots[0]!.sceneId="SC99";}],
    ["T28 episode identity", i=>{i.preparedComposition.episodeId="EP99";}],
    ["T28 episode title", i=>{i.preparedComposition.title="Changed";}],
    ["T28 shot title", i=>{i.preparedComposition.shots[0]!.title="Changed";}],
    ["T28 shot order", i=>{i.preparedComposition.shots.reverse();}],
    ["T28 count", i=>{i.preparedComposition.totalShots++;}],
    ["T28 extra prepared", i=>{i.preparedComposition.shots.push(mutable(i.preparedComposition.shots[0]!));}],
    ["T28 duration", i=>{i.preparedComposition.shots[0]!.durationSeconds+=0.04;}],
    ["T28 total", i=>{i.preparedComposition.totalDurationSeconds+=Number.EPSILON*10;}],
    ["T28 target", i=>{i.preparedComposition.shots[0]!.normalizationPlan.targetDurationSeconds+=0.04;}],
    ["T10 absent artifact", i=>{delete (i.preparedComposition.shots[0] as any).normalizedArtifact;}],
    ["T11 artifact SHA", i=>{i.preparedComposition.shots[0]!.normalizedArtifact.sha256="e".repeat(64);}],
    ["T11 artifact bytes", i=>{i.preparedComposition.shots[0]!.normalizedArtifact.bytes++;}],
    ["T11 artifact content type", i=>{(i.preparedComposition.shots[0]!.normalizedArtifact as any).contentType="audio/wav";}],
    ["T28 generated SHA", i=>{i.preparedComposition.shots[0]!.sourceSha256="e".repeat(64);}],
    ["T28 generated bytes", i=>{i.preparedComposition.shots[0]!.sourceBytes++;}],
    ["T28 provider task", i=>{i.preparedComposition.shots[0]!.providerExecutionId="different";}],
    ["T28 provider", i=>{i.preparedComposition.shots[0]!.provider="RUNWAY";}],
    ["T28 source content type", i=>{i.preparedComposition.shots[0]!.sourceContentType="video/mp4";}],
    ["T28 source path", i=>{i.preparedComposition.shots[0]!.sourceVideoPath="D:/wrong.mp4";}],
    ["T13 width", i=>{i.postProduction.width=1280;}],
    ["T13 height", i=>{i.postProduction.height=720;}],
    ["T13 rate", i=>{i.postProduction.timelineFps=30;}],
    ["T13 audio rate", i=>{i.postProduction.audioSampleRateHz=44100;}],
    ["T13 aspect", i=>{(i.postProduction as any).aspectRatio="4:3";}],
    ["T13 normalized width", i=>{i.preparedComposition.shots[0]!.normalizationPlan.video.width=1280;}],
    ["T13 normalized stereo", i=>{(i.preparedComposition.shots[0]!.normalizationPlan.audio as any).channels=1;}],
    ["T13 profile pair", i=>{(i.preparedComposition.shots[0]!.normalizationPlan as any).profileId="wrong";}],
    ["T13 scale", i=>{(i.preparedComposition.shots[0]!.normalizationPlan.video as any).scaleMode="CROP";}],
    ["T13 duration mode", i=>{(i.preparedComposition.shots[0]!.normalizationPlan as any).durationMode="SOURCE";}],
    ["T28 cache", i=>{i.preparedComposition.shots[0]!.normalizationPlan.cacheKey="f".repeat(64);}],
    ["T28 normalization episode", i=>{i.preparedComposition.shots[0]!.normalizationPlan.episodeId="EP99";}],
    ["T28 normalization shot", i=>{i.preparedComposition.shots[0]!.normalizationPlan.shotId="S99";}],
    ["T28 normalization source", i=>{i.preparedComposition.shots[0]!.normalizationPlan.sourceSha256="f".repeat(64);}],
    ["T28 native intent", i=>{i.preparedComposition.shots[0]!.nativeAudio=true;}],
    ["T28 normalized native", i=>{i.preparedComposition.shots[0]!.normalizationPlan.nativeAudio=true;}],
    ["T15 wrong silence mode", i=>{(i.preparedComposition.shots[0]!.normalizationPlan.audio as any).mode="PRESERVE_NATIVE";}],
    ["T12 outside root", i=>{i.preparedComposition.shots[0]!.normalizedArtifact.outputPath="E:/outside.mp4";}],
    ["T12 plan/artifact mismatch", i=>{i.preparedComposition.shots[0]!.normalizationPlan.outputPath="D:/wrong.mp4";}],
    ["T28 normalized duration", i=>{i.preparedComposition.shots[0]!.normalizedArtifact.durationSeconds=5;}],
    ["T28 invalid tolerance", i=>{i.preparedComposition.shots[0]!.normalizedArtifact.durationToleranceSeconds=NaN;}],
  ];
  it.each(attacks)("%s rejects source divergence from a still intrinsically valid plan", (_name, attack)=>{
    const input=mutable(fixture([{}, {dialogue:true}]));
    const plan=buildEditorialPlan(input);attack(input);
    expect(()=>validateEditorialPlan(plan)).not.toThrow();
    expect(()=>validateEditorialPlanAgainstSource({...input,plan})).toThrow(/Editorial plan/);
  });
  it("T28 coherent stale episode/hash and shot snapshots fail without builder-self-validation", () => {
    const input=fixture();
    for(const field of ["title","manifestSha256","episodeId"] as const) {
      const plan=mutable(buildEditorialPlan(input));
      if(field==="episodeId") {
        const old=canonicalizeEditorialPlan(plan);
        const changed=JSON.parse(old.replaceAll("EP02","EP99")) as EditorialPlan;
        expect(()=>validateEditorialPlan(changed)).not.toThrow();
        expect(()=>validateEditorialPlanAgainstSource({...input,plan:changed})).toThrow();
      } else {
        plan.episode[field]=field==="title"?"stale":"f".repeat(64);
        expect(()=>validateEditorialPlan(plan)).not.toThrow();
        expect(()=>validateEditorialPlanAgainstSource({...input,plan})).toThrow();
      }
    }
    const plan=mutable(buildEditorialPlan(input));
    plan.shots[0]!.durationFrames=101;plan.durationFrames=101;
    for(const t of plan.tracks){t.clips[0]!.durationFrames=101;t.clips[0]!.sourceOutFrame=101;}
    expect(()=>validateEditorialPlan(plan)).not.toThrow();
    expect(()=>validateEditorialPlanAgainstSource({...input,plan})).toThrow();
  });
  it("T09 coherent valid scene identity is checked against source ownership", () => {
    const input=fixture(),plan=mutable(buildEditorialPlan(input));plan.shots[0]!.sceneId="SC99";
    expect(()=>validateEditorialPlan(plan)).not.toThrow();
    expect(()=>validateEditorialPlanAgainstSource({...input,plan})).toThrow();
  });
  it("T28 rejects a coherent fabricated cache snapshot even with consistent locator/paths", () => {
    const input=mutable(fixture()),plan=mutable(buildEditorialPlan(input)),key="f".repeat(64);
    const old=plan.assets[0]!.normalization.cacheKey;
    plan.assets[0]!.normalization.cacheKey=key;
    plan.assets[0]!.mediaRootRelativePath=plan.assets[0]!.mediaRootRelativePath.replace(old,key);
    const p=input.preparedComposition.shots[0]!;
    p.normalizationPlan.cacheKey=key;
    p.normalizationPlan.outputPath=p.normalizationPlan.outputPath.replace(old,key);
    p.normalizedArtifact.outputPath=p.normalizationPlan.outputPath;
    expect(()=>validateEditorialPlan(plan)).not.toThrow();
    expect(()=>validateEditorialPlanAgainstSource({...input,plan})).toThrow();
  });
  const dialogueAttacks: [string,(n:any)=>void][]=[
    ["scene",n=>{n.sceneId="SC99";}],["mixing",n=>{n.audio.mixNativeAudio=true;}],
    ["disposition",n=>{n.audio.sourceAudioDisposition="DISCARD_NATIVE_AUDIO";}],
    ["plan key",n=>{n.audio.dialoguePlanKey="e".repeat(64);}],["audio key",n=>{n.audio.audioKey="e".repeat(64);}],
    ["missing lines",n=>{n.audio.lines=[];}],["duplicate lines",n=>{n.audio.lines.push({...n.audio.lines[0]});}],
    ["line identity",n=>{n.audio.lines[0].dialogueLineId="EP02_SC99_S01_L01";}],
    ["line order",n=>{n.audio.lines[0].lineNumber=2;}],["line hash",n=>{n.audio.lines[0].sourceSha256="e".repeat(64);}],
    ["line bytes",n=>{n.audio.lines[0].sourceBytes++;}],["start",n=>{n.audio.lines[0].startSeconds+=0.01;}],
    ["duration",n=>{n.audio.lines[0].durationSeconds+=0.01;}],["end",n=>{n.audio.lines[0].endSeconds+=0.01;}],
    ["missing audio path",n=>{n.audio.lines[0].sourceAudioPath="";}],
  ];
  it.each(dialogueAttacks)("T15/T28 dialogue %s divergence",(_name,attack)=>{
    const input=mutable(fixture([{dialogue:true}])),plan=buildEditorialPlan(input);
    attack(input.preparedComposition.shots[0]!.normalizationPlan);
    expect(()=>validateEditorialPlanAgainstSource({...input,plan})).toThrow(/Editorial plan/);
  });
  it("T15 dialogue routing and canonical count cannot be hidden by recomputing manifest hash",()=>{
    const input=mutable(fixture()),plan=mutable(buildEditorialPlan(input));
    input.episode.scenes[0]!.shots[0]!.dialogue=[{characterId:"OLLIE",text:"New line"}];
    plan.episode.manifestSha256=editorialSha256(canonicalEditorialJson(EpisodeManifestSchema.parse(input.episode)));
    expect(()=>validateEditorialPlanAgainstSource({...input,plan})).toThrow();
    expect(()=>buildEditorialPlan(input)).toThrow();
  });
  it("T28 provider provenance need not equal manifest routing hint",()=>{
    const input=mutable(fixture());input.preparedComposition.shots[0]!.provider="RUNWAY";
    expect(buildEditorialPlan(input).assets[0]!.generatedSource.provider).toBe("RUNWAY");
  });
});
