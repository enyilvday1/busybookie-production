import { z } from "zod";
import { E5_MEASUREMENT_ENGINE } from "./audioDeliveryPolicy.schema.js";
import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import {
  buildPreMasterMeasurementCommand, measurementArgvSha256, upstreamFilterComplexSha256,
} from "./buildAudioMasteringFfmpegCommands.js";
import {
  E5UpstreamRenderAuthorityV1Schema, upstreamMatchesDerivation, type E5UpstreamDerivation,
} from "./deriveAudioMasteringUpstream.js";
import type { EditorialReadonly } from "./editorialPlan.schema.js";
import {
  LOUDNORM_PARSE_FAILURE_CODES, LoudnessMeasurementV1Schema, parseLoudnormMeasurement, type LoudnormParseFailureClass,
} from "./parseLoudnormMeasurement.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().refine((n) => Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0), "Expected a non-negative safe integer.");
const positive = count.refine((n) => n > 0, "Expected a positive safe integer.");
const exitCode = z.number().refine((n) => Number.isSafeInteger(n) && !Object.is(n, -0), "Expected an integer exit code.").nullable();
const line = z.string().min(1).refine((s) => !s.includes("\n") && !s.includes("\r"), "Expected one complete line.");

function digest(value: unknown): string {
  return editorialSha256(canonicalEditorialJson(value));
}

function parse<T>(schema: z.ZodType<T>, value: unknown, detail: string): T {
  const parsed = schema.safeParse(value);
  assertEditorial(parsed.success, `${detail} is invalid: ${parsed.error?.message ?? ""}`);
  return freezeEditorial(parsed.data);
}

// ---------------------------------------------------------------- toolchain evidence (Step 1080 L)
export const E5_REQUIRED_FILTERS = [
  "adelay", "afade", "aformat", "amix", "asetpts", "asettb", "asplit", "atrim", "concat", "format", "fps",
  "loudnorm", "nullsink", "pan", "setpts", "settb", "trim", "volume", "xfade",
] as const;

export const MasteringToolchainEvidenceV1Schema = z.object({
  evidenceType: z.literal("BUSYBOOKIE_E5_TOOLCHAIN_EVIDENCE"),
  evidenceVersion: z.literal("1"),
  ffmpegVersionLine: line,
  ffmpegSha256: sha,
  ffprobeVersionLine: line,
  ffprobeSha256: sha,
  requiredFilters: z.array(z.string()).refine((list) => list.length === E5_REQUIRED_FILTERS.length &&
    list.every((name, index) => name === E5_REQUIRED_FILTERS[index]), "requiredFilters must be the exact sorted frozen list"),
  measurementEngine: z.literal(E5_MEASUREMENT_ENGINE),
  invocationModel: z.literal("DIRECT_SPAWN_ARGV_NO_SHELL_V1"),
}).strict();
export type MasteringToolchainEvidenceV1 = EditorialReadonly<z.infer<typeof MasteringToolchainEvidenceV1Schema>>;

// Executable paths are never fields; the key is the canonical hash of the complete evidence.
export function toolchainEvidenceKey(evidence: unknown): string {
  return digest(parse(MasteringToolchainEvidenceV1Schema, evidence, "toolchain evidence"));
}

// ---------------------------------------------------------------- pre-master loudness evidence (Step 1080 Q, 1082 R7)
export const PreMasterLoudnessEvidenceV1Schema = z.object({
  evidenceType: z.literal("BUSYBOOKIE_E5_PREMASTER_LOUDNESS_EVIDENCE"),
  evidenceVersion: z.literal("1"),
  upstream: E5UpstreamRenderAuthorityV1Schema,
  upstreamFilterComplexSha256: sha,
  measurementArgvSha256: sha,
  measurementEngine: z.literal(E5_MEASUREMENT_ENGINE),
  toolchainEvidenceKey: sha,
  timelineDurationSamples: positive,
  measurement: LoudnessMeasurementV1Schema,
}).strict();
export type PreMasterLoudnessEvidenceV1 = EditorialReadonly<z.infer<typeof PreMasterLoudnessEvidenceV1Schema>>;

export function parsePreMasterLoudnessEvidenceV1(input: unknown): PreMasterLoudnessEvidenceV1 {
  const evidence = parse(PreMasterLoudnessEvidenceV1Schema, input, "pre-master loudness evidence");
  assertEditorial(evidence.timelineDurationSamples === evidence.upstream.timelineDurationSamples,
    "pre-master evidence T differs from its upstream authority");
  return evidence;
}

