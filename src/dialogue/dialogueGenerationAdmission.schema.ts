import {
  z,
} from "zod";

import {
  DialogueReservationEpisodeIdSchema,
  DialogueReservationLineIdSchema,
  DialogueReservationPlanKeySchema,
  DialogueReservationProviderSchema,
  DialogueReservationSceneIdSchema,
  DialogueReservationShotIdSchema,
  dialogueReservationIdentityMatches,
} from "./dialogueReservation.schema.js";

// Same values as the C3 durable namespaces. Attempt metadata only: the
// exclusivity identity of a paid dialogue attempt is the dialogueLineId.
export const DialogueGenerationNamespaceSchema =
  z.enum([
    "LINE_SCOPED",
    "DIRECT_SEED_AUDIO",
  ]);

export const DialogueGenerationAttemptNumberSchema =
  z.number()
    .int()
    .positive()
    .max(
      Number.MAX_SAFE_INTEGER,
      "Dialogue generation admission attempt number must be a safe positive integer.",
    );

export const DialogueGenerationAdmissionSchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    admissionId:
      z.string()
        .uuid(),

    attemptNumber:
      DialogueGenerationAttemptNumberSchema,

    admittedAt:
      z.string()
        .datetime(),

    status:
      z.literal(
        "ADMITTED",
      ),

    episodeId:
      DialogueReservationEpisodeIdSchema,

    sceneId:
      DialogueReservationSceneIdSchema,

    shotId:
      DialogueReservationShotIdSchema,

    dialogueLineId:
      DialogueReservationLineIdSchema,

    planKey:
      DialogueReservationPlanKeySchema,

    generationNamespace:
      DialogueGenerationNamespaceSchema,

    provider:
      DialogueReservationProviderSchema,
  })
    .strict()
    .superRefine(
      (
        value,
        context,
      ) => {
        if (
          !dialogueReservationIdentityMatches(
            value.episodeId,
            value.sceneId,
            value.shotId,
            value.dialogueLineId,
          )
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "dialogueLineId",
            ],
            message:
              "Dialogue generation admission line identity does not match the selected episode, scene, and shot.",
          });
        }
      },
    );

export type DialogueGenerationNamespace =
  z.infer<
    typeof DialogueGenerationNamespaceSchema
  >;

export type DialogueGenerationAdmission =
  z.infer<
    typeof DialogueGenerationAdmissionSchema
  >;
