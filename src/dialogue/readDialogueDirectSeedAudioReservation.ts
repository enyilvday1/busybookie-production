import {
  readFile,
} from "node:fs/promises";

import {
  DialogueReservationPlanKeySchema,
  DialogueReservationSchema,
  type DialogueReservation,
} from "./dialogueReservation.schema.js";

import {
  createDialogueDirectSeedAudioReservationPath,
} from "./dialogueDirectSeedAudioLifecyclePaths.js";

export async function readDialogueDirectSeedAudioReservation(
  mediaRoot: string,
  episodeId: string,
  sceneId: string,
  shotId: string,
  dialogueLineId: string,
  planKey: string,
): Promise<
  DialogueReservation | null
> {
  const validatedPlanKey =
    DialogueReservationPlanKeySchema
      .parse(
        planKey,
      );

  const reservationPath =
    createDialogueDirectSeedAudioReservationPath(
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
      dialogueLineId,
      validatedPlanKey,
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
      `Dialogue direct SeedAudio reservation is not valid JSON: ${reservationPath}`,
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
      dialogueLineId ||
    record.planKey !==
      validatedPlanKey
  ) {
    throw new Error(
      `Dialogue direct SeedAudio reservation identity does not match its deterministic plan-scoped path: ${reservationPath}`,
    );
  }

  return record;
}
