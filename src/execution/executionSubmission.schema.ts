import {
  z,
} from "zod";

import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationProviderSchema,
  ExecutionReservationShotIdSchema,
} from "./executionReservation.schema.js";

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

export const ExecutionSubmissionSchema =
  z.discriminatedUnion(
    "schemaVersion",
    [
      ExecutionSubmissionV1Schema,
      RunwayExecutionSubmissionV1_1Schema,
      RunwayExecutionSubmissionV1_2Schema,
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
