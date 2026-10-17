import { describe, expect, it } from "vitest";
import { buildCompositionShotNormalizationPlan } from "../src/composition/buildCompositionShotNormalizationPlan.js";
import { buildEpisodeRoughCutFfmpegCommand } from "../src/composition/buildEpisodeRoughCutFfmpegCommand.js";
import type { PreparedEpisodeCompositionShot } from "../src/composition/prepareEpisodeComposition.js";
import { EpisodeManifestSchema } from "../src/schemas/episodeManifest.schema.js";
import {
  E5_REQUIRED_FILTERS, buildPreMasterLoudnessEvidence, hashPreMasterLoudnessEvidenceV1, toolchainEvidenceKey,
} from "../src/editorial/audioMasteringEvidence.schema.js";
import { buildAudioMasteringPlan } from "../src/editorial/buildAudioMasteringPlan.js";
import { planEditorialRenderV3 } from "../src/editorial/buildEditorialMixRenderPlan.js";
import { buildEditorialPlanV2 } from "../src/editorial/buildEditorialPlanV2.js";
import { buildEditorialPlanV3 } from "../src/editorial/buildEditorialPlanV3.js";
import { canonicalEditorialJson, editorialSha256 } from "../src/editorial/canonicalizeEditorialPlan.js";
import { hashEditorialPlanV2 } from "../src/editorial/canonicalizeEditorialPlanV2.js";
import { hashEditorialPlanV3 } from "../src/editorial/canonicalizeEditorialPlanV3.js";
import { deriveAudioMasteringUpstream } from "../src/editorial/deriveAudioMasteringUpstream.js";
import { deriveEditorialTimeline } from "../src/editorial/deriveEditorialTimeline.js";
import type { EditorialPlanSourceInput } from "../src/editorial/validateEditorialPlanAgainstSource.js";
import {
  planEditorialGenesis, planEditorialProposalApplication, planEditorialProposalWrite, planEditorialReviewWrite,
  type EditorialGovernanceWrite, type EditorialMasteringSideEvidence, type EditorialResultMasteringEvidence,
} from "../src/editorial/applyEditorialProposal.js";
import {
  validateEditorialSubjectPartition, type EditorialPartitionEntryV1, type EditorialPartitionListingV1,
} from "../src/editorial/deriveEditorialGovernanceState.js";
import { hashEditorialSubjectRefV1 } from "../src/editorial/editorialProposal.schema.js";
import { revisionResultAuthority } from "../src/editorial/editorialRevision.schema.js";
import * as derivationModule from "../src/editorial/deriveEditorialInterchangeTimeline.js";
import { deriveEditorialInterchangeTimeline } from "../src/editorial/deriveEditorialInterchangeTimeline.js";
import { hashInterchangeTimelineV1 } from "../src/editorial/editorialInterchangeTimeline.schema.js";
import { serializeEditorialInterchangeOtio } from "../src/editorial/serializeEditorialInterchangeOtio.js";

// Local, in-memory fixtures only (repeated per E7 test file; no shared helper path is authorized). The composition of
// E6 governance and the E7 pure core exists only in tests (no production API/CLI).
type AnyRecord = Record<string, any>;
const MEDIA_ROOT = "D:/Busybookie/Production";
const SHA = (c: string) => c.repeat(64);
const SUBJECT = { kind: "EPISODE", id: "busybookie:episode:EP02" };
const SUBJECT_SHA = hashEditorialSubjectRefV1(SUBJECT);
const HUMAN_A = { kind: "HUMAN", actorId: "human:editor-a", authentication: "DECLARED_UNVERIFIED" };
const HUMAN_B = { kind: "HUMAN", actorId: "human:editor-b", authentication: "DECLARED_UNVERIFIED" };

