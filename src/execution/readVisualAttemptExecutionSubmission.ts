import {
  VisualAttemptGoogleGenAiExecutionSubmissionSchema,
  type VisualAttemptGoogleGenAiExecutionSubmission,
} from "./visualAttemptExecutionLifecycle.schema.js";

import {
  createVisualAttemptExecutionSubmissionPath,
} from "./visualAttemptExecutionPaths.js";

import {
  calculateVisualAttemptExecutionRecordSha256,
  readVisualAttemptExecutionRecordTextOrNull,
  serializeVisualAttemptExecutionRecord,
} from "./visualAttemptExecutionRecordPersistence.js";

export type VisualAttemptExecutionSubmissionEvidence =
  Readonly<{
    record:
      VisualAttemptGoogleGenAiExecutionSubmission;

    submissionPath:
      string;

    submissionSha256:
      string;
  }>;

async function readVisualAttemptExecutionSubmissionEvidenceInternal(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): Promise<
  VisualAttemptExecutionSubmissionEvidence | null
> {
  const submissionPath =
    createVisualAttemptExecutionSubmissionPath(
      mediaRoot,
      episodeId,
      shotId,
      attemptNumber,
    );

  const raw =
    await readVisualAttemptExecutionRecordTextOrNull(
      submissionPath,
    );

  if (
    raw ===
      null
  ) {
    return null;
  }

  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        raw,
      );
  } catch {
    throw new Error(
      `Visual attempt execution submission is not valid JSON: ${submissionPath}`,
    );
  }

  const record =
    VisualAttemptGoogleGenAiExecutionSubmissionSchema
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
      `Visual attempt execution submission identity does not match its canonical path: ${submissionPath}`,
    );
  }

  const canonical =
    serializeVisualAttemptExecutionRecord(
      record,
    );

  if (
    raw !==
      canonical
  ) {
    throw new Error(
      `Visual attempt execution submission bytes are not canonical: ${submissionPath}`,
    );
  }

  return Object.freeze({
    record,

    submissionPath,

    submissionSha256:
      calculateVisualAttemptExecutionRecordSha256(
        raw,
      ),
  });
}

export async function readVisualAttemptExecutionSubmission(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): Promise<
  VisualAttemptGoogleGenAiExecutionSubmission | null
> {
  const evidence =
    await readVisualAttemptExecutionSubmissionEvidenceInternal(
      mediaRoot,
      episodeId,
      shotId,
      attemptNumber,
    );

  return evidence
    ?.record ??
    null;
}

export async function readVisualAttemptExecutionSubmissionEvidence(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): Promise<
  VisualAttemptExecutionSubmissionEvidence | null
> {
  return readVisualAttemptExecutionSubmissionEvidenceInternal(
    mediaRoot,
    episodeId,
    shotId,
    attemptNumber,
  );
}
