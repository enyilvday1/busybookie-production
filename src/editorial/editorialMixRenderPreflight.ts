import { posix, win32 } from "node:path";
import { z } from "zod";
import { assertEditorialMixRenderPlanIntegrity, type EditorialMixRenderPlan } from "./buildEditorialMixRenderPlan.js";
import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import { frameToSample } from "./deriveEditorialTimeline.js";
import type { EditorialReadonly } from "./editorialPlan.schema.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

// +1.0f as an IEEE-754 binary32 bit pattern; finite non-negative binary32 patterns order like their values.
export const E4_MAX_SAMPLE_PEAK_F32_BITS = 0x3f800000;
export const E4_MAX_FINITE_F32_BITS = 0x7f7fffff;

const count = z.number().refine((n) => Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0), "Expected a non-negative safe integer.");
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const name = z.string().min(1);

// Caller-attested physical evidence. No schema carries a filesystem path.
export const E4BaseShotEvidenceV1Schema = z.object({
  assetId: name, sha256: sha, bytes: count, decodedVideoFrameCount: count, decodedAudioSampleCount: count,
}).strict();

export const E4ExternalAudioEvidenceV1Schema = z.object({
  assetId: name, sha256: sha, bytes: count, riffHeaderId: z.string(), formatName: z.string(),
  streamCount: count, audioStreamCount: count, codec: z.string(), sampleFormat: z.string(), sampleRateHz: count,
  channelCount: count, reportedChannelLayout: z.enum(["MONO", "STEREO", "UNSPECIFIED"]), decodedSampleFrameCount: count,
}).strict();

// Pre-encode float-domain discrete sample peak only: not true peak, not loudness, not post-AAC safety.
export const E4PeakEvidenceV1Schema = z.object({
  renderKey: sha, mixGraphSha256: sha, channelCount: count, decodedSampleFrameCount: count,
  nonFiniteSampleCount: count, maxAbsSampleF32Bits: count,
}).strict();

export const E4PreflightReceiptV1Schema = z.object({
  receiptType: z.literal("BUSYBOOKIE_E4_PREFLIGHT_RECEIPT"),
  receiptVersion: z.literal("1"),
  renderKey: sha,
  mixGraphSha256: sha,
  outputPath: name,
  baseEvidenceSha256: sha,
  externalEvidenceSha256: sha,
  peakEvidenceSha256: sha,
  receiptSha256: sha,
}).strict();

export type E4BaseShotEvidenceV1 = EditorialReadonly<z.infer<typeof E4BaseShotEvidenceV1Schema>>;
export type E4ExternalAudioEvidenceV1 = EditorialReadonly<z.infer<typeof E4ExternalAudioEvidenceV1Schema>>;
export type E4PeakEvidenceV1 = EditorialReadonly<z.infer<typeof E4PeakEvidenceV1Schema>>;
export type E4PreflightReceiptV1 = EditorialReadonly<z.infer<typeof E4PreflightReceiptV1Schema>>;

export type EditorialMixRenderPreflightInput = Readonly<{
  renderPlan: EditorialMixRenderPlan;
  baseEvidence: readonly unknown[];
  externalEvidence: readonly unknown[];
  peakEvidence: unknown;
  outputPath: string;
}>;

function parse<T>(schema: z.ZodType<T>, value: unknown, detail: string): T {
  const parsed = schema.safeParse(value);
  assertEditorial(parsed.success, `${detail} is invalid: ${parsed.error?.message ?? ""}`);
  return parsed.data;
}

function digest(value: unknown): string {
  return editorialSha256(canonicalEditorialJson(value));
}

// Exactly one record per required asset id, no unknown records; result follows the required (inputIndex) order.
function matchEvidence<T extends Readonly<{ assetId: string }>>(records: readonly T[], required: readonly string[], kind: string): T[] {
  for (const record of records) assertEditorial(required.includes(record.assetId), `preflight ${kind} evidence for unknown asset ${record.assetId}`);
  return required.map((assetId) => {
    const matches = records.filter((record) => record.assetId === assetId);
    assertEditorial(matches.length === 1, `preflight requires exactly one ${kind} evidence record for ${assetId}`);
    return matches[0]!;
  });
}

function isAbsolutePath(value: string): boolean {
  return win32.isAbsolute(value) || posix.isAbsolute(value);
}

// Exact code-unit equality only: no trimming, resolution, case folding or separator rewriting.
export function assertEditorialMixOutputPath(renderPlan: EditorialMixRenderPlan, outputPath: unknown, detail: string): string {
  assertEditorial(typeof outputPath === "string" && outputPath.length > 0 && outputPath === outputPath.trim() &&
    isAbsolutePath(outputPath), `${detail} requires an absolute path without surrounding whitespace`);
  assertEditorial(renderPlan.inputs.every((entry) => entry.path !== outputPath), `${detail} must differ from every input`);
  return outputPath;
}

function receiptPayloadHash(receipt: Omit<E4PreflightReceiptV1, "receiptSha256">): string {
  return digest(receipt);
}

