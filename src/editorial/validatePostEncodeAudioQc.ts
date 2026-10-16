import { z } from "zod";
import { checkAudioDeliveryPolicyV1, type AudioDeliveryPolicyV1 } from "./audioDeliveryPolicy.schema.js";
import {
  checkPreMasterEvidenceBinding, computeQcAuthorityKey, E5_UPSTREAM_RECORD_BINDING_BY_ROUTE, E5QcResultV1Schema,
  hashPostEncodeAudioQcEvidenceV1, parsePostEncodeAudioQcEvidenceV1, sortQcFailures, terminalReasonOf,
  type E5CanonicalProbeV1, type E5QcFailure, type E5QcResultV1, type PostEncodeAudioQcEvidenceV1,
} from "./audioMasteringEvidence.schema.js";
import {
  buildPostEncodeDecodeCommand, buildPostEncodeLoudnessCommand, buildPostEncodeProbeCommand, qcAttemptArgvSha256,
} from "./buildAudioMasteringFfmpegCommands.js";
import {
  assertMasteringPlanIntegrity, E5MasteringPreflightReceiptV1Schema, E5RenderIdentityV1Schema, hashE5RenderIdentityV1,
  hashMasteringPlanV1, type E5RenderIdentityV1, type MasteringPlanV1,
} from "./buildAudioMasteringPlan.js";
import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import {
  checkAudioMasteringUpstreamArgv, checkUpstreamRecordBinding, deriveAudioMasteringUpstream, upstreamMatchesDerivation,
  type E5UpstreamDerivation, type E5UpstreamRoute,
} from "./deriveAudioMasteringUpstream.js";
import type { EditorialEditRenderPreflightResult } from "./editorialEditRenderPreflight.js";
import type { EditorialReadonly } from "./editorialPlan.schema.js";
import { parseLoudnormMeasurement } from "./parseLoudnormMeasurement.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().refine((n) => Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0), "Expected a non-negative safe integer.");
const positive = count.refine((n) => n > 0, "Expected a positive safe integer.");

function digest(value: unknown): string {
  return editorialSha256(canonicalEditorialJson(value));
}

// ---------------------------------------------------------------- ffprobe output (Step 1086 A1-A4)
type ProbeOutputFailure = "PROBE_OUTPUT_INVALID_UTF8" | "PROBE_OUTPUT_MALFORMED_JSON" | "PROBE_OUTPUT_SCHEMA_MISMATCH";
export type FfprobeParseResult =
  | Readonly<{ ok: true; probe: E5CanonicalProbeV1 }>
  | Readonly<{ ok: false; failureCode: ProbeOutputFailure }>;

const DECIMAL_INTEGER = /^(0|[1-9][0-9]*)$/;
const NOT_AVAILABLE = "N/A";

function integerText(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !DECIMAL_INTEGER.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

// Optional ffprobe text: absent or "N/A" is null; anything else must be a string.
function optionalText(entry: Record<string, unknown>, key: string): string | null | undefined {
  const value = entry[key];
  if (value === undefined || value === NOT_AVAILABLE) return null;
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function selectedVideo(entry: Record<string, unknown>): E5CanonicalProbeV1["video"] | undefined {
  const codecName = entry.codec_name;
  const pixFmt = entry.pix_fmt;
  const rFrameRate = entry.r_frame_rate;
  const profile = optionalText(entry, "profile");
  const width = integerText(entry.width);
  const height = integerText(entry.height);
  const nbReadFrames = integerText(entry.nb_read_frames);
  if (typeof codecName !== "string" || typeof pixFmt !== "string" || typeof rFrameRate !== "string" || profile === undefined ||
    width === null || height === null || nbReadFrames === null) return undefined;
  return { codecName, profile, width, height, pixFmt, rFrameRate, nbReadFrames };
}

function selectedAudio(entry: Record<string, unknown>): E5CanonicalProbeV1["audio"] | undefined {
  const codecName = entry.codec_name;
  const profile = optionalText(entry, "profile");
  const channelLayout = optionalText(entry, "channel_layout");
  const sampleRateHz = integerText(entry.sample_rate);
  const channels = integerText(entry.channels);
  const bitRate = entry.bit_rate === undefined || entry.bit_rate === NOT_AVAILABLE ? null : integerText(entry.bit_rate);
  if (typeof codecName !== "string" || profile === undefined || channelLayout === undefined || sampleRateHz === null ||
    channels === null || (bitRate === null && entry.bit_rate !== undefined && entry.bit_rate !== NOT_AVAILABLE)) return undefined;
  return { codecName, profile, sampleRateHz, channels, channelLayout, reportedBitRate: bitRate };
}

// Canonical selection by numeric stream index only (never array position); counts over the full admitted inventory.
export function parseFfprobeOutput(stdout: Uint8Array): FfprobeParseResult {
  assertEditorial(stdout instanceof Uint8Array, "ffprobe parser requires the raw stdout bytes");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(stdout);
  } catch {
    return freezeEditorial({ ok: false, failureCode: "PROBE_OUTPUT_INVALID_UTF8" });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return freezeEditorial({ ok: false, failureCode: "PROBE_OUTPUT_MALFORMED_JSON" });
  }
  const mismatch: FfprobeParseResult = freezeEditorial({ ok: false, failureCode: "PROBE_OUTPUT_SCHEMA_MISMATCH" });
  if (!isRecord(json) || !isRecord(json.format) || !Array.isArray(json.streams)) return mismatch;
  const format = json.format;
  const nbStreams = integerText(format.nb_streams);
  const formatDurationText = optionalText(format, "duration");
  if (typeof format.format_name !== "string" || nbStreams === null || formatDurationText === undefined) return mismatch;
  const indexed: { index: number; type: string; entry: Record<string, unknown> }[] = [];
  const seen = new Set<number>();
  for (const entry of json.streams) {
    if (!isRecord(entry) || typeof entry.codec_type !== "string") return mismatch;
    const index = entry.index;
    if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || Object.is(index, -0) || seen.has(index)) return mismatch;
    seen.add(index);
    indexed.push({ index, type: entry.codec_type, entry });
  }
  indexed.sort((left, right) => left.index - right.index);
  const videos = indexed.filter((stream) => stream.type === "video");
  const audios = indexed.filter((stream) => stream.type === "audio");
  const video = videos.length === 0 ? null : selectedVideo(videos[0]!.entry);
  const audio = audios.length === 0 ? null : selectedAudio(audios[0]!.entry);
  if (video === undefined || audio === undefined) return mismatch;
  return freezeEditorial({ ok: true, probe: {
    formatName: format.format_name, nbStreams, videoStreamCount: videos.length, audioStreamCount: audios.length,
    otherStreamCount: indexed.length - videos.length - audios.length, formatDurationText, video, audio,
  } });
}

