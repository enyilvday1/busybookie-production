import {
  z,
} from "zod";

import {
  VeoDurationSecondsSchema,
} from "../../schemas/veoPolicy.schema.js";

import {
  VEO31_FAST_MODEL,
  VEO_720P_RESOLUTION,
  VEO_EXPECTED_OUTPUT_FPS,
  VEO_IMAGE_MIME_TYPES,
  VEO_LANDSCAPE_ASPECT_RATIO,
} from "../veo.types.js";

export const VeoGenerationOutputRecordSchema =
  z.object({
    outputIndex:
      z.number()
        .int()
        .positive(),

    destinationPath:
      z.string()
        .trim()
        .min(1),

    bytes:
      z.number()
        .int()
        .positive(),

    sha256:
      z.string()
        .regex(
          /^[a-f0-9]{64}$/,
          "sha256 must be a lowercase 64-character hexadecimal digest.",
        ),

    contentType:
      z.string()
        .trim()
        .min(1)
        .nullable(),
  })
    .strict();

export const VeoGenerationRecordSchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    recordedAt:
      z.string()
        .datetime(),

    provider:
      z.literal(
        "VEO",
      ),

    model:
      z.literal(
        VEO31_FAST_MODEL,
      ),

    status:
      z.literal(
        "SUCCEEDED",
      ),

    episodeId:
      z.string()
        .regex(
          /^EP[0-9]{2,3}$/,
        ),

    shotId:
      z.string()
        .regex(
          /^S[0-9]{2,3}[A-Z]?$/,
        ),

    operationName:
      z.string()
        .trim()
        .min(1),

    request:
      z.object({
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

        numberOfVideos:
          z.literal(1),

        generateAudio:
          z.literal(true),

        expectedOutputFps:
          z.literal(
            VEO_EXPECTED_OUTPUT_FPS,
          ),

        promptText:
          z.string()
            .trim()
            .min(1),

        sourceImagePath:
          z.string()
            .trim()
            .min(1),

        imageMimeType:
          z.enum(
            VEO_IMAGE_MIME_TYPES,
          ),
      })
        .strict(),

    costPolicy:
      z.object({
        pricingReviewedOn:
          z.string()
            .regex(
              /^\d{4}-\d{2}-\d{2}$/,
            ),

        centsPerSecond:
          z.number()
            .int()
            .positive(),

        locallyExpectedCents:
          z.number()
            .int()
            .nonnegative(),
      })
        .strict(),

    safety:
      z.object({
        raiMediaFilteredCount:
          z.number()
            .int()
            .nonnegative(),

        raiMediaFilteredReasons:
          z.array(
            z.string(),
          ),
      })
        .strict(),

    outputs:
      z.array(
        VeoGenerationOutputRecordSchema,
      )
        .min(1),
  })
    .strict();

export type VeoGenerationRecord =
  z.infer<
    typeof VeoGenerationRecordSchema
  >;
