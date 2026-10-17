import { z } from "zod";
import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import { EditorialAssetSchema } from "./editorialPlan.schema.js";
import {
  AudioLayerIdSchema, E4_MAX_GAIN_CENTI_DB, E4_MIN_GAIN_CENTI_DB, ExternalAudioAssetIdSchema, ExternalAudioLocatorSchema,
} from "./editorialPlanV3.schema.js";
import { freezeEditorial } from "./validateEditorialPlan.js";

// ---------------------------------------------------------------- E7 v1 frozen literals (Step 1118 / Step 1120)
export const E7_INTERCHANGE_TIMELINE_VERSION = "busybookie-interchange-timeline-v1";
export const E7_OTIO_PROFILE = "busybookie-otio-v1";
export const E7_METADATA_NAMESPACE = "busybookie";
export const E7_METADATA_VERSION = "busybookie-otio-metadata-v1";
export const E7_BLEND_PROFILE = "busybookie-edit-v1-j-over-t";
export const E7_OUTPUT_FORMAT = "OTIO_JSON";
export const E7_MEDIA_REFERENCE_MODE = "RELATIVE";
export const E7_SERIALIZATION = "CANONICAL_SORTED_COMPACT_LF_V1";
export const E7_IDENTITY_TYPE = "BUSYBOOKIE_E7_INTERCHANGE_IDENTITY";
export const E7_IDENTITY_VERSION = "1";
export const E7_TIMELINE_ID_PREFIX = "busybookie-timeline:";
export const E7_VIDEO_RATE = 25;
export const E7_AUDIO_RATE = 48_000;
export const E7_SAMPLES_PER_FRAME = 1_920;
export const E7_MAX_TIMELINE_FRAMES = 22_275_000;
// The exact busybookie-otio-v1 emitted schema set (9). MissingReference is OUT_OF_SCOPE_E7_V1 and never emitted.
export const E7_OTIO_SCHEMAS = [
  "Timeline.1", "Stack.1", "Track.1", "Clip.2", "Transition.1", "ExternalReference.1", "Gap.1", "TimeRange.1", "RationalTime.1",
] as const;

// ---------------------------------------------------------------- reason codes (17, Step 1118 section 16)
export const E7_INTERCHANGE_REASON_CODES = [
  "UNAPPROVED_HEAD", "HISTORY_INVALID", "STALE_AUTHORITY", "PROVENANCE_MISMATCH", "INVALID_INTERCHANGE_INPUT",
  "UNSUPPORTED_EDITORIAL_SEMANTIC", "TRANSITION_HANDLE_INVALID", "TRANSITION_MAPPING_INVALID", "AUDIO_RANGE_INVALID",
  "MEDIA_REFERENCE_INVALID", "ABSOLUTE_PATH_FORBIDDEN", "SERIALIZATION_INVALID", "PROFILE_UNSUPPORTED", "IDENTITY_MISMATCH",
  "STORE_EXISTS_CONFLICT", "STORE_UNSUPPORTED", "STORED_ARTIFACT_CORRUPT",
] as const;
export type E7InterchangeReason = (typeof E7_INTERCHANGE_REASON_CODES)[number];
export type E7InterchangeFailure = Readonly<{ ok: false; reason: E7InterchangeReason; detail: string }>;

export function interchangeFailure(reason: E7InterchangeReason, detail: string): E7InterchangeFailure {
  return freezeEditorial({ ok: false, reason, detail });
}

// Internal fail-closed signal; every public entry point converts it to an E7InterchangeFailure result.
export class E7InterchangeRefusal extends Error {
  constructor(readonly reason: E7InterchangeReason, readonly detail: string) {
    super(`${reason}: ${detail}`);
  }
}
export function refuse(reason: E7InterchangeReason, detail: string): never {
  throw new E7InterchangeRefusal(reason, detail);
}
export function requireInterchange(condition: unknown, reason: E7InterchangeReason, detail: string): asserts condition {
  if (!condition) refuse(reason, detail);
}

