import {
  z,
} from "zod";

import {
  EpisodeManifestSchema,
  SceneSchema,
  ShotSchema,
} from "../schemas/episodeManifest.schema.js";

import {
  ExecutionReservationProviderSchema,
} from "./executionReservation.schema.js";

import {
  VisualAttemptNumberSchema,
} from "./visualAttemptNumber.schema.js";

export const VisualAttemptQcDecisionSchema =
  z.enum([
    "APPROVED_FOR_PRODUCTION",
    "REJECTED_FOR_PRODUCTION",
  ]);

export const VisualAttemptQcAssessmentResultSchema =
  z.enum([
    "PASS",
    "FAIL",
  ]);

export const VisualAttemptQcReasonCodeSchema =
  z.string()
    .regex(
      /^[A-Z][A-Z0-9_]{1,63}$/,
      "Visual attempt QC reasonCode must be an uppercase controlled identifier.",
    );

export const VisualAttemptQcSha256Schema =
  z.string()
    .regex(
      /^[a-f0-9]{64}$/,
      "Expected a lowercase SHA-256 digest.",
    );

export const VisualAttemptQcInputSchema =
  z.object({
    episodeId:
      EpisodeManifestSchema.shape.episodeId,

    sceneId:
      SceneSchema.shape.id,

    shotId:
      ShotSchema.shape.id,

    attemptNumber:
      VisualAttemptNumberSchema,

    provider:
      ExecutionReservationProviderSchema,

    providerExecutionId:
      z.string()
        .trim()
        .min(
          1,
          "providerExecutionId is required.",
        ),

    lineage:
      z.object({
        completionSha256:
          VisualAttemptQcSha256Schema,

        generationRecordSha256:
          VisualAttemptQcSha256Schema,

        outputSha256:
          VisualAttemptQcSha256Schema,
      })
        .strict(),

    decision:
      VisualAttemptQcDecisionSchema,

    reasonCode:
      VisualAttemptQcReasonCodeSchema,

    assessment:
      z.object({
        visualIntegrity:
          VisualAttemptQcAssessmentResultSchema,

        littleleafValleyConsistency:
          VisualAttemptQcAssessmentResultSchema,

        motionCoherence:
          VisualAttemptQcAssessmentResultSchema,

        motionComment:
          z.string()
            .trim()
            .min(1),

        audioIntegrity:
          VisualAttemptQcAssessmentResultSchema,

        beginningEndIntegrity:
          VisualAttemptQcAssessmentResultSchema,

        overallUsability:
          VisualAttemptQcAssessmentResultSchema,

        overallUsabilityComment:
          z.string()
            .trim()
            .min(1),
      })
        .strict(),
  })
    .strict();

export const VisualAttemptQcSchema =
  VisualAttemptQcInputSchema
    .extend({
      schemaVersion:
        z.literal(
          "1.0",
        ),

      qcId:
        z.string()
          .uuid(),

      recordedAt:
        z.string()
          .datetime(),

      status:
        z.literal(
          "RECORDED",
        ),

      reviewer:
        z.literal(
          "HUMAN_OPERATOR",
        ),
    })
    .strict();

export type VisualAttemptQcInput =
  z.infer<
    typeof VisualAttemptQcInputSchema
  >;

export type VisualAttemptQc =
  z.infer<
    typeof VisualAttemptQcSchema
  >;
