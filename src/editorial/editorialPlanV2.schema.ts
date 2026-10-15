import { z } from "zod";
import { EpisodeManifestSchema, SceneSchema, ShotSchema } from "../schemas/episodeManifest.schema.js";
import {
  EditorialAssetSchema, EditorialAudioSchema, EditorialProfileSchema, type EditorialReadonly,
} from "./editorialPlan.schema.js";

// 29,700 distinct shot ids (2,700 two-digit + 27,000 three-digit forms) x 750 frames per shot.
export const EDITORIAL_PLAN_V2_MAX_TIMELINE_FRAMES = 22_275_000;
export const EDITORIAL_PLAN_V2_MAX_ASSET_FRAMES = 750;

const safeInteger = z.number().refine((n) => Number.isSafeInteger(n) && !Object.is(n, -0), "Expected a safe integer.");
const frame = safeInteger.refine((n) => n >= 0, "Expected a non-negative frame.");
const positiveFrames = safeInteger.refine((n) => n > 0, "Expected a positive frame count.");
const assetFrames = positiveFrames.refine((n) => n <= EDITORIAL_PLAN_V2_MAX_ASSET_FRAMES, "Expected at most 750 asset frames.");
const timelineFrames = positiveFrames.refine((n) => n <= EDITORIAL_PLAN_V2_MAX_TIMELINE_FRAMES,
  "Expected at most 22,275,000 timeline frames.");
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).refine((s) => s.trim().length > 0);
const shotId = ShotSchema.shape.id;
const assetId = EditorialAssetSchema.shape.assetId;
const videoClipId = z.string().regex(/^V1-S[0-9]{2,3}[A-Z]?$/);
const audioClipId = z.string().regex(/^A1-S[0-9]{2,3}[A-Z]?$/);

// assetDurationFrames is the nominal manifest-locked editorial length of the admitted normalized asset.
export const EditorialAssetV2Schema = z.object({
  ...EditorialAssetSchema.shape,
  assetDurationFrames: assetFrames,
}).strict();

export const EditorialTransitionV2Schema = z.discriminatedUnion("type", [
  z.object({ outgoingClipId: videoClipId, incomingClipId: videoClipId, type: z.literal("CUT") }).strict(),
  z.object({
    outgoingClipId: videoClipId, incomingClipId: videoClipId, type: z.literal("CROSS_DISSOLVE"),
    overlapFrames: positiveFrames,
  }).strict(),
]);

const clipRange = { shotId, assetId, sourceInFrame: frame, sourceOutFrame: frame, timelineStartFrame: frame };

export const EditorialPlanV2Schema = z.object({
  schemaVersion: z.literal("2.0"),
  planType: z.literal("BUSYBOOKIE_EDITORIAL_PLAN"),
  episode: z.object({ episodeId: EpisodeManifestSchema.shape.episodeId, title: text, manifestSha256: sha }).strict(),
  editorialDecisionsSha256: sha.nullable(),
  profile: EditorialProfileSchema,
  timelineDurationFrames: timelineFrames,
  shots: z.array(z.object({
    shotId, sceneId: SceneSchema.shape.id, order: positiveFrames, title: text, assetId,
  }).strict()).min(1),
  assets: z.array(EditorialAssetV2Schema).min(1),
  tracks: z.tuple([
    z.object({
      trackId: z.literal("V1"), kind: z.literal("VIDEO"),
      clips: z.array(z.object({ clipId: videoClipId, ...clipRange }).strict()).min(1),
    }).strict(),
    z.object({
      trackId: z.literal("A1"), kind: z.literal("SHOT_AUDIO"),
      clips: z.array(z.object({
        clipId: audioClipId, ...clipRange, linkedClipId: videoClipId, audio: EditorialAudioSchema,
      }).strict()).min(1),
    }).strict(),
  ]),
  transitions: z.array(EditorialTransitionV2Schema),
}).strict();

export type EditorialPlanV2 = EditorialReadonly<z.infer<typeof EditorialPlanV2Schema>>;
export type EditorialAssetV2 = EditorialPlanV2["assets"][number];
export type EditorialTransitionV2 = EditorialPlanV2["transitions"][number];
