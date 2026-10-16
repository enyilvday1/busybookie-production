import { checkMasteringDecisionsAgainstSource } from "./audioMasteringDecisions.schema.js";
import { hashPreMasterLoudnessEvidenceV1, parsePreMasterLoudnessEvidenceV1 } from "./audioMasteringEvidence.schema.js";
import { buildAudioMasteringPlan } from "./buildAudioMasteringPlan.js";
import { planEditorialRenderV3 } from "./buildEditorialMixRenderPlan.js";
import { buildEditorialPlanV2 } from "./buildEditorialPlanV2.js";
import { buildEditorialPlanV3 } from "./buildEditorialPlanV3.js";
import { canonicalEditorialJson } from "./canonicalizeEditorialPlan.js";
import { hashEditorialPlanV2 } from "./canonicalizeEditorialPlanV2.js";
import { hashEditorialPlanV3 } from "./canonicalizeEditorialPlanV3.js";
import {
  deriveEditorialProposalState, editorialHistoryHead, findRedundantLayerEntry, findRevisionApplyingProposal,
  overlayEditorialDecisionState, validateEditorialSubjectPartition, type EditorialGovernanceHistory, type EditorialPartitionDirectory,
  type EditorialPartitionListingV1, type StoredEditorialRevision,
} from "./deriveEditorialGovernanceState.js";
import type { EditorialEditRenderPreflightResult } from "./editorialEditRenderPreflight.js";
import {
  editorialGovernanceRecordSha256, editorialLayerOperation, encodeEditorialGovernanceRecord, hashEditorialSubjectRefV1,
  parseEditorialProposalV1, EditorialSubjectRefV1Schema, type EditorialGovernanceReason, type EditorialLayerOperations,
  type EditorialProposalV1, type ExpectedEditorialResultV1,
} from "./editorialProposal.schema.js";
import { checkEditorialReviewAgainstProposal, parseEditorialReviewV1, type EditorialReviewV1 } from "./editorialReview.schema.js";
import {
  editorialRevisionFileName, hashEditorialDecisionStateV1, parseEditorialDecisionStateV1, parseEditorialRevisionV1,
  revisionResultAuthority, type EditorialDecisionStateV1, type EditorialRevisionV1,
} from "./editorialRevision.schema.js";
import type { EditorialPlanSourceInput } from "./validateEditorialPlanAgainstSource.js";
import { freezeEditorial } from "./validateEditorialPlan.js";

// ---------------------------------------------------------------- caller-supplied evidence (never authority by itself)
// The one current source shared by base and result (E6 v1 cannot change it).
export type EditorialSourceEvidence = Readonly<{ source: EditorialPlanSourceInput; externalAudioAssets: readonly unknown[] }>;
// NORMALIZE_STATIC side inputs: the exact pre-master evidence plus the upstream argv inputs E5 already requires.
export type EditorialMasteringSideEvidence = Readonly<{
  preMasterEvidence: unknown; upstreamArgs: readonly unknown[]; e3Preflight?: EditorialEditRenderPreflightResult; e4Receipt?: unknown;
}>;
// Result side additionally carries the CURRENT toolchain authority. The base side never takes a key: it uses the
// toolchainEvidenceKey recorded in its own historical evidence (Step 1103 section 3).
export type EditorialResultMasteringEvidence = EditorialMasteringSideEvidence & Readonly<{ toolchainEvidenceKey: string }>;

export type EditorialGovernanceWrite = Readonly<{ directory: EditorialPartitionDirectory; name: string; bytes: Uint8Array }>;
export type EditorialGovernanceFailure = Readonly<{
  ok: false; reason: EditorialGovernanceReason; historyStatus: "HISTORY_INVALID" | null; detail: string;
}>;
export type EditorialChangeClass = "NO_OP" | "RENDER_PRESERVING" | "RENDER_EFFECTIVE";

function fail(reason: EditorialGovernanceReason, detail: string, historyStatus: "HISTORY_INVALID" | null = null): EditorialGovernanceFailure {
  return freezeEditorial({ ok: false, reason, historyStatus, detail });
}
const message = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
const same = (left: unknown, right: unknown): boolean => canonicalEditorialJson(left) === canonicalEditorialJson(right);
const sameBytes = (left: Uint8Array, right: Uint8Array): boolean => left.length === right.length && left.every((byte, i) => byte === right[i]);

