import { z } from "zod";
import type { EditorialReadonly } from "./editorialPlan.schema.js";
import {
  AudioLayerPlacementV1Schema, AudioMixBedSchema, E4_MAX_EXTERNAL_AUDIO_ASSETS, E4_MAX_LAYER_PLACEMENTS,
  ExternalAudioAssetV1Schema,
} from "./editorialPlanV3.schema.js";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const asset = ExternalAudioAssetV1Schema.shape;

// Every admitted technical field of a referenced logical asset; the locator is location, not interpretation.
export const ExternalAudioBindingV1Schema = z.object({
  assetId: asset.assetId, sha256: asset.sha256, bytes: asset.bytes, contentType: asset.contentType,
  codec: asset.codec, sampleFormat: asset.sampleFormat, sampleRateHz: asset.sampleRateHz,
  channelCount: asset.channelCount, assetDurationSamples: asset.assetDurationSamples,
}).strict();

// Mix intent bound to the exact base plan revision and the referenced asset closure; no runtime state.
export const AudioMixDecisionsSchema = z.object({
  schemaVersion: z.literal("1.0"),
  decisionsType: z.literal("BUSYBOOKIE_AUDIO_MIX_DECISIONS"),
  sourceBinding: z.object({
    baseEditorialPlanSha256: sha,
    externalAudioAssets: z.array(ExternalAudioBindingV1Schema).max(E4_MAX_EXTERNAL_AUDIO_ASSETS),
  }).strict(),
  bed: AudioMixBedSchema,
  layers: z.array(AudioLayerPlacementV1Schema).max(E4_MAX_LAYER_PLACEMENTS),
}).strict();

export type ExternalAudioBindingV1 = EditorialReadonly<z.infer<typeof ExternalAudioBindingV1Schema>>;
export type AudioMixDecisions = EditorialReadonly<z.infer<typeof AudioMixDecisionsSchema>>;
