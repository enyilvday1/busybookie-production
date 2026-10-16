import { describe, expect, it } from "vitest";
import { validateAudioDeliveryPolicyV1 } from "../src/editorial/audioDeliveryPolicy.schema.js";
import { hashMasteringDecisionsV1 } from "../src/editorial/audioMasteringDecisions.schema.js";
import { buildPreMasterLoudnessEvidence, toolchainEvidenceKey } from "../src/editorial/audioMasteringEvidence.schema.js";
import {
  assertMasteringPlanIntegrity, buildAudioMasteringFinalCommand, buildAudioMasteringPlan, deriveStaticGain, E5_AUDIO_MASTERING_PROFILE_ID,
  E5_OUTPUT_CONTRACT, hashE5RenderIdentityV1, hashMasteringPlanV1, parseAudioMasteringPreflightReceipt, runAudioMasteringPreflight,
} from "../src/editorial/buildAudioMasteringPlan.js";
import { canonicalEditorialJson, editorialSha256 } from "../src/editorial/canonicalizeEditorialPlan.js";
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

function normalizeInput(plan: unknown, measured: Loudness = {}, deliveryPolicy: AnyRecord = policy()) {
  const up = upstreamFor(plan);
  const derivation = derive(plan);
  const key = toolchainEvidenceKey(TOOLCHAIN);
  const pre = buildPreMasterLoudnessEvidence({ derivation, upstreamArgs: up.args, toolchainEvidenceKey: key, stderr: loudnormStderr(measured) });
  if (!pre.ok) throw new Error("pre-master evidence");
  return { up, derivation, key, input: { decisions: decisionsFor(plan, "NORMALIZE_STATIC", deliveryPolicy), plan, mediaRoot: MEDIA_ROOT,
    upstreamArgs: up.args, ...upstreamExtras(up), toolchainEvidenceKey: key, preMasterEvidence: pre.evidence } };
}
function normalized(plan: unknown, measured: Loudness = {}, deliveryPolicy: AnyRecord = policy()) {
  const built = buildAudioMasteringPlan(normalizeInput(plan, measured, deliveryPolicy).input);
  if (!built.ok || built.masteringPlan.mode !== "NORMALIZE_STATIC") throw new Error(`plan: ${built.ok ? "mode" : built.reasons.join(",")}`);
  return built.masteringPlan;
}
const measurable = (i: number, tp: number) => ({ class: "MEASURABLE" as const, integratedCentiLufs: i, truePeakCentiDbtp: tp,
  loudnessRangeCentiLu: 500, thresholdCentiLufs: i - 1000 });

