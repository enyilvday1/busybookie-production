import {
  GOOGLE_GENAI_PROVIDER,
} from "../googleGenai/googleGenAi.types.js";

import {
  createExecutionCompletionPath,
} from "./executionCompletionPath.js";

import type {
  ExecutionReservation,
} from "./executionReservation.schema.js";

import type {
  ExecutionSubmission,
} from "./executionSubmission.schema.js";

import type {
  GoogleGenAiExecutionCompletion,
} from "./googleGenAiExecutionCompletion.schema.js";

import {
  readExecutionReservation,
} from "./readExecutionReservation.js";

import {
  readExecutionSubmission,
} from "./readExecutionSubmission.js";

import {
  readGoogleGenAiExecutionCompletion,
} from "./readGoogleGenAiExecutionCompletion.js";

/**
 * Read-only Google GenAI lifecycle inspection.
 *
 * Establishes Google provider identity from the durable reservation and
 * submission 1.4, and reads the canonical completion only through the
 * Google 1.1 reader. It never calls the shared completion reader or shared
 * lifecycle inspection, never contacts a provider, and never writes.
 */

export type GoogleGenAiExecutionSubmission =
  Extract<
    ExecutionSubmission,
    { provider: typeof GOOGLE_GENAI_PROVIDER }
  >;

export type GoogleGenAiExecutionLifecycleInspection =
  | Readonly<{
      state:
        "RESERVED_ONLY";

      provider:
        typeof GOOGLE_GENAI_PROVIDER;

      reservation:
        ExecutionReservation;
    }>
  | Readonly<{
      state:
        "SUBMITTED";

      provider:
        typeof GOOGLE_GENAI_PROVIDER;

      reservation:
        ExecutionReservation;

      submission:
        GoogleGenAiExecutionSubmission;
    }>
  | Readonly<{
      state:
        "COMPLETED";

      provider:
        typeof GOOGLE_GENAI_PROVIDER;

      reservation:
        ExecutionReservation;

      submission:
        GoogleGenAiExecutionSubmission;

      completion:
        GoogleGenAiExecutionCompletion;

      completionPath:
        string;
    }>;

export async function inspectGoogleGenAiExecutionLifecycle(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,
): Promise<GoogleGenAiExecutionLifecycleInspection> {
  const reservation =
    await readExecutionReservation(
      mediaRoot,
      episodeId,
      shotId,
    );

  if (!reservation) {
    throw new Error(
      `Google GenAI lifecycle inspection requires a durable reservation for ${episodeId}/${shotId}.`,
    );
  }

  if (
    reservation.provider !==
    GOOGLE_GENAI_PROVIDER
  ) {
    throw new Error(
      `Google GenAI lifecycle inspection requires a ${GOOGLE_GENAI_PROVIDER} reservation; received ${reservation.provider}.`,
    );
  }

  if (
    reservation.episodeId !==
      episodeId ||
    reservation.shotId !==
      shotId
  ) {
    throw new Error(
      "Google GenAI lifecycle reservation identity does not match the requested shot.",
    );
  }

  const submission =
    await readExecutionSubmission(
      mediaRoot,
      episodeId,
      shotId,
    );

  const completion =
    await readGoogleGenAiExecutionCompletion(
      mediaRoot,
      episodeId,
      shotId,
    );

  if (!submission) {
    if (completion) {
      throw new Error(
        "Google GenAI lifecycle completion exists without a durable submission.",
      );
    }

    return Object.freeze({
      state:
        "RESERVED_ONLY",

      provider:
        GOOGLE_GENAI_PROVIDER,

      reservation,
    });
  }

  if (
    submission.provider !==
    GOOGLE_GENAI_PROVIDER
  ) {
    throw new Error(
      `Google GenAI lifecycle inspection requires a ${GOOGLE_GENAI_PROVIDER} submission; received ${submission.provider}.`,
    );
  }

  if (
    submission.reservationId !==
      reservation.reservationId ||
    submission.episodeId !==
      reservation.episodeId ||
    submission.shotId !==
      reservation.shotId
  ) {
    throw new Error(
      "Google GenAI lifecycle submission identity does not match the durable reservation.",
    );
  }

  if (
    Object.hasOwn(
      submission,
      "interactionId",
    )
  ) {
    throw new Error(
      "Google GenAI execution submission must not carry a separate interactionId.",
    );
  }

  if (!submission.providerExecutionId.trim()) {
    throw new Error(
      "Google GenAI execution submission has an empty providerExecutionId.",
    );
  }

  if (!completion) {
    return Object.freeze({
      state:
        "SUBMITTED",

      provider:
        GOOGLE_GENAI_PROVIDER,

      reservation,

      submission,
    });
  }

  if (
    completion.reservationId !==
      reservation.reservationId ||
    completion.episodeId !==
      reservation.episodeId ||
    completion.shotId !==
      reservation.shotId ||
    completion.provider !==
      GOOGLE_GENAI_PROVIDER ||
    completion.providerExecutionId !==
      submission.providerExecutionId
  ) {
    throw new Error(
      "Google GenAI lifecycle completion does not match the durable reservation and submission.",
    );
  }

  return Object.freeze({
    state:
      "COMPLETED",

    provider:
      GOOGLE_GENAI_PROVIDER,

    reservation,

    submission,

    completion,

    completionPath:
      createExecutionCompletionPath(
        mediaRoot,
        episodeId,
        shotId,
      ),
  });
}
