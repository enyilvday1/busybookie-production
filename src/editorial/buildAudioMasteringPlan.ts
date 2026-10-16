import { posix, win32 } from "node:path";
import { z } from "zod";
import type { AudioDeliveryPolicyV1 } from "./audioDeliveryPolicy.schema.js";
import { checkMasteringDecisionsAgainstSource } from "./audioMasteringDecisions.schema.js";
import {
  checkPreMasterEvidenceBinding, hashPreMasterLoudnessEvidenceV1, parsePreMasterLoudnessEvidenceV1,
} from "./audioMasteringEvidence.schema.js";
import { applyMasteringRewriteLaw, type AudioMasteringFfmpegCommand } from "./buildAudioMasteringFfmpegCommands.js";
import { E3RenderIdentityV1Schema, EDITORIAL_EDIT_OUTPUT_CONTRACT } from "./buildEditorialEditRenderPlan.js";
import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import {
  checkAudioMasteringUpstreamArgv, deriveAudioMasteringUpstream, E5UpstreamRenderAuthorityV1Schema,
  upstreamMatchesDerivation, validateE5UpstreamRenderAuthorityV1, type E5UpstreamDerivation,
} from "./deriveAudioMasteringUpstream.js";
import type { EditorialEditRenderPreflightResult } from "./editorialEditRenderPreflight.js";
import type { EditorialReadonly } from "./editorialPlan.schema.js";
import type { LoudnessMeasurementV1 } from "./parseLoudnormMeasurement.js";
import { editorialRoot } from "./resolveEditorialAssetPath.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

// Immutable render behaviour contract: any output-affecting change requires a new profile id.
export const E5_AUDIO_MASTERING_PROFILE_ID = "busybookie-episode-audio-mastering-v1";
export const E5_OUTPUT_CONTRACT = freezeEditorial({ ...structuredClone(EDITORIAL_EDIT_OUTPUT_CONTRACT), aacTarget: "192k" as const });

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const int =z.number().refine((n) => Number.isSafeInteger(n) && !Object.is(n, -0), "Expected a safe integer.");
const gain = int.refine((n) => n >= -9_600 && n <= 1_200, "Expected gain in -9600..1200 centi-dB.");
const OutputSchema = E3RenderIdentityV1Schema.shape.output.extend({ aacTarget: z.literal("192k") }).strict()
  .refine((output) => canonicalEditorialJson(output) === canonicalEditorialJson(E5_OUTPUT_CONTRACT), "E5 output contract mismatch");

function digest(value: unknown): string {
  return editorialSha256(canonicalEditorialJson(value));
}

// ---------------------------------------------------------------- static gain and pre-render safety (Step 1080 N/O)
export type PreRenderReason =
  | "POLICY_REQUIRED" | "POLICY_INVALID" | "NOT_MASTERABLE_UPSTREAM" | "UPSTREAM_ARGV_MISMATCH"
  | "MEASUREMENT_PARSE_FAILURE" | "INVALID_LINE_ENDING" | "NON_FINITE_MEASUREMENT" | "MEASUREMENT_INCONSISTENT"
  | "NOT_MASTERABLE_SILENCE" | "GAIN_BELOW_POLICY_MINIMUM" | "GAIN_ABOVE_POLICY_MAXIMUM" | "PREDICTED_TRUE_PEAK_EXCEEDED"
  | "EVIDENCE_BINDING_MISMATCH" | "REMEASURE_REQUIRED";

export type StaticGainResult =
  | Readonly<{ ok: true; gainCentiDb: number; predictedIntegratedCentiLufs: number; predictedTruePeakCentiDbtp: number }>
  | Readonly<{ ok: false; reasons: readonly PreRenderReason[] }>;

function rejected(reasons: readonly PreRenderReason[]): Readonly<{ ok: false; reasons: readonly PreRenderReason[] }> {
  return freezeEditorial({ ok: false, reasons: [...new Set(reasons)].sort() });
}

