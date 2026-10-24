import {
  z,
} from "zod";

import {
  GOOGLE_GENAI_PROVIDER,
} from "../googleGenai/googleGenAi.types.js";

import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationShotIdSchema,
} from "./executionReservation.schema.js";

/**
 * Google GenAI execution completion 1.1.
 *
 * Stored at the shared canonical execution-completion path but validated by
 * this Google-specific schema; the shared completion 1.0 schema stays
 * RUNWAY | VEO and rejects this document. Output evidence lives only in the
 * Google generation record referenced by generationRecordPath.
 */

export const GOOGLE_GENAI_EXECUTION_COMPLETION_SCHEMA_VERSION =
  "1.1" as const;

export const GoogleGenAiExecutionCompletionSchema =
  z.object({
    schemaVersion:
      z.literal(
        GOOGLE_GENAI_EXECUTION_COMPLETION_SCHEMA_VERSION,
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
      z.literal(
        GOOGLE_GENAI_PROVIDER,
      ),

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

export type GoogleGenAiExecutionCompletion =
  z.infer<
    typeof GoogleGenAiExecutionCompletionSchema
  >;