describe("E5 static gain and pre-render safety", () => {
  it("T5-42 gain = target - measured, exact integer centi-dB, never clamped; silence and true-peak risk fail before render", () => {
    const p = validateAudioDeliveryPolicyV1(policy());
    expect(deriveStaticGain(p, measurable(-2345, -1210))).toStrictEqual({ ok: true, gainCentiDb: 745, predictedIntegratedCentiLufs: -1600,
      predictedTruePeakCentiDbtp: -465 });
    expect(deriveStaticGain(p, measurable(-1200, -300))).toMatchObject({ ok: true, gainCentiDb: -400 });
    expect(deriveStaticGain(p, measurable(-1600, -300))).toMatchObject({ ok: true, gainCentiDb: 0 });
    expect(deriveStaticGain(p, measurable(-2600, -1100))).toMatchObject({ ok: true, gainCentiDb: 1000, predictedTruePeakCentiDbtp: -100 });
    expect(deriveStaticGain(p, measurable(-2601, -1200))).toStrictEqual({ ok: false, reasons: ["GAIN_ABOVE_POLICY_MAXIMUM"] });
    expect(deriveStaticGain(p, measurable(400, -500))).toMatchObject({ ok: true, gainCentiDb: -2000 });
    expect(deriveStaticGain(p, measurable(401, -500))).toStrictEqual({ ok: false, reasons: ["GAIN_BELOW_POLICY_MINIMUM"] });
    expect(deriveStaticGain(p, measurable(-2600, -1099))).toStrictEqual({ ok: false, reasons: ["PREDICTED_TRUE_PEAK_EXCEEDED"] });
    expect(deriveStaticGain(p, measurable(-3000, -100))).toStrictEqual({ ok: false,
      reasons: ["GAIN_ABOVE_POLICY_MAXIMUM", "PREDICTED_TRUE_PEAK_EXCEEDED"] });
    expect(deriveStaticGain(p, { class: "BELOW_ABSOLUTE_GATE", integratedCentiLufs: null, truePeakCentiDbtp: null, loudnessRangeCentiLu: 0,
      thresholdCentiLufs: null })).toStrictEqual({ ok: false, reasons: ["NOT_MASTERABLE_SILENCE"] });
  });

  it("T5-43 NORMALIZE_STATIC on E2, E3 and E4: identity, renderKey, plan hash and final output path", () => {
    for (const plan of [e2Plan([7, 7, 7]), e3Plan(), e4Plan()]) {
      const mastering = normalized(plan);
      const derivation = derive(plan);
      expect(mastering.staticGainCentiDb).toBe(745);
      expect(mastering.renderIdentity).toStrictEqual({ identityType: "BUSYBOOKIE_E5_RENDER_IDENTITY", identityVersion: "1",
        renderProfileId: E5_AUDIO_MASTERING_PROFILE_ID, upstream: derivation.upstream, mastering: { mode: "NORMALIZE_STATIC", staticGainCentiDb: 745 },
        output: E5_OUTPUT_CONTRACT });
      expect(mastering.renderKey).toBe(editorialSha256(canonicalEditorialJson(mastering.renderIdentity)));
      expect(mastering.finalOutputPath).toBe(`D:\\Busybookie\\Production\\exports\\EP02\\audio-mastered\\EP02_audio-mastered_${mastering.renderKey}.mp4`);
      expect(mastering.predictedIntegratedCentiLufs).toBe(-1600);
      expect(mastering.predictedTruePeakCentiDbtp).toBe(-465);
    }
    expect(E5_AUDIO_MASTERING_PROFILE_ID).toBe("busybookie-episode-audio-mastering-v1");
    expect(E5_OUTPUT_CONTRACT.aacTarget).toBe("192k");
  });

  it("T5-44 renderKey is render-effective only; the plan hash is provenance-sensitive and excludes the final path", () => {
    const plan = e2Plan([249, 2]);
    const a = normalized(plan);
    const sameGainOtherPolicy = normalized(plan, {}, policy({ integratedToleranceCentiLu: 20, truePeakCeilingCentiDbtp: -300 }));
    expect(sameGainOtherPolicy.renderKey).toBe(a.renderKey);
    expect(sameGainOtherPolicy.finalOutputPath).toBe(a.finalOutputPath);
    expect(hashMasteringPlanV1(sameGainOtherPolicy)).not.toBe(hashMasteringPlanV1(a));
    const otherGain = normalized(plan, { i: "-23.40" });
    expect(otherGain.staticGainCentiDb).toBe(740);
    expect(otherGain.renderKey).not.toBe(a.renderKey);
    const moved = { ...a, finalOutputPath: `E:\\Elsewhere\\EP02_audio-mastered_${a.renderKey}.mp4` };
    expect(hashMasteringPlanV1(moved)).toBe(hashMasteringPlanV1(a));
    expect(canonicalEditorialJson(a.renderIdentity)).not.toMatch(/Busybookie|D:|policy|-1600/);
  });

  it("T5-45 MEASURE_ONLY creates no identity, renderKey or output path; its media authority is the upstream", () => {
    const plan = e3Plan();
    const up = upstreamFor(plan);
    const built = buildAudioMasteringPlan({ decisions: decisionsFor(plan, "MEASURE_ONLY", null), plan, mediaRoot: MEDIA_ROOT, upstreamArgs: up.args,
      ...upstreamExtras(up), toolchainEvidenceKey: toolchainEvidenceKey(TOOLCHAIN) });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.masteringPlan).toStrictEqual({ planType: "BUSYBOOKIE_AUDIO_MASTERING_PLAN", planVersion: "1", mode: "MEASURE_ONLY",
      decisionsSha256: hashMasteringDecisionsV1(decisionsFor(plan, "MEASURE_ONLY", null)), policySha256: null,
      mediaAuthority: { route: "E3_EDIT", upstreamRenderKey: derive(plan).upstream.renderKey } });
    expect(built.masteringPlan).not.toHaveProperty("renderKey");
    expect(() => runAudioMasteringPreflight({ decisions: decisionsFor(plan, "MEASURE_ONLY", null), plan, mediaRoot: MEDIA_ROOT, upstreamArgs: up.args,
      ...upstreamExtras(up), toolchainEvidenceKey: toolchainEvidenceKey(TOOLCHAIN), candidatePath: "D:/x.part" })).toThrow(/NORMALIZE_STATIC/);
  });

  it("T5-46 every fail-before-render reason is a sorted reason list, never an exception", () => {
    const plan = e2Plan([7, 7, 7]);
    const { input, up } = normalizeInput(plan);
    const reasons = (override: AnyRecord) => {
      const built = buildAudioMasteringPlan({ ...input, ...override } as never);
      return built.ok ? "OK" : built.reasons;
    };
    expect(reasons({})).toBe("OK");
    expect(reasons({ decisions: decisionsFor(plan, "NORMALIZE_STATIC", null) })).toStrictEqual(["POLICY_REQUIRED"]);
    expect(reasons({ decisions: decisionsFor(plan, "NORMALIZE_STATIC", policy({ policyId: "bad" })) })).toStrictEqual(["POLICY_INVALID"]);
    expect(reasons({ decisions: decisionsFor(e2Plan([7, 7, 8]), "NORMALIZE_STATIC") })).toStrictEqual(["EVIDENCE_BINDING_MISMATCH"]);
    expect(reasons({ upstreamArgs: up.args.map((a) => (a === "0.8400000000000001" ? "0.84" : a)) })).toStrictEqual(["UPSTREAM_ARGV_MISMATCH"]);
    expect(reasons({ toolchainEvidenceKey: toolchainEvidenceKey({ ...TOOLCHAIN, ffmpegSha256: SHA("0") }) })).toStrictEqual(["REMEASURE_REQUIRED"]);
    expect(reasons({ preMasterEvidence: normalizeInput(e2Plan([7, 7, 8])).input.preMasterEvidence })).toStrictEqual(["EVIDENCE_BINDING_MISMATCH"]);
    expect(reasons({ preMasterEvidence: normalizeInput(plan, { i: "-inf", tp: "-inf", thresh: "-inf" }).input.preMasterEvidence }))
      .toStrictEqual(["NOT_MASTERABLE_SILENCE"]);
    expect(reasons({ preMasterEvidence: normalizeInput(plan, { i: "-40.00", tp: "-30.00" }).input.preMasterEvidence }))
      .toStrictEqual(["GAIN_ABOVE_POLICY_MAXIMUM"]);
    expect(reasons({ preMasterEvidence: normalizeInput(plan, { i: "-20.00", tp: "-0.50" }).input.preMasterEvidence }))
      .toStrictEqual(["PREDICTED_TRUE_PEAK_EXCEEDED"]);
  });

  it("T5-47 plan integrity: renderKey, gain, identity and final path binding are re-derived; tampering fails", () => {
    const mastering = normalized(e4Plan());
    expect(assertMasteringPlanIntegrity(mastering)).toStrictEqual(mastering);
    for (const tampered of [{ ...mastering, renderKey: SHA("0") }, { ...mastering, staticGainCentiDb: 744 },
      { ...mastering, renderIdentity: { ...mastering.renderIdentity, mastering: { mode: "NORMALIZE_STATIC", staticGainCentiDb: 744 } } },
      { ...mastering, finalOutputPath: "D:\\Busybookie\\Production\\exports\\EP02\\audio-mastered\\other.mp4" },
      { ...mastering, renderIdentity: { ...mastering.renderIdentity, output: { ...mastering.renderIdentity.output, aacTarget: "256k" } } },
      { ...mastering, limiter: true }]) {
      expect(() => assertMasteringPlanIntegrity(tampered)).toThrow();
    }
    expect(hashE5RenderIdentityV1(mastering.renderIdentity)).toBe(mastering.renderKey);
  });
});

