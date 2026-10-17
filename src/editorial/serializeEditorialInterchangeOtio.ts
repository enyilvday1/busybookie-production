import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import {
  E7_AUDIO_RATE, E7_IDENTITY_TYPE, E7_IDENTITY_VERSION, E7_INTERCHANGE_TIMELINE_VERSION, E7_MEDIA_REFERENCE_MODE, E7_METADATA_NAMESPACE,
  E7_METADATA_VERSION, E7_OTIO_PROFILE, E7_OTIO_SCHEMAS, E7_OUTPUT_FORMAT, E7_SAMPLES_PER_FRAME, E7_SERIALIZATION, E7_VIDEO_RATE,
  E7InterchangeRefusal, findInterchangeJsonViolation, interchangeFailure, refuse, requireInterchange, validateInterchangeTimelineV1,
  type E7InterchangeFailure, type InterchangeExternalPlacement, type InterchangeShotAudioClip, type InterchangeTimelineV1,
  type InterchangeTransition, type InterchangeVideoClip,
} from "./editorialInterchangeTimeline.schema.js";
import { freezeEditorial } from "./validateEditorialPlan.js";

// ---------------------------------------------------------------- export identity (Step 1118 section 14)
export type E7InterchangeIdentityV1 = Readonly<{
  identityType: typeof E7_IDENTITY_TYPE; identityVersion: typeof E7_IDENTITY_VERSION; interchangeTimelineSha256: string;
  interchangeTimelineVersion: typeof E7_INTERCHANGE_TIMELINE_VERSION; outputFormat: typeof E7_OUTPUT_FORMAT; otioProfile: typeof E7_OTIO_PROFILE;
  metadataVersion: typeof E7_METADATA_VERSION; mediaReferenceMode: typeof E7_MEDIA_REFERENCE_MODE; serialization: typeof E7_SERIALIZATION;
}>;

const IDENTITY_LITERALS = {
  identityType: E7_IDENTITY_TYPE, identityVersion: E7_IDENTITY_VERSION, interchangeTimelineVersion: E7_INTERCHANGE_TIMELINE_VERSION,
  outputFormat: E7_OUTPUT_FORMAT, otioProfile: E7_OTIO_PROFILE, metadataVersion: E7_METADATA_VERSION,
  mediaReferenceMode: E7_MEDIA_REFERENCE_MODE, serialization: E7_SERIALIZATION,
} as const;
const SHA = /^[a-f0-9]{64}$/;

export function buildE7InterchangeIdentityV1(interchangeTimelineSha256: string): E7InterchangeIdentityV1 {
  requireInterchange(SHA.test(interchangeTimelineSha256), "IDENTITY_MISMATCH", "interchangeTimelineSha256 must be a lowercase SHA-256");
  return freezeEditorial({ ...IDENTITY_LITERALS, interchangeTimelineSha256 });
}

// Exact key set and literals; any profile/version drift is PROFILE_UNSUPPORTED. No path, timestamp or random id.
export function validateE7InterchangeIdentityV1(input: unknown): E7InterchangeIdentityV1 {
  requireInterchange(input !== null && typeof input === "object" && !Array.isArray(input), "IDENTITY_MISMATCH", "identity must be an object");
  const raw = input as Record<string, unknown>;
  const keys = [...Object.keys(IDENTITY_LITERALS), "interchangeTimelineSha256"].sort();
  requireInterchange(canonicalEditorialJson(Object.keys(raw).sort()) === canonicalEditorialJson(keys), "IDENTITY_MISMATCH", "identity key set is not exact");
  for (const [key, literal] of Object.entries(IDENTITY_LITERALS)) {
    requireInterchange(raw[key] === literal, "PROFILE_UNSUPPORTED", `identity ${key} ${String(raw[key])} is not ${literal}`);
  }
  const interchangeTimelineSha256 = raw.interchangeTimelineSha256;
  // Type boundary before construction: a non-string is never coerced into a SHA (Step 1123 m1123-1).
  requireInterchange(typeof interchangeTimelineSha256 === "string", "IDENTITY_MISMATCH", "identity interchangeTimelineSha256 must be a string");
  return buildE7InterchangeIdentityV1(interchangeTimelineSha256);
}

