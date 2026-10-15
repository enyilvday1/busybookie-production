import { describe, expect, it } from "vitest";
import { deriveEditorialTimeline } from "../src/editorial/deriveEditorialTimeline.js";
import { hashEditorialPlanV2 } from "../src/editorial/canonicalizeEditorialPlanV2.js";
import { validateEditorialPlanV2 } from "../src/editorial/validateEditorialPlanV2.js";
import type { EditorialPlanV2 } from "../src/editorial/editorialPlanV2.schema.js";
import { buildEditorialPlanV3 } from "../src/editorial/buildEditorialPlanV3.js";
import { canonicalizeAudioMixDecisions, hashAudioMixDecisions, hashEditorialPlanV3 } from "../src/editorial/canonicalizeEditorialPlanV3.js";
import { buildEditorialMixRenderPlan } from "../src/editorial/buildEditorialMixRenderPlan.js";

// Local, in-memory fixtures only (repeated per E4 test file; no shared helper path is authorized).
type AnyRecord = Record<string, any>;
const MEDIA_ROOT = "D:/Busybookie/Production";
const SHA = (c: string) => c.repeat(64);
function basePlan(title = "Synthetic episode"): EditorialPlanV2 {
  const ids = ["S01", "S02"];
  const timeline = deriveEditorialTimeline(ids.map(() => ({ assetDurationFrames: 100, sourceInFrame: 0, sourceOutFrame: 100 })), [{ type: "CUT" }]);
  const assetId = (id: string) => `normalized:EP02:${id}`;
  return validateEditorialPlanV2({
    schemaVersion: "2.0", planType: "BUSYBOOKIE_EDITORIAL_PLAN",
    episode: { episodeId: "EP02", title, manifestSha256: SHA("e") }, editorialDecisionsSha256: null,
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
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as AnyRecord).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  }
  return value;
}

describe("E4 canonical hashing", () => {
  const base = basePlan();
  const music = audioAsset("theme");
  const quiet = audioAsset("quiet", { sha256: SHA("b"), channelCount: 1 });
  const layers = [layer("a", "theme", { gainCentiDb: -300, fadeInSamples: 480 }), layer("b", "quiet", { role: "SFX", timelineStartSample: 96_000 })];
  const decisions = decisionsFor(base, [music, quiet], layers, { bedGainCentiDb: -200, bedMuted: false });

  it("T4-33 decisions hash is deterministic, key-order independent and sensitive to every field and to layer order", () => {
    const hash = hashAudioMixDecisions(decisions);
    expect(hashAudioMixDecisions(structuredClone(decisions))).toBe(hash);
    expect(hashAudioMixDecisions(reverseKeys(decisions))).toBe(hash);
    expect(canonicalizeAudioMixDecisions(reverseKeys(decisions))).toBe(canonicalizeAudioMixDecisions(decisions));
    const mutations: ((d: AnyRecord) => void)[] = [
      (d) => { d.bed.bedGainCentiDb = -201; }, (d) => { d.bed.bedMuted = true; }, (d) => { d.layers[0].role = "OTHER"; },
      (d) => { d.layers[0].gainCentiDb = -301; }, (d) => { d.layers[0].timelineStartSample = 1; }, (d) => { d.layers[0].sourceInSample = 1; },
      (d) => { d.layers[0].sourceOutSample = 47_999; }, (d) => { d.layers[0].fadeInSamples = 482; }, (d) => { d.layers[0].fadeOutSamples = 2; },
      (d) => { d.layers[0].muted = true; }, (d) => { d.layers[0].layerId = "layer:z"; }, (d) => { d.layers.reverse(); },
      (d) => { d.sourceBinding.externalAudioAssets[0].sha256 = SHA("f"); }, (d) => { d.sourceBinding.baseEditorialPlanSha256 = SHA("f"); },
    ];
    const seen = new Set([hash]);
    for (const mutate of mutations) {
      const candidate = structuredClone(decisions);
      mutate(candidate);
      const next = hashAudioMixDecisions(candidate);
      expect(seen.has(next)).toBe(false);
      seen.add(next);
    }
  });

  it("T4-36 layer order is canonical (no hidden sort): reordering changes the plan hash and, when effective, the renderKey", () => {
    const plan = buildEditorialPlanV3({ basePlan: base, externalAudioAssets: [music, quiet], audioMixDecisions: decisions });
    expect(plan.audioMix.layers.map((l) => l.layerId)).toStrictEqual(["layer:a", "layer:b"]);
    const reversed = decisionsFor(base, [music, quiet], [...layers].reverse(), { bedGainCentiDb: -200, bedMuted: false });
    const reordered = buildEditorialPlanV3({ basePlan: base, externalAudioAssets: [music, quiet], audioMixDecisions: reversed });
    expect(reordered.audioMix.layers.map((l) => l.layerId)).toStrictEqual(["layer:b", "layer:a"]);
    expect(hashEditorialPlanV3(reordered)).not.toBe(hashEditorialPlanV3(plan));
    const key = (p: unknown) => buildEditorialMixRenderPlan({ plan: p, mediaRoot: MEDIA_ROOT }).renderKey;
    expect(key(reordered)).not.toBe(key(plan));
    expect(hashEditorialPlanV3(plan)).toBe(hashEditorialPlanV3(reverseKeys(plan)));
  });
});
