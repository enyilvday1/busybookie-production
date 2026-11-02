import {
  calculateVisualAttemptExecutionRecordSha256,
  readVisualAttemptExecutionRecordTextOrNull,
  serializeVisualAttemptExecutionRecord,
} from "./visualAttemptExecutionRecordPersistence.js";

import {
  VisualAttemptExecutionReservationSchema,
  type VisualAttemptExecutionReservation,
} from "./visualAttemptExecutionLifecycle.schema.js";

import {
  createVisualAttemptExecutionReservationPath,
} from "./visualAttemptExecutionPaths.js";

export type VisualAttemptExecutionReservationEvidence =
  Readonly<{
    record:
      VisualAttemptExecutionReservation;

    reservationPath:
      string;

    reservationSha256:
      string;
  }>;

async function readVisualAttemptExecutionReservationEvidenceInternal(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): Promise<
  VisualAttemptExecutionReservationEvidence | null
> {
  const reservationPath =
    createVisualAttemptExecutionReservationPath(
      mediaRoot,
      episodeId,
      shotId,
      attemptNumber,
    );

  const raw =
    await readVisualAttemptExecutionRecordTextOrNull(
      reservationPath,
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
      `Visual attempt execution reservation is not valid JSON: ${reservationPath}`,
    );
  }

  const record =
    VisualAttemptExecutionReservationSchema
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
      `Visual attempt execution reservation identity does not match its canonical path: ${reservationPath}`,
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
      `Visual attempt execution reservation bytes are not canonical: ${reservationPath}`,
    );
  }

  return Object.freeze({
    record,

    reservationPath,

    reservationSha256:
      calculateVisualAttemptExecutionRecordSha256(
        raw,
      ),
  });
}

export async function readVisualAttemptExecutionReservation(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): Promise<
  VisualAttemptExecutionReservation | null
> {
  const evidence =
    await readVisualAttemptExecutionReservationEvidenceInternal(
      mediaRoot,
      episodeId,
      shotId,
      attemptNumber,
    );

  return evidence
    ?.record ??
    null;
}

export async function readVisualAttemptExecutionReservationEvidence(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): Promise<
  VisualAttemptExecutionReservationEvidence | null
> {
  return readVisualAttemptExecutionReservationEvidenceInternal(
    mediaRoot,
    episodeId,
    shotId,
    attemptNumber,
  );
}
