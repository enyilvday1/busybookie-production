import { describe, expect, it } from "vitest";
import { deriveEditorialTimeline } from "../src/editorial/deriveEditorialTimeline.js";
import { hashEditorialPlanV2 } from "../src/editorial/canonicalizeEditorialPlanV2.js";
import { validateEditorialPlanV2 } from "../src/editorial/validateEditorialPlanV2.js";
import type { EditorialPlanV2 } from "../src/editorial/editorialPlanV2.schema.js";
import { buildEditorialPlanV3 } from "../src/editorial/buildEditorialPlanV3.js";
import { planEditorialRenderV3, type EditorialMixRenderPlan } from "../src/editorial/buildEditorialMixRenderPlan.js";
import { assertEditorialMixRenderPreflight, E4_MAX_SAMPLE_PEAK_F32_BITS } from "../src/editorial/editorialMixRenderPreflight.js";
import { buildEditorialEditRenderPlan } from "../src/editorial/buildEditorialEditRenderPlan.js";
import { assertEditorialEditRenderPreflight } from "../src/editorial/editorialEditRenderPreflight.js";

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

const mono = audioAsset("mono", { channelCount: 1, sha256: SHA("b"), mediaRootRelativePath: "sfx/mono.wav" });
const stereo = audioAsset("stereo");
const renderPlan = e4(mixPlan(basePlan(), [mono, stereo], [layer("m", "mono"), layer("s", "stereo", { timelineStartSample: 1000 })]));
function run(mutate: (evidence: ReturnType<typeof evidenceFor>) => void, plan: EditorialMixRenderPlan = renderPlan) {
  const evidence = evidenceFor(plan);
  mutate(evidence);
  return assertEditorialMixRenderPreflight({ renderPlan: plan, ...evidence, outputPath: plan.outputPath });
}
const external = (slug: string, e: ReturnType<typeof evidenceFor>) => e.externalEvidence.find((record) => record.assetId === `audio:${slug}`)!;