export function hashE7InterchangeIdentityV1(input: unknown): string {
  return editorialSha256(canonicalEditorialJson(validateE7InterchangeIdentityV1(input)));
}

// ---------------------------------------------------------------- busybookie-otio-v1 exact emitted field sets (Step 1120 section 4)
// Key sets equal the OpenTimelineIO 0.18.1 native key sets (Step 1117, verified Step 1121). Any change needs a new profile.
export const E7_OTIO_KEY_SETS: Readonly<Record<(typeof E7_OTIO_SCHEMAS)[number], readonly string[]>> = freezeEditorial({
  "Timeline.1": ["OTIO_SCHEMA", "global_start_time", "metadata", "name", "tracks"],
  "Stack.1": ["OTIO_SCHEMA", "children", "color", "effects", "enabled", "markers", "metadata", "name", "source_range"],
  "Track.1": ["OTIO_SCHEMA", "children", "color", "effects", "enabled", "kind", "markers", "metadata", "name", "source_range"],
  "Clip.2": ["OTIO_SCHEMA", "active_media_reference_key", "color", "effects", "enabled", "markers", "media_references", "metadata", "name", "source_range"],
  "Transition.1": ["OTIO_SCHEMA", "in_offset", "metadata", "name", "out_offset", "transition_type"],
  "ExternalReference.1": ["OTIO_SCHEMA", "available_image_bounds", "available_range", "metadata", "name", "target_url"],
  "Gap.1": ["OTIO_SCHEMA", "color", "effects", "enabled", "markers", "metadata", "name", "source_range"],
  "TimeRange.1": ["OTIO_SCHEMA", "duration", "start_time"],
  "RationalTime.1": ["OTIO_SCHEMA", "rate", "value"],
});

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
type OtioObject = { readonly [key: string]: Json };

const rationalTime = (value: number, rate: number): OtioObject => ({ OTIO_SCHEMA: "RationalTime.1", rate, value });
const timeRange = (start: number, duration: number, rate: number): OtioObject =>
  ({ OTIO_SCHEMA: "TimeRange.1", start_time: rationalTime(start, rate), duration: rationalTime(duration, rate) });
const busybookie = (metadata: OtioObject): OtioObject => ({ [E7_METADATA_NAMESPACE]: metadata });
// Item defaults fixed by the profile; never library-selected.
const ITEM_DEFAULTS = (): OtioObject => ({ effects: [], markers: [], enabled: true, color: null });

function externalReference(targetUrl: string, durationValue: number, rate: number): OtioObject {
  return {
    OTIO_SCHEMA: "ExternalReference.1", metadata: {}, name: "", available_image_bounds: null, target_url: targetUrl,
    available_range: timeRange(0, durationValue, rate),
  };
}
function clip(name: string, metadata: OtioObject, sourceRange: OtioObject, reference: OtioObject): OtioObject {
  return {
    OTIO_SCHEMA: "Clip.2", metadata: busybookie(metadata), name, source_range: sourceRange, ...ITEM_DEFAULTS(),
    media_references: { DEFAULT_MEDIA: reference }, active_media_reference_key: "DEFAULT_MEDIA",
  };
}
function track(trackId: string, kind: "Video" | "Audio", metadata: OtioObject, children: readonly OtioObject[]): OtioObject {
  return { OTIO_SCHEMA: "Track.1", metadata: busybookie(metadata), name: trackId, source_range: null, ...ITEM_DEFAULTS(), kind, children };
}

