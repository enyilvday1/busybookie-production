import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPreMasterLoudnessEvidence, toolchainEvidenceKey } from "../src/editorial/audioMasteringEvidence.schema.js";
import { buildAudioMasteringPlan } from "../src/editorial/buildAudioMasteringPlan.js";
import { formatCentiDb } from "../src/editorial/buildEditorialMixAudioGraph.js";
import { hashE4RenderIdentityV1 } from "../src/editorial/buildEditorialMixRenderPlan.js";
import { canonicalEditorialJson } from "../src/editorial/canonicalizeEditorialPlan.js";
import { derivePostEncodeAudioQcEvidence } from "../src/editorial/validatePostEncodeAudioQc.js";
import { buildPostEncodeDecodeCommand, buildPostEncodeLoudnessCommand, buildPostEncodeProbeCommand } from "../src/editorial/buildAudioMasteringFfmpegCommands.js";
import { buildEpisodeRoughCutFfmpegCommand } from "../src/composition/buildEpisodeRoughCutFfmpegCommand.js";
import { E5_REQUIRED_FILTERS } from "../src/editorial/audioMasteringEvidence.schema.js";
import { buildEditorialEditFfmpegCommand } from "../src/editorial/buildEditorialEditFfmpegCommand.js";
import { buildEditorialMixFfmpegCommand } from "../src/editorial/buildEditorialMixFfmpegCommand.js";
import { planEditorialRenderV3 } from "../src/editorial/buildEditorialMixRenderPlan.js";
import { buildEditorialPlanV3 } from "../src/editorial/buildEditorialPlanV3.js";
import { hashEditorialPlanV2 } from "../src/editorial/canonicalizeEditorialPlanV2.js";
import { hashEditorialPlanV3 } from "../src/editorial/canonicalizeEditorialPlanV3.js";
import { deriveAudioMasteringUpstream, type E5UpstreamDerivation } from "../src/editorial/deriveAudioMasteringUpstream.js";
import { deriveEditorialTimeline } from "../src/editorial/deriveEditorialTimeline.js";
import { assertEditorialEditRenderPreflight, type EditorialEditRenderPreflightResult } from "../src/editorial/editorialEditRenderPreflight.js";
import { assertEditorialMixRenderPreflight } from "../src/editorial/editorialMixRenderPreflight.js";
import type { EditorialPlanV2 } from "../src/editorial/editorialPlanV2.schema.js";
import { migrateEditorialPlanV2ToV3 } from "../src/editorial/migrateEditorialPlanV3.js";
import { validateEditorialPlanV2 } from "../src/editorial/validateEditorialPlanV2.js";

