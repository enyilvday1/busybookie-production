import {
  isAbsolute,
  resolve,
} from "node:path";

import {
  DialogueGenerationAttemptNumberSchema,
} from "./dialogueGenerationAdmission.schema.js";

import {
  DialogueReservationEpisodeIdSchema,
  DialogueReservationLineIdSchema,
  DialogueReservationSceneIdSchema,
  DialogueReservationShotIdSchema,
  dialogueReservationIdentityMatches,
} from "./dialogueReservation.schema.js";

const ADMISSION_FILE_SUFFIX =
  ".dialogue-generation-admission.json";

// One ledger per canonical line, outside both generation namespaces and
// independent of planKey: voices/<EP>/<SHOT>/<LINE>/generation-admission/.
export function createDialogueGenerationAdmissionDirectory(
  mediaRoot: string,
  episodeId: string,
  sceneId: string,
  shotId: string,
  dialogueLineId: string,
): string {
  const normalizedMediaRoot =
    mediaRoot.trim();

  if (!normalizedMediaRoot) {
    throw new Error(
      "Dialogue generation admission media root is required.",
    );
  }

  if (
    !isAbsolute(
      normalizedMediaRoot,
    )
  ) {
    throw new Error(
      "Dialogue generation admission media root must be absolute.",
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
      "Dialogue generation admission line identity does not match the selected episode, scene, and shot.",
    );
  }

  return resolve(
    normalizedMediaRoot,
    "voices",
    validatedEpisodeId,
    validatedShotId,
    validatedDialogueLineId,
    "generation-admission",
  );
}

export function createDialogueGenerationAdmissionFileName(
  dialogueLineId: string,
  attemptNumber: number,
): string {
  const validatedDialogueLineId =
    DialogueReservationLineIdSchema
      .parse(
        dialogueLineId,
      );

  const validatedAttemptNumber =
    DialogueGenerationAttemptNumberSchema
      .parse(
        attemptNumber,
      );

  return `${validatedDialogueLineId}_a${validatedAttemptNumber}${ADMISSION_FILE_SUFFIX}`;
}

export function createDialogueGenerationAdmissionPath(
  mediaRoot: string,
  episodeId: string,
  sceneId: string,
  shotId: string,
  dialogueLineId: string,
  attemptNumber: number,
): string {
  return resolve(
    createDialogueGenerationAdmissionDirectory(
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
      dialogueLineId,
    ),
    createDialogueGenerationAdmissionFileName(
      dialogueLineId,
      attemptNumber,
    ),
  );
}

export type DialogueGenerationLedgerFileName =
  Readonly<{
    kind: "ADMISSION";
    attemptNumber: number;
  }>;

// Strict inverse of createDialogueGenerationAdmissionFileName; anything else
// (including zero-padded or non-canonical numbers) is not a ledger file.
export function parseDialogueGenerationLedgerFileName(
  fileName: string,
  dialogueLineId: string,
): DialogueGenerationLedgerFileName | null {
  const validatedDialogueLineId =
    DialogueReservationLineIdSchema
      .parse(
        dialogueLineId,
      );

  const prefix =
    `${validatedDialogueLineId}_a`;

  if (
    !fileName.startsWith(
      prefix,
    ) ||
    !fileName.endsWith(
      ADMISSION_FILE_SUFFIX,
    )
  ) {
    return null;
  }

  const attemptText =
    fileName.slice(
      prefix.length,
      fileName.length -
        ADMISSION_FILE_SUFFIX.length,
    );

  if (
    !/^[1-9][0-9]*$/.test(
      attemptText,
    )
  ) {
    return null;
  }

  const attemptNumber =
    Number(
      attemptText,
    );

  if (
    !Number.isSafeInteger(
      attemptNumber,
    )
  ) {
    return null;
  }

  return Object.freeze({
    kind:
      "ADMISSION",
    attemptNumber,
  });
}
