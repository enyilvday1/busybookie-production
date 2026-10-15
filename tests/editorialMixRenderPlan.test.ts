import { describe, expect, it } from "vitest";
import { deriveEditorialTimeline } from "../src/editorial/deriveEditorialTimeline.js";
import { hashEditorialPlanV2 } from "../src/editorial/canonicalizeEditorialPlanV2.js";
import { validateEditorialPlanV2 } from "../src/editorial/validateEditorialPlanV2.js";
import type { EditorialPlanV2 } from "../src/editorial/editorialPlanV2.schema.js";
import { buildEditorialPlanV3 } from "../src/editorial/buildEditorialPlanV3.js";
import { hashEditorialPlanV3 } from "../src/editorial/canonicalizeEditorialPlanV3.js";
import { migrateEditorialPlanV2ToV3 } from "../src/editorial/migrateEditorialPlanV3.js";
import {
  assertEditorialMixRenderPlanIntegrity, hashE4RenderIdentityV1, planEditorialRenderV3, validateE4RenderIdentityV1,
  type EditorialMixRenderPlan,
} from "../src/editorial/buildEditorialMixRenderPlan.js";
import {
  assertEditorialMixRenderPreflight, parseEditorialMixPreflightReceipt,
} from "../src/editorial/editorialMixRenderPreflight.js";
import { buildEditorialMixFfmpegCommand } from "../src/editorial/buildEditorialMixFfmpegCommand.js";
import { buildEditorialMixAnalysisFfmpegCommand } from "../src/editorial/buildEditorialMixAnalysisFfmpegCommand.js";
import { buildEditorialMixAudioGraph, hashEditorialMixAudioGraph } from "../src/editorial/buildEditorialMixAudioGraph.js";
import { canonicalEditorialJson, editorialSha256 } from "../src/editorial/canonicalizeEditorialPlan.js";
import { buildEditorialEditRenderPlan, planEditorialRenderV2, type EditorialEditRenderPlan } from "../src/editorial/buildEditorialEditRenderPlan.js";
import { assertEditorialEditRenderPreflight } from "../src/editorial/editorialEditRenderPreflight.js";
import { buildEditorialEditFfmpegCommand } from "../src/editorial/buildEditorialEditFfmpegCommand.js";
import { buildEditorialRoughCutRenderPlan } from "../src/editorial/buildEditorialRoughCutRenderPlan.js";
import { downgradeE2EquivalentEditorialPlanV2ToV1 } from "../src/editorial/migrateEditorialPlan.js";
import { buildEpisodeRoughCutFfmpegCommand } from "../src/composition/buildEpisodeRoughCutFfmpegCommand.js";

