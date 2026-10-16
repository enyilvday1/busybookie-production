import { describe, expect, it } from "vitest";
import { buildCompositionShotNormalizationPlan } from "../src/composition/buildCompositionShotNormalizationPlan.js";
import { buildEpisodeRoughCutFfmpegCommand } from "../src/composition/buildEpisodeRoughCutFfmpegCommand.js";
import type { PreparedEpisodeCompositionShot } from "../src/composition/prepareEpisodeComposition.js";
import { EpisodeManifestSchema } from "../src/schemas/episodeManifest.schema.js";
import {
  E5_REQUIRED_FILTERS, buildPreMasterLoudnessEvidence, checkPreMasterEvidenceBinding, hashPreMasterLoudnessEvidenceV1, toolchainEvidenceKey,
} from "../src/editorial/audioMasteringEvidence.schema.js";
import { buildAudioMasteringPlan } from "../src/editorial/buildAudioMasteringPlan.js";
import { buildEditorialEditFfmpegCommand } from "../src/editorial/buildEditorialEditFfmpegCommand.js";
import { buildEditorialMixFfmpegCommand } from "../src/editorial/buildEditorialMixFfmpegCommand.js";
import { planEditorialRenderV3 } from "../src/editorial/buildEditorialMixRenderPlan.js";
import { buildEditorialPlanV2 } from "../src/editorial/buildEditorialPlanV2.js";
import { buildEditorialPlanV3 } from "../src/editorial/buildEditorialPlanV3.js";
import { canonicalEditorialJson, editorialSha256 } from "../src/editorial/canonicalizeEditorialPlan.js";
import { hashEditorialPlanV2 } from "../src/editorial/canonicalizeEditorialPlanV2.js";
import { hashEditorialPlanV3 } from "../src/editorial/canonicalizeEditorialPlanV3.js";
import { deriveAudioMasteringUpstream } from "../src/editorial/deriveAudioMasteringUpstream.js";
import { assertEditorialEditRenderPreflight, type EditorialEditRenderPreflightResult } from "../src/editorial/editorialEditRenderPreflight.js";
import { assertEditorialMixRenderPreflight } from "../src/editorial/editorialMixRenderPreflight.js";
import type { EditorialPlanSourceInput } from "../src/editorial/validateEditorialPlanAgainstSource.js";
import {
  classifyEditorialChange, planEditorialGenesis, planEditorialProposalApplication, planEditorialProposalWrite, planEditorialReviewWrite,
  type EditorialGovernanceWrite, type EditorialMasteringSideEvidence, type EditorialResultMasteringEvidence,
} from "../src/editorial/applyEditorialProposal.js";
import {
  deriveEditorialProposalState, validateEditorialSubjectPartition, type EditorialPartitionEntryV1, type EditorialPartitionListingV1,
} from "../src/editorial/deriveEditorialGovernanceState.js";
import { hashEditorialSubjectRefV1 } from "../src/editorial/editorialProposal.schema.js";

// Local, in-memory fixtures only (repeated per E6 test file; no shared helper path is authorized).
type AnyRecord = Record<string, any>;
const MEDIA_ROOT = "D:/Busybookie/Production";
const SHA = (c: string) => c.repeat(64);
const SUBJECT = { kind: "EPISODE", id: "busybookie:episode:EP02" };
const SUBJECT_SHA = hashEditorialSubjectRefV1(SUBJECT);
const HUMAN_A = { kind: "HUMAN", actorId: "human:editor-a", authentication: "DECLARED_UNVERIFIED" };
const HUMAN_B = { kind: "HUMAN", actorId: "human:editor-b", authentication: "DECLARED_UNVERIFIED" };
const MACHINE = { kind: "MACHINE", actorId: "machine:continuity-check", authentication: "DECLARED_UNVERIFIED" };

function sourceFixture(options: { assetSha?: string; title?: string } = {}): EditorialPlanSourceInput {
  const postProduction = { aspectRatio: "16:9" as const, width: 1920, height: 1080, timelineFps: 25, audioSampleRateHz: 48000 };
  const shotsSpec = [0, 1].map((i) => ({
    id: `S0${i + 1}`, order: i + 1, title: `Shot ${i + 1}`, type: "ACTION", durationSeconds: 4, characters: ["OLLIE"], visualAction: "Walk",
    camera: "Wide", dialogue: [], audio: { sfx: [], ambience: "Non-rendering intent" },
    references: { required: false, assetIds: [], approvalStatus: "NOT_REQUIRED" },
    generation: { provider: "VEO", nativeAudio: false, status: "PLANNED" }, continuityNotes: [],
  }));
  const episode = EpisodeManifestSchema.parse({
    schemaVersion: "1.0", episodeId: "EP02", title: options.title ?? "Synthetic episode", slug: "synthetic-episode", status: "DRAFT",
    audience: { description: "Children", minAgeYears: 3, maxAgeYears: 6 }, learningGoals: ["Share"], emotionalTheme: "Kindness",
    targetDurationSeconds: 60, approvals: { script: "PENDING", storyboard: "PENDING", references: "PENDING", roughCut: "PENDING", finalQc: "PENDING" },
    scenes: [{ id: "SC01", title: "SC01", summary: "Synthetic scene", shots: shotsSpec }],
  });
  const shots: PreparedEpisodeCompositionShot[] = episode.scenes[0]!.shots.map((shot, i) => {
    const admitted = {
      sceneId: "SC01", shotId: shot.id, order: shot.order, title: shot.title, durationSeconds: shot.durationSeconds, nativeAudio: false,
      provider: "VEO" as const, providerExecutionId: `task-${i}`, sourceVideoPath: `D:/generated/${shot.id}.mp4`, sourceBytes: 100 + i,
      sourceSha256: String(i % 10).repeat(64), sourceContentType: null,
    };
    const sourceMedia = { sourceVideoPath: admitted.sourceVideoPath, formatName: "mp4", durationSeconds: shot.durationSeconds,
      video: { codecName: "h264", profile: "High", width: 1920, height: 1080, pixelFormat: "yuv420p", frameRate: 25 }, audio: null };
    const normalizationPlan = buildCompositionShotNormalizationPlan({ mediaRoot: MEDIA_ROOT, episodeId: episode.episodeId, shot: admitted, sourceMedia, postProduction });
    return { ...admitted, normalizationPlan, normalizationCacheStatus: "HIT" as const,
      normalizedArtifact: { outputPath: normalizationPlan.outputPath, sha256: options.assetSha ?? SHA("d"), bytes: 200, contentType: "video/mp4",
        durationSeconds: shot.durationSeconds, durationToleranceSeconds: 1 / 25 } };
  });
  return { episode, postProduction, mediaRoot: MEDIA_ROOT, preparedComposition: { episodeId: episode.episodeId, title: episode.title,
    totalShots: shots.length, totalDurationSeconds: 8, shots } };
}
const SOURCE = sourceFixture();
const EVIDENCE = { source: SOURCE, externalAudioAssets: [] };

