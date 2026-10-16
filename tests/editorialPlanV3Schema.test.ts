import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveEditorialTimeline } from "../src/editorial/deriveEditorialTimeline.js";
import { hashEditorialPlanV2 } from "../src/editorial/canonicalizeEditorialPlanV2.js";
import { validateEditorialPlanV2 } from "../src/editorial/validateEditorialPlanV2.js";
import type { EditorialPlanV2 } from "../src/editorial/editorialPlanV2.schema.js";
import { buildEditorialPlanV3 } from "../src/editorial/buildEditorialPlanV3.js";
import { validateEditorialPlanV3, validateExternalAudioAsset } from "../src/editorial/validateEditorialPlanV3.js";
import { canonicalizeEditorialPlanV3, canonicalizeAudioMixDecisions } from "../src/editorial/canonicalizeEditorialPlanV3.js";
import { E4_MAX_TIMELINE_SAMPLES, editorialTimelineDurationSamples, isEffectiveAudioMix } from "../src/editorial/deriveEditorialAudioMix.js";
import { buildEditorialMixRenderPlan } from "../src/editorial/buildEditorialMixRenderPlan.js";
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
const BAD_NUMBERS = [1.5, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2 ** 53];

describe("E4 EditorialPlan 3.0 and external asset schema", () => {
  const base = basePlan();
  const music = audioAsset("theme");
  const plan = mixPlan(base, [music], [layer("theme", "theme")]);

  it("T4-01 3.0 schema is strict at every level with exact literals", () => {
    expect(canonicalEditorialJson(validateEditorialPlanV3(plan))).toBe(canonicalEditorialJson(plan));
    const mutations: ((p: AnyRecord) => void)[] = [
      (p) => { p.extra = 1; }, (p) => { p.planType = "BUSYBOOKIE_EDITORIAL_PLAN_V3"; }, (p) => { p.schemaVersion = "2.0"; },
      (p) => { p.audioMix.extra = 1; }, (p) => { p.audioMix.bed.extra = 1; }, (p) => { p.audioMix.externalAudioAssets[0].extra = 1; },
      (p) => { p.audioMix.layers[0].extra = 1; }, (p) => { delete p.audioMixDecisionsSha256; }, (p) => { delete p.audioMix.bed; },
      (p) => { p.basePlan.extra = 1; },
    ];
    for (const mutate of mutations) {
      const candidate = clone(plan);
      mutate(candidate);
      expect(() => validateEditorialPlanV3(candidate)).toThrow(/Editorial plan/);
    }
  });

  it("T4-02 basePlan must pass validateEditorialPlanV2 unchanged", () => {
    const wrongDuration = clone(plan);
    wrongDuration.basePlan.timelineDurationFrames += 1;
    expect(() => validateEditorialPlanV3(wrongDuration)).toThrow(/2\.0 timelineDurationFrames/);
    const wrongStart = clone(plan);
    wrongStart.basePlan.tracks[0].clips[1].timelineStartFrame = 7;
    expect(() => validateEditorialPlanV3(wrongStart)).toThrow(/V1 timeline start/);
    const wrongVersion = clone(plan);
    wrongVersion.basePlan.schemaVersion = "1.0";
    expect(() => validateEditorialPlanV3(wrongVersion)).toThrow(/Editorial plan/);
    expect(() => buildEditorialPlanV3({ basePlan: wrongDuration.basePlan, externalAudioAssets: [], audioMixDecisions: null })).toThrow(/Editorial plan/);
  });

  it("T4-09 external asset kind/contentType/codec/sampleFormat/sampleRate literals", () => {
    expect(validateExternalAudioAsset(music)).toStrictEqual(music);
    for (const [field, value] of [["kind", "NORMALIZED_SHOT"], ["contentType", "audio/x-wav"], ["codec", "pcm_s24le"],
      ["sampleFormat", "s32"], ["sampleRateHz", 44100]] as const) {
      expect(() => validateExternalAudioAsset({ ...music, [field]: value }), field).toThrow(/external audio asset schema/);
    }
  });

  it("T4-10 mono and stereo admitted; 0, 3 and 6 channels rejected", () => {
    expect(validateExternalAudioAsset(audioAsset("m", { channelCount: 1 })).channelCount).toBe(1);
    expect(validateExternalAudioAsset(audioAsset("s", { channelCount: 2 })).channelCount).toBe(2);
    for (const channelCount of [0, 3, 6]) expect(() => validateExternalAudioAsset(audioAsset("x", { channelCount }))).toThrow(/schema/);
  });

  it("T4-11 other codecs, containers and rates rejected", () => {
    for (const overrides of [{ codec: "pcm_s24le" }, { codec: "pcm_f32le" }, { codec: "flac" }, { codec: "mp3" },
      { contentType: "audio/mpeg" }, { mediaRootRelativePath: "music/theme.mp3" }, { mediaRootRelativePath: "music/theme.flac" },
      { sampleRateHz: 44100 }, { sampleRateHz: 96000 }]) {
      expect(() => validateExternalAudioAsset(audioAsset("theme", overrides)), JSON.stringify(overrides)).toThrow(/schema/);
    }
  });

  it("T4-12 asset/layer id grammar, length, uniqueness and locator grammar", () => {
    const maxSlug = "a".repeat(64);
    expect(validateExternalAudioAsset(audioAsset(maxSlug)).assetId).toHaveLength(70);
    for (const assetId of ["audio:Theme", "audio:", "audio:a--b", "audio:-a", "audio:a_b", "normalized:EP02:S01", `audio:${maxSlug}a`, "theme"]) {
      expect(() => validateExternalAudioAsset({ ...music, assetId }), assetId).toThrow(/schema/);
    }
    for (const layerId of ["layer:Theme", "layer:", "theme", `layer:${maxSlug}a`]) {
      expect(() => mixPlan(base, [music], [layer("x", "theme", { layerId })]), layerId).toThrow(/schema/);
    }
    expect(mixPlan(base, [music], [layer(maxSlug, "theme")]).audioMix.layers[0]!.layerId).toHaveLength(70);
    expect(() => mixPlan(base, [music], [layer("a", "theme"), layer("a", "theme", { timelineStartSample: 1 })])).toThrow(/repeat layer/);
    expect(() => mixPlan(base, [music, music], [layer("a", "theme")])).toThrow(/duplicated/);
    for (const path of ["sfx/door/knock-01.wav", "ambience/a.b_c.wav", "music/1/2/3/4/5/6/x.wav"]) {
      expect(validateExternalAudioAsset({ ...music, mediaRootRelativePath: path }).mediaRootRelativePath).toBe(path);
    }
    for (const path of ["Music/x.wav", "music/X.wav", "music/../x.wav", "music/./x.wav", "/music/x.wav", "C:/music/x.wav",
      "voices/x.wav", "music\\x.wav", "music//x.wav", "music/1/2/3/4/5/6/7/x.wav", "music/x.WAV", `music/${"a".repeat(510)}.wav`]) {
      expect(() => validateExternalAudioAsset({ ...music, mediaRootRelativePath: path }), path).toThrow(/schema/);
    }
  });

  it("T4-14 WAV size and duration bounds", () => {
    expect(validateExternalAudioAsset(audioAsset("x", { bytes: 4_294_967_295 })).bytes).toBe(4_294_967_295);
    expect(() => validateExternalAudioAsset(audioAsset("x", { bytes: 4_294_967_296 }))).toThrow(/schema/);
    expect(validateExternalAudioAsset(audioAsset("x", { bytes: 2_000_000, assetDurationSamples: 500_000 })).assetDurationSamples).toBe(500_000);
    expect(() => validateExternalAudioAsset(audioAsset("x", { bytes: 2_000_000, assetDurationSamples: 500_001 }))).toThrow(/more PCM samples/);
    expect(validateExternalAudioAsset(audioAsset("x", { bytes: 2_000_000, channelCount: 1, assetDurationSamples: 1_000_000 })).channelCount).toBe(1);
    expect(() => validateExternalAudioAsset(audioAsset("x", { bytes: 2_000_000, channelCount: 1, assetDurationSamples: 1_000_001 }))).toThrow(/more PCM samples/);
    for (const assetDurationSamples of [0, -1]) expect(() => validateExternalAudioAsset(audioAsset("x", { assetDurationSamples }))).toThrow(/schema/);
    expect(() => validateExternalAudioAsset(audioAsset("x", { bytes: 0 }))).toThrow(/schema/);
  });

  it("T4-15 half-open source range inside the asset; one-sample layer legal", () => {
    expect(mixPlan(base, [music], [layer("a", "theme", { sourceInSample: 48_000, sourceOutSample: 96_000 })]).audioMix.layers).toHaveLength(1);
    expect(() => mixPlan(base, [music], [layer("a", "theme", { sourceInSample: 48_001, sourceOutSample: 96_001 })])).toThrow(/exceeds its asset/);
    expect(() => mixPlan(base, [music], [layer("a", "theme", { sourceInSample: 10, sourceOutSample: 10 })])).toThrow(/non-empty/);
    expect(() => mixPlan(base, [music], [layer("a", "theme", { sourceInSample: 11, sourceOutSample: 10 })])).toThrow(/non-empty/);
    expect(mixPlan(base, [music], [layer("a", "theme", { sourceInSample: 95_999, sourceOutSample: 96_000 })]).audioMix.layers[0]!.sourceInSample).toBe(95_999);
  });

  it("T4-16 layer lies entirely inside the timeline; never clipped", () => {
    const end = editorialTimelineDurationSamples(base.timelineDurationFrames);
    expect(end).toBe(200 * 1920);
    expect(mixPlan(base, [music], [layer("a", "theme", { timelineStartSample: end - 48_000 })]).audioMix.layers).toHaveLength(1);
    expect(() => mixPlan(base, [music], [layer("a", "theme", { timelineStartSample: end - 47_999 })])).toThrow(/inside the base timeline/);
    expect(() => mixPlan(base, [music], [layer("a", "theme", { timelineStartSample: -1 })])).toThrow(/schema/);
  });

  it("T4-17 numeric hygiene in every sample/gain field and the 42,768,000,000 bound", () => {
    expect(E4_MAX_TIMELINE_SAMPLES).toBe(42_768_000_000);
    expect(Number.isSafeInteger(E4_MAX_TIMELINE_SAMPLES)).toBe(true);
    expect(editorialTimelineDurationSamples(22_275_000)).toBe(42_768_000_000);
    for (const field of ["sourceInSample", "sourceOutSample", "timelineStartSample", "gainCentiDb", "fadeInSamples", "fadeOutSamples"]) {
      for (const bad of BAD_NUMBERS) {
        expect(() => mixPlan(base, [music], [layer("a", "theme", { [field]: bad })]), `${field}=${bad}`).toThrow(/schema/);
      }
    }
    for (const bad of BAD_NUMBERS) {
      expect(() => mixPlan(base, [music], [layer("a", "theme")], { bedGainCentiDb: bad, bedMuted: false })).toThrow(/schema/);
      expect(() => validateExternalAudioAsset(audioAsset("x", { assetDurationSamples: bad }))).toThrow(/schema/);
      expect(() => validateExternalAudioAsset(audioAsset("x", { bytes: bad }))).toThrow(/schema/);
    }
  });

  it("T4-18 gain bounds -9600..1200 integer centi-dB; no float dB field", () => {
    for (const gainCentiDb of [-9600, 1200]) {
      expect(mixPlan(base, [music], [layer("a", "theme", { gainCentiDb })]).audioMix.layers[0]!.gainCentiDb).toBe(gainCentiDb);
      expect(mixPlan(base, [], [], { bedGainCentiDb: gainCentiDb, bedMuted: false }).audioMix.bed.bedGainCentiDb).toBe(gainCentiDb);
    }
    for (const gainCentiDb of [-9601, 1201, 12.5]) {
      expect(() => mixPlan(base, [music], [layer("a", "theme", { gainCentiDb })])).toThrow(/schema/);
      expect(() => mixPlan(base, [], [], { bedGainCentiDb: gainCentiDb, bedMuted: false })).toThrow(/schema/);
    }
    expect(() => mixPlan(base, [music], [layer("a", "theme", { gainDb: -6 })])).toThrow(/schema/);
  });

  it("T4-21 mute is an explicit boolean; no sentinel encodings", () => {
    for (const muted of ["true", 0, 1, null, Number.NEGATIVE_INFINITY]) {
      expect(() => mixPlan(base, [music], [layer("a", "theme", { muted })]), String(muted)).toThrow(/schema/);
    }
    const absent = layer("a", "theme");
    delete absent.muted;
    expect(() => mixPlan(base, [music], [absent])).toThrow(/schema/);
    expect(() => mixPlan(base, [], [], { bedGainCentiDb: 0, bedMuted: null as unknown as boolean })).toThrow(/schema/);
    // A very low gain is still an audible, unmuted (effective) layer, never an implicit mute.
    expect(isEffectiveAudioMix(mixPlan(base, [music], [layer("a", "theme", { gainCentiDb: -9600 })]).audioMix)).toBe(true);
  });

  it("T4-23 fades are 0 or >= 2, fit the selected length, and a one-sample layer has no fade", () => {
    for (const fade of [0, 2]) {
      expect(mixPlan(base, [music], [layer("a", "theme", { fadeInSamples: fade, fadeOutSamples: fade })]).audioMix.layers).toHaveLength(1);
    }
    expect(() => mixPlan(base, [music], [layer("a", "theme", { fadeInSamples: 1 })])).toThrow(/schema/);
    expect(() => mixPlan(base, [music], [layer("a", "theme", { fadeOutSamples: 1 })])).toThrow(/schema/);
    const short = { sourceInSample: 0, sourceOutSample: 10 };
    expect(mixPlan(base, [music], [layer("a", "theme", { ...short, fadeInSamples: 5, fadeOutSamples: 5 })]).audioMix.layers).toHaveLength(1);
    expect(() => mixPlan(base, [music], [layer("a", "theme", { ...short, fadeInSamples: 6, fadeOutSamples: 5 })])).toThrow(/fades exceed/);
    expect(() => mixPlan(base, [music], [layer("a", "theme", { sourceInSample: 0, sourceOutSample: 1, fadeInSamples: 2 })])).toThrow(/fades exceed/);
    expect(mixPlan(base, [music], [layer("a", "theme", { sourceInSample: 0, sourceOutSample: 1 })]).audioMix.layers).toHaveLength(1);
  });
});