// Local, in-memory fixtures only (repeated per E4 test file; no shared helper path is authorized).
type AnyRecord = Record<string, any>;
const MEDIA_ROOT = "D:/Busybookie/Production";
const SHA = (c: string) => c.repeat(64);
type ShotSpec = { frames?: number; in?: number; out?: number; sha?: string; cacheKey?: string };
function basePlan(options: { shots?: ShotSpec[]; edges?: number[]; title?: string } = {}): EditorialPlanV2 {
  const specs = options.shots ?? [{}, {}];
  const episodeId = "EP02";
  const ids = specs.map((_, i) => `S${String(i + 1).padStart(2, "0")}`);
  const edges = ids.slice(1).map((_, i) => {
    const t = options.edges?.[i] ?? 0;
    return t > 0 ? { type: "CROSS_DISSOLVE" as const, overlapFrames: t } : { type: "CUT" as const };
  });
  const frames = specs.map((s) => s.frames ?? 100);
  const ranges = specs.map((s, i) => ({ assetDurationFrames: frames[i]!, sourceInFrame: s.in ?? 0, sourceOutFrame: s.out ?? frames[i]! }));
  const timeline = deriveEditorialTimeline(ranges, edges);
  const assetId = (id: string) => `normalized:${episodeId}:${id}`;
  return validateEditorialPlanV2({
    schemaVersion: "2.0", planType: "BUSYBOOKIE_EDITORIAL_PLAN",
    episode: { episodeId, title: options.title ?? "Synthetic episode", manifestSha256: SHA("e") },
    editorialDecisionsSha256: null,
    profile: { profileId: "busybookie-master-v1", aspectRatio: "16:9", width: 1920, height: 1080, frameRate: { numerator: 25, denominator: 1 },
      audioSampleRateHz: 48000, audioChannels: 2, audioChannelLayout: "stereo" },
    timelineDurationFrames: timeline.timelineDurationFrames,
    shots: ids.map((id, i) => ({ shotId: id, sceneId: "SC01", order: i + 1, title: `Shot ${i + 1}`, assetId: assetId(id) })),
    assets: ids.map((id, i) => {
      const cacheKey = specs[i]!.cacheKey ?? SHA(String(i % 10));
      return { assetId: assetId(id), kind: "NORMALIZED_SHOT", sha256: specs[i]!.sha ?? SHA("d"), bytes: 200, contentType: "video/mp4",
        mediaRootRelativePath: `cache/composition-normalized/${episodeId}/${id}/${episodeId}_${id}_${cacheKey}.mp4`,
        normalization: { schemaVersion: "1.0", profileId: "busybookie-master-normalization-v1", cacheKey },
        generatedSource: { provider: "VEO", providerExecutionId: `task-${i}`, sourceSha256: SHA("1"), sourceBytes: 100, sourceContentType: null },
        assetDurationFrames: frames[i]! };
    }),
    tracks: [
      { trackId: "V1", kind: "VIDEO", clips: ids.map((id, i) => ({ clipId: `V1-${id}`, shotId: id, assetId: assetId(id),
        sourceInFrame: ranges[i]!.sourceInFrame, sourceOutFrame: ranges[i]!.sourceOutFrame, timelineStartFrame: timeline.video[i]!.timelineStartFrame })) },
      { trackId: "A1", kind: "SHOT_AUDIO", clips: ids.map((id, i) => ({ clipId: `A1-${id}`, shotId: id, assetId: assetId(id),
        sourceInFrame: timeline.audio[i]!.sourceInFrame, sourceOutFrame: timeline.audio[i]!.sourceOutFrame,
        timelineStartFrame: timeline.audio[i]!.timelineStartFrame, linkedClipId: `V1-${id}`, audio: { mode: "PRESERVE_NATIVE" } })) },
    ],
    transitions: edges.map((edge, i) => ({ outgoingClipId: `V1-${ids[i]}`, incomingClipId: `V1-${ids[i + 1]}`, ...edge })),
  });
}
function audioAsset(slug: string, overrides: AnyRecord = {}): AnyRecord {
  return { assetId: `audio:${slug}`, kind: "EXTERNAL_AUDIO", sha256: SHA("a"), bytes: 1_000_000, mediaRootRelativePath: `music/${slug}.wav`,
    contentType: "audio/wav", codec: "pcm_s16le", sampleFormat: "s16", sampleRateHz: 48000, channelCount: 2, assetDurationSamples: 96_000, ...overrides };
}
function layer(slug: string, assetSlug: string, overrides: AnyRecord = {}): AnyRecord {
  return { layerId: `layer:${slug}`, role: "MUSIC", assetId: `audio:${assetSlug}`, sourceInSample: 0, sourceOutSample: 48_000,
    timelineStartSample: 0, gainCentiDb: 0, muted: false, fadeInSamples: 0, fadeOutSamples: 0, ...overrides };
}
function bindingOf(asset: AnyRecord): AnyRecord {
  const { kind: _kind, mediaRootRelativePath: _path, ...rest } = asset;
  return rest;
}
function decisionsFor(base: unknown, assets: AnyRecord[], layers: AnyRecord[], bed = { bedGainCentiDb: 0, bedMuted: false }): AnyRecord {
  const ids: string[] = [];
  for (const l of layers) if (!ids.includes(l.assetId)) ids.push(l.assetId);
  return { schemaVersion: "1.0", decisionsType: "BUSYBOOKIE_AUDIO_MIX_DECISIONS",
    sourceBinding: { baseEditorialPlanSha256: hashEditorialPlanV2(base), externalAudioAssets: ids.map((id) => bindingOf(assets.find((a) => a.assetId === id)!)) },
    bed, layers };
}
function mixPlan(base: unknown, assets: AnyRecord[], layers: AnyRecord[], bed?: { bedGainCentiDb: number; bedMuted: boolean }) {
  return buildEditorialPlanV3({ basePlan: base, externalAudioAssets: assets, audioMixDecisions: decisionsFor(base, assets, layers, bed) });
}
function e4(plan: unknown, mediaRoot = MEDIA_ROOT): EditorialMixRenderPlan {
  const route = planEditorialRenderV3({ plan, mediaRoot });
  if (route.route !== "E4_MIX") throw new Error(`expected E4_MIX, got ${route.route}`);
  return route.renderPlan;
}
function evidenceFor(renderPlan: EditorialMixRenderPlan) {
  return {
    baseEvidence: renderPlan.inputs.flatMap((e) => (e.mediaKind === "NORMALIZED_SHOT" ? [{ assetId: e.assetId, sha256: e.sha256, bytes: e.bytes,
      decodedVideoFrameCount: e.assetDurationFrames, decodedAudioSampleCount: e.assetDurationFrames * 1920 }] : [])),
    externalEvidence: renderPlan.inputs.flatMap((e) => (e.mediaKind === "EXTERNAL_AUDIO" ? [{ assetId: e.assetId, sha256: e.sha256, bytes: e.bytes,
      riffHeaderId: "RIFF", formatName: "wav", streamCount: 1, audioStreamCount: 1, codec: "pcm_s16le", sampleFormat: "s16", sampleRateHz: 48000,
      channelCount: e.channelCount, reportedChannelLayout: e.channelCount === 1 ? "MONO" : "STEREO", decodedSampleFrameCount: e.assetDurationSamples }] : [])),
    peakEvidence: { renderKey: renderPlan.renderKey, mixGraphSha256: renderPlan.mixGraphSha256, channelCount: 2,
      decodedSampleFrameCount: renderPlan.timelineDurationSamples, nonFiniteSampleCount: 0, maxAbsSampleF32Bits: 0x3f000000 },
  };
}
function mixCommand(renderPlan: EditorialMixRenderPlan, outputPath = renderPlan.outputPath) {
  const receipt = assertEditorialMixRenderPreflight({ renderPlan, ...evidenceFor(renderPlan), outputPath });
  return buildEditorialMixFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan, receipt, outputPath });
}
// RENDER_EFFECTIVE_ARGV_V1: mask only the -i operands (by slot) and the terminal output operand.
function renderEffectiveArgv(args: readonly string[]): string[] {
  let slot = 0;
  return args.map((arg, index) => (index === args.length - 1 ? "<OUTPUT_PATH>" : args[index - 1] === "-i" ? `<INPUT_PATH:${slot++}>` : arg));
}
function e3Command(renderPlan: EditorialEditRenderPlan) {
  const preflight = assertEditorialEditRenderPreflight({ renderPlan, evidence: renderPlan.inputs.map((entry) => ({
    assetId: entry.assetId, decodedVideoFrameCount: entry.assetDurationFrames, decodedAudioSampleCount: entry.assetDurationFrames * 1920 })) });
  return buildEditorialEditFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan, preflight, outputPath: renderPlan.outputPath });
}
const filterOf = (args: readonly string[]) => args[args.indexOf("-filter_complex") + 1]!;
const e2Base = basePlan();
const e3Base = basePlan({ shots: [{ in: 10 }, { out: 90 }, {}], edges: [5, 0] });
const music = audioAsset("theme");

