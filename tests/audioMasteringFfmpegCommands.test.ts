import { describe, expect, it } from "vitest";
import {
  applyMasteringRewriteLaw, buildMasteringGainFilter, buildPreMasterMeasurementCommand, E5_FORBIDDEN_FINAL_GRAPH_FILTERS,
  measurementArgvSha256, qcAttemptArgvSha256,
} from "../src/editorial/buildAudioMasteringFfmpegCommands.js";
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

const LOUDNORM = "loudnorm=I=-24:LRA=7:TP=-2:print_format=json";
const measurement = (plan: unknown) => buildPreMasterMeasurementCommand({ ffmpegExecutable: "ffmpeg", derivation: derive(plan), upstreamArgs: upstreamFor(plan).args });

describe("E5 pre-master measurement command (Step 1082 R7, Step 1084 R6)", () => {
  it("T5-50 E2 golden: upstream inputs verbatim, sample-domain atrim to frame-derived T before loudnorm, no -t", () => {
    const plan = e2Plan([7, 7, 7]);
    const up = upstreamFor(plan);
    const command = measurement(plan);
    expect(command.args).toStrictEqual([
      "-hide_banner", "-nostdin", "-nostats", "-loglevel", "info", ...up.args.slice(5, 11), "-filter_complex",
      "[0:v:0][0:a:0][1:v:0][1:a:0][2:v:0][2:a:0]concat=n=3:v=1:a=1[v][a];[v]nullsink;" +
        `[a]atrim=start_sample=0:end_sample=40320,asetpts=PTS-STARTPTS,${LOUDNORM}[e5m]`,
      "-map", "[e5m]", "-f", "null", "-",
    ]);
    expect(command.args).not.toContain("-t");
    expect(up.args[up.args.indexOf("-t") + 1]).toBe("0.8400000000000001");
    for (const [frames, samples] of [[[249, 2], 481_920], [[26, 226], 483_840]] as const) {
      expect(measurement(e2Plan(frames)).args.join(" ")).toContain(`end_sample=${samples},asetpts=PTS-STARTPTS,${LOUDNORM}[e5m]`);
    }
  });

  it("T5-51 E3 and E4: the same window law on their own exact T and terminals; upstream graph is a byte prefix", () => {
    for (const [plan, video, audio] of [[e3Plan(), "[vout]", "[aout]"], [e4Plan(), "[vout]", "[mout]"]] as const) {
      const up = upstreamFor(plan);
      const derivation = derive(plan);
      const graph = measurement(plan).args[measurement(plan).args.indexOf("-filter_complex") + 1]!;
      const upstreamGraph = up.args[up.args.indexOf("-filter_complex") + 1]!;
      expect(graph).toBe(`${upstreamGraph};${video}nullsink;${audio}atrim=start_sample=0:end_sample=${derivation.timelineDurationSamples},` +
        `asetpts=PTS-STARTPTS,${LOUDNORM}[e5m]`);
      expect(measurement(plan).args).not.toContain("-t");
    }
  });

  it("T5-52 measurementArgvSha256 masks -i operands by slot only; T, graph or option changes alter it", () => {
    const args = [...measurement(e2Plan([7, 7, 7])).args];
    const moved = args.map((arg, i) => (args[i - 1] === "-i" ? arg.replace("D:\\Busybookie\\Production", "E:\\Other") : arg));
    expect(moved).not.toStrictEqual(args);
    expect(measurementArgvSha256(moved)).toBe(measurementArgvSha256(args));
    expect(measurementArgvSha256(args.map((arg) => arg.replace("end_sample=40320", "end_sample=42240")))).not.toBe(measurementArgvSha256(args));
    expect(measurementArgvSha256(args.map((arg) => (arg === "info" ? "verbose" : arg)))).not.toBe(measurementArgvSha256(args));
  });
});

