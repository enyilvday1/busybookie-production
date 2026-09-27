import {
  z,
} from "zod";

import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationProviderSchema,
  ExecutionReservationShotIdSchema,
} from "./executionReservation.schema.js";

import {
  VeoDurationSecondsSchema,
} from "../schemas/veoPolicy.schema.js";

import {
  VEO_720P_RESOLUTION,
  VEO_EXPECTED_OUTPUT_FPS,
  VEO_IMAGE_MIME_TYPES,
  VEO_LANDSCAPE_ASPECT_RATIO,
} from "../veo/veo.types.js";

const ExecutionSubmissionReservationIdSchema =
  z.string()
    .uuid();

const ExecutionSubmissionProviderExecutionIdSchema =
  z.string()
    .trim()
    .min(
      1,
      "providerExecutionId is required.",
    );

const ProviderEstimatedCreditsSchema =
  z.number()
    .int()
    .nonnegative();

const RunwayRecoveryMetadataSchema =
  z.object({
    request:
      z.object({
        durationSeconds:
          z.number()
            .int()
            .min(2)
            .max(10),

        ratio:
          z.literal(
            "1280:720",
          ),

        outputFormat:
          z.literal(
            "mp4",
          ),

        promptText:
          z.string()
            .trim()
            .min(1)
            .max(1000),

        sourceImagePath:
          z.string()
            .trim()
            .min(1),

        assetStrategy:
          z.enum([
            "DATA_URI",
            "EPHEMERAL_UPLOAD",
          ]),
      })
        .strict(),

    locallyExpectedCredits:
      z.number()
        .int()
        .nonnegative(),
  })
    .strict();

const VeoRecoveryMetadataSchema =
  z.object({
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

        nativeAudioExpected:
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
              "pricingReviewedOn must use YYYY-MM-DD.",
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
  })
    .strict();

const RunwayExecutionSubmissionInputSchema =
  z.object({
    reservationId:
      ExecutionSubmissionReservationIdSchema,

    episodeId:
      ExecutionReservationEpisodeIdSchema,

    shotId:
      ExecutionReservationShotIdSchema,

    provider:
      z.literal(
        "RUNWAY",
      ),

    providerExecutionId:
      ExecutionSubmissionProviderExecutionIdSchema,

    providerEstimatedCredits:
      ProviderEstimatedCreditsSchema,

    recoveryMetadata:
      RunwayRecoveryMetadataSchema,
  })
    .strict();

const VeoExecutionSubmissionInputSchema =
  z.object({
    reservationId:
      ExecutionSubmissionReservationIdSchema,

    episodeId:
      ExecutionReservationEpisodeIdSchema,

    shotId:
      ExecutionReservationShotIdSchema,

    provider:
      z.literal(
        "VEO",
      ),

    providerExecutionId:
      ExecutionSubmissionProviderExecutionIdSchema,

    recoveryMetadata:
      VeoRecoveryMetadataSchema,
  })
    .strict();

export const ExecutionSubmissionInputSchema =
  z.discriminatedUnion(
    "provider",
    [
      RunwayExecutionSubmissionInputSchema,
      VeoExecutionSubmissionInputSchema,
    ],
  );

const ExecutionSubmissionV1Schema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    submittedAt:
      z.string()
        .datetime(),

    status:
      z.literal(
        "SUBMITTED",
      ),

    reservationId:
      ExecutionSubmissionReservationIdSchema,

    episodeId:
      ExecutionReservationEpisodeIdSchema,

    shotId:
      ExecutionReservationShotIdSchema,

    provider:
      ExecutionReservationProviderSchema,

    providerExecutionId:
      ExecutionSubmissionProviderExecutionIdSchema,
  })
    .strict();

const RunwayExecutionSubmissionV1_1Schema =
  z.object({
    schemaVersion:
      z.literal(
        "1.1",
      ),

    submittedAt:
      z.string()
        .datetime(),

    status:
      z.literal(
        "SUBMITTED",
      ),

    reservationId:
      ExecutionSubmissionReservationIdSchema,

    episodeId:
      ExecutionReservationEpisodeIdSchema,

    shotId:
      ExecutionReservationShotIdSchema,

    provider:
      z.literal(
        "RUNWAY",
      ),

    providerExecutionId:
      ExecutionSubmissionProviderExecutionIdSchema,

    providerEstimatedCredits:
      ProviderEstimatedCreditsSchema,
  })
    .strict();

const RunwayExecutionSubmissionV1_2Schema =
  z.object({
    schemaVersion:
      z.literal(
        "1.2",
      ),

    submittedAt:
      z.string()
        .datetime(),

    status:
      z.literal(
        "SUBMITTED",
      ),

    reservationId:
      ExecutionSubmissionReservationIdSchema,

    episodeId:
      ExecutionReservationEpisodeIdSchema,

    shotId:
      ExecutionReservationShotIdSchema,

    provider:
      z.literal(
        "RUNWAY",
      ),

    providerExecutionId:
      ExecutionSubmissionProviderExecutionIdSchema,

    providerEstimatedCredits:
      ProviderEstimatedCreditsSchema,

    recoveryMetadata:
      RunwayRecoveryMetadataSchema,
  })
    .strict();

const VeoExecutionSubmissionV1_3Schema =
  z.object({
    schemaVersion:
      z.literal(
        "1.3",
      ),

    submittedAt:
      z.string()
        .datetime(),

    status:
      z.literal(
        "SUBMITTED",
      ),

    reservationId:
      ExecutionSubmissionReservationIdSchema,

    episodeId:
      ExecutionReservationEpisodeIdSchema,

    shotId:
      ExecutionReservationShotIdSchema,

    provider:
      z.literal(
        "VEO",
      ),

    providerExecutionId:
      ExecutionSubmissionProviderExecutionIdSchema,

    recoveryMetadata:
      VeoRecoveryMetadataSchema,
  })
    .strict();

export const ExecutionSubmissionSchema =
  z.discriminatedUnion(
    "schemaVersion",
    [
      ExecutionSubmissionV1Schema,
      RunwayExecutionSubmissionV1_1Schema,
      RunwayExecutionSubmissionV1_2Schema,
      VeoExecutionSubmissionV1_3Schema,
    ],
  );

export type ExecutionSubmissionInput =
  z.infer<
    typeof ExecutionSubmissionInputSchema
  >;

export type ExecutionSubmission =
  z.infer<
    typeof ExecutionSubmissionSchema
  >;