function e3Doc(overlapFrames = 10): AnyRecord {
  const v2 = buildEditorialPlanV2(SOURCE, null);
  return { schemaVersion: "1.0", decisionsType: "BUSYBOOKIE_EDITORIAL_DECISIONS", episodeId: "EP02",
    sourceBinding: { manifestSha256: v2.episode.manifestSha256, shotAssets: v2.shots.map((s, i) => ({ shotId: s.shotId, normalizedAssetSha256: v2.assets[i]!.sha256 })) },
    clips: [], transitions: [{ outgoingShotId: "S01", incomingShotId: "S02", type: "CROSS_DISSOLVE", overlapFrames }] };
}
function e4Doc(e3: unknown, bedGainCentiDb = -600): AnyRecord {
  return { schemaVersion: "1.0", decisionsType: "BUSYBOOKIE_AUDIO_MIX_DECISIONS",
    sourceBinding: { baseEditorialPlanSha256: hashEditorialPlanV2(buildEditorialPlanV2(SOURCE, e3)), externalAudioAssets: [] },
    bed: { bedGainCentiDb, bedMuted: false }, layers: [] };
}
const v3Of = (e3: unknown, e4: unknown) => buildEditorialPlanV3({ basePlan: buildEditorialPlanV2(SOURCE, e3), externalAudioAssets: [], audioMixDecisions: e4 });
function policy(overrides: AnyRecord = {}): AnyRecord {
  return { policyType: "BUSYBOOKIE_AUDIO_DELIVERY_POLICY", policyVersion: "1", policyId: "audio-delivery:test-episode",
    measurementEngine: "FFMPEG_LOUDNORM_INPUT_STATS_V1", targetIntegratedCentiLufs: -1600, integratedToleranceCentiLu: 100,
    truePeakCeilingCentiDbtp: -100, minimumGainCentiDb: -2000, maximumGainCentiDb: 1000, loudnessRangePolicy: "RECORD_ONLY",
    expectedAudio: { codecName: "aac", sampleRateHz: 48000, channels: 2, channelLayout: "stereo" }, ...overrides };
}
function e5Doc(e3: unknown, e4: unknown, mode: "MEASURE_ONLY" | "NORMALIZE_STATIC" = "NORMALIZE_STATIC", deliveryPolicy: unknown = policy()): AnyRecord {
  const v3 = v3Of(e3, e4);
  const route = planEditorialRenderV3({ plan: v3, mediaRoot: MEDIA_ROOT });
  return { decisionsType: "BUSYBOOKIE_AUDIO_MASTERING_DECISIONS", schemaVersion: "1.0",
    sourceBinding: { editorialPlanSha256: hashEditorialPlanV3(v3), upstreamRoute: route.route, upstreamRenderKey: route.renderPlan.renderKey },
    mode, deliveryPolicy };
}
const TOOLCHAIN_OLD: AnyRecord = {
  evidenceType: "BUSYBOOKIE_E5_TOOLCHAIN_EVIDENCE", evidenceVersion: "1",
  ffmpegVersionLine: "ffmpeg version 9.0.2 Copyright (c) 2000-2026 the FFmpeg developers", ffmpegSha256: SHA("f"),
  ffprobeVersionLine: "ffprobe version 9.0.2 Copyright (c) 2007-2026 the FFmpeg developers", ffprobeSha256: SHA("c"),
  requiredFilters: [...E5_REQUIRED_FILTERS], measurementEngine: "FFMPEG_LOUDNORM_INPUT_STATS_V1", invocationModel: "DIRECT_SPAWN_ARGV_NO_SHELL_V1",
};
const OLD = toolchainEvidenceKey(TOOLCHAIN_OLD);
const NEW = toolchainEvidenceKey({ ...TOOLCHAIN_OLD, ffmpegVersionLine: "ffmpeg version 9.1.0 Copyright (c) 2000-2026 the FFmpeg developers", ffmpegSha256: SHA("a") });
function loudnormStderr(i = "-23.45", tp = "-12.10"): Uint8Array {
  return new TextEncoder().encode(["[Parsed_loudnorm_2 @ 0000020a5c8b1d40] ", "{", `\t"input_i" : "${i}",`, `\t"input_tp" : "${tp}",`,
    "\t\"input_lra\" : \"5.20\",", "\t\"input_thresh\" : \"-33.71\",", "\t\"output_i\" : \"-24.02\",", "\t\"output_tp\" : \"-5.92\",",
    "\t\"output_lra\" : \"4.30\",", "\t\"output_thresh\" : \"-34.20\",", "\t\"normalization_type\" : \"dynamic\",", "\t\"target_offset\" : \"0.02\"", "}", ""].join("\r\n"));
}
type Upstream = { upstreamArgs: string[]; e3Preflight?: EditorialEditRenderPreflightResult; e4Receipt?: unknown };
function upstreamFor(plan: unknown): Upstream {
  const route = planEditorialRenderV3({ plan, mediaRoot: MEDIA_ROOT });
  if (route.route === "E2_ROUGH_CUT") {
    return { upstreamArgs: [...buildEpisodeRoughCutFfmpegCommand({ ffmpegExecutable: "ffmpeg", plan: route.renderPlan, outputPath: route.renderPlan.outputPath }).args] };
  }
  if (route.route === "E3_EDIT") {
    const rp = route.renderPlan;
    const e3Preflight = assertEditorialEditRenderPreflight({ renderPlan: rp, evidence: rp.inputs.map((e) => ({ assetId: e.assetId,
      decodedVideoFrameCount: e.assetDurationFrames, decodedAudioSampleCount: e.assetDurationFrames * 1920 })) });
    return { upstreamArgs: [...buildEditorialEditFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan: rp, preflight: e3Preflight, outputPath: rp.outputPath }).args], e3Preflight };
  }
  const rp = route.renderPlan;
  const e4Receipt = assertEditorialMixRenderPreflight({ renderPlan: rp, outputPath: rp.outputPath, externalEvidence: [],
    baseEvidence: rp.inputs.flatMap((e) => (e.mediaKind === "NORMALIZED_SHOT" ? [{ assetId: e.assetId, sha256: e.sha256, bytes: e.bytes,
      decodedVideoFrameCount: e.assetDurationFrames, decodedAudioSampleCount: e.assetDurationFrames * 1920 }] : [])),
    peakEvidence: { renderKey: rp.renderKey, mixGraphSha256: rp.mixGraphSha256, channelCount: 2, decodedSampleFrameCount: rp.timelineDurationSamples,
      nonFiniteSampleCount: 0, maxAbsSampleF32Bits: 0x3f000000 } });
  return { upstreamArgs: [...buildEditorialMixFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan: rp, receipt: e4Receipt, outputPath: rp.outputPath }).args], e4Receipt };
}
// Pre-master evidence for the plan of (e3, e4), measured under the given toolchain key.
function sideEvidence(e3: unknown, e4: unknown, key: string, i = "-23.45", tp = "-12.10"): EditorialResultMasteringEvidence {
  const plan = v3Of(e3, e4);
  const derived = deriveAudioMasteringUpstream({ plan, mediaRoot: MEDIA_ROOT });
  if (!derived.ok) throw new Error("fixture not masterable");
  const up = upstreamFor(plan);
  const built = buildPreMasterLoudnessEvidence({ derivation: derived.derivation, upstreamArgs: up.upstreamArgs, toolchainEvidenceKey: key, stderr: loudnormStderr(i, tp) });
  if (!built.ok) throw new Error("fixture evidence failed");
  return { preMasterEvidence: built.evidence, ...up, toolchainEvidenceKey: key };
}
const asBase = (side: EditorialResultMasteringEvidence): EditorialMasteringSideEvidence => {
  const { toolchainEvidenceKey: _key, ...rest } = side;
  return rest;
};
type State = { editorialDecisions: unknown; audioMixDecisions: unknown; masteringDecisions: unknown };
// Independent oracle: the six values computed directly from the existing E2-E5 builders.
function oracle(state: State, mastering?: EditorialResultMasteringEvidence): AnyRecord {
  const v3 = v3Of(state.editorialDecisions, state.audioMixDecisions);
  const route = planEditorialRenderV3({ plan: v3, mediaRoot: MEDIA_ROOT });
  let masteringRenderKey: string | null = null;
  let preMasterEvidenceSha256: string | null = null;
  const m = state.masteringDecisions as AnyRecord | null;
  if (m !== null && m.mode === "NORMALIZE_STATIC") {
    const built = buildAudioMasteringPlan({ decisions: m, plan: v3, mediaRoot: MEDIA_ROOT, upstreamArgs: mastering!.upstreamArgs,
      toolchainEvidenceKey: mastering!.toolchainEvidenceKey, preMasterEvidence: mastering!.preMasterEvidence,
      ...(mastering!.e3Preflight === undefined ? {} : { e3Preflight: mastering!.e3Preflight }),
      ...(mastering!.e4Receipt === undefined ? {} : { e4Receipt: mastering!.e4Receipt }) });
    if (!built.ok || built.masteringPlan.mode !== "NORMALIZE_STATIC") throw new Error(`oracle mastering failed ${JSON.stringify(built)}`);
    masteringRenderKey = built.masteringPlan.renderKey;
    preMasterEvidenceSha256 = built.masteringPlan.preMasterEvidenceSha256;
  }
  return { decisionStateSha256: editorialSha256(canonicalEditorialJson(state)), planSha256: hashEditorialPlanV3(v3), upstreamRoute: route.route,
    upstreamRenderKey: route.renderPlan.renderKey, masteringRenderKey, preMasterEvidenceSha256 };
}

