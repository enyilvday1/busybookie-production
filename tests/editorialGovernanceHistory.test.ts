import { describe, expect, it } from "vitest";
import { buildCompositionShotNormalizationPlan } from "../src/composition/buildCompositionShotNormalizationPlan.js";
import type { PreparedEpisodeCompositionShot } from "../src/composition/prepareEpisodeComposition.js";
import { EpisodeManifestSchema } from "../src/schemas/episodeManifest.schema.js";
import { planEditorialRenderV3 } from "../src/editorial/buildEditorialMixRenderPlan.js";
import { buildEditorialPlanV2 } from "../src/editorial/buildEditorialPlanV2.js";
import { buildEditorialPlanV3 } from "../src/editorial/buildEditorialPlanV3.js";
import { canonicalEditorialJson, editorialSha256 } from "../src/editorial/canonicalizeEditorialPlan.js";
import { hashEditorialPlanV3 } from "../src/editorial/canonicalizeEditorialPlanV3.js";
import type { EditorialPlanSourceInput } from "../src/editorial/validateEditorialPlanAgainstSource.js";
import {
  planEditorialGenesis, planEditorialProposalApplication, planEditorialProposalWrite, planEditorialReviewWrite, type EditorialGovernanceWrite,
} from "../src/editorial/applyEditorialProposal.js";
import {
  deriveEditorialProposalState, isReservedEditorialTempName, overlayEditorialDecisionState, validateEditorialSubjectPartition,
  type EditorialPartitionEntryV1, type EditorialPartitionListingV1,
} from "../src/editorial/deriveEditorialGovernanceState.js";
import {
  EDITORIAL_GOVERNANCE_FROZEN_REASON_CODES, EDITORIAL_GOVERNANCE_REASON_CODES, encodeEditorialGovernanceRecord, hashEditorialProposalV1,
  hashEditorialSubjectRefV1, parseEditorialProposalV1,
} from "../src/editorial/editorialProposal.schema.js";
import { hashEditorialReviewV1, parseEditorialReviewV1 } from "../src/editorial/editorialReview.schema.js";
import { editorialRevisionFileName, parseEditorialRevisionV1 } from "../src/editorial/editorialRevision.schema.js";

// Local, in-memory fixtures only (repeated per E6 test file; no shared helper path is authorized).
type AnyRecord = Record<string, any>;
const MEDIA_ROOT = "D:/Busybookie/Production";
const SHA = (c: string) => c.repeat(64);
const SUBJECT = { kind: "EPISODE", id: "busybookie:episode:EP02" };
const SUBJECT_SHA = hashEditorialSubjectRefV1(SUBJECT);
const HUMAN_A = { kind: "HUMAN", actorId: "human:editor-a", authentication: "DECLARED_UNVERIFIED" };
const HUMAN_B = { kind: "HUMAN", actorId: "human:editor-b", authentication: "DECLARED_UNVERIFIED" };

