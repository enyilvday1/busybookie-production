import { canonicalEditorialJson } from "./canonicalizeEditorialPlan.js";
import {
  EDITORIAL_LAYER_KEYS, editorialGovernanceRecordSha256, editorialLayerOperation, hashEditorialSubjectRefV1,
  parseEditorialProposalV1, type EditorialLayerOperations, type EditorialProposalV1,
} from "./editorialProposal.schema.js";
import { checkEditorialReviewAgainstProposal, parseEditorialReviewV1, type EditorialReviewV1 } from "./editorialReview.schema.js";
import {
  hashEditorialDecisionStateV1, parseEditorialRevisionV1, premasterEvidenceApplicable, revisionResultAuthority,
  type EditorialDecisionStateV1, type EditorialRevisionV1,
} from "./editorialRevision.schema.js";
import { freezeEditorial } from "./validateEditorialPlan.js";

// ---------------------------------------------------------------- partition listing (opaque bytes from the adapter)
export const EDITORIAL_PARTITION_DIRECTORIES = ["proposals", "reviews", "revisions"] as const;
export type EditorialPartitionDirectory = (typeof EDITORIAL_PARTITION_DIRECTORIES)[number];

// One listed entry of subjects/<subjectSha256>/ ("" = the subject directory itself) or of one record directory.
// bytes is null when a listed file could not be read completely.
export type EditorialPartitionEntryV1 = Readonly<{
  directory: "" | EditorialPartitionDirectory;
  name: string;
  type: "file" | "directory" | "other";
  bytes: Uint8Array | null;
}>;
export type EditorialPartitionListingV1 = Readonly<{ subjectSha256: string; entries: readonly EditorialPartitionEntryV1[] }>;

export type StoredEditorialProposal = Readonly<{ proposal: EditorialProposalV1; proposalSha256: string; bytes: Uint8Array }>;
export type StoredEditorialReview = Readonly<{ review: EditorialReviewV1; reviewSha256: string; bytes: Uint8Array }>;
export type StoredEditorialRevision = Readonly<{ revision: EditorialRevisionV1; revisionSha256: string; bytes: Uint8Array }>;

// A fully validated subject history: revisions are exactly 1..N in order.
export type EditorialGovernanceHistory = Readonly<{
  subjectSha256: string;
  revisions: readonly StoredEditorialRevision[];
  proposals: ReadonlyMap<string, StoredEditorialProposal>;
  reviews: ReadonlyMap<string, StoredEditorialReview>;
}>;

// RECORD_CORRUPT = a canonical file failed its own record integrity; HISTORY_INVALID = any other subject/history
// violation. In both cases the subject has no authoritative head.
export type EditorialHistoryValidation =
  | Readonly<{ ok: true; history: EditorialGovernanceHistory }>
  | Readonly<{ ok: false; primaryReason: "RECORD_CORRUPT" | "HISTORY_INVALID"; historyStatus: "HISTORY_INVALID"; detail: string }>;

const SHA = /^[a-f0-9]{64}$/;
const HASH_NAME = /^[a-f0-9]{64}\.json$/;
const REVISION_NAME = /^[0-9]{16}\.json$/;
const TEMP_SUFFIX = /\.tmp-[0-9a-f]{32}$/;