function videoClip(c: InterchangeVideoClip): OtioObject {
  return clip(c.clipId, {
    clipId: c.clipId, shotId: c.shotId, sceneId: c.sceneId, assetId: c.assetId, assetSha256: c.assetSha256,
    mediaRootRelativePath: c.mediaRootRelativePath, selectedSourceInFrame: c.selectedSourceInFrame,
    selectedSourceOutFrame: c.selectedSourceOutFrame, timelineStartFrame: c.timelineStartFrame,
  }, timeRange(c.nominalSourceInFrame, c.nominalSourceOutFrame - c.nominalSourceInFrame, E7_VIDEO_RATE),
  externalReference(c.mediaRootRelativePath, c.assetDurationFrames, E7_VIDEO_RATE));
}
function transition(t: InterchangeTransition): OtioObject {
  return {
    OTIO_SCHEMA: "Transition.1",
    metadata: busybookie({ transitionId: t.transitionId, type: t.type, overlapFrames: t.overlapFrames, cutFrame: t.cutFrame, blendProfile: t.blendProfile }),
    name: t.transitionId, in_offset: rationalTime(t.inOffsetFrames, E7_VIDEO_RATE), out_offset: rationalTime(t.outOffsetFrames, E7_VIDEO_RATE),
    transition_type: "SMPTE_Dissolve",
  };
}
// Shot-audio available_range N = assetDurationFrames x 1920; the validator proved assetDurationSamples equals it (n1121-2).
function shotAudioClip(c: InterchangeShotAudioClip, video: InterchangeVideoClip): OtioObject {
  return clip(c.clipId, {
    clipId: c.clipId, linkedClipId: c.linkedClipId, assetId: c.assetId, assetSha256: c.assetSha256, mediaRootRelativePath: c.mediaRootRelativePath,
    audioMode: c.audioMode, dialoguePlanKey: c.dialoguePlanKey, audioKey: c.audioKey, sourceInSample: c.sourceInSample,
    sourceOutSample: c.sourceOutSample, timelineStartSample: c.timelineStartSample,
  }, timeRange(c.sourceInSample, c.sourceOutSample - c.sourceInSample, E7_AUDIO_RATE),
  externalReference(c.mediaRootRelativePath, video.assetDurationFrames * E7_SAMPLES_PER_FRAME, E7_AUDIO_RATE));
}
function externalClip(p: InterchangeExternalPlacement): OtioObject {
  return clip(p.layerId, {
    layerId: p.layerId, role: p.role, assetId: p.assetId, assetSha256: p.assetSha256, mediaRootRelativePath: p.mediaRootRelativePath,
    channelCount: p.channelCount, sourceInSample: p.sourceInSample, sourceOutSample: p.sourceOutSample, timelineStartSample: p.timelineStartSample,
    gainCentiDb: p.gainCentiDb, muted: p.muted, fadeInSamples: p.fadeInSamples, fadeOutSamples: p.fadeOutSamples,
  }, timeRange(p.sourceInSample, p.sourceOutSample - p.sourceInSample, E7_AUDIO_RATE),
  externalReference(p.mediaRootRelativePath, p.assetDurationSamples, E7_AUDIO_RATE));
}
const gap = (samples: number): OtioObject =>
  ({ OTIO_SCHEMA: "Gap.1", metadata: {}, name: "", ...ITEM_DEFAULTS(), source_range: timeRange(0, samples, E7_AUDIO_RATE) });

