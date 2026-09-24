import {
  isAbsolute,
  resolve,
} from "node:path";

import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationShotIdSchema,
} from "./executionReservation.schema.js";

export function createExecutionCompletionPath(
  mediaRoot: string,
  episodeId: string,
  shotId: string,
): string {
  const normalizedMediaRoot =
    mediaRoot.trim();

  if (!normalizedMediaRoot) {
    throw new Error(
      "Execution completion media root is required.",
    );
  }

  if (
    !isAbsolute(
      normalizedMediaRoot,
    )
  ) {
    throw new Error(
      "Execution completion media root must be absolute.",
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
    `${validatedEpisodeId}_${validatedShotId}.execution-completion.json`,
  );
}
