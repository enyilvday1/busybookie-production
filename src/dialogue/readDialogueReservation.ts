import {
  readFile,
} from "node:fs/promises";

import {
  DialogueReservationSchema,
  type DialogueReservation,
} from "./dialogueReservation.schema.js";

import {
  createDialogueReservationPath,
} from "./dialogueReservationPath.js";

export async function readDialogueReservation(
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
): Promise<
  DialogueReservation | null
> {
  const reservationPath =
    createDialogueReservationPath(
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
      dialogueLineId,
    );

  let raw:
    string;

  try {
    raw =
      await readFile(
        reservationPath,
        "utf8",
      );
  } catch (error) {
    const code =
      (
        error as
          NodeJS.ErrnoException
      ).code;

    if (
      code ===
      "ENOENT"
    ) {
      return null;
    }

    throw error;
  }

  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        raw,
      );
  } catch (error) {
    throw new Error(
      `Dialogue reservation is not valid JSON: ${reservationPath}`,
      {
        cause:
          error,
      },
    );
  }

  const record =
    DialogueReservationSchema
      .parse(
        parsed,
      );

  if (
    record.episodeId !==
      episodeId ||
    record.sceneId !==
      sceneId ||
    record.shotId !==
      shotId ||
    record.dialogueLineId !==
      dialogueLineId
  ) {
    throw new Error(
      `Dialogue reservation identity does not match its deterministic path: ${reservationPath}`,
    );
  }

  return record;
}
