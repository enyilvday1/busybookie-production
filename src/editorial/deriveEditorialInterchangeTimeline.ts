import { checkMasteringDecisionsAgainstSource } from "./audioMasteringDecisions.schema.js";
import { hashPreMasterLoudnessEvidenceV1, parsePreMasterLoudnessEvidenceV1 } from "./audioMasteringEvidence.schema.js";
import type { EditorialMasteringSideEvidence, EditorialSourceEvidence } from "./applyEditorialProposal.js";
import { buildAudioMasteringPlan } from "./buildAudioMasteringPlan.js";
import { planEditorialRenderV3 } from "./buildEditorialMixRenderPlan.js";
import { buildEditorialPlanV2 } from "./buildEditorialPlanV2.js";
import { buildEditorialPlanV3 } from "./buildEditorialPlanV3.js";
import { canonicalEditorialJson } from "./canonicalizeEditorialPlan.js";
import { hashEditorialPlanV2 } from "./canonicalizeEditorialPlanV2.js";
import { hashEditorialPlanV3 } from "./canonicalizeEditorialPlanV3.js";
import {
  editorialHistoryHead, validateEditorialSubjectPartition, type EditorialGovernanceHistory, type EditorialPartitionListingV1,
} from "./deriveEditorialGovernanceState.js";
import {
  dissolveInOffset, dissolveOutOffset, E7_BLEND_PROFILE, E7_INTERCHANGE_TIMELINE_VERSION, E7_SAMPLES_PER_FRAME, E7_TIMELINE_ID_PREFIX,
  E7InterchangeRefusal, assignInterchangeAudioLanes, hashInterchangeTimelineV1, interchangeFailure, interchangeLaneTrackId,
  interchangeTransitionId, refuse, requireInterchange, validateInterchangeTimelineV1, type E7InterchangeFailure, type InterchangeTimelineV1,
} from "./editorialInterchangeTimeline.schema.js";
import type { EditorialPlanV3 } from "./editorialPlanV3.schema.js";
import { EditorialSubjectRefV1Schema, hashEditorialSubjectRefV1 } from "./editorialProposal.schema.js";
import {
  hashEditorialDecisionStateV1, premasterEvidenceApplicable, revisionResultAuthority, type EditorialRevisionV1,
} from "./editorialRevision.schema.js";
import { freezeEditorial } from "./validateEditorialPlan.js";

// E7 export request (pure input; the caller reads governance bytes and supplies current source authority).
export type EditorialInterchangeRequest = Readonly<{
  listing: EditorialPartitionListingV1;
  subject: unknown;
  expectedHead: Readonly<{ revisionNumber: number; revisionSha256: string }>;
  source: EditorialSourceEvidence;
  // Required iff the head's mastering is NORMALIZE_STATIC; supplying it for any other head is INVALID_INTERCHANGE_INPUT.
  headMastering?: EditorialMasteringSideEvidence;
}>;

export type EditorialInterchangeDerivation =
  | Readonly<{ ok: true; timeline: InterchangeTimelineV1; interchangeTimelineSha256: string }>
  | E7InterchangeFailure;

const SHA = /^[a-f0-9]{64}$/;
const message = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const same = (left: unknown, right: unknown): boolean => canonicalEditorialJson(left) === canonicalEditorialJson(right);

// ---------------------------------------------------------------- E5 head re-derivation (m1118-1 parity contract)
// The exact BASE-side sequence of E6 deriveEditorialAuthority (applyEditorialProposal.ts, private): same public E2-E5
// builders, same order, same binding checks, historical evidence hashed against the head and validated under the
// toolchainEvidenceKey recorded in that evidence (never the current key). Any failure is PROVENANCE_MISMATCH.
type HeadDerivation = Readonly<{
  v3: EditorialPlanV3; masteringDecisionsSha256: string | null; policyId: string | null; policySha256: string | null;
}>;

