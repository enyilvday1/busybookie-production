import {
  isAbsolute,
} from "node:path";

import {
  z,
} from "zod";

import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationShotIdSchema,
} from "../../execution/executionReservation.schema.js";

import {
  GOOGLE_GENAI_PROVIDER,
} from "../googleGenAi.types.js";

/**
 * Google GenAI generation record: durable output evidence only.
 *
 * Request and recovery material (prompt, source image, policy snapshot,
 * request flags) stays in the durable execution submission 1.4 and must
 * never be copied here.
 */

export const GOOGLE_GENAI_GENERATION_RECORD_SCHEMA_VERSION =
  "1.0" as const;

export const GOOGLE_GENAI_GENERATION_OUTPUT_CONTENT_TYPE =
  "video/mp4" as const;

export const GoogleGenAiGenerationOutputRecordSchema =
  z.object({
    outputIndex:
      z.literal(1),

    destinationPath:
      z.string()
        .trim()
        .min(1)
        .refine(
          (path) =>
            isAbsolute(
              path,
            ),
          "destinationPath must be absolute.",
        ),

    bytes:
      z.number()
        .int()
        .positive()
        .refine(
          Number.isSafeInteger,
          "bytes must be a safe integer.",
        ),

    sha256:
      z.string()
        .regex(
          /^[a-f0-9]{64}$/,
          "sha256 must be a lowercase 64-character hexadecimal digest.",
        ),

    contentType:
      z.literal(
        GOOGLE_GENAI_GENERATION_OUTPUT_CONTENT_TYPE,
      ),
  })
    .strict();

export const GoogleGenAiGenerationRecordSchema =
  z.object({
    schemaVersion:
      z.literal(
        GOOGLE_GENAI_GENERATION_RECORD_SCHEMA_VERSION,
      ),

    recordedAt:
      z.string()
        .datetime(),

    reservationId:
      z.string()
        .uuid(),

    provider:
      z.literal(
        GOOGLE_GENAI_PROVIDER,
      ),

    episodeId:
      ExecutionReservationEpisodeIdSchema,

    shotId:
      ExecutionReservationShotIdSchema,

    providerExecutionId:
      z.string()
        .trim()
        .min(
          1,
          "providerExecutionId is required.",
        ),

    outputs:
      z.tuple([
        GoogleGenAiGenerationOutputRecordSchema,
      ]),
  })
    .strict();

export type GoogleGenAiGenerationOutputRecord =
  z.infer<
    typeof GoogleGenAiGenerationOutputRecordSchema
  >;

export type GoogleGenAiGenerationRecord =
  z.infer<
    typeof GoogleGenAiGenerationRecordSchema
  >;