// Step 1086 A5/A6: cardinality first (MISSING_AUDIO precedence), then per-stream gates only for exactly 1v + 1a + 0 other.
export function evaluateMetadataGates(probe: E5CanonicalProbeV1, expectedTimelineFrames: number): E5QcFailure[] {
  if (probe.audioStreamCount === 0) return ["MISSING_AUDIO"];
  if (probe.videoStreamCount !== 1 || probe.audioStreamCount !== 1 || probe.otherStreamCount !== 0) return ["UNEXPECTED_STREAMS"];
  const video = probe.video!;
  const audio = probe.audio!;
  const failures: E5QcFailure[] = [];
  if (audio.codecName !== "aac") failures.push("WRONG_CODEC");
  if (audio.sampleRateHz !== 48000) failures.push("WRONG_SAMPLE_RATE");
  if (audio.channels !== 2) failures.push("WRONG_CHANNEL_COUNT");
  if (audio.channelLayout !== "stereo") failures.push("WRONG_CHANNEL_LAYOUT");
  if (video.codecName !== "h264" || video.profile !== "High" || video.width !== 1920 || video.height !== 1080 ||
    video.pixFmt !== "yuv420p" || video.rFrameRate !== "25/1" || video.nbReadFrames !== expectedTimelineFrames) {
    failures.push("VIDEO_CONTRACT_MISMATCH");
  }
  return sortQcFailures(failures);
}

// ---------------------------------------------------------------- staged evidence derivation (1082 R10/R11, 1084 R5)
export type ProcessObservation = Readonly<{ args: readonly string[]; exitCode: number | null }>;
export type PostEncodeQcObservations = Readonly<{
  subject: unknown;
  mediaSha256: string;
  mediaBytes: number;
  policy: unknown;
  toolchainEvidenceKey: string;
  expected: Readonly<{ timelineDurationSamples: number; timelineDurationFrames: number }>;
  mediaPath: string;
  qcPcmPath: string;
  probe: ProcessObservation & Readonly<{ stdout: Uint8Array | null }>;
  decode?: ProcessObservation & Readonly<{
    output: Readonly<{ byteLength: number; nonFiniteSampleCount: number; maxAbsSampleF32Bits: number }> | null;
  }>;
  measurement?: ProcessObservation & Readonly<{ stderr: Uint8Array | null }>;
}>;

function sameArgs(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((arg, index) => arg === expected[index]);
}

function exitFailure<L extends string, N extends string>(exitCode: number | null, launch: L, nonzero: N): L | N | null {
  if (exitCode === null) return launch;
  assertEditorial(Number.isSafeInteger(exitCode), "process exit code must be an integer");
  return exitCode === 0 ? null : nonzero;
}