function sourceFixture(): EditorialPlanSourceInput {
  const postProduction = { aspectRatio: "16:9" as const, width: 1920, height: 1080, timelineFps: 25, audioSampleRateHz: 48000 };
  const episode = EpisodeManifestSchema.parse({
    schemaVersion: "1.0", episodeId: "EP02", title: "Synthetic episode", slug: "synthetic-episode", status: "DRAFT",
    audience: { description: "Children", minAgeYears: 3, maxAgeYears: 6 }, learningGoals: ["Share"], emotionalTheme: "Kindness",
    targetDurationSeconds: 60, approvals: { script: "PENDING", storyboard: "PENDING", references: "PENDING", roughCut: "PENDING", finalQc: "PENDING" },
    scenes: [{ id: "SC01", title: "SC01", summary: "Synthetic scene", shots: [0, 1].map((i) => ({
      id: `S0${i + 1}`, order: i + 1, title: `Shot ${i + 1}`, type: "ACTION", durationSeconds: 4, characters: ["OLLIE"], visualAction: "Walk",
      camera: "Wide", dialogue: [], audio: { sfx: [], ambience: "Non-rendering intent" },
      references: { required: false, assetIds: [], approvalStatus: "NOT_REQUIRED" },
      generation: { provider: "VEO", nativeAudio: false, status: "PLANNED" }, continuityNotes: [] })) }],
  });
  const shots: PreparedEpisodeCompositionShot[] = episode.scenes[0]!.shots.map((shot, i) => {
    const admitted = { sceneId: "SC01", shotId: shot.id, order: shot.order, title: shot.title, durationSeconds: shot.durationSeconds,
      nativeAudio: false, provider: "VEO" as const, providerExecutionId: `task-${i}`, sourceVideoPath: `D:/generated/${shot.id}.mp4`,
      sourceBytes: 100 + i, sourceSha256: String(i % 10).repeat(64), sourceContentType: null };
    const sourceMedia = { sourceVideoPath: admitted.sourceVideoPath, formatName: "mp4", durationSeconds: shot.durationSeconds,
      video: { codecName: "h264", profile: "High", width: 1920, height: 1080, pixelFormat: "yuv420p", frameRate: 25 }, audio: null };
    const normalizationPlan = buildCompositionShotNormalizationPlan({ mediaRoot: MEDIA_ROOT, episodeId: episode.episodeId, shot: admitted, sourceMedia, postProduction });
    return { ...admitted, normalizationPlan, normalizationCacheStatus: "HIT" as const, normalizedArtifact: { outputPath: normalizationPlan.outputPath,
      sha256: SHA("d"), bytes: 200, contentType: "video/mp4", durationSeconds: shot.durationSeconds, durationToleranceSeconds: 1 / 25 } };
  });
  return { episode, postProduction, mediaRoot: MEDIA_ROOT, preparedComposition: { episodeId: episode.episodeId, title: episode.title,
    totalShots: 2, totalDurationSeconds: 8, shots } };
}
const SOURCE = sourceFixture();
const EVIDENCE = { source: SOURCE, externalAudioAssets: [] };
const EMPTY = { editorialDecisions: null, audioMixDecisions: null, masteringDecisions: null };
function e3Doc(overlapFrames = 10): AnyRecord {
  const v2 = buildEditorialPlanV2(SOURCE, null);
  return { schemaVersion: "1.0", decisionsType: "BUSYBOOKIE_EDITORIAL_DECISIONS", episodeId: "EP02",
    sourceBinding: { manifestSha256: v2.episode.manifestSha256, shotAssets: v2.shots.map((s, i) => ({ shotId: s.shotId, normalizedAssetSha256: v2.assets[i]!.sha256 })) },
    clips: [], transitions: [{ outgoingShotId: "S01", incomingShotId: "S02", type: "CROSS_DISSOLVE", overlapFrames }] };
}
function oracle(state: AnyRecord): AnyRecord {
  const v3 = buildEditorialPlanV3({ basePlan: buildEditorialPlanV2(SOURCE, state.editorialDecisions), externalAudioAssets: [], audioMixDecisions: null });
  const route = planEditorialRenderV3({ plan: v3, mediaRoot: MEDIA_ROOT });
  return { decisionStateSha256: editorialSha256(canonicalEditorialJson(state)), planSha256: hashEditorialPlanV3(v3), upstreamRoute: route.route,
    upstreamRenderKey: route.renderPlan.renderKey, masteringRenderKey: null, preMasterEvidenceSha256: null };
}

