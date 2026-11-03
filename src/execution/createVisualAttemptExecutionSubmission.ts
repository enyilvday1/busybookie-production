import {
  readVisualAttemptAdmissionEvidence,
} from "./readVisualAttemptAdmission.js";

import {
  readVisualAttemptExecutionReservationEvidence,
} from "./readVisualAttemptExecutionReservation.js";

import {
  VisualAttemptGoogleGenAiExecutionSubmissionSchema,
  VisualAttemptGoogleGenAiRecoveryMetadataSchema,
  type VisualAttemptGoogleGenAiExecutionSubmission,
} from "./visualAttemptExecutionLifecycle.schema.js";

import {
  createVisualAttemptExecutionSubmissionPath,
} from "./visualAttemptExecutionPaths.js";

import {
  calculateVisualAttemptExecutionRecordSha256,
  publishVisualAttemptExecutionRecordCreateOnce,
  serializeVisualAttemptExecutionRecord,
} from "./visualAttemptExecutionRecordPersistence.js";

export type CreateVisualAttemptExecutionSubmissionInput =
  Readonly<{
    episodeId:
      string;

    sceneId:
      string;

    shotId:
      string;

    attemptNumber:
      number;

    expectedAdmissionId:
      string;

    expectedAdmissionSha256:
      string;

    expectedReservationId:
      string;

    expectedReservationSha256:
      string;

    providerExecutionId:
      VisualAttemptGoogleGenAiExecutionSubmission[
        "providerExecutionId"
      ];

    recoveryMetadata:
      VisualAttemptGoogleGenAiExecutionSubmission[
        "recoveryMetadata"
      ];
  }>;

export type CreateVisualAttemptExecutionSubmissionDependencies =
  Readonly<{
    now?:
      () => string;
  }>;

export type CreateVisualAttemptExecutionSubmissionResult =
  Readonly<{
    record:
      VisualAttemptGoogleGenAiExecutionSubmission;

    submissionPath:
      string;

    submissionSha256:
      string;
  }>;

export async function createVisualAttemptExecutionSubmission(
  mediaRoot:
    string,

  input:
    CreateVisualAttemptExecutionSubmissionInput,

  dependencies:
    CreateVisualAttemptExecutionSubmissionDependencies =
      {},
): Promise<
  CreateVisualAttemptExecutionSubmissionResult
> {
  const reservation =
    await readVisualAttemptExecutionReservationEvidence(
      mediaRoot,
      input.episodeId,
      input.shotId,
      input.attemptNumber,
    );

  if (
    reservation ===
      null
  ) {
    throw new Error(
      "Visual attempt execution submission requires an existing durable attempt-aware reservation.",
    );
  }

  if (
    reservation.record.episodeId !==
      input.episodeId ||
    reservation.record.sceneId !==
      input.sceneId ||
    reservation.record.shotId !==
      input.shotId ||
    reservation.record.attemptNumber !==
      input.attemptNumber
  ) {
    throw new Error(
      "Visual attempt execution reservation identity does not match the submission request.",
    );
  }

  if (
    reservation.record.admissionId !==
      input.expectedAdmissionId
  ) {
    throw new Error(
      "Visual attempt execution reservation admission ID does not match the expected admission.",
    );
  }

  if (
    reservation.record.admissionSha256 !==
      input.expectedAdmissionSha256
  ) {
    throw new Error(
      "Visual attempt execution reservation admission SHA-256 does not match the expected admission bytes.",
    );
  }

  if (
    reservation.record.reservationId !==
      input.expectedReservationId
  ) {
    throw new Error(
      "Visual attempt execution reservation ID does not match the expected reservation.",
    );
  }

  if (
    reservation.reservationSha256 !==
      input.expectedReservationSha256
  ) {
    throw new Error(
      "Visual attempt execution reservation SHA-256 does not match the expected reservation bytes.",
    );
  }

  const provider =
    VisualAttemptGoogleGenAiExecutionSubmissionSchema
      .shape
      .provider
      .parse(
        reservation.record.provider,
      );

  const admission =
    await readVisualAttemptAdmissionEvidence(
      mediaRoot,
      input.episodeId,
      input.shotId,
      input.attemptNumber,
    );

  if (
    admission ===
      null
  ) {
    throw new Error(
      "Visual attempt execution submission requires the durable admission bound by its reservation.",
    );
  }

  if (
    admission.record.episodeId !==
      input.episodeId ||
    admission.record.sceneId !==
      input.sceneId ||
    admission.record.shotId !==
      input.shotId ||
    admission.record.attemptNumber !==
      input.attemptNumber
  ) {
    throw new Error(
      "Visual attempt admission identity does not match the submission request.",
    );
  }

  if (
    admission.record.admissionId !==
      reservation.record.admissionId
  ) {
    throw new Error(
      "Visual attempt admission ID does not match the durable reservation lineage.",
    );
  }

  if (
    admission.record.provider !==
      reservation.record.provider
  ) {
    throw new Error(
      "Visual attempt admission provider does not match the durable reservation provider.",
    );
  }

  if (
    admission.admissionSha256 !==
      reservation.record.admissionSha256
  ) {
    throw new Error(
      "Visual attempt admission SHA-256 does not match the durable reservation lineage.",
    );
  }

  const providerExecutionId =
    VisualAttemptGoogleGenAiExecutionSubmissionSchema
      .shape
      .providerExecutionId
      .parse(
        input.providerExecutionId,
      );

  const recoveryMetadata =
    VisualAttemptGoogleGenAiRecoveryMetadataSchema
      .parse(
        input.recoveryMetadata,
      );

  const now =
    dependencies.now ??
    (() =>
      new Date()
        .toISOString());

  const record =
    VisualAttemptGoogleGenAiExecutionSubmissionSchema
      .parse({
        schemaVersion:
          "1.0",

        submittedAt:
          now(),

        status:
          "SUBMITTED",

        reservationId:
          reservation.record.reservationId,

        reservationSha256:
          reservation.reservationSha256,

        episodeId:
          reservation.record.episodeId,

        sceneId:
          reservation.record.sceneId,

        shotId:
          reservation.record.shotId,

        attemptNumber:
          reservation.record.attemptNumber,

        admissionId:
          admission.record.admissionId,

        admissionSha256:
          admission.admissionSha256,

        provider,

        providerExecutionId,

        recoveryMetadata,
      });

  const submissionPath =
    createVisualAttemptExecutionSubmissionPath(
      mediaRoot,
      record.episodeId,
      record.shotId,
      record.attemptNumber,
    );

  const serialized =
    serializeVisualAttemptExecutionRecord(
      record,
    );

  const submissionSha256 =
    calculateVisualAttemptExecutionRecordSha256(
      serialized,
    );

  await publishVisualAttemptExecutionRecordCreateOnce(
    submissionPath,
    serialized,
  );

  return Object.freeze({
    record,

    submissionPath,

    submissionSha256,
  });
}