// Pure: observations of the fixed pipeline -> exactly one canonical evidence value. A stage observation supplied after a
// terminal stage failure is a malformed input (no step runs after a terminal stage failure).
export function derivePostEncodeAudioQcEvidence(input: PostEncodeQcObservations): PostEncodeAudioQcEvidenceV1 {
  let policy: AudioDeliveryPolicyV1 | null = null;
  let policySha256: string | null = null;
  if (input.policy !== null) {
    const checked = checkAudioDeliveryPolicyV1(input.policy);
    assertEditorial(checked.ok, "post-encode QC policy is invalid (POLICY_INVALID)");
    policy = checked.policy;
    policySha256 = checked.policySha256;
  }
  const base = {
    evidenceType: "BUSYBOOKIE_E5_POST_ENCODE_AUDIO_QC_EVIDENCE", evidenceVersion: "1", subject: input.subject,
    mediaSha256: input.mediaSha256, mediaBytes: input.mediaBytes, policySha256, toolchainEvidenceKey: input.toolchainEvidenceKey,
    expected: { ...input.expected },
  };
  const finish = (value: Record<string, unknown>, failures: readonly E5QcFailure[]) => {
    const sorted = sortQcFailures(failures);
    const terminalReason = terminalReasonOf(sorted);
    return parsePostEncodeAudioQcEvidenceV1({ ...base, ...value, status: sorted.length === 0 ? "PASS" : "FAIL", terminalReason, failures: sorted });
  };
  const probeCommand = buildPostEncodeProbeCommand({ ffprobeExecutable: "ffprobe", mediaPath: input.mediaPath });
  assertEditorial(sameArgs(input.probe.args, probeCommand.args), "probe observation does not use the frozen ffprobe argv");
  const probeArgvSha256 = qcAttemptArgvSha256(probeCommand.args, input.mediaPath);
  const probeExit = exitFailure(input.probe.exitCode, "PROBE_PROCESS_LAUNCH_FAILURE", "PROBE_NONZERO_EXIT");
  const parsed = probeExit === null ? (assertEditorial(input.probe.stdout !== null, "a completed probe has stdout"),
    parseFfprobeOutput(input.probe.stdout)) : null;
  if (probeExit !== null || (parsed !== null && !parsed.ok)) {
    assertEditorial(input.decode === undefined && input.measurement === undefined, "no step runs after a probe failure");
    const failureCode = probeExit ?? (parsed !== null && !parsed.ok ? parsed.failureCode : "PROBE_OUTPUT_SCHEMA_MISMATCH");
    return finish({ stage: "PROBE_FAILED", probeAttempt: { argvSha256: probeArgvSha256, exitCode: input.probe.exitCode, failureCode } },
      ["PROBE_FAILURE"]);
  }
  const probe = parsed!.ok ? parsed!.probe : null;
  assertEditorial(probe !== null, "probe evidence is required");
  const probeAttempt = { argvSha256: probeArgvSha256, exitCode: 0, failureCode: null };
  const metadataFailures = evaluateMetadataGates(probe, input.expected.timelineDurationFrames);
  if (metadataFailures.length > 0) {
    assertEditorial(input.decode === undefined && input.measurement === undefined, "no step runs after a metadata rejection");
    return finish({ stage: "METADATA_REJECTED", probeAttempt, probe }, metadataFailures);
  }
  assertEditorial(input.decode !== undefined, "a metadata-valid candidate requires the decode observation");
  const decodeCommand = buildPostEncodeDecodeCommand({ ffmpegExecutable: "ffmpeg", mediaPath: input.mediaPath, qcPcmPath: input.qcPcmPath });
  assertEditorial(sameArgs(input.decode.args, decodeCommand.args), "decode observation does not use the frozen decode argv");
  const decodeArgvSha256 = qcAttemptArgvSha256(decodeCommand.args, input.mediaPath, input.qcPcmPath);
  const output = input.decode.output;
  const decodeFailure = exitFailure(input.decode.exitCode, "DECODE_PROCESS_LAUNCH_FAILURE", "DECODE_NONZERO_EXIT") ??
    (output === null ? "DECODE_OUTPUT_MISSING" : output.byteLength % 8 !== 0 ? "DECODE_OUTPUT_NOT_FRAME_ALIGNED" : null);
  if (decodeFailure !== null) {
    assertEditorial(input.measurement === undefined, "no step runs after a decode failure");
    return finish({ stage: "DECODE_FAILED", probeAttempt, probe,
      decodeAttempt: { argvSha256: decodeArgvSha256, exitCode: input.decode.exitCode, failureCode: decodeFailure } }, ["DECODE_FAILURE"]);
  }
  const decoded = { sampleFrameCount: output!.byteLength / 8, nonFiniteSampleCount: output!.nonFiniteSampleCount,
    maxAbsSampleF32Bits: output!.maxAbsSampleF32Bits };
  const decodeAttempt = { argvSha256: decodeArgvSha256, exitCode: 0, failureCode: null };
  assertEditorial(input.measurement !== undefined, "a decoded candidate requires the loudness measurement observation");
  const loudnessCommand = buildPostEncodeLoudnessCommand({ ffmpegExecutable: "ffmpeg", mediaPath: input.mediaPath });
  assertEditorial(sameArgs(input.measurement.args, loudnessCommand.args), "measurement observation does not use the frozen loudness argv");
  const measurementArgvSha256 = qcAttemptArgvSha256(loudnessCommand.args, input.mediaPath);
  const measurementExit = exitFailure(input.measurement.exitCode, "MEASUREMENT_PROCESS_LAUNCH_FAILURE", "MEASUREMENT_NONZERO_EXIT");
  const measured = measurementExit === null ? (assertEditorial(input.measurement.stderr !== null, "a completed measurement has stderr"),
    parseLoudnormMeasurement(input.measurement.stderr)) : null;
  if (measurementExit !== null || (measured !== null && !measured.ok)) {
    const failureCode = measurementExit ?? (measured !== null && !measured.ok ? measured.code : "MALFORMED_JSON");
    // Step 1084 R5: exactly ["MEASUREMENT_FAILURE"]; decoded facts stay recorded.
    return finish({ stage: "MEASUREMENT_FAILED", probeAttempt, probe, decodeAttempt, decoded,
      measurementAttempt: { argvSha256: measurementArgvSha256, exitCode: input.measurement.exitCode, failureCode } }, ["MEASUREMENT_FAILURE"]);
  }
  const loudness = measured!.ok ? measured!.measurement : null;
  assertEditorial(loudness !== null, "measurement evidence is required");
  const failures: E5QcFailure[] = [];
  if (decoded.sampleFrameCount !== input.expected.timelineDurationSamples) failures.push("DURATION_MISMATCH");
  if (decoded.nonFiniteSampleCount > 0) failures.push("NON_FINITE_AUDIO");
  if (policy !== null) {
    if (loudness.class === "BELOW_ABSOLUTE_GATE") failures.push("LOUDNESS_UNDEFINED_SILENCE");
    else if (Math.abs(loudness.integratedCentiLufs - policy.targetIntegratedCentiLufs) > policy.integratedToleranceCentiLu) {
      failures.push("LOUDNESS_OUT_OF_RANGE");
    }
    if (loudness.truePeakCentiDbtp !== null && loudness.truePeakCentiDbtp > policy.truePeakCeilingCentiDbtp) failures.push("TRUE_PEAK_EXCEEDED");
  }
  return finish({ stage: "MEASURED", probeAttempt, probe, decodeAttempt, decoded,
    measurementAttempt: { argvSha256: measurementArgvSha256, exitCode: 0, failureCode: null }, loudness }, failures);
}