// Native OTIO object for a validated timeline. Array order is semantic and never sorted.
export function buildEditorialInterchangeOtio(t: InterchangeTimelineV1, interchangeTimelineSha256: string): OtioObject {
  // V1: clip_1, [Transition_k only for CROSS_DISSOLVE edges], clip_k+1, ... (CUT emits nothing).
  const v1: OtioObject[] = [];
  for (const [k, c] of t.video.clips.entries()) {
    if (k > 0) {
      const edge = t.video.transitions.find((candidate) => candidate.incomingClipId === c.clipId);
      if (edge !== undefined) v1.push(transition(edge));
    }
    v1.push(videoClip(c));
  }
  const a1 = t.shotAudio.clips.map((c, k) => shotAudioClip(c, t.video.clips[k]!));
  // AXn: leading gap from 0 and inter-placement gaps only; never zero-length; no trailing gap.
  const lanes = t.externalAudio.lanes.map((lane) => {
    const children: OtioObject[] = [];
    let cursor = 0;
    for (const p of lane.placements) {
      if (p.timelineStartSample > cursor) children.push(gap(p.timelineStartSample - cursor));
      children.push(externalClip(p));
      cursor = p.timelineEndSample;
    }
    return track(lane.trackId, "Audio", { trackId: lane.trackId, role: "EXTERNAL_AUDIO_LANE", laneIndex: lane.laneIndex }, children);
  });
  const stack: OtioObject = {
    OTIO_SCHEMA: "Stack.1", metadata: {}, name: "tracks", source_range: null, ...ITEM_DEFAULTS(),
    children: [
      track("V1", "Video", { trackId: "V1", role: "VIDEO" }, v1),
      track("A1", "Audio", { trackId: "A1", role: "SHOT_AUDIO", bed: { bedGainCentiDb: t.shotAudio.bed.bedGainCentiDb, bedMuted: t.shotAudio.bed.bedMuted } }, a1),
      ...lanes,
    ],
  };
  const pv = t.provenance;
  return {
    OTIO_SCHEMA: "Timeline.1",
    metadata: busybookie({
      metadataVersion: E7_METADATA_VERSION, otioProfile: E7_OTIO_PROFILE, interchangeTimelineVersion: t.interchangeTimelineVersion,
      interchangeTimelineSha256, timelineId: t.timelineId, episode: { episodeId: t.episode.episodeId, manifestSha256: t.episode.manifestSha256 },
      provenance: {
        subjectSha256: pv.subjectSha256, revisionNumber: pv.revisionNumber, revisionSha256: pv.revisionSha256, approval: pv.approval,
        appliedProposalSha256: pv.appliedProposalSha256, approvalReviewSha256: pv.approvalReviewSha256, decisionStateSha256: pv.decisionStateSha256,
        planSha256: pv.planSha256, upstreamRoute: pv.upstreamRoute, upstreamRenderKey: pv.upstreamRenderKey, masteringRenderKey: pv.masteringRenderKey,
        preMasterEvidenceSha256: pv.preMasterEvidenceSha256, editorialDecisionsSha256: pv.editorialDecisionsSha256,
        audioMixDecisionsSha256: pv.audioMixDecisionsSha256, manifestSha256: pv.manifestSha256,
      },
      rates: { videoFrameRate: { numerator: E7_VIDEO_RATE, denominator: 1 }, audioSampleRateHz: E7_AUDIO_RATE, samplesPerFrame: E7_SAMPLES_PER_FRAME },
      mastering: t.mastering === null ? null : {
        mode: t.mastering.mode, masteringDecisionsSha256: t.mastering.masteringDecisionsSha256, policyId: t.mastering.policyId,
        policySha256: t.mastering.policySha256, masteringRenderKey: t.mastering.masteringRenderKey, preMasterEvidenceSha256: t.mastering.preMasterEvidenceSha256,
      },
    }),
    name: t.episode.episodeId, global_start_time: null, tracks: stack,
  };
}

// Self-check of the emitted profile: only the 9 pinned schema tags, each with exactly its frozen key set; every
// non-OTIO object sits under metadata. Returns the emitted schema tags in first-seen order.
export function auditEditorialInterchangeOtio(value: unknown): string[] {
  const seen: string[] = [];
  const walk = (node: unknown, inMetadata: boolean): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, inMetadata);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const object = node as Record<string, unknown>;
    if (!inMetadata) {
      const schema = object.OTIO_SCHEMA;
      const mediaMap = schema === undefined && Object.hasOwn(object, "DEFAULT_MEDIA");
      if (mediaMap) {
        requireInterchange(canonicalEditorialJson(Object.keys(object)) === canonicalEditorialJson(["DEFAULT_MEDIA"]), "SERIALIZATION_INVALID",
          "media_references must carry exactly DEFAULT_MEDIA");
      } else {
        requireInterchange(typeof schema === "string" && (E7_OTIO_SCHEMAS as readonly string[]).includes(schema), "SERIALIZATION_INVALID",
          `emitted OTIO_SCHEMA ${String(schema)} is not in the busybookie-otio-v1 profile`);
        const keys = E7_OTIO_KEY_SETS[schema as (typeof E7_OTIO_SCHEMAS)[number]];
        requireInterchange(canonicalEditorialJson(Object.keys(object).sort()) === canonicalEditorialJson(keys), "SERIALIZATION_INVALID",
          `${schema} key set is not the frozen profile key set`);
        if (!seen.includes(schema)) seen.push(schema);
      }
    }
    for (const [key, child] of Object.entries(object)) {
      if (key === "metadata") {
        requireInterchange(child !== null && typeof child === "object" && !Array.isArray(child) &&
          Object.keys(child).every((name) => name === E7_METADATA_NAMESPACE), "SERIALIZATION_INVALID", "metadata may only carry the busybookie namespace");
        walk(child, true);
      } else {
        walk(child, inMetadata);
      }
    }
  };
  walk(value, false);
  return seen;
}

