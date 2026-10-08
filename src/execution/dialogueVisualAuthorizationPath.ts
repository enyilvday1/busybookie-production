import {
  isAbsolute,
  resolve,
} from "node:path";

import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationShotIdSchema,
} from "./executionReservation.schema.js";

export function createDialogueVisualAuthorizationPath(
  mediaRoot: string,
  episodeId: string,
  shotId: string,
): string {
  const normalizedMediaRoot =
    mediaRoot.trim();

  if (!normalizedMediaRoot) {
    throw new Error(
      "Dialogue visual authorization media root is required.",
    );
  }

  if (
    !isAbsolute(
      normalizedMediaRoot,
    )
  ) {
    throw new Error(
      "Dialogue visual authorization media root must be absolute.",
    );
  }

  const validatedEpisodeId =
    ExecutionReservationEpisodeIdSchema
      .parse(
        episodeId,
      );

  const validatedShotId =
    ExecutionReservationShotIdSchema
      .parse(
        shotId,
      );

  return resolve(
    normalizedMediaRoot,
    "generated-video",
    validatedEpisodeId,
    validatedShotId,
    `${validatedEpisodeId}_${validatedShotId}.dialogue-visual-authorization.json`,
  );
}