// g = target - measured integrated: exact integer centi-dB subtraction, never clamped, never rounded.
export function deriveStaticGain(policy: AudioDeliveryPolicyV1, measurement: LoudnessMeasurementV1): StaticGainResult {
  if (measurement.class === "BELOW_ABSOLUTE_GATE") return rejected(["NOT_MASTERABLE_SILENCE"]);
  const gainCentiDb = policy.targetIntegratedCentiLufs - measurement.integratedCentiLufs;
  const predictedTruePeakCentiDbtp = measurement.truePeakCentiDbtp + gainCentiDb;
  assertEditorial(Number.isSafeInteger(gainCentiDb) && Number.isSafeInteger(predictedTruePeakCentiDbtp), "gain arithmetic left the safe range");
  const reasons: PreRenderReason[] = [];
  if (gainCentiDb < policy.minimumGainCentiDb) reasons.push("GAIN_BELOW_POLICY_MINIMUM");
  if (gainCentiDb > policy.maximumGainCentiDb) reasons.push("GAIN_ABOVE_POLICY_MAXIMUM");
  if (predictedTruePeakCentiDbtp > policy.truePeakCeilingCentiDbtp) reasons.push("PREDICTED_TRUE_PEAK_EXCEEDED");
  if (reasons.length > 0) return rejected(reasons);
  return freezeEditorial({ ok: true, gainCentiDb, predictedIntegratedCentiLufs: policy.targetIntegratedCentiLufs, predictedTruePeakCentiDbtp });
}

// ---------------------------------------------------------------- render identity (Step 1080 R)
export const E5RenderIdentityV1Schema = z.object({
  identityType: z.literal("BUSYBOOKIE_E5_RENDER_IDENTITY"),
  identityVersion: z.literal("1"),
  renderProfileId: z.literal(E5_AUDIO_MASTERING_PROFILE_ID),
  upstream: E5UpstreamRenderAuthorityV1Schema,
  mastering: z.object({ mode: z.literal("NORMALIZE_STATIC"), staticGainCentiDb: gain }).strict(),
  output: OutputSchema,
}).strict();
export type E5RenderIdentityV1 = EditorialReadonly<z.infer<typeof E5RenderIdentityV1Schema>>;

export function validateE5RenderIdentityV1(input: unknown): E5RenderIdentityV1 {
  const parsed = E5RenderIdentityV1Schema.safeParse(input);
  assertEditorial(parsed.success, `E5 render identity is invalid: ${parsed.error?.message ?? ""}`);
  validateE5UpstreamRenderAuthorityV1(parsed.data.upstream);
  return freezeEditorial(parsed.data);
}

// renderKey is render-effective only: upstream member, gain, output contract and profile. No policy, measurement,
// toolchain, decisions provenance or path.
export function hashE5RenderIdentityV1(input: unknown): string {
  return digest(validateE5RenderIdentityV1(input));
}

// ---------------------------------------------------------------- mastering plan (Step 1080 F)
export const MasteringPlanV1Schema = z.discriminatedUnion("mode", [
  z.object({
    planType: z.literal("BUSYBOOKIE_AUDIO_MASTERING_PLAN"), planVersion: z.literal("1"), mode: z.literal("MEASURE_ONLY"),
    decisionsSha256: sha, policySha256: sha.nullable(),
    mediaAuthority: z.object({ route: z.enum(["E2_ROUGH_CUT", "E3_EDIT", "E4_MIX"]), upstreamRenderKey: sha }).strict(),
  }).strict(),
  z.object({
    planType: z.literal("BUSYBOOKIE_AUDIO_MASTERING_PLAN"), planVersion: z.literal("1"), mode: z.literal("NORMALIZE_STATIC"),
    decisionsSha256: sha, policySha256: sha, upstream: E5UpstreamRenderAuthorityV1Schema, staticGainCentiDb: gain,
    renderIdentity: E5RenderIdentityV1Schema, renderKey: sha, finalOutputPath: z.string().min(1),
    preMasterEvidenceSha256: sha, toolchainEvidenceKey: sha, predictedIntegratedCentiLufs: int, predictedTruePeakCentiDbtp: int,
  }).strict(),
]);
export type MasteringPlanV1 = EditorialReadonly<z.infer<typeof MasteringPlanV1Schema>>;
export type NormalizeStaticMasteringPlanV1 = Extract<MasteringPlanV1, { mode: "NORMALIZE_STATIC" }>;

