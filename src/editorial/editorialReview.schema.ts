import { z } from "zod";
import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import type { EditorialReadonly } from "./editorialPlan.schema.js";
import {
  ActorRefV1Schema, editorialGovernanceSha, editorialGovernanceText, EditorialSubjectRefV1Schema, editorialRevisionNumber,
  sameDeclaredActor, type EditorialProposalV1,
} from "./editorialProposal.schema.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

// ---------------------------------------------------------------- EditorialReviewV1 (top-level record)
// One immutable whole-proposal final review; stored at reviews/<proposalSha256>.json.
export const EditorialReviewV1Schema = z.object({
  recordType: z.literal("BUSYBOOKIE_EDITORIAL_REVIEW"),
  recordVersion: z.literal("1"),
  subject: EditorialSubjectRefV1Schema,
  proposalSha256: editorialGovernanceSha,
  base: z.object({ revisionNumber: editorialRevisionNumber, revisionSha256: editorialGovernanceSha }).strict(),
  outcome: z.enum(["APPROVED", "REJECTED"]),
  reviewer: ActorRefV1Schema,
  reason: editorialGovernanceText,
}).strict();
export type EditorialReviewV1 = EditorialReadonly<z.infer<typeof EditorialReviewV1Schema>>;

export function parseEditorialReviewV1(input: unknown): EditorialReviewV1 {
  const parsed = EditorialReviewV1Schema.safeParse(input);
  assertEditorial(parsed.success, `editorial review is invalid: ${parsed.error?.message ?? ""}`);
  return freezeEditorial(parsed.data);
}

export function hashEditorialReviewV1(input: unknown): string {
  return editorialSha256(canonicalEditorialJson(parseEditorialReviewV1(input)));
}

export type EditorialReviewCheck =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: "REVIEW_BINDING_MISMATCH" | "ACTOR_RULE_VIOLATION"; detail: string }>;

// Exact binding to the proposal (subject, proposal hash, base number + sha) and the frozen actor rules:
// APPROVED only by HUMAN; HUMAN/MACHINE/SYSTEM may reject; EXTERNAL_INTERCHANGE never reviews; a declared HUMAN
// proposer may not approve their own proposal. Actor identity is DECLARED_UNVERIFIED: a domain rule, not security.
export function checkEditorialReviewAgainstProposal(
  review: EditorialReviewV1, proposal: EditorialProposalV1, proposalSha256: string,
): EditorialReviewCheck {
  const mismatch = (detail: string): EditorialReviewCheck => freezeEditorial({ ok: false, reason: "REVIEW_BINDING_MISMATCH", detail });
  const actor = (detail: string): EditorialReviewCheck => freezeEditorial({ ok: false, reason: "ACTOR_RULE_VIOLATION", detail });
  if (canonicalEditorialJson(review.subject) !== canonicalEditorialJson(proposal.subject)) return mismatch("review subject differs from the proposal subject");
  if (review.proposalSha256 !== proposalSha256) return mismatch("review is bound to a different proposal");
  if (review.base.revisionNumber !== proposal.base.revisionNumber || review.base.revisionSha256 !== proposal.base.revisionSha256) {
    return mismatch("review base differs from the proposal base");
  }
  if (review.reviewer.kind === "EXTERNAL_INTERCHANGE") return actor("EXTERNAL_INTERCHANGE actors never review");
  if (review.outcome === "APPROVED" && review.reviewer.kind !== "HUMAN") return actor("only a HUMAN reviewer may approve");
  if (review.outcome === "APPROVED" && proposal.proposer.kind === "HUMAN" && sameDeclaredActor(review.reviewer, proposal.proposer)) {
    return actor("a declared HUMAN proposer may not approve their own proposal (SELF_APPROVAL_FORBIDDEN)");
  }
  return freezeEditorial({ ok: true });
}
