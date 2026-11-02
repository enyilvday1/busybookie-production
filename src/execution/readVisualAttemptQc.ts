import {
  readFile,
} from "node:fs/promises";

import {
  calculateVisualAttemptQcSha256,
  serializeVisualAttemptQc,
} from "./createVisualAttemptQc.js";

import {
  createVisualAttemptQcPath,
} from "./visualAttemptPaths.js";

import {
  VisualAttemptQcSchema,
  type VisualAttemptQc,
} from "./visualAttemptQc.schema.js";

export type ReadVisualAttemptQcEvidence =
  Readonly<{
    record:
      VisualAttemptQc;

    qcPath:
      string;

    qcSha256:
      string;
  }>;

async function readVisualAttemptQcEvidenceInternal(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): Promise<ReadVisualAttemptQcEvidence | null> {
  const qcPath =
    createVisualAttemptQcPath(
      mediaRoot,
      episodeId,
      shotId,
      attemptNumber,
    );

  let raw:
    string;

  try {
    raw =
      await readFile(
        qcPath,
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
      `Visual attempt QC is not valid JSON: ${qcPath}`,
      {
        cause:
          error,
      },
    );
  }

  const record =
    VisualAttemptQcSchema
      .parse(
        parsed,
      );

  if (
    record.episodeId !==
      episodeId ||
    record.shotId !==
      shotId ||
    record.attemptNumber !==
      attemptNumber
  ) {
    throw new Error(
      `Visual attempt QC identity does not match its canonical path: ${qcPath}`,
    );
  }

  const canonical =
    serializeVisualAttemptQc(
      record,
    );

  if (
    raw !==
      canonical
  ) {
    throw new Error(
      `Visual attempt QC bytes are not canonical: ${qcPath}`,
    );
  }

  return Object.freeze({
    record,

    qcPath,

    qcSha256:
      calculateVisualAttemptQcSha256(
        raw,
      ),
  });
}

export async function readVisualAttemptQc(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): Promise<VisualAttemptQc | null> {
  const evidence =
    await readVisualAttemptQcEvidenceInternal(
      mediaRoot,
      episodeId,
      shotId,
      attemptNumber,
    );

  return evidence?.record ??
    null;
}

export async function readVisualAttemptQcEvidence(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): Promise<ReadVisualAttemptQcEvidence | null> {
  return readVisualAttemptQcEvidenceInternal(
    mediaRoot,
    episodeId,
    shotId,
    attemptNumber,
  );
}