class Partition {
  files = new Map<string, Uint8Array | null>();
  extra: EditorialPartitionEntryV1[] = [];
  listing(): EditorialPartitionListingV1 {
    const entries: EditorialPartitionEntryV1[] = [];
    for (const dir of new Set([...this.files.keys()].map((key) => key.split("/")[0]!))) entries.push({ directory: "", name: dir, type: "directory", bytes: null });
    for (const [key, bytes] of this.files) {
      const [dir, name] = key.split("/") as [any, string];
      entries.push({ directory: dir, name, type: "file", bytes });
    }
    return { subjectSha256: SUBJECT_SHA, entries: [...entries, ...this.extra] };
  }
  commit(write: EditorialGovernanceWrite): void { this.files.set(`${write.directory}/${write.name}`, write.bytes); }
  clone(): Partition { const p = new Partition(); p.files = new Map(this.files); p.extra = [...this.extra]; return p; }
}
function must<T extends { ok: boolean }>(value: T): Extract<T, { ok: true }> {
  if (!value.ok) throw new Error(JSON.stringify(value));
  return value as Extract<T, { ok: true }>;
}
function proposalRecord(base: AnyRecord, replacements: AnyRecord, expectedResult: AnyRecord): AnyRecord {
  return { recordType: "BUSYBOOKIE_EDITORIAL_PROPOSAL", recordVersion: "1", subject: SUBJECT, base, proposer: HUMAN_A,
    rationale: "Add a dissolve", replacements, expectedResult };
}
// Valid two-revision history: genesis + one applied E3 proposal.
function twoRevisions() {
  const p = new Partition();
  const g = must(planEditorialGenesis({ listing: p.listing(), subject: SUBJECT, decisionState: EMPTY, evidence: EVIDENCE }));
  if (g.action === "PUBLISH") p.commit(g.write);
  const state = { ...EMPTY, editorialDecisions: e3Doc() };
  const prop = must(planEditorialProposalWrite({ listing: p.listing(), proposal: proposalRecord(
    { revisionNumber: 1, revisionSha256: g.revisionSha256, planSha256: g.revision.planSha256 }, { editorialDecisions: e3Doc() }, oracle(state)) }));
  p.commit(prop.write);
  const review = { recordType: "BUSYBOOKIE_EDITORIAL_REVIEW", recordVersion: "1", subject: SUBJECT, proposalSha256: prop.proposalSha256,
    base: { revisionNumber: 1, revisionSha256: g.revisionSha256 }, outcome: "APPROVED", reviewer: HUMAN_B, reason: "Approved" };
  p.commit(must(planEditorialReviewWrite({ listing: p.listing(), review })).write);
  const applied = must(planEditorialProposalApplication({ listing: p.listing(), proposalSha256: prop.proposalSha256, evidence: EVIDENCE }));
  if (applied.action !== "PUBLISH") throw new Error("expected publish");
  p.commit(applied.write);
  return { p, genesis: g, proposalSha256: prop.proposalSha256, rev2: applied.revision, review };
}
const decode = (bytes: Uint8Array | null | undefined): AnyRecord => JSON.parse(new TextDecoder().decode(bytes!));
const rev = (n: number) => `revisions/${editorialRevisionFileName(n)}`;
function verdict(p: Partition) {
  const v = validateEditorialSubjectPartition(p.listing());
  return v.ok ? "OK" : `${v.primaryReason}/${v.historyStatus}`;
}