// In-memory partition (bytes only), mirroring what the store adapter lists.
class Partition {
  files = new Map<string, Uint8Array>();
  listing(subjectSha256 = SUBJECT_SHA): EditorialPartitionListingV1 {
    const entries: EditorialPartitionEntryV1[] = [];
    const dirs = new Set([...this.files.keys()].map((key) => key.split("/")[0]!));
    for (const dir of dirs) entries.push({ directory: "", name: dir, type: "directory", bytes: null });
    for (const [key, bytes] of this.files) {
      const [dir, name] = key.split("/") as [any, string];
      entries.push({ directory: dir, name, type: "file", bytes });
    }
    return { subjectSha256, entries };
  }
  commit(write: EditorialGovernanceWrite): void {
    const key = `${write.directory}/${write.name}`;
    if (this.files.has(key)) throw new Error(`no-clobber violated for ${key}`);
    this.files.set(key, write.bytes);
  }
  clone(): Partition { const p = new Partition(); p.files = new Map(this.files); return p; }
}
function ok<T extends { ok: boolean }>(value: T): Extract<T, { ok: true }> {
  if (!value.ok) throw new Error(`unexpected failure ${JSON.stringify(value)}`);
  return value as Extract<T, { ok: true }>;
}
function genesis(p: Partition, state: State, mastering?: EditorialResultMasteringEvidence) {
  const out = ok(planEditorialGenesis({ listing: p.listing(), subject: SUBJECT, decisionState: state, evidence: EVIDENCE,
    ...(mastering === undefined ? {} : { mastering }) }));
  if (out.action === "PUBLISH") p.commit(out.write);
  return out;
}
function head(p: Partition) {
  const v = validateEditorialSubjectPartition(p.listing());
  if (!v.ok) throw new Error(v.detail);
  return v.history.revisions.at(-1)!;
}
function proposal(p: Partition, replacements: AnyRecord, expectedResult: AnyRecord, proposer: AnyRecord = HUMAN_A, rationale = "Editorial change") {
  const h = head(p);
  return { recordType: "BUSYBOOKIE_EDITORIAL_PROPOSAL", recordVersion: "1", subject: SUBJECT,
    base: { revisionNumber: h.revision.revisionNumber, revisionSha256: h.revisionSha256, planSha256: h.revision.planSha256 },
    proposer, rationale, replacements, expectedResult };
}
function store(p: Partition, record: AnyRecord): string {
  const out = ok(planEditorialProposalWrite({ listing: p.listing(), proposal: record }));
  if (out.action === "PUBLISH") p.commit(out.write);
  return out.proposalSha256;
}
function reviewRecord(p: Partition, proposalSha256: string, outcome: "APPROVED" | "REJECTED" = "APPROVED", reviewer: AnyRecord = HUMAN_B, reason = "Looks right") {
  const stored = validateEditorialSubjectPartition(p.listing());
  if (!stored.ok) throw new Error(stored.detail);
  const prop = stored.history.proposals.get(proposalSha256)!.proposal;
  return { recordType: "BUSYBOOKIE_EDITORIAL_REVIEW", recordVersion: "1", subject: SUBJECT, proposalSha256,
    base: { revisionNumber: prop.base.revisionNumber, revisionSha256: prop.base.revisionSha256 }, outcome, reviewer, reason };
}
function review(p: Partition, proposalSha256: string, outcome: "APPROVED" | "REJECTED" = "APPROVED", reviewer: AnyRecord = HUMAN_B) {
  const out = ok(planEditorialReviewWrite({ listing: p.listing(), review: reviewRecord(p, proposalSha256, outcome, reviewer) }));
  if (out.action === "PUBLISH") p.commit(out.write);
  return out;
}
type ApplyOptions = { base?: EditorialMasteringSideEvidence; result?: EditorialResultMasteringEvidence; evidence?: typeof EVIDENCE };
function applyPlan(p: Partition, proposalSha256: string, o: ApplyOptions = {}) {
  return planEditorialProposalApplication({ listing: p.listing(), proposalSha256, evidence: o.evidence ?? EVIDENCE,
    ...(o.base === undefined ? {} : { baseMastering: o.base }), ...(o.result === undefined ? {} : { resultMastering: o.result }) });
}
function apply(p: Partition, proposalSha256: string, o: ApplyOptions = {}) {
  const out = ok(applyPlan(p, proposalSha256, o));
  if (out.action === "PUBLISH") p.commit(out.write);
  return out;
}
const reasonOf = (value: { ok: boolean }) => (value.ok ? "OK" : (value as AnyRecord).reason);
// Proposes, approves and applies in one step (result evidence optional).
function governed(p: Partition, replacements: AnyRecord, resultState: State, o: ApplyOptions = {}) {
  const sha = store(p, proposal(p, replacements, oracle(resultState, o.result)));
  review(p, sha);
  return { sha, out: apply(p, sha, o) };
}