function validated(listing: EditorialPartitionListingV1): EditorialGovernanceHistory | EditorialGovernanceFailure {
  const result = validateEditorialSubjectPartition(listing);
  return result.ok ? result.history : fail(result.primaryReason, result.detail, "HISTORY_INVALID");
}
const isFailure = (value: unknown): value is EditorialGovernanceFailure =>
  typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;

// ---------------------------------------------------------------- authority derivation through the existing E2-E5 builders
type DerivationFailure = Readonly<{ ok: false; kind: "BINDING" | "DERIVATION" | "EVIDENCE_HASH"; detail: string }>;
type Derivation = Readonly<{ ok: true; authority: ExpectedEditorialResultV1 }> | DerivationFailure;
type MasteringSide =
  | Readonly<{ side: "BASE"; evidence: EditorialMasteringSideEvidence | undefined; expectedPreMasterEvidenceSha256: string | null }>
  | Readonly<{ side: "RESULT"; evidence: EditorialResultMasteringEvidence | undefined; expectedPreMasterEvidenceSha256: string | null | undefined }>;

function derivationFailure(kind: DerivationFailure["kind"], detail: string): DerivationFailure {
  return freezeEditorial({ ok: false, kind, detail });
}

// Bottom-up E3 -> E4 -> E5. Plans are always rebuilt; no caller plan or result value is accepted.
function deriveEditorialAuthority(state: EditorialDecisionStateV1, evidence: EditorialSourceEvidence, mastering: MasteringSide): Derivation {
  const mediaRoot = evidence.source.mediaRoot;
  let v2;
  try {
    v2 = buildEditorialPlanV2(evidence.source, state.editorialDecisions);
  } catch (cause) {
    return derivationFailure("DERIVATION", `E3/V2 derivation failed: ${message(cause)}`);
  }
  if (state.audioMixDecisions !== null && state.audioMixDecisions.sourceBinding.baseEditorialPlanSha256 !== hashEditorialPlanV2(v2)) {
    return derivationFailure("BINDING", "AudioMixDecisions do not bind the derived EditorialPlan 2.0");
  }
  let v3;
  let route;
  try {
    v3 = buildEditorialPlanV3({ basePlan: v2, externalAudioAssets: evidence.externalAudioAssets, audioMixDecisions: state.audioMixDecisions });
    route = planEditorialRenderV3({ plan: v3, mediaRoot });
  } catch (cause) {
    return derivationFailure("DERIVATION", `E4/V3 derivation failed: ${message(cause)}`);
  }
  const planSha256 = hashEditorialPlanV3(v3);
  const upstreamRoute = route.route;
  const upstreamRenderKey = route.renderPlan.renderKey;
  let masteringRenderKey: string | null = null;
  let preMasterEvidenceSha256: string | null = null;
  const decisions = state.masteringDecisions;
  if (decisions !== null) {
    const binding = decisions.sourceBinding;
    if (binding.editorialPlanSha256 !== planSha256 || binding.upstreamRoute !== upstreamRoute || binding.upstreamRenderKey !== upstreamRenderKey) {
      return derivationFailure("BINDING", "MasteringDecisions do not bind the derived EditorialPlan 3.0 route/renderKey");
    }
    try {
      const checked = checkMasteringDecisionsAgainstSource({ decisions, plan: v3, mediaRoot });
      if (!checked.ok) return derivationFailure("DERIVATION", `E5 decisions rejected: ${checked.reasons.join(",")}`);
    } catch (cause) {
      return derivationFailure("DERIVATION", `E5 decisions rejected: ${message(cause)}`);
    }
    if (decisions.mode === "NORMALIZE_STATIC") {
      const side = mastering.evidence;
      if (side === undefined) return derivationFailure("DERIVATION", "NORMALIZE_STATIC requires pre-master loudness evidence");
      let parsed;
      try {
        parsed = parsePreMasterLoudnessEvidenceV1(side.preMasterEvidence);
      } catch (cause) {
        return derivationFailure("DERIVATION", `pre-master evidence is invalid: ${message(cause)}`);
      }
      const evidenceSha256 = hashPreMasterLoudnessEvidenceV1(parsed);
      if (mastering.expectedPreMasterEvidenceSha256 !== undefined && evidenceSha256 !== mastering.expectedPreMasterEvidenceSha256) {
        return derivationFailure("EVIDENCE_HASH", "supplied pre-master evidence does not hash to the bound preMasterEvidenceSha256");
      }
      // BASE: the historical key recorded in that exact evidence. RESULT: the current/new-result toolchain authority.
      const toolchainEvidenceKey = mastering.side === "BASE" ? parsed.toolchainEvidenceKey : mastering.evidence!.toolchainEvidenceKey;
      let built;
      try {
        built = buildAudioMasteringPlan({
          decisions, plan: v3, mediaRoot, upstreamArgs: side.upstreamArgs, toolchainEvidenceKey, preMasterEvidence: side.preMasterEvidence,
          ...(side.e3Preflight === undefined ? {} : { e3Preflight: side.e3Preflight }),
          ...(side.e4Receipt === undefined ? {} : { e4Receipt: side.e4Receipt }),
        });
      } catch (cause) {
        return derivationFailure("DERIVATION", `E5 mastering derivation failed: ${message(cause)}`);
      }
      if (!built.ok) return derivationFailure("DERIVATION", `E5 mastering derivation rejected: ${built.reasons.join(",")}`);
      if (built.masteringPlan.mode !== "NORMALIZE_STATIC") return derivationFailure("DERIVATION", "E5 returned a non-NORMALIZE_STATIC plan");
      masteringRenderKey = built.masteringPlan.renderKey;
      preMasterEvidenceSha256 = built.masteringPlan.preMasterEvidenceSha256;
    }
  }
  return freezeEditorial({ ok: true, authority: {
    decisionStateSha256: hashEditorialDecisionStateV1(state), planSha256, upstreamRoute, upstreamRenderKey, masteringRenderKey,
    preMasterEvidenceSha256,
  } });
}