describe("E6 records: strict proposal schema (1) and canonical hashing (2)", () => {
  const base = { revisionNumber: 1, revisionSha256: SHA("a"), planSha256: SHA("b") };
  const expected = { decisionStateSha256: SHA("1"), planSha256: SHA("2"), upstreamRoute: "E3_EDIT", upstreamRenderKey: SHA("3"),
    masteringRenderKey: null, preMasterEvidenceSha256: null };
  const valid = () => proposalRecord(base, { editorialDecisions: e3Doc() }, expected);

  it("accepts the tri-state and rejects every malformed form", () => {
    expect(parseEditorialProposalV1(valid()).replacements).toHaveProperty("editorialDecisions");
    expect(Object.hasOwn(parseEditorialProposalV1(proposalRecord(base, { audioMixDecisions: null }, expected)).replacements, "audioMixDecisions")).toBe(true);
    const bad: AnyRecord[] = [
      { ...valid(), replacements: {} },
      { ...valid(), replacements: { editorialDecisions: undefined } },
      { ...valid(), replacements: { assetReplacement: null } },
      { ...valid(), extra: true },
      { ...valid(), subject: { kind: "EPISODE", id: "C:/episodes/EP02" } },
      { ...valid(), proposer: { ...HUMAN_A, authentication: "VERIFIED" } },
      { ...valid(), proposer: { ...HUMAN_A, token: "x" } },
      { ...valid(), rationale: "" },
      { ...valid(), rationale: " padded " },
      { ...valid(), base: { ...base, revisionNumber: 0 } },
      { ...valid(), expectedResult: { ...expected, masteringRenderKey: SHA("4") } },
      { ...valid(), replacements: { editorialDecisions: { ...e3Doc(), clips: "x" } } },
      { ...valid(), recordType: "BUSYBOOKIE_EDITORIAL_RECEIPT" },
    ];
    const replacementsOmitted = valid();
    delete replacementsOmitted.replacements;
    bad.push(replacementsOmitted);
    for (const record of bad) expect(() => parseEditorialProposalV1(record), JSON.stringify(record).slice(0, 80)).toThrow();
  });

  it("identity is deterministic, key-order independent, metadata-sensitive and excludes its own hash, paths and time", () => {
    const record = valid();
    const reordered = Object.fromEntries(Object.entries(record).reverse());
    expect(hashEditorialProposalV1(reordered)).toBe(hashEditorialProposalV1(record));
    expect(hashEditorialProposalV1({ ...record, rationale: "Another rationale" })).not.toBe(hashEditorialProposalV1(record));
    const bytes = encodeEditorialGovernanceRecord(parseEditorialProposalV1(record));
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe(`${canonicalEditorialJson(parseEditorialProposalV1(record))}\n`);
    expect(text).not.toMatch(/proposalSha256|D:\/|mediaRoot|recordedAt|createdAt|hostname|pid/);
    expect(editorialSha256(text.slice(0, -1))).toBe(hashEditorialProposalV1(record));
  });

  it("review schema is strict; review identity is the canonical payload hash", () => {
    const review = { recordType: "BUSYBOOKIE_EDITORIAL_REVIEW", recordVersion: "1", subject: SUBJECT, proposalSha256: SHA("c"),
      base: { revisionNumber: 1, revisionSha256: SHA("a") }, outcome: "APPROVED", reviewer: HUMAN_B, reason: "Approved" };
    expect(hashEditorialReviewV1(review)).toBe(editorialSha256(canonicalEditorialJson(parseEditorialReviewV1(review))));
    for (const bad of [{ ...review, outcome: "APPROVED_WITH_CHANGES" }, { ...review, partial: true }, { ...review, base: { revisionNumber: 1 } }]) {
      expect(() => parseEditorialReviewV1(bad)).toThrow();
    }
  });

  it("freezes the 17-code minimum taxonomy exactly; added diagnostics are distinct", () => {
    expect(EDITORIAL_GOVERNANCE_FROZEN_REASON_CODES).toStrictEqual(["HISTORY_INVALID", "RECORD_CORRUPT", "NO_GENESIS", "GENESIS_CONFLICT", "STALE",
      "REVIEW_MISSING", "REVIEW_NOT_APPROVED", "REVIEW_NOT_PERMITTED", "REVIEW_CONFLICT", "BASE_SOURCE_MISMATCH", "CASCADE_INCOMPLETE",
      "CASCADE_BINDING_MISMATCH", "LAYER_NO_OP", "RESULT_DERIVATION_FAILED", "EXPECTED_RESULT_MISMATCH", "NO_OP_PROPOSAL", "STORE_UNSUPPORTED"]);
    expect(new Set(EDITORIAL_GOVERNANCE_REASON_CODES).size).toBe(EDITORIAL_GOVERNANCE_REASON_CODES.length);
  });

  it("revision filenames are 16-digit; overlay is the deterministic tri-state", () => {
    expect(editorialRevisionFileName(3)).toBe("0000000000000003.json");
    expect(() => editorialRevisionFileName(0)).toThrow();
    const state = { ...EMPTY, editorialDecisions: parseEditorialProposalV1(proposalRecord(base, { editorialDecisions: e3Doc() }, expected)).replacements.editorialDecisions! };
    expect(overlayEditorialDecisionState(state as any, {})).toStrictEqual(state);
    expect(overlayEditorialDecisionState(state as any, { editorialDecisions: null }).editorialDecisions).toBeNull();
  });
});

