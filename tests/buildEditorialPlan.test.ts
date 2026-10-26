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


describe("E2 construction, frame and audio contracts", () => {
  it.each([
    ["T01 native", [{native:true}]], ["T02 silence", [{}]],
    ["T04 dialogue", [{dialogue:true}]], ["T04 dialogue replaces native", [{native:true,dialogue:true}]],
    ["T04 tiny end overrun", [{dialogue:true,overrun:true}]],
    ["T05 mixed", [{native:true},{dialogue:true},{}]],
  ] as const)("%s retains current audio semantics", (_label, specs) => {
    const input=fixture(specs);
    const {plan}=assertParity(input);
    expect(plan.tracks[1].clips.map(c=>c.audio.mode)).toEqual(specs.map(s=>
      "dialogue" in s && s.dialogue ? "REPLACE_SOURCE_WITH_DIALOGUE" : "native" in s && s.native ? "PRESERVE_NATIVE" : "SYNTHETIC_SILENCE"));
    for(const clip of plan.tracks[1].clips) if(clip.audio.mode==="REPLACE_SOURCE_WITH_DIALOGUE") {
      expect(clip.audio.lines[0]!.startSeconds).toBe(0.123);
      expect(clip.audio).not.toHaveProperty("mixNativeAudio");
      expect(clip.audio.lines[0]).not.toHaveProperty("sourceAudioPath");
    }
  });
  it("T03 global ordering across scrambled scenes, exact frame prefixes", () => {
    const {plan}=assertParity(fixture([{scene:"SC02",seconds:5},{scene:"SC01",seconds:6},{scene:"SC02",seconds:4}]));
    expect(plan.shots.map(s=>[s.sceneId,s.shotId,s.order])).toEqual([["SC02","S01",1],["SC01","S02",2],["SC02","S03",3]]);
    expect(plan.tracks[0].clips.map(c=>c.timelineStartFrame)).toEqual([0,125,275]);
    expect(plan.durationFrames).toBe(375);
  });
  it("T06 every legal binary64 n/25 passes primitive and full builder", () => {
    for(let n=1;n<=750;n++) {
      const seconds=JSON.parse(String(n/25)) as number;
      expect(editorialDurationFrames(seconds)).toBe(n);
      expect(buildEditorialPlan(fixture([{seconds}])).durationFrames).toBe(n);
    }
    expect(0.28*25).not.toBe(7);
    expect(1.16*25).not.toBe(29);
  });
  it("T07 exact frozen invalid probes have zero false acceptances", () => {
    function adjacent(s:number, delta:bigint) {
      const v=new DataView(new ArrayBuffer(8)); v.setFloat64(0,s);
      v.setBigUint64(0,v.getBigUint64(0)+delta); return v.getFloat64(0);
    }
    const bad=new Set<number>();
    for(let n=1;n<=750;n++) {
      const s=n/25;
      bad.add(adjacent(s,1n));bad.add(adjacent(s,-1n));
      for(const d of [-1e-9,1e-9,-0.001,0.001]) bad.add(s+d);
    }
    for(let k=1;k<=30000;k++) if(k%40!==0) bad.add(k/1000);
    for(const n of [0,-0,-1,NaN,Infinity,-Infinity,Number.MAX_VALUE,Number.MIN_VALUE,Number.MAX_SAFE_INTEGER,
      30.04,4.01,0.1+0.2,0.2800000000000001]) bad.add(n);
    expect(bad.size).toBe(32761);
    // One aggregate assertion instead of 32761 per-probe matchers. matchesToThrow reproduces the installed
    // toThrow(/NON_FRAME_ALIGNED_DURATION/) contract exactly: a probe must throw; a truthy thrown value's message
    // (or the value itself when it is a string) must match; a falsy thrown value skips the message check.
    function matchesToThrow(thrown:unknown) {
      if(!thrown) return true;
      return /NON_FRAME_ALIGNED_DURATION/.test((typeof thrown==="string" ? thrown : (thrown as {message?:unknown}).message) as string);
    }
    const unexpected:{probe:number; reason:"accepted"|"wrong-error"; message?:string}[]=[];
    for(const seconds of bad) {
      let threw=false, thrown:unknown;
      try { editorialDurationFrames(seconds); } catch(error) { threw=true; thrown=error; }
      if(!threw) unexpected.push({probe:seconds,reason:"accepted"});
      else if(!matchesToThrow(thrown)) {
        const message=typeof thrown==="string" ? thrown : (thrown as {message?:unknown}).message;
        unexpected.push({probe:seconds,reason:"wrong-error",message:typeof message==="string" ? message.slice(0,200) : typeof message});
      }
    }
    // Bounded diagnostics: the full count plus the first 20 offenders; any failing probe makes count non-zero.
    expect({count:unexpected.length,first:unexpected.slice(0,20)}).toEqual({count:0,first:[]});
  });
  it.each([0,-0,-1,NaN,Infinity,-Infinity,Number.MAX_VALUE,Number.MIN_VALUE,30.04,4.01,0.1+0.2])(
    "T14 builder rejects invalid/off-grid seconds %s", seconds=>{
      const input=mutable(fixture());input.episode.scenes[0]!.shots[0]!.durationSeconds=seconds;
      expect(()=>buildEditorialPlan(input)).toThrow(/Editorial plan/);
    });
  it.each([undefined,null,"4",{},true])("T14 primitive rejects non-numbers %s", s=>{
    expect(()=>editorialDurationFrames(s)).toThrow(/NON_FRAME_ALIGNED_DURATION/);
  });
  it("T11 same content remains distinct across v1/v2 process, cache and provenance identities", () => {
    const {plan}=assertParity(fixture([{}, {dialogue:true}]));
    expect(plan.assets[0]!.sha256).toBe(plan.assets[1]!.sha256);
    expect(plan.assets[0]!.assetId).not.toBe(plan.assets[1]!.assetId);
    expect(plan.assets[0]!.normalization.cacheKey).not.toBe(plan.assets[1]!.normalization.cacheKey);
    expect(plan.assets).toHaveLength(2);
    const bad=mutable(fixture([{}, {dialogue:true}]));
    bad.preparedComposition.shots[1]!.normalizedArtifact.bytes++;
    expect(()=>buildEditorialPlan(bad)).toThrow();
  });
  it("T19 recursive freeze and input non-mutation on success and failure", () => {
    const input=fixture([{}, {dialogue:true}]), before=structuredClone(input);
    const plan=buildEditorialPlan(input);
    function frozen(value:unknown):void {
      if(value && typeof value==="object") {
        expect(Object.isFrozen(value)).toBe(true); for(const child of Object.values(value)) frozen(child);
      }
    }
    frozen(plan); expect(input).toStrictEqual(before);
    expect(Object.isFrozen(input)).toBe(false);
    const bad=mutable(input); bad.preparedComposition.shots[0]!.normalizedArtifact.bytes=0;
    const badBefore=structuredClone(bad);
    expect(()=>buildEditorialPlan(bad)).toThrow();
    expect(bad).toStrictEqual(badBefore);
    const copy=mutable(plan);const copyBefore=structuredClone(copy);
    const validated=validateEditorialPlan(copy); frozen(validated);
    expect(copy).toStrictEqual(copyBefore);expect(Object.isFrozen(copy)).toBe(false);
  });
  it("T16 emits no runtime fields or sentinel roots; preserves harmless title text", () => {
    const input=mutable(fixture([{}, {dialogue:true}],"Z:/PRIVATE_SENTINEL"));
    input.episode.title="A title mentioning C:/ordinary/story";
    input.preparedComposition.title=input.episode.title;
    const plan=buildEditorialPlan(input),json=canonicalizeEditorialPlan(plan);
    expect(json).not.toContain("PRIVATE_SENTINEL");
    expect(json).not.toContain("D:/generated");expect(json).not.toContain("D:/voice");
    expect(plan.episode.title).toBe(input.episode.title);
    const keys=new Set<string>();function visit(x:unknown) {
      if(x && typeof x==="object") for(const [k,v] of Object.entries(x)){keys.add(k);visit(v);}
    }visit(plan);
    for(const k of ["mediaRoot","sourceVideoPath","outputPath","sourceAudioPath","timestamp","normalizationCacheStatus",
      "executable","renderKey","editorialPlanSha256"])expect(keys.has(k),k).toBe(false);
    expect(plan.assets[0]!.mediaRootRelativePath).toMatch(/^cache\/composition-normalized\//);
  });
});