describe("E5 preflight receipt and final command gate", () => {
  it("T5-48 the preflight receipt is stateless and checksum-bound to plan, candidate, evidence and toolchain", () => {
    const plan = e2Plan([26, 226]);
    const { input } = normalizeInput(plan);
    const mastering = normalized(plan);
    const candidatePath = `${mastering.finalOutputPath}.part`;
    const result = runAudioMasteringPreflight({ ...input, candidatePath });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(runAudioMasteringPreflight({ ...input, candidatePath })).toStrictEqual(result);
    expect(result.receipt.candidatePath).toBe(candidatePath);
    expect(result.receipt.masteringPlanSha256).toBe(hashMasteringPlanV1(mastering));
    expect(parseAudioMasteringPreflightReceipt(result.receipt)).toStrictEqual(result.receipt);
    expect(() => parseAudioMasteringPreflightReceipt({ ...result.receipt, renderKey: SHA("0") })).toThrow(/checksum/);
    for (const bad of [mastering.finalOutputPath, `${mastering.finalOutputPath}.tmp`, "D:\\Busybookie\\Production\\other\\x.mp4.part",
      ` ${candidatePath}`, "relative/x.part"]) {
      expect(() => runAudioMasteringPreflight({ ...input, candidatePath: bad }), bad).toThrow();
    }
    const failing = runAudioMasteringPreflight({ ...normalizeInput(plan, { i: "-20.00", tp: "-0.50" }).input, candidatePath });
    expect(failing).toStrictEqual({ ok: false, reasons: ["PREDICTED_TRUE_PEAK_EXCEEDED"] });
  });

  it("T5-49 the final command requires the exact receipt, candidate, plan and a freshly validated upstream argv", () => {
    const plan = e3Plan();
    const { input, up } = normalizeInput(plan);
    const mastering = normalized(plan);
    const candidatePath = `${mastering.finalOutputPath}.part`;
    const preflight = runAudioMasteringPreflight({ ...input, candidatePath });
    if (!preflight.ok) throw new Error("preflight");
    const build = (override: AnyRecord = {}) => buildAudioMasteringFinalCommand({ ffmpegExecutable: "ffmpeg", masteringPlan: mastering,
      receipt: preflight.receipt, candidatePath, plan, mediaRoot: MEDIA_ROOT, upstreamArgs: up.args, ...upstreamExtras(up), ...override } as never);
    const command = build();
    expect(command.args.at(-1)).toBe(candidatePath);
    expect(command.args.filter((arg, i) => arg !== up.args[i])).toHaveLength(3);
    expect(() => build({ candidatePath: `${mastering.finalOutputPath}.other.part` })).toThrow(/candidate/);
    expect(() => build({ receipt: { ...preflight.receipt, receiptSha256: SHA("0") } })).toThrow(/checksum/);
    expect(() => build({ masteringPlan: normalized(plan, { i: "-23.40" }) })).toThrow(/different mastering plan/);
    expect(() => build({ plan: e2Plan() })).toThrow(/stale/);
    expect(() => build({ upstreamArgs: up.args.map((a) => (a === "18" ? "17" : a)) })).toThrow(/upstream argv/);
    const measureOnly = buildAudioMasteringPlan({ ...input, decisions: decisionsFor(plan, "MEASURE_ONLY", null) });
    if (!measureOnly.ok) throw new Error("measure only");
    expect(() => build({ masteringPlan: measureOnly.masteringPlan })).toThrow(/MEASURE_ONLY/);
  });
});
