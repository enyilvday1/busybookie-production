import { describe, expect, it } from "vitest";
import { hashAudioDeliveryPolicyV1 } from "../src/editorial/audioDeliveryPolicy.schema.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildPreMasterLoudnessEvidence, computeQcAuthorityKey, E5_UPSTREAM_RECORD_BINDING_BY_ROUTE, hashPostEncodeAudioQcEvidenceV1,
  parsePostEncodeAudioQcEvidenceV1, toolchainEvidenceKey,
} from "../src/editorial/audioMasteringEvidence.schema.js";
import { buildAudioMasteringPlan, hashMasteringPlanV1, runAudioMasteringPreflight } from "../src/editorial/buildAudioMasteringPlan.js";
import { canonicalEditorialJson } from "../src/editorial/canonicalizeEditorialPlan.js";
import {
  assertCandidatePromotable, buildMasteredMediaRecord, buildPolicyQcAcceptanceRecord, canReuseMeasureOnlyEvidence, checkCandidatePromotable,
  checkQcEvidenceAgainstRequest, deriveE5QcRequestAuthority, deriveE5QcResult, derivePostEncodeAudioQcEvidence, E5_RECOVERY_ACTIONS,
  findPolicyQcAcceptance, hashE5MasteredMediaRecordV1, parseE5MasteredMediaRecordV1, recoveryAction, verifyPolicyQcAcceptance,
} from "../src/editorial/validatePostEncodeAudioQc.js";
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

const evidenceOf = (options: AnyRecord = {}) => derivePostEncodeAudioQcEvidence(qcObservations(options) as never) as AnyRecord;
const metadataOnly = (streams: AnyRecord[], extra: AnyRecord = {}) => evidenceOf({ streams, decode: "ABSENT", measurement: "ABSENT", ...extra });
const summary = (evidence: AnyRecord) => [evidence.stage, evidence.terminalReason, evidence.failures];
// Real plan-bound requests (Step 1088): mastering plan + current EditorialPlan 3.0 + media root.
function masteringRequest(plan: unknown, mode: "MEASURE_ONLY" | "NORMALIZE_STATIC", deliveryPolicy: unknown = policy()) {
  const up = upstreamFor(plan);
  const derivation = derive(plan);
  const key = toolchainEvidenceKey(TOOLCHAIN);
  const pre = buildPreMasterLoudnessEvidence({ derivation, upstreamArgs: up.args, toolchainEvidenceKey: key, stderr: loudnormStderr() });
  if (!pre.ok) throw new Error("pre-master");
  const built = buildAudioMasteringPlan({ decisions: decisionsFor(plan, mode, deliveryPolicy), plan, mediaRoot: MEDIA_ROOT, upstreamArgs: up.args,
    ...upstreamExtras(up), toolchainEvidenceKey: key, ...(mode === "NORMALIZE_STATIC" ? { preMasterEvidence: pre.evidence } : {}) });
  if (!built.ok) throw new Error(`plan: ${built.reasons.join(",")}`);
  const masteringPlan = built.masteringPlan as AnyRecord;
  return { request: { masteringPlan, plan, mediaRoot: MEDIA_ROOT }, masteringPlan, derivation, up, key, pre: pre.evidence };
}
const STRICT = () => policy({ integratedToleranceCentiLu: 20, truePeakCeilingCentiDbtp: -300 });
const candidateSubject = (masteringPlan: AnyRecord) => ({ kind: "E5_CANDIDATE", e5RenderKey: masteringPlan.renderKey });
const upstreamSubject = (derivation: E5UpstreamDerivation, binding?: string) => ({ kind: "UPSTREAM_MEDIA", route: derivation.route,
  upstreamRenderKey: derivation.upstream.renderKey,
  upstreamRecordBinding: binding ?? (derivation.route === "E2_ROUGH_CUT" ? "E2_RENDER_RECORD_VERIFIED" : "NO_UPSTREAM_RECORD_LIFECYCLE") });
const promoteInput = (request: AnyRecord, evidence: AnyRecord) => ({ request: request as never, evidence, qcResult: deriveE5QcResult(evidence),
  candidateSha256: SHA("b"), candidateBytes: 4096 });
const sourceOf = (name: string) => readFileSync(fileURLToPath(new URL(`../src/editorial/${name}`, import.meta.url)), "utf8");
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(name);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("E5 post-encode QC: PASS and process stages", () => {
  it("T5-57 PASS: MEASURED with every attempt successful; bitrate, LRA and container duration informational only", () => {
    const evidence = evidenceOf({ streams: [VIDEO_STREAM(0, 21), AUDIO_STREAM(1, { bit_rate: "96000" })] });
    expect(summary(evidence)).toStrictEqual(["MEASURED", "PASS", []]);
    expect(evidence.status).toBe("PASS");
    expect(Object.keys(evidence).sort()).toStrictEqual(["decodeAttempt", "decoded", "evidenceType", "evidenceVersion", "expected", "failures",
      "loudness", "measurementAttempt", "mediaBytes", "mediaSha256", "policySha256", "probe", "probeAttempt", "stage", "status", "subject",
      "terminalReason", "toolchainEvidenceKey"]);
    const result = deriveE5QcResult(evidence);
    expect(result).toMatchObject({ status: "PASS", failures: [], evidenceSha256: hashPostEncodeAudioQcEvidenceV1(evidence),
      informational: { reportedBitRate: 96000, loudnessRangeCentiLu: 520, maxAbsSampleF32Bits: 0x3f000000, formatDurationText: "0.840000" } });
    expect(canonicalEditorialJson(evidence)).not.toMatch(/Busybookie|D:|\.part|ffprobe|ffmpeg/);
  });

  it("T5-58 PROBE_FAILED: launch, nonzero exit, invalid UTF-8, malformed JSON and schema mismatch; later stages absent", () => {
    const later = { decode: "ABSENT", measurement: "ABSENT" };
    const cases: [AnyRecord, string, number | null][] = [
      [{ probeExit: null, probeStdout: null }, "PROBE_PROCESS_LAUNCH_FAILURE", null], [{ probeExit: 1, probeStdout: null }, "PROBE_NONZERO_EXIT", 1],
      [{ probeStdout: new Uint8Array([0x7b, 0xff]) }, "PROBE_OUTPUT_INVALID_UTF8", 0], [{ probeStdout: new TextEncoder().encode("{") }, "PROBE_OUTPUT_MALFORMED_JSON", 0],
      [{ probeStdout: new TextEncoder().encode("{\"streams\":{}}") }, "PROBE_OUTPUT_SCHEMA_MISMATCH", 0],
    ];
    for (const [options, failureCode, exitCode] of cases) {
      const evidence = evidenceOf({ ...options, ...later });
      expect(summary(evidence), failureCode).toStrictEqual(["PROBE_FAILED", "PROBE_FAILURE", ["PROBE_FAILURE"]]);
      expect(evidence.probeAttempt).toMatchObject({ exitCode, failureCode });
      expect(Object.keys(evidence)).not.toContain("probe");
      expect(deriveE5QcResult(evidence).informational).toStrictEqual({ reportedBitRate: null, loudnessRangeCentiLu: null,
        maxAbsSampleF32Bits: null, formatDurationText: null });
    }
    expect(() => evidenceOf({ probeExit: 1, probeStdout: null })).toThrow(/no step runs/);
  });

  it("T5-59 DECODE_FAILED: launch, nonzero exit, missing output and non-frame-aligned output", () => {
    for (const [options, failureCode] of [[{ decodeExit: null }, "DECODE_PROCESS_LAUNCH_FAILURE"], [{ decodeExit: 1 }, "DECODE_NONZERO_EXIT"],
      [{ decodeOutput: null }, "DECODE_OUTPUT_MISSING"], [{ decodeOutput: { byteLength: 12, nonFiniteSampleCount: 0, maxAbsSampleF32Bits: 0 } },
        "DECODE_OUTPUT_NOT_FRAME_ALIGNED"]] as const) {
      const evidence = evidenceOf({ ...options, measurement: "ABSENT" });
      expect(summary(evidence), failureCode).toStrictEqual(["DECODE_FAILED", "DECODE_FAILURE", ["DECODE_FAILURE"]]);
      expect(evidence.decodeAttempt.failureCode).toBe(failureCode);
      expect(Object.keys(evidence)).not.toContain("decoded");
      expect(Object.keys(evidence)).toContain("probe");
    }
  });

  it("T5-60 MEASUREMENT_FAILED is reserved for process/parser failure: exactly [\"MEASUREMENT_FAILURE\"], decoded facts kept", () => {
    const cases: [AnyRecord, string][] = [[{ measurementExit: null, stderr: null }, "MEASUREMENT_PROCESS_LAUNCH_FAILURE"],
      [{ measurementExit: 3, stderr: null }, "MEASUREMENT_NONZERO_EXIT"], [{ stderr: new TextEncoder().encode("x") }, "RESULT_BLOCK_MISSING"],
      [{ stderr: loudnormStderr({ i: "nan" }) }, "NON_FINITE_MEASUREMENT"], [{ stderr: loudnormStderr({ tp: "-inf" }) }, "MEASUREMENT_INCONSISTENT"],
      [{ stderr: new TextEncoder().encode("a\rb") }, "INVALID_LINE_ENDING"], [{ stderr: new Uint8Array([0xc3]) }, "INVALID_UTF8"]];
    for (const [options, failureCode] of cases) {
      const evidence = evidenceOf(options);
      expect(summary(evidence), failureCode).toStrictEqual(["MEASUREMENT_FAILED", "MEASUREMENT_FAILURE", ["MEASUREMENT_FAILURE"]]);
      expect(evidence.measurementAttempt.failureCode).toBe(failureCode);
      expect(Object.keys(evidence)).not.toContain("loudness");
      expect(evidence.decoded.sampleFrameCount).toBe(40_320);
    }
    const withMismatch = evidenceOf({ stderr: new TextEncoder().encode("x"), decodedSamples: 40_000, nonFinite: 3 });
    expect(summary(withMismatch)).toStrictEqual(["MEASUREMENT_FAILED", "MEASUREMENT_FAILURE", ["MEASUREMENT_FAILURE"]]);
    expect(withMismatch.decoded).toMatchObject({ sampleFrameCount: 40_000, nonFiniteSampleCount: 3 });
  });
});

