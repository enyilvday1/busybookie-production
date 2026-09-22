import {
  z,
} from "zod";

import {
  VeoDurationSecondsSchema,
} from "../../schemas/veoPolicy.schema.js";

import {
  VEO31_FAST_MODEL,
  VEO_720P_RESOLUTION,
  VEO_IMAGE_MIME_TYPES,
  VEO_LANDSCAPE_ASPECT_RATIO,
} from "../veo.types.js";

export const VeoInlineImageSchema =
  z.object({
    imageBytes:
      z.string()
        .min(1),

    mimeType:
      z.enum(
        VEO_IMAGE_MIME_TYPES,
      ),
  })
    .strict();

export const VeoGenerateSourceSchema =
  z.object({
    prompt:
      z.string()
        .trim()
        .min(1),

    image:
      VeoInlineImageSchema
        .optional(),
  })
    .strict();

export const VeoGenerateRequestSchema =
  z.object({
    model:
      z.literal(
        VEO31_FAST_MODEL,
      ),

    source:
      VeoGenerateSourceSchema,

    config:
      z.object({
        numberOfVideos:
          z.literal(1),

        durationSeconds:
          VeoDurationSecondsSchema,

        aspectRatio:
          z.literal(
            VEO_LANDSCAPE_ASPECT_RATIO,
          ),

        resolution:
          z.literal(
            VEO_720P_RESOLUTION,
          ),
      })
        .strict(),
  })
    .strict();

export type VeoGenerateRequest =
  z.infer<
    typeof VeoGenerateRequestSchema
  >;
