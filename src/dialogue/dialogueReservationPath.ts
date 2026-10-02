import {
  isAbsolute,
  resolve,
} from "node:path";

import {
  DialogueReservationEpisodeIdSchema,
  DialogueReservationLineIdSchema,
  DialogueReservationSceneIdSchema,
  DialogueReservationShotIdSchema,
  dialogueReservationIdentityMatches,
} from "./dialogueReservation.schema.js";

export function createDialogueReservationPath(
  mediaRoot:
    string,

  episodeId:
    string,

  sceneId:
    string,

  shotId:
    string,

  dialogueLineId:
    string,
): string {
  const normalizedMediaRoot =
    mediaRoot.trim();

  if (!normalizedMediaRoot) {
    throw new Error(
      "Dialogue reservation media root is required.",
    );
  }

  if (
    !isAbsolute(
      normalizedMediaRoot,
    )
  ) {
    throw new Error(
      "Dialogue reservation media root must be absolute.",
    );
  }

  const validatedEpisodeId =
    DialogueReservationEpisodeIdSchema
      .parse(
        episodeId,
      );

  const validatedSceneId =
    DialogueReservationSceneIdSchema
      .parse(
        sceneId,
      );

  const validatedShotId =
    DialogueReservationShotIdSchema
      .parse(
        shotId,
      );

  const validatedDialogueLineId =
    DialogueReservationLineIdSchema
      .parse(
        dialogueLineId,
      );

  if (
    !dialogueReservationIdentityMatches(
      validatedEpisodeId,
      validatedSceneId,
      validatedShotId,
      validatedDialogueLineId,
    )
  ) {
    throw new Error(
      `Dialogue line identity does not match ${validatedEpisodeId}/${validatedSceneId}/${validatedShotId}: ${validatedDialogueLineId}`,
    );
  }

  return resolve(
    normalizedMediaRoot,
    "voices",
    validatedEpisodeId,
    validatedShotId,
    validatedDialogueLineId,
    `${validatedDialogueLineId}.dialogue-reservation.json`,
  );
}