// Base state for most cases: no E3/E4, NORMALIZE_STATIC mastering on the E2 route, established under OLD.
const E5_BASE = e5Doc(null, null);
const BASE_STATE: State = { editorialDecisions: null, audioMixDecisions: null, masteringDecisions: E5_BASE };
const BASE_OLD = sideEvidence(null, null, OLD);
function normalizedLineage(): Partition {
  const p = new Partition();
  genesis(p, BASE_STATE, BASE_OLD);
  return p;
}

describe("E6 genesis (category 10) and mastering evidence (categories 5, 20)", () => {
  it("genesis derives all six values, has null linkage and is idempotent; a different genesis conflicts", () => {
    const p = new Partition();
    const first = genesis(p, BASE_STATE, BASE_OLD);
    expect(first.action).toBe("PUBLISH");
    expect(first.revision).toMatchObject({ revisionNumber: 1, parentRevisionSha256: null, appliedProposalSha256: null, approvalReviewSha256: null,
      ...oracle(BASE_STATE, BASE_OLD) });
    expect(genesis(p, BASE_STATE, BASE_OLD).action).toBe("EXISTING");
    const other = planEditorialGenesis({ listing: p.listing(), subject: SUBJECT, decisionState: { ...BASE_STATE, masteringDecisions: null }, evidence: EVIDENCE });
    expect(reasonOf(other)).toBe("GENESIS_CONFLICT");
  });

  it("K MEASURE_ONLY carries preMasterEvidenceSha256 = null and masteringRenderKey = null; L NORMALIZE_STATIC requires evidence", () => {
    const p = new Partition();
    const measure = genesis(p, { ...BASE_STATE, masteringDecisions: e5Doc(null, null, "MEASURE_ONLY") });
    expect(measure.revision.preMasterEvidenceSha256).toBeNull();
    expect(measure.revision.masteringRenderKey).toBeNull();
    const missing = planEditorialGenesis({ listing: new Partition().listing(), subject: SUBJECT, decisionState: BASE_STATE, evidence: EVIDENCE });
    expect(reasonOf(missing)).toBe("RESULT_DERIVATION_FAILED");
    const normalized = genesis(new Partition(), BASE_STATE, BASE_OLD);
    expect(normalized.revision.preMasterEvidenceSha256).toBe(hashPreMasterLoudnessEvidenceV1(BASE_OLD.preMasterEvidence));
  });

  it("an equal-K substitute evidence object cannot replace the bound evidence (EXPECTED_RESULT_MISMATCH)", () => {
    const p = normalizedLineage();
    const target = e5Doc(null, null, "NORMALIZE_STATIC", policy({ integratedToleranceCentiLu: 150 }));
    const bound = sideEvidence(null, null, OLD);
    const sha = store(p, proposal(p, { masteringDecisions: target }, oracle({ ...BASE_STATE, masteringDecisions: target }, bound)));
    review(p, sha);
    const substitute = sideEvidence(null, null, OLD, "-23.45", "-13.00");
    expect(substitute.preMasterEvidence).not.toStrictEqual(bound.preMasterEvidence);
    expect(reasonOf(applyPlan(p, sha, { base: asBase(BASE_OLD), result: substitute }))).toBe("EXPECTED_RESULT_MISMATCH");
    expect(apply(p, sha, { base: asBase(BASE_OLD), result: bound }).action).toBe("PUBLISH");
  });

  it("policy-only proposals: target change is RENDER_EFFECTIVE, tolerance-only change RENDER_PRESERVING, gate failure fails closed", () => {
    const p = normalizedLineage();
    const tolerance = e5Doc(null, null, "NORMALIZE_STATIC", policy({ integratedToleranceCentiLu: 200 }));
    const t = governed(p, { masteringDecisions: tolerance }, { ...BASE_STATE, masteringDecisions: tolerance }, { base: asBase(BASE_OLD), result: BASE_OLD });
    expect(t.out.action === "PUBLISH" && t.out.changeClass).toBe("RENDER_PRESERVING");
    const target = e5Doc(null, null, "NORMALIZE_STATIC", policy({ integratedToleranceCentiLu: 200, targetIntegratedCentiLufs: -1400 }));
    const g = governed(p, { masteringDecisions: target }, { ...BASE_STATE, masteringDecisions: target }, { base: asBase(BASE_OLD), result: BASE_OLD });
    expect(g.out.action === "PUBLISH" && g.out.changeClass).toBe("RENDER_EFFECTIVE");
    // A policy whose gain gate rejects the measured loudness: E5 owns the gate; application fails closed.
    const strict = e5Doc(null, null, "NORMALIZE_STATIC", policy({ targetIntegratedCentiLufs: -1400, maximumGainCentiDb: 100 }));
    const expected = { ...oracle({ ...BASE_STATE, masteringDecisions: target }, BASE_OLD),
      decisionStateSha256: editorialSha256(canonicalEditorialJson({ ...BASE_STATE, masteringDecisions: strict })) };
    const sha = store(p, proposal(p, { masteringDecisions: strict }, expected));
    review(p, sha);
    expect(reasonOf(applyPlan(p, sha, { base: asBase(BASE_OLD), result: BASE_OLD }))).toBe("RESULT_DERIVATION_FAILED");
  });

  it("MEASURE_ONLY transitions and policy changes keep null evidence identity", () => {
    const p = normalizedLineage();
    const measure = e5Doc(null, null, "MEASURE_ONLY");
    const m = governed(p, { masteringDecisions: measure }, { ...BASE_STATE, masteringDecisions: measure }, { base: asBase(BASE_OLD) });
    expect(m.out.revision.preMasterEvidenceSha256).toBeNull();
    expect(m.out.action === "PUBLISH" && m.out.changeClass).toBe("RENDER_EFFECTIVE");
    const measure2 = e5Doc(null, null, "MEASURE_ONLY", null);
    const m2 = governed(p, { masteringDecisions: measure2 }, { ...BASE_STATE, masteringDecisions: measure2 });
    expect(m2.out.action === "PUBLISH" && m2.out.changeClass).toBe("RENDER_PRESERVING");
    // An identical MEASURE_ONLY document has no evidence-refresh exception.
    const sha = store(p, proposal(p, { masteringDecisions: measure2 }, oracle({ ...BASE_STATE, masteringDecisions: measure2 })));
    review(p, sha);
    expect(reasonOf(applyPlan(p, sha))).toBe("LAYER_NO_OP");
  });
});

