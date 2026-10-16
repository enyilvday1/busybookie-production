import { z } from "zod";
import { AudioDeliveryPolicyV1Schema, checkAudioDeliveryPolicyV1, type AudioDeliveryPolicyV1 } from "./audioDeliveryPolicy.schema.js";
import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import { deriveAudioMasteringUpstream, type E5UpstreamDerivation } from "./deriveAudioMasteringUpstream.js";
import type { EditorialReadonly } from "./editorialPlan.schema.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

// Exactly two modes; any other value is a schema rejection.
export const E5_MASTERING_MODES = ["MEASURE_ONLY", "NORMALIZE_STATIC"] as const;
export type E5MasteringMode = (typeof E5_MASTERING_MODES)[number];

const sha = z.string().regex(/^[a-f0-9]{64}$/);

// The policy is embedded as an opaque value here and validated separately, so an invalid policy is POLICY_INVALID
// rather than a generic decisions rejection.
const MasteringDecisionsShapeSchema = z.object({
  decisionsType: z.literal("BUSYBOOKIE_AUDIO_MASTERING_DECISIONS"),
  schemaVersion: z.literal("1.0"),
  sourceBinding: z.object({
    editorialPlanSha256: sha,
    upstreamRoute: z.enum(["E2_ROUGH_CUT", "E3_EDIT", "E4_MIX"]),
    upstreamRenderKey: sha,
  }).strict(),
  mode: z.enum(E5_MASTERING_MODES),
  deliveryPolicy: z.unknown(),
}).strict();

export const MasteringDecisionsV1Schema = MasteringDecisionsShapeSchema.extend({
  deliveryPolicy: AudioDeliveryPolicyV1Schema.nullable(),
}).strict();

export type MasteringDecisionsV1 = EditorialReadonly<Omit<z.infer<typeof MasteringDecisionsShapeSchema>, "deliveryPolicy">> &
  Readonly<{ deliveryPolicy: AudioDeliveryPolicyV1 | null }>;

export type MasteringDecisionsReason = "POLICY_INVALID" | "POLICY_REQUIRED" | "EVIDENCE_BINDING_MISMATCH";

export type MasteringDecisionsCheck =
  | Readonly<{ ok: true; decisions: MasteringDecisionsV1; decisionsSha256: string; policySha256: string | null }>
  | Readonly<{ ok: false; reasons: readonly MasteringDecisionsReason[] }>;

function rejected(reason: MasteringDecisionsReason): MasteringDecisionsCheck {
  return freezeEditorial({ ok: false, reasons: [reason] });
}

// Malformed decisions throw. NORMALIZE_STATIC requires a policy (POLICY_REQUIRED); MEASURE_ONLY may carry one.
export function checkMasteringDecisionsV1(input: unknown): MasteringDecisionsCheck {
  const shape = MasteringDecisionsShapeSchema.safeParse(input);
  assertEditorial(shape.success, `mastering decisions are invalid: ${shape.error?.message ?? ""}`);
  const raw = shape.data;
  let policy: AudioDeliveryPolicyV1 | null = null;
  let policySha256: string | null = null;
  if (raw.deliveryPolicy !== null) {
    const checked = checkAudioDeliveryPolicyV1(raw.deliveryPolicy);
    if (!checked.ok) return rejected("POLICY_INVALID");
    policy = checked.policy;
    policySha256 = checked.policySha256;
  }
  if (raw.mode === "NORMALIZE_STATIC" && policy === null) return rejected("POLICY_REQUIRED");
  const decisions: MasteringDecisionsV1 = freezeEditorial({ ...raw, sourceBinding: { ...raw.sourceBinding }, deliveryPolicy: policy });
  return freezeEditorial({ ok: true, decisions, decisionsSha256: editorialSha256(canonicalEditorialJson(decisions)), policySha256 });
}

export function hashMasteringDecisionsV1(input: unknown): string {
  const checked = checkMasteringDecisionsV1(input);
  assertEditorial(checked.ok, `mastering decisions are invalid: ${checked.ok ? "" : checked.reasons.join(",")}`);
  return checked.decisionsSha256;
}

export type MasteringDecisionsSourceCheck =
  | Readonly<{ ok: true; decisions: MasteringDecisionsV1; decisionsSha256: string; policySha256: string | null;
    derivation: E5UpstreamDerivation }>
  | Readonly<{ ok: false; reasons: readonly (MasteringDecisionsReason | "NOT_MASTERABLE_UPSTREAM")[] }>;

// Validation against source recomputes the plan hash, route and renderKey from the current plan; any difference is stale.
export function checkMasteringDecisionsAgainstSource(input: Readonly<{
  decisions: unknown; plan: unknown; mediaRoot: string;
}>): MasteringDecisionsSourceCheck {
  const checked = checkMasteringDecisionsV1(input.decisions);
  if (!checked.ok) return checked;
  const derived = deriveAudioMasteringUpstream({ plan: input.plan, mediaRoot: input.mediaRoot });
  if (!derived.ok) return derived;
  const binding = checked.decisions.sourceBinding;
  const derivation = derived.derivation;
  if (binding.editorialPlanSha256 !== derivation.editorialPlanSha256 || binding.upstreamRoute !== derivation.route ||
    binding.upstreamRenderKey !== derivation.upstream.renderKey) {
    return freezeEditorial({ ok: false, reasons: ["EVIDENCE_BINDING_MISMATCH"] });
  }
  return freezeEditorial({ ...checked, derivation });
}