// Local, in-memory fixtures only (repeated per E5 test file; no shared helper path is authorized).
type AnyRecord = Record<string, any>;
const MEDIA_ROOT = "D:/Busybookie/Production";
const SHA = (c: string) => c.repeat(64);
function basePlan(frames: readonly number[] = [100, 100], dissolves: readonly number[] = []): EditorialPlanV2 {
  const episodeId = "EP02";
  const ids = frames.map((_, i) => `S${String(i + 1).padStart(2, "0")}`);
  const edges = ids.slice(1).map((_, i) => ((dissolves[i] ?? 0) > 0
    ? { type: "CROSS_DISSOLVE" as const, overlapFrames: dissolves[i]! } : { type: "CUT" as const }));
  const ranges = frames.map((f) => ({ assetDurationFrames: f, sourceInFrame: 0, sourceOutFrame: f }));
  const timeline = deriveEditorialTimeline(ranges, edges);
  const assetId = (id: string) => `normalized:${episodeId}:${id}`;
  return validateEditorialPlanV2({
    schemaVersion: "2.0", planType: "BUSYBOOKIE_EDITORIAL_PLAN",
    episode: { episodeId, title: "Synthetic episode", manifestSha256: SHA("e") }, editorialDecisionsSha256: null,
    profile: { profileId: "busybookie-master-v1", aspectRatio: "16:9", width: 1920, height: 1080, frameRate: { numerator: 25, denominator: 1 },
      audioSampleRateHz: 48000, audioChannels: 2, audioChannelLayout: "stereo" },
    timelineDurationFrames: timeline.timelineDurationFrames,
    shots: ids.map((id, i) => ({ shotId: id, sceneId: "SC01", order: i + 1, title: `Shot ${i + 1}`, assetId: assetId(id) })),
    assets: ids.map((id, i) => {
      const cacheKey = SHA(String(i % 10));
      return { assetId: assetId(id), kind: "NORMALIZED_SHOT", sha256: SHA(String((i + 3) % 10)), bytes: 200, contentType: "video/mp4",
        mediaRootRelativePath: `cache/composition-normalized/${episodeId}/${id}/${episodeId}_${id}_${cacheKey}.mp4`,
        normalization: { schemaVersion: "1.0", profileId: "busybookie-master-normalization-v1", cacheKey },
        generatedSource: { provider: "VEO", providerExecutionId: `task-${i}`, sourceSha256: SHA("1"), sourceBytes: 100, sourceContentType: null },
        assetDurationFrames: frames[i]! };
    }),
    tracks: [
      { trackId: "V1", kind: "VIDEO", clips: ids.map((id, i) => ({ clipId: `V1-${id}`, shotId: id, assetId: assetId(id),
        sourceInFrame: 0, sourceOutFrame: frames[i]!, timelineStartFrame: timeline.video[i]!.timelineStartFrame })) },
      { trackId: "A1", kind: "SHOT_AUDIO", clips: ids.map((id, i) => ({ clipId: `A1-${id}`, shotId: id, assetId: assetId(id),
        sourceInFrame: timeline.audio[i]!.sourceInFrame, sourceOutFrame: timeline.audio[i]!.sourceOutFrame,
        timelineStartFrame: timeline.audio[i]!.timelineStartFrame, linkedClipId: `V1-${id}`, audio: { mode: "PRESERVE_NATIVE" } })) },
    ],
    transitions: edges.map((edge, i) => ({ outgoingClipId: `V1-${ids[i]}`, incomingClipId: `V1-${ids[i + 1]}`, ...edge })),
  });
}
const e2Plan = (frames: readonly number[] = [100, 100]) => migrateEditorialPlanV2ToV3(basePlan(frames));
const e3Plan = () => migrateEditorialPlanV2ToV3(basePlan([100, 100], [10]));
function e4Plan(bedGainCentiDb = -600) {
  const base = basePlan();
  return buildEditorialPlanV3({ basePlan: base, externalAudioAssets: [], audioMixDecisions: { schemaVersion: "1.0",
    decisionsType: "BUSYBOOKIE_AUDIO_MIX_DECISIONS", sourceBinding: { baseEditorialPlanSha256: hashEditorialPlanV2(base), externalAudioAssets: [] },
    bed: { bedGainCentiDb, bedMuted: false }, layers: [] } });
}
type Upstream = { args: string[]; e3Preflight?: EditorialEditRenderPreflightResult; e4Receipt?: unknown };
function upstreamFor(plan: unknown): Upstream {
  const route = planEditorialRenderV3({ plan, mediaRoot: MEDIA_ROOT });
  if (route.route === "E2_ROUGH_CUT") {
    return { args: [...buildEpisodeRoughCutFfmpegCommand({ ffmpegExecutable: "ffmpeg", plan: route.renderPlan, outputPath: route.renderPlan.outputPath }).args] };
  }
  if (route.route === "E3_EDIT") {
    const rp = route.renderPlan;
    const e3Preflight = assertEditorialEditRenderPreflight({ renderPlan: rp, evidence: rp.inputs.map((e) => ({ assetId: e.assetId,
      decodedVideoFrameCount: e.assetDurationFrames, decodedAudioSampleCount: e.assetDurationFrames * 1920 })) });
    return { args: [...buildEditorialEditFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan: rp, preflight: e3Preflight, outputPath: rp.outputPath }).args], e3Preflight };
  }
  const rp = route.renderPlan;
  const e4Receipt = assertEditorialMixRenderPreflight({ renderPlan: rp, outputPath: rp.outputPath, externalEvidence: [],
    baseEvidence: rp.inputs.flatMap((e) => (e.mediaKind === "NORMALIZED_SHOT" ? [{ assetId: e.assetId, sha256: e.sha256, bytes: e.bytes,
      decodedVideoFrameCount: e.assetDurationFrames, decodedAudioSampleCount: e.assetDurationFrames * 1920 }] : [])),
    peakEvidence: { renderKey: rp.renderKey, mixGraphSha256: rp.mixGraphSha256, channelCount: 2, decodedSampleFrameCount: rp.timelineDurationSamples,
      nonFiniteSampleCount: 0, maxAbsSampleF32Bits: 0x3f000000 } });
  return { args: [...buildEditorialMixFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan: rp, receipt: e4Receipt, outputPath: rp.outputPath }).args], e4Receipt };
}
const upstreamExtras = (up: Upstream) => ({
  ...(up.e3Preflight === undefined ? {} : { e3Preflight: up.e3Preflight }), ...(up.e4Receipt === undefined ? {} : { e4Receipt: up.e4Receipt }),
});
function derive(plan: unknown): E5UpstreamDerivation {
  const result = deriveAudioMasteringUpstream({ plan, mediaRoot: MEDIA_ROOT });
  if (!result.ok) throw new Error(`not masterable: ${result.reasons.join(",")}`);
  return result.derivation;
}
function policy(overrides: AnyRecord = {}): AnyRecord {
  return {
    policyType: "BUSYBOOKIE_AUDIO_DELIVERY_POLICY", policyVersion: "1", policyId: "audio-delivery:test-episode",
    measurementEngine: "FFMPEG_LOUDNORM_INPUT_STATS_V1", targetIntegratedCentiLufs: -1600, integratedToleranceCentiLu: 100,
    truePeakCeilingCentiDbtp: -100, minimumGainCentiDb: -2000, maximumGainCentiDb: 1000, loudnessRangePolicy: "RECORD_ONLY",
    expectedAudio: { codecName: "aac", sampleRateHz: 48000, channels: 2, channelLayout: "stereo" }, ...overrides,
  };
}
const TOOLCHAIN: AnyRecord = {
  evidenceType: "BUSYBOOKIE_E5_TOOLCHAIN_EVIDENCE", evidenceVersion: "1",
  ffmpegVersionLine: "ffmpeg version 9.0.2 Copyright (c) 2000-2026 the FFmpeg developers", ffmpegSha256: SHA("f"),
  ffprobeVersionLine: "ffprobe version 9.0.2 Copyright (c) 2007-2026 the FFmpeg developers", ffprobeSha256: SHA("c"),
  requiredFilters: [...E5_REQUIRED_FILTERS], measurementEngine: "FFMPEG_LOUDNORM_INPUT_STATS_V1", invocationModel: "DIRECT_SPAWN_ARGV_NO_SHELL_V1",
};
type Loudness = Partial<Record<"i" | "tp" | "lra" | "thresh", string>>;
function loudnormStderr(values: Loudness = {}): Uint8Array {
  const v = { i: "-23.45", tp: "-12.10", lra: "5.20", thresh: "-33.71", ...values };
  return new TextEncoder().encode([
    "[Parsed_loudnorm_2 @ 0000020a5c8b1d40] ", "{", `\t"input_i" : "${v.i}",`, `\t"input_tp" : "${v.tp}",`, `\t"input_lra" : "${v.lra}",`,
    `\t"input_thresh" : "${v.thresh}",`, "\t\"output_i\" : \"-24.02\",", "\t\"output_tp\" : \"-5.92\",", "\t\"output_lra\" : \"4.30\",",
    "\t\"output_thresh\" : \"-34.20\",", "\t\"normalization_type\" : \"dynamic\",", "\t\"target_offset\" : \"0.02\"", "}", "",
  ].join("\r\n"));
}
function decisionsFor(plan: unknown, mode: "MEASURE_ONLY" | "NORMALIZE_STATIC", deliveryPolicy: unknown = policy()): AnyRecord {
  const derivation = derive(plan);
  return { decisionsType: "BUSYBOOKIE_AUDIO_MASTERING_DECISIONS", schemaVersion: "1.0",
    sourceBinding: { editorialPlanSha256: hashEditorialPlanV3(plan), upstreamRoute: derivation.route, upstreamRenderKey: derivation.upstream.renderKey },
    mode, deliveryPolicy };
}
const MEDIA = "D:/Busybookie/Production/exports/EP02/audio-mastered/EP02_candidate.mp4.part";
const PCM = "D:/Busybookie/Production/qc/EP02_candidate.f32";
const VIDEO_STREAM = (index: number, frames: number, overrides: AnyRecord = {}): AnyRecord => ({ index, codec_name: "h264", profile: "High",
  codec_type: "video", width: 1920, height: 1080, pix_fmt: "yuv420p", r_frame_rate: "25/1", avg_frame_rate: "25/1", bit_rate: "5000000",
  nb_read_frames: String(frames), ...overrides });