// ---------------------------------------------------------------- change class (Step 1101 section 13)
export function classifyEditorialChange(base: ExpectedEditorialResultV1, result: ExpectedEditorialResultV1): EditorialChangeClass {
  if (same(base, result)) return "NO_OP";
  return base.upstreamRoute === result.upstreamRoute && base.upstreamRenderKey === result.upstreamRenderKey &&
    base.masteringRenderKey === result.masteringRenderKey ? "RENDER_PRESERVING" : "RENDER_EFFECTIVE";
}

// ---------------------------------------------------------------- structural cascade precheck (phase 1, Step 1101 8.1)
// Uses only base layer presence and the operation tri-state; no derived value is needed.
export function checkStructuralCascade(base: EditorialDecisionStateV1, replacements: EditorialLayerOperations): string | null {
  const acts = (layer: "editorialDecisions" | "audioMixDecisions" | "masteringDecisions") => editorialLayerOperation(replacements, layer) !== "OMITTED";
  if (acts("editorialDecisions")) {
    if (base.audioMixDecisions !== null && !acts("audioMixDecisions")) return "E3 change requires an explicit E4 DOCUMENT or NULL";
    if (base.masteringDecisions !== null && !acts("masteringDecisions")) return "E3 change requires an explicit E5 DOCUMENT or NULL";
  }
  if (acts("audioMixDecisions") && base.masteringDecisions !== null && !acts("masteringDecisions")) {
    return "E4 change requires an explicit E5 DOCUMENT or NULL";
  }
  return null;
}

// ---------------------------------------------------------------- genesis (Step 1101 section 11)
export type EditorialRevisionOutcome =
  | Readonly<{ ok: true; action: "PUBLISH"; write: EditorialGovernanceWrite; revision: EditorialRevisionV1; revisionSha256: string;
    changeClass: EditorialChangeClass | null }>
  | Readonly<{ ok: true; action: "EXISTING"; revision: EditorialRevisionV1; revisionSha256: string }>
  | EditorialGovernanceFailure;

// Outcomes carrying record bytes are frozen shallowly (typed arrays cannot be frozen); records are already frozen.
function existingRevision(stored: StoredEditorialRevision): EditorialRevisionOutcome {
  return Object.freeze({ ok: true, action: "EXISTING", revision: stored.revision, revisionSha256: stored.revisionSha256 });
}