describe("E4 pure physical preflight", () => {
  it("T4-59 sample-peak gate: +1.0f accepted, next float rejected, non-finite rejected, full stereo timeline required", () => {
    expect(E4_MAX_SAMPLE_PEAK_F32_BITS).toBe(0x3f800000);
    for (const bits of [0, 0x3f800000]) expect(() => run((e) => { e.peakEvidence.maxAbsSampleF32Bits = bits; })).not.toThrow();
    expect(() => run((e) => { e.peakEvidence.maxAbsSampleF32Bits = 0x3f800001; })).toThrow(/exceeds digital full scale/);
    for (const bits of [0x7f800000, 0x7fc00000, 0xffffffff]) {
      expect(() => run((e) => { e.peakEvidence.maxAbsSampleF32Bits = bits; })).toThrow(/non-finite/);
    }
    expect(() => run((e) => { e.peakEvidence.nonFiniteSampleCount = 1; })).toThrow(/non-finite/);
    expect(() => run((e) => { e.peakEvidence.decodedSampleFrameCount -= 1; })).toThrow(/full stereo timeline/);
    expect(() => run((e) => { e.peakEvidence.channelCount = 1; })).toThrow(/full stereo timeline/);
    expect(() => run((e) => { e.peakEvidence.maxAbsSampleF32Bits = 1.5; })).toThrow(/peak evidence is invalid/);
    expect(() => run((e) => { e.peakEvidence.truePeakDbtp = -1; })).toThrow(/peak evidence is invalid/);
  });

  it("T4-60 peak evidence for a different render key is rejected", () => {
    expect(() => run((e) => { e.peakEvidence.renderKey = SHA("0"); })).toThrow(/different render key/);
  });

  it("T4-63 external evidence with the wrong sample rate is rejected", () => {
    for (const rate of [44100, 96000, 0]) expect(() => run((e) => { external("stereo", e).sampleRateHz = rate; })).toThrow(/not 48000 Hz/);
  });

  it("T4-64 channel count and reported layout: compatible pairs and UNSPECIFIED admitted; incompatible, 0 and >2 rejected", () => {
    for (const [slug, layout] of [["mono", "MONO"], ["mono", "UNSPECIFIED"], ["stereo", "STEREO"], ["stereo", "UNSPECIFIED"]] as const) {
      expect(() => run((e) => { external(slug, e).reportedChannelLayout = layout; }), `${slug}/${layout}`).not.toThrow();
    }
    expect(() => run((e) => { external("mono", e).reportedChannelLayout = "STEREO"; })).toThrow(/layout contradicts/);
    expect(() => run((e) => { external("stereo", e).reportedChannelLayout = "MONO"; })).toThrow(/layout contradicts/);
    for (const channelCount of [0, 3, 6]) expect(() => run((e) => { external("stereo", e).channelCount = channelCount; })).toThrow(/channel count/);
    expect(() => run((e) => { external("stereo", e).channelCount = 1; external("stereo", e).reportedChannelLayout = "MONO"; })).toThrow(/channel count/);
    for (const layout of ["mono", "stereo", "unknown", "DOWNMIX", "2 channels", ""]) {
      expect(() => run((e) => { external("stereo", e).reportedChannelLayout = layout; }), layout).toThrow(/external audio evidence is invalid/);
    }
  });

  it("T4-65 wrong codec, sample format, container, RIFF header (RF64), sha256 or bytes are rejected", () => {
    expect(() => run((e) => { external("stereo", e).codec = "pcm_s24le"; })).toThrow(/not pcm_s16le/);
    expect(() => run((e) => { external("stereo", e).sampleFormat = "s32"; })).toThrow(/not pcm_s16le/);
    expect(() => run((e) => { external("stereo", e).formatName = "w64"; })).toThrow(/classic RIFF\/WAVE/);
    expect(() => run((e) => { external("stereo", e).riffHeaderId = "RF64"; })).toThrow(/classic RIFF\/WAVE/);
    expect(() => run((e) => { external("stereo", e).sha256 = SHA("f"); })).toThrow(/content identity mismatch/);
    expect(() => run((e) => { external("stereo", e).bytes += 1; })).toThrow(/content identity mismatch/);
  });

  it("T4-66 decoded external samples must equal the declaration; base rules equal E3 boundaries and work for E2-equivalent bases", () => {
    for (const delta of [-1, 1]) {
      expect(() => run((e) => { external("mono", e).decodedSampleFrameCount += delta; })).toThrow(/decoded sample frames differ/);
    }
    // E2-equivalent base: no E3 render plan or E3 renderKey exists, yet the base rules apply.
    expect(() => buildEditorialEditRenderPlan({ plan: basePlan(), mediaRoot: MEDIA_ROOT })).toThrow(/E2-equivalent/);
    expect(() => run(() => undefined)).not.toThrow();
    expect(() => run((e) => { e.baseEvidence[0]!.sha256 = SHA("f"); })).toThrow(/content identity mismatch/);
    expect(() => run((e) => { e.baseEvidence[1]!.bytes = 201; })).toThrow(/content identity mismatch/);
    // True E3 base: E4 and the unchanged E3 preflight accept and reject exactly the same frame/sample boundaries.
    const e3Base = basePlan({ shots: [{ in: 10 }, {}], edges: [6] });
    const mixed = e4(mixPlan(e3Base, [stereo], [layer("s", "stereo")]));
    const e3Plan = buildEditorialEditRenderPlan({ plan: e3Base, mediaRoot: MEDIA_ROOT });
    for (const [frameDelta, sampleDelta] of [[0, 0], [5, 7], [-1, 0], [0, -1]] as const) {
      const e4Outcome = (() => {
        try { run((e) => { e.baseEvidence[1]!.decodedVideoFrameCount += frameDelta; e.baseEvidence[1]!.decodedAudioSampleCount += sampleDelta; }, mixed); return "ACCEPT"; }
        catch { return "REJECT"; }
      })();
      const e3Outcome = (() => {
        try {
          assertEditorialEditRenderPreflight({ renderPlan: e3Plan, evidence: e3Plan.inputs.map((entry, index) => ({ assetId: entry.assetId,
            decodedVideoFrameCount: entry.assetDurationFrames + (index === 1 ? frameDelta : 0),
            decodedAudioSampleCount: entry.assetDurationFrames * 1920 + (index === 1 ? sampleDelta : 0) })) });
          return "ACCEPT";
        } catch { return "REJECT"; }
      })();
      expect(e4Outcome, `${frameDelta}/${sampleDelta}`).toBe(e3Outcome);
      expect(e4Outcome).toBe(frameDelta >= 0 && sampleDelta >= 0 ? "ACCEPT" : "REJECT");
    }
  });

  it("T4-67 stream and record cardinality; muted-only evidence is unknown; a missing layout field is rejected; UNSPECIFIED is not missing", () => {
    expect(() => run((e) => { external("stereo", e).streamCount = 2; })).toThrow(/exactly one audio stream/);
    expect(() => run((e) => { external("stereo", e).audioStreamCount = 0; })).toThrow(/exactly one audio stream/);
    expect(() => run((e) => { e.externalEvidence.pop(); })).toThrow(/exactly one external audio evidence record/);
    expect(() => run((e) => { e.externalEvidence.push({ ...e.externalEvidence[0]! }); })).toThrow(/exactly one external audio evidence record/);
    expect(() => run((e) => { e.externalEvidence.push({ ...e.externalEvidence[0]!, assetId: "audio:ghost" }); })).toThrow(/unknown asset audio:ghost/);
    expect(() => run((e) => { e.baseEvidence.pop(); })).toThrow(/exactly one base shot evidence record/);
    expect(() => run((e) => { e.baseEvidence.push({ ...e.baseEvidence[0]! }); })).toThrow(/exactly one base shot evidence record/);
    expect(() => run((e) => { e.baseEvidence.push({ ...e.baseEvidence[0]!, assetId: "normalized:EP02:S09" }); })).toThrow(/unknown asset/);
    expect(() => run((e) => { delete external("stereo", e).reportedChannelLayout; })).toThrow(/external audio evidence is invalid/);
    expect(() => run((e) => { external("stereo", e).sourcePath = "D:/media/music/stereo.wav"; })).toThrow(/external audio evidence is invalid/);
    expect(() => run((e) => { external("stereo", e).reportedChannelLayout = "UNSPECIFIED"; })).not.toThrow();
    const quiet = audioAsset("quiet", { sha256: SHA("c"), mediaRootRelativePath: "ambience/quiet.wav" });
    const withMuted = e4(mixPlan(basePlan(), [stereo, quiet], [layer("s", "stereo"), layer("q", "quiet", { muted: true })]));
    expect(() => run((e) => { e.externalEvidence.push({ ...e.externalEvidence[0]!, assetId: "audio:quiet", sha256: SHA("c") }); }, withMuted))
      .toThrow(/unknown asset audio:quiet/);
  });
});