export function hashPreMasterLoudnessEvidenceV1(input: unknown): string {
  return digest(parsePreMasterLoudnessEvidenceV1(input));
}

export type PreMasterLoudnessEvidenceResult =
  | Readonly<{ ok: true; evidence: PreMasterLoudnessEvidenceV1; evidenceSha256: string }>
  | Readonly<{ ok: false; reasons: readonly [LoudnormParseFailureClass] }>;

// Evidence from the raw stderr of the exact pre-master measurement command over a validated upstream argv.
export function buildPreMasterLoudnessEvidence(input: Readonly<{
  derivation: E5UpstreamDerivation; upstreamArgs: readonly string[]; toolchainEvidenceKey: string; stderr: Uint8Array;
}>): PreMasterLoudnessEvidenceResult {
  assertEditorial(sha.safeParse(input.toolchainEvidenceKey).success, "pre-master evidence requires a toolchain evidence key");
  const command = buildPreMasterMeasurementCommand({ ffmpegExecutable: "ffmpeg", derivation: input.derivation, upstreamArgs: input.upstreamArgs });
  const parsed = parseLoudnormMeasurement(input.stderr);
  if (!parsed.ok) return freezeEditorial({ ok: false, reasons: [parsed.class] as const });
  const evidence = parsePreMasterLoudnessEvidenceV1({
    evidenceType: "BUSYBOOKIE_E5_PREMASTER_LOUDNESS_EVIDENCE", evidenceVersion: "1",
    upstream: structuredClone(input.derivation.upstream),
    upstreamFilterComplexSha256: upstreamFilterComplexSha256(input.upstreamArgs),
    measurementArgvSha256: measurementArgvSha256(command.args),
    measurementEngine: E5_MEASUREMENT_ENGINE, toolchainEvidenceKey: input.toolchainEvidenceKey,
    timelineDurationSamples: input.derivation.timelineDurationSamples, measurement: structuredClone(parsed.measurement),
  });
  return freezeEditorial({ ok: true, evidence, evidenceSha256: digest(evidence) });
}

export type PreMasterBindingCheck = Readonly<{ ok: true } | { ok: false; reasons: readonly ["REMEASURE_REQUIRED" | "EVIDENCE_BINDING_MISMATCH"] }>;

// Valid for gain derivation only if upstream authority, FC hash, measurement argv hash, T and toolchain key all match
// the current derivation. A toolchain difference is REMEASURE_REQUIRED (never reused).
export function checkPreMasterEvidenceBinding(input: Readonly<{
  evidence: unknown; derivation: E5UpstreamDerivation; upstreamArgs: readonly string[]; toolchainEvidenceKey: string;
}>): PreMasterBindingCheck {
  const evidence = parsePreMasterLoudnessEvidenceV1(input.evidence);
  if (evidence.toolchainEvidenceKey !== input.toolchainEvidenceKey) return freezeEditorial({ ok: false, reasons: ["REMEASURE_REQUIRED"] as const });
  const command = buildPreMasterMeasurementCommand({ ffmpegExecutable: "ffmpeg", derivation: input.derivation, upstreamArgs: input.upstreamArgs });
  const bound = upstreamMatchesDerivation(evidence.upstream, input.derivation) &&
    evidence.upstreamFilterComplexSha256 === upstreamFilterComplexSha256(input.upstreamArgs) &&
    evidence.measurementArgvSha256 === measurementArgvSha256(command.args) &&
    evidence.timelineDurationSamples === input.derivation.timelineDurationSamples;
  return bound ? freezeEditorial({ ok: true }) : freezeEditorial({ ok: false, reasons: ["EVIDENCE_BINDING_MISMATCH"] as const });
}

// ---------------------------------------------------------------- post-encode QC evidence (1082 R10, 1084 R5, 1086 A1-A9)
// Canonical precedence order (the Step 1080 enum order); terminalReason is the first present failure.
export const E5_QC_FAILURE_PRECEDENCE = [
  "PROBE_FAILURE", "DECODE_FAILURE", "MEASUREMENT_FAILURE", "MISSING_AUDIO", "UNEXPECTED_STREAMS", "WRONG_CODEC",
  "WRONG_SAMPLE_RATE", "WRONG_CHANNEL_COUNT", "WRONG_CHANNEL_LAYOUT", "VIDEO_CONTRACT_MISMATCH", "DURATION_MISMATCH",
  "NON_FINITE_AUDIO", "LOUDNESS_UNDEFINED_SILENCE", "LOUDNESS_OUT_OF_RANGE", "TRUE_PEAK_EXCEEDED",
  "EVIDENCE_BINDING_MISMATCH", "TOOLCHAIN_MISMATCH",
] as const;
export type E5QcFailure = (typeof E5_QC_FAILURE_PRECEDENCE)[number];

