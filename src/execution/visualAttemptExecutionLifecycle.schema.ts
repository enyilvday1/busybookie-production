import {
  z,
} from "zod";

import {
  SceneSchema,
} from "../schemas/episodeManifest.schema.js";

import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationProviderSchema,
  ExecutionReservationShotIdSchema,
} from "./executionReservation.schema.js";

import {
  GoogleGenAiExecutionSubmissionV1_4Schema,
} from "./executionSubmission.schema.js";

import {
  VisualReplacementAttemptNumberSchema,
} from "./visualAttemptNumber.schema.js";

export const VisualAttemptExecutionSha256Schema =
  z.string()
    .regex(
      /^[a-f0-9]{64}$/,
      "Expected a lowercase SHA-256 digest.",
    );

const VisualAttemptExecutionIdentityShape = {
  episodeId:
    ExecutionReservationEpisodeIdSchema,

  sceneId:
    SceneSchema.shape.id,

  shotId:
    ExecutionReservationShotIdSchema,

  attemptNumber:
    VisualReplacementAttemptNumberSchema,

  admissionId:
    z.string()
      .uuid(),

  admissionSha256:
    VisualAttemptExecutionSha256Schema,
} as const;

/**
 * The existing durable provider submission schema is the canonical owner of
 * the provider-specific submission and recovery-metadata contract.
 *
 * Reusing its named field schemas keeps replacement-attempt evidence aligned
 * with that durable contract without duplicating provider-foundation authority
 * or depending on discriminated-union member ordering.
 */
const ApprovedProviderSubmissionSchema =
  GoogleGenAiExecutionSubmissionV1_4Schema;

export const VisualAttemptGoogleGenAiRecoveryMetadataSchema =
  ApprovedProviderSubmissionSchema
    .shape
    .recoveryMetadata;

export const VisualAttemptExecutionReservationSchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    reservationId:
      z.string()
        .uuid(),

    reservedAt:
      z.string()
        .datetime(),

    status:
      z.literal(
        "RESERVED",
      ),

    ...VisualAttemptExecutionIdentityShape,

    provider:
      ExecutionReservationProviderSchema,
  })
    .strict();

export const VisualAttemptGoogleGenAiExecutionSubmissionSchema =
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

    reservationSha256:
      VisualAttemptExecutionSha256Schema,

    ...VisualAttemptExecutionIdentityShape,

    provider:
      ApprovedProviderSubmissionSchema
        .shape
        .provider,

    providerExecutionId:
      ApprovedProviderSubmissionSchema
        .shape
        .providerExecutionId,

    recoveryMetadata:
      VisualAttemptGoogleGenAiRecoveryMetadataSchema,
  })
    .strict();

export const VisualAttemptGoogleGenAiExecutionCompletionSchema =
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

    reservationSha256:
      VisualAttemptExecutionSha256Schema,

    submissionSha256:
      VisualAttemptExecutionSha256Schema,

    ...VisualAttemptExecutionIdentityShape,

    provider:
      ApprovedProviderSubmissionSchema
        .shape
        .provider,

    providerExecutionId:
      ApprovedProviderSubmissionSchema
        .shape
        .providerExecutionId,

    generationRecordPath:
      z.string()
        .trim()
        .min(
          1,
          "generationRecordPath is required.",
        ),

    generationRecordSha256:
      VisualAttemptExecutionSha256Schema,
  })
    .strict();

export type VisualAttemptExecutionReservation =
  z.infer<
    typeof VisualAttemptExecutionReservationSchema
  >;

export type VisualAttemptGoogleGenAiExecutionSubmission =
  z.infer<
    typeof VisualAttemptGoogleGenAiExecutionSubmissionSchema
  >;

export type VisualAttemptGoogleGenAiExecutionCompletion =
  z.infer<
    typeof VisualAttemptGoogleGenAiExecutionCompletionSchema
  >;
