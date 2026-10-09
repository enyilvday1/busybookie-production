import {
  isAbsolute,
  resolve,
} from "node:path";

import {
  DialogueReservationEpisodeIdSchema,
  DialogueReservationSceneIdSchema,
  DialogueReservationShotIdSchema,
} from "./dialogueReservation.schema.js";

import {
  DialoguePlacementDecisionRevisionSchema,
} from "./dialoguePlacementDecision.schema.js";

export function createDialoguePlacementDecisionDirectory(
  mediaRoot:
    string,

  episodeId:
    string,

  sceneId:
    string,

  shotId:
    string,
): string {
  const normalizedMediaRoot =
    mediaRoot.trim();

  if (!normalizedMediaRoot) {
    throw new Error(
      "Dialogue placement decision media root is required.",
    );
  }

  if (
    !isAbsolute(
      normalizedMediaRoot,
    )
  ) {
    throw new Error(
      "Dialogue placement decision media root must be absolute.",
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

  return resolve(
    normalizedMediaRoot,
    "voices",
    validatedEpisodeId,
    validatedShotId,
    "dialogue-placement",
    validatedSceneId,
  );
}

export function createDialoguePlacementDecisionFileName(
  episodeId:
    string,

  sceneId:
    string,

  shotId:
    string,

  revision:
    number,
): string {
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

  const validatedRevision =
    DialoguePlacementDecisionRevisionSchema
      .parse(
        revision,
      );

  return `${validatedEpisodeId}_${validatedSceneId}_${validatedShotId}_r${validatedRevision}.dialogue-placement.json`;
}

export function createDialoguePlacementDecisionPath(
  mediaRoot:
    string,

  episodeId:
    string,

  sceneId:
    string,

  shotId:
    string,

  revision:
    number,
): string {
  return resolve(
    createDialoguePlacementDecisionDirectory(
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
    ),
    createDialoguePlacementDecisionFileName(
      episodeId,
      sceneId,
      shotId,
      revision,
    ),
  );
}

export function parseDialoguePlacementDecisionRevisionFileName(
  fileName:
    string,

  episodeId:
    string,

  sceneId:
    string,

  shotId:
    string,
): number | null {
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

  const prefix =
    `${validatedEpisodeId}_${validatedSceneId}_${validatedShotId}_r`;

  const suffix =
    ".dialogue-placement.json";

  if (
    !fileName.startsWith(
      prefix,
    ) ||
    !fileName.endsWith(
      suffix,
    )
  ) {
    return null;
  }

  const revisionText =
    fileName.slice(
      prefix.length,
      fileName.length -
        suffix.length,
    );

  if (
    !/^[1-9][0-9]*$/.test(
      revisionText,
    )
  ) {
    return null;
  }

  const revision =
    Number(
      revisionText,
    );

  if (
    !Number.isSafeInteger(
      revision,
    ) ||
    revision <=
      0
  ) {
    return null;
  }

  return revision;
}