// ---------------------------------------------------------------- numeric / JSON-type pass (n1119-2, Step 1120 section 9)
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Every number must be a safe integer and never negative zero (Number.isSafeInteger(-0) is true, so -0 is checked
// explicitly); only plain JSON values; no prototype-sensitive keys. No coercion, rounding or stringification.
export function findInterchangeJsonViolation(value: unknown, path = "$"): string | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return null;
  if (typeof value === "number") {
    if (Object.is(value, -0)) return `${path} is negative zero`;
    return Number.isSafeInteger(value) ? null : `${path} is not a safe integer (${String(value)})`;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      if (!(i in value)) return `${path}[${i}] is a hole`;
      const found = findInterchangeJsonViolation(value[i], `${path}[${i}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value !== "object") return `${path} is not a JSON value (${typeof value})`;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return `${path} is not a plain object`;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) return `${path} has forbidden key ${key}`;
    const found = findInterchangeJsonViolation((value as Record<string, unknown>)[key], `${path}.${key}`);
    if (found !== null) return found;
  }
  return null;
}

// ---------------------------------------------------------------- media locators (Step 1120 section 7, n1121-3)
// Absolute and scheme forms are classified before any generic segment rule, so a UNC or drive path that also contains
// backslashes is always ABSOLUTE_PATH_FORBIDDEN. The filesystem is never consulted.
export function classifyInterchangeLocator(value: unknown): "MEDIA_REFERENCE_INVALID" | "ABSOLUTE_PATH_FORBIDDEN" | null {
  if (typeof value !== "string" || value.length === 0) return "MEDIA_REFERENCE_INVALID";
  if (/^[A-Za-z]:/.test(value)) return "ABSOLUTE_PATH_FORBIDDEN";
  if (value.startsWith("\\\\") || value.startsWith("//")) return "ABSOLUTE_PATH_FORBIDDEN";
  if (value.startsWith("/") || value.startsWith("\\")) return "ABSOLUTE_PATH_FORBIDDEN";
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) return "ABSOLUTE_PATH_FORBIDDEN";
  const firstSlash = value.indexOf("/");
  if (value.slice(0, firstSlash === -1 ? value.length : firstSlash).includes(":")) return "ABSOLUTE_PATH_FORBIDDEN";
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return "MEDIA_REFERENCE_INVALID";
  if (value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return "MEDIA_REFERENCE_INVALID";
  return null;
}

const SHOT_LOCATOR = EditorialAssetSchema.shape.mediaRootRelativePath;

export function assertInterchangeLocator(value: unknown, kind: "SHOT" | "EXTERNAL", label: string): string {
  const classified = classifyInterchangeLocator(value);
  if (classified !== null) refuse(classified, `${label} locator is not a canonical media-root-relative path`);
  const grammar = kind === "SHOT" ? SHOT_LOCATOR : ExternalAudioLocatorSchema;
  requireInterchange(grammar.safeParse(value).success, "MEDIA_REFERENCE_INVALID", `${label} locator does not match the canonical ${kind} grammar`);
  return value as string;
}

// ---------------------------------------------------------------- deterministic external-audio lanes (Step 1118 section 9)
const codeUnitOrder = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export type InterchangeLaneInput = Readonly<{ layerId: string; startSample: number; endSample: number }>;

// Sort by (start, end, layerId by UTF-16 code units, never locale); lowest lane whose last end <= start; else a new lane.
// Touching intervals share a lane. Returns the lane index of every input, in input order.
export function assignInterchangeAudioLanes(placements: readonly InterchangeLaneInput[]): number[] {
  const order = placements.map((_, index) => index).sort((a, b) => {
    const left = placements[a]!;
    const right = placements[b]!;
    return left.startSample - right.startSample || left.endSample - right.endSample || codeUnitOrder(left.layerId, right.layerId);
  });
  const laneEnds: number[] = [];
  const lanes = new Array<number>(placements.length);
  for (const index of order) {
    const placement = placements[index]!;
    let lane = laneEnds.findIndex((end) => end <= placement.startSample);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(placement.endSample);
    } else {
      laneEnds[lane] = placement.endSample;
    }
    lanes[index] = lane;
  }
  return lanes;
}

// ---------------------------------------------------------------- InterchangeTimelineV1 (exact v1 shape, Step 1118 section 4)
// Types only here; sign/range/geometry rules are checked by validateInterchangeTimelineV1 so that each violation keeps its
// specific frozen reason instead of a generic shape failure.
const int = z.number();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const episodeId = z.string().regex(/^EP[0-9]{2,3}$/);
const shotId = z.string().regex(/^S[0-9]{2,3}[A-Z]?$/);
const sceneId = z.string().regex(/^SC[0-9]{2,3}$/);
const videoClipId = z.string().regex(/^V1-S[0-9]{2,3}[A-Z]?$/);
const audioClipId = z.string().regex(/^A1-S[0-9]{2,3}[A-Z]?$/);
const normalizedAssetId = EditorialAssetSchema.shape.assetId;

const VideoClipSchema = z.object({
  clipId: videoClipId, shotId, sceneId, assetId: normalizedAssetId, assetSha256: sha, mediaRootRelativePath: z.string(),
  assetDurationFrames: int, selectedSourceInFrame: int, selectedSourceOutFrame: int, timelineStartFrame: int,
  nominalSourceInFrame: int, nominalSourceOutFrame: int, nominalTimelineStartFrame: int,
}).strict();
const TransitionSchema = z.object({
  transitionId: z.string(), type: z.string(), outgoingClipId: videoClipId, incomingClipId: videoClipId, overlapFrames: int,
  cutFrame: int, inOffsetFrames: int, outOffsetFrames: int, blendProfile: z.string(),
}).strict();
const ShotAudioClipSchema = z.object({
  clipId: audioClipId, linkedClipId: videoClipId, assetId: normalizedAssetId, assetSha256: sha, mediaRootRelativePath: z.string(),
  assetDurationSamples: int, audioMode: z.string(), dialoguePlanKey: sha.nullable(), audioKey: sha.nullable(),
  sourceInSample: int, sourceOutSample: int, timelineStartSample: int,
}).strict();
const PlacementSchema = z.object({
  layerId: AudioLayerIdSchema, role: z.string(), assetId: ExternalAudioAssetIdSchema, assetSha256: sha, mediaRootRelativePath: z.string(),
  assetDurationSamples: int, channelCount: int, sourceInSample: int, sourceOutSample: int, timelineStartSample: int,
  timelineEndSample: int, gainCentiDb: int, muted: z.boolean(), fadeInSamples: int, fadeOutSamples: int,
}).strict();
const MasteringSchema = z.object({
  mode: z.string(), masteringDecisionsSha256: sha, policyId: z.string().nullable(), policySha256: sha.nullable(),
  masteringRenderKey: sha.nullable(), preMasterEvidenceSha256: sha.nullable(),
}).strict();

export const InterchangeTimelineV1Schema = z.object({
  interchangeTimelineVersion: z.literal(E7_INTERCHANGE_TIMELINE_VERSION),
  timelineId: z.string(),
  episode: z.object({ episodeId, manifestSha256: sha }).strict(),
  provenance: z.object({
    subjectSha256: sha, revisionNumber: int, revisionSha256: sha, approval: z.enum(["HUMAN_APPROVED", "GENESIS_DECLARED"]),
    appliedProposalSha256: sha.nullable(), approvalReviewSha256: sha.nullable(), decisionStateSha256: sha, planSha256: sha,
    upstreamRoute: z.enum(["E2_ROUGH_CUT", "E3_EDIT", "E4_MIX"]), upstreamRenderKey: sha, masteringRenderKey: sha.nullable(),
    preMasterEvidenceSha256: sha.nullable(), editorialDecisionsSha256: sha.nullable(), audioMixDecisionsSha256: sha.nullable(),
    manifestSha256: sha,
  }).strict(),
  rates: z.object({
    videoFrameRate: z.object({ numerator: z.literal(E7_VIDEO_RATE), denominator: z.literal(1) }).strict(),
    audioSampleRateHz: z.literal(E7_AUDIO_RATE), samplesPerFrame: z.literal(E7_SAMPLES_PER_FRAME),
  }).strict(),
  timelineDurationFrames: int,
  video: z.object({ trackId: z.literal("V1"), clips: z.array(VideoClipSchema), transitions: z.array(TransitionSchema) }).strict(),
  shotAudio: z.object({
    trackId: z.literal("A1"), bed: z.object({ bedGainCentiDb: int, bedMuted: z.boolean() }).strict(), clips: z.array(ShotAudioClipSchema),
  }).strict(),
  externalAudio: z.object({
    lanes: z.array(z.object({ laneIndex: int, trackId: z.string(), placements: z.array(PlacementSchema) }).strict()),
  }).strict(),
  mastering: MasteringSchema.nullable(),
}).strict();

type Readonlyish<T> = T extends object ? { readonly [K in keyof T]: Readonlyish<T[K]> } : T;
export type InterchangeTimelineV1 = Readonlyish<z.infer<typeof InterchangeTimelineV1Schema>>;
export type InterchangeVideoClip = InterchangeTimelineV1["video"]["clips"][number];
export type InterchangeTransition = InterchangeTimelineV1["video"]["transitions"][number];
export type InterchangeShotAudioClip = InterchangeTimelineV1["shotAudio"]["clips"][number];
export type InterchangeExternalPlacement = InterchangeTimelineV1["externalAudio"]["lanes"][number]["placements"][number];

export const E7_SHOT_AUDIO_MODES = ["PRESERVE_NATIVE", "SYNTHETIC_SILENCE", "REPLACE_SOURCE_WITH_DIALOGUE"] as const;
export const E7_EXTERNAL_AUDIO_ROLES = ["MUSIC", "SFX", "AMBIENCE", "OTHER"] as const;
export const E7_MASTERING_MODES = ["MEASURE_ONLY", "NORMALIZE_STATIC"] as const;

export const dissolveInOffset = (overlapFrames: number): number => Math.floor(overlapFrames / 2);
export const dissolveOutOffset = (overlapFrames: number): number => Math.ceil(overlapFrames / 2);
export const interchangeTransitionId = (outgoingClipId: string, incomingClipId: string): string =>
  `transition:${outgoingClipId}>${incomingClipId}`;
export const interchangeLaneTrackId = (laneIndex: number): string => `AX${laneIndex}`;

// ---------------------------------------------------------------- full validation (shared by derivation and serializer)
// Order (first failure wins): JSON/number pass -> version literal -> strict shape -> locators -> provenance/ids ->
// video geometry -> shot audio -> external audio -> mastering.
export function validateInterchangeTimelineV1(input: unknown): InterchangeTimelineV1 {
  const violation = findInterchangeJsonViolation(input);
  if (violation !== null) refuse("SERIALIZATION_INVALID", violation);
  requireInterchange(input !== null && typeof input === "object" && !Array.isArray(input), "SERIALIZATION_INVALID", "timeline must be an object");
  const version = (input as Record<string, unknown>).interchangeTimelineVersion;
  requireInterchange(version === E7_INTERCHANGE_TIMELINE_VERSION, "PROFILE_UNSUPPORTED", `interchange timeline version ${String(version)} is not ${E7_INTERCHANGE_TIMELINE_VERSION}`);
  // An extra track or any other unclassified top-level semantic is never silently dropped.
  const raw = input as Record<string, unknown>;
  const classified: readonly [unknown, z.ZodObject, string][] = [
    [raw, InterchangeTimelineV1Schema, "timeline"], [raw.video, InterchangeTimelineV1Schema.shape.video, "video"],
    [raw.shotAudio, InterchangeTimelineV1Schema.shape.shotAudio, "shotAudio"], [raw.externalAudio, InterchangeTimelineV1Schema.shape.externalAudio, "externalAudio"],
  ];
  for (const [object, schema, label] of classified) {
    if (object === null || typeof object !== "object" || Array.isArray(object)) continue;
    const extra = Object.keys(object).filter((key) => !Object.hasOwn(schema.shape, key));
    requireInterchange(extra.length === 0, "UNSUPPORTED_EDITORIAL_SEMANTIC", `${label} carries unclassified semantic ${extra.join(",")}`);
  }
  // Locators are classified before the generic shape check, so a missing, non-string or absolute locator keeps its frozen
  // media reason (Step 1120 section 7) instead of a generic shape failure.
  const records = (value: unknown): Record<string, unknown>[] =>
    (Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item)) : []);
  const field = (value: unknown, key: string): unknown =>
    (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined);
  const located = [...records(field(raw.video, "clips")), ...records(field(raw.shotAudio, "clips")),
    ...records(field(raw.externalAudio, "lanes")).flatMap((lane) => records(lane.placements))];
  for (const item of located) {
    const classified = classifyInterchangeLocator(item.mediaRootRelativePath);
    if (classified !== null) refuse(classified, `${String(item.clipId ?? item.layerId)} locator is not a canonical media-root-relative path`);
  }
  const parsed = InterchangeTimelineV1Schema.safeParse(input);
  if (!parsed.success) refuse("SERIALIZATION_INVALID", `interchange timeline shape is invalid: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`);
  const t = parsed.data;
  for (const clip of t.video.clips) assertInterchangeLocator(clip.mediaRootRelativePath, "SHOT", clip.clipId);
  for (const clip of t.shotAudio.clips) assertInterchangeLocator(clip.mediaRootRelativePath, "SHOT", clip.clipId);
  for (const lane of t.externalAudio.lanes) for (const p of lane.placements) assertInterchangeLocator(p.mediaRootRelativePath, "EXTERNAL", p.layerId);

  // Provenance, stable ids and nullness.
  const pv = t.provenance;
  requireInterchange(t.timelineId === `${E7_TIMELINE_ID_PREFIX}${pv.revisionSha256}`, "SERIALIZATION_INVALID", "timelineId is not derived from revisionSha256");
  requireInterchange(t.episode.manifestSha256 === pv.manifestSha256, "SERIALIZATION_INVALID", "episode and provenance manifestSha256 differ");
  requireInterchange(Number.isSafeInteger(pv.revisionNumber) && pv.revisionNumber >= 1, "SERIALIZATION_INVALID", "revisionNumber must be >= 1");
  const genesis = pv.approval === "GENESIS_DECLARED";
  requireInterchange(genesis === (pv.revisionNumber === 1) && (pv.appliedProposalSha256 === null) === genesis &&
    (pv.approvalReviewSha256 === null) === genesis, "SERIALIZATION_INVALID", "approval kind, revision number and review linkage are inconsistent");
  requireInterchange((pv.masteringRenderKey === null) === (pv.preMasterEvidenceSha256 === null), "SERIALIZATION_INVALID",
    "masteringRenderKey and preMasterEvidenceSha256 nullness differ");
  requireInterchange(t.timelineDurationFrames >= 1 && t.timelineDurationFrames <= E7_MAX_TIMELINE_FRAMES, "SERIALIZATION_INVALID",
    "timelineDurationFrames out of range");

  // Video: one clip per shot in order, CUT adjacency, dissolve geometry, nominal ranges and handles.
  const clips = t.video.clips;
  requireInterchange(clips.length >= 1, "SERIALIZATION_INVALID", "video track requires at least one clip");
  const ids = new Set<string>();
  for (const clip of clips) {
    requireInterchange(clip.clipId === `V1-${clip.shotId}` && !ids.has(clip.clipId), "SERIALIZATION_INVALID", `video clip ${clip.clipId} id is not unique V1-<shotId>`);
    ids.add(clip.clipId);
  }
  const overlaps = clips.map(() => 0);
  let previousEdge = -1;
  for (const transition of t.video.transitions) {
    requireInterchange(transition.type === "CROSS_DISSOLVE", "TRANSITION_MAPPING_INVALID", `transition type ${transition.type} is not CROSS_DISSOLVE`);
    const edge = clips.findIndex((clip) => clip.clipId === transition.outgoingClipId);
    requireInterchange(edge >= 0 && edge < clips.length - 1 && clips[edge + 1]!.clipId === transition.incomingClipId && edge > previousEdge,
      "TRANSITION_MAPPING_INVALID", `transition ${transition.transitionId} does not join adjacent clips in timeline order`);
    previousEdge = edge;
    requireInterchange(transition.transitionId === interchangeTransitionId(transition.outgoingClipId, transition.incomingClipId),
      "TRANSITION_MAPPING_INVALID", `transitionId ${transition.transitionId} is not derived from its clips`);
    requireInterchange(transition.blendProfile === E7_BLEND_PROFILE, "TRANSITION_MAPPING_INVALID", `blend profile ${transition.blendProfile} is not ${E7_BLEND_PROFILE}`);
    requireInterchange(transition.overlapFrames >= 1, "TRANSITION_MAPPING_INVALID", "dissolve overlap must be >= 1 frame");
    requireInterchange(transition.inOffsetFrames === dissolveInOffset(transition.overlapFrames) &&
      transition.outOffsetFrames === dissolveOutOffset(transition.overlapFrames), "TRANSITION_MAPPING_INVALID",
    `${transition.transitionId} offsets are not floor(T/2)/ceil(T/2)`);
    overlaps[edge] = transition.overlapFrames;
  }
  let start = 0;
  let nominalSum = 0;
  for (const [k, clip] of clips.entries()) {
    const label = clip.clipId;
    const selected = clip.selectedSourceOutFrame - clip.selectedSourceInFrame;
    requireInterchange(clip.assetDurationFrames >= 1, "TRANSITION_HANDLE_INVALID", `${label} asset duration must be >= 1`);
    requireInterchange(clip.selectedSourceInFrame >= 0 && selected >= 1 && clip.selectedSourceOutFrame <= clip.assetDurationFrames,
      "TRANSITION_HANDLE_INVALID", `${label} selected source range is outside the asset`);
    requireInterchange(clip.timelineStartFrame === start, "TRANSITION_MAPPING_INVALID", `${label} timeline start is not S(k-1) + D(k-1) - T(k-1)`);
    const a = k > 0 ? dissolveInOffset(overlaps[k - 1]!) : 0;
    const b = k < clips.length - 1 ? dissolveOutOffset(overlaps[k]!) : 0;
    requireInterchange(selected - a - b >= 1, "TRANSITION_HANDLE_INVALID", `${label} nominal duration must be >= 1 frame`);
    requireInterchange(clip.nominalSourceInFrame === clip.selectedSourceInFrame + a && clip.nominalSourceOutFrame === clip.selectedSourceOutFrame - b &&
      clip.nominalTimelineStartFrame === clip.timelineStartFrame + a, "TRANSITION_HANDLE_INVALID", `${label} nominal range does not follow the dissolve offsets`);
    nominalSum += selected - a - b;
    if (k < clips.length - 1) start += selected - overlaps[k]!;
    else requireInterchange(start + selected === t.timelineDurationFrames, "TRANSITION_MAPPING_INVALID", "timeline duration differs from the clip geometry");
  }
  requireInterchange(nominalSum === t.timelineDurationFrames, "TRANSITION_MAPPING_INVALID", "sum of nominal durations differs from the timeline duration");
  for (const transition of t.video.transitions) {
    const k = clips.findIndex((clip) => clip.clipId === transition.incomingClipId);
    requireInterchange(transition.cutFrame === clips[k]!.timelineStartFrame + transition.inOffsetFrames, "TRANSITION_MAPPING_INVALID",
      `${transition.transitionId} cut frame is not incoming start + in_offset`);
  }

  // Shot audio: A1 = video nominal geometry x 1920, contiguous, coherent asset duration (n1121-2).
  const bed = t.shotAudio.bed;
  requireInterchange(bed.bedGainCentiDb >= E4_MIN_GAIN_CENTI_DB && bed.bedGainCentiDb <= E4_MAX_GAIN_CENTI_DB, "AUDIO_RANGE_INVALID", "bed gain out of range");
  requireInterchange(t.shotAudio.clips.length === clips.length, "AUDIO_RANGE_INVALID", "shot audio requires exactly one clip per video clip");
  let audioCursor = 0;
  for (const [k, audio] of t.shotAudio.clips.entries()) {
    const video = clips[k]!;
    const label = audio.clipId;
    requireInterchange(audio.clipId === `A1-${video.shotId}` && audio.linkedClipId === video.clipId && audio.assetId === video.assetId &&
      audio.assetSha256 === video.assetSha256 && audio.mediaRootRelativePath === video.mediaRootRelativePath, "SERIALIZATION_INVALID",
    `${label} is not linked to ${video.clipId} in manifest order`);
    requireInterchange((E7_SHOT_AUDIO_MODES as readonly string[]).includes(audio.audioMode), "UNSUPPORTED_EDITORIAL_SEMANTIC", `${label} audio mode ${audio.audioMode} has no v1 classification`);
    const dialogue = audio.audioMode === "REPLACE_SOURCE_WITH_DIALOGUE";
    requireInterchange((audio.dialoguePlanKey !== null) === dialogue && (audio.audioKey !== null) === dialogue, "SERIALIZATION_INVALID",
      `${label} dialogue keys are present exactly for REPLACE_SOURCE_WITH_DIALOGUE`);
    requireInterchange(audio.assetDurationSamples === video.assetDurationFrames * E7_SAMPLES_PER_FRAME, "AUDIO_RANGE_INVALID",
      `${label} assetDurationSamples is not assetDurationFrames x 1920`);
    requireInterchange(audio.sourceInSample === video.nominalSourceInFrame * E7_SAMPLES_PER_FRAME &&
      audio.sourceOutSample === video.nominalSourceOutFrame * E7_SAMPLES_PER_FRAME &&
      audio.timelineStartSample === video.nominalTimelineStartFrame * E7_SAMPLES_PER_FRAME && audio.timelineStartSample === audioCursor,
    "AUDIO_RANGE_INVALID", `${label} is not the video nominal geometry x 1920 with contiguous hard cuts`);
    audioCursor += audio.sourceOutSample - audio.sourceInSample;
  }
  requireInterchange(audioCursor === t.timelineDurationFrames * E7_SAMPLES_PER_FRAME, "AUDIO_RANGE_INVALID", "shot audio does not cover the timeline");

  // External audio: integer ranges inside asset and timeline, frozen lane assignment, start order within lanes.
  const timelineSamples = t.timelineDurationFrames * E7_SAMPLES_PER_FRAME;
  const flat: { lane: number; placement: InterchangeExternalPlacement }[] = [];
  const layerIds = new Set<string>();
  for (const [index, lane] of t.externalAudio.lanes.entries()) {
    requireInterchange(lane.laneIndex === index && lane.trackId === interchangeLaneTrackId(index), "AUDIO_RANGE_INVALID", `lane ${index} index/trackId is not AX${index}`);
    requireInterchange(lane.placements.length >= 1, "AUDIO_RANGE_INVALID", `lane ${lane.trackId} is empty`);
    let laneEnd = 0;
    for (const p of lane.placements) {
      const label = p.layerId;
      requireInterchange(!layerIds.has(p.layerId), "AUDIO_RANGE_INVALID", `${label} appears more than once`);
      layerIds.add(p.layerId);
      requireInterchange((E7_EXTERNAL_AUDIO_ROLES as readonly string[]).includes(p.role), "UNSUPPORTED_EDITORIAL_SEMANTIC", `${label} role ${p.role} has no v1 classification`);
      requireInterchange(p.channelCount === 1 || p.channelCount === 2, "AUDIO_RANGE_INVALID", `${label} channel count must be 1 or 2`);
      requireInterchange(p.assetDurationSamples >= 1 && p.sourceInSample >= 0 && p.sourceOutSample > p.sourceInSample &&
        p.sourceOutSample <= p.assetDurationSamples, "AUDIO_RANGE_INVALID", `${label} source range is empty or outside the asset`);
      requireInterchange(p.timelineStartSample >= 0 && p.timelineEndSample === p.timelineStartSample + p.sourceOutSample - p.sourceInSample &&
        p.timelineEndSample <= timelineSamples, "AUDIO_RANGE_INVALID", `${label} timeline placement is inconsistent or outside the timeline`);
      requireInterchange(p.gainCentiDb >= E4_MIN_GAIN_CENTI_DB && p.gainCentiDb <= E4_MAX_GAIN_CENTI_DB, "AUDIO_RANGE_INVALID", `${label} gain out of range`);
      requireInterchange([p.fadeInSamples, p.fadeOutSamples].every((fade) => fade === 0 || fade >= 2) &&
        p.fadeInSamples + p.fadeOutSamples <= p.timelineEndSample - p.timelineStartSample, "AUDIO_RANGE_INVALID",
      `${label} fades must be 0 or >= 2 samples and fit the placement (E4 rule)`);
      requireInterchange(p.timelineStartSample >= laneEnd, "AUDIO_RANGE_INVALID", `${label} overlaps or precedes its lane predecessor`);
      laneEnd = p.timelineEndSample;
      flat.push({ lane: index, placement: p });
    }
  }
  const expected = assignInterchangeAudioLanes(flat.map(({ placement }) => ({
    layerId: placement.layerId, startSample: placement.timelineStartSample, endSample: placement.timelineEndSample,
  })));
  requireInterchange(expected.every((lane, i) => lane === flat[i]!.lane), "AUDIO_RANGE_INVALID", "external lanes differ from the frozen lane assignment");

  // Mastering metadata boundary.
  const m = t.mastering;
  if (m === null) {
    requireInterchange(pv.masteringRenderKey === null, "SERIALIZATION_INVALID", "mastering identity without mastering decisions");
  } else {
    requireInterchange((E7_MASTERING_MODES as readonly string[]).includes(m.mode), "UNSUPPORTED_EDITORIAL_SEMANTIC", `mastering mode ${m.mode} has no v1 classification`);
    const normalize = m.mode === "NORMALIZE_STATIC";
    requireInterchange((m.masteringRenderKey !== null) === normalize && (m.preMasterEvidenceSha256 !== null) === normalize &&
      m.masteringRenderKey === pv.masteringRenderKey && m.preMasterEvidenceSha256 === pv.preMasterEvidenceSha256 &&
      (m.policyId === null) === (m.policySha256 === null) && (!normalize || m.policySha256 !== null), "SERIALIZATION_INVALID",
    "mastering block nullness or identity is inconsistent");
  }
  return freezeEditorial(t);
}

// interchangeTimelineSha256 = SHA-256(canonicalEditorialJson(InterchangeTimelineV1)); domain = the embedded version literal.
export function hashInterchangeTimelineV1(input: unknown): string {
  return editorialSha256(canonicalEditorialJson(validateInterchangeTimelineV1(input)));
}
