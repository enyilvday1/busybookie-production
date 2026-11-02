import {
  isAbsolute,
  resolve,
} from "node:path";

import {
  EpisodeManifestSchema,
  ShotSchema,
} from "../schemas/episodeManifest.schema.js";

import {
  VisualAttemptNumberSchema,
  VisualReplacementAttemptNumberSchema,
} from "./visualAttemptNumber.schema.js";

export const VISUAL_ATTEMPT_ADMISSION_FILE_SUFFIX =
  ".visual-attempt-admission.json";

export const VISUAL_ATTEMPT_QC_FILE_SUFFIX =
  ".visual-qc.json";

export type ParsedVisualAttemptLedgerFileName =
  Readonly<{
    kind:
      | "ADMISSION"
      | "QC";

    attemptNumber:
      number;
  }>;

function requireAbsoluteMediaRoot(
  mediaRoot:
    string,
): string {
  if (
    typeof mediaRoot !==
      "string" ||
    mediaRoot.trim().length ===
      0
  ) {
    throw new Error(
      "Visual attempt media root is required.",
    );
  }

  if (
    !isAbsolute(
      mediaRoot,
    )
  ) {
    throw new Error(
      "Visual attempt media root must be absolute.",
    );
  }

  return mediaRoot;
}

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

export function createVisualAttemptShotDirectory(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,
): string {
  const validatedMediaRoot =
    requireAbsoluteMediaRoot(
      mediaRoot,
    );

  const validatedEpisodeId =
    validateEpisodeId(
      episodeId,
    );

  const validatedShotId =
    validateShotId(
      shotId,
    );

  return resolve(
    validatedMediaRoot,
    "generated-video",
    validatedEpisodeId,
    validatedShotId,
  );
}

export function createVisualAttemptAdmissionFileName(
  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
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

  return `${validatedEpisodeId}_${validatedShotId}_a${validatedAttemptNumber}${VISUAL_ATTEMPT_ADMISSION_FILE_SUFFIX}`;
}

export function createVisualAttemptAdmissionPath(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): string {
  const directory =
    createVisualAttemptShotDirectory(
      mediaRoot,
      episodeId,
      shotId,
    );

  const fileName =
    createVisualAttemptAdmissionFileName(
      episodeId,
      shotId,
      attemptNumber,
    );

  return resolve(
    directory,
    fileName,
  );
}

export function createVisualAttemptQcFileName(
  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
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
    VisualAttemptNumberSchema
      .parse(
        attemptNumber,
      );

  return `${validatedEpisodeId}_${validatedShotId}_a${validatedAttemptNumber}${VISUAL_ATTEMPT_QC_FILE_SUFFIX}`;
}

export function createVisualAttemptQcPath(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): string {
  const directory =
    createVisualAttemptShotDirectory(
      mediaRoot,
      episodeId,
      shotId,
    );

  const fileName =
    createVisualAttemptQcFileName(
      episodeId,
      shotId,
      attemptNumber,
    );

  return resolve(
    directory,
    fileName,
  );
}

export function parseVisualAttemptLedgerFileName(
  fileName:
    string,

  episodeId:
    string,

  shotId:
    string,
): ParsedVisualAttemptLedgerFileName | null {
  const validatedEpisodeId =
    validateEpisodeId(
      episodeId,
    );

  const validatedShotId =
    validateShotId(
      shotId,
    );

  if (
    typeof fileName !==
      "string"
  ) {
    return null;
  }

  const prefix =
    `${validatedEpisodeId}_${validatedShotId}_a`;

  if (
    !fileName.startsWith(
      prefix,
    )
  ) {
    return null;
  }

  let kind:
    ParsedVisualAttemptLedgerFileName["kind"];

  let suffix:
    string;

  if (
    fileName.endsWith(
      VISUAL_ATTEMPT_ADMISSION_FILE_SUFFIX,
    )
  ) {
    kind =
      "ADMISSION";

    suffix =
      VISUAL_ATTEMPT_ADMISSION_FILE_SUFFIX;
  } else if (
    fileName.endsWith(
      VISUAL_ATTEMPT_QC_FILE_SUFFIX,
    )
  ) {
    kind =
      "QC";

    suffix =
      VISUAL_ATTEMPT_QC_FILE_SUFFIX;
  } else {
    return null;
  }

  const rawAttemptNumber =
    fileName.slice(
      prefix.length,
      fileName.length -
        suffix.length,
    );

  if (
    !/^[1-9][0-9]*$/.test(
      rawAttemptNumber,
    )
  ) {
    return null;
  }

  const attemptNumber =
    Number(
      rawAttemptNumber,
    );

  const parsedAttempt =
    kind ===
      "ADMISSION"
      ? VisualReplacementAttemptNumberSchema
        .safeParse(
          attemptNumber,
        )
      : VisualAttemptNumberSchema
        .safeParse(
          attemptNumber,
        );

  if (
    !parsedAttempt.success
  ) {
    return null;
  }

  return Object.freeze({
    kind,

    attemptNumber:
      parsedAttempt.data,
  });
}
