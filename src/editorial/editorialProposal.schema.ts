import { z } from "zod";
import { checkMasteringDecisionsV1, type MasteringDecisionsV1 } from "./audioMasteringDecisions.schema.js";
import type { AudioMixDecisions } from "./audioMixDecisions.schema.js";
import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import type { EditorialDecisions } from "./editorialDecisions.schema.js";
import type { EditorialReadonly } from "./editorialPlan.schema.js";
import { parseAudioMixDecisions } from "./validateAudioMixDecisions.js";
import { parseEditorialDecisions } from "./validateEditorialDecisions.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

// ---------------------------------------------------------------- reason codes (Step 1101 n1101-5, Step 1103 sections 9-10)
// The frozen minimum set, in frozen order. RECORD_CORRUPT is a record/file-level reason; HISTORY_INVALID is the
// subject/history-level authority result. They are never merged.
export const EDITORIAL_GOVERNANCE_FROZEN_REASON_CODES = [
  "HISTORY_INVALID", "RECORD_CORRUPT", "NO_GENESIS", "GENESIS_CONFLICT", "STALE", "REVIEW_MISSING", "REVIEW_NOT_APPROVED",
  "REVIEW_NOT_PERMITTED", "REVIEW_CONFLICT", "BASE_SOURCE_MISMATCH", "CASCADE_INCOMPLETE", "CASCADE_BINDING_MISMATCH",
  "LAYER_NO_OP", "RESULT_DERIVATION_FAILED", "EXPECTED_RESULT_MISMATCH", "NO_OP_PROPOSAL", "STORE_UNSUPPORTED",
] as const;
// More specific write-input diagnostics allowed by the contract; none overlaps a frozen meaning.
export const EDITORIAL_GOVERNANCE_ADDED_REASON_CODES = [
  "INVALID_RECORD", "SUBJECT_MISMATCH", "PROPOSAL_MISSING", "REVIEW_BINDING_MISMATCH", "ACTOR_RULE_VIOLATION",
] as const;
export const EDITORIAL_GOVERNANCE_REASON_CODES = [
  ...EDITORIAL_GOVERNANCE_FROZEN_REASON_CODES, ...EDITORIAL_GOVERNANCE_ADDED_REASON_CODES,
] as const;
export type EditorialGovernanceReason = (typeof EDITORIAL_GOVERNANCE_REASON_CODES)[number];

// ---------------------------------------------------------------- shared grammar
export const editorialGovernanceSha = z.string().regex(/^[a-f0-9]{64}$/);
// Step 1099 E (n1099-2): namespaced, ASCII, no separators, whitespace or control characters; never parsed.
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]*(:[A-Za-z0-9._-]+)+$/;
export const editorialGovernanceIdentifier = z.string().min(3).max(256).regex(IDENTIFIER);
// Non-empty trimmed single-line text without control characters.
export const editorialGovernanceText = z.string().min(1).max(4000)
  .refine((text) => text === text.trim() && !/[\u0000-\u001f\u007f]/.test(text), "Expected trimmed text without control characters.");
export const editorialRevisionNumber = z.number()
  .refine((n) => Number.isSafeInteger(n) && n >= 1 && !Object.is(n, -0), "Expected a safe integer revision number >= 1.");
export const EDITORIAL_UPSTREAM_ROUTES = ["E2_ROUGH_CUT", "E3_EDIT", "E4_MIX"] as const;

// ---------------------------------------------------------------- nested helpers (not records)
export const EditorialSubjectRefV1Schema = z.object({
  kind: z.literal("EPISODE"),
  id: editorialGovernanceIdentifier,
}).strict();
export type EditorialSubjectRefV1 = EditorialReadonly<z.infer<typeof EditorialSubjectRefV1Schema>>;

export function hashEditorialSubjectRefV1(input: unknown): string {
  const parsed = EditorialSubjectRefV1Schema.safeParse(input);
  assertEditorial(parsed.success, `editorial subject is invalid: ${parsed.error?.message ?? ""}`);
  return editorialSha256(canonicalEditorialJson(parsed.data));
}

export const EDITORIAL_ACTOR_KINDS = ["HUMAN", "MACHINE", "SYSTEM", "EXTERNAL_INTERCHANGE"] as const;
export const ActorRefV1Schema = z.object({
  kind: z.enum(EDITORIAL_ACTOR_KINDS),
  actorId: editorialGovernanceIdentifier,
  authentication: z.literal("DECLARED_UNVERIFIED"),
}).strict();
export type ActorRefV1 = EditorialReadonly<z.infer<typeof ActorRefV1Schema>>;

// Domain equality only (byte-exact, case-sensitive); not an authentication control.
export function sameDeclaredActor(left: ActorRefV1, right: ActorRefV1): boolean {
  return left.kind === right.kind && left.actorId === right.actorId;
}

export const ExpectedEditorialResultV1Schema = z.object({
  decisionStateSha256: editorialGovernanceSha,
  planSha256: editorialGovernanceSha,
  upstreamRoute: z.enum(EDITORIAL_UPSTREAM_ROUTES),
  upstreamRenderKey: editorialGovernanceSha,
  masteringRenderKey: editorialGovernanceSha.nullable(),
  preMasterEvidenceSha256: editorialGovernanceSha.nullable(),
}).strict().refine((result) => (result.masteringRenderKey === null) === (result.preMasterEvidenceSha256 === null),
  "masteringRenderKey and preMasterEvidenceSha256 are both present exactly for NORMALIZE_STATIC mastering");
