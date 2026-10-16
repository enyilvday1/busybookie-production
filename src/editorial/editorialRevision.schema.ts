import { z } from "zod";
import type { MasteringDecisionsV1 } from "./audioMasteringDecisions.schema.js";
import type { AudioMixDecisions } from "./audioMixDecisions.schema.js";
import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import type { EditorialDecisions } from "./editorialDecisions.schema.js";
import type { EditorialReadonly } from "./editorialPlan.schema.js";
import {
  EDITORIAL_LAYER_KEYS, EDITORIAL_UPSTREAM_ROUTES, editorialGovernanceSha, EditorialSubjectRefV1Schema, editorialRevisionNumber,
  parseEditorialLayerDocument, type ExpectedEditorialResultV1,
} from "./editorialProposal.schema.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

// ---------------------------------------------------------------- EditorialDecisionStateV1 (nested helper)
// All three keys are always present; null = explicit absence of the layer.
export type EditorialDecisionStateV1 = Readonly<{
  editorialDecisions: EditorialDecisions | null;
  audioMixDecisions: AudioMixDecisions | null;
  masteringDecisions: MasteringDecisionsV1 | null;
}>;

export function parseEditorialDecisionStateV1(input: unknown): EditorialDecisionStateV1 {
  assertEditorial(input !== null && typeof input === "object" && !Array.isArray(input), "decision state must be an object");
  const raw = input as Record<string, unknown>;
  const keys = Object.keys(raw).sort();
  assertEditorial(canonicalEditorialJson(keys) === canonicalEditorialJson([...EDITORIAL_LAYER_KEYS].sort()),
    "decision state must carry exactly editorialDecisions, audioMixDecisions and masteringDecisions");
  const layer = <K extends (typeof EDITORIAL_LAYER_KEYS)[number]>(key: K) => {
    const value = raw[key];
    assertEditorial(value !== undefined, `decision state ${key} must be a document or null`);
    return value === null ? null : parseEditorialLayerDocument(key, value);
  };
  return freezeEditorial({
    editorialDecisions: layer("editorialDecisions"),
    audioMixDecisions: layer("audioMixDecisions"),
    masteringDecisions: layer("masteringDecisions"),
  });
}

export function hashEditorialDecisionStateV1(input: unknown): string {
  return editorialSha256(canonicalEditorialJson(parseEditorialDecisionStateV1(input)));
}

// Step 1101 3.1 / Step 1103 section 12: pre-master evidence (and an E5 render identity) exists exactly for
// NORMALIZE_STATIC mastering. MEASURE_ONLY and absent mastering carry null.
export function premasterEvidenceApplicable(state: EditorialDecisionStateV1): boolean {
  return state.masteringDecisions !== null && state.masteringDecisions.mode === "NORMALIZE_STATIC";
}

// ---------------------------------------------------------------- EditorialRevisionV1 (top-level record)
// Append-only history record, current authority and application receipt in one.
const RevisionEnvelopeSchema = z.object({
  recordType: z.literal("BUSYBOOKIE_EDITORIAL_REVISION"),
  recordVersion: z.literal("1"),
  subject: EditorialSubjectRefV1Schema,
  revisionNumber: editorialRevisionNumber,
  parentRevisionSha256: editorialGovernanceSha.nullable(),
  appliedProposalSha256: editorialGovernanceSha.nullable(),
  approvalReviewSha256: editorialGovernanceSha.nullable(),
  decisionState: z.unknown(),
  decisionStateSha256: editorialGovernanceSha,
  planSha256: editorialGovernanceSha,
  upstreamRoute: z.enum(EDITORIAL_UPSTREAM_ROUTES),
  upstreamRenderKey: editorialGovernanceSha,
  masteringRenderKey: editorialGovernanceSha.nullable(),
  preMasterEvidenceSha256: editorialGovernanceSha.nullable(),
}).strict();

export type EditorialRevisionV1 = EditorialReadonly<Omit<z.infer<typeof RevisionEnvelopeSchema>, "decisionState">> &
  Readonly<{ decisionState: EditorialDecisionStateV1 }>;

// Shape-only strict parse; history invariants (R1-R7) are checked by partition validation.
export function parseEditorialRevisionV1(input: unknown): EditorialRevisionV1 {
  const parsed = RevisionEnvelopeSchema.safeParse(input);
  assertEditorial(parsed.success, `editorial revision is invalid: ${parsed.error?.message ?? ""}`);
  assertEditorial(Object.hasOwn(input as object, "decisionState"), "editorial revision requires a decision state");
  return freezeEditorial({ ...parsed.data, decisionState: parseEditorialDecisionStateV1(parsed.data.decisionState) }) as EditorialRevisionV1;
}

export function hashEditorialRevisionV1(input: unknown): string {
  return editorialSha256(canonicalEditorialJson(parseEditorialRevisionV1(input)));
}

export function editorialRevisionFileName(revisionNumber: number): string {
  assertEditorial(editorialRevisionNumber.safeParse(revisionNumber).success, "revision number must be a safe integer >= 1");
  return `${String(revisionNumber).padStart(16, "0")}.json`;
}

// The six-value result authority of a revision (Step 1101 3.2, section 13).
export function revisionResultAuthority(revision: EditorialRevisionV1): ExpectedEditorialResultV1 {
  return freezeEditorial({
    decisionStateSha256: revision.decisionStateSha256, planSha256: revision.planSha256, upstreamRoute: revision.upstreamRoute,
    upstreamRenderKey: revision.upstreamRenderKey, masteringRenderKey: revision.masteringRenderKey,
    preMasterEvidenceSha256: revision.preMasterEvidenceSha256,
  });
}