export const E5_CARDINALITY_FAILURES = ["MISSING_AUDIO", "UNEXPECTED_STREAMS"] as const;
export const E5_PER_STREAM_METADATA_FAILURES = [
  "WRONG_CODEC", "WRONG_SAMPLE_RATE", "WRONG_CHANNEL_COUNT", "WRONG_CHANNEL_LAYOUT", "VIDEO_CONTRACT_MISMATCH",
] as const;
export const E5_MEASURED_FAILURES = [
  "DURATION_MISMATCH", "NON_FINITE_AUDIO", "LOUDNESS_UNDEFINED_SILENCE", "LOUDNESS_OUT_OF_RANGE", "TRUE_PEAK_EXCEEDED",
] as const;

export const E5_PROBE_FAILURE_CODES = [
  "PROBE_PROCESS_LAUNCH_FAILURE", "PROBE_NONZERO_EXIT", "PROBE_OUTPUT_INVALID_UTF8", "PROBE_OUTPUT_MALFORMED_JSON",
  "PROBE_OUTPUT_SCHEMA_MISMATCH",
] as const;
export const E5_DECODE_FAILURE_CODES = [
  "DECODE_PROCESS_LAUNCH_FAILURE", "DECODE_NONZERO_EXIT", "DECODE_OUTPUT_MISSING", "DECODE_OUTPUT_NOT_FRAME_ALIGNED",
] as const;
export const E5_MEASUREMENT_ATTEMPT_FAILURE_CODES = [
  "MEASUREMENT_PROCESS_LAUNCH_FAILURE", "MEASUREMENT_NONZERO_EXIT", ...LOUDNORM_PARSE_FAILURE_CODES,
] as const;

// codes[0] is always the launch failure and codes[1] the nonzero exit: exit code and failure code determine each other
// (null exit <=> launch failure; nonzero exit <=> nonzero-exit code; exit 0 <=> success or an output defect).
function attempt<T extends readonly [string, string, ...string[]]>(codes: T, outcome: "SUCCESS" | "FAILURE") {
  return z.object({
    argvSha256: sha,
    exitCode,
    failureCode: outcome === "SUCCESS" ? z.null() : z.enum(codes),
  }).strict().refine((value) => {
    if (outcome === "SUCCESS") return value.exitCode === 0;
    if (value.exitCode === null) return value.failureCode === codes[0];
    if (value.exitCode !== 0) return value.failureCode === codes[1];
    return value.failureCode !== codes[0] && value.failureCode !== codes[1];
  }, "attempt exit code and failure code are inconsistent");
}

// Canonical probe (Step 1086 A3/A4/A8): counts over the admitted inventory; selected streams by lowest numeric index.
export const E5CanonicalProbeV1Schema = z.object({
  formatName: z.string(),
  nbStreams: count,
  videoStreamCount: count,
  audioStreamCount: count,
  otherStreamCount: count,
  formatDurationText: z.string().nullable(),
  video: z.object({
    codecName: z.string(), profile: z.string().nullable(), width: count, height: count, pixFmt: z.string(),
    rFrameRate: z.string(), nbReadFrames: count,
  }).strict().nullable(),
  audio: z.object({
    codecName: z.string(), profile: z.string().nullable(), sampleRateHz: count, channels: count,
    channelLayout: z.string().nullable(), reportedBitRate: count.nullable(),
  }).strict().nullable(),
}).strict().refine((probe) => (probe.video === null) === (probe.videoStreamCount === 0) &&
  (probe.audio === null) === (probe.audioStreamCount === 0), "a selected stream is null exactly when its type count is zero");
export type E5CanonicalProbeV1 = EditorialReadonly<z.infer<typeof E5CanonicalProbeV1Schema>>;

export const E5DecodedAudioV1Schema = z.object({
  sampleFrameCount: count, nonFiniteSampleCount: count, maxAbsSampleF32Bits: count,
}).strict();

// Step 1088 A10: the UPSTREAM_MEDIA route and its record-binding label are one authority.
export const E5_UPSTREAM_RECORD_BINDING_BY_ROUTE = {
  E2_ROUGH_CUT: "E2_RENDER_RECORD_VERIFIED", E3_EDIT: "NO_UPSTREAM_RECORD_LIFECYCLE", E4_MIX: "NO_UPSTREAM_RECORD_LIFECYCLE",
} as const;