describe("E5 post-encode QC: m1085-1 stream selection and cardinality (Step 1086 A1-A10)", () => {
  it("T5-61 cardinality precedence: MISSING_AUDIO first, then UNEXPECTED_STREAMS; per-stream gates never run after it", () => {
    const v = (i: number, o: AnyRecord = {}) => VIDEO_STREAM(i, 21, o);
    const a = (i: number, o: AnyRecord = {}) => AUDIO_STREAM(i, o);
    const other = (i: number, type: string) => ({ index: i, codec_type: type, codec_name: type === "subtitle" ? "mov_text" : "bin_data" });
    const cases: [string, AnyRecord[], string][] = [
      ["1v/0a", [v(0)], "MISSING_AUDIO"], ["2v/0a", [v(0), v(1)], "MISSING_AUDIO"], ["0v/0a", [other(0, "data")], "MISSING_AUDIO"],
      ["0v/1a", [a(0)], "UNEXPECTED_STREAMS"], ["2v/1a", [v(0), v(1), a(2)], "UNEXPECTED_STREAMS"], ["1v/2a", [v(0), a(1), a(2)], "UNEXPECTED_STREAMS"],
      ["1v/1a/subtitle", [v(0), a(1), other(2, "subtitle")], "UNEXPECTED_STREAMS"], ["1v/1a/data", [v(0), a(1), other(2, "data")], "UNEXPECTED_STREAMS"],
      ["2v/1a wrong codec", [v(0, { codec_name: "hevc" }), v(1), a(2, { codec_name: "mp3", sample_rate: "44100" })], "UNEXPECTED_STREAMS"],
      ["0a with bad video", [v(0, { width: 640 })], "MISSING_AUDIO"],
    ];
    for (const [name, streams, reason] of cases) {
      expect(summary(metadataOnly(streams)), name).toStrictEqual(["METADATA_REJECTED", reason, [reason]]);
    }
    const probe = metadataOnly([v(0)]).probe;
    expect(probe).toMatchObject({ videoStreamCount: 1, audioStreamCount: 0, otherStreamCount: 0, audio: null });
    expect(probe.video).toMatchObject({ codecName: "h264", nbReadFrames: 21 });
    expect(metadataOnly([a(0)]).probe).toMatchObject({ video: null, audio: { codecName: "aac" } });
    expect(metadataOnly([v(0), a(1), other(2, "subtitle"), other(3, "attachment")]).probe.otherStreamCount).toBe(2);
    expect(() => evidenceOf({ streams: [v(0)] })).toThrow(/no step runs/);
  });

  it("T5-62 lowest numeric index selection; reordering the raw streams array never changes the evidence hash", () => {
    const streams = [VIDEO_STREAM(3, 21, { width: 1280 }), AUDIO_STREAM(1, { channels: 6 }), VIDEO_STREAM(0, 21), AUDIO_STREAM(2, { codec_name: "opus" })];
    const forward = metadataOnly(streams);
    for (const permutation of [[...streams].reverse(), [streams[2]!, streams[0]!, streams[3]!, streams[1]!], [streams[1]!, streams[3]!, streams[0]!, streams[2]!]]) {
      const permuted = metadataOnly(permutation);
      expect(permuted.probe).toStrictEqual(forward.probe);
      expect(summary(permuted)).toStrictEqual(summary(forward));
      expect(hashPostEncodeAudioQcEvidenceV1(permuted)).toBe(hashPostEncodeAudioQcEvidenceV1(forward));
    }
    expect(forward.probe.video.width).toBe(1920);
    expect(forward.probe.audio.channels).toBe(6);
    expect(forward.probe).toMatchObject({ videoStreamCount: 2, audioStreamCount: 2, otherStreamCount: 0 });
    expect(summary(forward)).toStrictEqual(["METADATA_REJECTED", "UNEXPECTED_STREAMS", ["UNEXPECTED_STREAMS"]]);
    const valid = [VIDEO_STREAM(0, 21), AUDIO_STREAM(1)];
    expect(hashPostEncodeAudioQcEvidenceV1(evidenceOf({ streams: [...valid].reverse() }))).toBe(hashPostEncodeAudioQcEvidenceV1(evidenceOf({ streams: valid })));
  });

  it("T5-63 missing, negative, non-integer, string or duplicate stream indices are PROBE_OUTPUT_SCHEMA_MISMATCH", () => {
    const { index: _i, ...noIndex } = AUDIO_STREAM(1);
    for (const [name, streams] of [["missing", [VIDEO_STREAM(0, 21), noIndex]], ["negative", [VIDEO_STREAM(-1, 21), AUDIO_STREAM(1)]],
      ["fraction", [VIDEO_STREAM(0.5, 21), AUDIO_STREAM(1)]], ["string", [VIDEO_STREAM(0, 21), { ...AUDIO_STREAM(1), index: "1" }]],
      ["duplicate", [VIDEO_STREAM(0, 21), AUDIO_STREAM(0)]], ["no codec_type", [VIDEO_STREAM(0, 21), { index: 1 }]],
      ["selected video nb_read_frames N/A", [VIDEO_STREAM(0, 21, { nb_read_frames: "N/A" }), AUDIO_STREAM(1)]],
      ["selected audio sample_rate missing", [VIDEO_STREAM(0, 21), { ...AUDIO_STREAM(1), sample_rate: undefined }]]] as const) {
      const evidence = metadataOnly(streams as unknown as AnyRecord[]);
      expect(summary(evidence), name).toStrictEqual(["PROBE_FAILED", "PROBE_FAILURE", ["PROBE_FAILURE"]]);
      expect(evidence.probeAttempt.failureCode, name).toBe("PROBE_OUTPUT_SCHEMA_MISMATCH");
    }
    expect(summary(metadataOnly([VIDEO_STREAM(0, 21), AUDIO_STREAM(1), VIDEO_STREAM(2, 21, { nb_read_frames: "N/A" })])))
      .toStrictEqual(["METADATA_REJECTED", "UNEXPECTED_STREAMS", ["UNEXPECTED_STREAMS"]]);
  });
});