function deriveHeadAuthority(head: EditorialRevisionV1, evidence: EditorialSourceEvidence, side: unknown): HeadDerivation {
  const state = head.decisionState;
  const mismatch = (detail: string): never => refuse("PROVENANCE_MISMATCH", detail);
  const mediaRoot = evidence.source.mediaRoot;
  let v2;
  try {
    v2 = buildEditorialPlanV2(evidence.source, state.editorialDecisions);
  } catch (cause) {
    return mismatch(`E3/V2 derivation failed: ${message(cause)}`);
  }
  if (state.audioMixDecisions !== null && state.audioMixDecisions.sourceBinding.baseEditorialPlanSha256 !== hashEditorialPlanV2(v2)) {
    return mismatch("AudioMixDecisions do not bind the derived EditorialPlan 2.0");
  }
  let v3;
  let route;
  try {
    v3 = buildEditorialPlanV3({ basePlan: v2, externalAudioAssets: evidence.externalAudioAssets, audioMixDecisions: state.audioMixDecisions });
    route = planEditorialRenderV3({ plan: v3, mediaRoot });
  } catch (cause) {
    return mismatch(`E4/V3 derivation failed: ${message(cause)}`);
  }
  const planSha256 = hashEditorialPlanV3(v3);
  const upstreamRoute = route.route;
  const upstreamRenderKey = route.renderPlan.renderKey;
  let masteringRenderKey: string | null = null;
  let preMasterEvidenceSha256: string | null = null;
  let masteringDecisionsSha256: string | null = null;
  let policySha256: string | null = null;
  const decisions = state.masteringDecisions;
  if (decisions !== null) {
    const binding = decisions.sourceBinding;
    if (binding.editorialPlanSha256 !== planSha256 || binding.upstreamRoute !== upstreamRoute || binding.upstreamRenderKey !== upstreamRenderKey) {
      return mismatch("MasteringDecisions do not bind the derived EditorialPlan 3.0 route/renderKey");
    }
    let checked;
    try {
      checked = checkMasteringDecisionsAgainstSource({ decisions, plan: v3, mediaRoot });
    } catch (cause) {
      return mismatch(`E5 decisions rejected: ${message(cause)}`);
    }
    if (!checked.ok) return mismatch(`E5 decisions rejected: ${checked.reasons.join(",")}`);
    masteringDecisionsSha256 = checked.decisionsSha256;
    policySha256 = checked.policySha256;
    if (decisions.mode === "NORMALIZE_STATIC") {
      if (side === undefined) return mismatch("NORMALIZE_STATIC requires pre-master loudness evidence");
      try {
        const evidenceSide = side as EditorialMasteringSideEvidence;
        const parsed = parsePreMasterLoudnessEvidenceV1(evidenceSide.preMasterEvidence);
        if (hashPreMasterLoudnessEvidenceV1(parsed) !== head.preMasterEvidenceSha256) {
          return mismatch("supplied pre-master evidence does not hash to the bound preMasterEvidenceSha256");
        }
        // BASE side: the historical key recorded in that exact evidence; a toolchain change alone is not drift.
        const built = buildAudioMasteringPlan({
          decisions, plan: v3, mediaRoot, upstreamArgs: evidenceSide.upstreamArgs, toolchainEvidenceKey: parsed.toolchainEvidenceKey,
          preMasterEvidence: evidenceSide.preMasterEvidence,
          ...(evidenceSide.e3Preflight === undefined ? {} : { e3Preflight: evidenceSide.e3Preflight }),
          ...(evidenceSide.e4Receipt === undefined ? {} : { e4Receipt: evidenceSide.e4Receipt }),
        });
        if (!built.ok) return mismatch(`E5 mastering derivation rejected: ${built.reasons.join(",")}`);
        if (built.masteringPlan.mode !== "NORMALIZE_STATIC") return mismatch("E5 returned a non-NORMALIZE_STATIC plan");
        masteringRenderKey = built.masteringPlan.renderKey;
        preMasterEvidenceSha256 = built.masteringPlan.preMasterEvidenceSha256;
      } catch (cause) {
        if (cause instanceof E7InterchangeRefusal) throw cause;
        return mismatch(`pre-master evidence is invalid or E5 mastering derivation failed: ${message(cause)}`);
      }
    }
  }
  const authority = { decisionStateSha256: hashEditorialDecisionStateV1(state), planSha256, upstreamRoute, upstreamRenderKey,
    masteringRenderKey, preMasterEvidenceSha256 };
  if (head.decisionStateSha256 !== authority.decisionStateSha256) return mismatch("head decisionStateSha256 does not hash its decision state");
  if (!same(authority, revisionResultAuthority(head))) return mismatch("current source no longer reproduces the head six-value result");
  return { v3, masteringDecisionsSha256, policyId: decisions?.deliveryPolicy?.policyId ?? null, policySha256 };
}