function assertSubjectRouteBinding(subject: z.infer<typeof QcSubjectSchema>): void {
  if (subject.kind === "UPSTREAM_MEDIA") {
    assertEditorial(subject.upstreamRecordBinding === E5_UPSTREAM_RECORD_BINDING_BY_ROUTE[subject.route],
      "UPSTREAM_MEDIA record binding does not belong to its route");
  }
}

const QcSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("E5_CANDIDATE"), e5RenderKey: sha }).strict(),
  z.object({
    kind: z.literal("UPSTREAM_MEDIA"), route: z.enum(["E2_ROUGH_CUT", "E3_EDIT", "E4_MIX"]), upstreamRenderKey: sha,
    upstreamRecordBinding: z.enum(["E2_RENDER_RECORD_VERIFIED", "NO_UPSTREAM_RECORD_LIFECYCLE"]),
  }).strict(),
]);

const common = {
  evidenceType: z.literal("BUSYBOOKIE_E5_POST_ENCODE_AUDIO_QC_EVIDENCE"),
  evidenceVersion: z.literal("1"),
  status: z.enum(["PASS", "FAIL"]),
  terminalReason: z.enum(["PASS", ...E5_QC_FAILURE_PRECEDENCE]),
  failures: z.array(z.enum(E5_QC_FAILURE_PRECEDENCE)),
  subject: QcSubjectSchema,
  mediaSha256: sha,
  mediaBytes: positive,
  policySha256: sha.nullable(),
  toolchainEvidenceKey: sha,
  expected: z.object({ timelineDurationSamples: positive, timelineDurationFrames: positive }).strict(),
};

export const PostEncodeAudioQcEvidenceV1Schema = z.discriminatedUnion("stage", [
  z.object({ ...common, stage: z.literal("PROBE_FAILED"), probeAttempt: attempt(E5_PROBE_FAILURE_CODES, "FAILURE") }).strict(),
  z.object({
    ...common, stage: z.literal("METADATA_REJECTED"), probeAttempt: attempt(E5_PROBE_FAILURE_CODES, "SUCCESS"),
    probe: E5CanonicalProbeV1Schema,
  }).strict(),
  z.object({
    ...common, stage: z.literal("DECODE_FAILED"), probeAttempt: attempt(E5_PROBE_FAILURE_CODES, "SUCCESS"),
    probe: E5CanonicalProbeV1Schema, decodeAttempt: attempt(E5_DECODE_FAILURE_CODES, "FAILURE"),
  }).strict(),
  z.object({
    ...common, stage: z.literal("MEASUREMENT_FAILED"), probeAttempt: attempt(E5_PROBE_FAILURE_CODES, "SUCCESS"),
    probe: E5CanonicalProbeV1Schema, decodeAttempt: attempt(E5_DECODE_FAILURE_CODES, "SUCCESS"), decoded: E5DecodedAudioV1Schema,
    measurementAttempt: attempt(E5_MEASUREMENT_ATTEMPT_FAILURE_CODES, "FAILURE"),
  }).strict(),
  z.object({
    ...common, stage: z.literal("MEASURED"), probeAttempt: attempt(E5_PROBE_FAILURE_CODES, "SUCCESS"),
    probe: E5CanonicalProbeV1Schema, decodeAttempt: attempt(E5_DECODE_FAILURE_CODES, "SUCCESS"), decoded: E5DecodedAudioV1Schema,
    measurementAttempt: attempt(E5_MEASUREMENT_ATTEMPT_FAILURE_CODES, "SUCCESS"), loudness: LoudnessMeasurementV1Schema,
  }).strict(),
]);
export type PostEncodeAudioQcEvidenceV1 = EditorialReadonly<z.infer<typeof PostEncodeAudioQcEvidenceV1Schema>>;

// Fixed failure sets per terminal stage: one canonical encoding per observation.
const STAGE_FAILURES: Readonly<Record<PostEncodeAudioQcEvidenceV1["stage"], readonly E5QcFailure[]>> = {
  PROBE_FAILED: ["PROBE_FAILURE"],
  METADATA_REJECTED: [...E5_CARDINALITY_FAILURES, ...E5_PER_STREAM_METADATA_FAILURES],
  DECODE_FAILED: ["DECODE_FAILURE"],
  MEASUREMENT_FAILED: ["MEASUREMENT_FAILURE"],
  MEASURED: E5_MEASURED_FAILURES,
};

