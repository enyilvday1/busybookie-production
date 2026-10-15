import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveEditorialTimeline } from "../src/editorial/deriveEditorialTimeline.js";
import { hashEditorialPlanV2 } from "../src/editorial/canonicalizeEditorialPlanV2.js";
import { validateEditorialPlanV2 } from "../src/editorial/validateEditorialPlanV2.js";
import type { EditorialPlanV2 } from "../src/editorial/editorialPlanV2.schema.js";
import { buildEditorialPlanV3 } from "../src/editorial/buildEditorialPlanV3.js";
import { maxConcurrentEffectiveLayers } from "../src/editorial/deriveEditorialAudioMix.js";
import type { AudioLayerPlacementV1 } from "../src/editorial/editorialPlanV3.schema.js";
import { planEditorialRenderV3, validateE4RenderIdentityV1, type EditorialMixRenderPlan } from "../src/editorial/buildEditorialMixRenderPlan.js";
import { buildEditorialMixAudioGraph, formatCentiDb } from "../src/editorial/buildEditorialMixAudioGraph.js";
import {
  assertEditorialMixRenderPreflight, parseEditorialMixPreflightReceipt, verifyEditorialMixPreflightReceipt,
} from "../src/editorial/editorialMixRenderPreflight.js";
import { buildEditorialMixAnalysisFfmpegCommand } from "../src/editorial/buildEditorialMixAnalysisFfmpegCommand.js";
import { buildEditorialMixFfmpegCommand } from "../src/editorial/buildEditorialMixFfmpegCommand.js";
import { buildEditorialEditRenderPlan } from "../src/editorial/buildEditorialEditRenderPlan.js";
import { assertEditorialEditRenderPreflight } from "../src/editorial/editorialEditRenderPreflight.js";
import { buildEditorialEditFfmpegCommand } from "../src/editorial/buildEditorialEditFfmpegCommand.js";
import { canonicalEditorialJson, editorialSha256 } from "../src/editorial/canonicalizeEditorialPlan.js";

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
function e4(plan: unknown): EditorialMixRenderPlan {
  const route = planEditorialRenderV3({ plan, mediaRoot: MEDIA_ROOT });
  if (route.route !== "E4_MIX") throw new Error(`expected E4_MIX, got ${route.route}`);
  return route.renderPlan;
}
function evidenceFor(renderPlan: EditorialMixRenderPlan) {
  return {
    baseEvidence: renderPlan.inputs.flatMap((e) => (e.mediaKind === "NORMALIZED_SHOT" ? [{ assetId: e.assetId, sha256: e.sha256, bytes: e.bytes,
      decodedVideoFrameCount: e.assetDurationFrames, decodedAudioSampleCount: e.assetDurationFrames * 1920 }] : [])) as AnyRecord[],
    externalEvidence: renderPlan.inputs.flatMap((e) => (e.mediaKind === "EXTERNAL_AUDIO" ? [{ assetId: e.assetId, sha256: e.sha256, bytes: e.bytes,
      riffHeaderId: "RIFF", formatName: "wav", streamCount: 1, audioStreamCount: 1, codec: "pcm_s16le", sampleFormat: "s16", sampleRateHz: 48000,
      channelCount: e.channelCount, reportedChannelLayout: e.channelCount === 1 ? "MONO" : "STEREO", decodedSampleFrameCount: e.assetDurationSamples }] : [])) as AnyRecord[],
    peakEvidence: { renderKey: renderPlan.renderKey, mixGraphSha256: renderPlan.mixGraphSha256, channelCount: 2,
      decodedSampleFrameCount: renderPlan.timelineDurationSamples, nonFiniteSampleCount: 0, maxAbsSampleF32Bits: 0x3f000000 } as AnyRecord,
  };
}
function receiptFor(renderPlan: EditorialMixRenderPlan, outputPath = renderPlan.outputPath) {
  return assertEditorialMixRenderPreflight({ renderPlan, ...evidenceFor(renderPlan), outputPath });
}
function mixCommand(renderPlan: EditorialMixRenderPlan, outputPath = renderPlan.outputPath) {
  return buildEditorialMixFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan, receipt: receiptFor(renderPlan, outputPath), outputPath });
}
const filterOf = (args: readonly string[]) => args[args.indexOf("-filter_complex") + 1]!;
const statements = (graph: string) => graph.split(";");
const FLOAT = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";
const ORIGIN = "asettb=1/48000,asetpts=PTS-STARTPTS";
const base = basePlan();
const music = audioAsset("theme");