// ---------------------------------------------------------------- QC result (Step 1080 T)
export type QcReuseVerdict = Readonly<{ evidenceBindingMismatch: boolean; toolchainMismatch: boolean }>;

// Fresh QC never produces EVIDENCE_BINDING_MISMATCH / TOOLCHAIN_MISMATCH; they are reuse-time verdicts on stored evidence.
export function deriveE5QcResult(evidenceInput: unknown, reuse?: QcReuseVerdict): E5QcResultV1 {
  const evidence = parsePostEncodeAudioQcEvidenceV1(evidenceInput);
  const failures = sortQcFailures([
    ...evidence.failures,
    ...(reuse?.evidenceBindingMismatch === true ? ["EVIDENCE_BINDING_MISMATCH" as const] : []),
    ...(reuse?.toolchainMismatch === true ? ["TOOLCHAIN_MISMATCH" as const] : []),
  ]);
  const probe = "probe" in evidence ? evidence.probe : null;
  const decoded = "decoded" in evidence ? evidence.decoded : null;
  const loudness = "loudness" in evidence ? evidence.loudness : null;
  const result = E5QcResultV1Schema.parse({
    resultType: "BUSYBOOKIE_E5_QC_RESULT", resultVersion: "1", evidenceSha256: hashPostEncodeAudioQcEvidenceV1(evidence),
    policySha256: evidence.policySha256, status: failures.length === 0 ? "PASS" : "FAIL", failures,
    informational: {
      reportedBitRate: probe?.audio?.reportedBitRate ?? null, loudnessRangeCentiLu: loudness?.loudnessRangeCentiLu ?? null,
      maxAbsSampleF32Bits: decoded?.maxAbsSampleF32Bits ?? null, formatDurationText: probe?.formatDurationText ?? null,
    },
  });
  return freezeEditorial(result);
}

// ---------------------------------------------------------------- current-request authority (Step 1088 A1-A5, A10, A14)
// The current mastering plan plus a FRESH upstream derivation of the current EditorialPlan 3.0 is the request authority.
// QC evidence is evidence about that request: its subject, expected F/T and policy are checked, never trusted.
export type E5QcRequest = Readonly<{ masteringPlan: unknown; plan: unknown; mediaRoot: string }>;

export type E5QcRequestAuthority = Readonly<{
  mode: MasteringPlanV1["mode"];
  route: E5UpstreamRoute;
  masteringPlan: MasteringPlanV1;
  masteringPlanSha256: string;
  derivation: E5UpstreamDerivation;
  subject: PostEncodeAudioQcEvidenceV1["subject"];
  expected: Readonly<{ timelineDurationSamples: number; timelineDurationFrames: number }>;
  policySha256: string | null;
  renderKey: string | null;
  renderIdentity: E5RenderIdentityV1 | null;
}>;

