import { z } from "zod";

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
  VisualReplacementAttemptNumberSchema,
} from "./visualAttemptNumber.schema.js";

const Sha256Schema =
  z.string()
    .regex(
      /^[a-f0-9]{64}$/,
      "Expected a lowercase SHA-256 digest.",
    );

export const VisualAttemptAdmissionSchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    admissionId:
      z.string()
        .uuid(),

    attemptNumber:
      VisualReplacementAttemptNumberSchema,

    admittedAt:
      z.string()
        .datetime(),

    status:
      z.literal(
        "ADMITTED",
      ),

    episodeId:
      EpisodeManifestSchema.shape.episodeId,

    sceneId:
      SceneSchema.shape.id,

    shotId:
      ShotSchema.shape.id,

    provider:
      ExecutionReservationProviderSchema,

    manifestRawSha256:
      Sha256Schema,

    promptIdentitySha256:
      Sha256Schema,

    referenceIdentitySha256:
      Sha256Schema,

    previousAttemptNumber:
      VisualAttemptNumberSchema,

    previousAttemptQcSha256:
      Sha256Schema,
  })
    .strict()
    .superRefine(
      (
        admission,
        ctx,
      ) => {
        const expectedPreviousAttemptNumber =
          admission.attemptNumber - 1;

        if (
          admission.previousAttemptNumber !==
          expectedPreviousAttemptNumber
        ) {
          ctx.addIssue({
            code:
              "custom",

            path:
              [
                "previousAttemptNumber",
              ],

            message:
              `Previous visual attempt number must be ${expectedPreviousAttemptNumber} for replacement attempt ${admission.attemptNumber}.`,
          });
        }
      },
    );

export type VisualAttemptAdmission =
  z.infer<
    typeof VisualAttemptAdmissionSchema
  >;