// Provenance-sensitive plan hash; finalOutputPath is a runtime location and is excluded.
export function hashMasteringPlanV1(input: unknown): string {
  const plan = assertMasteringPlanIntegrity(input);
  if (plan.mode === "MEASURE_ONLY") return digest(plan);
  const { finalOutputPath: _path, ...hashed } = plan;
  return digest(hashed);
}

// A plan is accepted downstream only if its renderKey and identity are exactly re-derivable from its own fields.
export function assertMasteringPlanIntegrity(input: unknown): MasteringPlanV1 {
  const parsed = MasteringPlanV1Schema.safeParse(input);
  assertEditorial(parsed.success, `mastering plan is invalid: ${parsed.error?.message ?? ""}`);
  const plan = freezeEditorial(parsed.data);
  if (plan.mode === "MEASURE_ONLY") return plan;
  const identity = validateE5RenderIdentityV1(plan.renderIdentity);
  assertEditorial(canonicalEditorialJson(identity.upstream) === canonicalEditorialJson(plan.upstream),
    "mastering plan upstream differs from its render identity");
  assertEditorial(identity.mastering.staticGainCentiDb === plan.staticGainCentiDb, "mastering plan gain differs from its render identity");
  assertEditorial(hashE5RenderIdentityV1(identity) === plan.renderKey, "mastering plan renderKey does not match its identity");
  const flavor = WINDOWS_DRIVE.test(plan.finalOutputPath) ? win32 : posix;
  assertEditorial(flavor.basename(plan.finalOutputPath).endsWith(`_audio-mastered_${plan.renderKey}.mp4`),
    "mastering plan final output path is not bound to its renderKey");
  return plan;
}

export type AudioMasteringPlanInput = Readonly<{
  decisions: unknown; plan: unknown; mediaRoot: string;
  upstreamArgs: readonly unknown[]; e3Preflight?: EditorialEditRenderPreflightResult; e4Receipt?: unknown;
  toolchainEvidenceKey: string; preMasterEvidence?: unknown;
}>;

export type AudioMasteringPlanResult =
  | Readonly<{ ok: true; masteringPlan: MasteringPlanV1; masteringPlanSha256: string; derivation: E5UpstreamDerivation;
    upstreamArgs: readonly string[] }>
  | Readonly<{ ok: false; reasons: readonly PreRenderReason[] }>;