function revisionWrite(revision: EditorialRevisionV1, changeClass: EditorialChangeClass | null): EditorialRevisionOutcome {
  const parsed = parseEditorialRevisionV1(revision);
  return Object.freeze({
    ok: true, action: "PUBLISH", revision: parsed, revisionSha256: editorialGovernanceRecordSha256(parsed), changeClass,
    write: { directory: "revisions" as const, name: editorialRevisionFileName(parsed.revisionNumber), bytes: encodeEditorialGovernanceRecord(parsed) },
  });
}

export function planEditorialGenesis(input: Readonly<{
  listing: EditorialPartitionListingV1; subject: unknown; decisionState: unknown; evidence: EditorialSourceEvidence;
  mastering?: EditorialResultMasteringEvidence;
}>): EditorialRevisionOutcome {
  const history = validated(input.listing);
  if (isFailure(history)) return history;
  const subject = EditorialSubjectRefV1Schema.safeParse(input.subject);
  if (!subject.success) return fail("INVALID_RECORD", "genesis subject is invalid");
  if (hashEditorialSubjectRefV1(subject.data) !== input.listing.subjectSha256) return fail("SUBJECT_MISMATCH", "genesis subject does not hash to the partition");
  let state: EditorialDecisionStateV1;
  try {
    state = parseEditorialDecisionStateV1(input.decisionState);
  } catch (cause) {
    return fail("INVALID_RECORD", `genesis decision state is invalid: ${message(cause)}`);
  }
  const derived = deriveEditorialAuthority(state, input.evidence, { side: "RESULT", evidence: input.mastering, expectedPreMasterEvidenceSha256: undefined });
  if (!derived.ok) return fail("RESULT_DERIVATION_FAILED", derived.detail);
  const outcome = revisionWrite({
    recordType: "BUSYBOOKIE_EDITORIAL_REVISION", recordVersion: "1", subject: subject.data, revisionNumber: 1,
    parentRevisionSha256: null, appliedProposalSha256: null, approvalReviewSha256: null, decisionState: state, ...derived.authority,
  }, null);
  const first = history.revisions[0];
  if (first === undefined || !outcome.ok || outcome.action !== "PUBLISH") return outcome;
  return sameBytes(first.bytes, outcome.write.bytes) ? existingRevision(first) : fail("GENESIS_CONFLICT", "a different revision 1 already exists");
}

// ---------------------------------------------------------------- proposal write
export type EditorialProposalWriteOutcome =
  | Readonly<{ ok: true; action: "PUBLISH" | "EXISTING"; write: EditorialGovernanceWrite; proposal: EditorialProposalV1; proposalSha256: string }>
  | EditorialGovernanceFailure;

export function planEditorialProposalWrite(input: Readonly<{ listing: EditorialPartitionListingV1; proposal: unknown }>): EditorialProposalWriteOutcome {
  const history = validated(input.listing);
  if (isFailure(history)) return history;
  if (editorialHistoryHead(history) === null) return fail("NO_GENESIS", "no genesis revision exists; only genesis is permitted");
  let proposal: EditorialProposalV1;
  try {
    proposal = parseEditorialProposalV1(input.proposal);
  } catch (cause) {
    return fail("INVALID_RECORD", message(cause));
  }
  if (hashEditorialSubjectRefV1(proposal.subject) !== input.listing.subjectSha256) return fail("SUBJECT_MISMATCH", "proposal subject does not hash to the partition");
  const proposalSha256 = editorialGovernanceRecordSha256(proposal);
  const write = { directory: "proposals" as const, name: `${proposalSha256}.json`, bytes: encodeEditorialGovernanceRecord(proposal) };
  const action = history.proposals.has(proposalSha256) ? "EXISTING" : "PUBLISH";
  return Object.freeze({ ok: true, action, write, proposal, proposalSha256 });
}

// ---------------------------------------------------------------- review write (Step 1103 section 8, S1-S5)
export type EditorialReviewWriteOutcome =
  | Readonly<{ ok: true; action: "PUBLISH" | "EXISTING"; write: EditorialGovernanceWrite; review: EditorialReviewV1; reviewSha256: string }>
  | EditorialGovernanceFailure;

