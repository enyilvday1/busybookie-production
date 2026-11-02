import {
  randomUUID,
} from "node:crypto";

import {
  readVisualAttemptAdmissionEvidence,
} from "./readVisualAttemptAdmission.js";

import {
  calculateVisualAttemptExecutionRecordSha256,
  publishVisualAttemptExecutionRecordCreateOnce,
  serializeVisualAttemptExecutionRecord,
} from "./visualAttemptExecutionRecordPersistence.js";

import {
  VisualAttemptExecutionReservationSchema,
  type VisualAttemptExecutionReservation,
} from "./visualAttemptExecutionLifecycle.schema.js";

import {
  createVisualAttemptExecutionReservationPath,
} from "./visualAttemptExecutionPaths.js";

export type CreateVisualAttemptExecutionReservationInput =
  Readonly<{
    episodeId:
      string;

    sceneId:
      string;

    shotId:
      string;

    attemptNumber:
      number;

    provider:
      VisualAttemptExecutionReservation[
        "provider"
      ];

    expectedAdmissionId:
      string;

    expectedAdmissionSha256:
      string;
  }>;

export type CreateVisualAttemptExecutionReservationDependencies =
  Readonly<{
    now?:
      () => string;

    createReservationId?:
      () => string;
  }>;

export type CreateVisualAttemptExecutionReservationResult =
  Readonly<{
    record:
      VisualAttemptExecutionReservation;

    reservationPath:
      string;

    reservationSha256:
      string;
  }>;

export async function createVisualAttemptExecutionReservation(
  mediaRoot:
    string,

  input:
    CreateVisualAttemptExecutionReservationInput,

  dependencies:
    CreateVisualAttemptExecutionReservationDependencies =
      {},
): Promise<
  CreateVisualAttemptExecutionReservationResult
> {
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
      "Visual attempt execution reservation requires an existing durable admission.",
    );
  }

  if (
    admission.record.episodeId !==
      input.episodeId
  ) {
    throw new Error(
      "Visual attempt admission episode identity does not match the reservation request.",
    );
  }

  if (
    admission.record.sceneId !==
      input.sceneId
  ) {
    throw new Error(
      "Visual attempt admission scene identity does not match the reservation request.",
    );
  }

  if (
    admission.record.shotId !==
      input.shotId
  ) {
    throw new Error(
      "Visual attempt admission shot identity does not match the reservation request.",
    );
  }

  if (
    admission.record.attemptNumber !==
      input.attemptNumber
  ) {
    throw new Error(
      "Visual attempt admission attempt identity does not match the reservation request.",
    );
  }

  if (
    admission.record.provider !==
      input.provider
  ) {
    throw new Error(
      "Visual attempt admission provider does not match the reservation request.",
    );
  }

  if (
    admission.record.admissionId !==
      input.expectedAdmissionId
  ) {
    throw new Error(
      "Visual attempt admission ID does not match the expected durable admission.",
    );
  }

  if (
    admission.admissionSha256 !==
      input.expectedAdmissionSha256
  ) {
    throw new Error(
      "Visual attempt admission SHA-256 does not match the expected durable admission bytes.",
    );
  }

  const now =
    dependencies.now ??
    (() =>
      new Date()
        .toISOString());

  const createReservationId =
    dependencies.createReservationId ??
    (() =>
      randomUUID());

  const record =
    VisualAttemptExecutionReservationSchema
      .parse({
        schemaVersion:
          "1.0",

        reservationId:
          createReservationId(),

        reservedAt:
          now(),

        status:
          "RESERVED",

        episodeId:
          admission.record.episodeId,

        sceneId:
          admission.record.sceneId,

        shotId:
          admission.record.shotId,

        attemptNumber:
          admission.record.attemptNumber,

        admissionId:
          admission.record.admissionId,

        admissionSha256:
          admission.admissionSha256,

        provider:
          admission.record.provider,
      });

  const reservationPath =
    createVisualAttemptExecutionReservationPath(
      mediaRoot,
      record.episodeId,
      record.shotId,
      record.attemptNumber,
    );

  const serialized =
    serializeVisualAttemptExecutionRecord(
      record,
    );

  const reservationSha256 =
    calculateVisualAttemptExecutionRecordSha256(
      serialized,
    );

  await publishVisualAttemptExecutionRecordCreateOnce(
    reservationPath,
    serialized,
  );

  return Object.freeze({
    record,

    reservationPath,

    reservationSha256,
  });
}