// Pure derivation: decisions + current plan + validated upstream argv (+ bound pre-master evidence for NORMALIZE_STATIC).
export function buildAudioMasteringPlan(input: AudioMasteringPlanInput): AudioMasteringPlanResult {
  assertEditorial(sha.safeParse(input.toolchainEvidenceKey).success, "mastering plan requires the current toolchain evidence key");
  const source = checkMasteringDecisionsAgainstSource({ decisions: input.decisions, plan: input.plan, mediaRoot: input.mediaRoot });
  if (!source.ok) return rejected(source.reasons);
  const derivation = source.derivation;
  const argv = checkAudioMasteringUpstreamArgv({
    derivation, args: input.upstreamArgs,
    ...(input.e3Preflight === undefined ? {} : { e3Preflight: input.e3Preflight }),
    ...(input.e4Receipt === undefined ? {} : { e4Receipt: input.e4Receipt }),
  });
  if (!argv.ok) return rejected(argv.reasons);
  if (source.decisions.mode === "MEASURE_ONLY") {
    const masteringPlan = assertMasteringPlanIntegrity({
      planType: "BUSYBOOKIE_AUDIO_MASTERING_PLAN", planVersion: "1", mode: "MEASURE_ONLY",
      decisionsSha256: source.decisionsSha256, policySha256: source.policySha256,
      mediaAuthority: { route: derivation.route, upstreamRenderKey: derivation.upstream.renderKey },
    });
    return freezeEditorial({ ok: true, masteringPlan, masteringPlanSha256: hashMasteringPlanV1(masteringPlan), derivation, upstreamArgs: argv.args });
  }
  const policy = source.decisions.deliveryPolicy;
  assertEditorial(policy !== null && source.policySha256 !== null, "NORMALIZE_STATIC decisions carry a policy");
  assertEditorial(input.preMasterEvidence !== undefined, "NORMALIZE_STATIC requires pre-master loudness evidence");
  const binding = checkPreMasterEvidenceBinding({
    evidence: input.preMasterEvidence, derivation, upstreamArgs: argv.args, toolchainEvidenceKey: input.toolchainEvidenceKey,
  });
  if (!binding.ok) return rejected(binding.reasons);
  const evidence = parsePreMasterLoudnessEvidenceV1(input.preMasterEvidence);
  const gainResult = deriveStaticGain(policy, evidence.measurement);
  if (!gainResult.ok) return rejected(gainResult.reasons);
  const renderIdentity = validateE5RenderIdentityV1({
    identityType: "BUSYBOOKIE_E5_RENDER_IDENTITY", identityVersion: "1", renderProfileId: E5_AUDIO_MASTERING_PROFILE_ID,
    upstream: structuredClone(derivation.upstream),
    mastering: { mode: "NORMALIZE_STATIC", staticGainCentiDb: gainResult.gainCentiDb },
    output: structuredClone(E5_OUTPUT_CONTRACT),
  });
  const renderKey = hashE5RenderIdentityV1(renderIdentity);
  const { root, windows } = editorialRoot(input.mediaRoot);
  const episodeId = derivation.episodeId;
  const masteringPlan = assertMasteringPlanIntegrity({
    planType: "BUSYBOOKIE_AUDIO_MASTERING_PLAN", planVersion: "1", mode: "NORMALIZE_STATIC",
    decisionsSha256: source.decisionsSha256, policySha256: source.policySha256,
    upstream: structuredClone(derivation.upstream), staticGainCentiDb: gainResult.gainCentiDb,
    renderIdentity: structuredClone(renderIdentity), renderKey,
    finalOutputPath: (windows ? win32 : posix).resolve(root, "exports", episodeId, "audio-mastered", `${episodeId}_audio-mastered_${renderKey}.mp4`),
    preMasterEvidenceSha256: hashPreMasterLoudnessEvidenceV1(evidence), toolchainEvidenceKey: input.toolchainEvidenceKey,
    predictedIntegratedCentiLufs: gainResult.predictedIntegratedCentiLufs, predictedTruePeakCentiDbtp: gainResult.predictedTruePeakCentiDbtp,
  });
  return freezeEditorial({ ok: true, masteringPlan, masteringPlanSha256: hashMasteringPlanV1(masteringPlan), derivation, upstreamArgs: argv.args });
}

// ---------------------------------------------------------------- stateless preflight receipt (E4 receipt pattern)
export const E5MasteringPreflightReceiptV1Schema = z.object({
  receiptType: z.literal("BUSYBOOKIE_E5_MASTERING_PREFLIGHT_RECEIPT"),
  receiptVersion: z.literal("1"),
  renderKey: sha,
  masteringPlanSha256: sha,
  candidatePath: z.string().min(1),
  preMasterEvidenceSha256: sha,
  toolchainEvidenceKey: sha,
  receiptSha256: sha,
}).strict();
export type E5MasteringPreflightReceiptV1 = EditorialReadonly<z.infer<typeof E5MasteringPreflightReceiptV1Schema>>;

// Candidate .part: absolute, trim-invariant, same directory as the final, ends ".part", distinct from inputs and final.
export function assertAudioMasteringCandidatePath(plan: NormalizeStaticMasteringPlanV1, inputPaths: readonly string[], candidatePath: unknown): string {
  assertEditorial(typeof candidatePath === "string" && candidatePath.length > 0 && candidatePath === candidatePath.trim() &&
    candidatePath.endsWith(".part"), "E5 candidate path must be a trimmed path ending in .part");
  const flavor = WINDOWS_DRIVE.test(plan.finalOutputPath) ? win32 : posix;
  assertEditorial(flavor.isAbsolute(candidatePath) && flavor.dirname(candidatePath) === flavor.dirname(plan.finalOutputPath),
    "E5 candidate must be absolute and in the final output directory");
  assertEditorial(candidatePath !== plan.finalOutputPath && inputPaths.every((path) => path !== candidatePath),
    "E5 candidate must differ from the final output and every input");
  return candidatePath;
}

export type AudioMasteringPreflightResult =
  | Readonly<{ ok: true; receipt: E5MasteringPreflightReceiptV1; masteringPlan: NormalizeStaticMasteringPlanV1 }>
  | Readonly<{ ok: false; reasons: readonly PreRenderReason[] }>;