// ---------------------------------------------------------------- InterchangeTimelineV1 construction (Step 1118 sections 4-11)
function buildInterchangeTimeline(history: EditorialGovernanceHistory, derived: HeadDerivation): InterchangeTimelineV1 {
  const stored = editorialHistoryHead(history)!;
  const head = stored.revision;
  const plan = derived.v3.basePlan;
  const [videoTrack, audioTrack] = plan.tracks;
  requireInterchange(plan.tracks.length === 2 && videoTrack.kind === "VIDEO" && audioTrack.kind === "SHOT_AUDIO",
    "UNSUPPORTED_EDITORIAL_SEMANTIC", "derived plan carries a track without a v1 classification");
  const clips = videoTrack.clips;
  const assetOf = (assetId: string) => {
    const asset = plan.assets.find((candidate) => candidate.assetId === assetId);
    requireInterchange(asset !== undefined, "UNSUPPORTED_EDITORIAL_SEMANTIC", `plan clip references unknown asset ${assetId}`);
    return asset;
  };
  // Transition mapping: exactly one edge per adjacent pair in order; CUT emits nothing; any other type fails closed.
  requireInterchange(plan.transitions.length === clips.length - 1, "TRANSITION_MAPPING_INVALID", "plan requires one edge per adjacent clip pair");
  const overlaps = plan.transitions.map((edge, index) => {
    requireInterchange(edge.outgoingClipId === clips[index]!.clipId && edge.incomingClipId === clips[index + 1]!.clipId,
      "TRANSITION_MAPPING_INVALID", `edge ${index + 1} does not join manifest-adjacent clips`);
    const type = (edge as { type: string }).type;
    if (type === "CUT") return 0;
    requireInterchange(type === "CROSS_DISSOLVE", "TRANSITION_MAPPING_INVALID", `edge ${index + 1} type ${type} has no v1 mapping`);
    return (edge as { overlapFrames: number }).overlapFrames;
  });
  // Handle validation before any serialization (OTIO does not validate handles).
  const video = clips.map((clip, k) => {
    const asset = assetOf(clip.assetId);
    const selected = clip.sourceOutFrame - clip.sourceInFrame;
    const a = k > 0 ? dissolveInOffset(overlaps[k - 1]!) : 0;
    const b = k < clips.length - 1 ? dissolveOutOffset(overlaps[k]!) : 0;
    requireInterchange(a >= 0 && b >= 0 && selected - a - b >= 1 && clip.sourceInFrame >= 0 && clip.sourceOutFrame <= asset.assetDurationFrames,
      "TRANSITION_HANDLE_INVALID", `${clip.clipId} lacks handles for its transitions (D=${selected}, in=${a}, out=${b})`);
    if (k > 0) {
      const previous = clips[k - 1]!;
      requireInterchange(clip.timelineStartFrame === previous.timelineStartFrame + (previous.sourceOutFrame - previous.sourceInFrame) - overlaps[k - 1]!,
        "TRANSITION_MAPPING_INVALID", `${clip.clipId} start is not S(k-1) + D(k-1) - T(k-1)`);
    }
    const shot = plan.shots.find((candidate) => candidate.shotId === clip.shotId);
    requireInterchange(shot !== undefined, "UNSUPPORTED_EDITORIAL_SEMANTIC", `${clip.clipId} has no manifest shot`);
    return {
      clipId: clip.clipId, shotId: clip.shotId, sceneId: shot.sceneId, assetId: asset.assetId, assetSha256: asset.sha256,
      mediaRootRelativePath: asset.mediaRootRelativePath, assetDurationFrames: asset.assetDurationFrames,
      selectedSourceInFrame: clip.sourceInFrame, selectedSourceOutFrame: clip.sourceOutFrame, timelineStartFrame: clip.timelineStartFrame,
      nominalSourceInFrame: clip.sourceInFrame + a, nominalSourceOutFrame: clip.sourceOutFrame - b, nominalTimelineStartFrame: clip.timelineStartFrame + a,
    };
  });
  const transitions = overlaps.flatMap((overlap, index) => {
    if (overlap === 0) return [];
    const outgoing = video[index]!;
    const incoming = video[index + 1]!;
    return [{
      transitionId: interchangeTransitionId(outgoing.clipId, incoming.clipId), type: "CROSS_DISSOLVE", outgoingClipId: outgoing.clipId,
      incomingClipId: incoming.clipId, overlapFrames: overlap, cutFrame: incoming.timelineStartFrame + dissolveInOffset(overlap),
      inOffsetFrames: dissolveInOffset(overlap), outOffsetFrames: dissolveOutOffset(overlap), blendProfile: E7_BLEND_PROFILE,
    }];
  });
  // Shot audio straight from the E3 derivation (frames x 1920); the validator proves it equals video nominal x 1920.
  const shotAudio = audioTrack.clips.map((clip) => {
    const asset = assetOf(clip.assetId);
    const audio = clip.audio as { mode: string; dialoguePlanKey?: string; audioKey?: string };
    const dialogue = audio.mode === "REPLACE_SOURCE_WITH_DIALOGUE";
    return {
      clipId: clip.clipId, linkedClipId: clip.linkedClipId, assetId: asset.assetId, assetSha256: asset.sha256,
      mediaRootRelativePath: asset.mediaRootRelativePath, assetDurationSamples: asset.assetDurationFrames * E7_SAMPLES_PER_FRAME,
      audioMode: audio.mode, dialoguePlanKey: dialogue ? audio.dialoguePlanKey ?? null : null, audioKey: dialogue ? audio.audioKey ?? null : null,
      sourceInSample: clip.sourceInFrame * E7_SAMPLES_PER_FRAME, sourceOutSample: clip.sourceOutFrame * E7_SAMPLES_PER_FRAME,
      timelineStartSample: clip.timelineStartFrame * E7_SAMPLES_PER_FRAME,
    };
  });
  // External audio: every E4 layer (muted included) at exact 48 kHz samples, lanes by the frozen greedy algorithm.
  const mix = derived.v3.audioMix;
  const placements = mix.layers.map((layer) => {
    const asset = mix.externalAudioAssets.find((candidate) => candidate.assetId === layer.assetId);
    requireInterchange(asset !== undefined, "AUDIO_RANGE_INVALID", `${layer.layerId} references an unadmitted asset`);
    return {
      layerId: layer.layerId, role: layer.role, assetId: asset.assetId, assetSha256: asset.sha256, mediaRootRelativePath: asset.mediaRootRelativePath,
      assetDurationSamples: asset.assetDurationSamples, channelCount: asset.channelCount, sourceInSample: layer.sourceInSample,
      sourceOutSample: layer.sourceOutSample, timelineStartSample: layer.timelineStartSample,
      timelineEndSample: layer.timelineStartSample + layer.sourceOutSample - layer.sourceInSample, gainCentiDb: layer.gainCentiDb,
      muted: layer.muted, fadeInSamples: layer.fadeInSamples, fadeOutSamples: layer.fadeOutSamples,
    };
  });
  const laneOf = assignInterchangeAudioLanes(placements.map((p) => ({ layerId: p.layerId, startSample: p.timelineStartSample, endSample: p.timelineEndSample })));
  const laneCount = laneOf.reduce((max, lane) => Math.max(max, lane + 1), 0);
  const lanes = Array.from({ length: laneCount }, (_, laneIndex) => ({
    laneIndex, trackId: interchangeLaneTrackId(laneIndex),
    placements: placements.filter((_, i) => laneOf[i] === laneIndex)
      .sort((left, right) => left.timelineStartSample - right.timelineStartSample),
  }));
  const masteringDecisions = head.decisionState.masteringDecisions;
  const genesis = head.revisionNumber === 1;
  return {
    interchangeTimelineVersion: E7_INTERCHANGE_TIMELINE_VERSION,
    timelineId: `${E7_TIMELINE_ID_PREFIX}${stored.revisionSha256}`,
    episode: { episodeId: plan.episode.episodeId, manifestSha256: plan.episode.manifestSha256 },
    provenance: {
      subjectSha256: history.subjectSha256, revisionNumber: head.revisionNumber, revisionSha256: stored.revisionSha256,
      approval: genesis ? "GENESIS_DECLARED" : "HUMAN_APPROVED", appliedProposalSha256: head.appliedProposalSha256,
      approvalReviewSha256: head.approvalReviewSha256, decisionStateSha256: head.decisionStateSha256, planSha256: head.planSha256,
      upstreamRoute: head.upstreamRoute, upstreamRenderKey: head.upstreamRenderKey, masteringRenderKey: head.masteringRenderKey,
      preMasterEvidenceSha256: head.preMasterEvidenceSha256, editorialDecisionsSha256: plan.editorialDecisionsSha256,
      audioMixDecisionsSha256: derived.v3.audioMixDecisionsSha256, manifestSha256: plan.episode.manifestSha256,
    },
    rates: { videoFrameRate: { numerator: 25, denominator: 1 }, audioSampleRateHz: 48_000, samplesPerFrame: E7_SAMPLES_PER_FRAME },
    timelineDurationFrames: plan.timelineDurationFrames,
    video: { trackId: "V1", clips: video, transitions },
    shotAudio: { trackId: "A1", bed: { bedGainCentiDb: mix.bed.bedGainCentiDb, bedMuted: mix.bed.bedMuted }, clips: shotAudio },
    externalAudio: { lanes },
    mastering: masteringDecisions === null ? null : {
      mode: masteringDecisions.mode, masteringDecisionsSha256: derived.masteringDecisionsSha256!, policyId: derived.policyId,
      policySha256: derived.policySha256, masteringRenderKey: head.masteringRenderKey, preMasterEvidenceSha256: head.preMasterEvidenceSha256,
    },
  } as InterchangeTimelineV1;
}