export function sortQcFailures(failures: readonly E5QcFailure[]): E5QcFailure[] {
  return [...new Set(failures)].sort();
}

export function terminalReasonOf(failures: readonly E5QcFailure[]): "PASS" | E5QcFailure {
  return E5_QC_FAILURE_PRECEDENCE.find((code) => failures.includes(code)) ?? "PASS";
}

export function parsePostEncodeAudioQcEvidenceV1(input: unknown): PostEncodeAudioQcEvidenceV1 {
  const evidence = parse(PostEncodeAudioQcEvidenceV1Schema, input, "post-encode QC evidence");
  const failures = evidence.failures;
  assertEditorial(canonicalEditorialJson(failures) === canonicalEditorialJson(sortQcFailures(failures)),
    "QC failures must be sorted and unique");
  assertEditorial(failures.every((code) => STAGE_FAILURES[evidence.stage].includes(code)), "QC failure is impossible at this stage");
  assertEditorial(evidence.terminalReason === terminalReasonOf(failures), "QC terminalReason is not the first failure in precedence");
  assertEditorial((evidence.status === "PASS") === (failures.length === 0), "QC status must be PASS exactly when there are no failures");
  assertEditorial(evidence.stage === "MEASURED" || failures.length > 0, "a terminal stage failure must carry its failure");
  if (evidence.stage === "PROBE_FAILED" || evidence.stage === "DECODE_FAILED" || evidence.stage === "MEASUREMENT_FAILED") {
    assertEditorial(failures.length === 1, "a process/parser stage failure carries exactly its own failure");
  }
  if (evidence.stage === "METADATA_REJECTED" && failures.some((code) => (E5_CARDINALITY_FAILURES as readonly string[]).includes(code))) {
    assertEditorial(failures.length === 1, "a cardinality rejection carries exactly one failure");
  }
  assertSubjectRouteBinding(evidence.subject);
  if (evidence.subject.kind === "E5_CANDIDATE") assertEditorial(evidence.policySha256 !== null, "E5 candidate QC requires a policy");
  assertEditorial(evidence.expected.timelineDurationSamples === evidence.expected.timelineDurationFrames * 1_920,
    "QC expected samples must equal expected frames x 1920");
  return evidence;
}

export function hashPostEncodeAudioQcEvidenceV1(input: unknown): string {
  return digest(parsePostEncodeAudioQcEvidenceV1(input));
}

// ---------------------------------------------------------------- QC result (Step 1080 T)
export const E5QcResultV1Schema = z.object({
  resultType: z.literal("BUSYBOOKIE_E5_QC_RESULT"),
  resultVersion: z.literal("1"),
  evidenceSha256: sha,
  policySha256: sha.nullable(),
  status: z.enum(["PASS", "FAIL"]),
  failures: z.array(z.enum(E5_QC_FAILURE_PRECEDENCE)),
  informational: z.object({
    reportedBitRate: count.nullable(), loudnessRangeCentiLu: count.nullable(), maxAbsSampleF32Bits: count.nullable(),
    formatDurationText: z.string().nullable(),
  }).strict(),
}).strict();
export type E5QcResultV1 = EditorialReadonly<z.infer<typeof E5QcResultV1Schema>>;

// ---------------------------------------------------------------- policy-specific QC authority (Step 1082 R12)
export function computeQcAuthorityKey(input: Readonly<{
  subject: unknown; mediaSha256: string; mediaBytes: number; policySha256: string | null; toolchainEvidenceKey: string;
  qcEvidenceSha256: string;
}>): string {
  const subject = parse(QcSubjectSchema, input.subject, "QC authority subject");
  assertSubjectRouteBinding(subject);
  assertEditorial(sha.safeParse(input.mediaSha256).success && positive.safeParse(input.mediaBytes).success &&
    (input.policySha256 === null || sha.safeParse(input.policySha256).success) && sha.safeParse(input.toolchainEvidenceKey).success &&
    sha.safeParse(input.qcEvidenceSha256).success, "QC authority key inputs are malformed");
  return digest({
    authorityType: "BUSYBOOKIE_E5_POLICY_QC_AUTHORITY", authorityVersion: "1", subject,
    mediaSha256: input.mediaSha256, mediaBytes: input.mediaBytes, policySha256: input.policySha256,
    toolchainEvidenceKey: input.toolchainEvidenceKey, qcEvidenceSha256: input.qcEvidenceSha256,
  });
}
