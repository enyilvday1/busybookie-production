import { describe, expect, it } from "vitest";
import { deriveEditorialTimeline } from "../src/editorial/deriveEditorialTimeline.js";
import { hashEditorialPlanV2 } from "../src/editorial/canonicalizeEditorialPlanV2.js";
import { validateEditorialPlanV2 } from "../src/editorial/validateEditorialPlanV2.js";
import type { EditorialPlanV2 } from "../src/editorial/editorialPlanV2.schema.js";
import { buildEditorialPlanV3 } from "../src/editorial/buildEditorialPlanV3.js";
import { validateEditorialPlanV3 } from "../src/editorial/validateEditorialPlanV3.js";
import { canonicalizeEditorialPlanV3, hashEditorialPlanV3 } from "../src/editorial/canonicalizeEditorialPlanV3.js";
import { planEditorialRenderV3 } from "../src/editorial/buildEditorialMixRenderPlan.js";
import { planEditorialRenderV2 } from "../src/editorial/buildEditorialEditRenderPlan.js";
import { buildEpisodeRoughCutFfmpegCommand } from "../src/composition/buildEpisodeRoughCutFfmpegCommand.js";
import { canonicalEditorialJson } from "../src/editorial/canonicalizeEditorialPlan.js";

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
const clone = (value: unknown): AnyRecord => structuredClone(value) as AnyRecord;

describe("E4 EditorialPlan 3.0 builder", () => {
  const base = basePlan();

  it("T4-03 3.0 is self-contained: canonical JSON round trip validates and routes without any external 2.0 file", () => {
    const plan = mixPlan(base, [audioAsset("theme")], [layer("a", "theme", { gainCentiDb: -600 })]);
    const roundTrip = JSON.parse(canonicalizeEditorialPlanV3(plan)) as unknown;
    expect(canonicalEditorialJson(validateEditorialPlanV3(roundTrip))).toBe(canonicalEditorialJson(plan));
    const fromRoundTrip = planEditorialRenderV3({ plan: roundTrip, mediaRoot: MEDIA_ROOT });
    const fromBuilt = planEditorialRenderV3({ plan, mediaRoot: MEDIA_ROOT });
    expect(fromRoundTrip.route).toBe("E4_MIX");
    expect(fromRoundTrip).toStrictEqual(fromBuilt);
    expect(Object.isFrozen(plan) && Object.isFrozen(plan.audioMix.layers[0]) && Object.isFrozen(plan.basePlan)).toBe(true);
  });

  it("T4-13 equal-content distinct logical assets stay distinct in plan, bindings and physical inputs", () => {
    const left = audioAsset("left", { mediaRootRelativePath: "sfx/left.wav" });
    const right = audioAsset("right", { mediaRootRelativePath: "sfx/right.wav" });
    expect(left.sha256).toBe(right.sha256);
    const decisions = decisionsFor(base, [left, right], [layer("a", "left"), layer("b", "right", { timelineStartSample: 96_000 })]);
    const plan = buildEditorialPlanV3({ basePlan: base, externalAudioAssets: [left, right], audioMixDecisions: decisions });
    expect(plan.audioMix.externalAudioAssets.map((a) => a.assetId)).toStrictEqual(["audio:left", "audio:right"]);
    expect(decisions.sourceBinding.externalAudioAssets).toHaveLength(2);
    const route = planEditorialRenderV3({ plan, mediaRoot: MEDIA_ROOT });
    if (route.route !== "E4_MIX") throw new Error("expected E4_MIX");
    const externals = route.renderPlan.inputs.filter((entry) => entry.mediaKind === "EXTERNAL_AUDIO");
    expect(externals.map((entry) => [entry.inputIndex, entry.assetId])).toStrictEqual([[2, "audio:left"], [3, "audio:right"]]);
    expect(new Set(externals.map((entry) => entry.sha256)).size).toBe(1);
    expect(route.renderPlan.renderIdentity.layers.map((l) => l.inputIndex)).toStrictEqual([2, 3]);
  });

  it("T4-34 absent vs explicit all-default decisions: provenance differs, route/renderKey/argv identical; null hash requires defaults", () => {
    const absent = buildEditorialPlanV3({ basePlan: base, externalAudioAssets: [audioAsset("unused")], audioMixDecisions: null });
    const explicit = mixPlan(base, [], []);
    expect(absent.audioMixDecisionsSha256).toBeNull();
    expect(explicit.audioMixDecisionsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(absent.audioMix).toStrictEqual(explicit.audioMix);
    expect(hashEditorialPlanV3(absent)).not.toBe(hashEditorialPlanV3(explicit));
    const legacy = planEditorialRenderV2({ plan: base, mediaRoot: MEDIA_ROOT });
    for (const plan of [absent, explicit]) {
      const route = planEditorialRenderV3({ plan, mediaRoot: MEDIA_ROOT });
      expect(route).toStrictEqual(legacy);
      if (route.route !== "E2_ROUGH_CUT" || legacy.route !== "E2_ROUGH_CUT") throw new Error("expected E2 route");
      const command = (p: typeof route.renderPlan) => buildEpisodeRoughCutFfmpegCommand({ ffmpegExecutable: "ffmpeg", plan: p, outputPath: p.outputPath });
      expect(command(route.renderPlan)).toStrictEqual(command(legacy.renderPlan));
    }
    const nullWithMix = clone(mixPlan(base, [], [], { bedGainCentiDb: 100, bedMuted: false }));
    nullWithMix.audioMixDecisionsSha256 = null;
    expect(() => validateEditorialPlanV3(nullWithMix)).toThrow(/without decisions provenance/);
    const nullWithMute = clone(absent);
    nullWithMute.audioMix.bed.bedMuted = true;
    expect(() => validateEditorialPlanV3(nullWithMute)).toThrow(/without decisions provenance/);
  });

  it("T4-35 3.0 asset closure is exact (no orphan), includes muted references, in first-reference order", () => {
    const a = audioAsset("a"), b = audioAsset("b", { sha256: SHA("b") }), spare = audioAsset("spare", { sha256: SHA("c") });
    const plan = mixPlan(base, [a, b, spare], [layer("one", "b", { muted: true }), layer("two", "a"), layer("three", "b", { timelineStartSample: 1 })]);
    expect(plan.audioMix.externalAudioAssets.map((asset) => asset.assetId)).toStrictEqual(["audio:b", "audio:a"]);
    const orphan = clone(plan);
    orphan.audioMix.externalAudioAssets.push(spare);
    expect(() => validateEditorialPlanV3(orphan)).toThrow(/reference closure/);
    const missing = clone(plan);
    missing.audioMix.externalAudioAssets.pop();
    expect(() => validateEditorialPlanV3(missing)).toThrow(/reference closure/);
    const reordered = clone(plan);
    reordered.audioMix.externalAudioAssets.reverse();
    expect(() => validateEditorialPlanV3(reordered)).toThrow(/reference closure/);
    const unknownReference = clone(plan);
    unknownReference.audioMix.layers[1].assetId = "audio:spare";
    expect(() => validateEditorialPlanV3(unknownReference)).toThrow(/reference closure/);
  });
});