const AUDIO_STREAM = (index: number, overrides: AnyRecord = {}): AnyRecord => ({ index, codec_name: "aac", profile: "LC", codec_type: "audio",
  sample_rate: "48000", channels: 2, channel_layout: "stereo", bit_rate: "182800", nb_read_frames: "40", ...overrides });
function probeBytes(streams: readonly AnyRecord[], format: AnyRecord = {}): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ programs: [], streams, format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "0.840000",
    size: "4096", bit_rate: "39009", nb_streams: streams.length, ...format } }, null, 4));
}
// Observations of the fixed QC pipeline; "ABSENT" omits a stage that must not run.
function qcObservations(options: AnyRecord = {}): AnyRecord {
  const frames: number = options.frames ?? 21;
  const samples = frames * 1920;
  const observation: AnyRecord = {
    subject: options.subject ?? { kind: "E5_CANDIDATE", e5RenderKey: SHA("a") },
    mediaSha256: options.mediaSha256 ?? SHA("b"), mediaBytes: options.mediaBytes ?? 4096,
    policy: options.policy === undefined ? policy() : options.policy, toolchainEvidenceKey: options.toolchainEvidenceKey ?? SHA("d"),
    expected: { timelineDurationSamples: samples, timelineDurationFrames: frames }, mediaPath: MEDIA, qcPcmPath: PCM,
    probe: { args: buildPostEncodeProbeCommand({ ffprobeExecutable: "ffprobe", mediaPath: MEDIA }).args,
      exitCode: options.probeExit === undefined ? 0 : options.probeExit,
      stdout: options.probeStdout === undefined ? probeBytes(options.streams ?? [VIDEO_STREAM(0, frames), AUDIO_STREAM(1)]) : options.probeStdout },
  };
  if (options.decode !== "ABSENT") {
    observation.decode = { args: buildPostEncodeDecodeCommand({ ffmpegExecutable: "ffmpeg", mediaPath: MEDIA, qcPcmPath: PCM }).args,
      exitCode: options.decodeExit === undefined ? 0 : options.decodeExit,
      output: options.decodeOutput === undefined ? { byteLength: (options.decodedSamples ?? samples) * 8,
        nonFiniteSampleCount: options.nonFinite ?? 0, maxAbsSampleF32Bits: 0x3f000000 } : options.decodeOutput };
  }
  if (options.measurement !== "ABSENT") {
    observation.measurement = { args: buildPostEncodeLoudnessCommand({ ffmpegExecutable: "ffmpeg", mediaPath: MEDIA }).args,
      exitCode: options.measurementExit === undefined ? 0 : options.measurementExit,
      stderr: options.stderr === undefined ? loudnormStderr({ i: "-16.20", tp: "-2.10" }) : options.stderr };
  }
  return observation;
}

