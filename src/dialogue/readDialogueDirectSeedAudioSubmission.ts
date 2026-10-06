import {
  readFile,
} from "node:fs/promises";

import {
  DialogueReservationPlanKeySchema,
} from "./dialogueReservation.schema.js";

import {
  DialogueSubmissionV3Schema,
  type DialogueSubmissionV3,
} from "./dialogueSubmission.schema.js";

import {
  createDialogueDirectSeedAudioSubmissionPath,
} from "./dialogueDirectSeedAudioLifecyclePaths.js";

export async function readDialogueDirectSeedAudioSubmission(
  mediaRoot: string,
  episodeId: string,
  sceneId: string,
  shotId: string,
  dialogueLineId: string,
  planKey: string,
): Promise<
  DialogueSubmissionV3 | null
> {
  const validatedPlanKey =
    DialogueReservationPlanKeySchema
      .parse(
        planKey,
      );

  const submissionPath =
    createDialogueDirectSeedAudioSubmissionPath(
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
        submissionPath,
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
      `Dialogue direct SeedAudio submission is not valid JSON: ${submissionPath}`,
      {
        cause:
          error,
      },
    );
  }

  const record =
    DialogueSubmissionV3Schema
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
      `Dialogue direct SeedAudio submission identity does not match its deterministic plan-scoped path: ${submissionPath}`,
    );
  }

  return record;
}