// Pure, synchronous and stateless: the receipt is a deterministic value over the supplied evidence. It proves only
// that caller-attested evidence is internally consistent with this plan; it is not a signature or attestation.
export function assertEditorialMixRenderPreflight(input: EditorialMixRenderPreflightInput): E4PreflightReceiptV1 {
  const plan = input.renderPlan;
  assertEditorialMixRenderPlanIntegrity(plan);
  const outputPath = assertEditorialMixOutputPath(plan, input.outputPath, "preflight output path");
  const shots = plan.inputs.flatMap((entry) => (entry.mediaKind === "NORMALIZED_SHOT" ? [entry] : []));
  const externals = plan.inputs.flatMap((entry) => (entry.mediaKind === "EXTERNAL_AUDIO" ? [entry] : []));
  const base = matchEvidence(input.baseEvidence.map((record) => parse(E4BaseShotEvidenceV1Schema, record, "base shot evidence")),
    shots.map((entry) => entry.assetId), "base shot");
  for (const [index, entry] of shots.entries()) {
    const record = base[index]!;
    assertEditorial(record.sha256 === entry.sha256 && record.bytes === entry.bytes, `preflight: ${entry.assetId} content identity mismatch`);
    assertEditorial(record.decodedVideoFrameCount >= entry.assetDurationFrames, `preflight: ${entry.assetId} decodes fewer frames than its canonical range`);
    assertEditorial(record.decodedAudioSampleCount >= frameToSample(entry.assetDurationFrames),
      `preflight: ${entry.assetId} decodes fewer audio samples than its canonical range`);
  }
  const external = matchEvidence(input.externalEvidence.map((record) => parse(E4ExternalAudioEvidenceV1Schema, record, "external audio evidence")),
    externals.map((entry) => entry.assetId), "external audio");
  for (const [index, entry] of externals.entries()) {
    const record = external[index]!;
    const label = `preflight: ${entry.assetId}`;
    assertEditorial(record.sha256 === entry.sha256 && record.bytes === entry.bytes, `${label} content identity mismatch`);
    assertEditorial(record.riffHeaderId === "RIFF" && record.formatName === "wav", `${label} is not a classic RIFF/WAVE file`);
    assertEditorial(record.streamCount === 1 && record.audioStreamCount === 1, `${label} must contain exactly one audio stream`);
    assertEditorial(record.codec === "pcm_s16le" && record.sampleFormat === "s16", `${label} is not pcm_s16le`);
    assertEditorial(record.sampleRateHz === 48000, `${label} sample rate is not 48000 Hz`);
    assertEditorial((record.channelCount === 1 || record.channelCount === 2) && record.channelCount === entry.channelCount,
      `${label} channel count does not match the admitted asset`);
    const compatible = record.reportedChannelLayout === "UNSPECIFIED" ||
      record.reportedChannelLayout === (record.channelCount === 1 ? "MONO" : "STEREO");
    assertEditorial(compatible, `${label} reported channel layout contradicts its channel count`);
    assertEditorial(record.decodedSampleFrameCount === entry.assetDurationSamples, `${label} decoded sample frames differ from the declared duration`);
  }
  const peak = parse(E4PeakEvidenceV1Schema, input.peakEvidence, "peak evidence");
  assertEditorial(peak.renderKey === plan.renderKey, "peak evidence belongs to a different render key");
  assertEditorial(peak.mixGraphSha256 === plan.mixGraphSha256, "peak evidence belongs to a different mix graph");
  assertEditorial(peak.channelCount === 2 && peak.decodedSampleFrameCount === plan.timelineDurationSamples,
    "peak evidence must cover the full stereo timeline");
  assertEditorial(peak.nonFiniteSampleCount === 0 && peak.maxAbsSampleF32Bits <= E4_MAX_FINITE_F32_BITS,
    "peak evidence contains non-finite samples");
  assertEditorial(peak.maxAbsSampleF32Bits <= E4_MAX_SAMPLE_PEAK_F32_BITS, "pre-encode sample peak exceeds digital full scale");
  const payload = {
    receiptType: "BUSYBOOKIE_E4_PREFLIGHT_RECEIPT" as const, receiptVersion: "1" as const,
    renderKey: plan.renderKey, mixGraphSha256: plan.mixGraphSha256, outputPath,
    baseEvidenceSha256: digest(base), externalEvidenceSha256: digest(external), peakEvidenceSha256: digest(peak),
  };
  return freezeEditorial({ ...payload, receiptSha256: receiptPayloadHash(payload) });
}

// Integrity of a (possibly deserialized) receipt value: exact schema plus recomputed checksum.
export function parseEditorialMixPreflightReceipt(input: unknown): E4PreflightReceiptV1 {
  const receipt = parse(E4PreflightReceiptV1Schema, input, "preflight receipt");
  const { receiptSha256, ...payload } = receipt;
  assertEditorial(receiptPayloadHash(payload) === receiptSha256, "preflight receipt checksum does not match its content");
  return freezeEditorial(receipt);
}

// Re-runs the pure preflight over the supplied evidence and requires the identical receipt value.
export function verifyEditorialMixPreflightReceipt(input: EditorialMixRenderPreflightInput & Readonly<{ receipt: unknown }>): E4PreflightReceiptV1 {
  const receipt = parseEditorialMixPreflightReceipt(input.receipt);
  const expected = assertEditorialMixRenderPreflight(input);
  assertEditorial(canonicalEditorialJson(receipt) === canonicalEditorialJson(expected),
    "preflight receipt does not correspond to the supplied plan, evidence and output path");
  return receipt;
}