// ---------------------------------------------------------------- public pure entry point
// Ordered checks (first failure wins): request shape, E1 history, E2 subject, E3 head, E4 expectedHead, extraneous
// headMastering, E5 re-derivation, E6 timeline derivation + full validation.
export function deriveEditorialInterchangeTimeline(request: unknown): EditorialInterchangeDerivation {
  try {
    requireInterchange(isObject(request), "INVALID_INTERCHANGE_INPUT", "request must be an object");
    const { listing, subject, expectedHead, source } = request;
    requireInterchange(isObject(listing) && typeof listing.subjectSha256 === "string" && Array.isArray(listing.entries) &&
      listing.entries.every(isObject), "INVALID_INTERCHANGE_INPUT", "listing must carry subjectSha256 and an entries array");
    requireInterchange(isObject(expectedHead) && typeof expectedHead.revisionNumber === "number" && Number.isSafeInteger(expectedHead.revisionNumber) &&
      expectedHead.revisionNumber >= 1 && typeof expectedHead.revisionSha256 === "string" && SHA.test(expectedHead.revisionSha256),
    "INVALID_INTERCHANGE_INPUT", "expectedHead must be {revisionNumber >= 1, revisionSha256}");
    requireInterchange(isObject(source) && isObject(source.source) && Array.isArray(source.externalAudioAssets), "INVALID_INTERCHANGE_INPUT",
      "source evidence must carry source and externalAudioAssets");
    const supplied = Object.hasOwn(request, "headMastering") && request.headMastering !== undefined;
    // E1: complete E6 partition validation with the E6 function itself (no weaker reader, no prefix fallback).
    let validation;
    try {
      validation = validateEditorialSubjectPartition(listing as unknown as EditorialPartitionListingV1);
    } catch (cause) {
      return interchangeFailure("HISTORY_INVALID", `E6 partition validation failed: ${message(cause)}`);
    }
    if (!validation.ok) return interchangeFailure("HISTORY_INVALID", `${validation.primaryReason}: ${validation.detail}`);
    const history = validation.history;
    // E2: subject identity.
    const parsedSubject = EditorialSubjectRefV1Schema.safeParse(subject);
    requireInterchange(parsedSubject.success && hashEditorialSubjectRefV1(parsedSubject.data) === listing.subjectSha256, "INVALID_INTERCHANGE_INPUT",
      "subject is malformed or does not hash to the partition");
    // E3: an authoritative head exists.
    const stored = editorialHistoryHead(history);
    requireInterchange(stored !== null, "UNAPPROVED_HEAD", "the subject has no authoritative head revision");
    // Defensive E6 R4 restatement: a non-genesis head is backed by a stored APPROVED review from a declared HUMAN.
    if (stored.revision.revisionNumber > 1) {
      const review = history.reviews.get(stored.revision.appliedProposalSha256!);
      requireInterchange(review !== undefined && review.review.outcome === "APPROVED" && review.review.reviewer.kind === "HUMAN" &&
        review.reviewSha256 === stored.revision.approvalReviewSha256, "HISTORY_INVALID", "head is not backed by a HUMAN APPROVED review");
    }
    // E4: freshness; no export of non-head revisions, no rebase/retarget.
    requireInterchange(expectedHead.revisionNumber === stored.revision.revisionNumber && expectedHead.revisionSha256 === stored.revisionSha256,
      "STALE_AUTHORITY", `expectedHead is not the current head (revision ${stored.revision.revisionNumber})`);
    // "required iff NORMALIZE_STATIC": extraneous side evidence is a request-shape error, checked before any E5 comparison.
    requireInterchange(!supplied || premasterEvidenceApplicable(stored.revision.decisionState), "INVALID_INTERCHANGE_INPUT",
      "headMastering is supplied for a head whose mastering is not NORMALIZE_STATIC");
    // E5: re-derive and compare; E6: derive and fully validate.
    const derived = deriveHeadAuthority(stored.revision, source as unknown as EditorialSourceEvidence, supplied ? request.headMastering : undefined);
    const timeline = validateInterchangeTimelineV1(buildInterchangeTimeline(history, derived));
    return freezeEditorial({ ok: true, timeline, interchangeTimelineSha256: hashInterchangeTimelineV1(timeline) });
  } catch (cause) {
    if (cause instanceof E7InterchangeRefusal) return interchangeFailure(cause.reason, cause.detail);
    throw cause;
  }
}
