import type {
  ExecutionCompletion,
} from "./executionCompletion.schema.js";

import type {
  ExecutionReservation,
} from "./executionReservation.schema.js";

import type {
  ExecutionSubmission,
} from "./executionSubmission.schema.js";

import type {
  GoogleGenAiExecutionCompletion,
} from "./googleGenAiExecutionCompletion.schema.js";

export type ExecutionLifecycleClassificationInput =
  Readonly<{
    reservation:
      ExecutionReservation | null;

    submission:
      ExecutionSubmission | null;

    completion:
      ExecutionCompletion | null;
  }>;

export type ExecutionLifecycleClassification =
  | Readonly<{
      state:
        "NOTHING";
    }>
  | Readonly<{
      state:
        "RESERVED_ONLY";

      reservation:
        ExecutionReservation;
    }>
  | Readonly<{
      state:
        "SUBMITTED";

      reservation:
        ExecutionReservation;

      submission:
        ExecutionSubmission;
    }>
  | Readonly<{
      state:
        "COMPLETED";

      reservation:
        ExecutionReservation;

      submission:
        ExecutionSubmission;

      completion:
        ExecutionCompletion;
    }>
  // B5C-R1: a Google-owned COMPLETED lifecycle carries its authoritative
  // Google 1.1 completion unchanged (never coerced into the shared record).
  | Readonly<{
      state:
        "COMPLETED";

      reservation:
        ExecutionReservation;

      submission:
        ExecutionSubmission;

      completion:
        GoogleGenAiExecutionCompletion;
    }>;

function assertSubmissionMatchesReservation(
  reservation:
    ExecutionReservation,

  submission:
    ExecutionSubmission,
): void {
  if (
    submission.reservationId !==
    reservation.reservationId
  ) {
    throw new Error(
      "Execution lifecycle submission reservation ID does not match the durable reservation.",
    );
  }

  if (
    submission.provider !==
    reservation.provider
  ) {
    throw new Error(
      "Execution lifecycle submission provider does not match the durable reservation.",
    );
  }

  if (
    submission.episodeId !==
    reservation.episodeId
  ) {
    throw new Error(
      "Execution lifecycle submission episode does not match the durable reservation.",
    );
  }

  if (
    submission.shotId !==
    reservation.shotId
  ) {
    throw new Error(
      "Execution lifecycle submission shot does not match the durable reservation.",
    );
  }
}

function assertCompletionMatchesLifecycle(
  reservation:
    ExecutionReservation,

  submission:
    ExecutionSubmission,

  completion:
    ExecutionCompletion,
): void {
  if (
    completion.reservationId !==
    reservation.reservationId
  ) {
    throw new Error(
      "Execution lifecycle completion reservation ID does not match the durable reservation.",
    );
  }

  if (
    completion.provider !==
      reservation.provider ||
    completion.provider !==
      submission.provider
  ) {
    throw new Error(
      "Execution lifecycle completion provider does not match the prior lifecycle records.",
    );
  }

  if (
    completion.episodeId !==
      reservation.episodeId ||
    completion.episodeId !==
      submission.episodeId
  ) {
    throw new Error(
      "Execution lifecycle completion episode does not match the prior lifecycle records.",
    );
  }

  if (
    completion.shotId !==
      reservation.shotId ||
    completion.shotId !==
      submission.shotId
  ) {
    throw new Error(
      "Execution lifecycle completion shot does not match the prior lifecycle records.",
    );
  }

  if (
    completion.providerExecutionId !==
    submission.providerExecutionId
  ) {
    throw new Error(
      "Execution lifecycle completion provider execution ID does not match the durable submission.",
    );
  }
}

export function classifyExecutionLifecycle(
  input:
    ExecutionLifecycleClassificationInput,
): ExecutionLifecycleClassification {
  const {
    reservation,
    submission,
    completion,
  } = input;

  if (!reservation) {
    if (submission) {
      throw new Error(
        "Execution lifecycle submission exists without a durable reservation.",
      );
    }

    if (completion) {
      throw new Error(
        "Execution lifecycle completion exists without a durable reservation.",
      );
    }

    return Object.freeze({
      state:
        "NOTHING",
    });
  }

  if (!submission) {
    if (completion) {
      throw new Error(
        "Execution lifecycle completion exists without a durable submission.",
      );
    }

    return Object.freeze({
      state:
        "RESERVED_ONLY",

      reservation,
    });
  }

  assertSubmissionMatchesReservation(
    reservation,
    submission,
  );

  if (!completion) {
    return Object.freeze({
      state:
        "SUBMITTED",

      reservation,
      submission,
    });
  }

  assertCompletionMatchesLifecycle(
    reservation,
    submission,
    completion,
  );

  return Object.freeze({
    state:
      "COMPLETED",

    reservation,
    submission,
    completion,
  });
}
