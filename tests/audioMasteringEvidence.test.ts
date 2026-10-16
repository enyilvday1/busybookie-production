import { describe, expect, it } from "vitest";
import {
  buildPreMasterLoudnessEvidence, checkPreMasterEvidenceBinding, computeQcAuthorityKey, hashPreMasterLoudnessEvidenceV1,
  parsePostEncodeAudioQcEvidenceV1, toolchainEvidenceKey,
} from "../src/editorial/audioMasteringEvidence.schema.js";
import { canonicalEditorialJson, editorialSha256 } from "../src/editorial/canonicalizeEditorialPlan.js";
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

const QC_PASS = () => derivePostEncodeAudioQcEvidence(qcObservations() as never);

describe("E5 toolchain and pre-master evidence", () => {
  it("T5-36 toolchain evidence: strict, path-free, deterministic key; any field change changes the key", () => {
    const key = toolchainEvidenceKey(TOOLCHAIN);
    expect(key).toBe(editorialSha256(canonicalEditorialJson(TOOLCHAIN)));
    expect(toolchainEvidenceKey(Object.fromEntries(Object.entries(TOOLCHAIN).reverse()))).toBe(key);
    expect(toolchainEvidenceKey({ ...TOOLCHAIN, ffmpegSha256: SHA("0") })).not.toBe(key);
    expect(toolchainEvidenceKey({ ...TOOLCHAIN, ffmpegVersionLine: "ffmpeg version 9.0.1" })).not.toBe(key);
    for (const bad of [{ ...TOOLCHAIN, ffmpegPath: "C:/ffmpeg/bin/ffmpeg.exe" }, { ...TOOLCHAIN, requiredFilters: [...TOOLCHAIN.requiredFilters].reverse() },
      { ...TOOLCHAIN, requiredFilters: TOOLCHAIN.requiredFilters.slice(1) }, { ...TOOLCHAIN, ffmpegVersionLine: "ffmpeg version 9\nbuilt" },
      { ...TOOLCHAIN, measurementEngine: "EBUR128" }, { ...TOOLCHAIN, invocationModel: "SHELL" }]) {
      expect(() => toolchainEvidenceKey(bad)).toThrow();
    }
    expect(E5_REQUIRED_FILTERS).toContain("loudnorm");
    expect(E5_REQUIRED_FILTERS).toContain("nullsink");
    expect([...E5_REQUIRED_FILTERS]).toStrictEqual([...E5_REQUIRED_FILTERS].sort());
  });

  it("T5-37 pre-master evidence binds upstream, FC hash, masked argv hash, engine, toolchain, T and measurement; no paths", () => {
    for (const plan of [e2Plan([7, 7, 7]), e3Plan(), e4Plan()]) {
      const derivation = derive(plan);
      const up = upstreamFor(plan);
      const built = buildPreMasterLoudnessEvidence({ derivation, upstreamArgs: up.args, toolchainEvidenceKey: toolchainEvidenceKey(TOOLCHAIN),
        stderr: loudnormStderr() });
      expect(built.ok).toBe(true);
      if (!built.ok) continue;
      expect(built.evidence.timelineDurationSamples).toBe(derivation.timelineDurationSamples);
      expect(built.evidence.measurement).toStrictEqual({ class: "MEASURABLE", integratedCentiLufs: -2345, truePeakCentiDbtp: -1210,
        loudnessRangeCentiLu: 520, thresholdCentiLufs: -3371 });
      expect(built.evidenceSha256).toBe(hashPreMasterLoudnessEvidenceV1(built.evidence));
      const text = canonicalEditorialJson(built.evidence);
      expect(text).not.toMatch(/D:|Busybookie|\.mp4/);
      expect(checkPreMasterEvidenceBinding({ evidence: built.evidence, derivation, upstreamArgs: up.args,
        toolchainEvidenceKey: toolchainEvidenceKey(TOOLCHAIN) })).toStrictEqual({ ok: true });
    }
  });

  it("T5-38 stale or foreign pre-master evidence: toolchain change is REMEASURE_REQUIRED, everything else EVIDENCE_BINDING_MISMATCH", () => {
    const plan = e2Plan([7, 7, 7]);
    const derivation = derive(plan);
    const up = upstreamFor(plan);
    const key = toolchainEvidenceKey(TOOLCHAIN);
    const built = buildPreMasterLoudnessEvidence({ derivation, upstreamArgs: up.args, toolchainEvidenceKey: key, stderr: loudnormStderr() });
    if (!built.ok) throw new Error("evidence");
    const check = (evidence: unknown, d = derivation, args = up.args, k = key) =>
      checkPreMasterEvidenceBinding({ evidence, derivation: d, upstreamArgs: args, toolchainEvidenceKey: k });
    expect(check(built.evidence, derivation, up.args, toolchainEvidenceKey({ ...TOOLCHAIN, ffprobeSha256: SHA("0") })))
      .toStrictEqual({ ok: false, reasons: ["REMEASURE_REQUIRED"] });
    const other = e2Plan([7, 7, 8]);
    expect(check(built.evidence, derive(other), upstreamFor(other).args)).toStrictEqual({ ok: false, reasons: ["EVIDENCE_BINDING_MISMATCH"] });
    expect(check({ ...built.evidence, measurementArgvSha256: SHA("0") })).toStrictEqual({ ok: false, reasons: ["EVIDENCE_BINDING_MISMATCH"] });
    expect(check({ ...built.evidence, upstreamFilterComplexSha256: SHA("0") })).toStrictEqual({ ok: false, reasons: ["EVIDENCE_BINDING_MISMATCH"] });
    expect(() => check({ ...built.evidence, measurementPath: "D:/x" })).toThrow();
    expect(() => check({ ...built.evidence, timelineDurationSamples: 40_320 + 1920 })).toThrow(/upstream/);
  });

  it("T5-39 pre-master stderr failures are fail-before-render classes, never evidence", () => {
    const derivation = derive(e2Plan());
    const up = upstreamFor(e2Plan());
    const build = (stderr: Uint8Array) => buildPreMasterLoudnessEvidence({ derivation, upstreamArgs: up.args,
      toolchainEvidenceKey: toolchainEvidenceKey(TOOLCHAIN), stderr });
    expect(build(new TextEncoder().encode("no block"))).toStrictEqual({ ok: false, reasons: ["MEASUREMENT_PARSE_FAILURE"] });
    expect(build(loudnormStderr({ i: "nan" }))).toStrictEqual({ ok: false, reasons: ["NON_FINITE_MEASUREMENT"] });
    expect(build(loudnormStderr({ tp: "-inf" }))).toStrictEqual({ ok: false, reasons: ["MEASUREMENT_INCONSISTENT"] });
    expect(build(new TextEncoder().encode("a\rb"))).toStrictEqual({ ok: false, reasons: ["INVALID_LINE_ENDING"] });
    expect(build(loudnormStderr({ i: "-inf", tp: "-inf", thresh: "-inf" }))).toMatchObject({ ok: true, evidence: { measurement: { class: "BELOW_ABSOLUTE_GATE" } } });
  });
});