describe("E6 historical base vs current result toolchain (Step 1103 sections 3-7)", () => {
  it("E5 itself refuses OLD evidence under the NEW key, which is why the base side must use its recorded key", () => {
    const derived = deriveAudioMasteringUpstream({ plan: v3Of(null, null), mediaRoot: MEDIA_ROOT });
    if (!derived.ok) throw new Error("fixture");
    const binding = checkPreMasterEvidenceBinding({ evidence: BASE_OLD.preMasterEvidence, derivation: derived.derivation,
      upstreamArgs: BASE_OLD.upstreamArgs as string[], toolchainEvidenceKey: NEW });
    expect(binding).toStrictEqual({ ok: false, reasons: ["REMEASURE_REQUIRED"] });
  });

  it("A parent established under OLD is proven under OLD while the new result uses NEW evidence", () => {
    const p = normalizedLineage();
    const target = e5Doc(null, null, "NORMALIZE_STATIC", policy({ targetIntegratedCentiLufs: -1500 }));
    const resultNew = sideEvidence(null, null, NEW);
    const g = governed(p, { masteringDecisions: target }, { ...BASE_STATE, masteringDecisions: target }, { base: asBase(BASE_OLD), result: resultNew });
    expect(g.out.revision.preMasterEvidenceSha256).toBe(hashPreMasterLoudnessEvidenceV1(resultNew.preMasterEvidence));
    // The next proposal proves revision 2 with its own (NEW) historical evidence.
    const measure = e5Doc(null, null, "MEASURE_ONLY");
    expect(governed(p, { masteringDecisions: measure }, { ...BASE_STATE, masteringDecisions: measure }, { base: asBase(resultNew) }).out.action).toBe("PUBLISH");
  });

  it("B/N valid evidence refresh after OLD -> NEW: identical E5 document, new evidence hash, not LAYER_NO_OP", () => {
    const p = normalizedLineage();
    const resultNew = sideEvidence(null, null, NEW);
    const g = governed(p, { masteringDecisions: E5_BASE }, BASE_STATE, { base: asBase(BASE_OLD), result: resultNew });
    expect(g.out.action === "PUBLISH" && g.out.changeClass).toBe("RENDER_PRESERVING");
    expect(g.out.revision.decisionStateSha256).toBe(head(p).revision.decisionStateSha256);
    // Refreshing again with the same evidence hash is redundant.
    const sha = store(p, proposal(p, { masteringDecisions: E5_BASE }, oracle(BASE_STATE, resultNew)));
    review(p, sha);
    expect(reasonOf(applyPlan(p, sha, { base: asBase(resultNew), result: resultNew }))).toBe("LAYER_NO_OP");
  });

  it("C result evidence measured under OLD but applied after the current authority became NEW fails; no remeasure", () => {
    const p = normalizedLineage();
    const target = e5Doc(null, null, "NORMALIZE_STATIC", policy({ targetIntegratedCentiLufs: -1500 }));
    const resultOld = sideEvidence(null, null, OLD);
    const sha = store(p, proposal(p, { masteringDecisions: target }, oracle({ ...BASE_STATE, masteringDecisions: target }, resultOld)));
    review(p, sha);
    const out = applyPlan(p, sha, { base: asBase(BASE_OLD), result: { ...resultOld, toolchainEvidenceKey: NEW } });
    expect(reasonOf(out)).toBe("RESULT_DERIVATION_FAILED");
    expect((out as AnyRecord).detail).toContain("REMEASURE_REQUIRED");
    expect(p.files.size).toBe(3);
  });

  it("a toolchain difference alone is never BASE_SOURCE_MISMATCH; missing or wrong base evidence is", () => {
    const p = normalizedLineage();
    const measure = e5Doc(null, null, "MEASURE_ONLY");
    const sha = store(p, proposal(p, { masteringDecisions: measure }, oracle({ ...BASE_STATE, masteringDecisions: measure })));
    review(p, sha);
    expect(reasonOf(applyPlan(p, sha))).toBe("BASE_SOURCE_MISMATCH");
    expect(reasonOf(applyPlan(p, sha, { base: asBase(sideEvidence(null, null, NEW)) }))).toBe("BASE_SOURCE_MISMATCH");
    expect(reasonOf(applyPlan(p, sha, { base: asBase(BASE_OLD) }))).toBe("OK");
  });
});