// Single derivation of what the current request expects. A malformed mastering plan throws; a stale or unmasterable
// request has no authority (null).
export function deriveE5QcRequestAuthority(request: E5QcRequest): E5QcRequestAuthority | null {
  const masteringPlan = assertMasteringPlanIntegrity(request.masteringPlan);
  const derived = deriveAudioMasteringUpstream({ plan: request.plan, mediaRoot: request.mediaRoot });
  if (!derived.ok) return null;
  const derivation = derived.derivation;
  const frames = derivation.timelineDurationFrames;
  const samples = derivation.timelineDurationSamples;
  assertEditorial(Number.isSafeInteger(frames) && frames > 0 && samples === frames * 1_920, "upstream derivation T is not F x 1920");
  const common = {
    mode: masteringPlan.mode, route: derivation.route, masteringPlan, masteringPlanSha256: hashMasteringPlanV1(masteringPlan), derivation,
    expected: { timelineDurationSamples: samples, timelineDurationFrames: frames }, policySha256: masteringPlan.policySha256,
  };
  if (masteringPlan.mode === "NORMALIZE_STATIC") {
    if (!upstreamMatchesDerivation(masteringPlan.upstream, derivation)) return null;
    return freezeEditorial({ ...common, subject: { kind: "E5_CANDIDATE" as const, e5RenderKey: masteringPlan.renderKey },
      renderKey: masteringPlan.renderKey, renderIdentity: masteringPlan.renderIdentity });
  }
  if (masteringPlan.mediaAuthority.route !== derivation.route || masteringPlan.mediaAuthority.upstreamRenderKey !== derivation.upstream.renderKey) {
    return null;
  }
  return freezeEditorial({ ...common, subject: { kind: "UPSTREAM_MEDIA" as const, route: derivation.route,
    upstreamRenderKey: derivation.upstream.renderKey, upstreamRecordBinding: E5_UPSTREAM_RECORD_BINDING_BY_ROUTE[derivation.route] },
  renderKey: null, renderIdentity: null });
}

export type QcRequestBindingCheck =
  | Readonly<{ ok: true; evidence: PostEncodeAudioQcEvidenceV1; authority: E5QcRequestAuthority }>
  | Readonly<{ ok: false; reasons: readonly ["EVIDENCE_BINDING_MISMATCH"] }>;

const BINDING_MISMATCH: QcRequestBindingCheck = freezeEditorial({ ok: false, reasons: ["EVIDENCE_BINDING_MISMATCH"] as const });

// The one shared validator (Step 1088 A14): subject, expected F/T and policy must equal the current request authority.
export function checkQcEvidenceAgainstRequest(input: Readonly<{ request: E5QcRequest; evidence: unknown }>): QcRequestBindingCheck {
  const evidence = parsePostEncodeAudioQcEvidenceV1(input.evidence);
  const authority = deriveE5QcRequestAuthority(input.request);
  if (authority === null || canonicalEditorialJson(evidence.subject) !== canonicalEditorialJson(authority.subject) ||
    canonicalEditorialJson(evidence.expected) !== canonicalEditorialJson(authority.expected) ||
    evidence.policySha256 !== authority.policySha256) return BINDING_MISMATCH;
  return freezeEditorial({ ok: true, evidence, authority });
}

// Promotion (Step 1080 U step 9, Step 1088 A6): a fresh PASS over the exact candidate bytes, bound to the current plan.
export type CandidatePromotionCheck =
  | Readonly<{ ok: true; authority: E5QcRequestAuthority }>
  | Readonly<{ ok: false; reasons: readonly ["EVIDENCE_BINDING_MISMATCH"] | readonly ["QC_NOT_PASSED"] | readonly ["CANDIDATE_MISMATCH"] }>;

export function checkCandidatePromotable(input: Readonly<{
  request: E5QcRequest; evidence: unknown; qcResult: unknown; candidateSha256: string; candidateBytes: number;
}>): CandidatePromotionCheck {
  const bound = checkQcEvidenceAgainstRequest({ request: input.request, evidence: input.evidence });
  if (!bound.ok) return bound;
  assertEditorial(bound.authority.mode === "NORMALIZE_STATIC", "only a NORMALIZE_STATIC candidate is promoted");
  const evidence = bound.evidence;
  const result = E5QcResultV1Schema.parse(input.qcResult);
  assertEditorial(result.evidenceSha256 === hashPostEncodeAudioQcEvidenceV1(evidence), "QC result belongs to different evidence");
  assertEditorial(canonicalEditorialJson(result) === canonicalEditorialJson(deriveE5QcResult(evidence)), "QC result is not the derived result");
  if (result.status !== "PASS" || evidence.status !== "PASS") return freezeEditorial({ ok: false, reasons: ["QC_NOT_PASSED"] as const });
  if (evidence.mediaSha256 !== input.candidateSha256 || evidence.mediaBytes !== input.candidateBytes) {
    return freezeEditorial({ ok: false, reasons: ["CANDIDATE_MISMATCH"] as const });
  }
  return freezeEditorial({ ok: true, authority: bound.authority });
}

export function assertCandidatePromotable(input: Parameters<typeof checkCandidatePromotable>[0]): void {
  const checked = checkCandidatePromotable(input);
  if (checked.ok) return;
  assertEditorial(checked.reasons[0] !== "QC_NOT_PASSED", "a failed candidate is never promoted");
  assertEditorial(checked.reasons[0] !== "CANDIDATE_MISMATCH", "candidate bytes differ from the QC evidence");
  assertEditorial(false, "QC evidence is not bound to the current mastering plan (EVIDENCE_BINDING_MISMATCH)");
}

// ---------------------------------------------------------------- records (Step 1082 R12, Step 1088 A7/A8)
export const E5MasteredMediaRecordV1Schema = z.object({
  recordType: z.literal("BUSYBOOKIE_E5_MASTERED_MEDIA_RECORD"),
  recordVersion: z.literal("1"),
  status: z.literal("MASTERED"),
  renderKey: sha,
  renderIdentity: E5RenderIdentityV1Schema,
  artifact: z.object({ sha256: sha, bytes: positive }).strict(),
  promotingQcAuthorityKey: sha,
}).strict();
export type E5MasteredMediaRecordV1 = EditorialReadonly<z.infer<typeof E5MasteredMediaRecordV1Schema>>;