const E5_SOURCES = [
  "audioDeliveryPolicy.schema.ts", "audioMasteringDecisions.schema.ts", "audioMasteringEvidence.schema.ts", "buildAudioMasteringFfmpegCommands.ts",
  "buildAudioMasteringPlan.ts", "deriveAudioMasteringUpstream.ts", "parseLoudnormMeasurement.ts", "validatePostEncodeAudioQc.ts",
];
const snapshot = (plan: unknown) => {
  const route = planEditorialRenderV3({ plan, mediaRoot: MEDIA_ROOT });
  return canonicalEditorialJson({ route: route.route, renderPlan: route.renderPlan, args: upstreamFor(plan).args });
};
function measureOnly(plan: unknown) {
  const up = upstreamFor(plan);
  return buildAudioMasteringPlan({ decisions: decisionsFor(plan, "MEASURE_ONLY", null), plan, mediaRoot: MEDIA_ROOT, upstreamArgs: up.args,
    ...upstreamExtras(up), toolchainEvidenceKey: toolchainEvidenceKey(TOOLCHAIN) });
}

describe("E5 MEASURE_ONLY no-op parity", () => {
  it("T5-73 E2, E3 and E4: upstream argv, renderKey, outputPath and render plan are identical with and without E5 decisions", () => {
    for (const plan of [e2Plan([7, 7, 7]), e3Plan(), e4Plan()]) {
      const before = snapshot(plan);
      const route = planEditorialRenderV3({ plan, mediaRoot: MEDIA_ROOT });
      const built = measureOnly(plan);
      expect(built.ok).toBe(true);
      if (!built.ok) continue;
      expect(built.upstreamArgs).toStrictEqual(upstreamFor(plan).args);
      expect(built.masteringPlan.mode).toBe("MEASURE_ONLY");
      expect(built.masteringPlan).toMatchObject({ mediaAuthority: { route: route.route, upstreamRenderKey: route.renderPlan.renderKey } });
      expect(canonicalEditorialJson(built.masteringPlan)).not.toMatch(/renderIdentity|finalOutputPath|staticGain|Busybookie/);
      const evidence = derivePostEncodeAudioQcEvidence(qcObservations({ policy: null, subject: { kind: "UPSTREAM_MEDIA", route: route.route,
        upstreamRenderKey: route.renderPlan.renderKey, upstreamRecordBinding: route.route === "E2_ROUGH_CUT" ? "E2_RENDER_RECORD_VERIFIED"
          : "NO_UPSTREAM_RECORD_LIFECYCLE" } }) as never);
      expect(evidence.subject.kind).toBe("UPSTREAM_MEDIA");
      expect(snapshot(plan)).toBe(before);
    }
  });

  it("T5-74 NORMALIZE_STATIC leaves the upstream authority untouched and writes only to the E5 audio-mastered location", () => {
    for (const plan of [e2Plan([249, 2]), e3Plan(), e4Plan()]) {
      const before = snapshot(plan);
      const up = upstreamFor(plan);
      const derivation = derive(plan);
      const key = toolchainEvidenceKey(TOOLCHAIN);
      const pre = buildPreMasterLoudnessEvidence({ derivation, upstreamArgs: up.args, toolchainEvidenceKey: key, stderr: loudnormStderr() });
      if (!pre.ok) throw new Error("pre-master");
      const built = buildAudioMasteringPlan({ decisions: decisionsFor(plan, "NORMALIZE_STATIC"), plan, mediaRoot: MEDIA_ROOT, upstreamArgs: up.args,
        ...upstreamExtras(up), toolchainEvidenceKey: key, preMasterEvidence: pre.evidence });
      if (!built.ok || built.masteringPlan.mode !== "NORMALIZE_STATIC") throw new Error("normalize");
      expect(built.masteringPlan.finalOutputPath).not.toBe(derivation.outputPath);
      expect(built.masteringPlan.finalOutputPath).toContain("\\exports\\EP02\\audio-mastered\\");
      expect(built.masteringPlan.renderKey).not.toBe(derivation.upstream.renderKey);
      expect(snapshot(plan)).toBe(before);
    }
  });

  it("T5-75 E4 artifacts are untouched: identity, renderKey, audio graph, mix graph hash and receipt verify as before", () => {
    const plan = e4Plan(-350);
    const route = planEditorialRenderV3({ plan, mediaRoot: MEDIA_ROOT });
    if (route.route !== "E4_MIX") throw new Error("route");
    const before = canonicalEditorialJson(route.renderPlan);
    const derivation = derive(plan);
    if (derivation.upstream.route !== "E4_MIX") throw new Error("member");
    expect(derivation.upstream.renderIdentity).toStrictEqual(route.renderPlan.renderIdentity);
    expect(hashE4RenderIdentityV1(derivation.upstream.renderIdentity)).toBe(route.renderPlan.renderKey);
    expect(derivation.upstream.mixGraphSha256).toBe(route.renderPlan.mixGraphSha256);
    expect(route.renderPlan.audioGraph).toContain("volume=-3.5dB:precision=float");
    expect(formatCentiDb(-350)).toBe("-3.5dB");
    expect(canonicalEditorialJson(planEditorialRenderV3({ plan, mediaRoot: MEDIA_ROOT }).renderPlan)).toBe(before);
  });
});