describe("E6 base source re-derivation (category 6)", () => {
  it("O source asset or manifest drift is BASE_SOURCE_MISMATCH and never enters as a proposal", () => {
    const p = new Partition();
    genesis(p, { editorialDecisions: null, audioMixDecisions: null, masteringDecisions: null });
    const e3 = e3Doc();
    const sha = store(p, proposal(p, { editorialDecisions: e3 }, oracle({ editorialDecisions: e3, audioMixDecisions: null, masteringDecisions: null })));
    review(p, sha);
    const drifted = { source: sourceFixture({ assetSha: SHA("e") }), externalAudioAssets: [] };
    expect(reasonOf(applyPlan(p, sha, { evidence: drifted }))).toBe("BASE_SOURCE_MISMATCH");
    const retitled = { source: sourceFixture({ title: "Renamed episode" }), externalAudioAssets: [] };
    expect(reasonOf(applyPlan(p, sha, { evidence: retitled }))).toBe("BASE_SOURCE_MISMATCH");
    expect(apply(p, sha).action).toBe("PUBLISH");
  });
});

describe("E6 cascade (category 4), layer operations (category 17) and change class (category 18)", () => {
  it("phase 1 CASCADE_INCOMPLETE uses only base presence and the tri-state", () => {
    const p = normalizedLineage();
    const e3 = e3Doc();
    const sha = store(p, proposal(p, { editorialDecisions: e3 }, oracle({ ...BASE_STATE, editorialDecisions: e3, masteringDecisions: null })));
    review(p, sha);
    expect(reasonOf(applyPlan(p, sha, { base: asBase(BASE_OLD) }))).toBe("CASCADE_INCOMPLETE");
    const e4 = e4Doc(null);
    const sha4 = store(p, proposal(p, { audioMixDecisions: e4 }, oracle({ ...BASE_STATE, audioMixDecisions: e4, masteringDecisions: null })));
    review(p, sha4);
    expect(reasonOf(applyPlan(p, sha4, { base: asBase(BASE_OLD) }))).toBe("CASCADE_INCOMPLETE");
  });

  // m1106-3: every phase-1 branch, each in a case where skipping phase 1 would surface later as CASCADE_BINDING_MISMATCH.
  function phase1(baseState: State, replacements: AnyRecord) {
    const p = new Partition();
    genesis(p, baseState);
    const sha = store(p, proposal(p, replacements, { ...oracle(baseState), decisionStateSha256: SHA("1") }));
    review(p, sha);
    const before = p.files.size;
    const out = applyPlan(p, sha);
    expect(p.files.size).toBe(before);
    return out as AnyRecord;
  }
  const E3 = e3Doc();
  const E4_ON_E3 = e4Doc(E3);
  const E4_ON_DEFAULT = e4Doc(null);

  it("phase 1 case 1: E3 acts, base E4 present, E4 OMITTED => CASCADE_INCOMPLETE (not a later binding mismatch)", () => {
    const out = phase1({ editorialDecisions: E3, audioMixDecisions: E4_ON_E3, masteringDecisions: null }, { editorialDecisions: e3Doc(12) });
    expect(out).toMatchObject({ ok: false, reason: "CASCADE_INCOMPLETE", detail: "E3 change requires an explicit E4 DOCUMENT or NULL" });
    const removal = phase1({ editorialDecisions: E3, audioMixDecisions: E4_ON_E3, masteringDecisions: null }, { editorialDecisions: null });
    expect(removal).toMatchObject({ ok: false, reason: "CASCADE_INCOMPLETE", detail: "E3 change requires an explicit E4 DOCUMENT or NULL" });
  });

  it("phase 1 case 2: base E5 present, E4 REPLACED, E5 OMITTED => CASCADE_INCOMPLETE", () => {
    const base: State = { editorialDecisions: null, audioMixDecisions: E4_ON_DEFAULT, masteringDecisions: e5Doc(null, E4_ON_DEFAULT, "MEASURE_ONLY") };
    expect(phase1(base, { audioMixDecisions: e4Doc(null, -900) }))
      .toMatchObject({ ok: false, reason: "CASCADE_INCOMPLETE", detail: "E4 change requires an explicit E5 DOCUMENT or NULL" });
  });

  it("phase 1 case 3: base E5 present, E4 removed by NULL, E5 OMITTED => CASCADE_INCOMPLETE", () => {
    const base: State = { editorialDecisions: null, audioMixDecisions: E4_ON_DEFAULT, masteringDecisions: e5Doc(null, E4_ON_DEFAULT, "MEASURE_ONLY") };
    expect(phase1(base, { audioMixDecisions: null }))
      .toMatchObject({ ok: false, reason: "CASCADE_INCOMPLETE", detail: "E4 change requires an explicit E5 DOCUMENT or NULL" });
  });

  it("phase 1 case 4: E3 acts with base E4 and E5 present, E4 rebound, E5 OMITTED => CASCADE_INCOMPLETE", () => {
    const base: State = { editorialDecisions: E3, audioMixDecisions: E4_ON_E3, masteringDecisions: e5Doc(E3, E4_ON_E3, "MEASURE_ONLY") };
    expect(phase1(base, { editorialDecisions: e3Doc(12), audioMixDecisions: e4Doc(e3Doc(12)) }))
      .toMatchObject({ ok: false, reason: "CASCADE_INCOMPLETE", detail: "E3 change requires an explicit E5 DOCUMENT or NULL" });
  });

  it("phase 2 rejects upper documents that do not bind the newly derived lower authority", () => {
    const p = normalizedLineage();
    const e3 = e3Doc();
    const stale = { editorialDecisions: e3, masteringDecisions: E5_BASE };
    const sha = store(p, proposal(p, stale, { ...oracle({ ...BASE_STATE, editorialDecisions: e3, masteringDecisions: null }), masteringRenderKey: SHA("1"), preMasterEvidenceSha256: SHA("2") }));
    review(p, sha);
    expect(reasonOf(applyPlan(p, sha, { base: asBase(BASE_OLD), result: BASE_OLD }))).toBe("CASCADE_BINDING_MISMATCH");
    const e4Wrong = e4Doc(e3Doc(12));
    const sha4 = store(p, proposal(p, { editorialDecisions: e3, audioMixDecisions: e4Wrong, masteringDecisions: null },
      oracle({ editorialDecisions: e3, audioMixDecisions: null, masteringDecisions: null })));
    review(p, sha4);
    expect(reasonOf(applyPlan(p, sha4, { base: asBase(BASE_OLD) }))).toBe("CASCADE_BINDING_MISMATCH");
  });

  it("E3 add with rebound E5, then E4 add with rebound E5, then removals: classes follow route and keys", () => {
    const p = normalizedLineage();
    const e3 = e3Doc();
    const e5e3 = e5Doc(e3, null);
    const r3 = sideEvidence(e3, null, NEW);
    const s3: State = { editorialDecisions: e3, audioMixDecisions: null, masteringDecisions: e5e3 };
    const a = governed(p, { editorialDecisions: e3, masteringDecisions: e5e3 }, s3, { base: asBase(BASE_OLD), result: r3 });
    expect(a.out.revision.upstreamRoute).toBe("E3_EDIT");
    expect(a.out.action === "PUBLISH" && a.out.changeClass).toBe("RENDER_EFFECTIVE");
    const e4 = e4Doc(e3);
    const e5e4 = e5Doc(e3, e4);
    const r4 = sideEvidence(e3, e4, NEW);
    const s4: State = { editorialDecisions: e3, audioMixDecisions: e4, masteringDecisions: e5e4 };
    const b = governed(p, { audioMixDecisions: e4, masteringDecisions: e5e4 }, s4, { base: asBase(r3), result: r4 });
    expect(b.out.revision.upstreamRoute).toBe("E4_MIX");
    // E5 removal from NORMALIZE_STATIC is RENDER_EFFECTIVE (masteringRenderKey -> null).
    const s5: State = { ...s4, masteringDecisions: null };
    const c = governed(p, { masteringDecisions: null }, s5, { base: asBase(r4) });
    expect(c.out.revision.masteringRenderKey).toBeNull();
    expect(c.out.action === "PUBLISH" && c.out.changeClass).toBe("RENDER_EFFECTIVE");
    // E4 removal falls back to the E3 route; E3 removal (NULL) returns to E2.
    const d = governed(p, { audioMixDecisions: null }, { ...s5, audioMixDecisions: null });
    expect(d.out.revision.upstreamRoute).toBe("E3_EDIT");
    const e = governed(p, { editorialDecisions: null }, { editorialDecisions: null, audioMixDecisions: null, masteringDecisions: null });
    expect(e.out.revision.upstreamRoute).toBe("E2_ROUGH_CUT");
  });

  it("M a mixed proposal with one real change and one redundant entry is LAYER_NO_OP", () => {
    const p = normalizedLineage();
    const target = e5Doc(null, null, "NORMALIZE_STATIC", policy({ integratedToleranceCentiLu: 200 }));
    const sha = store(p, proposal(p, { masteringDecisions: target, audioMixDecisions: null }, oracle({ ...BASE_STATE, masteringDecisions: target }, BASE_OLD)));
    review(p, sha);
    expect(reasonOf(applyPlan(p, sha, { base: asBase(BASE_OLD), result: BASE_OLD }))).toBe("LAYER_NO_OP");
  });

  it("change class uses the six-value set; metadata never matters", () => {
    const a = { decisionStateSha256: SHA("1"), planSha256: SHA("2"), upstreamRoute: "E2_ROUGH_CUT" as const, upstreamRenderKey: SHA("3"),
      masteringRenderKey: null, preMasterEvidenceSha256: null };
    expect(classifyEditorialChange(a, a)).toBe("NO_OP");
    expect(classifyEditorialChange(a, { ...a, planSha256: SHA("4") })).toBe("RENDER_PRESERVING");
    expect(classifyEditorialChange(a, { ...a, upstreamRoute: "E3_EDIT" })).toBe("RENDER_EFFECTIVE");
    expect(classifyEditorialChange(a, { ...a, masteringRenderKey: SHA("5"), preMasterEvidenceSha256: SHA("6") })).toBe("RENDER_EFFECTIVE");
  });

  it("expected-result mismatch on any of the six values fails closed", () => {
    const p = new Partition();
    genesis(p, { editorialDecisions: null, audioMixDecisions: null, masteringDecisions: null });
    const e3 = e3Doc();
    const sha = store(p, proposal(p, { editorialDecisions: e3 }, { ...oracle({ editorialDecisions: e3, audioMixDecisions: null, masteringDecisions: null }), planSha256: SHA("9") }));
    review(p, sha);
    expect(reasonOf(applyPlan(p, sha))).toBe("EXPECTED_RESULT_MISMATCH");
  });
});