export const E5PolicyQcAcceptanceRecordV1Schema = z.object({
  recordType: z.literal("BUSYBOOKIE_E5_POLICY_QC_ACCEPTANCE"),
  recordVersion: z.literal("1"),
  qcAuthorityKey: sha,
  e5RenderKey: sha,
  mediaSha256: sha,
  mediaBytes: positive,
  policySha256: sha,
  toolchainEvidenceKey: sha,
  qcEvidenceSha256: sha,
  qcResult: E5QcResultV1Schema,
  masteringPlanSha256: sha,
}).strict();
export type E5PolicyQcAcceptanceRecordV1 = EditorialReadonly<z.infer<typeof E5PolicyQcAcceptanceRecordV1Schema>>;

export function parseE5MasteredMediaRecordV1(input: unknown): E5MasteredMediaRecordV1 {
  const parsed = E5MasteredMediaRecordV1Schema.safeParse(input);
  assertEditorial(parsed.success, `E5 mastered media record is invalid: ${parsed.error?.message ?? ""}`);
  assertEditorial(hashE5RenderIdentityV1(parsed.data.renderIdentity) === parsed.data.renderKey, "media record renderKey does not match its identity");
  return freezeEditorial(parsed.data);
}

// recordSha256 covers the record fields only; recordedAt and paths are provenance kept outside it.
export function hashE5MasteredMediaRecordV1(input: unknown): string {
  return digest(parseE5MasteredMediaRecordV1(input));
}

function normalizeAuthority(authority: E5QcRequestAuthority): Readonly<{ renderKey: string; policySha256: string }> {
  assertEditorial(authority.mode === "NORMALIZE_STATIC" && authority.renderKey !== null && authority.policySha256 !== null,
    "policy acceptance applies to NORMALIZE_STATIC requests only");
  return { renderKey: authority.renderKey, policySha256: authority.policySha256 };
}

// A foreign PASS can never become a current-policy acceptance: the shared request check runs first.
export function buildPolicyQcAcceptanceRecord(input: Readonly<{ request: E5QcRequest; evidence: unknown }>): E5PolicyQcAcceptanceRecordV1 {
  const bound = checkQcEvidenceAgainstRequest(input);
  assertEditorial(bound.ok, "QC evidence is not bound to the current mastering plan (EVIDENCE_BINDING_MISMATCH)");
  const { renderKey, policySha256 } = normalizeAuthority(bound.authority);
  const evidence = bound.evidence;
  const qcEvidenceSha256 = hashPostEncodeAudioQcEvidenceV1(evidence);
  const record = {
    recordType: "BUSYBOOKIE_E5_POLICY_QC_ACCEPTANCE", recordVersion: "1",
    qcAuthorityKey: computeQcAuthorityKey({ subject: evidence.subject, mediaSha256: evidence.mediaSha256, mediaBytes: evidence.mediaBytes,
      policySha256, toolchainEvidenceKey: evidence.toolchainEvidenceKey, qcEvidenceSha256 }),
    e5RenderKey: renderKey, mediaSha256: evidence.mediaSha256, mediaBytes: evidence.mediaBytes,
    policySha256, toolchainEvidenceKey: evidence.toolchainEvidenceKey, qcEvidenceSha256,
    qcResult: deriveE5QcResult(evidence), masteringPlanSha256: bound.authority.masteringPlanSha256,
  };
  return freezeEditorial(E5PolicyQcAcceptanceRecordV1Schema.parse(record));
}

// Re-verifies a stored acceptance against the current request: shared request check, plan renderKey and policy, and
// re-derivation of its key, evidence hash and result from the stored evidence.
export function verifyPolicyQcAcceptance(input: Readonly<{ request: E5QcRequest; acceptance: unknown; evidence: unknown }>): boolean {
  const acceptance = E5PolicyQcAcceptanceRecordV1Schema.parse(input.acceptance);
  const bound = checkQcEvidenceAgainstRequest({ request: input.request, evidence: input.evidence });
  if (!bound.ok || bound.authority.mode !== "NORMALIZE_STATIC") return false;
  const { renderKey, policySha256 } = normalizeAuthority(bound.authority);
  const evidence = bound.evidence;
  const qcEvidenceSha256 = hashPostEncodeAudioQcEvidenceV1(evidence);
  return acceptance.e5RenderKey === renderKey && acceptance.policySha256 === policySha256 &&
    qcEvidenceSha256 === acceptance.qcEvidenceSha256 && evidence.toolchainEvidenceKey === acceptance.toolchainEvidenceKey &&
    evidence.mediaSha256 === acceptance.mediaSha256 && evidence.mediaBytes === acceptance.mediaBytes &&
    computeQcAuthorityKey({ subject: evidence.subject, mediaSha256: evidence.mediaSha256, mediaBytes: evidence.mediaBytes,
      policySha256, toolchainEvidenceKey: evidence.toolchainEvidenceKey, qcEvidenceSha256 }) === acceptance.qcAuthorityKey &&
    canonicalEditorialJson(deriveE5QcResult(evidence)) === canonicalEditorialJson(acceptance.qcResult);
}

