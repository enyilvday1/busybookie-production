import {
  VisualAttemptGoogleGenAiExecutionCompletionSchema,
  type VisualAttemptGoogleGenAiExecutionCompletion,
} from "./visualAttemptExecutionLifecycle.schema.js";

import {
  createVisualAttemptExecutionCompletionPath,
} from "./visualAttemptExecutionPaths.js";

import {
  calculateVisualAttemptExecutionRecordSha256,
  readVisualAttemptExecutionRecordTextOrNull,
  serializeVisualAttemptExecutionRecord,
} from "./visualAttemptExecutionRecordPersistence.js";

export type VisualAttemptExecutionCompletionEvidence =
  Readonly<{
    record: VisualAttemptGoogleGenAiExecutionCompletion;
    completionPath: string;
    completionSha256: string;
  }>;

async function readVisualAttemptExecutionCompletionEvidenceInternal(
  mediaRoot: string,
  episodeId: string,
  shotId: string,
  attemptNumber: number,
): Promise<VisualAttemptExecutionCompletionEvidence | null> {
  const completionPath =
    createVisualAttemptExecutionCompletionPath(
      mediaRoot,
      episodeId,
      shotId,
      attemptNumber,
    );

  const raw =
    await readVisualAttemptExecutionRecordTextOrNull(
      completionPath,
    );

  if (
    raw === null
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
  } catch (
    error
  ) {
    throw new Error(
      `Visual attempt execution completion is not valid JSON: ${completionPath}`,
      {
        cause: error,
      },
    );
  }

  const record =
    VisualAttemptGoogleGenAiExecutionCompletionSchema
      .parse(
        parsed,
      );

  if (
    record.episodeId !== episodeId ||
    record.shotId !== shotId ||
    record.attemptNumber !== attemptNumber
  ) {
    throw new Error(
      `Visual attempt execution completion identity does not match its canonical path: ${completionPath}`,
    );
  }

  const canonical =
    serializeVisualAttemptExecutionRecord(
      record,
    );

  if (
    raw !== canonical
  ) {
    throw new Error(
      `Visual attempt execution completion bytes are not canonical: ${completionPath}`,
    );
  }

  return Object.freeze({
    record,
    completionPath,
    completionSha256:
      calculateVisualAttemptExecutionRecordSha256(
        raw,
      ),
  });
}

export async function readVisualAttemptExecutionCompletion(
  mediaRoot: string,
  episodeId: string,
  shotId: string,
  attemptNumber: number,
): Promise<VisualAttemptGoogleGenAiExecutionCompletion | null> {
  const evidence =
    await readVisualAttemptExecutionCompletionEvidenceInternal(
      mediaRoot,
      episodeId,
      shotId,
      attemptNumber,
    );

  return evidence?.record ?? null;
}

export async function readVisualAttemptExecutionCompletionEvidence(
  mediaRoot: string,
  episodeId: string,
  shotId: string,
  attemptNumber: number,
): Promise<VisualAttemptExecutionCompletionEvidence | null> {
  return readVisualAttemptExecutionCompletionEvidenceInternal(
    mediaRoot,
    episodeId,
    shotId,
    attemptNumber,
  );
}