describe("E5 post-encode QC evidence schema", () => {
  it("T5-40 strict stage union: forbidden fields, impossible failures, terminal precedence and attempt codes", () => {
    const pass = QC_PASS() as AnyRecord;
    expect(parsePostEncodeAudioQcEvidenceV1(pass)).toStrictEqual(pass);
    const reject = (value: AnyRecord) => expect(() => parsePostEncodeAudioQcEvidenceV1(value)).toThrow();
    reject({ ...pass, rawProbeJson: "{}" });
    reject({ ...pass, mediaPath: MEDIA });
    const { loudness: _l, ...noLoudness } = pass;
    reject(noLoudness);
    reject({ ...pass, status: "FAIL" });
    reject({ ...pass, failures: ["LOUDNESS_OUT_OF_RANGE"], status: "FAIL", terminalReason: "TRUE_PEAK_EXCEEDED" });
    reject({ ...pass, failures: ["TRUE_PEAK_EXCEEDED", "DURATION_MISMATCH"], status: "FAIL", terminalReason: "DURATION_MISMATCH" });
    reject({ ...pass, failures: ["VIDEO_CONTRACT_MISMATCH"], status: "FAIL", terminalReason: "VIDEO_CONTRACT_MISMATCH" });
    reject({ ...pass, probeAttempt: { ...pass.probeAttempt, exitCode: 1 } });
    reject({ ...pass, policySha256: null });
    reject({ ...pass, expected: { timelineDurationSamples: 40_321, timelineDurationFrames: 21 } });
    const measurementFailed = derivePostEncodeAudioQcEvidence(qcObservations({ stderr: new TextEncoder().encode("nothing"),
      decodedSamples: 100 }) as never) as AnyRecord;
    expect(measurementFailed.failures).toStrictEqual(["MEASUREMENT_FAILURE"]);
    reject({ ...measurementFailed, failures: ["DURATION_MISMATCH", "MEASUREMENT_FAILURE"] });
    reject({ ...measurementFailed, measurementAttempt: { ...measurementFailed.measurementAttempt, failureCode: "MEASUREMENT_NONZERO_EXIT" } });
    reject({ ...measurementFailed, loudness: pass.loudness });
  });

  it("T5-41 qcAuthorityKey: the full policySha256, toolchain key, media identity and evidence hash participate", () => {
    const base = { subject: { kind: "E5_CANDIDATE", e5RenderKey: SHA("a") }, mediaSha256: SHA("b"), mediaBytes: 4096,
      policySha256: SHA("1"), toolchainEvidenceKey: SHA("d"), qcEvidenceSha256: SHA("e") };
    const key = computeQcAuthorityKey(base);
    expect(computeQcAuthorityKey({ ...base })).toBe(key);
    for (const change of [{ policySha256: SHA("2") }, { toolchainEvidenceKey: SHA("0") }, { mediaSha256: SHA("c") }, { mediaBytes: 4097 },
      { qcEvidenceSha256: SHA("f") }, { subject: { kind: "E5_CANDIDATE", e5RenderKey: SHA("9") } }]) {
      expect(computeQcAuthorityKey({ ...base, ...change }), JSON.stringify(change)).not.toBe(key);
    }
    expect(() => computeQcAuthorityKey({ ...base, policySha256: "short" })).toThrow();
  });
});