// Media authority is created only from a PASS acceptance that verifies against the current plan; the identity comes
// from that plan, never from the caller.
export function buildMasteredMediaRecord(input: Readonly<{ request: E5QcRequest; acceptance: unknown; evidence: unknown }>): E5MasteredMediaRecordV1 {
  assertEditorial(verifyPolicyQcAcceptance(input), "acceptance is not bound to the current mastering plan (EVIDENCE_BINDING_MISMATCH)");
  const acceptance = E5PolicyQcAcceptanceRecordV1Schema.parse(input.acceptance);
  assertEditorial(acceptance.qcResult.status === "PASS", "media is recorded only on a PASS acceptance");
  const authority = deriveE5QcRequestAuthority(input.request)!;
  return parseE5MasteredMediaRecordV1({
    recordType: "BUSYBOOKIE_E5_MASTERED_MEDIA_RECORD", recordVersion: "1", status: "MASTERED", renderKey: authority.renderKey,
    renderIdentity: structuredClone(authority.renderIdentity), artifact: { sha256: acceptance.mediaSha256, bytes: acceptance.mediaBytes },
    promotingQcAuthorityKey: acceptance.qcAuthorityKey,
  });
}

// Lookup by the current plan's renderKey and policy plus the verified media identity and current toolchain key.
export function findPolicyQcAcceptance(records: readonly unknown[], query: Readonly<{
  request: E5QcRequest; mediaSha256: string; mediaBytes: number; toolchainEvidenceKey: string;
}>): E5PolicyQcAcceptanceRecordV1 | null {
  const authority = deriveE5QcRequestAuthority(query.request);
  if (authority === null) return null;
  const { renderKey, policySha256 } = normalizeAuthority(authority);
  const matches = records.map((record) => E5PolicyQcAcceptanceRecordV1Schema.parse(record)).filter((record) =>
    record.e5RenderKey === renderKey && record.mediaSha256 === query.mediaSha256 && record.mediaBytes === query.mediaBytes &&
    record.policySha256 === policySha256 && record.toolchainEvidenceKey === query.toolchainEvidenceKey);
  assertEditorial(matches.length <= 1, "acceptance records for one policy/toolchain/media must be unique");
  return matches.length === 0 ? null : freezeEditorial(matches[0]!);
}

// MEASURE_ONLY reuse (Step 1082 R13, Step 1088 A9/A11): shared request check, re-hash and toolchain equality, and for E2
// a currently matching attestation. renderKey alone never reuses evidence.
export function canReuseMeasureOnlyEvidence(input: Readonly<{
  request: E5QcRequest; evidence: unknown; currentMediaSha256: string; currentMediaBytes: number; currentToolchainEvidenceKey: string;
  attestation: unknown;
}>): boolean {
  const bound = checkQcEvidenceAgainstRequest({ request: input.request, evidence: input.evidence });
  if (!bound.ok || bound.authority.mode !== "MEASURE_ONLY") return false;
  const evidence = bound.evidence;
  if (evidence.mediaSha256 !== input.currentMediaSha256 || evidence.mediaBytes !== input.currentMediaBytes ||
    evidence.toolchainEvidenceKey !== input.currentToolchainEvidenceKey) return false;
  const record = checkUpstreamRecordBinding({ derivation: bound.authority.derivation, attestation: input.attestation,
    measuredMediaSha256: input.currentMediaSha256, measuredMediaBytes: input.currentMediaBytes });
  return record.ok && evidence.subject.kind === "UPSTREAM_MEDIA" && record.binding === evidence.subject.upstreamRecordBinding;
}

// ---------------------------------------------------------------- recovery (Step 1080 V, Step 1082 R12, Step 1088 A9)
export const E5_RECOVERY_ACTIONS = ["REUSE", "REMEASURE", "REVERIFY", "PROMOTE", "RERENDER", "DISCARD", "REQC_EXISTING_MEDIA"] as const;
export type E5RecoveryAction = (typeof E5_RECOVERY_ACTIONS)[number];

// States carry the inputs, not caller booleans: every success is decided by the shared validators.
export type E5RecoveryState =
  | Readonly<{ case: "A_MEASURED_NOT_RENDERED"; plan: unknown; mediaRoot: string; upstreamArgs: readonly unknown[];
    e3Preflight?: EditorialEditRenderPreflightResult; e4Receipt?: unknown; toolchainEvidenceKey: string; preMasterEvidence: unknown }>
  | Readonly<{ case: "B_PART_WITHOUT_QC"; request: E5QcRequest; receipt: unknown; candidatePath: string }>
  | Readonly<{ case: "C_QC_FAILED" }>
  | Readonly<{ case: "D_QC_PASSED_NOT_PROMOTED"; request: E5QcRequest; evidence: unknown; qcResult: unknown;
    candidateSha256: string; candidateBytes: number }>
  | Readonly<{ case: "E_FINAL_EXISTS"; request: E5QcRequest; mediaRecord: unknown; currentMediaSha256: string; currentMediaBytes: number;
    toolchainEvidenceKey: string; acceptances: readonly Readonly<{ acceptance: unknown; evidence: unknown }>[] }>;

