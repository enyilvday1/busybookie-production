import {
  z,
} from "zod";

import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationShotIdSchema,
} from "./executionReservation.schema.js";

const ExecutionCompletionProviderSchema =
  z.enum([
    "RUNWAY",
    "VEO",
  ]);

export const ExecutionCompletionInputSchema =
  z.object({
    reservationId:
      z.string()
        .uuid(),

    episodeId:
      ExecutionReservationEpisodeIdSchema,

    shotId:
      ExecutionReservationShotIdSchema,

    provider:
      ExecutionCompletionProviderSchema,

    providerExecutionId:
      z.string()
        .trim()
        .min(
          1,
          "providerExecutionId is required.",
        ),

    generationRecordPath:
      z.string()
        .trim()
        .min(
          1,
          "generationRecordPath is required.",
        ),
  })
    .strict();

export const ExecutionCompletionSchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    completedAt:
      z.string()
        .datetime(),

    status:
      z.literal(
        "COMPLETED",
      ),

    reservationId:
      z.string()
        .uuid(),

    episodeId:
      ExecutionReservationEpisodeIdSchema,

    shotId:
      ExecutionReservationShotIdSchema,

    provider:
      ExecutionCompletionProviderSchema,

    providerExecutionId:
      z.string()
        .trim()
        .min(
          1,
          "providerExecutionId is required.",
        ),

    generationRecordPath:
      z.string()
        .trim()
        .min(
          1,
          "generationRecordPath is required.",
        ),
  })
    .strict();

export type ExecutionCompletionInput =
  z.infer<
    typeof ExecutionCompletionInputSchema
  >;

export type ExecutionCompletion =
  z.infer<
    typeof ExecutionCompletionSchema
  >;
