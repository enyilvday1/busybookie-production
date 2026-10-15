import { describe, expect, it } from "vitest";
import { deriveEditorialTimeline } from "../src/editorial/deriveEditorialTimeline.js";
import { hashEditorialPlanV2 } from "../src/editorial/canonicalizeEditorialPlanV2.js";
import { validateEditorialPlanV2 } from "../src/editorial/validateEditorialPlanV2.js";
import type { EditorialPlanV2 } from "../src/editorial/editorialPlanV2.schema.js";
import { buildEditorialPlanV3 } from "../src/editorial/buildEditorialPlanV3.js";
import { validateEditorialPlanV3AgainstSource } from "../src/editorial/validateEditorialPlanV3AgainstSource.js";
import { validateAudioMixDecisionsAgainstSource } from "../src/editorial/validateAudioMixDecisions.js";

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
const build = (base: unknown, assets: AnyRecord[], decisions: unknown) =>
  buildEditorialPlanV3({ basePlan: base, externalAudioAssets: assets, audioMixDecisions: decisions });

describe("E4 source binding and staleness (fail closed)", () => {
  const base = basePlan();
  const music = audioAsset("theme");
  const layers = [layer("a", "theme", { timelineStartSample: 96_000 })];
  const decisions = decisionsFor(base, [music], layers);

  it("T4-25 absolute placement: a base trim change stales the decisions; no clip-relative anchoring field exists", () => {
    const plan = build(base, [music], decisions);
    expect(() => validateEditorialPlanV3AgainstSource({ plan, basePlan: base, externalAudioAssets: [music], audioMixDecisions: decisions })).not.toThrow();
    const trimmed = basePlan({ shots: [{ out: 90 }, {}] });
    expect(() => build(trimmed, [music], decisions)).toThrow(/base plan binding is stale/);
    expect(() => validateEditorialPlanV3AgainstSource({ plan, basePlan: trimmed, externalAudioAssets: [music], audioMixDecisions: decisions }))
      .toThrow(/diverges from the current base plan/);
    const anchored = structuredClone(decisions);
    anchored.layers[0].anchorClipId = "V1-S02";
    expect(() => build(base, [music], anchored)).toThrow(/schema/);
    const tampered = structuredClone(plan) as AnyRecord;
    tampered.audioMix.layers[0].gainCentiDb = -100;
    expect(() => validateEditorialPlanV3AgainstSource({ plan: tampered, basePlan: base, externalAudioAssets: [music], audioMixDecisions: decisions }))
      .toThrow(/layers diverge/);
  });

  it("T4-27 any base-plan change (trim, transition, retitle, regenerated shot) stales the decisions", () => {
    for (const changed of [basePlan({ shots: [{ in: 1 }, {}] }), basePlan({ edges: [4] }), basePlan({ title: "Retitled" }),
      basePlan({ shots: [{}, { sha: SHA("f") }] }), basePlan({ shots: [{ cacheKey: SHA("9") }, {}] })]) {
      expect(hashEditorialPlanV2(changed)).not.toBe(hashEditorialPlanV2(base));
      expect(() => build(changed, [music], decisions)).toThrow(/base plan binding is stale/);
    }
  });

  it("T4-28 every bound technical field is checked against the admitted source record", () => {
    for (const [field, value] of [["sha256", SHA("b")], ["bytes", 999_999], ["assetDurationSamples", 95_999], ["channelCount", 1]] as const) {
      const stale = structuredClone(decisions);
      stale.sourceBinding.externalAudioAssets[0][field] = value;
      expect(() => build(base, [music], stale), field).toThrow(new RegExp(`binding ${field} for audio:theme is stale`));
      expect(() => build(base, [{ ...music, [field]: value }], decisions), `source ${field}`).toThrow(/stale|more PCM samples/);
    }
    for (const [field, value] of [["sampleRateHz", 44100], ["codec", "pcm_s24le"], ["sampleFormat", "s32"], ["contentType", "audio/x-wav"]] as const) {
      const stale = structuredClone(decisions);
      stale.sourceBinding.externalAudioAssets[0][field] = value;
      expect(() => build(base, [music], stale), field).toThrow(/schema/);
    }
  });

  it("T4-29 missing, extra, duplicate and unknown bindings are rejected", () => {
    const missing = structuredClone(decisions);
    missing.sourceBinding.externalAudioAssets = [];
    expect(() => build(base, [music], missing)).toThrow(/equal the referenced asset closure/);
    const spare = audioAsset("spare", { sha256: SHA("c") });
    const extra = structuredClone(decisions);
    extra.sourceBinding.externalAudioAssets.push(bindingOf(spare));
    expect(() => build(base, [music, spare], extra)).toThrow(/equal the referenced asset closure/);
    const duplicate = structuredClone(decisions);
    duplicate.sourceBinding.externalAudioAssets.push(bindingOf(music));
    expect(() => build(base, [music], duplicate)).toThrow(/duplicate the binding/);
    const ghost = audioAsset("ghost", { sha256: SHA("c") });
    const unknown = decisionsFor(base, [ghost], [layer("a", "ghost")]);
    expect(() => build(base, [music], unknown)).toThrow(/bind unknown asset audio:ghost/);
    const unknownReference = structuredClone(decisions);
    unknownReference.layers[0].assetId = "audio:ghost";
    expect(() => build(base, [music], unknownReference)).toThrow(/equal the referenced asset closure/);
  });

  it("T4-30 several placements of one asset need exactly one binding; muted-layer assets are in the closure", () => {
    const quiet = audioAsset("quiet", { sha256: SHA("b") });
    const many = [layer("a", "theme"), layer("b", "theme", { timelineStartSample: 48_000 }), layer("c", "quiet", { muted: true })];
    const ok = decisionsFor(base, [music, quiet], many);
    expect(ok.sourceBinding.externalAudioAssets.map((b: AnyRecord) => b.assetId)).toStrictEqual(["audio:theme", "audio:quiet"]);
    expect(build(base, [music, quiet], ok).audioMix.externalAudioAssets.map((a) => a.assetId)).toStrictEqual(["audio:theme", "audio:quiet"]);
    const withoutMuted = structuredClone(ok);
    withoutMuted.sourceBinding.externalAudioAssets.pop();
    expect(() => build(base, [music, quiet], withoutMuted)).toThrow(/equal the referenced asset closure/);
  });

  it("T4-31 binding order is first-reference order; any other order is rejected", () => {
    const quiet = audioAsset("quiet", { sha256: SHA("b") });
    const ordered = decisionsFor(base, [music, quiet], [layer("a", "quiet"), layer("b", "theme"), layer("c", "quiet", { timelineStartSample: 1 })]);
    expect(ordered.sourceBinding.externalAudioAssets.map((b: AnyRecord) => b.assetId)).toStrictEqual(["audio:quiet", "audio:theme"]);
    expect(() => validateAudioMixDecisionsAgainstSource(ordered, { basePlan: base, externalAudioAssets: [music, quiet] })).not.toThrow();
    const swapped = structuredClone(ordered);
    swapped.sourceBinding.externalAudioAssets.reverse();
    expect(() => validateAudioMixDecisionsAgainstSource(swapped, { basePlan: base, externalAudioAssets: [music, quiet] }))
      .toThrow(/first-reference order/);
  });
});