export function planEditorialReviewWrite(input: Readonly<{ listing: EditorialPartitionListingV1; review: unknown }>): EditorialReviewWriteOutcome {
  // S1: complete partition validation; the stored proposal identifies the canonical review path.
  const history = validated(input.listing);
  if (isFailure(history)) return history;
  if (editorialHistoryHead(history) === null) return fail("NO_GENESIS", "no genesis revision exists; only genesis is permitted");
  let review: EditorialReviewV1;
  try {
    review = parseEditorialReviewV1(input.review);
  } catch (cause) {
    return fail("INVALID_RECORD", message(cause));
  }
  if (hashEditorialSubjectRefV1(review.subject) !== input.listing.subjectSha256) return fail("SUBJECT_MISMATCH", "review subject does not hash to the partition");
  const proposal = history.proposals.get(review.proposalSha256);
  if (proposal === undefined) return fail("PROPOSAL_MISSING", "the reviewed proposal is not stored");
  const write = { directory: "reviews" as const, name: `${review.proposalSha256}.json`, bytes: encodeEditorialGovernanceRecord(review) };
  const done = (action: "PUBLISH" | "EXISTING"): EditorialReviewWriteOutcome =>
    Object.freeze({ ok: true, action, write, review, reviewSha256: editorialGovernanceRecordSha256(review) });
  // S2: an existing canonical review decides first, whatever the proposal state now is.
  const existing = history.reviews.get(review.proposalSha256);
  if (existing !== undefined) {
    return sameBytes(existing.bytes, write.bytes) ? done("EXISTING") : fail("REVIEW_CONFLICT", "a different final review already exists");
  }
  // S3: a new review only while PROPOSED.
  const state = deriveEditorialProposalState(history, review.proposalSha256);
  if (state !== "PROPOSED") return fail("REVIEW_NOT_PERMITTED", `a new review requires state PROPOSED (state ${state ?? "NONE"})`);
  // S4: exact binding and actor rules.
  const check = checkEditorialReviewAgainstProposal(review, proposal.proposal, proposal.proposalSha256);
  if (!check.ok) return fail(check.reason, check.detail);
  // S5: caller publishes atomically no-clobber; a lost race goes through resolveEditorialPublishRace.
  return done("PUBLISH");
}