export type ExpectedEditorialResultV1 = EditorialReadonly<z.infer<typeof ExpectedEditorialResultV1Schema>>;

// ---------------------------------------------------------------- decision layers
export const EDITORIAL_LAYER_KEYS = ["editorialDecisions", "audioMixDecisions", "masteringDecisions"] as const;
export type EditorialLayerKey = (typeof EDITORIAL_LAYER_KEYS)[number];
export type EditorialLayerDocuments = Readonly<{
  editorialDecisions: EditorialDecisions;
  audioMixDecisions: AudioMixDecisions;
  masteringDecisions: MasteringDecisionsV1;
}>;

// Validated canonical form of one complete E3/E4/E5 decision document (existing layer parsers; malformed throws).
export function parseEditorialLayerDocument<K extends EditorialLayerKey>(layer: K, value: unknown): EditorialLayerDocuments[K] {
  assertEditorial(value !== null && typeof value === "object", `${layer} document must be an object`);
  if (layer === "editorialDecisions") return parseEditorialDecisions(value) as EditorialLayerDocuments[K];
  if (layer === "audioMixDecisions") return parseAudioMixDecisions(value) as EditorialLayerDocuments[K];
  const checked = checkMasteringDecisionsV1(value);
  assertEditorial(checked.ok, `masteringDecisions document is invalid: ${checked.ok ? "" : checked.reasons.join(",")}`);
  return checked.decisions as EditorialLayerDocuments[K];
}

// Tri-state per layer: key absent = OMITTED; null = NULL (removal); object = DOCUMENT (add/replace).
export type EditorialLayerOperations = Readonly<{
  editorialDecisions?: EditorialDecisions | null;
  audioMixDecisions?: AudioMixDecisions | null;
  masteringDecisions?: MasteringDecisionsV1 | null;
}>;
export type EditorialLayerOperation = "OMITTED" | "DOCUMENT" | "NULL";

export function editorialLayerOperation(replacements: EditorialLayerOperations, layer: EditorialLayerKey): EditorialLayerOperation {
  if (!Object.hasOwn(replacements, layer)) return "OMITTED";
  return replacements[layer] === null ? "NULL" : "DOCUMENT";
}

function parseReplacements(input: unknown): EditorialLayerOperations {
  assertEditorial(input !== null && typeof input === "object" && !Array.isArray(input), "proposal replacements must be an object");
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    assertEditorial((EDITORIAL_LAYER_KEYS as readonly string[]).includes(key), `proposal replacements has an unknown layer ${key}`);
  }
  const out: Record<string, unknown> = {};
  for (const layer of EDITORIAL_LAYER_KEYS) {
    if (!Object.hasOwn(raw, layer)) continue;
    const value = raw[layer];
    assertEditorial(value !== undefined, `proposal replacement ${layer} must be a document or null, never undefined`);
    out[layer] = value === null ? null : parseEditorialLayerDocument(layer, value);
  }
  assertEditorial(Object.keys(out).length >= 1, "proposal requires at least one explicit DOCUMENT or NULL replacement");
  return out as EditorialLayerOperations;
}

// ---------------------------------------------------------------- EditorialProposalV1 (top-level record)
const ProposalEnvelopeSchema = z.object({
  recordType: z.literal("BUSYBOOKIE_EDITORIAL_PROPOSAL"),
  recordVersion: z.literal("1"),
  subject: EditorialSubjectRefV1Schema,
  base: z.object({
    revisionNumber: editorialRevisionNumber,
    revisionSha256: editorialGovernanceSha,
    planSha256: editorialGovernanceSha,
  }).strict(),
  proposer: ActorRefV1Schema,
  rationale: editorialGovernanceText,
  replacements: z.unknown(),
  expectedResult: ExpectedEditorialResultV1Schema,
}).strict();

export type EditorialProposalV1 = EditorialReadonly<Omit<z.infer<typeof ProposalEnvelopeSchema>, "replacements">> &
  Readonly<{ replacements: EditorialLayerOperations }>;

// Strict parse; malformed proposals throw. The returned value is the validated canonical form.
export function parseEditorialProposalV1(input: unknown): EditorialProposalV1 {
  const parsed = ProposalEnvelopeSchema.safeParse(input);
  assertEditorial(parsed.success, `editorial proposal is invalid: ${parsed.error?.message ?? ""}`);
  assertEditorial(Object.hasOwn(input as object, "replacements"), "editorial proposal requires replacements");
  return freezeEditorial({ ...parsed.data, replacements: parseReplacements(parsed.data.replacements) }) as EditorialProposalV1;
}

export function hashEditorialProposalV1(input: unknown): string {
  return editorialSha256(canonicalEditorialJson(parseEditorialProposalV1(input)));
}

// ---------------------------------------------------------------- canonical record bytes
// Stored bytes = canonical JSON + one LF (Step 1099 n1099-3). A record's own hash is the SHA-256 of the canonical JSON.
export function encodeEditorialGovernanceRecord(record: unknown): Uint8Array {
  return new TextEncoder().encode(`${canonicalEditorialJson(record)}\n`);
}

export function editorialGovernanceRecordSha256(record: unknown): string {
  return editorialSha256(canonicalEditorialJson(record));
}