describe("E6 strict 1..N history (11), R1-R7 (12) and corruption (19 pure part)", () => {
  it("a valid history has head N; re-encoding a stored revision with another number creates a gap", () => {
    const { p } = twoRevisions();
    expect(verdict(p)).toBe("OK");
    const forged = (n: number, base = decode(p.files.get(rev(2)))) => encodeEditorialGovernanceRecord(parseEditorialRevisionV1({ ...base, revisionNumber: n }));
    const gap13 = p.clone();
    gap13.files.delete(rev(2));
    gap13.files.set(rev(3), forged(3));
    expect(verdict(gap13)).toBe("HISTORY_INVALID/HISTORY_INVALID");
    const gap124 = p.clone();
    gap124.files.set(rev(4), forged(4));
    expect(verdict(gap124)).toBe("HISTORY_INVALID/HISTORY_INVALID");
    const without1 = p.clone();
    without1.files.delete(rev(1));
    expect(verdict(without1)).toBe("HISTORY_INVALID/HISTORY_INVALID");
    const alias = p.clone();
    alias.files.set("revisions/2.json", p.files.get(rev(2))!);
    expect(verdict(alias)).toBe("HISTORY_INVALID/HISTORY_INVALID");
    const upper = p.clone();
    upper.files.set(`proposals/${"A".repeat(64)}.json`, new Uint8Array([1]));
    expect(verdict(upper)).toBe("HISTORY_INVALID/HISTORY_INVALID");
  });

  it("R1 genesis linkage, R2 parent, R5 overlay and R6 result authority forgeries are HISTORY_INVALID", () => {
    const { p, proposalSha256 } = twoRevisions();
    const r1 = decode(p.files.get(rev(1)));
    const r2 = decode(p.files.get(rev(2)));
    const reencode = (value: AnyRecord) => encodeEditorialGovernanceRecord(parseEditorialRevisionV1(value));
    const cases: [string, AnyRecord][] = [
      [rev(1), { ...r1, appliedProposalSha256: proposalSha256 }],
      [rev(2), { ...r2, parentRevisionSha256: SHA("0") }],
      [rev(2), { ...r2, decisionState: { ...r2.decisionState, editorialDecisions: e3Doc(12) },
        decisionStateSha256: editorialSha256(canonicalEditorialJson({ ...r2.decisionState, editorialDecisions: e3Doc(12) })) }],
      [rev(2), { ...r2, planSha256: SHA("9") }],
      [rev(2), { ...r2, decisionStateSha256: SHA("8") }],
      [rev(2), { ...r2, masteringRenderKey: SHA("7") }],
      [rev(2), { ...r2, subject: { kind: "EPISODE", id: "busybookie:episode:EP03" } }],
    ];
    for (const [path, value] of cases) {
      const forged = p.clone();
      forged.files.set(path, reencode(value));
      expect(verdict(forged), JSON.stringify(value).slice(0, 60)).toBe("HISTORY_INVALID/HISTORY_INVALID");
    }
  });

  it("R3/R4 missing or wrong proposal/review, S REJECTED review backing an applied revision, R same proposal twice", () => {
    const { p, proposalSha256, review } = twoRevisions();
    const noProposal = p.clone();
    noProposal.files.delete(`proposals/${proposalSha256}.json`);
    noProposal.files.delete(`reviews/${proposalSha256}.json`);
    expect(verdict(noProposal)).toBe("HISTORY_INVALID/HISTORY_INVALID");
    const orphanReview = p.clone();
    orphanReview.files.delete(`proposals/${proposalSha256}.json`);
    expect(verdict(orphanReview)).toBe("HISTORY_INVALID/HISTORY_INVALID");
    const noReview = p.clone();
    noReview.files.delete(`reviews/${proposalSha256}.json`);
    expect(verdict(noReview)).toBe("HISTORY_INVALID/HISTORY_INVALID");
    const rejected = p.clone();
    rejected.files.set(`reviews/${proposalSha256}.json`, encodeEditorialGovernanceRecord(parseEditorialReviewV1({ ...review, outcome: "REJECTED" })));
    const v = validateEditorialSubjectPartition(rejected.listing());
    expect(v.ok).toBe(false);
    expect(v.ok ? "" : v.detail).toContain("R4");
    const twice = p.clone();
    const r2 = decode(p.files.get(rev(2)));
    const r2sha = editorialSha256(canonicalEditorialJson(parseEditorialRevisionV1(r2)));
    twice.files.set(rev(3), encodeEditorialGovernanceRecord(parseEditorialRevisionV1({ ...r2, revisionNumber: 3, parentRevisionSha256: r2sha })));
    expect(verdict(twice)).toBe("HISTORY_INVALID/HISTORY_INVALID");
    const selfApproved = p.clone();
    selfApproved.files.set(`reviews/${proposalSha256}.json`, encodeEditorialGovernanceRecord(parseEditorialReviewV1({ ...review, reviewer: HUMAN_A })));
    expect(verdict(selfApproved)).toBe("HISTORY_INVALID/HISTORY_INVALID");
  });

  it("H corrupt canonical records are RECORD_CORRUPT at record level with HISTORY_INVALID subject status; never skipped", () => {
    const { p, proposalSha256 } = twoRevisions();
    const original = p.files.get(rev(2))!;
    const pretty = new TextEncoder().encode(`${JSON.stringify(decode(original), null, 2)}\n`);
    const corruptions: [string, Uint8Array | null][] = [
      [rev(2), original.slice(0, original.length - 10)],
      [rev(2), original.slice(0, original.length - 1)],
      [rev(2), new Uint8Array([0xff, 0xfe, 0x0a])],
      [rev(2), pretty],
      [rev(2), null],
      [`proposals/${SHA("0")}.json`, p.files.get(`proposals/${proposalSha256}.json`)!],
      [rev(2), p.files.get(rev(1))!],
    ];
    for (const [path, bytes] of corruptions) {
      const broken = p.clone();
      broken.files.set(path, bytes);
      expect(verdict(broken), path).toBe("RECORD_CORRUPT/HISTORY_INVALID");
      const write = planEditorialProposalWrite({ listing: broken.listing(), proposal: {} });
      expect(write).toMatchObject({ ok: false, reason: "RECORD_CORRUPT", historyStatus: "HISTORY_INVALID" });
    }
  });

  it("reserved temporaries are ignored; unknown entries and mis-named temps fail closed", () => {
    const { p } = twoRevisions();
    const hex = "0123456789abcdef0123456789abcdef";
    const withTemp = p.clone();
    withTemp.files.set(`revisions/.0000000000000003.json.tmp-${hex}`, new Uint8Array([1, 2]));
    expect(verdict(withTemp)).toBe("OK");
    expect(isReservedEditorialTempName("revisions", `.0000000000000003.json.tmp-${hex}`)).toBe(true);
    expect(isReservedEditorialTempName("proposals", `.0000000000000003.json.tmp-${hex}`)).toBe(false);
    expect(isReservedEditorialTempName("revisions", `.0000000000000003.json.tmp-${hex.toUpperCase()}`)).toBe(false);
    for (const [dir, name, type] of [["revisions", `.foo.tmp-${hex}`, "file"], ["proposals", `.0000000000000003.json.tmp-${hex}`, "file"],
      ["revisions", "nested", "directory"], ["", "notes.txt", "file"], ["", "tmp", "directory"]] as const) {
      const odd = p.clone();
      odd.extra.push({ directory: dir, name, type, bytes: type === "file" ? new Uint8Array([1]) : null });
      expect(verdict(odd), `${dir}/${name}`).toBe("HISTORY_INVALID/HISTORY_INVALID");
    }
  });

  it("history validation precedes state: a malformed history never resolves to APPLIED", () => {
    const { p, proposalSha256, review } = twoRevisions();
    const v = validateEditorialSubjectPartition(p.listing());
    expect(v.ok && deriveEditorialProposalState(v.history, proposalSha256)).toBe("APPLIED");
    const broken = p.clone();
    broken.files.set(`reviews/${proposalSha256}.json`, encodeEditorialGovernanceRecord(parseEditorialReviewV1({ ...review, outcome: "REJECTED" })));
    const out = planEditorialProposalApplication({ listing: broken.listing(), proposalSha256, evidence: EVIDENCE });
    expect(out).toMatchObject({ ok: false, reason: "HISTORY_INVALID", historyStatus: "HISTORY_INVALID" });
  });
});
