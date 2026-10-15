import { describe, expect, it } from "vitest";
import { hashEditorialPlanV2 } from "../src/editorial/canonicalizeEditorialPlanV2.js";
import { deriveEditorialTimeline } from "../src/editorial/deriveEditorialTimeline.js";
import type { EditorialPlanV2 } from "../src/editorial/editorialPlanV2.schema.js";
import { validateEditorialPlanV2 } from "../src/editorial/validateEditorialPlanV2.js";
import { parseAudioMixDecisions, validateAudioMixDecisionsAgainstSource } from "../src/editorial/validateAudioMixDecisions.js";

// Local, in-memory fixtures only (repeated per E4 test file; no shared helper path is authorized).
type AnyRecord = Record<string, any>;
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

describe("E4 AudioMixDecisions 1.0", () => {
  it("T4-32 decisions are strict, typed, intent-only and reject runtime fields", () => {
    const base = basePlan();
    const music = audioAsset("theme");
    const valid: AnyRecord = {
      schemaVersion: "1.0", decisionsType: "BUSYBOOKIE_AUDIO_MIX_DECISIONS",
      sourceBinding: { baseEditorialPlanSha256: hashEditorialPlanV2(base), externalAudioAssets: [bindingOf(music)] },
      bed: { bedGainCentiDb: -300, bedMuted: false }, layers: [layer("a", "theme", { role: "SFX" })],
    };
    const parsed = parseAudioMixDecisions(valid);
    expect(parsed).toStrictEqual(valid);
    expect(Object.isFrozen(parsed) && Object.isFrozen(parsed.layers[0])).toBe(true);
    expect(validateAudioMixDecisionsAgainstSource(valid, { basePlan: base, externalAudioAssets: [music] })).toStrictEqual(valid);
    const mutations: ((d: AnyRecord) => void)[] = [
      (d) => { d.decisionsType = "BUSYBOOKIE_EDITORIAL_DECISIONS"; }, (d) => { d.schemaVersion = "2.0"; },
      (d) => { d.mediaRoot = "D:/media"; }, (d) => { d.outputPath = "D:/out.mp4"; }, (d) => { d.createdAt = "2026-10-15T00:00:00Z"; },
      (d) => { d.ffmpegExecutable = "ffmpeg"; }, (d) => { d.environment = {}; }, (d) => { d.user = "operator"; },
      (d) => { d.sourceBinding.externalAudioAssets[0].mediaRootRelativePath = "music/theme.wav"; },
      (d) => { d.sourceBinding.externalAudioAssets[0].path = "D:/media/music/theme.wav"; },
      (d) => { d.sourceBinding.mediaRoot = "D:/media"; }, (d) => { d.layers[0].path = "D:/media/music/theme.wav"; },
      (d) => { d.bed.timestamp = 1; }, (d) => { delete d.bed; }, (d) => { delete d.sourceBinding.baseEditorialPlanSha256; },
    ];
    for (const mutate of mutations) {
      const candidate = structuredClone(valid);
      mutate(candidate);
      expect(() => parseAudioMixDecisions(candidate)).toThrow(/audio mix decisions schema/);
    }
    const duplicateBinding = structuredClone(valid);
    duplicateBinding.sourceBinding.externalAudioAssets.push(bindingOf(music));
    expect(() => parseAudioMixDecisions(duplicateBinding)).toThrow(/duplicate the binding/);
    const repeatedLayer = structuredClone(valid);
    repeatedLayer.layers.push(layer("a", "theme", { timelineStartSample: 10 }));
    expect(() => parseAudioMixDecisions(repeatedLayer)).toThrow(/repeat layer/);
  });
});
