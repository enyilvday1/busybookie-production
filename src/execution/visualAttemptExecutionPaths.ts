import {
  resolve,
} from "node:path";

import {
  EpisodeManifestSchema,
  ShotSchema,
} from "../schemas/episodeManifest.schema.js";

import {
  VisualReplacementAttemptNumberSchema,
} from "./visualAttemptNumber.schema.js";

import {
  createVisualAttemptShotDirectory,
} from "./visualAttemptPaths.js";

export const VISUAL_ATTEMPT_EXECUTION_RESERVATION_FILE_SUFFIX =
  ".execution-reservation.json";

export const VISUAL_ATTEMPT_EXECUTION_SUBMISSION_FILE_SUFFIX =
  ".execution-submission.json";

export const VISUAL_ATTEMPT_EXECUTION_COMPLETION_FILE_SUFFIX =
  ".execution-completion.json";

type VisualAttemptExecutionFileSuffix =
  | typeof VISUAL_ATTEMPT_EXECUTION_RESERVATION_FILE_SUFFIX
  | typeof VISUAL_ATTEMPT_EXECUTION_SUBMISSION_FILE_SUFFIX
  | typeof VISUAL_ATTEMPT_EXECUTION_COMPLETION_FILE_SUFFIX;

function validateEpisodeId(
  episodeId:
    string,
): string {
  return EpisodeManifestSchema
    .shape
    .episodeId
    .parse(
      episodeId,
    );
}

function validateShotId(
  shotId:
    string,
): string {
  return ShotSchema
    .shape
    .id
    .parse(
      shotId,
    );
}

function createVisualAttemptExecutionFileName(
  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,

  suffix:
    VisualAttemptExecutionFileSuffix,
): string {
  const validatedEpisodeId =
    validateEpisodeId(
      episodeId,
    );

  const validatedShotId =
    validateShotId(
      shotId,
    );

  const validatedAttemptNumber =
    VisualReplacementAttemptNumberSchema
      .parse(
        attemptNumber,
      );

  return `${validatedEpisodeId}_${validatedShotId}_a${validatedAttemptNumber}${suffix}`;
}

function createVisualAttemptExecutionPath(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,

  suffix:
    VisualAttemptExecutionFileSuffix,
): string {
  const directory =
    createVisualAttemptShotDirectory(
      mediaRoot,
      episodeId,
      shotId,
    );

  const fileName =
    createVisualAttemptExecutionFileName(
      episodeId,
      shotId,
      attemptNumber,
      suffix,
    );

  return resolve(
    directory,
    fileName,
  );
}

export function createVisualAttemptExecutionReservationFileName(
  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): string {
  return createVisualAttemptExecutionFileName(
    episodeId,
    shotId,
    attemptNumber,
    VISUAL_ATTEMPT_EXECUTION_RESERVATION_FILE_SUFFIX,
  );
}

export function createVisualAttemptExecutionSubmissionFileName(
  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): string {
  return createVisualAttemptExecutionFileName(
    episodeId,
    shotId,
    attemptNumber,
    VISUAL_ATTEMPT_EXECUTION_SUBMISSION_FILE_SUFFIX,
  );
}

export function createVisualAttemptExecutionCompletionFileName(
  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): string {
  return createVisualAttemptExecutionFileName(
    episodeId,
    shotId,
    attemptNumber,
    VISUAL_ATTEMPT_EXECUTION_COMPLETION_FILE_SUFFIX,
  );
}

export function createVisualAttemptExecutionReservationPath(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): string {
  return createVisualAttemptExecutionPath(
    mediaRoot,
    episodeId,
    shotId,
    attemptNumber,
    VISUAL_ATTEMPT_EXECUTION_RESERVATION_FILE_SUFFIX,
  );
}

export function createVisualAttemptExecutionSubmissionPath(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): string {
  return createVisualAttemptExecutionPath(
    mediaRoot,
    episodeId,
    shotId,
    attemptNumber,
    VISUAL_ATTEMPT_EXECUTION_SUBMISSION_FILE_SUFFIX,
  );
}

export function createVisualAttemptExecutionCompletionPath(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): string {
  return createVisualAttemptExecutionPath(
    mediaRoot,
    episodeId,
    shotId,
    attemptNumber,
    VISUAL_ATTEMPT_EXECUTION_COMPLETION_FILE_SUFFIX,
  );
}