// ---------------------------------------------------------------- application (Step 1101 section 7, Step 1103 sections 3-7)
export function planEditorialProposalApplication(input: Readonly<{
  listing: EditorialPartitionListingV1; proposalSha256: string; evidence: EditorialSourceEvidence;
  baseMastering?: EditorialMasteringSideEvidence; resultMastering?: EditorialResultMasteringEvidence;
}>): EditorialRevisionOutcome {
  // 1 whole-partition validation
  const history = validated(input.listing);
  if (isFailure(history)) return history;
  const head = editorialHistoryHead(history);
  if (head === null) return fail("NO_GENESIS", "no genesis revision exists; only genesis is permitted");
  const stored = history.proposals.get(input.proposalSha256);
  if (stored === undefined) return fail("PROPOSAL_MISSING", "the proposal is not stored");
  const proposal = stored.proposal;
  // 2-3 derived state; APPLIED is idempotent
  const state = deriveEditorialProposalState(history, input.proposalSha256);
  if (state === "APPLIED") return existingRevision(findRevisionApplyingProposal(history, input.proposalSha256)!);
  // 4 stored APPROVED final review (actor rules already enforced by partition validation)
  const review = history.reviews.get(input.proposalSha256);
  if (review === undefined) return fail("REVIEW_MISSING", "the proposal has no final review");
  if (review.review.outcome !== "APPROVED") return fail("REVIEW_NOT_APPROVED", "the final review is not APPROVED");
  // 5 exact base triple
  if (state === "STALE") return fail("STALE", "the proposal base is not the current head");
  const parent = head.revision;
  // 6-7 base re-derivation from current source + parent decisions + HISTORICAL base evidence
  const base = deriveEditorialAuthority(parent.decisionState, input.evidence, {
    side: "BASE", evidence: input.baseMastering, expectedPreMasterEvidenceSha256: parent.preMasterEvidenceSha256,
  });
  if (!base.ok) return fail("BASE_SOURCE_MISMATCH", base.detail);
  if (!same(base.authority, revisionResultAuthority(parent))) return fail("BASE_SOURCE_MISMATCH", "current source no longer reproduces the parent authority");
  // 8 structural cascade precheck, then LAYER_NO_OP (hash-free part)
  const structural = checkStructuralCascade(parent.decisionState, proposal.replacements);
  if (structural !== null) return fail("CASCADE_INCOMPLETE", structural);
  const redundant = findRedundantLayerEntry(parent, proposal);
  if (redundant !== null) return fail("LAYER_NO_OP", redundant);
  // 9 overlay; 10-13 bottom-up derivation, effective cascade binding and result evidence verification
  const resultState = overlayEditorialDecisionState(parent.decisionState, proposal.replacements);
  const result = deriveEditorialAuthority(resultState, input.evidence, {
    side: "RESULT", evidence: input.resultMastering, expectedPreMasterEvidenceSha256: proposal.expectedResult.preMasterEvidenceSha256,
  });
  if (!result.ok) {
    const reason = result.kind === "BINDING" ? "CASCADE_BINDING_MISMATCH" : result.kind === "EVIDENCE_HASH" ? "EXPECTED_RESULT_MISMATCH" : "RESULT_DERIVATION_FAILED";
    return fail(reason, result.detail);
  }
  // 14-15 exact six-value equality with the approved expected result
  if (!same(result.authority, proposal.expectedResult)) return fail("EXPECTED_RESULT_MISMATCH", "derived result differs from proposal.expectedResult");
  // 16 change class
  const changeClass = classifyEditorialChange(revisionResultAuthority(parent), result.authority);
  if (changeClass === "NO_OP") return fail("NO_OP_PROPOSAL", "the proposal changes no authority");
  // 17-18 revision N+1 for atomic no-clobber publication by the caller
  return revisionWrite({
    recordType: "BUSYBOOKIE_EDITORIAL_REVISION", recordVersion: "1", subject: proposal.subject, revisionNumber: parent.revisionNumber + 1,
    parentRevisionSha256: head.revisionSha256, appliedProposalSha256: stored.proposalSha256, approvalReviewSha256: review.reviewSha256,
    decisionState: resultState, ...result.authority,
  }, changeClass);
}

// ---------------------------------------------------------------- lost publication race (Step 1101 step 19, Step 1103 S5)
// Called after the store reports that the canonical target already existed; the listing is re-read after the loss.
export type EditorialRaceOutcome =
  | Readonly<{ ok: true; action: "EXISTING"; directory: EditorialPartitionDirectory; name: string; bytes: Uint8Array }>
  | EditorialGovernanceFailure;

export function resolveEditorialPublishRace(input: Readonly<{ listing: EditorialPartitionListingV1; write: EditorialGovernanceWrite }>): EditorialRaceOutcome {
  const history = validated(input.listing);
  if (isFailure(history)) return history;
  const { directory, name, bytes } = input.write;
  const existing = (found: Uint8Array): EditorialRaceOutcome => Object.freeze({ ok: true, action: "EXISTING", directory, name, bytes: found });
  if (directory === "proposals") {
    const found = history.proposals.get(name.slice(0, 64));
    return found !== undefined && sameBytes(found.bytes, bytes) ? existing(found.bytes) : fail("RECORD_CORRUPT", "proposal target holds different bytes", "HISTORY_INVALID");
  }
  if (directory === "reviews") {
    const found = history.reviews.get(name.slice(0, 64));
    if (found === undefined) return fail("REVIEW_CONFLICT", "review target is not readable as the expected review");
    return sameBytes(found.bytes, bytes) ? existing(found.bytes) : fail("REVIEW_CONFLICT", "a different final review won the race");
  }
  const attempted = parseEditorialRevisionV1(JSON.parse(new TextDecoder().decode(bytes)));
  if (attempted.revisionNumber === 1) {
    const first = history.revisions[0];
    return first !== undefined && sameBytes(first.bytes, bytes) ? existing(first.bytes) : fail("GENESIS_CONFLICT", "a different revision 1 won the race");
  }
  const winner = findRevisionApplyingProposal(history, attempted.appliedProposalSha256!);
  return winner !== null ? existing(winner.bytes) : fail("STALE", "a different proposal advanced the head; no retry onto N+1");
}