describe("E6 reviews (categories 7, 8, 9)", () => {
  const empty: State = { editorialDecisions: null, audioMixDecisions: null, masteringDecisions: null };
  const s3: State = { editorialDecisions: e3Doc(), audioMixDecisions: null, masteringDecisions: null };
  function proposed() {
    const p = new Partition();
    genesis(p, empty);
    return { p, sha: store(p, proposal(p, { editorialDecisions: e3Doc() }, oracle(s3))) };
  }

  it("actor rules: HUMAN-only approval, MACHINE may reject, EXTERNAL_INTERCHANGE never reviews, no self-approval", () => {
    const { p, sha } = proposed();
    expect(reasonOf(planEditorialReviewWrite({ listing: p.listing(), review: reviewRecord(p, sha, "APPROVED", MACHINE) }))).toBe("ACTOR_RULE_VIOLATION");
    expect(reasonOf(planEditorialReviewWrite({ listing: p.listing(), review: reviewRecord(p, sha, "APPROVED", HUMAN_A) }))).toBe("ACTOR_RULE_VIOLATION");
    expect(reasonOf(planEditorialReviewWrite({ listing: p.listing(), review: reviewRecord(p, sha, "REJECTED",
      { kind: "EXTERNAL_INTERCHANGE", actorId: "otio:import", authentication: "DECLARED_UNVERIFIED" }) }))).toBe("ACTOR_RULE_VIOLATION");
    expect(reasonOf(planEditorialReviewWrite({ listing: p.listing(), review: { ...reviewRecord(p, sha), reviewer: { ...HUMAN_B, authentication: "VERIFIED" } } }))).toBe("INVALID_RECORD");
    expect(reasonOf(planEditorialReviewWrite({ listing: p.listing(), review: reviewRecord(p, sha, "REJECTED", MACHINE) }))).toBe("OK");
  });

  it("exact binding: wrong base or unknown proposal is refused", () => {
    const { p, sha } = proposed();
    const wrong = { ...reviewRecord(p, sha), base: { revisionNumber: 1, revisionSha256: SHA("0") } };
    expect(reasonOf(planEditorialReviewWrite({ listing: p.listing(), review: wrong }))).toBe("REVIEW_BINDING_MISMATCH");
    expect(reasonOf(planEditorialReviewWrite({ listing: p.listing(), review: { ...reviewRecord(p, sha), proposalSha256: SHA("7") } }))).toBe("PROPOSAL_MISSING");
  });

  it("D/E sequential identical retry is idempotent; a different second review is REVIEW_CONFLICT; REJECTED retry too", () => {
    const { p, sha } = proposed();
    expect(review(p, sha).action).toBe("PUBLISH");
    expect(review(p, sha).action).toBe("EXISTING");
    expect(reasonOf(planEditorialReviewWrite({ listing: p.listing(), review: reviewRecord(p, sha, "REJECTED", HUMAN_B) }))).toBe("REVIEW_CONFLICT");
    expect(reasonOf(planEditorialReviewWrite({ listing: p.listing(), review: reviewRecord(p, sha, "APPROVED", HUMAN_B, "Other words") }))).toBe("REVIEW_CONFLICT");
    const r = proposed();
    review(r.p, r.sha, "REJECTED");
    expect(review(r.p, r.sha, "REJECTED").action).toBe("EXISTING");
    expect(deriveEditorialProposalState(ok(validateEditorialSubjectPartition(r.p.listing())).history, r.sha)).toBe("REJECTED");
    expect(reasonOf(applyPlan(r.p, r.sha))).toBe("REVIEW_NOT_APPROVED");
  });

  it("F/G identical retry succeeds after STALE and APPLIED; a new review on a STALE proposal is REVIEW_NOT_PERMITTED", () => {
    const { p, sha } = proposed();
    const other = store(p, proposal(p, { editorialDecisions: e3Doc(12) }, oracle({ ...s3, editorialDecisions: e3Doc(12) })));
    review(p, sha);
    apply(p, sha);
    const history = ok(validateEditorialSubjectPartition(p.listing())).history;
    expect(deriveEditorialProposalState(history, sha)).toBe("APPLIED");
    expect(deriveEditorialProposalState(history, other)).toBe("STALE");
    expect(review(p, sha).action).toBe("EXISTING");
    expect(reasonOf(planEditorialReviewWrite({ listing: p.listing(), review: reviewRecord(p, other) }))).toBe("REVIEW_NOT_PERMITTED");
    const q = proposed();
    const late = store(q.p, proposal(q.p, { editorialDecisions: e3Doc(12) }, oracle({ ...s3, editorialDecisions: e3Doc(12) })));
    review(q.p, late);
    review(q.p, q.sha);
    apply(q.p, q.sha);
    expect(review(q.p, late).action).toBe("EXISTING");
  });

  it("an application without a review is REVIEW_MISSING", () => {
    const { p, sha } = proposed();
    expect(reasonOf(applyPlan(p, sha))).toBe("REVIEW_MISSING");
  });
});

