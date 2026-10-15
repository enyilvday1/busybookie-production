import { describe, expect, it } from "vitest";
import { deriveEditorialTimeline } from "../src/editorial/deriveEditorialTimeline.js";
import { hashEditorialPlanV2 } from "../src/editorial/canonicalizeEditorialPlanV2.js";
import { validateEditorialPlanV2 } from "../src/editorial/validateEditorialPlanV2.js";
import type { EditorialPlanV2 } from "../src/editorial/editorialPlanV2.schema.js";
import { buildEditorialPlanV3 } from "../src/editorial/buildEditorialPlanV3.js";
import { isEffectiveAudioMix, linearFadeFactor, maxConcurrentEffectiveLayers } from "../src/editorial/deriveEditorialAudioMix.js";
import { planEditorialRenderV3, type EditorialMixRenderPlan } from "../src/editorial/buildEditorialMixRenderPlan.js";
import type { AudioLayerPlacementV1 } from "../src/editorial/editorialPlanV3.schema.js";
import { assertEditorialMixRenderPreflight } from "../src/editorial/editorialMixRenderPreflight.js";
import { buildEditorialMixFfmpegCommand } from "../src/editorial/buildEditorialMixFfmpegCommand.js";

// Local, in-memory fixtures only (repeated per E4 test file; no shared helper path is authorized).
type AnyRecord = Record<string, any>;
const MEDIA_ROOT = "D:/Busybookie/Production";
const SHA = (c: string) => c.repeat(64);
function basePlan(): EditorialPlanV2 {
  const ids = ["S01", "S02"];
  const timeline = deriveEditorialTimeline(ids.map(() => ({ assetDurationFrames: 100, sourceInFrame: 0, sourceOutFrame: 100 })), [{ type: "CUT" }]);
  const assetId = (id: string) => `normalized:EP02:${id}`;
  return validateEditorialPlanV2({
    schemaVersion: "2.0", planType: "BUSYBOOKIE_EDITORIAL_PLAN",
    episode: { episodeId: "EP02", title: "Synthetic episode", manifestSha256: SHA("e") }, editorialDecisionsSha256: null,
    profile: { profileId: "busybookie-master-v1", aspectRatio: "16:9", width: 1920, height: 1080, frameRate: { numerator: 25, denominator: 1 },
      audioSampleRateHz: 48000, audioChannels: 2, audioChannelLayout: "stereo" },
    timelineDurationFrames: timeline.timelineDurationFrames,
    shots: ids.map((id, i) => ({ shotId: id, sceneId: "SC01", order: i + 1, title: `Shot ${i + 1}`, assetId: assetId(id) })),
    assets: ids.map((id, i) => ({ assetId: assetId(id), kind: "NORMALIZED_SHOT", sha256: SHA("d"), bytes: 200, contentType: "video/mp4",
      mediaRootRelativePath: `cache/composition-normalized/EP02/${id}/EP02_${id}_${SHA(String(i))}.mp4`,
      normalization: { schemaVersion: "1.0", profileId: "busybookie-master-normalization-v1", cacheKey: SHA(String(i)) },
      generatedSource: { provider: "VEO", providerExecutionId: `task-${i}`, sourceSha256: SHA("1"), sourceBytes: 100, sourceContentType: null },
      assetDurationFrames: 100 })),
    tracks: [
      { trackId: "V1", kind: "VIDEO", clips: ids.map((id, i) => ({ clipId: `V1-${id}`, shotId: id, assetId: assetId(id), sourceInFrame: 0,
        sourceOutFrame: 100, timelineStartFrame: timeline.video[i]!.timelineStartFrame })) },
      { trackId: "A1", kind: "SHOT_AUDIO", clips: ids.map((id, i) => ({ clipId: `A1-${id}`, shotId: id, assetId: assetId(id), sourceInFrame: 0,
        sourceOutFrame: 100, timelineStartFrame: timeline.audio[i]!.timelineStartFrame, linkedClipId: `V1-${id}`, audio: { mode: "PRESERVE_NATIVE" } })) },
    ],
    transitions: [{ outgoingClipId: "V1-S01", incomingClipId: "V1-S02", type: "CUT" }],
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
      decodedVideoFrameCount: e.assetDurationFrames, decodedAudioSampleCount: e.assetDurationFrames * 1920 }] : [])),
    externalEvidence: renderPlan.inputs.flatMap((e) => (e.mediaKind === "EXTERNAL_AUDIO" ? [{ assetId: e.assetId, sha256: e.sha256, bytes: e.bytes,
      riffHeaderId: "RIFF", formatName: "wav", streamCount: 1, audioStreamCount: 1, codec: "pcm_s16le", sampleFormat: "s16", sampleRateHz: 48000,
      channelCount: e.channelCount, reportedChannelLayout: e.channelCount === 1 ? "MONO" : "STEREO", decodedSampleFrameCount: e.assetDurationSamples }] : [])),
    peakEvidence: { renderKey: renderPlan.renderKey, mixGraphSha256: renderPlan.mixGraphSha256, channelCount: 2,
      decodedSampleFrameCount: renderPlan.timelineDurationSamples, nonFiniteSampleCount: 0, maxAbsSampleF32Bits: 0x3f000000 },
  };
}