describe("E5 final rewrite law and gain literal", () => {
  it("T5-53 exactly three edits on E2, E3 and E4; -t (drift included), encoder options and -n stay byte-identical", () => {
    for (const plan of [e2Plan([26, 226]), e3Plan(), e4Plan()]) {
      const up = upstreamFor(plan);
      const derivation = derive(plan);
      const candidate = "D:\\Busybookie\\Production\\exports\\EP02\\audio-mastered\\c.mp4.part";
      const args = applyMasteringRewriteLaw({ upstreamArgs: up.args, audioTerminal: derivation.audioTerminal, gainCentiDb: -350, candidatePath: candidate });
      const changed = args.flatMap((arg, i) => (arg === up.args[i] ? [] : [i]));
      const fc = up.args.indexOf("-filter_complex") + 1;
      const audioMap = up.args.findIndex((arg, i) => up.args[i - 1] === "-map" && arg === derivation.audioTerminal);
      expect(changed).toStrictEqual([fc, audioMap, up.args.length - 1].sort((a, b) => a - b));
      expect(args[fc]).toBe(`${up.args[fc]};${derivation.audioTerminal}volume=-3.5dB:precision=float[e5a]`);
      expect(args[audioMap]).toBe("[e5a]");
      expect(args.at(-1)).toBe(candidate);
      expect(args[args.indexOf("-t") + 1]).toBe(up.args[up.args.indexOf("-t") + 1]);
      expect(args.length).toBe(up.args.length);
    }
    const drift = applyMasteringRewriteLaw({ upstreamArgs: upstreamFor(e2Plan([26, 226])).args, audioTerminal: "[a]", gainCentiDb: 0,
      candidatePath: "D:/x/c.part" });
    expect(drift[drift.indexOf("-t") + 1]).toBe("10.079999999999998");
  });

  it("T5-54 literal gain form: formatCentiDb with the dB suffix, always emitted including 0dB", () => {
    expect(buildMasteringGainFilter(-350)).toBe("volume=-3.5dB:precision=float");
    expect(buildMasteringGainFilter(0)).toBe("volume=0dB:precision=float");
    expect(buildMasteringGainFilter(305)).toBe("volume=3.05dB:precision=float");
    expect(buildMasteringGainFilter(-305)).toBe("volume=-3.05dB:precision=float");
    expect(buildMasteringGainFilter(1200)).toBe("volume=12dB:precision=float");
    expect(buildMasteringGainFilter(-9600)).toBe("volume=-96dB:precision=float");
    expect(() => buildMasteringGainFilter(1201)).toThrow();
    expect(() => buildMasteringGainFilter(0.5)).toThrow();
    const zero = applyMasteringRewriteLaw({ upstreamArgs: upstreamFor(e2Plan()).args, audioTerminal: "[a]", gainCentiDb: 0, candidatePath: "D:/x/c.part" });
    expect(zero[zero.indexOf("-filter_complex") + 1]).toMatch(/;\[a\]volume=0dB:precision=float\[e5a\]$/);
  });

  it("T5-55 no dynamics in any final graph; reserved labels and malformed rewrites fail closed", () => {
    for (const plan of [e2Plan(), e3Plan(), e4Plan()]) {
      const up = upstreamFor(plan);
      const args = applyMasteringRewriteLaw({ upstreamArgs: up.args, audioTerminal: derive(plan).audioTerminal, gainCentiDb: 100, candidatePath: "D:/x/c.part" });
      const graph = args[args.indexOf("-filter_complex") + 1]!;
      for (const name of E5_FORBIDDEN_FINAL_GRAPH_FILTERS) expect(graph, name).not.toMatch(new RegExp(`(^|[\\],;])${name}(=|,|;|\\[|$)`));
    }
    const up = upstreamFor(e2Plan());
    const fc = up.args.indexOf("-filter_complex") + 1;
    const reserved = up.args.map((arg, i) => (i === fc ? `${arg};[a]anull[e5a]` : arg));
    expect(() => applyMasteringRewriteLaw({ upstreamArgs: reserved, audioTerminal: "[a]", gainCentiDb: 0, candidatePath: "D:/x/c.part" })).toThrow(/reserved/);
    expect(() => applyMasteringRewriteLaw({ upstreamArgs: up.args, audioTerminal: "[mout]", gainCentiDb: 0, candidatePath: "D:/x/c.part" })).toThrow();
    expect(() => applyMasteringRewriteLaw({ upstreamArgs: up.args, audioTerminal: "[a]", gainCentiDb: 0, candidatePath: "relative.part" })).toThrow();
    expect(E5_FORBIDDEN_FINAL_GRAPH_FILTERS).toContain("alimiter");
    expect(E5_FORBIDDEN_FINAL_GRAPH_FILTERS).toContain("loudnorm");
  });
});

describe("E5 post-encode QC commands", () => {
  it("T5-56 probe, decode and loudness goldens; attempt hashes mask the media and PCM paths", () => {
    expect(buildPostEncodeProbeCommand({ ffprobeExecutable: "ffprobe", mediaPath: MEDIA }).args).toStrictEqual(["-v", "error", "-count_frames",
      "-show_optional_fields", "always", "-show_entries", "format=format_name,duration,size,bit_rate,nb_streams:stream=index,codec_type," +
      "codec_name,profile,width,height,pix_fmt,r_frame_rate,avg_frame_rate,sample_rate,channels,channel_layout,bit_rate,nb_read_frames",
      "-of", "json", MEDIA]);
    expect(buildPostEncodeDecodeCommand({ ffmpegExecutable: "ffmpeg", mediaPath: MEDIA, qcPcmPath: PCM }).args).toStrictEqual(["-hide_banner",
      "-nostdin", "-loglevel", "error", "-n", "-i", MEDIA, "-map", "0:a:0", "-c:a", "pcm_f32le", "-f", "f32le", PCM]);
    expect(buildPostEncodeLoudnessCommand({ ffmpegExecutable: "ffmpeg", mediaPath: MEDIA }).args).toStrictEqual(["-hide_banner", "-nostdin",
      "-nostats", "-loglevel", "info", "-i", MEDIA, "-map", "0:a:0", "-af", LOUDNORM, "-f", "null", "-"]);
    const other = "E:/elsewhere/c.part";
    expect(qcAttemptArgvSha256(buildPostEncodeLoudnessCommand({ ffmpegExecutable: "ffmpeg", mediaPath: other }).args, other))
      .toBe(qcAttemptArgvSha256(buildPostEncodeLoudnessCommand({ ffmpegExecutable: "C:/tools/ffmpeg.exe", mediaPath: MEDIA }).args, MEDIA));
    expect(() => buildPostEncodeDecodeCommand({ ffmpegExecutable: "ffmpeg", mediaPath: MEDIA, qcPcmPath: MEDIA })).toThrow();
    expect(() => buildPostEncodeProbeCommand({ ffprobeExecutable: " ", mediaPath: MEDIA })).toThrow();
  });
});