describe("E5 post-encode QC: metadata, duration and loudness gates", () => {
  it("T5-64 per-stream metadata gates run only for exactly 1 video + 1 audio; complete sorted set; precedence terminal", () => {
    const gate = (video: AnyRecord, audio: AnyRecord) => summary(metadataOnly([VIDEO_STREAM(0, 21, video), AUDIO_STREAM(1, audio)]));
    expect(gate({}, { codec_name: "mp3" })).toStrictEqual(["METADATA_REJECTED", "WRONG_CODEC", ["WRONG_CODEC"]]);
    expect(gate({}, { sample_rate: "44100" })).toStrictEqual(["METADATA_REJECTED", "WRONG_SAMPLE_RATE", ["WRONG_SAMPLE_RATE"]]);
    expect(gate({}, { channels: 1, channel_layout: "mono" })).toStrictEqual(["METADATA_REJECTED", "WRONG_CHANNEL_COUNT",
      ["WRONG_CHANNEL_COUNT", "WRONG_CHANNEL_LAYOUT"]]);
    expect(gate({}, { channel_layout: "N/A" })).toStrictEqual(["METADATA_REJECTED", "WRONG_CHANNEL_LAYOUT", ["WRONG_CHANNEL_LAYOUT"]]);
    for (const video of [{ profile: "Main" }, { width: 1280 }, { pix_fmt: "yuv444p" }, { r_frame_rate: "30/1" }, { codec_name: "hevc" }, { nb_read_frames: "20" }]) {
      expect(gate(video, {}), JSON.stringify(video)).toStrictEqual(["METADATA_REJECTED", "VIDEO_CONTRACT_MISMATCH", ["VIDEO_CONTRACT_MISMATCH"]]);
    }
    expect(gate({ nb_read_frames: "22" }, { codec_name: "mp3", sample_rate: "44100" })).toStrictEqual(["METADATA_REJECTED", "WRONG_CODEC",
      ["VIDEO_CONTRACT_MISMATCH", "WRONG_CODEC", "WRONG_SAMPLE_RATE"]]);
  });

  it("T5-65 duration taxonomy: video frames -> METADATA_REJECTED/VIDEO_CONTRACT_MISMATCH; audio samples -> MEASURED/DURATION_MISMATCH", () => {
    const video = metadataOnly([VIDEO_STREAM(0, 20), AUDIO_STREAM(1)]);
    expect(summary(video)).toStrictEqual(["METADATA_REJECTED", "VIDEO_CONTRACT_MISMATCH", ["VIDEO_CONTRACT_MISMATCH"]]);
    expect(Object.keys(video)).not.toContain("decoded");
    for (const decodedSamples of [40_319, 40_321, 40_320 + 1920]) {
      const audio = evidenceOf({ decodedSamples });
      expect(summary(audio), String(decodedSamples)).toStrictEqual(["MEASURED", "DURATION_MISMATCH", ["DURATION_MISMATCH"]]);
      expect(audio.loudness).toMatchObject({ class: "MEASURABLE", integratedCentiLufs: -1620 });
    }
    const both = evidenceOf({ decodedSamples: 1, stderr: loudnormStderr({ i: "-30.00", tp: "-0.50" }), nonFinite: 2 });
    expect(summary(both)).toStrictEqual(["MEASURED", "DURATION_MISMATCH",
      ["DURATION_MISMATCH", "LOUDNESS_OUT_OF_RANGE", "NON_FINITE_AUDIO", "TRUE_PEAK_EXCEEDED"]]);
  });

  it("T5-66 loudness, true-peak, silence and non-finite gates; exact integer boundaries; no gates without a policy", () => {
    const measured = (values: Loudness, extra: AnyRecord = {}) => summary(evidenceOf({ stderr: loudnormStderr(values), ...extra }));
    expect(measured({ i: "-17.00", tp: "-1.00" })).toStrictEqual(["MEASURED", "PASS", []]);
    expect(measured({ i: "-15.00", tp: "-1.00" })).toStrictEqual(["MEASURED", "PASS", []]);
    expect(measured({ i: "-17.01" })).toStrictEqual(["MEASURED", "LOUDNESS_OUT_OF_RANGE", ["LOUDNESS_OUT_OF_RANGE"]]);
    expect(measured({ i: "-14.99" })).toStrictEqual(["MEASURED", "LOUDNESS_OUT_OF_RANGE", ["LOUDNESS_OUT_OF_RANGE"]]);
    expect(measured({ i: "-16.00", tp: "-0.99" })).toStrictEqual(["MEASURED", "TRUE_PEAK_EXCEEDED", ["TRUE_PEAK_EXCEEDED"]]);
    expect(measured({ i: "-inf", tp: "-inf", thresh: "-inf" })).toStrictEqual(["MEASURED", "LOUDNESS_UNDEFINED_SILENCE", ["LOUDNESS_UNDEFINED_SILENCE"]]);
    expect(measured({ i: "-16.00" }, { nonFinite: 1 })).toStrictEqual(["MEASURED", "NON_FINITE_AUDIO", ["NON_FINITE_AUDIO"]]);
    const upstream = { kind: "UPSTREAM_MEDIA", route: "E3_EDIT", upstreamRenderKey: SHA("4"), upstreamRecordBinding: "NO_UPSTREAM_RECORD_LIFECYCLE" };
    expect(measured({ i: "-40.00", tp: "-0.10" }, { policy: null, subject: upstream })).toStrictEqual(["MEASURED", "PASS", []]);
    expect(measured({ i: "-inf", tp: "-inf", thresh: "-inf" }, { policy: null, subject: upstream })).toStrictEqual(["MEASURED", "PASS", []]);
    expect(measured({ i: "-40.00" }, { subject: upstream })).toStrictEqual(["MEASURED", "LOUDNESS_OUT_OF_RANGE", ["LOUDNESS_OUT_OF_RANGE"]]);
    expect(measured({ i: "-16.00" }, { policy: null, subject: upstream, decodedSamples: 3 })).toStrictEqual(["MEASURED", "DURATION_MISMATCH",
      ["DURATION_MISMATCH"]]);
    expect(() => evidenceOf({ policy: null })).toThrow(/policy/);
  });

  it("T5-67 canonical evidence hashes: deterministic per terminal reason, distinct across reasons", () => {
    const scenarios: Record<string, AnyRecord> = {
      PASS: {}, PROBE_FAILURE: { probeExit: 1, probeStdout: null, decode: "ABSENT", measurement: "ABSENT" },
      MISSING_AUDIO: { streams: [VIDEO_STREAM(0, 21)], decode: "ABSENT", measurement: "ABSENT" },
      UNEXPECTED_STREAMS: { streams: [VIDEO_STREAM(0, 21), AUDIO_STREAM(1), AUDIO_STREAM(2)], decode: "ABSENT", measurement: "ABSENT" },
      WRONG_CODEC: { streams: [VIDEO_STREAM(0, 21), AUDIO_STREAM(1, { codec_name: "mp3" })], decode: "ABSENT", measurement: "ABSENT" },
      WRONG_SAMPLE_RATE: { streams: [VIDEO_STREAM(0, 21), AUDIO_STREAM(1, { sample_rate: "44100" })], decode: "ABSENT", measurement: "ABSENT" },
      WRONG_CHANNEL_COUNT: { streams: [VIDEO_STREAM(0, 21), AUDIO_STREAM(1, { channels: 6 })], decode: "ABSENT", measurement: "ABSENT" },
      WRONG_CHANNEL_LAYOUT: { streams: [VIDEO_STREAM(0, 21), AUDIO_STREAM(1, { channel_layout: "downmix" })], decode: "ABSENT", measurement: "ABSENT" },
      VIDEO_CONTRACT_MISMATCH: { streams: [VIDEO_STREAM(0, 22), AUDIO_STREAM(1)], decode: "ABSENT", measurement: "ABSENT" },
      DECODE_FAILURE: { decodeExit: 1, measurement: "ABSENT" }, MEASUREMENT_FAILURE: { measurementExit: 1, stderr: null },
      DURATION_MISMATCH: { decodedSamples: 40_000 }, NON_FINITE_AUDIO: { nonFinite: 1 },
      LOUDNESS_UNDEFINED_SILENCE: { stderr: loudnormStderr({ i: "-inf", tp: "-inf", thresh: "-inf" }) },
      LOUDNESS_OUT_OF_RANGE: { stderr: loudnormStderr({ i: "-20.00", tp: "-6.00" }) }, TRUE_PEAK_EXCEEDED: { stderr: loudnormStderr({ i: "-16.00", tp: "0.00" }) },
    };
    const hashes = new Map<string, string>();
    for (const [reason, options] of Object.entries(scenarios)) {
      const first = evidenceOf(options);
      expect(first.terminalReason, reason).toBe(reason);
      const hash = hashPostEncodeAudioQcEvidenceV1(first);
      expect(hashPostEncodeAudioQcEvidenceV1(evidenceOf(options))).toBe(hash);
      expect(hashPostEncodeAudioQcEvidenceV1(JSON.parse(JSON.stringify(first)))).toBe(hash);
      hashes.set(reason, hash);
    }
    expect(new Set(hashes.values()).size).toBe(Object.keys(scenarios).length);
    expect(hashPostEncodeAudioQcEvidenceV1(evidenceOf({ mediaSha256: SHA("c") }))).not.toBe(hashes.get("PASS"));
    expect(hashPostEncodeAudioQcEvidenceV1(evidenceOf({ policy: policy({ integratedToleranceCentiLu: 99 }) }))).not.toBe(hashes.get("PASS"));
    expect(hashPostEncodeAudioQcEvidenceV1(evidenceOf({ stderr: loudnormStderr({ i: "-16.21", tp: "-2.10" }) }))).not.toBe(hashes.get("PASS"));
  });

  it("T5-68 reuse-time verdicts: EVIDENCE_BINDING_MISMATCH / TOOLCHAIN_MISMATCH only through re-verification, never fresh", () => {
    const evidence = evidenceOf();
    expect(deriveE5QcResult(evidence).failures).toStrictEqual([]);
    expect(deriveE5QcResult(evidence, { evidenceBindingMismatch: true, toolchainMismatch: true })).toMatchObject({ status: "FAIL",
      failures: ["EVIDENCE_BINDING_MISMATCH", "TOOLCHAIN_MISMATCH"] });
    expect(() => parsePostEncodeAudioQcEvidenceV1({ ...evidence, status: "FAIL", failures: ["TOOLCHAIN_MISMATCH"], terminalReason: "TOOLCHAIN_MISMATCH" })).toThrow();
  });
});

