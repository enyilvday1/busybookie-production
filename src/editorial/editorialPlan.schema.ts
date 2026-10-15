import { z } from "zod";
import { EpisodeManifestSchema, SceneSchema, ShotSchema } from "../schemas/episodeManifest.schema.js";

const finite = z.number().finite().refine((n) => !Object.is(n, -0), "Negative zero is not canonical.");
const integer = finite.refine(Number.isSafeInteger, "Expected a safe integer.");
const positiveInteger = integer.refine((n) => n > 0);
const frame = integer.refine((n) => n >= 0);
const duration = positiveInteger.refine((n) => n <= 750);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).refine((s) => s.trim().length > 0);
const episodeId = EpisodeManifestSchema.shape.episodeId;
const shotId = ShotSchema.shape.id;
const assetId = z.string().regex(/^normalized:EP[0-9]{2,3}:S[0-9]{2,3}[A-Z]?$/);

export const EditorialProfileSchema = z.object({
  profileId: z.literal("busybookie-master-v1"), aspectRatio: z.literal("16:9"),
  width: z.literal(1920), height: z.literal(1080),
  frameRate: z.object({ numerator: z.literal(25), denominator: z.literal(1) }).strict(),
  audioSampleRateHz: z.literal(48000), audioChannels: z.literal(2), audioChannelLayout: z.literal("stereo"),
}).strict();

export const EditorialNormalizationSchema = z.discriminatedUnion("schemaVersion", [
  z.object({ schemaVersion: z.literal("1.0"), profileId: z.literal("busybookie-master-normalization-v1"), cacheKey: sha }).strict(),
  z.object({ schemaVersion: z.literal("2.0"), profileId: z.literal("busybookie-master-normalization-v2-dialogue"), cacheKey: sha }).strict(),
]);

export const EditorialAssetSchema = z.object({
  assetId, kind: z.literal("NORMALIZED_SHOT"), sha256: sha, bytes: positiveInteger,
  contentType: z.literal("video/mp4"),
  mediaRootRelativePath: z.string().regex(/^cache\/composition-normalized\/EP[0-9]{2,3}\/S[0-9]{2,3}[A-Z]?\/EP[0-9]{2,3}_S[0-9]{2,3}[A-Z]?_[a-f0-9]{64}\.mp4$/),
  normalization: EditorialNormalizationSchema,
  generatedSource: z.object({
    provider: z.enum(["RUNWAY", "VEO"]), providerExecutionId: text, sourceSha256: sha,
    sourceBytes: positiveInteger, sourceContentType: text.nullable(),
  }).strict(),
}).strict();

const dialogueLine = z.object({
  lineNumber: positiveInteger,
  dialogueLineId: z.string().regex(/^EP[0-9]{2,3}_SC[0-9]{2,3}_S[0-9]{2,3}[A-Z]?_L[0-9]{2,3}$/),
  sourceSha256: sha, sourceBytes: positiveInteger,
  startSeconds: finite.refine((n) => n >= 0), durationSeconds: finite.refine((n) => n > 0),
}).strict();

export const EditorialAudioSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("PRESERVE_NATIVE") }).strict(),
  z.object({ mode: z.literal("SYNTHETIC_SILENCE") }).strict(),
  z.object({
    mode: z.literal("REPLACE_SOURCE_WITH_DIALOGUE"),
    sourceAudioDisposition: z.enum(["DISCARD_NATIVE_AUDIO", "NO_SOURCE_AUDIO"]),
    dialoguePlanKey: sha, audioKey: sha, lines: z.array(dialogueLine).min(1),
  }).strict(),
]);

const clip = {
  shotId, assetId, timelineStartFrame: frame, durationFrames: duration,
  sourceInFrame: frame, sourceOutFrame: frame,
};
export const EditorialPlanSchema = z.object({
  schemaVersion: z.literal("1.0"), planType: z.literal("BUSYBOOKIE_EDITORIAL_PLAN"),
  episode: z.object({ episodeId, title: text, manifestSha256: sha }).strict(),
  profile: EditorialProfileSchema, assemblyMode: z.literal("STRAIGHT_CUT"), durationFrames: positiveInteger,
  shots: z.array(z.object({
    shotId, sceneId: SceneSchema.shape.id, order: positiveInteger, title: text, durationFrames: duration, assetId,
  }).strict()).min(1),
  assets: z.array(EditorialAssetSchema).min(1),
  tracks: z.tuple([
    z.object({ trackId: z.literal("V1"), kind: z.literal("VIDEO"), clips: z.array(z.object({
      ...clip, clipId: z.string().regex(/^V1-S[0-9]{2,3}[A-Z]?$/),
    }).strict()).min(1) }).strict(),
    z.object({ trackId: z.literal("A1"), kind: z.literal("SHOT_AUDIO"), clips: z.array(z.object({
      ...clip, clipId: z.string().regex(/^A1-S[0-9]{2,3}[A-Z]?$/),
      linkedClipId: z.string().regex(/^V1-S[0-9]{2,3}[A-Z]?$/), audio: EditorialAudioSchema,
    }).strict()).min(1) }).strict(),
  ]),
}).strict();

export type EditorialReadonly<T> = T extends object ? { readonly [K in keyof T]: EditorialReadonly<T[K]> } : T;
export type EditorialPlan = EditorialReadonly<z.infer<typeof EditorialPlanSchema>>;
export type EditorialAsset = EditorialPlan["assets"][number];
