import {
  isAbsolute,
} from "node:path";

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

const WINDOWS_ABSOLUTE_PATH_PATTERN =
  /^[A-Za-z]:[\\/]/;

function isPortableAbsolutePath(
  value:
    string,
): boolean {
  return (
    isAbsolute(
      value,
    ) ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(
      value,
    )
  );
}

const DialogueCompletionReservationIdSchema =
  z.string()
    .uuid();

const DialogueCompletionProviderExecutionIdSchema =
  z.string()
    .trim()
    .min(
      1,
      "providerExecutionId is required.",
    );

const DialogueCompletionGenerationRecordPathSchema =
  z.string()
    .trim()
    .min(
      1,
      "generationRecordPath is required.",
    )
    .refine(
      isPortableAbsolutePath,
      {
        message:
          "Dialogue completion generation record path must be absolute.",
      },
    );

const DialogueCompletionIdentityFieldsSchema =
  z.object({
    reservationId:
      DialogueCompletionReservationIdSchema,

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

    provider:
      DialogueReservationProviderSchema,

    providerExecutionId:
      DialogueCompletionProviderExecutionIdSchema,

    generationRecordPath:
      DialogueCompletionGenerationRecordPathSchema,
  })
    .strict();

function addDialogueCompletionIdentityValidation(
  value:
    z.infer<
      typeof DialogueCompletionIdentityFieldsSchema
    >,

  context:
    z.RefinementCtx,
): void {
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
        z.ZodIssueCode.custom,

      path: [
        "dialogueLineId",
      ],

      message:
        "Dialogue completion line identity does not match the selected episode, scene, and shot.",
    });
  }
}

export const DialogueCompletionInputSchema =
  DialogueCompletionIdentityFieldsSchema
    .superRefine(
      addDialogueCompletionIdentityValidation,
    );

const DialogueCompletionBaseSchema =
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
      DialogueCompletionReservationIdSchema,

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

    provider:
      DialogueReservationProviderSchema,

    providerExecutionId:
      DialogueCompletionProviderExecutionIdSchema,

    generationRecordPath:
      DialogueCompletionGenerationRecordPathSchema,
  })
    .strict();

export const DialogueCompletionSchema =
  DialogueCompletionBaseSchema
    .superRefine(
      addDialogueCompletionIdentityValidation,
    );

export type DialogueCompletionInput =
  z.infer<
    typeof DialogueCompletionInputSchema
  >;

export type DialogueCompletion =
  z.infer<
    typeof DialogueCompletionSchema
  >;