describe("E6 stale base (category 13) and application idempotency (category 14)", () => {
  const empty: State = { editorialDecisions: null, audioMixDecisions: null, masteringDecisions: null };
  it("a proposal bound to N is STALE once N+1 exists, even if a later revision restores the same plan hash", () => {
    const p = new Partition();
    genesis(p, empty);
    const s3: State = { ...empty, editorialDecisions: e3Doc() };
    const first = store(p, proposal(p, { editorialDecisions: e3Doc() }, oracle(s3)));
    const second = store(p, proposal(p, { editorialDecisions: e3Doc(12) }, oracle({ ...empty, editorialDecisions: e3Doc(12) })));
    review(p, first);
    review(p, second);
    apply(p, first);
    expect(reasonOf(applyPlan(p, second))).toBe("STALE");
    governed(p, { editorialDecisions: null }, empty);
    expect(head(p).revision.planSha256).toBe(oracle(empty).planSha256);
    expect(reasonOf(applyPlan(p, second))).toBe("STALE");
  });

  it("re-applying an applied proposal returns the same revision; never a second one", () => {
    const p = new Partition();
    genesis(p, empty);
    const { sha, out } = governed(p, { editorialDecisions: e3Doc() }, { ...empty, editorialDecisions: e3Doc() });
    const again = ok(applyPlan(p, sha));
    expect(again.action).toBe("EXISTING");
    expect(again.revisionSha256).toBe(out.revisionSha256);
  });

  it("writes before genesis are NO_GENESIS", () => {
    const p = new Partition();
    expect(reasonOf(planEditorialProposalWrite({ listing: p.listing(), proposal: {} }))).toBe("NO_GENESIS");
  });
});