// Pure and stateless: either a checksum-bound receipt or sorted unique fail-before-render reasons. Malformed inputs throw.
export function runAudioMasteringPreflight(input: AudioMasteringPlanInput & Readonly<{ candidatePath: string }>): AudioMasteringPreflightResult {
  const built = buildAudioMasteringPlan(input);
  if (!built.ok) return built;
  const plan = built.masteringPlan;
  assertEditorial(plan.mode === "NORMALIZE_STATIC", "the mastering preflight applies to NORMALIZE_STATIC only");
  const candidatePath = assertAudioMasteringCandidatePath(plan, built.derivation.inputPaths, input.candidatePath);
  const payload = {
    receiptType: "BUSYBOOKIE_E5_MASTERING_PREFLIGHT_RECEIPT" as const, receiptVersion: "1" as const,
    renderKey: plan.renderKey, masteringPlanSha256: built.masteringPlanSha256, candidatePath,
    preMasterEvidenceSha256: plan.preMasterEvidenceSha256, toolchainEvidenceKey: plan.toolchainEvidenceKey,
  };
  return freezeEditorial({ ok: true, receipt: { ...payload, receiptSha256: digest(payload) }, masteringPlan: plan });
}

export function parseAudioMasteringPreflightReceipt(input: unknown): E5MasteringPreflightReceiptV1 {
  const parsed = E5MasteringPreflightReceiptV1Schema.safeParse(input);
  assertEditorial(parsed.success, `E5 preflight receipt is invalid: ${parsed.error?.message ?? ""}`);
  const { receiptSha256, ...payload } = parsed.data;
  assertEditorial(digest(payload) === receiptSha256, "E5 preflight receipt checksum does not match its content");
  return freezeEditorial(parsed.data);
}

// Argv only. Requires a checksum-valid receipt bound to this exact plan and candidate, re-runs plan integrity and
// re-validates the upstream argv against a fresh derivation, then applies the three-edit rewrite law.
export function buildAudioMasteringFinalCommand(input: Readonly<{
  ffmpegExecutable: string; masteringPlan: unknown; receipt: unknown; candidatePath: string;
  plan: unknown; mediaRoot: string; upstreamArgs: readonly unknown[];
  e3Preflight?: EditorialEditRenderPreflightResult; e4Receipt?: unknown;
}>): AudioMasteringFfmpegCommand {
  const executable = input.ffmpegExecutable.trim();
  assertEditorial(executable.length > 0, "E5 final command requires an FFmpeg executable");
  const plan = assertMasteringPlanIntegrity(input.masteringPlan);
  assertEditorial(plan.mode === "NORMALIZE_STATIC", "MEASURE_ONLY never builds an E5 render argv");
  const receipt = parseAudioMasteringPreflightReceipt(input.receipt);
  assertEditorial(receipt.renderKey === plan.renderKey && receipt.masteringPlanSha256 === hashMasteringPlanV1(plan) &&
    receipt.preMasterEvidenceSha256 === plan.preMasterEvidenceSha256 && receipt.toolchainEvidenceKey === plan.toolchainEvidenceKey,
  "E5 preflight receipt belongs to a different mastering plan");
  assertEditorial(receipt.candidatePath === input.candidatePath, "E5 preflight receipt is bound to a different candidate path");
  const derived = deriveAudioMasteringUpstream({ plan: input.plan, mediaRoot: input.mediaRoot });
  assertEditorial(derived.ok && upstreamMatchesDerivation(plan.upstream, derived.derivation), "E5 plan upstream is stale");
  const argv = checkAudioMasteringUpstreamArgv({
    derivation: derived.derivation, args: input.upstreamArgs,
    ...(input.e3Preflight === undefined ? {} : { e3Preflight: input.e3Preflight }),
    ...(input.e4Receipt === undefined ? {} : { e4Receipt: input.e4Receipt }),
  });
  assertEditorial(argv.ok, "E5 final command upstream argv does not match the upstream authority");
  const candidatePath = assertAudioMasteringCandidatePath(plan, derived.derivation.inputPaths, input.candidatePath);
  const args = applyMasteringRewriteLaw({
    upstreamArgs: argv.args, audioTerminal: derived.derivation.audioTerminal, gainCentiDb: plan.staticGainCentiDb, candidatePath,
  });
  return freezeEditorial({ executable, args });
}