describe("E4 mix graph semantics", () => {
  it("T4-48 mix order: bed first, then effective layers in array order (golden amix), and the bed-only form without amix", () => {
    const quiet = audioAsset("quiet", { sha256: SHA("b"), channelCount: 1 });
    const two = e4(mixPlan(base, [music, quiet], [layer("x", "quiet"), layer("m", "theme", { muted: true }), layer("y", "theme", { timelineStartSample: 9 })]));
    expect(statements(two.audioGraph).at(-1)).toBe(
      "[mb][ml0][ml1]amix=inputs=3:duration=first:dropout_transition=0:normalize=0,atrim=end_sample=384000,asetpts=PTS-STARTPTS[mout]");
    expect(statements(two.audioGraph).filter((s) => /\[ml\d+\]$/.test(s)).map((s) => s.slice(0, 7))).toStrictEqual(["[2:a:0]", "[3:a:0]"]);
    const bedOnly = e4(mixPlan(base, [], [], { bedGainCentiDb: -600, bedMuted: false }));
    expect(statements(bedOnly.audioGraph).at(-1)).toBe("[mb]atrim=end_sample=384000,asetpts=PTS-STARTPTS[mout]");
    expect(bedOnly.audioGraph).not.toContain("amix");
  });

  it("T4-49 the real E3 audio bed fragment is a byte prefix of the E4 audio sub-graph", () => {
    // The five T4-41 classes: CUT chain with trims, odd dissolve, even dissolve, mixed CUT/dissolve, single segment.
    for (const plan of [basePlan({ shots: [{ in: 10 }, { out: 90 }, {}], edges: [0, 0] }), basePlan({ edges: [5] }), basePlan({ edges: [6] }),
      basePlan({ shots: [{ in: 3 }, {}, { out: 70 }], edges: [0, 7] }), basePlan({ shots: [{ in: 10 }] })]) {
      const e3Plan = buildEditorialEditRenderPlan({ plan, mediaRoot: MEDIA_ROOT });
      const preflight = assertEditorialEditRenderPreflight({ renderPlan: e3Plan, evidence: e3Plan.inputs.map((entry) => ({ assetId: entry.assetId,
        decodedVideoFrameCount: entry.assetDurationFrames, decodedAudioSampleCount: entry.assetDurationFrames * 1920 })) });
      const e3 = buildEditorialEditFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan: e3Plan, preflight, outputPath: e3Plan.outputPath });
      const fragment = statements(filterOf(e3.args)).filter((s) => /^\[\d+:a:0\]atrim=/.test(s) || /concat=n=\d+:v=0:a=1\[aout\]$/.test(s)).join(";");
      expect(fragment.length).toBeGreaterThan(0);
      const renderPlan = e4(mixPlan(plan, [music], [layer("a", "theme")]));
      expect(renderPlan.audioGraph.startsWith(`${fragment};`)).toBe(true);
    }
  });

  it("T4-50 the E3 hard midpoint survives: bed cut samples equal incomingStart + floor(T/2) for odd and even T", () => {
    const odd = e4(mixPlan(basePlan({ edges: [5] }), [music], [layer("a", "theme")]));
    expect(odd.renderIdentity.bed.segments).toStrictEqual([
      { inputIndex: 0, sourceInSample: 0, sourceOutSample: 97 * 1920 }, { inputIndex: 1, sourceInSample: 2 * 1920, sourceOutSample: 100 * 1920 }]);
    expect(odd.audioGraph).toContain(`[1:a:0]atrim=start_sample=3840:end_sample=192000,${ORIGIN}[a1]`);
    const even = e4(mixPlan(basePlan({ edges: [6] }), [music], [layer("a", "theme")]));
    expect(even.renderIdentity.bed.segments).toStrictEqual([
      { inputIndex: 0, sourceInSample: 0, sourceOutSample: 97 * 1920 }, { inputIndex: 1, sourceInSample: 3 * 1920, sourceOutSample: 100 * 1920 }]);
    expect(even.audioGraph).toContain(`[0:a:0]atrim=start_sample=0:end_sample=186240,${ORIGIN}[a0]`);
  });

  it("T4-51 a 1-channel source (MONO or UNSPECIFIED evidence) maps c0 to both channels by index", () => {
    const mono = audioAsset("mono", { channelCount: 1, mediaRootRelativePath: "sfx/mono.wav" });
    const renderPlan = e4(mixPlan(base, [mono], [layer("a", "mono")]));
    expect(renderPlan.renderIdentity.layers[0]!.channelMap).toBe("MONO_DUPLICATE");
    expect(renderPlan.audioGraph).toContain(
      `[2:a:0]atrim=start_sample=0:end_sample=48000,${ORIGIN},pan=stereo|c0=c0|c1=c0,${FLOAT},adelay=delays=0S:all=1[ml0]`);
    for (const layout of ["MONO", "UNSPECIFIED"]) {
      const evidence = evidenceFor(renderPlan);
      evidence.externalEvidence[0]!.reportedChannelLayout = layout;
      const receipt = assertEditorialMixRenderPreflight({ renderPlan, ...evidence, outputPath: renderPlan.outputPath });
      const command = buildEditorialMixFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan, receipt, outputPath: renderPlan.outputPath });
      expect(filterOf(command.args)).toContain("pan=stereo|c0=c0|c1=c0,");
    }
  });

  it("T4-52 a 2-channel source (STEREO or UNSPECIFIED evidence) keeps c0 left and c1 right by index; no other pan text", () => {
    const renderPlan = e4(mixPlan(base, [music], [layer("a", "theme")]));
    expect(renderPlan.renderIdentity.layers[0]!.channelMap).toBe("STEREO_PASSTHROUGH");
    expect(renderPlan.audioGraph).toContain(
      `[2:a:0]atrim=start_sample=0:end_sample=48000,${ORIGIN},pan=stereo|c0=c0|c1=c1,${FLOAT},adelay=delays=0S:all=1[ml0]`);
    for (const layout of ["STEREO", "UNSPECIFIED"]) {
      const evidence = evidenceFor(renderPlan);
      evidence.externalEvidence[0]!.reportedChannelLayout = layout;
      const receipt = assertEditorialMixRenderPreflight({ renderPlan, ...evidence, outputPath: renderPlan.outputPath });
      const filter = filterOf(buildEditorialMixFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan, receipt, outputPath: renderPlan.outputPath }).args);
      expect(filter.match(/pan=[^,[]+/g)).toStrictEqual(["pan=stereo|c0=c0|c1=c1"]);
    }
  });

  it("T4-53 trim and sample-delay text is exact (origin reset, 0S, and delays beyond 2^32)", () => {
    const renderPlan = e4(mixPlan(base, [music], [layer("a", "theme", { sourceInSample: 7, sourceOutSample: 48_007, timelineStartSample: 96_000 }),
      layer("b", "theme", { sourceInSample: 0, sourceOutSample: 1_000 })]));
    expect(renderPlan.audioGraph).toContain(`[2:a:0]asplit=2[mi2s0][mi2s1]`);
    expect(renderPlan.audioGraph).toContain(`[mi2s0]atrim=start_sample=7:end_sample=48007,${ORIGIN},pan=stereo|c0=c0|c1=c1,${FLOAT},adelay=delays=96000S:all=1[ml0]`);
    expect(renderPlan.audioGraph).toContain(`[mi2s1]atrim=start_sample=0:end_sample=1000,${ORIGIN},pan=stereo|c0=c0|c1=c1,${FLOAT},adelay=delays=0S:all=1[ml1]`);
    // Internally coherent large timeline: two full 1,350,000-frame CUT segments = 2,700,000 frames = 5,184,000,000 samples
    // (within the 42,768,000,000 maximum); video, bed and timeline agree and the layer ends inside the timeline.
    const frames = 1_350_000;
    const identity = structuredClone(renderPlan.renderIdentity) as AnyRecord;
    identity.timelineDurationSamples = 2 * frames * 1920;
    identity.videoSegments = [0, 1].map((inputIndex) => ({ inputIndex, sourceInFrame: 0, sourceOutFrame: frames }));
    identity.bed.segments = [0, 1].map((inputIndex) => ({ inputIndex, sourceInSample: 0, sourceOutSample: frames * 1920 }));
    identity.layers = [{ ...identity.layers[0], timelineStartSample: 5_000_000_000 }];
    expect(identity.timelineDurationSamples).toBe(5_184_000_000);
    expect(identity.timelineDurationSamples).toBeLessThanOrEqual(42_768_000_000);
    expect(5_000_000_000 + 48_000).toBeLessThanOrEqual(identity.timelineDurationSamples);
    const graph = buildEditorialMixAudioGraph(validateE4RenderIdentityV1(identity));
    expect(5_000_000_000).toBeGreaterThan(2 ** 32);
    expect(graph).toContain(`[2:a:0]atrim=start_sample=7:end_sample=48007,${ORIGIN},pan=stereo|c0=c0|c1=c1,${FLOAT},adelay=delays=5000000000S:all=1[ml0]`);
    expect(graph).toContain(`[1:a:0]atrim=start_sample=0:end_sample=2592000000,${ORIGIN}[a1]`);
    expect(graph).toContain("atrim=end_sample=5184000000,asetpts=PTS-STARTPTS[mout]");
    expect(graph).not.toMatch(/adelay=[^,]*(ms|\.|e\+)/);
  });

  it("T4-54 gain text from centi-dB is exact with :precision=float on every emitted volume; 0 dB emits no volume", () => {
    const golden: [number, string][] = [[-9600, "-96dB"], [-650, "-6.5dB"], [-600, "-6dB"], [-10, "-0.1dB"], [-5, "-0.05dB"], [-1, "-0.01dB"],
      [0, "0dB"], [1, "0.01dB"], [5, "0.05dB"], [100, "1dB"], [125, "1.25dB"], [1199, "11.99dB"], [1200, "12dB"]];
    for (const [input, text] of golden) expect(formatCentiDb(input)).toBe(text);
    for (const bad of [-9601, 1201, 1.5, Number.NaN]) expect(() => formatCentiDb(bad)).toThrow(/gain formatting/);
    const renderPlan = e4(mixPlan(base, [music], [layer("a", "theme", { gainCentiDb: -650 }), layer("b", "theme", { timelineStartSample: 5 }),
      layer("c", "theme", { gainCentiDb: 1200, timelineStartSample: 9 })], { bedGainCentiDb: -9600, bedMuted: false }));
    expect(renderPlan.audioGraph.match(/volume=[^,[]+/g)).toStrictEqual(
      ["volume=-96dB:precision=float", "volume=-6.5dB:precision=float", "volume=12dB:precision=float"]);
    expect(statements(renderPlan.audioGraph).find((s) => s.endsWith("[ml1]"))).not.toContain("volume=");
    for (const volume of renderPlan.audioGraph.match(/volume=[^,[]+/g)!) {
      expect(volume).toMatch(/^volume=-?(0|[1-9][0-9]*)(\.[0-9]?[1-9])?dB:precision=float$/);
    }
  });

  it("T4-55 fade text is derived from N/M exactly (ns = N-1, ss = L-M, ns = M-1); no fade filter when 0; no seconds options", () => {
    const renderPlan = e4(mixPlan(base, [music], [layer("a", "theme", { fadeInSamples: 2, fadeOutSamples: 3 }),
      layer("b", "theme", { fadeInSamples: 4801, timelineStartSample: 5 }), layer("c", "theme", { timelineStartSample: 9 })]));
    const chain = (k: number) => statements(renderPlan.audioGraph).find((s) => s.endsWith(`[ml${k}]`))!;
    expect(chain(0)).toContain(`${FLOAT},afade=t=in:ss=0:ns=1:curve=tri,afade=t=out:ss=47997:ns=2:curve=tri,adelay=delays=0S:all=1`);
    expect(chain(1)).toContain(`${FLOAT},afade=t=in:ss=0:ns=4800:curve=tri,adelay=delays=5S:all=1`);
    expect(chain(2)).not.toContain("afade");
    expect(renderPlan.audioGraph).not.toMatch(/afade=[^,]*(:st=|:d=|start_time|duration)/);
  });

  it("T4-56 overlapping layers are summed; crossfades are overlap + fades; concurrency is half-open", () => {
    const renderPlan = e4(mixPlan(base, [music], [layer("out", "theme", { fadeOutSamples: 4800 }),
      layer("in", "theme", { fadeInSamples: 4800, timelineStartSample: 43_200 })]));
    expect(renderPlan.audioGraph).toContain("afade=t=out:ss=43200:ns=4799:curve=tri,adelay=delays=0S:all=1[ml0]");
    expect(renderPlan.audioGraph).toContain("afade=t=in:ss=0:ns=4799:curve=tri,adelay=delays=43200S:all=1[ml1]");
    expect(renderPlan.audioGraph).toContain("[mb][ml0][ml1]amix=inputs=3:duration=first:dropout_transition=0:normalize=0");
    const span = (start: number) => layer(`s${start}`, "theme", { timelineStartSample: start }) as unknown as AudioLayerPlacementV1;
    expect(maxConcurrentEffectiveLayers([span(0), span(48_000)])).toBe(1);
    expect(maxConcurrentEffectiveLayers([span(0), span(47_999)])).toBe(2);
  });

  it("T4-57 no looping: no loop filters or options; loop fields rejected; each placement range is used once", () => {
    const renderPlan = e4(mixPlan(base, [music], [layer("a", "theme"), layer("b", "theme", { timelineStartSample: 48_000 })]));
    const command = mixCommand(renderPlan);
    expect(command.args).not.toContain("-stream_loop");
    expect(filterOf(command.args)).not.toMatch(/aloop|loop=/);
    expect(() => mixPlan(base, [music], [layer("a", "theme", { loop: true })])).toThrow(/schema/);
    expect(() => mixPlan(base, [music], [layer("a", "theme", { loopCount: 2 })])).toThrow(/schema/);
    for (const k of [0, 1]) expect(statements(renderPlan.audioGraph).filter((s) => s.endsWith(`[ml${k}]`))).toHaveLength(1);
  });

  it("T4-58 emitted filters stay within the mix-v1 allowlist; no dynamics/E5 filters; pan only in the two fixed forms; normalize=0", () => {
    const mono = audioAsset("mono", { channelCount: 1, sha256: SHA("b"), mediaRootRelativePath: "sfx/mono.wav" });
    const renderPlan = e4(mixPlan(basePlan({ shots: [{ in: 5 }, {}, {}], edges: [6, 0] }), [music, mono], [
      layer("a", "theme", { gainCentiDb: -300, fadeInSamples: 100, fadeOutSamples: 100 }), layer("b", "mono", { timelineStartSample: 10 }),
      layer("c", "theme", { timelineStartSample: 20, gainCentiDb: 200 })], { bedGainCentiDb: -400, bedMuted: false }));
    const filter = filterOf(mixCommand(renderPlan).args);
    const names = statements(filter).flatMap((s) => s.replace(/^(\[[^\]]+\])+/, "").replace(/(\[[^\]]+\])+$/, "").split(",").map((f) => f.split("=")[0]!));
    const allow = new Set(["trim", "fps", "format", "settb", "setpts", "concat", "xfade", "atrim", "asettb", "asetpts", "aformat", "pan", "volume",
      "afade", "adelay", "asplit", "amix"]);
    for (const name of names) expect(allow.has(name), name).toBe(true);
    for (const forbidden of ["alimiter", "acompressor", "compand", "sidechaincompress", "sidechaingate", "agate", "dynaudnorm", "loudnorm",
      "speechnorm", "ebur128", "aloop", "acrossfade", "aresample", "lowpass", "highpass", "equalizer"]) expect(filter).not.toContain(forbidden);
    for (const pan of filter.match(/pan=[^,[]+/g)!) expect(["pan=stereo|c0=c0|c1=c0", "pan=stereo|c0=c0|c1=c1"]).toContain(pan);
    expect(filter).toContain("normalize=0");
    expect(filter).not.toMatch(/normalize=1|weights=/);
  });
});

