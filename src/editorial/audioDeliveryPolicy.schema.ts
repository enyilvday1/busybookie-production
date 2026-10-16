import { z } from "zod";
import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import type { EditorialReadonly } from "./editorialPlan.schema.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

// E5 v1 has exactly one loudness/true-peak measurement engine (loudnorm input_* statistics, output discarded).
export const E5_MEASUREMENT_ENGINE = "FFMPEG_LOUDNORM_INPUT_STATS_V1";

// Integer centi-units in a closed domain; -0 is never canonical.
function centi(min: number, max: number) {
  return z.number().refine((n) => Number.isSafeInteger(n) && !Object.is(n, -0) && n >= min && n <= max,
    `Expected an integer in ${min}..${max}.`);
}

// No default policy exists anywhere in the core: named delivery profiles are caller data.
export const AudioDeliveryPolicyV1Schema = z.object({
  policyType: z.literal("BUSYBOOKIE_AUDIO_DELIVERY_POLICY"),
  policyVersion: z.literal("1"),
  policyId: z.string().max(80).regex(/^audio-delivery:[a-z0-9]+(-[a-z0-9]+)*$/),
  measurementEngine: z.literal(E5_MEASUREMENT_ENGINE),
  targetIntegratedCentiLufs: centi(-7_000, -500),
  integratedToleranceCentiLu: centi(0, 500),
  truePeakCeilingCentiDbtp: centi(-900, 0),
  minimumGainCentiDb: centi(-9_600, 1_200),
  maximumGainCentiDb: centi(-9_600, 1_200),
  loudnessRangePolicy: z.literal("RECORD_ONLY"),
  expectedAudio: z.object({
    codecName: z.literal("aac"), sampleRateHz: z.literal(48000), channels: z.literal(2), channelLayout: z.literal("stereo"),
  }).strict(),
}).strict().refine((policy) => policy.minimumGainCentiDb <= policy.maximumGainCentiDb, "minimumGainCentiDb exceeds maximumGainCentiDb");

export type AudioDeliveryPolicyV1 = EditorialReadonly<z.infer<typeof AudioDeliveryPolicyV1Schema>>;

export type AudioDeliveryPolicyCheck =
  | Readonly<{ ok: true; policy: AudioDeliveryPolicyV1; policySha256: string }>
  | Readonly<{ ok: false; reason: "POLICY_INVALID" }>;

// Pre-QC schema rejection: any unknown field, unit, range or cross-field violation is POLICY_INVALID.
export function checkAudioDeliveryPolicyV1(input: unknown): AudioDeliveryPolicyCheck {
  const parsed = AudioDeliveryPolicyV1Schema.safeParse(input);
  if (!parsed.success) return freezeEditorial({ ok: false, reason: "POLICY_INVALID" });
  const policy = freezeEditorial(parsed.data);
  return freezeEditorial({ ok: true, policy, policySha256: editorialSha256(canonicalEditorialJson(policy)) });
}

export function validateAudioDeliveryPolicyV1(input: unknown): AudioDeliveryPolicyV1 {
  const result = checkAudioDeliveryPolicyV1(input);
  assertEditorial(result.ok, "audio delivery policy is invalid (POLICY_INVALID)");
  return result.policy;
}

export function hashAudioDeliveryPolicyV1(input: unknown): string {
  return editorialSha256(canonicalEditorialJson(validateAudioDeliveryPolicyV1(input)));
}