export type E5RecoveryDecision =
  | Readonly<{ kind: "ACTION"; action: E5RecoveryAction }>
  | Readonly<{ kind: "FAIL_CLOSED"; reason: "FINAL_MEDIA_MISMATCH" | "QC_ACCEPTANCE_FAILED" | "QC_FAILED" | "EVIDENCE_BINDING_MISMATCH" }>;

function receiptBindsRequest(authority: E5QcRequestAuthority | null, receipt: unknown, candidatePath: string): boolean {
  if (authority === null || authority.mode !== "NORMALIZE_STATIC" || authority.masteringPlan.mode !== "NORMALIZE_STATIC") return false;
  const parsed = E5MasteringPreflightReceiptV1Schema.safeParse(receipt);
  if (!parsed.success) return false;
  const { receiptSha256, ...payload } = parsed.data;
  const plan = authority.masteringPlan;
  return digest(payload) === receiptSha256 && payload.renderKey === plan.renderKey &&
    payload.masteringPlanSha256 === authority.masteringPlanSha256 && payload.preMasterEvidenceSha256 === plan.preMasterEvidenceSha256 &&
    payload.toolchainEvidenceKey === plan.toolchainEvidenceKey && payload.candidatePath === candidatePath;
}

function finalExistsDecision(state: Extract<E5RecoveryState, { case: "E_FINAL_EXISTS" }>): E5RecoveryDecision {
  const action = (value: E5RecoveryAction): E5RecoveryDecision => freezeEditorial({ kind: "ACTION", action: value });
  const closed = (reason: Extract<E5RecoveryDecision, { kind: "FAIL_CLOSED" }>["reason"]): E5RecoveryDecision =>
    freezeEditorial({ kind: "FAIL_CLOSED", reason });
  const authority = deriveE5QcRequestAuthority(state.request);
  if (authority === null || authority.mode !== "NORMALIZE_STATIC") return closed("EVIDENCE_BINDING_MISMATCH");
  // E-1: path existence is not media authority; the record must bind this plan's renderKey and identity.
  const record = E5MasteredMediaRecordV1Schema.safeParse(state.mediaRecord);
  if (!record.success || record.data.renderKey !== authority.renderKey ||
    canonicalEditorialJson(record.data.renderIdentity) !== canonicalEditorialJson(authority.renderIdentity)) return action("RERENDER");
  // E-2: the re-hashed file must equal the record artifact; otherwise distrust it (no reuse, no deletion).
  if (record.data.artifact.sha256 !== state.currentMediaSha256 || record.data.artifact.bytes !== state.currentMediaBytes) {
    return closed("FINAL_MEDIA_MISMATCH");
  }
  // E-3..E-5: only acceptances verified against the current request, media and toolchain count.
  const verified = state.acceptances.filter((pair) => verifyPolicyQcAcceptance({ request: state.request, ...pair })).map((pair) =>
    E5PolicyQcAcceptanceRecordV1Schema.parse(pair.acceptance)).filter((acceptance) => acceptance.mediaSha256 === state.currentMediaSha256 &&
    acceptance.mediaBytes === state.currentMediaBytes && acceptance.toolchainEvidenceKey === state.toolchainEvidenceKey);
  assertEditorial(verified.length <= 1, "acceptance records for one policy/toolchain/media must be unique");
  if (verified.length === 0) return action("REQC_EXISTING_MEDIA");
  return verified[0]!.qcResult.status === "PASS" ? action("REUSE") : closed("QC_ACCEPTANCE_FAILED");
}

// Pure: never assumes success, never deletes promoted media, never changes gain, never reuses another policy's PASS.
export function recoveryAction(state: E5RecoveryState): E5RecoveryDecision {
  const action = (value: E5RecoveryAction): E5RecoveryDecision => freezeEditorial({ kind: "ACTION", action: value });
  switch (state.case) {
    case "A_MEASURED_NOT_RENDERED": {
      const derived = deriveAudioMasteringUpstream({ plan: state.plan, mediaRoot: state.mediaRoot });
      if (!derived.ok) return action("REMEASURE");
      const argv = checkAudioMasteringUpstreamArgv({ derivation: derived.derivation, args: state.upstreamArgs,
        ...(state.e3Preflight === undefined ? {} : { e3Preflight: state.e3Preflight }),
        ...(state.e4Receipt === undefined ? {} : { e4Receipt: state.e4Receipt }) });
      if (!argv.ok) return action("REMEASURE");
      const binding = checkPreMasterEvidenceBinding({ evidence: state.preMasterEvidence, derivation: derived.derivation,
        upstreamArgs: argv.args, toolchainEvidenceKey: state.toolchainEvidenceKey });
      return action(binding.ok ? "REUSE" : "REMEASURE");
    }
    case "B_PART_WITHOUT_QC":
      return action(receiptBindsRequest(deriveE5QcRequestAuthority(state.request), state.receipt, state.candidatePath) ? "REVERIFY" : "DISCARD");
    case "C_QC_FAILED":
      return freezeEditorial({ kind: "FAIL_CLOSED", reason: "QC_FAILED" });
    case "D_QC_PASSED_NOT_PROMOTED":
      return action(checkCandidatePromotable(state).ok ? "PROMOTE" : "REVERIFY");
    case "E_FINAL_EXISTS":
      return finalExistsDecision(state);
  }
}