describe("E4 receipt, analysis and final commands", () => {
  const renderPlan = e4(mixPlan(base, [music], [layer("a", "theme", { gainCentiDb: -650, fadeInSamples: 2 })]));
  const rehash = (receipt: AnyRecord): AnyRecord => {
    const { receiptSha256: _old, ...payload } = receipt;
    return { ...payload, receiptSha256: editorialSha256(canonicalEditorialJson(payload)) };
  };

  it("T4-61 peak evidence must match the mix graph; analysis and final commands share the byte-identical audio sub-graph", () => {
    const evidence = evidenceFor(renderPlan);
    evidence.peakEvidence.mixGraphSha256 = SHA("0");
    expect(() => assertEditorialMixRenderPreflight({ renderPlan, ...evidence, outputPath: renderPlan.outputPath })).toThrow(/different mix graph/);
    const analysisPath = "D:\\Busybookie\\Production\\exports\\EP02\\mix\\analysis.f32";
    const analysis = buildEditorialMixAnalysisFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan, analysisOutputPath: analysisPath });
    const final = mixCommand(renderPlan);
    expect(filterOf(analysis.args)).toBe(renderPlan.audioGraph);
    expect(filterOf(final.args).endsWith(`;${renderPlan.audioGraph}`)).toBe(true);
    expect(editorialSha256(filterOf(analysis.args))).toBe(renderPlan.mixGraphSha256);
    expect(analysis.args.filter((arg, i) => analysis.args[i - 1] === "-i")).toStrictEqual(final.args.filter((arg, i) => final.args[i - 1] === "-i"));
    const tampered = { ...renderPlan, audioGraph: renderPlan.audioGraph.replace("volume=-6.5dB", "volume=-6dB") };
    expect(() => buildEditorialMixAnalysisFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan: tampered, analysisOutputPath: analysisPath }))
      .toThrow(/audio graph does not match/);
    expect(() => buildEditorialMixAnalysisFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan, analysisOutputPath: renderPlan.outputPath }))
      .toThrow(/differ from the final output/);
  });

  it("T4-62 stateless value receipt: deterministic, serializable, checksum-verified and bound to key, graph, exact path and evidence", () => {
    const evidence = evidenceFor(renderPlan);
    const receipt = receiptFor(renderPlan);
    expect(Object.keys(receipt).sort()).toStrictEqual(["baseEvidenceSha256", "externalEvidenceSha256", "mixGraphSha256", "outputPath",
      "peakEvidenceSha256", "receiptSha256", "receiptType", "receiptVersion", "renderKey"]);
    expect(receipt.receiptVersion).toBe("1");
    expect(receiptFor(renderPlan)).toStrictEqual(receipt);
    const permuted = assertEditorialMixRenderPreflight({ renderPlan, baseEvidence: [...evidence.baseEvidence].reverse(),
      externalEvidence: evidence.externalEvidence, peakEvidence: evidence.peakEvidence, outputPath: renderPlan.outputPath });
    expect(permuted).toStrictEqual(receipt);
    const restored = JSON.parse(JSON.stringify(receipt)) as AnyRecord;
    const build = (r: unknown, outputPath = renderPlan.outputPath) =>
      buildEditorialMixFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan, receipt: r, outputPath });
    expect(build(restored)).toStrictEqual(build(receipt));
    expect(parseEditorialMixPreflightReceipt(restored)).toStrictEqual(receipt);
    expect(() => build({ ...restored, receiptSha256: SHA("0") })).toThrow(/checksum/);
    expect(() => build({ ...restored, extra: 1 })).toThrow(/preflight receipt is invalid/);
    expect(() => build({ ...restored, receiptVersion: 1 })).toThrow(/preflight receipt is invalid/);
    expect(() => build(rehash({ ...restored, renderKey: SHA("0") }))).toThrow(/different render key/);
    expect(() => build(rehash({ ...restored, mixGraphSha256: SHA("0") }))).toThrow(/different mix graph/);
    const forward = renderPlan.outputPath.replaceAll("\\", "/");
    expect(() => build(restored, forward)).toThrow(/different output path/);
    expect(() => build(restored, renderPlan.outputPath.toLowerCase())).toThrow(/different output path/);
    const verify = (r: unknown) => verifyEditorialMixPreflightReceipt({ renderPlan, ...evidence, outputPath: renderPlan.outputPath, receipt: r });
    expect(verify(restored)).toStrictEqual(receipt);
    for (const field of ["baseEvidenceSha256", "externalEvidenceSha256", "peakEvidenceSha256"]) {
      const forged = rehash({ ...restored, [field]: SHA("0") });
      expect(() => verify(forged), field).toThrow(/does not correspond/);
      expect(() => build({ ...restored, [field]: SHA("0") }), field).toThrow(/checksum/);
    }
    const otherEvidence = evidenceFor(renderPlan);
    otherEvidence.peakEvidence.maxAbsSampleF32Bits = 0x3e000000;
    expect(() => verifyEditorialMixPreflightReceipt({ renderPlan, ...otherEvidence, outputPath: renderPlan.outputPath, receipt: restored }))
      .toThrow(/does not correspond/);
    for (const outputPath of [` ${renderPlan.outputPath}`, "relative/out.mp4", renderPlan.inputs[0]!.path, ""]) {
      expect(() => assertEditorialMixRenderPreflight({ renderPlan, ...evidence, outputPath }), outputPath).toThrow(/output path/);
    }
    const source = readFileSync(fileURLToPath(new URL("../src/editorial/editorialMixRenderPreflight.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/^(let|var) |WeakSet|WeakMap|^const \w+ = new (Set|Map)\b/m);
  });

  it("T4-69 duration: -t equals the timeline seconds and [mout] is trimmed to timelineDurationSamples; layers cannot extend it", () => {
    expect(mixCommand(renderPlan).args[mixCommand(renderPlan).args.indexOf("-t") + 1]).toBe("8");
    expect(renderPlan.audioGraph).toContain("atrim=end_sample=384000,asetpts=PTS-STARTPTS[mout]");
    const dissolved = e4(mixPlan(basePlan({ edges: [6] }), [music], [layer("a", "theme", { timelineStartSample: 372_480 - 48_000 })]));
    expect(dissolved.timelineDurationFrames).toBe(194);
    const args = mixCommand(dissolved).args;
    expect(args[args.indexOf("-t") + 1]).toBe("7.76");
    expect(dissolved.audioGraph).toContain("atrim=end_sample=372480,asetpts=PTS-STARTPTS[mout]");
    expect(() => mixPlan(basePlan({ edges: [6] }), [music], [layer("a", "theme", { timelineStartSample: 372_480 - 47_999 })])).toThrow(/inside the base timeline/);
  });

  it("T4-70 final output contract argv golden (as E3) and analysis terminal pcm_f32le/f32le", () => {
    const [p0, p1, p2] = renderPlan.inputs.map((entry) => entry.path);
    expect(p2).toBe("D:/Busybookie/Production/music/theme.wav");
    expect(renderPlan.outputPath).toBe(`D:\\Busybookie\\Production\\exports\\EP02\\mix\\EP02_mix_${renderPlan.renderKey}.mp4`);
    const command = mixCommand(renderPlan);
    expect(command.executable).toBe("ffmpeg");
    expect(command.args).toStrictEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-i", p0, "-i", p1, "-i", p2,
      "-filter_complex", [
        "[0:v:0]trim=start_frame=0:end_frame=100,fps=25,format=yuv420p,settb=1/25,setpts=PTS-STARTPTS[v0]",
        "[1:v:0]trim=start_frame=0:end_frame=100,fps=25,format=yuv420p,settb=1/25,setpts=PTS-STARTPTS[v1]",
        "[v0][v1]concat=n=2:v=1:a=0,fps=25,format=yuv420p,settb=1/25,setpts=PTS-STARTPTS[vout]",
        "[0:a:0]atrim=start_sample=0:end_sample=192000,asettb=1/48000,asetpts=PTS-STARTPTS[a0]",
        "[1:a:0]atrim=start_sample=0:end_sample=192000,asettb=1/48000,asetpts=PTS-STARTPTS[a1]",
        "[a0][a1]concat=n=2:v=0:a=1[aout]",
        "[aout]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[mb]",
        "[2:a:0]atrim=start_sample=0:end_sample=48000,asettb=1/48000,asetpts=PTS-STARTPTS,pan=stereo|c0=c0|c1=c1," +
          "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=-6.5dB:precision=float," +
          "afade=t=in:ss=0:ns=1:curve=tri,adelay=delays=0S:all=1[ml0]",
        "[mb][ml0]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,atrim=end_sample=384000,asetpts=PTS-STARTPTS[mout]",
      ].join(";"),
      "-map", "[vout]", "-map", "[mout]",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", "25",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-t", "8",
      "-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart", "-f", "mp4",
      renderPlan.outputPath,
    ]);
    const analysisPath = "D:\\Busybookie\\Production\\exports\\EP02\\mix\\analysis.f32";
    expect(buildEditorialMixAnalysisFfmpegCommand({ ffmpegExecutable: " ffmpeg ", renderPlan, analysisOutputPath: analysisPath })).toStrictEqual({
      executable: "ffmpeg",
      args: ["-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-i", p0, "-i", p1, "-i", p2,
        "-filter_complex", renderPlan.audioGraph, "-map", "[mout]", "-c:a", "pcm_f32le", "-f", "f32le", analysisPath],
    });
    expect(() => buildEditorialMixFfmpegCommand({ ffmpegExecutable: " ", renderPlan, receipt: receiptFor(renderPlan), outputPath: renderPlan.outputPath }))
      .toThrow(/FFmpeg executable/);
    expect(() => buildEditorialMixFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan: { ...renderPlan, profileId: "busybookie-episode-edit-v1" } as never,
      receipt: receiptFor(renderPlan), outputPath: renderPlan.outputPath })).toThrow(/only busybookie-episode-mix-v1/);
  });
});
