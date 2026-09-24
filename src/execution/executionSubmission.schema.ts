import {
  z,
} from "zod";

import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationProviderSchema,
  ExecutionReservationShotIdSchema,
} from "./executionReservation.schema.js";

export const ExecutionSubmissionInputSchema =
  z.object({
    reservationId:
      z.string()
        .uuid(),

    episodeId:
      ExecutionReservationEpisodeIdSchema,

    shotId:
      ExecutionReservationShotIdSchema,

    provider:
      ExecutionReservationProviderSchema,

    providerExecutionId:
      z.string()
        .trim()
        .min(
          1,
          "providerExecutionId is required.",
        ),
  })
    .strict();

export const ExecutionSubmissionSchema =
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
      z.string()
        .uuid(),

    episodeId:
      ExecutionReservationEpisodeIdSchema,

    shotId:
      ExecutionReservationShotIdSchema,

    provider:
      ExecutionReservationProviderSchema,

    providerExecutionId:
      z.string()
        .trim()
        .min(
          1,
          "providerExecutionId is required.",
        ),
  })
    .strict();

export type ExecutionSubmissionInput =
  z.infer<
    typeof ExecutionSubmissionInputSchema
  >;

export type ExecutionSubmission =
  z.infer<
    typeof ExecutionSubmissionSchema
  >;