describe("E5 promotion, records, policy-specific QC reuse and recovery", () => {
  it("T5-69 promotion requires a fresh PASS over the exact candidate bytes, bound to the current mastering plan", () => {
    const { request, masteringPlan } = masteringRequest(e2Plan([7, 7, 7]), "NORMALIZE_STATIC");
    const evidence = evidenceOf({ subject: candidateSubject(masteringPlan) });
    expect(() => assertCandidatePromotable(promoteInput(request, evidence))).not.toThrow();
    expect(() => assertCandidatePromotable({ ...promoteInput(request, evidence), candidateSha256: SHA("c") })).toThrow(/bytes/);
    expect(() => assertCandidatePromotable({ ...promoteInput(request, evidence), candidateBytes: 4095 })).toThrow(/bytes/);
    const otherRender = evidenceOf({ subject: { kind: "E5_CANDIDATE", e5RenderKey: SHA("0") } });
    expect(() => assertCandidatePromotable(promoteInput(request, otherRender))).toThrow(/EVIDENCE_BINDING_MISMATCH/);
    const failed = evidenceOf({ subject: candidateSubject(masteringPlan), decodedSamples: 1 });
    expect(() => assertCandidatePromotable(promoteInput(request, failed))).toThrow(/never promoted/);
    expect(() => assertCandidatePromotable({ ...promoteInput(request, evidence), qcResult: { ...deriveE5QcResult(evidence),
      informational: { reportedBitRate: 1, loudnessRangeCentiLu: null, maxAbsSampleF32Bits: null, formatDurationText: null } } })).toThrow(/derived/);
    const measureOnly = masteringRequest(e2Plan([7, 7, 7]), "MEASURE_ONLY", null);
    const upstreamEvidence = evidenceOf({ subject: upstreamSubject(measureOnly.derivation), policy: null });
    expect(() => assertCandidatePromotable(promoteInput(measureOnly.request, upstreamEvidence))).toThrow(/NORMALIZE_STATIC/);
  });

  it("T5-70 policy A PASS never satisfies policy B; B re-QCs the same media without re-render; B FAIL leaves A intact", () => {
    const plan = e2Plan([7, 7, 7]);
    const a = masteringRequest(plan, "NORMALIZE_STATIC", policy());
    const b = masteringRequest(plan, "NORMALIZE_STATIC", STRICT());
    expect(b.masteringPlan.renderKey).toBe(a.masteringPlan.renderKey);
    const subject = candidateSubject(a.masteringPlan);
    const evidenceA = evidenceOf({ subject, policy: policy() });
    const acceptanceA = buildPolicyQcAcceptanceRecord({ request: a.request as never, evidence: evidenceA });
    expect(acceptanceA.masteringPlanSha256).toBe(hashMasteringPlanV1(a.masteringPlan));
    const media = buildMasteredMediaRecord({ request: a.request as never, acceptance: acceptanceA, evidence: evidenceA });
    expect(media).toMatchObject({ status: "MASTERED", renderKey: a.masteringPlan.renderKey, artifact: { sha256: SHA("b"), bytes: 4096 },
      promotingQcAuthorityKey: acceptanceA.qcAuthorityKey });
    expect(media.renderIdentity).toStrictEqual(a.masteringPlan.renderIdentity);
    expect(canonicalEditorialJson(media)).not.toMatch(/policySha256|D:/);
    const query = (request: AnyRecord, toolchain = SHA("d")) => ({ request: request as never, mediaSha256: SHA("b"), mediaBytes: 4096,
      toolchainEvidenceKey: toolchain });
    expect(findPolicyQcAcceptance([acceptanceA], query(a.request))).toStrictEqual(acceptanceA);
    expect(findPolicyQcAcceptance([acceptanceA], query(b.request))).toBeNull();
    const finalExists = (request: AnyRecord, acceptances: { acceptance: unknown; evidence: unknown }[]) => recoveryAction({ case: "E_FINAL_EXISTS", request: request as never,
      mediaRecord: media, currentMediaSha256: SHA("b"), currentMediaBytes: 4096, toolchainEvidenceKey: SHA("d"), acceptances });
    expect(finalExists(b.request, [{ acceptance: acceptanceA, evidence: evidenceA }])).toStrictEqual({ kind: "ACTION", action: "REQC_EXISTING_MEDIA" });
    const evidenceB = evidenceOf({ subject, policy: STRICT() });
    expect(summary(evidenceB)).toStrictEqual(["MEASURED", "TRUE_PEAK_EXCEEDED", ["TRUE_PEAK_EXCEEDED"]]);
    expect(evidenceB.mediaSha256).toBe(evidenceA.mediaSha256);
    const acceptanceB = buildPolicyQcAcceptanceRecord({ request: b.request as never, evidence: evidenceB });
    expect(acceptanceB.qcAuthorityKey).not.toBe(acceptanceA.qcAuthorityKey);
    expect(acceptanceB.qcResult.status).toBe("FAIL");
    expect(() => buildMasteredMediaRecord({ request: b.request as never, acceptance: acceptanceB, evidence: evidenceB })).toThrow(/PASS/);
    const both = [{ acceptance: acceptanceA, evidence: evidenceA }, { acceptance: acceptanceB, evidence: evidenceB }];
    expect(finalExists(b.request, both)).toStrictEqual({ kind: "FAIL_CLOSED", reason: "QC_ACCEPTANCE_FAILED" });
    expect(finalExists(a.request, both)).toStrictEqual({ kind: "ACTION", action: "REUSE" });
    expect(findPolicyQcAcceptance([acceptanceA, acceptanceB], query(a.request))).toStrictEqual(acceptanceA);
    expect(verifyPolicyQcAcceptance({ request: a.request as never, acceptance: acceptanceA, evidence: evidenceA })).toBe(true);
    expect(verifyPolicyQcAcceptance({ request: a.request as never, acceptance: acceptanceA, evidence: evidenceB })).toBe(false);
    expect(findPolicyQcAcceptance([acceptanceA], query(a.request, SHA("0")))).toBeNull();
    expect(hashE5MasteredMediaRecordV1(media)).toBe(hashE5MasteredMediaRecordV1(parseE5MasteredMediaRecordV1(JSON.parse(JSON.stringify(media)))));
    const c = masteringRequest(plan, "NORMALIZE_STATIC", policy({ policyId: "audio-delivery:loose", integratedToleranceCentiLu: 300 }));
    const acceptanceC = buildPolicyQcAcceptanceRecord({ request: c.request as never, evidence: evidenceOf({ subject, policy: policy({
      policyId: "audio-delivery:loose", integratedToleranceCentiLu: 300 }) }) });
    expect(acceptanceC.qcResult.status).toBe("PASS");
    expect(acceptanceC.qcAuthorityKey).not.toBe(acceptanceA.qcAuthorityKey);
  });

  it("T5-71 MEASURE_ONLY evidence is reused only under the current request with re-hash, toolchain and attestation, never by renderKey alone", () => {
    const plan = e2Plan();
    const m = masteringRequest(plan, "MEASURE_ONLY", null);
    const frames = m.derivation.timelineDurationFrames;
    const evidence = evidenceOf({ subject: upstreamSubject(m.derivation), policy: null, frames });
    const attestation = { route: "E2_ROUGH_CUT", renderKey: m.derivation.upstream.renderKey, artifactSha256: SHA("b"), artifactBytes: 4096 };
    const current = { request: m.request as never, evidence, currentMediaSha256: SHA("b"), currentMediaBytes: 4096,
      currentToolchainEvidenceKey: SHA("d"), attestation };
    expect(canReuseMeasureOnlyEvidence(current)).toBe(true);
    for (const change of [{ currentMediaSha256: SHA("c") }, { currentMediaBytes: 4097 }, { currentToolchainEvidenceKey: SHA("0") },
      { attestation: null }, { attestation: { ...attestation, artifactSha256: SHA("c") } },
      { request: masteringRequest(plan, "MEASURE_ONLY", policy()).request as never },
      { request: { ...m.request, plan: e2Plan([100, 101]) } as never }]) {
      expect(canReuseMeasureOnlyEvidence({ ...current, ...change }), JSON.stringify(Object.keys(change))).toBe(false);
    }
    expect(canReuseMeasureOnlyEvidence({ ...current, evidence: evidenceOf() })).toBe(false);
  });

  it("T5-72 recovery decisions A-E are decided by the shared validators: no assumed success, no deletion, no gain change", () => {
    const plan = e2Plan([7, 7, 7]);
    const r = masteringRequest(plan, "NORMALIZE_STATIC");
    const decide = (state: AnyRecord) => recoveryAction(state as never);
    const caseA = { case: "A_MEASURED_NOT_RENDERED", plan, mediaRoot: MEDIA_ROOT, upstreamArgs: r.up.args, toolchainEvidenceKey: r.key, preMasterEvidence: r.pre };
    expect(decide(caseA)).toStrictEqual({ kind: "ACTION", action: "REUSE" });
    expect(decide({ ...caseA, toolchainEvidenceKey: toolchainEvidenceKey({ ...TOOLCHAIN, ffmpegSha256: SHA("0") }) })).toStrictEqual({ kind: "ACTION", action: "REMEASURE" });
    expect(decide({ ...caseA, plan: e2Plan([7, 7, 8]) })).toStrictEqual({ kind: "ACTION", action: "REMEASURE" });
    const candidatePath = `${r.masteringPlan.finalOutputPath}.part`;
    const preflight = runAudioMasteringPreflight({ decisions: decisionsFor(plan, "NORMALIZE_STATIC"), plan, mediaRoot: MEDIA_ROOT, upstreamArgs: r.up.args,
      ...upstreamExtras(r.up), toolchainEvidenceKey: r.key, preMasterEvidence: r.pre, candidatePath });
    if (!preflight.ok) throw new Error("preflight");
    const caseB = { case: "B_PART_WITHOUT_QC", request: r.request, receipt: preflight.receipt, candidatePath };
    expect(decide(caseB)).toStrictEqual({ kind: "ACTION", action: "REVERIFY" });
    expect(decide({ ...caseB, candidatePath: `${candidatePath}.other.part` })).toStrictEqual({ kind: "ACTION", action: "DISCARD" });
    expect(decide({ ...caseB, receipt: { ...preflight.receipt, receiptSha256: SHA("0") } })).toStrictEqual({ kind: "ACTION", action: "DISCARD" });
    expect(decide({ ...caseB, request: masteringRequest(plan, "NORMALIZE_STATIC", STRICT()).request })).toStrictEqual({ kind: "ACTION", action: "DISCARD" });
    expect(decide({ case: "C_QC_FAILED" })).toStrictEqual({ kind: "FAIL_CLOSED", reason: "QC_FAILED" });
    const evidence = evidenceOf({ subject: candidateSubject(r.masteringPlan) });
    const caseD = { case: "D_QC_PASSED_NOT_PROMOTED", ...promoteInput(r.request, evidence) };
    expect(decide(caseD)).toStrictEqual({ kind: "ACTION", action: "PROMOTE" });
    expect(decide({ ...caseD, candidateSha256: SHA("c") })).toStrictEqual({ kind: "ACTION", action: "REVERIFY" });
    const acceptance = buildPolicyQcAcceptanceRecord({ request: r.request as never, evidence });
    const media = buildMasteredMediaRecord({ request: r.request as never, acceptance, evidence });
    const caseE = { case: "E_FINAL_EXISTS", request: r.request, mediaRecord: media, currentMediaSha256: SHA("b"), currentMediaBytes: 4096,
      toolchainEvidenceKey: SHA("d"), acceptances: [{ acceptance, evidence }] };
    expect(decide(caseE)).toStrictEqual({ kind: "ACTION", action: "REUSE" });
    expect(decide({ ...caseE, acceptances: [] })).toStrictEqual({ kind: "ACTION", action: "REQC_EXISTING_MEDIA" });
    expect(decide({ ...caseE, mediaRecord: null })).toStrictEqual({ kind: "ACTION", action: "RERENDER" });
    expect(decide({ ...caseE, currentMediaSha256: SHA("c") })).toStrictEqual({ kind: "FAIL_CLOSED", reason: "FINAL_MEDIA_MISMATCH" });
    expect(decide({ ...caseE, request: { ...r.request, plan: e2Plan([7, 7, 8]) } })).toStrictEqual({ kind: "FAIL_CLOSED", reason: "EVIDENCE_BINDING_MISMATCH" });
    expect([...E5_RECOVERY_ACTIONS].sort()).toStrictEqual(["DISCARD", "PROMOTE", "REMEASURE", "REQC_EXISTING_MEDIA", "RERENDER", "REUSE", "REVERIFY"]);
  });
});