describe("E4 render planning, identity and route triage", () => {
  it("T4-20 bed mute alone is effective; muted bed gain is render-ineffective (key, graph and argv identical)", () => {
    const muted = mixPlan(e2Base, [], [], { bedGainCentiDb: 0, bedMuted: true });
    const mutedLoud = mixPlan(e2Base, [], [], { bedGainCentiDb: -1200, bedMuted: true });
    const [a, b] = [e4(muted), e4(mutedLoud)];
    expect(a.renderIdentity.bed.level).toStrictEqual({ mode: "MUTED" });
    expect(a.audioGraph).toContain("[aout]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=0:precision=float[mb]");
    expect(b.renderKey).toBe(a.renderKey);
    expect(b.audioGraph).toBe(a.audioGraph);
    expect(b.mixGraphSha256).toBe(a.mixGraphSha256);
    expect(mixCommand(b).args).toStrictEqual(mixCommand(a).args);
    expect(hashEditorialPlanV3(mutedLoud)).not.toBe(hashEditorialPlanV3(muted));
    expect(a.inputs).toHaveLength(2);
  });

  it("T4-22 a muted layer is fully validated but absent from inputs, graph and identity", () => {
    const quiet = audioAsset("quiet", { sha256: SHA("b"), mediaRootRelativePath: "ambience/quiet.wav" });
    expect(() => mixPlan(e2Base, [music, quiet], [layer("a", "theme"), layer("m", "quiet", { muted: true, sourceOutSample: 96_001 })]))
      .toThrow(/exceeds its asset/);
    expect(() => mixPlan(e2Base, [music, quiet], [layer("a", "theme"), layer("m", "quiet", { muted: true, timelineStartSample: 384_000 })]))
      .toThrow(/inside the base timeline/);
    const plan = mixPlan(e2Base, [music, quiet], [layer("m", "quiet", { muted: true, gainCentiDb: 600 }), layer("a", "theme")]);
    const renderPlan = e4(plan);
    expect(renderPlan.inputs.map((entry) => entry.assetId)).toStrictEqual(["normalized:EP02:S01", "normalized:EP02:S02", "audio:theme"]);
    expect(renderPlan.renderIdentity.layers).toHaveLength(1);
    expect(renderPlan.audioGraph).not.toMatch(/\[3:a:0\]|volume=6dB|quiet/);
    expect(mixCommand(renderPlan).args.join(" ")).not.toContain("quiet.wav");
  });

  it("T4-26 role enum of four descriptive values; VOICEOVER rejected; role never reaches the render key", () => {
    const keys = ["MUSIC", "SFX", "AMBIENCE", "OTHER"].map((role) => e4(mixPlan(e2Base, [music], [layer("a", "theme", { role })])));
    for (const renderPlan of keys) {
      expect(renderPlan.renderKey).toBe(keys[0]!.renderKey);
      expect(renderPlan.audioGraph).toBe(keys[0]!.audioGraph);
    }
    for (const role of ["VOICEOVER", "DIALOGUE", "music"]) expect(() => mixPlan(e2Base, [music], [layer("a", "theme", { role })])).toThrow(/schema/);
  });

  it("T4-37 E2 exact parity: no-mix 3.0 on an E2-equivalent base equals the legacy plan, renderKey, outputPath, executable and argv", () => {
    const legacy = planEditorialRenderV2({ plan: e2Base, mediaRoot: MEDIA_ROOT });
    if (legacy.route !== "E2_ROUGH_CUT") throw new Error("expected E2");
    const legacyCommand = buildEpisodeRoughCutFfmpegCommand({ ffmpegExecutable: "ffmpeg", plan: legacy.renderPlan, outputPath: legacy.renderPlan.outputPath });
    for (const plan of [migrateEditorialPlanV2ToV3(e2Base), mixPlan(e2Base, [], []), mixPlan(e2Base, [music], [layer("m", "theme", { muted: true })])]) {
      const route = planEditorialRenderV3({ plan, mediaRoot: MEDIA_ROOT });
      expect(route).toStrictEqual(legacy);
      if (route.route !== "E2_ROUGH_CUT") throw new Error("expected E2");
      expect(route.renderPlan.renderKey).toBe(legacy.renderPlan.renderKey);
      expect(route.renderPlan.outputPath).toBe(legacy.renderPlan.outputPath);
      const command = buildEpisodeRoughCutFfmpegCommand({ ffmpegExecutable: "ffmpeg", plan: route.renderPlan, outputPath: route.renderPlan.outputPath });
      expect(command).toStrictEqual(legacyCommand);
    }
  });

  it("T4-38 E3 exact parity: no-mix 3.0 on a trimmed/dissolved base equals planEditorialRenderV2 plan, renderKey and argv", () => {
    const legacy = planEditorialRenderV2({ plan: e3Base, mediaRoot: MEDIA_ROOT });
    if (legacy.route !== "E3_EDIT") throw new Error("expected E3");
    for (const plan of [migrateEditorialPlanV2ToV3(e3Base), mixPlan(e3Base, [music], [layer("m", "theme", { muted: true, gainCentiDb: -600 })])]) {
      const route = planEditorialRenderV3({ plan, mediaRoot: MEDIA_ROOT });
      expect(route).toStrictEqual(legacy);
      if (route.route !== "E3_EDIT") throw new Error("expected E3");
      expect(route.renderPlan.renderKey).toBe(legacy.renderPlan.renderKey);
      expect(e3Command(route.renderPlan)).toStrictEqual(e3Command(legacy.renderPlan));
    }
  });

  it("T4-39 route triage reaches E2_ROUGH_CUT, E3_EDIT and E4_MIX by the effective-mix predicate", () => {
    expect(planEditorialRenderV3({ plan: migrateEditorialPlanV2ToV3(e2Base), mediaRoot: MEDIA_ROOT }).route).toBe("E2_ROUGH_CUT");
    expect(planEditorialRenderV3({ plan: migrateEditorialPlanV2ToV3(e3Base), mediaRoot: MEDIA_ROOT }).route).toBe("E3_EDIT");
    for (const plan of [mixPlan(e2Base, [music], [layer("a", "theme")]), mixPlan(e3Base, [], [], { bedGainCentiDb: 0, bedMuted: true }),
      mixPlan(e2Base, [], [], { bedGainCentiDb: 1, bedMuted: false })]) {
      const route = planEditorialRenderV3({ plan, mediaRoot: MEDIA_ROOT });
      expect(route.route).toBe("E4_MIX");
      if (route.route === "E4_MIX") expect(route.renderPlan.profileId).toBe("busybookie-episode-mix-v1");
    }
  });

  it("T4-40 E2-equivalent base + effective mix routes to E4 without the E3 builder; base equals the validated E2 semantics", () => {
    expect(() => buildEditorialEditRenderPlan({ plan: e2Base, mediaRoot: MEDIA_ROOT })).toThrow(/E2-equivalent/);
    const renderPlan = e4(mixPlan(e2Base, [music], [layer("a", "theme")]));
    const e2 = buildEditorialRoughCutRenderPlan({ plan: downgradeE2EquivalentEditorialPlanV2ToV1(e2Base), mediaRoot: MEDIA_ROOT });
    const identity = renderPlan.renderIdentity;
    expect(e2.totalDurationSeconds * 25).toBe(renderPlan.timelineDurationFrames);
    expect(identity.videoJoins.every((join) => join.type === "CUT")).toBe(true);
    for (const [i, shot] of e2.shots.entries()) {
      const frames = shot.durationSeconds * 25;
      expect(identity.inputs[i]).toStrictEqual({ inputIndex: i, mediaKind: "NORMALIZED_SHOT", sha256: shot.sourceSha256 });
      expect(renderPlan.inputs[i]!.path).toBe(shot.sourceVideoPath);
      expect(identity.videoSegments[i]).toStrictEqual({ inputIndex: i, sourceInFrame: 0, sourceOutFrame: frames });
      expect(identity.bed.segments[i]).toStrictEqual({ inputIndex: i, sourceInSample: 0, sourceOutSample: frames * 1920 });
    }
    expect(renderPlan.profileId).toBe("busybookie-episode-mix-v1");
  });

  it("T4-41 E3 bases: the real E3 -filter_complex is a byte prefix of the E4 one; inputs and identity fields equal E3", () => {
    const fixtures = [
      basePlan({ shots: [{ in: 10 }, { out: 90 }, {}], edges: [0, 0] }),
      basePlan({ shots: [{}, {}], edges: [5] }),
      basePlan({ shots: [{}, {}], edges: [6] }),
      basePlan({ shots: [{ in: 3 }, {}, { out: 70 }], edges: [0, 7] }),
      basePlan({ shots: [{ in: 10 }] }),
    ];
    for (const base of fixtures) {
      const e3Plan = buildEditorialEditRenderPlan({ plan: base, mediaRoot: MEDIA_ROOT });
      const e3 = e3Command(e3Plan);
      const renderPlan = e4(mixPlan(base, [music], [layer("a", "theme", { gainCentiDb: -600 })]));
      const mix = mixCommand(renderPlan);
      expect(filterOf(mix.args).startsWith(`${filterOf(e3.args)};`)).toBe(true);
      const inputCount = e3Plan.inputs.length * 2;
      expect(mix.args.slice(5, 5 + inputCount)).toStrictEqual(e3.args.slice(5, 5 + inputCount));
      expect(mix.args[mix.args.indexOf("-map") + 1]).toBe(e3.args[e3.args.indexOf("-map") + 1]);
      expect(renderPlan.renderIdentity.videoSegments).toStrictEqual(e3Plan.renderIdentity.videoSegments);
      expect(renderPlan.renderIdentity.videoJoins).toStrictEqual(e3Plan.renderIdentity.videoJoins);
      expect(renderPlan.renderIdentity.bed.segments).toStrictEqual(e3Plan.renderIdentity.audioSegments);
      expect(renderPlan.timelineDurationFrames).toBe(e3Plan.timelineDurationFrames);
    }
  });

  it("T4-42 every render-effective field changes the renderKey", () => {
    const mono = audioAsset("theme", { channelCount: 1 });
    const reference = (overrides: AnyRecord = {}, asset = music, bed = { bedGainCentiDb: -200, bedMuted: false }, base = e2Base) =>
      e4(mixPlan(base, [asset], [layer("a", "theme", { gainCentiDb: -300, fadeInSamples: 480, timelineStartSample: 1000, ...overrides })], bed)).renderKey;
    const keys = [
      reference(), reference({ gainCentiDb: -301 }), reference({ timelineStartSample: 1001 }), reference({ sourceInSample: 1 }),
      reference({ sourceOutSample: 47_999 }), reference({ fadeInSamples: 482 }), reference({ fadeOutSamples: 2 }), reference({}, mono),
      reference({}, audioAsset("theme", { sha256: SHA("f") })), reference({}, music, { bedGainCentiDb: -201, bedMuted: false }),
      reference({}, music, { bedGainCentiDb: -200, bedMuted: true }), reference({}, music, undefined, basePlan({ shots: [{ in: 1 }, {}] })),
      reference({}, music, undefined, basePlan({ edges: [4] })), reference({}, music, undefined, basePlan({ shots: [{ sha: SHA("c") }, {}] })),
      e4(mixPlan(e2Base, [music], [layer("a", "theme", { gainCentiDb: -300, fadeInSamples: 480, timelineStartSample: 1000 }),
        layer("b", "theme", { timelineStartSample: 5 })], { bedGainCentiDb: -200, bedMuted: false })).renderKey,
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("T4-43 provenance-only changes leave renderKey, graph bytes and mixGraphSha256 unchanged", () => {
    const reference = e4(mixPlan(e2Base, [music], [layer("a", "theme", { gainCentiDb: -300 })]));
    const renamed = audioAsset("renamed", { mediaRootRelativePath: "sfx/elsewhere/renamed.wav" });
    const retitled = basePlan({ title: "Retitled" });
    const variants = [
      e4(mixPlan(e2Base, [music], [layer("a", "theme", { gainCentiDb: -300, role: "AMBIENCE" })])),
      e4(mixPlan(e2Base, [music], [layer("zz-other", "theme", { gainCentiDb: -300 })])),
      e4(mixPlan(e2Base, [renamed], [layer("a", "renamed", { gainCentiDb: -300 })])),
      e4(mixPlan(e2Base, [{ ...music, mediaRootRelativePath: "ambience/theme.wav" }], [layer("a", "theme", { gainCentiDb: -300 })])),
      e4(mixPlan(retitled, [music], [layer("a", "theme", { gainCentiDb: -300 })])),
      e4(mixPlan(e2Base, [music], [layer("a", "theme", { gainCentiDb: -300 })]), "E:/Other/Root"),
    ];
    for (const variant of variants) {
      expect(variant.renderKey).toBe(reference.renderKey);
      expect(variant.audioGraph).toBe(reference.audioGraph);
      expect(variant.mixGraphSha256).toBe(reference.mixGraphSha256);
    }
    expect(variants[4]!.title).toBe("Retitled");
  });

  it("T4-44 muted-layer-only mutations: plan hash changes; renderKey, graph, input count and every inputIndex unchanged", () => {
    const quiet = audioAsset("quiet", { sha256: SHA("b"), mediaRootRelativePath: "ambience/quiet.wav" });
    const twin = audioAsset("twin", { sha256: SHA("b"), mediaRootRelativePath: "ambience/twin.wav" });
    const effective = layer("a", "theme", { gainCentiDb: -300 });
    const muted = layer("m", "quiet", { muted: true, sourceOutSample: 9_600 });
    const reference = mixPlan(e2Base, [music, quiet], [effective, muted]);
    const referencePlan = e4(reference);
    const variants = [
      mixPlan(e2Base, [music, quiet], [effective, { ...muted, role: "SFX" }]),
      mixPlan(e2Base, [music, quiet], [effective, { ...muted, gainCentiDb: 900 }]),
      mixPlan(e2Base, [music, quiet], [effective, { ...muted, fadeInSamples: 4 }]),
      mixPlan(e2Base, [music, quiet], [effective, { ...muted, fadeOutSamples: 4 }]),
      mixPlan(e2Base, [music, quiet], [effective, { ...muted, layerId: "layer:renamed" }]),
      mixPlan(e2Base, [music, twin], [effective, { ...muted, assetId: "audio:twin" }]),
      mixPlan(e2Base, [music, { ...quiet, sha256: SHA("c"), bytes: 999_000 }], [effective, muted]),
    ];
    for (const plan of variants) {
      expect(hashEditorialPlanV3(plan)).not.toBe(hashEditorialPlanV3(reference));
      const renderPlan = e4(plan);
      expect(renderPlan.renderKey).toBe(referencePlan.renderKey);
      expect(renderPlan.audioGraph).toBe(referencePlan.audioGraph);
      expect(renderPlan.mixGraphSha256).toBe(referencePlan.mixGraphSha256);
      expect(renderPlan.inputs.map((entry) => entry.inputIndex)).toStrictEqual(referencePlan.inputs.map((entry) => entry.inputIndex));
      expect(renderPlan.renderIdentity.layers.map((l) => l.inputIndex)).toStrictEqual([2]);
    }
  });

  it("T4-45 E4RenderIdentityV1 is strict; equal identity yields byte-identical graph and render-effective argv", () => {
    const renderPlan = e4(mixPlan(e2Base, [music], [layer("a", "theme", { gainCentiDb: -300 })]));
    const identity = structuredClone(renderPlan.renderIdentity) as AnyRecord;
    expect(hashE4RenderIdentityV1(identity)).toBe(renderPlan.renderKey);
    for (const mutate of [(i: AnyRecord) => { i.extra = 1; }, (i: AnyRecord) => { delete i.fadeLaw; }, (i: AnyRecord) => { i.layers[0].layerId = "layer:a"; },
      (i: AnyRecord) => { i.inputs[2].assetId = "audio:theme"; }, (i: AnyRecord) => { i.layers[0].role = "MUSIC"; }, (i: AnyRecord) => { i.bed.level = { mode: "GAIN" }; },
      (i: AnyRecord) => { i.layers[0].channelMap = "MONO_DUPLICATE"; }, (i: AnyRecord) => { i.layers[0].inputIndex = 0; }]) {
      const candidate = structuredClone(identity);
      mutate(candidate);
      expect(() => hashE4RenderIdentityV1(candidate)).toThrow(/E4 render identity/);
    }
    const other = e4(mixPlan(basePlan({ title: "Another title" }), [audioAsset("x", { mediaRootRelativePath: "sfx/x.wav" })],
      [layer("other", "x", { gainCentiDb: -300, role: "OTHER" })]), "E:/Other/Root");
    expect(other.renderIdentity).toStrictEqual(renderPlan.renderIdentity);
    expect(other.audioGraph).toBe(renderPlan.audioGraph);
    const [left, right] = [mixCommand(renderPlan), mixCommand(other)];
    expect(right.args).not.toStrictEqual(left.args);
    expect(renderEffectiveArgv(right.args)).toStrictEqual(renderEffectiveArgv(left.args));
  });

  it("T4-46 inputIndex: base slots first in base order, external slots by first effective reference; muted references ignored", () => {
    const a = audioAsset("a"), b = audioAsset("b", { sha256: SHA("b"), channelCount: 1 });
    const renderPlan = e4(mixPlan(e2Base, [a, b], [layer("m", "a", { muted: true }), layer("one", "b"), layer("two", "a", { timelineStartSample: 10 }),
      layer("three", "b", { timelineStartSample: 20 })]));
    expect(renderPlan.inputs.map((entry) => [entry.inputIndex, entry.assetId])).toStrictEqual([
      [0, "normalized:EP02:S01"], [1, "normalized:EP02:S02"], [2, "audio:b"], [3, "audio:a"]]);
    expect(renderPlan.renderIdentity.layers.map((l) => [l.inputIndex, l.channelMap])).toStrictEqual([
      [2, "MONO_DUPLICATE"], [3, "STEREO_PASSTHROUGH"], [2, "MONO_DUPLICATE"]]);
  });

  it("T4-47 equal-content logical swap (different ids and locators) preserves slots, topology, graph, key and render-effective argv", () => {
    const left = audioAsset("left", { mediaRootRelativePath: "sfx/left.wav" });
    const right = audioAsset("right", { mediaRootRelativePath: "music/right.wav" });
    expect([left.sha256, left.bytes, left.assetDurationSamples]).toStrictEqual([right.sha256, right.bytes, right.assetDurationSamples]);
    const placements = (first: string, second: string) => [layer("one", first, { gainCentiDb: -300 }), layer("two", second, { timelineStartSample: 96_000 })];
    const original = mixPlan(e2Base, [left, right], placements("left", "right"));
    const swapped = mixPlan(e2Base, [left, right], placements("right", "left"));
    expect(original.audioMix.externalAudioAssets.map((asset) => asset.assetId)).toStrictEqual(["audio:left", "audio:right"]);
    expect(swapped.audioMix.externalAudioAssets.map((asset) => asset.assetId)).toStrictEqual(["audio:right", "audio:left"]);
    expect(hashEditorialPlanV3(swapped)).not.toBe(hashEditorialPlanV3(original));
    const [x, y] = [e4(original), e4(swapped)];
    expect(y.inputs.filter((entry) => entry.mediaKind === "EXTERNAL_AUDIO")).toHaveLength(2);
    expect(y.renderIdentity.layers.map((l) => l.inputIndex)).toStrictEqual(x.renderIdentity.layers.map((l) => l.inputIndex));
    expect(y.audioGraph).toBe(x.audioGraph);
    expect(y.mixGraphSha256).toBe(x.mixGraphSha256);
    expect(y.renderKey).toBe(x.renderKey);
    const [cx, cy] = [mixCommand(x), mixCommand(y)];
    expect(renderEffectiveArgv(cy.args)).toStrictEqual(renderEffectiveArgv(cx.args));
    const differing = cx.args.flatMap((arg, index) => (arg === cy.args[index] ? [] : [index]));
    expect(differing.length).toBe(2);
    for (const index of differing) expect(cx.args[index - 1]).toBe("-i");
    // Same runtime path for both logical assets: the literal argv itself is unchanged by the swap.
    const sameLeft = { ...left, mediaRootRelativePath: "sfx/same.wav" };
    const sameRight = { ...right, mediaRootRelativePath: "sfx/same.wav" };
    const p = e4(mixPlan(e2Base, [sameLeft, sameRight], placements("left", "right")));
    const q = e4(mixPlan(e2Base, [sameLeft, sameRight], placements("right", "left")));
    expect(mixCommand(q).args).toStrictEqual(mixCommand(p).args);
  });
});

describe("E4 render identity duration integrity (Step 1070 i1 regression; unnumbered)", () => {
  // A true-E3 base: 3 segments (90 + 90 + 100 frames), one 5-frame dissolve and one CUT -> 275 frames = 528,000 samples.
  const genuine = e4(mixPlan(e3Base, [music], [layer("a", "theme", { gainCentiDb: -300 })]));
  // Forgery: key and graph are recomputed over the malformed identity with the non-validating primitives, so the plan is
  // self-consistent and any rejection must come from semantic identity validation, never from a stale hash.
  function forge(mutate: (identity: AnyRecord) => void, source: EditorialMixRenderPlan = genuine): EditorialMixRenderPlan {
    const identity = structuredClone(source.renderIdentity) as AnyRecord;
    mutate(identity);
    const audioGraph = buildEditorialMixAudioGraph(identity as never);
    return { ...source, renderIdentity: identity as never, renderKey: editorialSha256(canonicalEditorialJson(identity)),
      audioGraph, mixGraphSha256: hashEditorialMixAudioGraph(audioGraph), timelineDurationSamples: identity.timelineDurationSamples };
  }
  // A checksum-valid receipt bound to the forged plan, so the final builder cannot reject it for receipt reasons.
  function receiptFor(plan: EditorialMixRenderPlan): AnyRecord {
    const payload = { receiptType: "BUSYBOOKIE_E4_PREFLIGHT_RECEIPT", receiptVersion: "1", renderKey: plan.renderKey,
      mixGraphSha256: plan.mixGraphSha256, outputPath: plan.outputPath, baseEvidenceSha256: SHA("1"),
      externalEvidenceSha256: SHA("2"), peakEvidenceSha256: SHA("3") };
    return { ...payload, receiptSha256: editorialSha256(canonicalEditorialJson(payload)) };
  }
  const BED = /A1 bed duration contradicts timelineDurationSamples/;
  const VIDEO = /video timeline duration contradicts timelineDurationSamples/;
  const FRAMES = /not a whole number of 25 fps frames/;
  const DISSOLVE = /dissolve overlaps must leave at least one independent frame per video segment/;
  const SAFE = /exceeds the safe integer range/;
  // Re-derives T (exact integer law) and stretches the last bed segment to it, so only the dissolve law is violated.
  function cohere(i: AnyRecord): void {
    const lengths = i.videoSegments.map((s: AnyRecord) => s.sourceOutFrame - s.sourceInFrame);
    const frames = lengths.reduce((sum: number, length: number, index: number) => sum + length -
      (index > 0 && i.videoJoins[index - 1].type === "CROSS_DISSOLVE" ? i.videoJoins[index - 1].overlapFrames : 0), 0);
    i.timelineDurationSamples = frames * 1_920;
    const last = i.bed.segments.at(-1);
    const others = i.bed.segments.slice(0, -1).reduce((sum: number, s: AnyRecord) => sum + s.sourceOutSample - s.sourceInSample, 0);
    last.sourceOutSample = last.sourceInSample + i.timelineDurationSamples - others;
  }
  const MAX = Number.MAX_SAFE_INTEGER;
  const cases: [string, (identity: AnyRecord) => void, RegExp][] = [
    // Step 1072 f1072-1a: true V = (2^53-1) + (2^53-4) + 5 - (2^53-1) - (2^53-101) = 102 frames, but unchecked Number
    // arithmetic yields 101; T and the bed claim 101. Every primitive is an individually valid safe integer.
    ["float-precision cancellation forgery (true 102 frames, rounded 101)", (i) => {
      i.videoSegments = [{ inputIndex: 0, sourceInFrame: 0, sourceOutFrame: MAX }, { inputIndex: 1, sourceInFrame: 0, sourceOutFrame: MAX - 3 },
        { inputIndex: 2, sourceInFrame: 0, sourceOutFrame: 5 }];
      i.videoJoins = [{ type: "CROSS_DISSOLVE", overlapFrames: MAX }, { type: "CROSS_DISSOLVE", overlapFrames: MAX - 100 }];
      i.timelineDurationSamples = 101 * 1_920;
      i.bed.segments = [{ inputIndex: 0, sourceInSample: 0, sourceOutSample: 101 * 1_920 - 2 }, { inputIndex: 1, sourceInSample: 0, sourceOutSample: 1 },
        { inputIndex: 2, sourceInSample: 0, sourceOutSample: 1 }];
    }, DISSOLVE],
    // Step 1072 f1072-1b: a 5-frame outgoing segment under a 10-frame dissolve (durations coherent).
    ["overlong outgoing dissolve (5-frame segment, 10-frame overlap)", (i) => {
      i.videoSegments[0].sourceOutFrame = i.videoSegments[0].sourceInFrame + 5; i.videoJoins[0].overlapFrames = 10; cohere(i);
    }, DISSOLVE],
    ["outgoing overlap equal to the segment length", (i) => {
      i.videoSegments[0].sourceOutFrame = i.videoSegments[0].sourceInFrame + 5; cohere(i);
    }, DISSOLVE],
    // Middle segment consumes 5 + 3 of 90 (valid); only the 3-frame last segment is fully consumed.
    ["incoming dissolve consuming the whole last segment", (i) => {
      i.videoSegments[2].sourceOutFrame = i.videoSegments[2].sourceInFrame + 3; i.videoJoins[1] = { type: "CROSS_DISSOLVE", overlapFrames: 3 }; cohere(i);
    }, DISSOLVE],
    ["checked video addition overflow (CUT chain beyond 2^53)", (i) => {
      i.videoSegments = [0, 1, 2].map((inputIndex) => ({ inputIndex, sourceInFrame: 0, sourceOutFrame: inputIndex < 2 ? 2 ** 52 : 1 }));
      i.videoJoins = [{ type: "CUT" }, { type: "CUT" }];
    }, SAFE],
    ["checked bed addition overflow (bed segments beyond 2^53)", (i) => {
      i.bed.segments = [0, 1, 2].map((inputIndex) => ({ inputIndex, sourceInSample: 0, sourceOutSample: inputIndex < 2 ? 2 ** 52 : 1 }));
    }, SAFE],
    ["short bed (-1920 samples)", (i) => { i.bed.segments[2].sourceOutSample -= 1_920; }, BED],
    ["long bed (+1920 samples)", (i) => { i.bed.segments[2].sourceOutSample += 1_920; }, BED],
    ["short bed (-1 sample)", (i) => { i.bed.segments[0].sourceInSample += 1; }, BED],
    ["short video (-1 frame)", (i) => { i.videoSegments[2].sourceOutFrame -= 1; }, VIDEO],
    ["long video (+1 frame)", (i) => { i.videoSegments[0].sourceInFrame -= 1; }, VIDEO],
    ["dissolve overlap +1 frame", (i) => { i.videoJoins[0].overlapFrames += 1; }, VIDEO],
    ["dissolve replaced by CUT", (i) => { i.videoJoins[0] = { type: "CUT" }; }, VIDEO],
    ["sample/frame misalignment", (i) => { i.timelineDurationSamples += 1; i.bed.segments[2].sourceOutSample += 1; }, FRAMES],
  ];

  it("the genuine identity is coherent and a coherent but different identity stays valid (no overreach)", () => {
    expect(genuine.renderIdentity.timelineDurationSamples).toBe(275 * 1_920);
    expect(() => assertEditorialMixRenderPlanIntegrity(genuine)).not.toThrow();
    const shifted = forge((i) => {
      i.bed.segments[0].sourceInSample += 1_920; i.bed.segments[0].sourceOutSample += 1_920;
      i.videoSegments[0].sourceInFrame -= 1; i.videoSegments[0].sourceOutFrame -= 1;
    });
    expect(() => assertEditorialMixRenderPlanIntegrity(shifted)).not.toThrow();
    expect(hashE4RenderIdentityV1(shifted.renderIdentity)).toBe(shifted.renderKey);
    expect(shifted.renderKey).not.toBe(genuine.renderKey);
  });

  it("middle-segment dissolve law is exact: left + right = D - 1 is valid end to end, left + right = D is rejected everywhere", () => {
    // Planner-built true E3 base: middle segment D = 10 frames with incoming 4 and outgoing 5 overlaps (4 + 5 = D - 1).
    const boundary = e4(mixPlan(basePlan({ shots: [{}, { frames: 10 }, {}], edges: [4, 5] }), [music], [layer("a", "theme", { gainCentiDb: -300 })]));
    expect(boundary.renderIdentity.videoSegments[1]).toStrictEqual({ inputIndex: 1, sourceInFrame: 0, sourceOutFrame: 10 });
    expect(boundary.renderIdentity.videoJoins).toStrictEqual([{ type: "CROSS_DISSOLVE", overlapFrames: 4 }, { type: "CROSS_DISSOLVE", overlapFrames: 5 }]);
    expect(() => validateE4RenderIdentityV1(boundary.renderIdentity)).not.toThrow();
    expect(filterOf(mixCommand(boundary).args)).toContain("xfade=transition=fade:duration=0.2:offset=4.04");
    const forgedBoundary = forge((i) => { i.bed.segments[0].sourceInSample += 1; i.bed.segments[0].sourceOutSample += 1; }, boundary);
    expect(() => assertEditorialMixRenderPlanIntegrity(forgedBoundary)).not.toThrow();
    // Outgoing overlap 5 -> 6 (4 + 6 = D); T and bed re-derived so the dissolve law is the only violated invariant.
    const over = forge((i) => { i.videoJoins[1].overlapFrames = 6; cohere(i); }, boundary);
    expect(over.renderKey).not.toBe(boundary.renderKey);
    expect(() => validateE4RenderIdentityV1(over.renderIdentity)).toThrow(DISSOLVE);
    expect(() => assertEditorialMixRenderPlanIntegrity(over)).toThrow(DISSOLVE);
    expect(() => assertEditorialMixRenderPreflight({ renderPlan: over, ...evidenceFor(over), outputPath: over.outputPath })).toThrow(DISSOLVE);
    expect(() => buildEditorialMixAnalysisFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan: over,
      analysisOutputPath: "D:\\Busybookie\\Production\\exports\\EP02\\mix\\analysis.f32" })).toThrow(DISSOLVE);
    expect(() => buildEditorialMixFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan: over, receipt: receiptFor(over), outputPath: over.outputPath }))
      .toThrow(DISSOLVE);
  });

  for (const [name, mutate, reason] of cases) {
    it(`rejects a ${name} identity with a recomputed renderKey at every consumer`, () => {
      const forged = forge(mutate);
      expect(forged.renderKey).not.toBe(genuine.renderKey);
      expect(() => validateE4RenderIdentityV1(forged.renderIdentity)).toThrow(reason);
      expect(() => hashE4RenderIdentityV1(forged.renderIdentity)).toThrow(reason);
      expect(() => assertEditorialMixRenderPlanIntegrity(forged)).toThrow(reason);
      expect(() => assertEditorialMixRenderPreflight({ renderPlan: forged, ...evidenceFor(forged), outputPath: forged.outputPath }))
        .toThrow(reason);
      expect(() => buildEditorialMixAnalysisFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan: forged,
        analysisOutputPath: "D:\\Busybookie\\Production\\exports\\EP02\\mix\\analysis.f32" })).toThrow(reason);
      const receipt = receiptFor(forged);
      expect(parseEditorialMixPreflightReceipt(receipt).renderKey).toBe(forged.renderKey);
      expect(() => buildEditorialMixFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan: forged, receipt, outputPath: forged.outputPath }))
        .toThrow(reason);
    });
  }
});