describe("E4 architecture and commercial-core guards", () => {
  const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));
  const scriptsRoot = fileURLToPath(new URL("../scripts/", import.meta.url));
  const testsRoot = fileURLToPath(new URL("./", import.meta.url));
  const E4_SOURCES = [
    "audioMixDecisions.schema.ts", "buildEditorialMixAnalysisFfmpegCommand.ts", "buildEditorialMixAudioGraph.ts",
    "buildEditorialMixFfmpegCommand.ts", "buildEditorialMixRenderPlan.ts", "buildEditorialPlanV3.ts", "canonicalizeEditorialPlanV3.ts",
    "deriveEditorialAudioMix.ts", "editorialMixRenderPreflight.ts", "editorialPlanV3.schema.ts", "migrateEditorialPlanV3.ts",
    "resolveExternalAudioAssetPath.ts", "validateAudioMixDecisions.ts", "validateEditorialPlanV3.ts", "validateEditorialPlanV3AgainstSource.ts",
  ];
  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
    });
  }

  it("T4-71 new E4 modules are flat, pure, import-clean, inventoried and have no outside importer", () => {
    const editorialDirectory = join(srcRoot, "editorial");
    const editorial = sourceFiles(editorialDirectory).map((path) => path.slice(path.lastIndexOf(sep) + 1));
    expect(editorial).toHaveLength(48);
    for (const name of E4_SOURCES) expect(editorial, name).toContain(name);
    for (const name of E4_SOURCES) {
      const text = readFileSync(join(editorialDirectory, name), "utf8");
      expect(text, name).not.toMatch(/node:fs|from\s+["']fs|child_process|process\.|dotenv|import\(|spawn|exec[A-Z(]/);
      for (const specifier of text.matchAll(/from\s+["']([^"']+)["']/g)) {
        expect(specifier[1], name).toMatch(/^(zod|node:crypto|node:path|\.\/[A-Za-z0-9.]+\.js|\.\.\/(schemas|composition)\/[A-Za-z.]+\.js)$/);
      }
      expect(text, name).not.toMatch(/from\s+["']\.\.\/composition\//);
    }
    const parity = readFileSync(join(testsRoot, "editorialRoughCutParity.test.ts"), "utf8");
    for (const name of E4_SOURCES) expect(parity, name).toContain(`"${name}"`);
    const production = [...sourceFiles(srcRoot), ...sourceFiles(scriptsRoot)].filter((path) => !path.startsWith(editorialDirectory));
    for (const path of production) expect(readFileSync(path, "utf8"), path).not.toMatch(/from\s+["'][^"']*editorial\//);
  });

  it("T4-72 no runtime path, mediaRoot or timestamp in canonical state; generic, tenant-free sources", () => {
    const music = audioAsset("theme");
    const base = basePlan();
    const decisions = decisionsFor(base, [music], [layer("a", "theme")]);
    const plan = buildEditorialPlanV3({ basePlan: base, externalAudioAssets: [music], audioMixDecisions: decisions });
    const renderPlan = buildEditorialMixRenderPlan({ plan, mediaRoot: MEDIA_ROOT });
    for (const text of [canonicalizeEditorialPlanV3(plan), canonicalizeAudioMixDecisions(decisions), canonicalEditorialJson(renderPlan.renderIdentity)]) {
      expect(text).not.toMatch(/Busybookie\/Production|[A-Za-z]:[\\/]|\\\\|"\/|timestamp|createdAt|updatedAt|"mediaRoot"|"outputPath"|ffmpegExecutable/);
    }
    const identityText = canonicalEditorialJson(renderPlan.renderIdentity);
    expect(identityText).not.toMatch(/audio:|layer:|normalized:|MUSIC|music\//);
    for (const name of E4_SOURCES) {
      const text = readFileSync(join(srcRoot, "editorial", name), "utf8");
      expect(text, name).not.toMatch(/EP[0-9]{2}|OLLIE|Busybookie\/|[A-Z]:[\\/][A-Za-z]|Date\.now|new Date|Math\.random|randomUUID|WeakSet|WeakMap|Davinci|DaVinci|Resolve|Fairlight/);
    }
  });
});
