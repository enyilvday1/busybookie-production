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

export const ExecutionSubmissionSchema =
  z.discriminatedUnion(
    "schemaVersion",
    [
      ExecutionSubmissionV1Schema,
      RunwayExecutionSubmissionV1_1Schema,
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