describe("E4 pure audio-mix derivation", () => {
  const base = basePlan();

  it("T4-19 bed gain alone makes the mix effective; the bed object is strict", () => {
    const plan = mixPlan(base, [], [], { bedGainCentiDb: -1, bedMuted: false });
    expect(isEffectiveAudioMix(plan.audioMix)).toBe(true);
    expect(planEditorialRenderV3({ plan, mediaRoot: MEDIA_ROOT }).route).toBe("E4_MIX");
    expect(isEffectiveAudioMix(mixPlan(base, [], [], { bedGainCentiDb: 0, bedMuted: false }).audioMix)).toBe(false);
    expect(() => mixPlan(base, [], [], { bedGainCentiDb: 0, bedMuted: false, bedFadeInSamples: 10 } as never)).toThrow(/schema/);
  });

  // Hand-derived golden table of the frozen law: [local index i, numerator, denominator, written decimal].
  // Fade-in N: g(i) = i/(N-1) on 0..N-1. Fade-out M over length L: g(i) = (L-1-i)/(M-1) on L-M..L-1.
  const FADE_IN_GOLDEN: Record<number, [number, number, number, number][]> = {
    2: [[0, 0, 1, 0], [1, 1, 1, 1]],
    3: [[0, 0, 2, 0], [1, 1, 2, 0.5], [2, 2, 2, 1]],
    5: [[0, 0, 4, 0], [1, 1, 4, 0.25], [2, 2, 4, 0.5], [3, 3, 4, 0.75], [4, 4, 4, 1]],
    4801: [[0, 0, 4800, 0], [1200, 1200, 4800, 0.25], [2400, 2400, 4800, 0.5], [3600, 3600, 4800, 0.75], [4800, 4800, 4800, 1]],
  };
  const FADE_OUT_GOLDEN: Record<number, [number, [number, number, number, number][]]> = {
    2: [10, [[8, 1, 1, 1], [9, 0, 1, 0]]],
    3: [10, [[7, 2, 2, 1], [8, 1, 2, 0.5], [9, 0, 2, 0]]],
    5: [10, [[5, 4, 4, 1], [6, 3, 4, 0.75], [7, 2, 4, 0.5], [8, 1, 4, 0.25], [9, 0, 4, 0]]],
    4801: [10_000, [[5199, 4800, 4800, 1], [6399, 3600, 4800, 0.75], [7599, 2400, 4800, 0.5], [8799, 1200, 4800, 0.25], [9999, 0, 4800, 0]]],
  };

  it("T4-24 fade law golden factors from hand-derived rationals (N/M = 2, 3, 5, 4801); exact endpoints 0 and 1", () => {
    // Pure oracle check: no production fade helper, deriveEditorialAudioMix function or command builder is called here.
    for (const [n, rows] of Object.entries(FADE_IN_GOLDEN)) {
      const N = Number(n);
      for (const [i, numerator, denominator, decimal] of rows) {
        expect([numerator, denominator], `in N=${N} i=${i}`).toStrictEqual([i, N - 1]);
        expect(decimal * denominator).toBe(numerator);
      }
      expect(rows[0]![3]).toBe(0);
      expect(rows.at(-1)![0]).toBe(N - 1);
      expect(rows.at(-1)![3]).toBe(1);
    }
    for (const [m, [L, rows]] of Object.entries(FADE_OUT_GOLDEN)) {
      const M = Number(m);
      for (const [i, numerator, denominator, decimal] of rows) {
        expect([numerator, denominator], `out M=${M} i=${i}`).toStrictEqual([L - 1 - i, M - 1]);
        expect(i).toBeGreaterThanOrEqual(L - M);
        expect(decimal * denominator).toBe(numerator);
      }
      expect(rows[0]![0]).toBe(L - M);
      expect(rows[0]![3]).toBe(1);
      expect(rows.at(-1)![0]).toBe(L - 1);
      expect(rows.at(-1)![3]).toBe(0);
    }
  });

  it("the production reference fade law matches the T4-24 golden table (unnumbered)", () => {
    for (const [n, rows] of Object.entries(FADE_IN_GOLDEN)) {
      for (const [i, , , decimal] of rows) expect(linearFadeFactor(i, 10_000, Number(n), 0), `in ${n}/${i}`).toBe(decimal);
      expect(linearFadeFactor(Number(n), 10_000, Number(n), 0)).toBe(1);
    }
    for (const [m, [L, rows]] of Object.entries(FADE_OUT_GOLDEN)) {
      for (const [i, , , decimal] of rows) expect(linearFadeFactor(i, L, 0, Number(m)), `out ${m}/${i}`).toBe(decimal);
      expect(linearFadeFactor(L - Number(m) - 1, L, 0, Number(m))).toBe(1);
    }
    // N + M = L: the regions are disjoint and both boundary samples are exactly 1.
    expect([0, 1, 2, 3, 4, 5].map((i) => linearFadeFactor(i, 6, 3, 3))).toStrictEqual([0, 0.5, 1, 1, 0.5, 0]);
    for (const [n, m, l] of [[1, 0, 10], [0, 1, 10], [6, 5, 10], [2, 0, 1]] as const) expect(() => linearFadeFactor(0, l, n, m)).toThrow(/fade/);
    expect(() => linearFadeFactor(10, 10, 0, 0)).toThrow(/fade index/);
  });

  it("T4-68 canonical bounds: 64/65 assets, 128/129 placements, 32/33 concurrent; bed and muted not counted; abutting not concurrent", () => {
    const assets = Array.from({ length: 65 }, (_, i) => audioAsset(`a${i}`, { sha256: SHA(String(i % 10)) }));
    const oneEach = (n: number) => Array.from({ length: n }, (_, i) => layer(`l${i}`, `a${i}`, { sourceOutSample: 1_000, timelineStartSample: i * 1_000 }));
    expect(mixPlan(base, assets.slice(0, 64), oneEach(64)).audioMix.externalAudioAssets).toHaveLength(64);
    expect(() => mixPlan(base, assets, oneEach(65))).toThrow(/schema/);
    const placements = (n: number) => Array.from({ length: n }, (_, i) => layer(`p${i}`, "a0", { sourceOutSample: 1_000, timelineStartSample: i * 2_000 }));
    expect(mixPlan(base, assets.slice(0, 1), placements(128)).audioMix.layers).toHaveLength(128);
    expect(() => mixPlan(base, assets.slice(0, 1), placements(129))).toThrow(/schema/);
    const overlapping = (n: number, extra: AnyRecord = {}) => Array.from({ length: n }, (_, i) => layer(`c${i}`, "a0", { timelineStartSample: i, ...extra }));
    expect(maxConcurrentEffectiveLayers(overlapping(32) as unknown as AudioLayerPlacementV1[])).toBe(32);
    expect(mixPlan(base, assets.slice(0, 1), overlapping(32), { bedGainCentiDb: -600, bedMuted: false }).audioMix.layers).toHaveLength(32);
    expect(() => mixPlan(base, assets.slice(0, 1), overlapping(33))).toThrow(/more than 32 unmuted external layers/);
    const withMuted = [...overlapping(32), layer("muted", "a0", { muted: true })];
    expect(mixPlan(base, assets.slice(0, 1), withMuted).audioMix.layers).toHaveLength(33);
    const abutting = Array.from({ length: 33 }, (_, i) => layer(`b${i}`, "a0", { sourceOutSample: 1_000, timelineStartSample: i * 1_000 }));
    expect(maxConcurrentEffectiveLayers(abutting as unknown as AudioLayerPlacementV1[])).toBe(1);
    expect(mixPlan(base, assets.slice(0, 1), abutting).audioMix.layers).toHaveLength(33);
    // Step 1066 command-shape record (test-only; asserts a deterministic size, never launchability): the frozen
    // conservative estimator U = 1 + sum(len + backslashes + quotes + 3) over executable and argv of a max-bound,
    // fully featured final command (64 assets, 128 placements each with gain and both fades, bed gain).
    const estimate = (executable: string, args: readonly string[]) => 1 + [executable, ...args]
      .reduce((sum, s) => sum + s.length + (s.split("\\").length - 1) + (s.split("\"").length - 1) + 3, 0);
    const maxBound = () => {
      const featured = Array.from({ length: 128 }, (_, i) => layer(`f${i}`, `a${i % 64}`, { sourceOutSample: 1_000,
        timelineStartSample: i * 2_000, gainCentiDb: -300, fadeInSamples: 100, fadeOutSamples: 100 }));
      const renderPlan = e4(mixPlan(base, assets.slice(0, 64), featured, { bedGainCentiDb: -200, bedMuted: false }));
      const receipt = assertEditorialMixRenderPreflight({ renderPlan, ...evidenceFor(renderPlan), outputPath: renderPlan.outputPath });
      const command = buildEditorialMixFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan, receipt, outputPath: renderPlan.outputPath });
      expect(command.args.filter((arg) => arg === "-i")).toHaveLength(2 + 64);
      return estimate(command.executable, command.args);
    };
    const size = maxBound();
    expect(maxBound()).toBe(size);
    // Recorded value (above the 30,000 runner budget, as Step 1066 a2 anticipated; P23 owns launchability).
    expect(size).toBe(45_649);
  });
});
