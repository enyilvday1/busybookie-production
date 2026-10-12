import {
  isAbsolute,
  resolve,
} from "node:path";

import {
  DialogueReservationEpisodeIdSchema,
  DialogueReservationLineIdSchema,
  DialogueReservationPlanKeySchema,
  DialogueReservationSceneIdSchema,
  DialogueReservationShotIdSchema,
  dialogueReservationIdentityMatches,
} from "./dialogueReservation.schema.js";

function createDialogueDirectSeedAudioLifecycleRoot(
  mediaRoot: string,
  episodeId: string,
  sceneId: string,
  shotId: string,
  dialogueLineId: string,
  planKey: string,
): string {
  const normalizedMediaRoot =
    mediaRoot.trim();

  if (!normalizedMediaRoot) {
    throw new Error(
      "Direct SeedAudio dialogue lifecycle media root is required.",
    );
  }

  if (
    !isAbsolute(
      normalizedMediaRoot,
    )
  ) {
    throw new Error(
      "Direct SeedAudio dialogue lifecycle media root must be absolute.",
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

  const validatedPlanKey =
    DialogueReservationPlanKeySchema
      .parse(
        planKey,
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
      "Direct SeedAudio dialogue lifecycle line identity does not match the selected episode, scene, and shot.",
    );
  }

  return resolve(
    normalizedMediaRoot,
    "voices",
    validatedEpisodeId,
    validatedShotId,
    validatedDialogueLineId,
    "direct-seed-audio",
    validatedPlanKey,
  );
}

// The directory holding every plan-scoped lifecycle directory of one canonical
// line. Same validation as the plan-scoped root, without a planKey.
export function createDialogueDirectSeedAudioLineDirectory(
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
      "Direct SeedAudio dialogue lifecycle media root is required.",
    );
  }

  if (
    !isAbsolute(
      normalizedMediaRoot,
    )
  ) {
    throw new Error(
      "Direct SeedAudio dialogue lifecycle media root must be absolute.",
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
      "Direct SeedAudio dialogue lifecycle line identity does not match the selected episode, scene, and shot.",
    );
  }

  return resolve(
    normalizedMediaRoot,
    "voices",
    validatedEpisodeId,
    validatedShotId,
    validatedDialogueLineId,
    "direct-seed-audio",
  );
}

export function createDialogueDirectSeedAudioReservationPath(
  mediaRoot: string,
  episodeId: string,
  sceneId: string,
  shotId: string,
  dialogueLineId: string,
  planKey: string,
): string {
  const validatedDialogueLineId =
    DialogueReservationLineIdSchema
      .parse(
        dialogueLineId,
      );

  return resolve(
    createDialogueDirectSeedAudioLifecycleRoot(
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
      validatedDialogueLineId,
      planKey,
    ),
    `${validatedDialogueLineId}.dialogue-reservation.json`,
  );
}

export function createDialogueDirectSeedAudioSubmissionPath(
  mediaRoot: string,
  episodeId: string,
  sceneId: string,
  shotId: string,
  dialogueLineId: string,
  planKey: string,
): string {
  const validatedDialogueLineId =
    DialogueReservationLineIdSchema
      .parse(
        dialogueLineId,
      );

  return resolve(
    createDialogueDirectSeedAudioLifecycleRoot(
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
      validatedDialogueLineId,
      planKey,
    ),
    `${validatedDialogueLineId}.dialogue-submission.json`,
  );
}

export function createDialogueDirectSeedAudioCompletionPath(
  mediaRoot: string,
  episodeId: string,
  sceneId: string,
  shotId: string,
  dialogueLineId: string,
  planKey: string,
): string {
  const validatedDialogueLineId =
    DialogueReservationLineIdSchema
      .parse(
        dialogueLineId,
      );

  return resolve(
    createDialogueDirectSeedAudioLifecycleRoot(
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
      validatedDialogueLineId,
      planKey,
    ),
    `${validatedDialogueLineId}.dialogue-completion.json`,
  );
}
