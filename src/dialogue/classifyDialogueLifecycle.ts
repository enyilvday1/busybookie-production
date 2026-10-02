import type {
  DialogueCompletion,
} from "./dialogueCompletion.schema.js";

import type {
  DialogueReservation,
} from "./dialogueReservation.schema.js";

import type {
  DialogueSubmission,
} from "./dialogueSubmission.schema.js";

export type DialogueLifecycleClassificationInput =
  Readonly<{
    reservation:
      DialogueReservation | null;

    submission:
      DialogueSubmission | null;

    completion:
      DialogueCompletion | null;
  }>;

export type DialogueLifecycleClassification =
  | Readonly<{
      state:
        "NOTHING";
    }>
  | Readonly<{
      state:
        "RESERVED_ONLY";

      reservation:
        DialogueReservation;
    }>
  | Readonly<{
      state:
        "SUBMITTED";

      reservation:
        DialogueReservation;

      submission:
        DialogueSubmission;
    }>
  | Readonly<{
      state:
        "COMPLETED";

      reservation:
        DialogueReservation;

      submission:
        DialogueSubmission;

      completion:
        DialogueCompletion;
    }>;

function assertSubmissionMatchesReservation(
  reservation:
    DialogueReservation,

  submission:
    DialogueSubmission,
): void {
  if (
    submission.reservationId !==
    reservation.reservationId
  ) {
    throw new Error(
      "Dialogue lifecycle submission reservation ID does not match the durable reservation.",
    );
  }

  if (
    submission.provider !==
    reservation.provider
  ) {
    throw new Error(
      "Dialogue lifecycle submission provider does not match the durable reservation.",
    );
  }

  if (
    submission.episodeId !==
    reservation.episodeId
  ) {
    throw new Error(
      "Dialogue lifecycle submission episode does not match the durable reservation.",
    );
  }

  if (
    submission.sceneId !==
    reservation.sceneId
  ) {
    throw new Error(
      "Dialogue lifecycle submission scene does not match the durable reservation.",
    );
  }

  if (
    submission.shotId !==
    reservation.shotId
  ) {
    throw new Error(
      "Dialogue lifecycle submission shot does not match the durable reservation.",
    );
  }

  if (
    submission.dialogueLineId !==
    reservation.dialogueLineId
  ) {
    throw new Error(
      "Dialogue lifecycle submission dialogue line does not match the durable reservation.",
    );
  }

  if (
    submission.planKey !==
    reservation.planKey
  ) {
    throw new Error(
      "Dialogue lifecycle submission planKey does not match the durable reservation.",
    );
  }
}

function assertCompletionMatchesLifecycle(
  reservation:
    DialogueReservation,

  submission:
    DialogueSubmission,

  completion:
    DialogueCompletion,
): void {
  if (
    completion.reservationId !==
    reservation.reservationId
  ) {
    throw new Error(
      "Dialogue lifecycle completion reservation ID does not match the durable reservation.",
    );
  }

  if (
    completion.provider !==
      reservation.provider ||
    completion.provider !==
      submission.provider
  ) {
    throw new Error(
      "Dialogue lifecycle completion provider does not match the prior lifecycle records.",
    );
  }

  if (
    completion.episodeId !==
      reservation.episodeId ||
    completion.episodeId !==
      submission.episodeId
  ) {
    throw new Error(
      "Dialogue lifecycle completion episode does not match the prior lifecycle records.",
    );
  }

  if (
    completion.sceneId !==
      reservation.sceneId ||
    completion.sceneId !==
      submission.sceneId
  ) {
    throw new Error(
      "Dialogue lifecycle completion scene does not match the prior lifecycle records.",
    );
  }

  if (
    completion.shotId !==
      reservation.shotId ||
    completion.shotId !==
      submission.shotId
  ) {
    throw new Error(
      "Dialogue lifecycle completion shot does not match the prior lifecycle records.",
    );
  }

  if (
    completion.dialogueLineId !==
      reservation.dialogueLineId ||
    completion.dialogueLineId !==
      submission.dialogueLineId
  ) {
    throw new Error(
      "Dialogue lifecycle completion dialogue line does not match the prior lifecycle records.",
    );
  }

  if (
    completion.planKey !==
      reservation.planKey ||
    completion.planKey !==
      submission.planKey
  ) {
    throw new Error(
      "Dialogue lifecycle completion planKey does not match the prior lifecycle records.",
    );
  }

  if (
    completion.providerExecutionId !==
    submission.providerExecutionId
  ) {
    throw new Error(
      "Dialogue lifecycle completion provider execution ID does not match the durable submission.",
    );
  }
}

export function classifyDialogueLifecycle(
  input:
    DialogueLifecycleClassificationInput,
): DialogueLifecycleClassification {
  const {
    reservation,
    submission,
    completion,
  } = input;

  if (!reservation) {
    if (submission) {
      throw new Error(
        "Dialogue lifecycle submission exists without a durable reservation.",
      );
    }

    if (completion) {
      throw new Error(
        "Dialogue lifecycle completion exists without a durable reservation.",
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
        "Dialogue lifecycle completion exists without a durable submission.",
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