// Bytes must never carry a workstation path: no backslash at all (canonical locators have none), no drive letter, no
// absolute POSIX/UNC string value, no URI authority, no home-relative path.
export function findAbsolutePathLeak(text: string): string | null {
  if (text.includes("\\")) return "backslash";
  if (/[A-Za-z]:\//.test(text)) return "drive path";
  if (/"\//.test(text)) return "absolute POSIX or UNC path";
  if (text.includes("://")) return "URI authority";
  if (/"~/.test(text)) return "home-relative path";
  return null;
}

export type EditorialInterchangeProfileRequest = Readonly<Partial<{
  interchangeTimelineVersion: string; outputFormat: string; otioProfile: string; metadataVersion: string; mediaReferenceMode: string; serialization: string;
}>>;

export type EditorialInterchangeOtio =
  | Readonly<{ ok: true; bytes: Uint8Array; interchangeTimelineSha256: string; identity: E7InterchangeIdentityV1; exportIdentitySha256: string }>
  | E7InterchangeFailure;

// Pure deterministic bytes: UTF-8 without BOM, recursive lexicographic keys, semantic array order, compact, one LF.
// Order: profile request -> full timeline validation -> identity binding -> OTIO build -> profile audit -> numeric pass ->
// path scan. The same InterchangeTimelineV1 + profile always yields identical bytes.
export function serializeEditorialInterchangeOtio(input: Readonly<{
  timeline: unknown; profile?: EditorialInterchangeProfileRequest; expectedInterchangeTimelineSha256?: string; expectedExportIdentitySha256?: string;
}>): EditorialInterchangeOtio {
  try {
    const requested = (input.profile ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(requested)) {
      requireInterchange(Object.hasOwn(IDENTITY_LITERALS, key) && key !== "identityType" && key !== "identityVersion" &&
        value === IDENTITY_LITERALS[key as keyof typeof IDENTITY_LITERALS], "PROFILE_UNSUPPORTED", `requested ${key} ${String(value)} is not supported`);
    }
    const timeline = validateInterchangeTimelineV1(input.timeline);
    const interchangeTimelineSha256 = editorialSha256(canonicalEditorialJson(timeline));
    if (input.expectedInterchangeTimelineSha256 !== undefined) {
      requireInterchange(input.expectedInterchangeTimelineSha256 === interchangeTimelineSha256, "IDENTITY_MISMATCH", "interchangeTimelineSha256 differs from the supplied value");
    }
    const identity = buildE7InterchangeIdentityV1(interchangeTimelineSha256);
    const exportIdentitySha256 = hashE7InterchangeIdentityV1(identity);
    if (input.expectedExportIdentitySha256 !== undefined) {
      requireInterchange(input.expectedExportIdentitySha256 === exportIdentitySha256, "IDENTITY_MISMATCH", "exportIdentitySha256 differs from the supplied value");
    }
    const otio = buildEditorialInterchangeOtio(timeline, interchangeTimelineSha256);
    auditEditorialInterchangeOtio(otio);
    const violation = findInterchangeJsonViolation(otio);
    if (violation !== null) refuse("SERIALIZATION_INVALID", violation);
    const text = canonicalEditorialJson(otio);
    const leak = findAbsolutePathLeak(text);
    if (leak !== null) refuse("ABSOLUTE_PATH_FORBIDDEN", `serialized bytes contain a ${leak}`);
    const bytes = new TextEncoder().encode(`${text}\n`);
    return Object.freeze({ ok: true, bytes, interchangeTimelineSha256, identity, exportIdentitySha256 });
  } catch (cause) {
    if (cause instanceof E7InterchangeRefusal) return interchangeFailure(cause.reason, cause.detail);
    throw cause;
  }
}
