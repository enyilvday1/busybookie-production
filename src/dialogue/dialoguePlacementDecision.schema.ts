import {
  z,
} from "zod";

import {
  DialogueReservationEpisodeIdSchema,
  DialogueReservationLineIdSchema,
  DialogueReservationSceneIdSchema,
  DialogueReservationShotIdSchema,
  dialogueReservationIdentityMatches,
} from "./dialogueReservation.schema.js";

const SHA256_PATTERN =
  /^[0-9a-f]{64}$/;

export const DialoguePlacementDecisionSha256Schema =
  z.string()
    .regex(
      SHA256_PATTERN,
      "Dialogue placement sourceSha256 must be a lowercase 64-character hexadecimal digest.",
    );

export const DialoguePlacementDecisionRevisionSchema =
  z.number()
    .int()
    .positive()
    .max(
      Number.MAX_SAFE_INTEGER,
      "Dialogue placement decision revision must be a safe positive integer.",
    );

export const DialoguePlacementDecisionPlacementSchema =
  z.object({
    dialogueLineId:
      DialogueReservationLineIdSchema,

    sourceSha256:
      DialoguePlacementDecisionSha256Schema,

    startSeconds:
      z.number()
        .finite()
        .nonnegative(),
  })
    .strict();

export const DialoguePlacementDecisionSchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    revision:
      DialoguePlacementDecisionRevisionSchema,

    recordedAt:
      z.string()
        .datetime(),

    episodeId:
      DialogueReservationEpisodeIdSchema,

    sceneId:
      DialogueReservationSceneIdSchema,

    shotId:
      DialogueReservationShotIdSchema,

    dialoguePlanKey:
      DialoguePlacementDecisionSha256Schema,

    placements:
      z.array(
        DialoguePlacementDecisionPlacementSchema,
      )
        .min(
          1,
          "Dialogue placement decision must contain at least one placement.",
        ),
  })
    .strict()
    .superRefine(
      (
        value,
        context,
      ) => {
        const seenDialogueLineIds =
          new Set<string>();

        value.placements.forEach(
          (
            placement,
            index,
          ) => {
            if (
              seenDialogueLineIds.has(
                placement.dialogueLineId,
              )
            ) {
              context.addIssue({
                code:
                  "custom",

                path: [
                  "placements",
                  index,
                  "dialogueLineId",
                ],

                message:
                  `Duplicate dialogue placement line id: ${placement.dialogueLineId}.`,
              });
            }

            seenDialogueLineIds.add(
              placement.dialogueLineId,
            );

            if (
              !dialogueReservationIdentityMatches(
                value.episodeId,
                value.sceneId,
                value.shotId,
                placement.dialogueLineId,
              )
            ) {
              context.addIssue({
                code:
                  "custom",

                path: [
                  "placements",
                  index,
                  "dialogueLineId",
                ],

                message:
                  `Dialogue placement line identity does not match ${value.episodeId}/${value.sceneId}/${value.shotId}: ${placement.dialogueLineId}`,
              });
            }
          },
        );
      },
    );

export type DialoguePlacementDecisionPlacement =
  z.infer<
    typeof DialoguePlacementDecisionPlacementSchema
  >;

export type DialoguePlacementDecision =
  z.infer<
    typeof DialoguePlacementDecisionSchema
  >;
