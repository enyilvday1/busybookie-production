import {
  z,
} from "zod";

import {
  GoogleGenAiExecutionSubmissionV1_4Schema,
} from "./executionSubmission.schema.js";

import {
  VisualAttemptGoogleGenAiExecutionSubmissionSchema,
} from "./visualAttemptExecutionLifecycle.schema.js";

const GoogleGenAiProviderExecutionClaimSha256Schema =
  z.string()
    .regex(
      /^[0-9a-f]{64}$/,
      "Google GenAI provider execution claim SHA-256 must be lowercase 64-character hexadecimal.",
    );

const GoogleGenAiProviderExecutionClaimPathSchema =
  z.string()
    .trim()
    .min(
      1,
      "Google GenAI provider execution claim submissionPath is required.",
    );

const CommonClaimShape = {
  schemaVersion:
    z.literal(
      "1.0",
    ),

  claimedAt:
    z.string()
      .datetime(),

  provider:
    GoogleGenAiExecutionSubmissionV1_4Schema
      .shape
      .provider,

  providerExecutionId:
    GoogleGenAiExecutionSubmissionV1_4Schema
      .shape
      .providerExecutionId,

  providerExecutionIdSha256:
    GoogleGenAiProviderExecutionClaimSha256Schema,

  episodeId:
    GoogleGenAiExecutionSubmissionV1_4Schema
      .shape
      .episodeId,

  shotId:
    GoogleGenAiExecutionSubmissionV1_4Schema
      .shape
      .shotId,

  reservationId:
    GoogleGenAiExecutionSubmissionV1_4Schema
      .shape
      .reservationId,

  submissionPath:
    GoogleGenAiProviderExecutionClaimPathSchema,
} as const;

export const GoogleGenAiLegacyProviderExecutionClaimSchema =
  z.object({
    ...CommonClaimShape,

    lifecycleMode:
      z.literal(
        "LEGACY",
      ),
  })
    .strict();

export const GoogleGenAiVisualAttemptProviderExecutionClaimSchema =
  z.object({
    ...CommonClaimShape,

    lifecycleMode:
      z.literal(
        "VISUAL_ATTEMPT",
      ),

    sceneId:
      VisualAttemptGoogleGenAiExecutionSubmissionSchema
        .shape
        .sceneId,

    attemptNumber:
      VisualAttemptGoogleGenAiExecutionSubmissionSchema
        .shape
        .attemptNumber,

    admissionId:
      VisualAttemptGoogleGenAiExecutionSubmissionSchema
        .shape
        .admissionId,

    admissionSha256:
      VisualAttemptGoogleGenAiExecutionSubmissionSchema
        .shape
        .admissionSha256,

    reservationSha256:
      VisualAttemptGoogleGenAiExecutionSubmissionSchema
        .shape
        .reservationSha256,
  })
    .strict();

export const GoogleGenAiProviderExecutionClaimSchema =
  z.discriminatedUnion(
    "lifecycleMode",
    [
      GoogleGenAiLegacyProviderExecutionClaimSchema,
      GoogleGenAiVisualAttemptProviderExecutionClaimSchema,
    ],
  );

export type GoogleGenAiLegacyProviderExecutionClaim =
  z.infer<
    typeof GoogleGenAiLegacyProviderExecutionClaimSchema
  >;

export type GoogleGenAiVisualAttemptProviderExecutionClaim =
  z.infer<
    typeof GoogleGenAiVisualAttemptProviderExecutionClaimSchema
  >;

export type GoogleGenAiProviderExecutionClaim =
  z.infer<
    typeof GoogleGenAiProviderExecutionClaimSchema
  >;
