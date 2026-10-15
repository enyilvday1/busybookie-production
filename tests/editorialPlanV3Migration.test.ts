import { describe, expect, it } from "vitest";
import { deriveEditorialTimeline } from "../src/editorial/deriveEditorialTimeline.js";
import { canonicalizeEditorialPlanV2, hashEditorialPlanV2 } from "../src/editorial/canonicalizeEditorialPlanV2.js";
import { validateEditorialPlanV2 } from "../src/editorial/validateEditorialPlanV2.js";
import type { EditorialPlanV2 } from "../src/editorial/editorialPlanV2.schema.js";
import { buildEditorialPlanV3 } from "../src/editorial/buildEditorialPlanV3.js";
import { downgradeEditorialPlanV3ToV2, migrateEditorialPlanV2ToV3 } from "../src/editorial/migrateEditorialPlanV3.js";
import { canonicalizeEditorialPlanV3 } from "../src/editorial/canonicalizeEditorialPlanV3.js";
import { isEffectiveAudioMix } from "../src/editorial/deriveEditorialAudioMix.js";

// Local, in-memory fixtures only (repeated per E4 test file; no shared helper path is authorized).
type AnyRecord = Record<string, any>;
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

describe("E4 2.0 <-> 3.0 migration and downgrade", () => {
  const bases = [basePlan(), basePlan({ shots: [{ in: 10 }, { out: 90 }], edges: [6] })];

  it("T4-04 pure 2.0 -> 3.0 migration: default bed, no assets or layers, null provenance; frozen; input untouched", () => {
    for (const base of bases) {
      const input = structuredClone(base);
      const before = JSON.stringify(input);
      const migrated = migrateEditorialPlanV2ToV3(input);
      expect(JSON.stringify(input)).toBe(before);
      expect(migrated).toStrictEqual({
        planType: "BUSYBOOKIE_EDITORIAL_PLAN", schemaVersion: "3.0", basePlan: base, audioMixDecisionsSha256: null,
        audioMix: { bed: { bedGainCentiDb: 0, bedMuted: false }, externalAudioAssets: [], layers: [] },
      });
      expect(Object.isFrozen(migrated) && Object.isFrozen(migrated.audioMix.bed) && Object.isFrozen(migrated.basePlan)).toBe(true);
      expect(() => migrateEditorialPlanV2ToV3({ ...input, schemaVersion: "1.0" })).toThrow(/Editorial plan/);
    }
  });

  it("T4-05 migrated and absent-decisions plans have no effective mix", () => {
    for (const base of bases) {
      expect(isEffectiveAudioMix(migrateEditorialPlanV2ToV3(base).audioMix)).toBe(false);
      expect(isEffectiveAudioMix(buildEditorialPlanV3({ basePlan: base, externalAudioAssets: [], audioMixDecisions: null }).audioMix)).toBe(false);
    }
  });

  it("T4-06 downgrade is exact without an effective mix; muted-only layers and their assets are discarded", () => {
    for (const base of bases) {
      const mutedOnly = mixPlan(base, [audioAsset("theme")], [layer("a", "theme", { muted: true, gainCentiDb: 600, fadeInSamples: 2 })]);
      expect(mutedOnly.audioMix.externalAudioAssets).toHaveLength(1);
      const downgraded = downgradeEditorialPlanV3ToV2(mutedOnly);
      expect(downgraded).toStrictEqual(base);
      expect(canonicalizeEditorialPlanV2(downgraded)).toBe(canonicalizeEditorialPlanV2(base));
      expect(JSON.stringify(downgraded)).not.toMatch(/audio:|layer:|audioMix/);
    }
  });

  it("T4-07 downgrade fails closed for bed gain, bed mute or an unmuted layer, each alone", () => {
    const base = bases[0]!;
    for (const plan of [mixPlan(base, [], [], { bedGainCentiDb: -1, bedMuted: false }), mixPlan(base, [], [], { bedGainCentiDb: 0, bedMuted: true }),
      mixPlan(base, [audioAsset("theme")], [layer("a", "theme")])]) {
      expect(() => downgradeEditorialPlanV3ToV2(plan)).toThrow(/effective audio mix cannot be expressed/);
    }
  });

  it("T4-08 commutativity migrate(v2) == build(v2, [], null) and round trip downgrade(migrate(v2)) == v2", () => {
    for (const base of bases) {
      expect(canonicalizeEditorialPlanV3(migrateEditorialPlanV2ToV3(base)))
        .toBe(canonicalizeEditorialPlanV3(buildEditorialPlanV3({ basePlan: base, externalAudioAssets: [], audioMixDecisions: null })));
      expect(canonicalizeEditorialPlanV2(downgradeEditorialPlanV3ToV2(migrateEditorialPlanV2ToV3(base)))).toBe(canonicalizeEditorialPlanV2(base));
    }
  });
});
