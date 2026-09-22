import {
  z,
} from "zod";

import {
  VEO31_FAST_MODEL,
  VEO_720P_RESOLUTION,
  VEO_EXPECTED_OUTPUT_FPS,
  VEO_LANDSCAPE_ASPECT_RATIO,
} from "../veo/veo.types.js";

export const VeoDurationSecondsSchema =
  z.union([
    z.literal(4),
    z.literal(6),
    z.literal(8),
  ]);

export const VeoPolicySchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    pricingReviewedOn:
      z.string()
        .regex(
          /^\d{4}-\d{2}-\d{2}$/,
          "pricingReviewedOn must use YYYY-MM-DD.",
        ),

    generation:
      z.object({
        model:
          z.literal(
            VEO31_FAST_MODEL,
          ),

        centsPerSecond:
          z.number()
            .int()
            .positive(),

        maxCentsPerGeneration:
          z.number()
            .int()
            .positive(),

        allowedDurationsSeconds:
          z.array(
            VeoDurationSecondsSchema,
          )
            .min(1),

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

        nativeAudioExpected:
          z.literal(true),

        expectedOutputFps:
          z.literal(
            VEO_EXPECTED_OUTPUT_FPS,
          ),

        maxImageBytes:
          z.number()
            .int()
            .positive(),
      })
        .strict(),

    operation:
      z.object({
        pollIntervalMs:
          z.number()
            .int()
            .positive(),

        timeoutMs:
          z.number()
            .int()
            .positive(),
      })
        .strict(),
  })
    .strict()
    .superRefine(
      (
        policy,
        context,
      ) => {
        const durations =
          policy.generation
            .allowedDurationsSeconds;

        if (
          new Set(
            durations,
          ).size !==
          durations.length
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "generation",
              "allowedDurationsSeconds",
            ],
            message:
              "Veo allowed durations must be unique.",
          });
        }

        const maximumDuration =
          Math.max(
            ...durations,
          );

        const maximumExpectedCost =
          maximumDuration *
          policy.generation
            .centsPerSecond;

        if (
          maximumExpectedCost >
          policy.generation
            .maxCentsPerGeneration
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "generation",
              "maxCentsPerGeneration",
            ],
            message:
              "Veo policy allows a duration whose expected cost exceeds the configured generation ceiling.",
          });
        }

        if (
          policy.operation
            .timeoutMs <=
          policy.operation
            .pollIntervalMs
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "operation",
              "timeoutMs",
            ],
            message:
              "Veo operation timeout must exceed the polling interval.",
          });
        }
      },
    );

export type VeoPolicy =
  z.infer<
    typeof VeoPolicySchema
  >;
