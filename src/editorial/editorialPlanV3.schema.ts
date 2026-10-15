import { z } from "zod";
import type { EditorialReadonly } from "./editorialPlan.schema.js";
import { EditorialPlanV2Schema } from "./editorialPlanV2.schema.js";

// E4 v1 canonical bounds (Step 1066 COMPLEXITY_BOUNDS).
export const E4_MAX_EXTERNAL_AUDIO_ASSETS = 64;
export const E4_MAX_LAYER_PLACEMENTS = 128;
export const E4_MAX_CONCURRENT_EXTERNAL_LAYERS = 32;
export const E4_MAX_EXTERNAL_AUDIO_BYTES = 4_294_967_295;
export const E4_MIN_GAIN_CENTI_DB = -9_600;
export const E4_MAX_GAIN_CENTI_DB = 1_200;

const safeInteger = z.number().refine((n) => Number.isSafeInteger(n) && !Object.is(n, -0), "Expected a safe integer.");
const sample = safeInteger.refine((n) => n >= 0, "Expected a non-negative sample count.");
const positiveSamples = safeInteger.refine((n) => n >= 1, "Expected a positive sample count.");
const fadeSamples = sample.refine((n) => n === 0 || n >= 2, "Fades are 0 or at least 2 samples.");
const gain = safeInteger.refine((n) => n >= E4_MIN_GAIN_CENTI_DB && n <= E4_MAX_GAIN_CENTI_DB,
  "Expected gain in -9600..1200 centi-dB.");
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const slug = "[a-z0-9]+(?:-[a-z0-9]+)*";

export const ExternalAudioAssetIdSchema = z.string().max(70).regex(new RegExp(`^audio:${slug}$`));
export const AudioLayerIdSchema = z.string().max(70).regex(new RegExp(`^layer:${slug}$`));
const segment = "[a-z0-9]+(?:[._-][a-z0-9]+)*";
export const ExternalAudioLocatorSchema = z.string().max(512)
  .regex(new RegExp(`^(music|sfx|ambience)/(${segment}/){0,6}${segment}\\.wav$`));

// Admitted classic RIFF/WAVE pcm_s16le asset (no transcoding inside E4). The locator prefix is location only.
export const ExternalAudioAssetV1Schema = z.object({
  assetId: ExternalAudioAssetIdSchema,
  kind: z.literal("EXTERNAL_AUDIO"),
  sha256: sha,
  bytes: positiveSamples.refine((n) => n <= E4_MAX_EXTERNAL_AUDIO_BYTES, "Expected at most 4294967295 bytes."),
  mediaRootRelativePath: ExternalAudioLocatorSchema,
  contentType: z.literal("audio/wav"),
  codec: z.literal("pcm_s16le"),
  sampleFormat: z.literal("s16"),
  sampleRateHz: z.literal(48000),
  channelCount: z.union([z.literal(1), z.literal(2)]),
  assetDurationSamples: positiveSamples,
}).strict();

export const AudioLayerRoleSchema = z.enum(["MUSIC", "SFX", "AMBIENCE", "OTHER"]);

// Half-open source range [sourceInSample, sourceOutSample) placed at an absolute timeline sample.
export const AudioLayerPlacementV1Schema = z.object({
  layerId: AudioLayerIdSchema,
  role: AudioLayerRoleSchema,
  assetId: ExternalAudioAssetIdSchema,
  sourceInSample: sample,
  sourceOutSample: positiveSamples,
  timelineStartSample: sample,
  gainCentiDb: gain,
  muted: z.boolean(),
  fadeInSamples: fadeSamples,
  fadeOutSamples: fadeSamples,
}).strict();

export const AudioMixBedSchema = z.object({ bedGainCentiDb: gain, bedMuted: z.boolean() }).strict();

export const EditorialPlanV3Schema = z.object({
  planType: z.literal("BUSYBOOKIE_EDITORIAL_PLAN"),
  schemaVersion: z.literal("3.0"),
  basePlan: EditorialPlanV2Schema,
  audioMixDecisionsSha256: sha.nullable(),
  audioMix: z.object({
    bed: AudioMixBedSchema,
    externalAudioAssets: z.array(ExternalAudioAssetV1Schema).max(E4_MAX_EXTERNAL_AUDIO_ASSETS),
    layers: z.array(AudioLayerPlacementV1Schema).max(E4_MAX_LAYER_PLACEMENTS),
  }).strict(),
}).strict();

export type ExternalAudioAssetV1 = EditorialReadonly<z.infer<typeof ExternalAudioAssetV1Schema>>;
export type AudioLayerPlacementV1 = EditorialReadonly<z.infer<typeof AudioLayerPlacementV1Schema>>;
export type AudioMixBed = EditorialReadonly<z.infer<typeof AudioMixBedSchema>>;
export type EditorialPlanV3 = EditorialReadonly<z.infer<typeof EditorialPlanV3Schema>>;
export type EditorialAudioMix = EditorialPlanV3["audioMix"];