function sourceFixture(options: { assetSha?: string; title?: string } = {}): EditorialPlanSourceInput {
  const postProduction = { aspectRatio: "16:9" as const, width: 1920, height: 1080, timelineFps: 25, audioSampleRateHz: 48000 };
  const episode = EpisodeManifestSchema.parse({
    schemaVersion: "1.0", episodeId: "EP02", title: options.title ?? "Synthetic episode", slug: "synthetic-episode", status: "DRAFT",
    audience: { description: "Children", minAgeYears: 3, maxAgeYears: 6 }, learningGoals: ["Share"], emotionalTheme: "Kindness",
    targetDurationSeconds: 60, approvals: { script: "PENDING", storyboard: "PENDING", references: "PENDING", roughCut: "PENDING", finalQc: "PENDING" },
    scenes: [{ id: "SC01", title: "SC01", summary: "Synthetic scene", shots: [0, 1, 2].map((i) => ({
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
      sha256: options.assetSha ?? SHA("d"), bytes: 200, contentType: "video/mp4", durationSeconds: shot.durationSeconds, durationToleranceSeconds: 1 / 25 } };
  });
  return { episode, postProduction, mediaRoot: MEDIA_ROOT, preparedComposition: { episodeId: episode.episodeId, title: episode.title,
    totalShots: shots.length, totalDurationSeconds: 12, shots } };
}
const SOURCE = sourceFixture();
const audioAsset = (slug: string, dir: string, overrides: AnyRecord = {}): AnyRecord => ({ assetId: `audio:${slug}`, kind: "EXTERNAL_AUDIO",
  sha256: SHA("a"), bytes: 384_044, mediaRootRelativePath: `${dir}/${slug}.wav`, contentType: "audio/wav", codec: "pcm_s16le", sampleFormat: "s16",
  sampleRateHz: 48000, channelCount: 2, assetDurationSamples: 96_000, ...overrides });
const THEME = audioAsset("theme", "music");
const DOOR = audioAsset("door", "sfx", { sha256: SHA("b"), bytes: 60_044, channelCount: 1, assetDurationSamples: 30_000 });
const ASSETS = [THEME, DOOR];
const EVIDENCE = { source: SOURCE, externalAudioAssets: ASSETS };

function e3Doc(transitions: AnyRecord[], clips: AnyRecord[] = []): AnyRecord {
  const v2 = buildEditorialPlanV2(SOURCE, null);
  const referenced = new Set([...clips.map((c) => c.shotId), ...transitions.flatMap((t) => [t.outgoingShotId, t.incomingShotId])]);
  return { schemaVersion: "1.0", decisionsType: "BUSYBOOKIE_EDITORIAL_DECISIONS", episodeId: "EP02",
    sourceBinding: { manifestSha256: v2.episode.manifestSha256, shotAssets: v2.shots.filter((s) => referenced.has(s.shotId))
      .map((s) => ({ shotId: s.shotId, normalizedAssetSha256: v2.assets.find((a) => a.assetId === s.assetId)!.sha256 })) },
    clips, transitions };
}
const dissolve = (from: string, to: string, overlapFrames: number) => ({ outgoingShotId: from, incomingShotId: to, type: "CROSS_DISSOLVE", overlapFrames });
const cut = (from: string, to: string) => ({ outgoingShotId: from, incomingShotId: to, type: "CUT" });
const layer = (slug: string, assetSlug: string, overrides: AnyRecord = {}): AnyRecord => ({ layerId: `layer:${slug}`, role: "MUSIC",
  assetId: `audio:${assetSlug}`, sourceInSample: 0, sourceOutSample: 48_000, timelineStartSample: 0, gainCentiDb: 0, muted: false,
  fadeInSamples: 0, fadeOutSamples: 0, ...overrides });
function e4Doc(e3: unknown, layers: AnyRecord[], bed = { bedGainCentiDb: -600, bedMuted: false }): AnyRecord {
  const ids: string[] = [];
  for (const l of layers) if (!ids.includes(l.assetId)) ids.push(l.assetId);
  const binding = (id: string) => { const { kind: _k, mediaRootRelativePath: _p, ...rest } = ASSETS.find((a) => a.assetId === id)!; return rest; };
  return { schemaVersion: "1.0", decisionsType: "BUSYBOOKIE_AUDIO_MIX_DECISIONS",
    sourceBinding: { baseEditorialPlanSha256: hashEditorialPlanV2(buildEditorialPlanV2(SOURCE, e3)), externalAudioAssets: ids.map(binding) }, bed, layers };
}
const v3Of = (e3: unknown, e4: unknown) => buildEditorialPlanV3({ basePlan: buildEditorialPlanV2(SOURCE, e3), externalAudioAssets: ASSETS, audioMixDecisions: e4 });
const policy = (overrides: AnyRecord = {}): AnyRecord => ({ policyType: "BUSYBOOKIE_AUDIO_DELIVERY_POLICY", policyVersion: "1",
  policyId: "audio-delivery:test-episode", measurementEngine: "FFMPEG_LOUDNORM_INPUT_STATS_V1", targetIntegratedCentiLufs: -1600,
  integratedToleranceCentiLu: 100, truePeakCeilingCentiDbtp: -100, minimumGainCentiDb: -2000, maximumGainCentiDb: 1000, loudnessRangePolicy: "RECORD_ONLY",
  expectedAudio: { codecName: "aac", sampleRateHz: 48000, channels: 2, channelLayout: "stereo" }, ...overrides });
function e5Doc(e3: unknown, e4: unknown, mode: "MEASURE_ONLY" | "NORMALIZE_STATIC", deliveryPolicy: unknown = policy()): AnyRecord {
  const v3 = v3Of(e3, e4);
  const route = planEditorialRenderV3({ plan: v3, mediaRoot: MEDIA_ROOT });
  return { decisionsType: "BUSYBOOKIE_AUDIO_MASTERING_DECISIONS", schemaVersion: "1.0",
    sourceBinding: { editorialPlanSha256: hashEditorialPlanV3(v3), upstreamRoute: route.route, upstreamRenderKey: route.renderPlan.renderKey }, mode, deliveryPolicy };
}
const TOOLCHAIN_OLD: AnyRecord = { evidenceType: "BUSYBOOKIE_E5_TOOLCHAIN_EVIDENCE", evidenceVersion: "1",
  ffmpegVersionLine: "ffmpeg version 9.0.2 Copyright (c) 2000-2026 the FFmpeg developers", ffmpegSha256: SHA("f"),
  ffprobeVersionLine: "ffprobe version 9.0.2 Copyright (c) 2007-2026 the FFmpeg developers", ffprobeSha256: SHA("c"),
  requiredFilters: [...E5_REQUIRED_FILTERS], measurementEngine: "FFMPEG_LOUDNORM_INPUT_STATS_V1", invocationModel: "DIRECT_SPAWN_ARGV_NO_SHELL_V1" };
const OLD = toolchainEvidenceKey(TOOLCHAIN_OLD);
const NEW = toolchainEvidenceKey({ ...TOOLCHAIN_OLD, ffmpegVersionLine: "ffmpeg version 9.1.0 Copyright (c) 2000-2026 the FFmpeg developers", ffmpegSha256: SHA("a") });
function loudnormStderr(i = "-23.45", tp = "-12.10"): Uint8Array {
  return new TextEncoder().encode(["[Parsed_loudnorm_2 @ 0000020a5c8b1d40] ", "{", `\t"input_i" : "${i}",`, `\t"input_tp" : "${tp}",`,
    "\t\"input_lra\" : \"5.20\",", "\t\"input_thresh\" : \"-33.71\",", "\t\"output_i\" : \"-24.02\",", "\t\"output_tp\" : \"-5.92\",",
    "\t\"output_lra\" : \"4.30\",", "\t\"output_thresh\" : \"-34.20\",", "\t\"normalization_type\" : \"dynamic\",", "\t\"target_offset\" : \"0.02\"", "}", ""].join("\r\n"));
}
// Pre-master evidence for the E2 route (no E3/E4), measured under the given toolchain key (pure; no tool runs).
function roughCutEvidence(key: string, tp = "-12.10"): EditorialResultMasteringEvidence {
  const plan = v3Of(null, null);
  const derived = deriveAudioMasteringUpstream({ plan, mediaRoot: MEDIA_ROOT });
  if (!derived.ok) throw new Error("fixture not masterable");
  const route = planEditorialRenderV3({ plan, mediaRoot: MEDIA_ROOT });
  if (route.route !== "E2_ROUGH_CUT") throw new Error("fixture expects the E2 route");
  const upstreamArgs = [...buildEpisodeRoughCutFfmpegCommand({ ffmpegExecutable: "ffmpeg", plan: route.renderPlan, outputPath: route.renderPlan.outputPath }).args];
  const built = buildPreMasterLoudnessEvidence({ derivation: derived.derivation, upstreamArgs, toolchainEvidenceKey: key, stderr: loudnormStderr("-23.45", tp) });
  if (!built.ok) throw new Error("fixture evidence failed");
  return { preMasterEvidence: built.evidence, upstreamArgs, toolchainEvidenceKey: key };
}
const asBase = (side: EditorialResultMasteringEvidence): EditorialMasteringSideEvidence => {
  const { toolchainEvidenceKey: _key, ...rest } = side;
  return rest;
};
type State = { editorialDecisions: unknown; audioMixDecisions: unknown; masteringDecisions: unknown };
const EMPTY: State = { editorialDecisions: null, audioMixDecisions: null, masteringDecisions: null };
function oracle(state: State, mastering?: EditorialResultMasteringEvidence): AnyRecord {
  const v3 = v3Of(state.editorialDecisions, state.audioMixDecisions);
  const route = planEditorialRenderV3({ plan: v3, mediaRoot: MEDIA_ROOT });
  let masteringRenderKey: string | null = null;
  let preMasterEvidenceSha256: string | null = null;
  const m = state.masteringDecisions as AnyRecord | null;
  if (m !== null && m.mode === "NORMALIZE_STATIC") {
    const built = buildAudioMasteringPlan({ decisions: m, plan: v3, mediaRoot: MEDIA_ROOT, upstreamArgs: mastering!.upstreamArgs,
      toolchainEvidenceKey: mastering!.toolchainEvidenceKey, preMasterEvidence: mastering!.preMasterEvidence });
    if (!built.ok || built.masteringPlan.mode !== "NORMALIZE_STATIC") throw new Error("oracle mastering failed");
    masteringRenderKey = built.masteringPlan.renderKey;
    preMasterEvidenceSha256 = built.masteringPlan.preMasterEvidenceSha256;
  }
  return { decisionStateSha256: editorialSha256(canonicalEditorialJson(state)), planSha256: hashEditorialPlanV3(v3), upstreamRoute: route.route,
    upstreamRenderKey: route.renderPlan.renderKey, masteringRenderKey, preMasterEvidenceSha256 };
}

class Partition {
  files = new Map<string, Uint8Array>();
  listing(subjectSha256 = SUBJECT_SHA): EditorialPartitionListingV1 {
    const entries: EditorialPartitionEntryV1[] = [];
    for (const dir of new Set([...this.files.keys()].map((key) => key.split("/")[0]!))) entries.push({ directory: "", name: dir, type: "directory", bytes: null });
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
}
function ok<T extends { ok: boolean }>(value: T): Extract<T, { ok: true }> {
  if (!value.ok) throw new Error(`unexpected failure ${JSON.stringify(value)}`);
  return value as Extract<T, { ok: true }>;
}
function genesis(p: Partition, state: State, mastering?: EditorialResultMasteringEvidence) {
  const out = ok(planEditorialGenesis({ listing: p.listing(), subject: SUBJECT, decisionState: state, evidence: EVIDENCE, ...(mastering === undefined ? {} : { mastering }) }));
  if (out.action === "PUBLISH") p.commit(out.write);
  return out;
}
function head(p: Partition) {
  const v = validateEditorialSubjectPartition(p.listing());
  if (!v.ok) throw new Error(v.detail);
  return v.history.revisions.at(-1)!;
}
function propose(p: Partition, replacements: AnyRecord, expectedResult: AnyRecord): string {
  const h = head(p);
  const record = { recordType: "BUSYBOOKIE_EDITORIAL_PROPOSAL", recordVersion: "1", subject: SUBJECT,
    base: { revisionNumber: h.revision.revisionNumber, revisionSha256: h.revisionSha256, planSha256: h.revision.planSha256 },
    proposer: HUMAN_A, rationale: "Editorial change", replacements, expectedResult };
  const out = ok(planEditorialProposalWrite({ listing: p.listing(), proposal: record }));
  if (out.action === "PUBLISH") p.commit(out.write);
  return out.proposalSha256;
}
function approve(p: Partition, proposalSha256: string): void {
  const prop = ok(validateEditorialSubjectPartition(p.listing())).history.proposals.get(proposalSha256)!.proposal;
  const review = { recordType: "BUSYBOOKIE_EDITORIAL_REVIEW", recordVersion: "1", subject: SUBJECT, proposalSha256,
    base: { revisionNumber: prop.base.revisionNumber, revisionSha256: prop.base.revisionSha256 }, outcome: "APPROVED", reviewer: HUMAN_B, reason: "Looks right" };
  const out = ok(planEditorialReviewWrite({ listing: p.listing(), review }));
  if (out.action === "PUBLISH") p.commit(out.write);
}
function governed(p: Partition, replacements: AnyRecord, resultState: State, o: { base?: EditorialMasteringSideEvidence; result?: EditorialResultMasteringEvidence } = {}) {
  const sha = propose(p, replacements, oracle(resultState, o.result));
  approve(p, sha);
  const out = ok(planEditorialProposalApplication({ listing: p.listing(), proposalSha256: sha, evidence: EVIDENCE,
    ...(o.base === undefined ? {} : { baseMastering: o.base }), ...(o.result === undefined ? {} : { resultMastering: o.result }) }));
  if (out.action === "PUBLISH") p.commit(out.write);
  return sha;
}
function request(p: Partition, overrides: AnyRecord = {}): AnyRecord {
  const h = head(p);
  return { listing: p.listing(), subject: SUBJECT, expectedHead: { revisionNumber: h.revision.revisionNumber, revisionSha256: h.revisionSha256 },
    source: EVIDENCE, ...overrides };
}
const reasonOf = (value: { ok: boolean }) => (value.ok ? "OK" : (value as AnyRecord).reason);
const derive = (p: Partition, overrides: AnyRecord = {}) => deriveEditorialInterchangeTimeline(request(p, overrides));
const timelineOf = (p: Partition, overrides: AnyRecord = {}) => ok(derive(p, overrides)).timeline as AnyRecord;

// MAIN authority: S01 [0,100) -D5-> S02 [3,98) -CUT-> S03 [0,100); four external layers on two lanes; MEASURE_ONLY.
//   S1 = 0, S2 = 100 - 5 = 95, S3 = 95 + 95 = 190, duration 290. T=5: in 2 / out 3, cut 97.
const MAIN_E3 = e3Doc([dissolve("S01", "S02", 5), cut("S02", "S03")], [{ shotId: "S02", sourceInFrame: 3, sourceOutFrame: 98 }]);
const MAIN_LAYERS = [
  layer("theme", "theme", { sourceOutSample: 96_000, gainCentiDb: -300, fadeInSamples: 4_800 }),
  layer("door", "door", { role: "SFX", sourceOutSample: 30_000, timelineStartSample: 50_000 }),
  layer("theme-tail", "theme", { sourceInSample: 10_000, sourceOutSample: 58_001, timelineStartSample: 96_000, fadeOutSamples: 2 }),
  layer("room", "door", { role: "AMBIENCE", sourceInSample: 1, sourceOutSample: 20_000, timelineStartSample: 200_003, gainCentiDb: -9_600, muted: true,
    fadeInSamples: 2, fadeOutSamples: 100 }),
];
const MAIN_E4 = e4Doc(MAIN_E3, MAIN_LAYERS);
const MAIN_E5 = e5Doc(MAIN_E3, MAIN_E4, "MEASURE_ONLY");
const MAIN_STATE: State = { editorialDecisions: MAIN_E3, audioMixDecisions: MAIN_E4, masteringDecisions: MAIN_E5 };
function approvedLineage(): Partition {
  const p = new Partition();
  genesis(p, EMPTY);
  governed(p, { editorialDecisions: MAIN_E3, audioMixDecisions: MAIN_E4, masteringDecisions: MAIN_E5 }, MAIN_STATE);
  return p;
}
function genesisLineage(state: State = MAIN_STATE, mastering?: EditorialResultMasteringEvidence): Partition {
  const p = new Partition();
  genesis(p, state, mastering);
  return p;
}
const NORMALIZE_E5 = e5Doc(null, null, "NORMALIZE_STATIC");
const NORMALIZE_STATE: State = { editorialDecisions: null, audioMixDecisions: null, masteringDecisions: NORMALIZE_E5 };
const EVIDENCE_OLD = roughCutEvidence(OLD);
const dissolveLineage = (t: number) => genesisLineage({ editorialDecisions: e3Doc([dissolve("S01", "S02", t)]), audioMixDecisions: null, masteringDecisions: null });

describe("canonical authority eligibility, ordered E1-E6 (category 1)", () => {
  it("non-object requests and malformed request fields are INVALID_INTERCHANGE_INPUT", () => {
    const p = approvedLineage();
    expect(reasonOf(deriveEditorialInterchangeTimeline(null))).toBe("INVALID_INTERCHANGE_INPUT");
    expect(reasonOf(deriveEditorialInterchangeTimeline("x"))).toBe("INVALID_INTERCHANGE_INPUT");
    expect(reasonOf(derive(p, { listing: { entries: [] } }))).toBe("INVALID_INTERCHANGE_INPUT");
    expect(reasonOf(derive(p, { expectedHead: { revisionNumber: 2 } }))).toBe("INVALID_INTERCHANGE_INPUT");
    expect(reasonOf(derive(p, { expectedHead: { revisionNumber: 2.5, revisionSha256: SHA("a") } }))).toBe("INVALID_INTERCHANGE_INPUT");
    expect(reasonOf(derive(p, { source: { source: SOURCE } }))).toBe("INVALID_INTERCHANGE_INPUT");
  });

  it("E1 a corrupt E6 history is HISTORY_INVALID carrying the E6 reason, before any subject check", () => {
    const p = approvedLineage();
    const torn = new Partition();
    torn.files = new Map(p.files);
    const key = [...torn.files.keys()].find((k) => k.startsWith("revisions/"))!;
    torn.files.set(key, torn.files.get(key)!.slice(0, 30));
    const out = derive(p, { listing: torn.listing(), subject: { kind: "EPISODE", id: "busybookie:episode:EP09" } }) as AnyRecord;
    expect(out).toMatchObject({ ok: false, reason: "HISTORY_INVALID" });
    expect(out.detail).toContain("RECORD_CORRUPT");
  });

  it("E2 a subject that does not hash to the partition is INVALID_INTERCHANGE_INPUT", () => {
    const p = approvedLineage();
    expect(reasonOf(derive(p, { subject: { kind: "EPISODE", id: "busybookie:episode:EP09" } }))).toBe("INVALID_INTERCHANGE_INPUT");
    expect(reasonOf(derive(p, { subject: { kind: "EPISODE" } }))).toBe("INVALID_INTERCHANGE_INPUT");
  });

  it("E3 an empty valid history has no authoritative head: UNAPPROVED_HEAD (before expectedHead freshness)", () => {
    const empty = new Partition();
    expect(validateEditorialSubjectPartition(empty.listing()).ok).toBe(true);
    const out = deriveEditorialInterchangeTimeline({ listing: empty.listing(), subject: SUBJECT,
      expectedHead: { revisionNumber: 1, revisionSha256: SHA("1") }, source: EVIDENCE });
    expect(reasonOf(out)).toBe("UNAPPROVED_HEAD");
  });

  it("E4 precedes E5: a stale expectedHead with drifted source is STALE_AUTHORITY, not PROVENANCE_MISMATCH", () => {
    const p = approvedLineage();
    const drifted = { source: sourceFixture({ assetSha: SHA("e") }), externalAudioAssets: ASSETS };
    expect(reasonOf(derive(p, { source: drifted }))).toBe("PROVENANCE_MISMATCH");
    expect(reasonOf(derive(p, { source: drifted, expectedHead: { revisionNumber: 1, revisionSha256: SHA("1") } }))).toBe("STALE_AUTHORITY");
  });

  it("E6 the timeline is derived only after E5 succeeds and is fully validated", () => {
    const p = approvedLineage();
    const out = ok(derive(p));
    expect(out.interchangeTimelineSha256).toBe(hashInterchangeTimelineV1(out.timeline));
    expect(Object.isFrozen(out.timeline)).toBe(true);
  });
});

describe("approved-head-only export (category 2)", () => {
  it("a HUMAN-approved head exports as HUMAN_APPROVED with its proposal and review linkage", () => {
    const p = approvedLineage();
    const h = head(p);
    const t = timelineOf(p);
    expect(t.provenance).toMatchObject({ revisionNumber: 2, approval: "HUMAN_APPROVED", appliedProposalSha256: h.revision.appliedProposalSha256,
      approvalReviewSha256: h.revision.approvalReviewSha256 });
    expect(t.provenance.appliedProposalSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(t.provenance.approvalReviewSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("a genesis head exports as GENESIS_DECLARED with null linkage (n1118-1)", () => {
    const t = timelineOf(genesisLineage());
    expect(t.provenance).toMatchObject({ revisionNumber: 1, approval: "GENESIS_DECLARED", appliedProposalSha256: null, approvalReviewSha256: null });
  });

  it("a non-head revision is never exported (STALE_AUTHORITY); there is no retarget to the head", () => {
    const p = approvedLineage();
    const revisions = ok(validateEditorialSubjectPartition(p.listing())).history.revisions;
    const first = revisions[0]!;
    expect(reasonOf(derive(p, { expectedHead: { revisionNumber: 1, revisionSha256: first.revisionSha256 } }))).toBe("STALE_AUTHORITY");
    expect(reasonOf(derive(p, { expectedHead: { revisionNumber: 2, revisionSha256: first.revisionSha256 } }))).toBe("STALE_AUTHORITY");
    expect(reasonOf(derive(p, { expectedHead: { revisionNumber: 3, revisionSha256: revisions[1]!.revisionSha256 } }))).toBe("STALE_AUTHORITY");
  });

  it("pending (proposed or approved-but-unapplied) changes never reach the export", () => {
    const p = genesisLineage();
    const before = timelineOf(p);
    const pending = { ...MAIN_STATE, audioMixDecisions: e4Doc(MAIN_E3, MAIN_LAYERS, { bedGainCentiDb: -900, bedMuted: false }) };
    const sha = propose(p, { audioMixDecisions: pending.audioMixDecisions, masteringDecisions: e5Doc(MAIN_E3, pending.audioMixDecisions, "MEASURE_ONLY") },
      oracle({ ...pending, masteringDecisions: e5Doc(MAIN_E3, pending.audioMixDecisions, "MEASURE_ONLY") }));
    expect(timelineOf(p)).toStrictEqual(before);
    approve(p, sha);
    expect(timelineOf(p)).toStrictEqual(before);
    expect(timelineOf(p).shotAudio.bed.bedGainCentiDb).toBe(-600);
  });

  it("the module exposes only the head export entry point (no draft/preview API)", () => {
    expect(Object.keys(derivationModule).sort()).toStrictEqual(["deriveEditorialInterchangeTimeline"]);
  });
});

describe("stale/source drift refusal and E6 parity (category 3)", () => {
  it("normalized asset, manifest and external asset drift are PROVENANCE_MISMATCH", () => {
    const p = approvedLineage();
    expect(reasonOf(derive(p, { source: { source: sourceFixture({ assetSha: SHA("e") }), externalAudioAssets: ASSETS } }))).toBe("PROVENANCE_MISMATCH");
    expect(reasonOf(derive(p, { source: { source: sourceFixture({ title: "Renamed" }), externalAudioAssets: ASSETS } }))).toBe("PROVENANCE_MISMATCH");
    expect(reasonOf(derive(p, { source: { source: SOURCE, externalAudioAssets: [THEME, { ...DOOR, bytes: 60_046 }] } }))).toBe("PROVENANCE_MISMATCH");
    expect(reasonOf(derive(p, { source: { source: SOURCE, externalAudioAssets: [THEME] } }))).toBe("PROVENANCE_MISMATCH");
  });

  it("NORMALIZE_STATIC: correct head evidence exports; missing, malformed or hash-mismatched evidence is PROVENANCE_MISMATCH", () => {
    const p = genesisLineage(NORMALIZE_STATE, EVIDENCE_OLD);
    const good = timelineOf(p, { headMastering: asBase(EVIDENCE_OLD) });
    expect(good.provenance.preMasterEvidenceSha256).toBe(hashPreMasterLoudnessEvidenceV1(EVIDENCE_OLD.preMasterEvidence));
    expect(good.mastering).toMatchObject({ mode: "NORMALIZE_STATIC", masteringRenderKey: good.provenance.masteringRenderKey });
    expect(reasonOf(derive(p))).toBe("PROVENANCE_MISMATCH");
    expect(reasonOf(derive(p, { headMastering: { preMasterEvidence: {}, upstreamArgs: [] } }))).toBe("PROVENANCE_MISMATCH");
    expect(reasonOf(derive(p, { headMastering: null }))).toBe("PROVENANCE_MISMATCH");
    expect(reasonOf(derive(p, { headMastering: asBase(roughCutEvidence(OLD, "-13.00")) }))).toBe("PROVENANCE_MISMATCH");
    expect(reasonOf(derive(p, { headMastering: { ...asBase(EVIDENCE_OLD), upstreamArgs: ["-y"] } }))).toBe("PROVENANCE_MISMATCH");
  });

  it("the head's historical evidence is validated under its own recorded key; a toolchain change alone is not drift", () => {
    const p = genesisLineage(NORMALIZE_STATE, EVIDENCE_OLD);
    expect(reasonOf(derive(p, { headMastering: asBase(EVIDENCE_OLD) }))).toBe("OK");
    // Evidence measured under the NEW toolchain is a different object and does not hash to the bound evidence.
    expect(reasonOf(derive(p, { headMastering: asBase(roughCutEvidence(NEW)) }))).toBe("PROVENANCE_MISMATCH");
    // A head established under NEW evidence exports with that evidence.
    const q = genesisLineage(NORMALIZE_STATE, roughCutEvidence(NEW));
    expect(reasonOf(derive(q, { headMastering: asBase(roughCutEvidence(NEW)) }))).toBe("OK");
  });

  it("n1121-4 headMastering for a non-NORMALIZE_STATIC head is INVALID_INTERCHANGE_INPUT, checked before E5 but after E4", () => {
    const p = approvedLineage();
    const drifted = { source: sourceFixture({ assetSha: SHA("e") }), externalAudioAssets: ASSETS };
    expect(reasonOf(derive(p, { headMastering: asBase(EVIDENCE_OLD) }))).toBe("INVALID_INTERCHANGE_INPUT");
    expect(reasonOf(derive(p, { headMastering: asBase(EVIDENCE_OLD), source: drifted }))).toBe("INVALID_INTERCHANGE_INPUT");
    expect(reasonOf(derive(p, { headMastering: asBase(EVIDENCE_OLD), expectedHead: { revisionNumber: 1, revisionSha256: SHA("1") } }))).toBe("STALE_AUTHORITY");
    expect(reasonOf(derive(dissolveLineage(4), { headMastering: asBase(EVIDENCE_OLD) }))).toBe("INVALID_INTERCHANGE_INPUT");
    expect(reasonOf(derive(p, { headMastering: undefined }))).toBe("OK");
  });

  it("m1118-1 parity: an E6-applied head re-derived by E7 reproduces the six values; drifted source fails in both", () => {
    const p = approvedLineage();
    const h = head(p);
    const t = timelineOf(p);
    const pv = t.provenance;
    expect({ decisionStateSha256: pv.decisionStateSha256, planSha256: pv.planSha256, upstreamRoute: pv.upstreamRoute, upstreamRenderKey: pv.upstreamRenderKey,
      masteringRenderKey: pv.masteringRenderKey, preMasterEvidenceSha256: pv.preMasterEvidenceSha256 }).toStrictEqual({ ...revisionResultAuthority(h.revision) });
    expect(revisionResultAuthority(h.revision)).toStrictEqual(oracle(MAIN_STATE));
    // E6 BASE-side derivation on the same drifted source fails exactly where E7 fails.
    const next = { ...MAIN_STATE, audioMixDecisions: e4Doc(MAIN_E3, MAIN_LAYERS, { bedGainCentiDb: -900, bedMuted: false }) };
    next.masteringDecisions = e5Doc(MAIN_E3, next.audioMixDecisions, "MEASURE_ONLY");
    const sha = propose(p, { audioMixDecisions: next.audioMixDecisions, masteringDecisions: next.masteringDecisions }, oracle(next));
    approve(p, sha);
    const drifted = { source: sourceFixture({ assetSha: SHA("e") }), externalAudioAssets: ASSETS };
    expect(reasonOf(planEditorialProposalApplication({ listing: p.listing(), proposalSha256: sha, evidence: drifted }))).toBe("BASE_SOURCE_MISMATCH");
    expect(reasonOf(derive(p, { source: drifted }))).toBe("PROVENANCE_MISMATCH");
    expect(reasonOf(planEditorialProposalApplication({ listing: p.listing(), proposalSha256: sha, evidence: EVIDENCE }))).toBe("OK");
    expect(reasonOf(derive(p))).toBe("OK");
  });

  it("E7 never writes into E6: export leaves the partition bytes untouched, and OTIO bytes are never valid E6 records (AC7-01)", () => {
    const p = approvedLineage();
    const before = new Map([...p.files].map(([k, v]) => [k, [...v]]));
    const t = ok(derive(p)).timeline;
    expect(new Map([...p.files].map(([k, v]) => [k, [...v]]))).toStrictEqual(before);
    const bytes = ok(serializeEditorialInterchangeOtio({ timeline: t })).bytes;
    const injected = new Partition();
    injected.files = new Map(p.files);
    injected.files.set("revisions/0000000000000003.json", bytes);
    const v = validateEditorialSubjectPartition(injected.listing());
    expect(v.ok).toBe(false);
    expect(reasonOf(derive(p, { listing: injected.listing() }))).toBe("HISTORY_INVALID");
  });
});

describe("deterministic timeline derivation: golden MAIN timeline (categories 4, 7, 9, 12, 13)", () => {
  const P = approvedLineage();
  const T = timelineOf(P);
  const shot = (id: string) => ({ assetId: `normalized:EP02:${id}`, assetSha256: SHA("d") });

  it("repeat derivations are structurally identical with identical hashes", () => {
    const again = ok(derive(P));
    expect(again.timeline).toStrictEqual(T);
    expect(again.interchangeTimelineSha256).toBe(ok(derive(P)).interchangeTimelineSha256);
    expect(again.interchangeTimelineSha256).toBe(editorialSha256(canonicalEditorialJson(T)));
  });

  it("golden video geometry: odd T=5 (in 2 / out 3) then CUT; nominal formulas and duration 290", () => {
    expect(T.timelineDurationFrames).toBe(290);
    expect(T.video.clips.map((c: AnyRecord) => [c.clipId, c.selectedSourceInFrame, c.selectedSourceOutFrame, c.timelineStartFrame,
      c.nominalSourceInFrame, c.nominalSourceOutFrame, c.nominalTimelineStartFrame])).toStrictEqual([
      ["V1-S01", 0, 100, 0, 0, 97, 0], ["V1-S02", 3, 98, 95, 5, 98, 97], ["V1-S03", 0, 100, 190, 0, 100, 190]]);
    expect(T.video.clips[0]).toMatchObject({ ...shot("S01"), shotId: "S01", sceneId: "SC01", assetDurationFrames: 100 });
    expect(T.video.clips[0].mediaRootRelativePath).toMatch(/^cache\/composition-normalized\/EP02\/S01\/EP02_S01_[a-f0-9]{64}\.mp4$/);
    expect(T.video.transitions).toStrictEqual([{ transitionId: "transition:V1-S01>V1-S02", type: "CROSS_DISSOLVE", outgoingClipId: "V1-S01",
      incomingClipId: "V1-S02", overlapFrames: 5, cutFrame: 97, inOffsetFrames: 2, outOffsetFrames: 3, blendProfile: "busybookie-edit-v1-j-over-t" }]);
  });

  it("CUT edges emit no transition and clips abut (category 7)", () => {
    expect(T.video.transitions.some((t: AnyRecord) => t.incomingClipId === "V1-S03")).toBe(false);
    const [, s2, s3] = T.video.clips;
    expect(s3.timelineStartFrame).toBe(s2.timelineStartFrame + (s2.selectedSourceOutFrame - s2.selectedSourceInFrame));
    expect(s3.nominalTimelineStartFrame).toBe(s2.nominalTimelineStartFrame + (s2.nominalSourceOutFrame - s2.nominalSourceInFrame));
  });

  it("visible ranges reconstruct the selected source exactly and nominal durations sum to the timeline (categories 12, 13)", () => {
    const edges = T.video.transitions as AnyRecord[];
    let sum = 0;
    for (const c of T.video.clips as AnyRecord[]) {
      const incoming = edges.find((e) => e.incomingClipId === c.clipId);
      const outgoing = edges.find((e) => e.outgoingClipId === c.clipId);
      expect(c.nominalSourceInFrame - (incoming?.inOffsetFrames ?? 0)).toBe(c.selectedSourceInFrame);
      expect(c.nominalSourceOutFrame + (outgoing?.outOffsetFrames ?? 0)).toBe(c.selectedSourceOutFrame);
      sum += c.nominalSourceOutFrame - c.nominalSourceInFrame;
    }
    expect(sum).toBe(T.timelineDurationFrames);
  });

  it("golden shot audio equals the E3 deriveEditorialTimeline audio ranges x 1920 (category 14)", () => {
    const e3 = deriveEditorialTimeline([{ assetDurationFrames: 100, sourceInFrame: 0, sourceOutFrame: 100 }, { assetDurationFrames: 100, sourceInFrame: 3, sourceOutFrame: 98 },
      { assetDurationFrames: 100, sourceInFrame: 0, sourceOutFrame: 100 }], [{ type: "CROSS_DISSOLVE", overlapFrames: 5 }, { type: "CUT" }]);
    expect(T.shotAudio.clips.map((c: AnyRecord) => [c.sourceInSample, c.sourceOutSample, c.timelineStartSample]))
      .toStrictEqual(e3.audio.map((a) => [a.sourceInFrame * 1920, a.sourceOutFrame * 1920, a.timelineStartFrame * 1920]));
    expect(T.shotAudio.clips.map((c: AnyRecord) => [c.sourceInSample, c.sourceOutSample, c.timelineStartSample]))
      .toStrictEqual([[0, 186_240, 0], [9_600, 188_160, 186_240], [0, 192_000, 364_800]]);
    expect(T.shotAudio.clips.map((c: AnyRecord) => [c.clipId, c.linkedClipId, c.audioMode, c.dialoguePlanKey, c.audioKey, c.assetDurationSamples]))
      .toStrictEqual([["A1-S01", "V1-S01", "SYNTHETIC_SILENCE", null, null, 192_000], ["A1-S02", "V1-S02", "SYNTHETIC_SILENCE", null, null, 192_000],
        ["A1-S03", "V1-S03", "SYNTHETIC_SILENCE", null, null, 192_000]]);
    // Dialogue is not split into a separate track: exactly one shot-audio clip per shot.
    expect(T.shotAudio.clips).toHaveLength(T.video.clips.length);
    // The dissolve cut equals the A1 hard cut.
    expect(T.shotAudio.clips[1].timelineStartSample).toBe(T.video.transitions[0].cutFrame * 1920);
  });

  it("golden external lanes: greedy assignment, muted layer included, exact 48 kHz values (categories 15, 16, 18)", () => {
    expect(T.externalAudio.lanes.map((l: AnyRecord) => [l.laneIndex, l.trackId, l.placements.map((p: AnyRecord) => p.layerId)]))
      .toStrictEqual([[0, "AX0", ["layer:theme", "layer:theme-tail", "layer:room"]], [1, "AX1", ["layer:door"]]]);
    const [theme, tail, room] = T.externalAudio.lanes[0].placements;
    expect(theme).toStrictEqual({ layerId: "layer:theme", role: "MUSIC", assetId: "audio:theme", assetSha256: SHA("a"), mediaRootRelativePath: "music/theme.wav",
      assetDurationSamples: 96_000, channelCount: 2, sourceInSample: 0, sourceOutSample: 96_000, timelineStartSample: 0, timelineEndSample: 96_000,
      gainCentiDb: -300, muted: false, fadeInSamples: 4_800, fadeOutSamples: 0 });
    expect(tail).toMatchObject({ sourceInSample: 10_000, sourceOutSample: 58_001, timelineStartSample: 96_000, timelineEndSample: 144_001, fadeOutSamples: 2 });
    expect(room).toStrictEqual({ layerId: "layer:room", role: "AMBIENCE", assetId: "audio:door", assetSha256: SHA("b"), mediaRootRelativePath: "sfx/door.wav",
      assetDurationSamples: 30_000, channelCount: 1, sourceInSample: 1, sourceOutSample: 20_000, timelineStartSample: 200_003, timelineEndSample: 220_002,
      gainCentiDb: -9_600, muted: true, fadeInSamples: 2, fadeOutSamples: 100 });
    expect(T.externalAudio.lanes[1].placements[0]).toMatchObject({ role: "SFX", timelineStartSample: 50_000, timelineEndSample: 80_000, channelCount: 1 });
    expect(T.shotAudio.bed).toStrictEqual({ bedGainCentiDb: -600, bedMuted: false });
  });

  it("lanes are independent of E4 layer declaration order", () => {
    const reordered = [MAIN_LAYERS[1]!, MAIN_LAYERS[3]!, MAIN_LAYERS[0]!, MAIN_LAYERS[2]!];
    const e4 = e4Doc(MAIN_E3, reordered);
    const t = timelineOf(genesisLineage({ editorialDecisions: MAIN_E3, audioMixDecisions: e4, masteringDecisions: e5Doc(MAIN_E3, e4, "MEASURE_ONLY") }));
    expect(t.externalAudio).toStrictEqual(T.externalAudio);
  });
});

describe("provenance binding (category 5) and stable ids (category 6)", () => {
  const P = approvedLineage();
  const T = timelineOf(P);
  const H = head(P);

  it("provenance carries every section 5 field, equal to the head and the derived plan", () => {
    expect(Object.keys(T.provenance).sort()).toStrictEqual(["appliedProposalSha256", "approval", "approvalReviewSha256", "audioMixDecisionsSha256",
      "decisionStateSha256", "editorialDecisionsSha256", "manifestSha256", "masteringRenderKey", "planSha256", "preMasterEvidenceSha256", "revisionNumber",
      "revisionSha256", "subjectSha256", "upstreamRenderKey", "upstreamRoute"]);
    const v3 = v3Of(MAIN_E3, MAIN_E4);
    expect(T.provenance).toStrictEqual({ subjectSha256: SUBJECT_SHA, revisionNumber: 2, revisionSha256: H.revisionSha256, approval: "HUMAN_APPROVED",
      appliedProposalSha256: H.revision.appliedProposalSha256, approvalReviewSha256: H.revision.approvalReviewSha256, ...revisionResultAuthority(H.revision),
      editorialDecisionsSha256: v3.basePlan.editorialDecisionsSha256, audioMixDecisionsSha256: v3.audioMixDecisionsSha256, manifestSha256: v3.basePlan.episode.manifestSha256 });
    expect(T.provenance.upstreamRoute).toBe("E4_MIX");
    expect(T.provenance.editorialDecisionsSha256).toBe(editorialSha256(canonicalEditorialJson(MAIN_E3)));
    expect(T.episode).toStrictEqual({ episodeId: "EP02", manifestSha256: T.provenance.manifestSha256 });
  });

  it("mastering block is metadata only: decisions hash, policy identity, null render identity for MEASURE_ONLY (AC7-19)", () => {
    expect(T.mastering).toStrictEqual({ mode: "MEASURE_ONLY", masteringDecisionsSha256: editorialSha256(canonicalEditorialJson(MAIN_E5)),
      policyId: "audio-delivery:test-episode", policySha256: editorialSha256(canonicalEditorialJson(policy())), masteringRenderKey: null, preMasterEvidenceSha256: null });
    expect(timelineOf(dissolveLineage(4)).mastering).toBeNull();
    expect(timelineOf(dissolveLineage(4)).provenance).toMatchObject({ editorialDecisionsSha256: expect.stringMatching(/^[a-f0-9]{64}$/), audioMixDecisionsSha256: null });
  });

  it("free text (titles, provider execution ids, absolute paths) never enters the timeline", () => {
    const text = canonicalEditorialJson(T);
    for (const forbidden of ["Synthetic episode", "Shot 1", "task-0", "D:/", "generated", "Busybookie/Production"]) expect(text, forbidden).not.toContain(forbidden);
  });

  it("ids follow the section 6 grammars, are unique and carry no path or random component", () => {
    expect(T.timelineId).toBe(`busybookie-timeline:${H.revisionSha256}`);
    const ids = [T.video.trackId, T.shotAudio.trackId, ...T.externalAudio.lanes.map((l: AnyRecord) => l.trackId),
      ...T.video.clips.map((c: AnyRecord) => c.clipId), ...T.shotAudio.clips.map((c: AnyRecord) => c.clipId),
      ...T.video.transitions.map((t: AnyRecord) => t.transitionId), ...T.externalAudio.lanes.flatMap((l: AnyRecord) => l.placements.map((p: AnyRecord) => p.layerId))];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^(V1|A1|AX(0|[1-9][0-9]*)|V1-S[0-9]{2,3}[A-Z]?|A1-S[0-9]{2,3}[A-Z]?|layer:[a-z0-9-]+|transition:V1-S[0-9]{2,3}[A-Z]?>V1-S[0-9]{2,3}[A-Z]?)$/);
      expect(id).not.toMatch(/[/\\]/);
    }
    // Same authority in a different lineage position gives a different timelineId, never a random one.
    expect(timelineOf(genesisLineage()).timelineId).not.toBe(T.timelineId);
    expect(timelineOf(genesisLineage()).timelineId).toBe(timelineOf(genesisLineage()).timelineId);
  });
});

describe("dissolve mapping through the derivation (categories 8, 9, 10, 11)", () => {
  const geometry = (t: number) => {
    const tl = timelineOf(dissolveLineage(t));
    const [c1, c2] = tl.video.clips as [AnyRecord, AnyRecord];
    return { tl, c1, c2, tr: tl.video.transitions[0] as AnyRecord };
  };

  it("even T=6: in 3 / out 3; window [S2, S2+T); cut = A1 cut", () => {
    const { tl, c1, c2, tr } = geometry(6);
    expect([tr.inOffsetFrames, tr.outOffsetFrames, tr.overlapFrames]).toStrictEqual([3, 3, 6]);
    expect(c2.timelineStartFrame).toBe(94);
    expect(tr.cutFrame).toBe(97);
    expect([tr.cutFrame - tr.inOffsetFrames, tr.cutFrame + tr.outOffsetFrames]).toStrictEqual([c2.timelineStartFrame, c2.timelineStartFrame + 6]);
    expect([c1.nominalSourceOutFrame, c2.nominalSourceInFrame]).toStrictEqual([97, 3]);
    expect(tl.shotAudio.clips[1].timelineStartSample).toBe(tr.cutFrame * 1920);
  });

  it("odd T=5 and T=3: out_offset owns the extra frame (previous clip extended by out_offset)", () => {
    for (const [t, inOffset, outOffset] of [[5, 2, 3], [3, 1, 2]] as const) {
      const { c1, c2, tr } = geometry(t);
      expect([tr.inOffsetFrames, tr.outOffsetFrames], String(t)).toStrictEqual([inOffset, outOffset]);
      expect(c1.selectedSourceOutFrame - c1.nominalSourceOutFrame).toBe(outOffset);
      expect(c2.nominalSourceInFrame - c2.selectedSourceInFrame).toBe(inOffset);
    }
  });

  it("T=1: in 0 / out 1; incoming nominal starts at its selected in-frame", () => {
    const { c1, c2, tr } = geometry(1);
    expect([tr.inOffsetFrames, tr.outOffsetFrames, tr.cutFrame]).toStrictEqual([0, 1, c2.timelineStartFrame]);
    expect([c1.nominalSourceOutFrame, c2.nominalSourceInFrame, c2.nominalTimelineStartFrame]).toStrictEqual([99, 0, 99]);
  });

  it("normative T=1..5 table end to end, with window and A1 cut per T", () => {
    const rows = [1, 2, 3, 4, 5].map((t) => {
      const { tl, c2, tr } = geometry(t);
      expect(tl.shotAudio.clips[1].timelineStartSample).toBe(tr.cutFrame * 1920);
      expect(tl.timelineDurationFrames).toBe(300 - t);
      return [t, tr.inOffsetFrames, tr.outOffsetFrames, tr.cutFrame - c2.timelineStartFrame];
    });
    expect(rows).toStrictEqual([[1, 0, 1, 0], [2, 1, 1, 1], [3, 1, 2, 1], [4, 2, 2, 2], [5, 2, 3, 2]]);
  });

  it("maximum legal handles (E3 L + R <= D - 1) still leave every nominal duration >= 1 frame", () => {
    const e3 = e3Doc([dissolve("S01", "S02", 4), dissolve("S02", "S03", 5)], [{ shotId: "S02", sourceInFrame: 40, sourceOutFrame: 50 }]);
    const tl = timelineOf(genesisLineage({ editorialDecisions: e3, audioMixDecisions: null, masteringDecisions: null }));
    const s2 = tl.video.clips[1];
    expect([s2.nominalSourceInFrame, s2.nominalSourceOutFrame]).toStrictEqual([42, 47]);
    expect(tl.video.transitions.map((t: AnyRecord) => [t.inOffsetFrames, t.outOffsetFrames])).toStrictEqual([[2, 2], [2, 3]]);
    expect(tl.video.clips.reduce((n: number, c: AnyRecord) => n + c.nominalSourceOutFrame - c.nominalSourceInFrame, 0)).toBe(tl.timelineDurationFrames);
  });
});