function revisionNumberOfName(name: string): number | null {
  if (!REVISION_NAME.test(name)) return null;
  const n = Number(name.slice(0, 16));
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

export function isCanonicalEditorialRecordName(directory: EditorialPartitionDirectory, name: string): boolean {
  return directory === "revisions" ? revisionNumberOfName(name) !== null : HASH_NAME.test(name);
}

// Reserved temporary: "." + canonical final basename for this directory + ".tmp-" + 32 lowercase hex. Never a record.
export function isReservedEditorialTempName(directory: EditorialPartitionDirectory, name: string): boolean {
  if (!name.startsWith(".") || !TEMP_SUFFIX.test(name)) return false;
  return isCanonicalEditorialRecordName(directory, name.slice(1, name.length - ".tmp-".length - 32));
}

class RecordCorrupt extends Error {}

// Strict UTF-8, exactly canonical JSON + LF, strict schema. Anything else is RECORD_CORRUPT.
function decodeRecord<T>(bytes: Uint8Array | null, parse: (value: unknown) => T, label: string): T {
  if (bytes === null) throw new RecordCorrupt(`${label} could not be read completely`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RecordCorrupt(`${label} is not valid UTF-8`);
  }
  if (!text.endsWith("\n")) throw new RecordCorrupt(`${label} is incomplete (missing terminal LF)`);
  let value: unknown;
  try {
    value = JSON.parse(text.slice(0, -1));
  } catch {
    throw new RecordCorrupt(`${label} is not valid JSON`);
  }
  let record: T;
  try {
    record = parse(value);
  } catch (cause) {
    throw new RecordCorrupt(`${label} fails its schema: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (`${canonicalEditorialJson(record)}\n` !== text) throw new RecordCorrupt(`${label} bytes are not canonical`);
  return record;
}

const same = (left: unknown, right: unknown): boolean => canonicalEditorialJson(left) === canonicalEditorialJson(right);

// ---------------------------------------------------------------- deterministic overlay and LAYER_NO_OP (Step 1101 5.3-5.5)
export function overlayEditorialDecisionState(base: EditorialDecisionStateV1, replacements: EditorialLayerOperations): EditorialDecisionStateV1 {
  const result: Record<string, unknown> = { ...base };
  for (const layer of EDITORIAL_LAYER_KEYS) {
    const operation = editorialLayerOperation(replacements, layer);
    if (operation === "OMITTED") continue;
    result[layer] = replacements[layer] ?? null;
  }
  return freezeEditorial(result as EditorialDecisionStateV1);
}

// Hash-free redundancy check of every explicit entry against the parent. The only exception: an E5 NORMALIZE_STATIC
// document identical to the parent's whose proposal binds a different pre-master evidence hash (evidence refresh).
export function findRedundantLayerEntry(parent: EditorialRevisionV1, proposal: EditorialProposalV1): string | null {
  for (const layer of EDITORIAL_LAYER_KEYS) {
    const operation = editorialLayerOperation(proposal.replacements, layer);
    const base = parent.decisionState[layer];
    if (operation === "NULL" && base === null) return `${layer} NULL over an absent layer`;
    if (operation !== "DOCUMENT" || base === null || !same(proposal.replacements[layer], base)) continue;
    const refresh = layer === "masteringDecisions" && parent.decisionState.masteringDecisions?.mode === "NORMALIZE_STATIC" &&
      proposal.expectedResult.preMasterEvidenceSha256 !== parent.preMasterEvidenceSha256;
    if (!refresh) return `${layer} document is canonically identical to the base layer`;
  }
  return null;
}

// ---------------------------------------------------------------- partition validation (pure; no source evidence)
export function validateEditorialSubjectPartition(listing: EditorialPartitionListingV1): EditorialHistoryValidation {
  const invalid = (detail: string): EditorialHistoryValidation =>
    freezeEditorial({ ok: false, primaryReason: "HISTORY_INVALID", historyStatus: "HISTORY_INVALID", detail });
  if (!SHA.test(listing.subjectSha256)) return invalid("subject partition name is not a lowercase SHA-256");
  // 1. Directory rules (Step 1101 14.3): only the three record directories; only canonical records or reserved temps.
  const seen = new Set<string>();
  const files: { directory: EditorialPartitionDirectory; name: string; bytes: Uint8Array | null }[] = [];
  for (const entry of listing.entries) {
    const key = `${entry.directory}/${entry.name}`;
    if (seen.has(key)) return invalid(`duplicate partition entry ${key}`);
    seen.add(key);
    if (entry.directory === "") {
      if (entry.type !== "directory" || !(EDITORIAL_PARTITION_DIRECTORIES as readonly string[]).includes(entry.name)) {
        return invalid(`unknown subject partition entry ${entry.name}`);
      }
      continue;
    }
    if (entry.type === "file" && isReservedEditorialTempName(entry.directory, entry.name)) continue;
    if (entry.type !== "file" || !isCanonicalEditorialRecordName(entry.directory, entry.name)) return invalid(`unknown entry ${key}`);
    files.push({ directory: entry.directory, name: entry.name, bytes: entry.bytes });
  }
  // 2. Record integrity (RECORD_CORRUPT), including filename/content identity.
  const proposals = new Map<string, StoredEditorialProposal>();
  const reviews = new Map<string, StoredEditorialReview>();
  const revisionsByNumber = new Map<number, StoredEditorialRevision>();
  try {
    for (const file of files) {
      const label = `${file.directory}/${file.name}`;
      if (file.directory === "proposals") {
        const proposal = decodeRecord(file.bytes, parseEditorialProposalV1, label);
        const proposalSha256 = editorialGovernanceRecordSha256(proposal);
        if (`${proposalSha256}.json` !== file.name) throw new RecordCorrupt(`${label} content hash does not match its filename`);
        proposals.set(proposalSha256, { proposal, proposalSha256, bytes: file.bytes! });
      } else if (file.directory === "reviews") {
        const review = decodeRecord(file.bytes, parseEditorialReviewV1, label);
        if (`${review.proposalSha256}.json` !== file.name) throw new RecordCorrupt(`${label} proposalSha256 does not match its filename`);
        reviews.set(review.proposalSha256, { review, reviewSha256: editorialGovernanceRecordSha256(review), bytes: file.bytes! });
      } else {
        const revision = decodeRecord(file.bytes, parseEditorialRevisionV1, label);
        if (revisionNumberOfName(file.name) !== revision.revisionNumber) throw new RecordCorrupt(`${label} revisionNumber does not match its filename`);
        revisionsByNumber.set(revision.revisionNumber, { revision, revisionSha256: editorialGovernanceRecordSha256(revision), bytes: file.bytes! });
      }
    }
  } catch (cause) {
    if (!(cause instanceof RecordCorrupt)) throw cause;
    return freezeEditorial({ ok: false, primaryReason: "RECORD_CORRUPT", historyStatus: "HISTORY_INVALID", detail: cause.message });
  }
  // 3. R7 partition identity: every record's subject hashes to the partition.
  const subjects = [...proposals.values()].map((p) => p.proposal.subject).concat([...reviews.values()].map((r) => r.review.subject),
    [...revisionsByNumber.values()].map((r) => r.revision.subject));
  if (subjects.some((subject) => hashEditorialSubjectRefV1(subject) !== listing.subjectSha256)) return invalid("record subject does not hash to the partition");
  // 4. Strict 1..N (Step 1101 section 9): no gap, no fallback prefix.
  const numbers = [...revisionsByNumber.keys()].sort((left, right) => left - right);
  if (numbers.some((n, index) => n !== index + 1)) return invalid(`revision sequence is not exactly 1..N (${numbers.join(",")})`);
  const revisions = numbers.map((n) => revisionsByNumber.get(n)!);
  // 5. Every review: no orphan, exact proposal binding and actor rules (contradictory reviews fail closed).
  for (const [proposalSha256, stored] of reviews) {
    const proposal = proposals.get(proposalSha256);
    if (proposal === undefined) return invalid(`orphan review for missing proposal ${proposalSha256}`);
    const check = checkEditorialReviewAgainstProposal(stored.review, proposal.proposal, proposalSha256);
    if (!check.ok) return invalid(`review ${proposalSha256}: ${check.detail}`);
  }
  // 6. R1-R6 per revision.
  const applied = new Set<string>();
  for (const [index, stored] of revisions.entries()) {
    const revision = stored.revision;
    const n = revision.revisionNumber;
    const links = [revision.parentRevisionSha256, revision.appliedProposalSha256, revision.approvalReviewSha256];
    if (n === 1 ? links.some((link) => link !== null) : links.some((link) => link === null)) {
      return invalid(`revision ${n} violates the genesis null-linkage equivalence (R1)`);
    }
    if (hashEditorialDecisionStateV1(revision.decisionState) !== revision.decisionStateSha256) {
      return invalid(`revision ${n} decisionStateSha256 does not hash its decision state (R1/R6)`);
    }
    const applicable = premasterEvidenceApplicable(revision.decisionState);
    if ((revision.preMasterEvidenceSha256 !== null) !== applicable || (revision.masteringRenderKey !== null) !== applicable) {
      return invalid(`revision ${n} mastering identity/evidence nullness does not match its mastering mode (R1/R6)`);
    }
    if (n === 1) continue;
    const parent = revisions[index - 1]!;
    if (revision.parentRevisionSha256 !== parent.revisionSha256 || !same(revision.subject, revisions[0]!.revision.subject)) {
      return invalid(`revision ${n} does not link sequentially to revision ${n - 1} of the same subject (R2)`);
    }
    const proposalSha256 = revision.appliedProposalSha256!;
    const proposal = proposals.get(proposalSha256);
    if (proposal === undefined || !same(proposal.proposal.subject, revision.subject)) return invalid(`revision ${n} applied proposal is missing (R3)`);
    const base = proposal.proposal.base;
    if (base.revisionNumber !== n - 1 || base.revisionSha256 !== parent.revisionSha256 || base.planSha256 !== parent.revision.planSha256) {
      return invalid(`revision ${n} applied proposal base does not identify revision ${n - 1} (R3)`);
    }
    if (applied.has(proposalSha256)) return invalid(`proposal ${proposalSha256} is applied by more than one revision (R3/R7)`);
    applied.add(proposalSha256);
    const review = reviews.get(proposalSha256);
    if (review === undefined || review.reviewSha256 !== revision.approvalReviewSha256 || review.review.outcome !== "APPROVED") {
      return invalid(`revision ${n} is not backed by the stored APPROVED review of its proposal (R4)`);
    }
    if (!same(revision.decisionState, overlayEditorialDecisionState(parent.revision.decisionState, proposal.proposal.replacements)) ||
      findRedundantLayerEntry(parent.revision, proposal.proposal) !== null) {
      return invalid(`revision ${n} decision state is not the deterministic overlay of its parent and proposal (R5)`);
    }
    if (!same(revisionResultAuthority(revision), proposal.proposal.expectedResult)) {
      return invalid(`revision ${n} result authority differs from the approved expected result (R6)`);
    }
  }
  // Shallow freeze: stored entries carry raw bytes (typed arrays cannot be frozen); the records themselves are frozen.
  return Object.freeze({ ok: true, history: Object.freeze({ subjectSha256: listing.subjectSha256, revisions: Object.freeze(revisions), proposals, reviews }) });
}

// ---------------------------------------------------------------- derived state (valid histories only)
export type EditorialProposalState = "PROPOSED" | "APPROVED" | "REJECTED" | "STALE" | "APPLIED";

export function editorialHistoryHead(history: EditorialGovernanceHistory): StoredEditorialRevision | null {
  return history.revisions.at(-1) ?? null;
}

export function findRevisionApplyingProposal(history: EditorialGovernanceHistory, proposalSha256: string): StoredEditorialRevision | null {
  return history.revisions.find((stored) => stored.revision.appliedProposalSha256 === proposalSha256) ?? null;
}

// Precedence APPLIED > REJECTED > STALE > APPROVED > PROPOSED, over a validated history. null = no such proposal.
export function deriveEditorialProposalState(history: EditorialGovernanceHistory, proposalSha256: string): EditorialProposalState | null {
  const stored = history.proposals.get(proposalSha256);
  if (stored === undefined) return null;
  if (findRevisionApplyingProposal(history, proposalSha256) !== null) return "APPLIED";
  const review = history.reviews.get(proposalSha256);
  if (review?.review.outcome === "REJECTED") return "REJECTED";
  const head = editorialHistoryHead(history);
  const base = stored.proposal.base;
  if (head === null || base.revisionNumber !== head.revision.revisionNumber || base.revisionSha256 !== head.revisionSha256 ||
    base.planSha256 !== head.revision.planSha256) return "STALE";
  return review?.review.outcome === "APPROVED" ? "APPROVED" : "PROPOSED";
}