describe("E5 plan-bound QC authority (Step 1088 A1-A14)", () => {
  it("T5-77 a PASS measured against a foreign expected video F cannot promote, be accepted or recover as PROMOTE", () => {
    const { request, masteringPlan } = masteringRequest(e2Plan([7, 7, 7]), "NORMALIZE_STATIC");
    expect(deriveE5QcRequestAuthority(request as never)?.expected).toStrictEqual({ timelineDurationSamples: 40_320, timelineDurationFrames: 21 });
    const foreign = evidenceOf({ subject: candidateSubject(masteringPlan), frames: 30 });
    expect(summary(foreign)).toStrictEqual(["MEASURED", "PASS", []]);
    expect(checkCandidatePromotable(promoteInput(request, foreign))).toStrictEqual({ ok: false, reasons: ["EVIDENCE_BINDING_MISMATCH"] });
    expect(() => assertCandidatePromotable(promoteInput(request, foreign))).toThrow(/EVIDENCE_BINDING_MISMATCH/);
    expect(() => buildPolicyQcAcceptanceRecord({ request: request as never, evidence: foreign })).toThrow(/EVIDENCE_BINDING_MISMATCH/);
    expect(recoveryAction({ case: "D_QC_PASSED_NOT_PROMOTED", ...promoteInput(request, foreign) })).toStrictEqual({ kind: "ACTION", action: "REVERIFY" });
  });

  it("T5-78 a PASS measured against a foreign expected audio T cannot promote; T cannot be overridden independently of F", () => {
    const { request, masteringPlan } = masteringRequest(e2Plan([7, 7, 7]), "NORMALIZE_STATIC");
    const foreign = evidenceOf({ subject: candidateSubject(masteringPlan), frames: 22 });
    expect(foreign.expected.timelineDurationSamples).toBe(42_240);
    expect(summary(foreign)).toStrictEqual(["MEASURED", "PASS", []]);
    expect(checkQcEvidenceAgainstRequest({ request: request as never, evidence: foreign })).toStrictEqual({ ok: false, reasons: ["EVIDENCE_BINDING_MISMATCH"] });
    expect(() => assertCandidatePromotable(promoteInput(request, foreign))).toThrow(/EVIDENCE_BINDING_MISMATCH/);
    const valid = evidenceOf({ subject: candidateSubject(masteringPlan) });
    expect(() => parsePostEncodeAudioQcEvidenceV1({ ...valid, expected: { timelineDurationSamples: 42_240, timelineDurationFrames: 21 } })).toThrow();
  });

  it("T5-79 a PASS under a foreign looser policy cannot promote or become an acceptance of the current stricter plan", () => {
    const plan = e2Plan([7, 7, 7]);
    const strict = masteringRequest(plan, "NORMALIZE_STATIC", STRICT());
    const loose = masteringRequest(plan, "NORMALIZE_STATIC", policy());
    expect(strict.masteringPlan.renderKey).toBe(loose.masteringPlan.renderKey);
    const subject = candidateSubject(strict.masteringPlan);
    const foreignPass = evidenceOf({ subject, policy: policy() });
    const currentFail = evidenceOf({ subject, policy: STRICT() });
    expect(summary(foreignPass)).toStrictEqual(["MEASURED", "PASS", []]);
    expect(summary(currentFail)[0]).toBe("MEASURED");
    expect(summary(currentFail)[1]).not.toBe("PASS");
    expect(foreignPass.mediaSha256).toBe(currentFail.mediaSha256);
    expect(() => assertCandidatePromotable(promoteInput(strict.request, foreignPass))).toThrow(/EVIDENCE_BINDING_MISMATCH/);
    expect(() => buildPolicyQcAcceptanceRecord({ request: strict.request as never, evidence: foreignPass })).toThrow(/EVIDENCE_BINDING_MISMATCH/);
    const looseAcceptance = buildPolicyQcAcceptanceRecord({ request: loose.request as never, evidence: foreignPass });
    expect(verifyPolicyQcAcceptance({ request: strict.request as never, acceptance: looseAcceptance, evidence: foreignPass })).toBe(false);
    expect(() => buildMasteredMediaRecord({ request: strict.request as never, acceptance: looseAcceptance, evidence: foreignPass })).toThrow(/EVIDENCE_BINDING_MISMATCH/);
    expect(findPolicyQcAcceptance([looseAcceptance], { request: strict.request as never, mediaSha256: SHA("b"), mediaBytes: 4096,
      toolchainEvidenceKey: SHA("d") })).toBeNull();
  });

  it("T5-80 correct F, T, subject and current-policy PASS still promotes, creates the acceptance and the media record on E2, E3 and E4", () => {
    for (const plan of [e2Plan([26, 226]), e3Plan(), e4Plan()]) {
      const { request, masteringPlan, derivation } = masteringRequest(plan, "NORMALIZE_STATIC");
      const evidence = evidenceOf({ subject: candidateSubject(masteringPlan), frames: derivation.timelineDurationFrames });
      expect(checkCandidatePromotable(promoteInput(request, evidence)).ok, derivation.route).toBe(true);
      const acceptance = buildPolicyQcAcceptanceRecord({ request: request as never, evidence });
      expect(acceptance).toMatchObject({ e5RenderKey: masteringPlan.renderKey, policySha256: masteringPlan.policySha256,
        masteringPlanSha256: hashMasteringPlanV1(masteringPlan), qcResult: { status: "PASS" } });
      const media = buildMasteredMediaRecord({ request: request as never, acceptance, evidence });
      expect(media.renderIdentity).toStrictEqual(masteringPlan.renderIdentity);
      expect(recoveryAction({ case: "E_FINAL_EXISTS", request: request as never, mediaRecord: media, currentMediaSha256: SHA("b"),
        currentMediaBytes: 4096, toolchainEvidenceKey: SHA("d"), acceptances: [{ acceptance, evidence }] })).toStrictEqual({ kind: "ACTION", action: "REUSE" });
    }
  });

  it("T5-81 policy A acceptance does not satisfy policy B; B obtains its own QC authority on the same media without re-render", () => {
    const plan = e2Plan([7, 7, 7]);
    const a = masteringRequest(plan, "NORMALIZE_STATIC", policy());
    const bPolicy = policy({ policyId: "audio-delivery:b", integratedToleranceCentiLu: 50, truePeakCeilingCentiDbtp: -150 });
    const b = masteringRequest(plan, "NORMALIZE_STATIC", bPolicy);
    const subject = candidateSubject(a.masteringPlan);
    const evidenceA = evidenceOf({ subject, policy: policy() });
    const acceptanceA = buildPolicyQcAcceptanceRecord({ request: a.request as never, evidence: evidenceA });
    const media = buildMasteredMediaRecord({ request: a.request as never, acceptance: acceptanceA, evidence: evidenceA });
    const recoverB = (acceptances: { acceptance: unknown; evidence: unknown }[]) => recoveryAction({ case: "E_FINAL_EXISTS", request: b.request as never, mediaRecord: media,
      currentMediaSha256: SHA("b"), currentMediaBytes: 4096, toolchainEvidenceKey: SHA("d"), acceptances });
    expect(recoverB([{ acceptance: acceptanceA, evidence: evidenceA }])).toStrictEqual({ kind: "ACTION", action: "REQC_EXISTING_MEDIA" });
    const evidenceB = evidenceOf({ subject, policy: bPolicy });
    const acceptanceB = buildPolicyQcAcceptanceRecord({ request: b.request as never, evidence: evidenceB });
    expect(acceptanceB.qcResult.status).toBe("PASS");
    expect(acceptanceB.qcAuthorityKey).not.toBe(acceptanceA.qcAuthorityKey);
    expect(recoverB([{ acceptance: acceptanceA, evidence: evidenceA }, { acceptance: acceptanceB, evidence: evidenceB }]))
      .toStrictEqual({ kind: "ACTION", action: "REUSE" });
    expect(buildMasteredMediaRecord({ request: b.request as never, acceptance: acceptanceB, evidence: evidenceB }).artifact).toStrictEqual(media.artifact);
  });

  it("T5-82 promotion and mastered-media creation go through the shared plan-binding validator", () => {
    const qc = sourceOf("validatePostEncodeAudioQc.ts");
    expect(functionBody(qc, "checkCandidatePromotable")).toContain("checkQcEvidenceAgainstRequest(");
    expect(functionBody(qc, "assertCandidatePromotable")).toContain("checkCandidatePromotable(");
    expect(functionBody(qc, "buildMasteredMediaRecord")).toContain("verifyPolicyQcAcceptance(");
    expect(functionBody(qc, "assertCandidatePromotable")).not.toMatch(/e5RenderKey|timelineDuration|policySha256/);
    const { request, masteringPlan } = masteringRequest(e2Plan([7, 7, 7]), "NORMALIZE_STATIC");
    const foreign = evidenceOf({ subject: candidateSubject(masteringPlan), frames: 30 });
    const shared = checkQcEvidenceAgainstRequest({ request: request as never, evidence: foreign });
    expect(checkCandidatePromotable(promoteInput(request, foreign))).toStrictEqual(shared);
    expect(checkQcEvidenceAgainstRequest({ request: request as never, evidence: foreign })).toStrictEqual(shared);
    const valid = evidenceOf({ subject: candidateSubject(masteringPlan) });
    const acceptance = buildPolicyQcAcceptanceRecord({ request: request as never, evidence: valid });
    const other = masteringRequest(e2Plan([7, 7, 7]), "NORMALIZE_STATIC", STRICT());
    expect(() => buildMasteredMediaRecord({ request: other.request as never, acceptance, evidence: valid })).toThrow(/EVIDENCE_BINDING_MISMATCH/);
  });

  it("T5-83 policy-acceptance creation and verification go through the same shared validator", () => {
    const qc = sourceOf("validatePostEncodeAudioQc.ts");
    expect(functionBody(qc, "buildPolicyQcAcceptanceRecord")).toContain("checkQcEvidenceAgainstRequest(");
    expect(functionBody(qc, "verifyPolicyQcAcceptance")).toContain("checkQcEvidenceAgainstRequest(");
    expect(functionBody(qc, "buildPolicyQcAcceptanceRecord")).not.toMatch(/input\.masteringPlanSha256|input\.policySha256/);
    const { request, masteringPlan } = masteringRequest(e2Plan([7, 7, 7]), "NORMALIZE_STATIC");
    const valid = evidenceOf({ subject: candidateSubject(masteringPlan) });
    expect(buildPolicyQcAcceptanceRecord({ request: request as never, evidence: valid }))
      .toStrictEqual(buildPolicyQcAcceptanceRecord({ request: structuredClone(request) as never, evidence: structuredClone(valid) }));
    const acceptance = buildPolicyQcAcceptanceRecord({ request: request as never, evidence: valid });
    for (const foreign of [evidenceOf({ subject: candidateSubject(masteringPlan), frames: 30 }), evidenceOf({ subject: { kind: "E5_CANDIDATE", e5RenderKey: SHA("0") } }),
      evidenceOf({ subject: candidateSubject(masteringPlan), policy: STRICT() })]) {
      expect(() => buildPolicyQcAcceptanceRecord({ request: request as never, evidence: foreign })).toThrow(/EVIDENCE_BINDING_MISMATCH/);
      expect(verifyPolicyQcAcceptance({ request: request as never, acceptance, evidence: foreign })).toBe(false);
    }
  });

  it("T5-84 reuse and recovery success go through the same shared validator", () => {
    const qc = sourceOf("validatePostEncodeAudioQc.ts");
    expect(functionBody(qc, "canReuseMeasureOnlyEvidence")).toContain("checkQcEvidenceAgainstRequest(");
    expect(functionBody(qc, "recoveryAction")).toContain("checkCandidatePromotable(state)");
    expect(qc).toContain("verifyPolicyQcAcceptance({ request: state.request, ...pair })");
    expect(functionBody(qc, "canReuseMeasureOnlyEvidence")).not.toMatch(/currentAttestationVerified|currentPolicySha256|currentUpstreamRenderKey/);
    const plan = e2Plan([7, 7, 7]);
    const r = masteringRequest(plan, "NORMALIZE_STATIC");
    const valid = evidenceOf({ subject: candidateSubject(r.masteringPlan) });
    const acceptance = buildPolicyQcAcceptanceRecord({ request: r.request as never, evidence: valid });
    const media = buildMasteredMediaRecord({ request: r.request as never, acceptance, evidence: valid });
    const foreignAcceptanceRequest = masteringRequest(plan, "NORMALIZE_STATIC", STRICT());
    const foreignEvidence = evidenceOf({ subject: candidateSubject(r.masteringPlan), policy: STRICT() });
    const foreignAcceptance = buildPolicyQcAcceptanceRecord({ request: foreignAcceptanceRequest.request as never, evidence: foreignEvidence });
    expect(recoveryAction({ case: "E_FINAL_EXISTS", request: r.request as never, mediaRecord: media, currentMediaSha256: SHA("b"), currentMediaBytes: 4096,
      toolchainEvidenceKey: SHA("d"), acceptances: [{ acceptance: foreignAcceptance, evidence: foreignEvidence }] })).toStrictEqual({ kind: "ACTION", action: "REQC_EXISTING_MEDIA" });
    const m = masteringRequest(plan, "MEASURE_ONLY", null);
    const wrongF = evidenceOf({ subject: upstreamSubject(m.derivation), policy: null, frames: 22 });
    expect(canReuseMeasureOnlyEvidence({ request: m.request as never, evidence: wrongF, currentMediaSha256: SHA("b"), currentMediaBytes: 4096,
      currentToolchainEvidenceKey: SHA("d"), attestation: { route: "E2_ROUGH_CUT", renderKey: m.derivation.upstream.renderKey,
        artifactSha256: SHA("b"), artifactBytes: 4096 } })).toBe(false);
  });

  it("T5-85 UPSTREAM_MEDIA E2: a wrong route or binding label can never bypass the E2 attestation", () => {
    expect(E5_UPSTREAM_RECORD_BINDING_BY_ROUTE).toStrictEqual({ E2_ROUGH_CUT: "E2_RENDER_RECORD_VERIFIED", E3_EDIT: "NO_UPSTREAM_RECORD_LIFECYCLE",
      E4_MIX: "NO_UPSTREAM_RECORD_LIFECYCLE" });
    const m = masteringRequest(e2Plan(), "MEASURE_ONLY", null);
    const frames = m.derivation.timelineDurationFrames;
    const mislabelled = upstreamSubject(m.derivation, "NO_UPSTREAM_RECORD_LIFECYCLE");
    expect(() => evidenceOf({ subject: mislabelled, policy: null, frames })).toThrow(/record binding/);
    expect(() => computeQcAuthorityKey({ subject: mislabelled, mediaSha256: SHA("b"), mediaBytes: 4096, policySha256: null,
      toolchainEvidenceKey: SHA("d"), qcEvidenceSha256: SHA("e") })).toThrow(/record binding/);
    const valid = evidenceOf({ subject: upstreamSubject(m.derivation), policy: null, frames });
    expect(() => parsePostEncodeAudioQcEvidenceV1({ ...valid, subject: mislabelled })).toThrow(/record binding/);
    const asE3 = evidenceOf({ subject: { ...mislabelled, route: "E3_EDIT" }, policy: null, frames });
    const reuse = (evidence: AnyRecord, attestation: unknown) => canReuseMeasureOnlyEvidence({ request: m.request as never, evidence,
      currentMediaSha256: SHA("b"), currentMediaBytes: 4096, currentToolchainEvidenceKey: SHA("d"), attestation });
    expect(reuse(asE3, null)).toBe(false);
    expect(reuse(valid, null)).toBe(false);
    expect(reuse(valid, { route: "E2_ROUGH_CUT", renderKey: m.derivation.upstream.renderKey, artifactSha256: SHA("b"), artifactBytes: 4096 })).toBe(true);
  });

  for (const [id, route, makePlan] of [["T5-86", "E3_EDIT", e3Plan], ["T5-87", "E4_MIX", () => e4Plan()]] as const) {
    it(`${id} UPSTREAM_MEDIA ${route}: route/binding mapping accepted exactly; mismatches rejected; no attestation lifecycle`, () => {
      const m = masteringRequest(makePlan(), "MEASURE_ONLY", null);
      expect(m.derivation.route).toBe(route);
      const frames = m.derivation.timelineDurationFrames;
      const subject = upstreamSubject(m.derivation);
      expect(subject.upstreamRecordBinding).toBe("NO_UPSTREAM_RECORD_LIFECYCLE");
      const evidence = evidenceOf({ subject, policy: null, frames });
      const reuse = (value: AnyRecord, attestation: unknown = null) => canReuseMeasureOnlyEvidence({ request: m.request as never, evidence: value,
        currentMediaSha256: SHA("b"), currentMediaBytes: 4096, currentToolchainEvidenceKey: SHA("d"), attestation });
      expect(reuse(evidence)).toBe(true);
      expect(() => evidenceOf({ subject: { ...subject, upstreamRecordBinding: "E2_RENDER_RECORD_VERIFIED" }, policy: null, frames })).toThrow(/record binding/);
      const otherRoute = route === "E3_EDIT" ? "E4_MIX" : "E3_EDIT";
      expect(reuse(evidenceOf({ subject: { ...subject, route: otherRoute }, policy: null, frames }))).toBe(false);
      expect(reuse(evidenceOf({ subject: { ...subject, route: "E2_ROUGH_CUT", upstreamRecordBinding: "E2_RENDER_RECORD_VERIFIED" }, policy: null, frames }))).toBe(false);
      expect(() => reuse(evidence, { route: "E2_ROUGH_CUT", renderKey: subject.upstreamRenderKey, artifactSha256: SHA("b"), artifactBytes: 4096 }))
        .toThrow(/no upstream record lifecycle/);
      expect(checkQcEvidenceAgainstRequest({ request: m.request as never, evidence: evidenceOf({ subject: { kind: "E5_CANDIDATE",
        e5RenderKey: subject.upstreamRenderKey }, policy: policy(), frames }) })).toStrictEqual({ ok: false, reasons: ["EVIDENCE_BINDING_MISMATCH"] });
    });
  }
});