describe("E5 architecture guards", () => {
  const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));
  const scriptsRoot = fileURLToPath(new URL("../scripts/", import.meta.url));
  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
    });
  }

  it("T5-76 the eight E5 modules are flat, pure, editorial-only imports, unreferenced by production code and dynamics-free", () => {
    const editorialDirectory = join(srcRoot, "editorial");
    const editorial = readdirSync(editorialDirectory);
    for (const name of E5_SOURCES) expect(editorial, name).toContain(name);
    for (const name of E5_SOURCES) {
      const text = readFileSync(join(editorialDirectory, name), "utf8");
      expect(text, name).not.toMatch(/node:fs|from\s+["']fs|child_process|process\.|dotenv|import\(|spawn|exec[A-Z(]|Date\.now|Math\.random/);
      for (const specifier of text.matchAll(/from\s+["']([^"']+)["']/g)) {
        expect(specifier[1], name).toMatch(/^(zod|node:crypto|node:path|\.\/[A-Za-z0-9.]+\.js|\.\.\/composition\/[A-Za-z.]+\.js)$/);
      }
      for (const specifier of text.matchAll(/import\s+(type\s+)?\{[^}]*\}\s+from\s+["'](\.\.\/composition\/[^"']+)["']/g)) {
        expect(specifier[1], `${name} must import composition types only`).toBe("type ");
      }
      expect(text, name).not.toMatch(/CharacterBible|characterReference|continuityLedger/);
    }
    const production = [...sourceFiles(srcRoot), ...sourceFiles(scriptsRoot)].filter((path) => !path.startsWith(editorialDirectory));
    for (const path of production) expect(readFileSync(path, "utf8"), path).not.toMatch(/from\s+["'][^"']*editorial\//);
  });
});
