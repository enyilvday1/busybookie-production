import type {
  ShotDialoguePlan,
  ShotDialoguePlanLine,
} from "./buildShotDialoguePlan.js";

import {
  createDialogueDirectSeedAudioReservation,
  type CreateDialogueDirectSeedAudioReservationResult,
} from "./createDialogueDirectSeedAudioReservation.js";

import {
  createDialogueDirectSeedAudioSubmission,
  type CreateDialogueDirectSeedAudioSubmissionResult,
} from "./createDialogueDirectSeedAudioSubmission.js";

import type {
  DialogueCompletionInput,
} from "./dialogueCompletion.schema.js";

import type {
  DialogueDirectSeedAudioSubmissionInput,
} from "./dialogueSubmission.schema.js";

import {
  recoverDialogueDirectSeedAudioCompletion,
  type RecoverDialogueDirectSeedAudioCompletionResult,
} from "./recoverDialogueDirectSeedAudioCompletion.js";

import type {
  DialogueDirectSeedAudioGenerationRecoveryMetadata,
  RunwayDirectSeedAudioDialogueTransactionInput,
  RunwayDirectSeedAudioDialogueTransactionResult,
} from "./runRunwayDirectSeedAudioDialogueTransaction.js";

export type DialogueDirectSeedAudioSubmissionAcceptance =
  Readonly<{
    taskId:
      string;

    providerEstimatedCredits:
      number;

    recoveryMetadata:
      DialogueDirectSeedAudioGenerationRecoveryMetadata;
  }>;

export type DialogueDirectSeedAudioSubmissionAcceptedHandler =
  (
    acceptance:
      DialogueDirectSeedAudioSubmissionAcceptance,
  ) =>
    Promise<void>;

export type DialogueDirectSeedAudioLineTransactionRunner =
  (
    input:
      RunwayDirectSeedAudioDialogueTransactionInput,

    onSubmissionAccepted:
      DialogueDirectSeedAudioSubmissionAcceptedHandler,
  ) =>
    Promise<
      RunwayDirectSeedAudioDialogueTransactionResult
    >;

export type ExecuteDialogueDirectSeedAudioLineInput =
  Readonly<{
    plan:
      ShotDialoguePlan;

    dialogueLineId:
      string;

    mediaRoot:
      string;

    ffprobeExecutable:
      string;

    localCreditCeiling:
      number;

    waitTimeoutMs:
      number;

    confirmPaidGeneration:
      boolean;
  }>;

export type ExecuteDialogueDirectSeedAudioLineDependencies =
  Readonly<{
    createReservation:
      typeof createDialogueDirectSeedAudioReservation;

    createSubmission:
      typeof createDialogueDirectSeedAudioSubmission;

    runTransaction:
      DialogueDirectSeedAudioLineTransactionRunner;

    recoverCompletion:
      typeof recoverDialogueDirectSeedAudioCompletion;
  }>;

export type ExecuteDialogueDirectSeedAudioLineResult =
  Readonly<{
    reservation:
      CreateDialogueDirectSeedAudioReservationResult;

    submission:
      CreateDialogueDirectSeedAudioSubmissionResult;

    providerExecution:
      RunwayDirectSeedAudioDialogueTransactionResult;

    completion:
      RecoverDialogueDirectSeedAudioCompletionResult;
  }>;

function requireDialogueLine(
  plan:
    ShotDialoguePlan,

  dialogueLineId:
    string,
): ShotDialoguePlanLine {
  const requestedId =
    dialogueLineId.trim();

  if (!requestedId) {
    throw new Error(
      "Direct SeedAudio paid execution requires a non-empty dialogue line ID.",
    );
  }

  if (
    requestedId !==
    dialogueLineId
  ) {
    throw new Error(
      "Direct SeedAudio paid execution requires the exact canonical dialogue line ID without surrounding whitespace.",
    );
  }

  const matches =
    plan.lines.filter(
      (line) =>
        line.dialogueLineId ===
        requestedId,
    );

  if (
    matches.length !==
    1
  ) {
    throw new Error(
      `Direct SeedAudio paid execution requires exactly one canonical line ${requestedId} in the supplied dialogue plan.`,
    );
  }

  const line =
    matches[0];

  if (!line) {
    throw new Error(
      `Direct SeedAudio dialogue line ${requestedId} was not found in the canonical dialogue plan.`,
    );
  }

  return line;
}

function requireReferenceAudioVoice(
  line:
    ShotDialoguePlanLine,
): void {
  const voice =
    line.voice;

  if (
    !(
      "executionMode" in
      voice
    ) ||
    voice.executionMode !==
      "RUNWAY_REFERENCE_AUDIO" ||
    voice.selectionStatus !==
      "LOCKED" ||
    voice.provider !==
      "RUNWAY" ||
    !(
      "referenceAudio" in
      voice
    )
  ) {
    throw new Error(
      `Direct SeedAudio paid execution requires a LOCKED RUNWAY_REFERENCE_AUDIO voice for ${line.dialogueLineId}.`,
    );
  }
}

function requireLocalCreditCeiling(
  value:
    number,
): number {
  if (
    !Number.isFinite(
      value,
    ) ||
    value <
      0
  ) {
    throw new Error(
      "Direct SeedAudio paid execution local credit ceiling must be finite and nonnegative.",
    );
  }

  return value;
}

function requireWaitTimeoutMs(
  value:
    number,
): number {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value <=
      0
  ) {
    throw new Error(
      "Direct SeedAudio paid execution wait timeout must be a positive safe integer.",
    );
  }

  return value;
}

function requireProviderEstimatedCredits(
  value:
    number,
): number {
  if (
    !Number.isFinite(
      value,
    ) ||
    value <
      0
  ) {
    throw new Error(
      "Direct SeedAudio accepted provider estimated credits must be finite and nonnegative.",
    );
  }

  return value;
}

function requireDurableSubmission(
  value:
    CreateDialogueDirectSeedAudioSubmissionResult | null,

  dialogueLineId:
    string,
): CreateDialogueDirectSeedAudioSubmissionResult {
  if (!value) {
    throw new Error(
      `Direct SeedAudio provider execution for ${dialogueLineId} completed without durable submission acceptance.`,
    );
  }

  return value;
}

function requireAcceptedProviderExecutionId(
  value:
    string | null,

  dialogueLineId:
    string,
): string {
  if (!value) {
    throw new Error(
      `Direct SeedAudio provider execution for ${dialogueLineId} completed without durable submission acceptance.`,
    );
  }

  return value;
}

export async function executeDialogueDirectSeedAudioLine(
  input:
    ExecuteDialogueDirectSeedAudioLineInput,

  dependencies:
    ExecuteDialogueDirectSeedAudioLineDependencies,
): Promise<
  ExecuteDialogueDirectSeedAudioLineResult
> {
  const line =
    requireDialogueLine(
      input.plan,
      input.dialogueLineId,
    );

  requireReferenceAudioVoice(
    line,
  );

  const localCreditCeiling =
    requireLocalCreditCeiling(
      input.localCreditCeiling,
    );

  const waitTimeoutMs =
    requireWaitTimeoutMs(
      input.waitTimeoutMs,
    );

  if (
    !input.confirmPaidGeneration
  ) {
    throw new Error(
      "Direct SeedAudio paid-generation confirmation is required before creating a dialogue reservation.",
    );
  }

  const reservation =
    await dependencies
      .createReservation(
        input.mediaRoot,
        {
          episodeId:
            input.plan.episodeId,

          sceneId:
            input.plan.sceneId,

          shotId:
            input.plan.shotId,

          dialogueLineId:
            line.dialogueLineId,

          planKey:
            input.plan.planKey,

          provider:
            "RUNWAY",
        },
      );

  let submission:
    CreateDialogueDirectSeedAudioSubmissionResult | null =
      null;

  let acceptedProviderExecutionId:
    string | null =
      null;

  const onSubmissionAccepted:
    DialogueDirectSeedAudioSubmissionAcceptedHandler =
      async (
        acceptance,
      ) => {
        if (
          submission ||
          acceptedProviderExecutionId
        ) {
          throw new Error(
            `Direct SeedAudio provider submission acceptance was received more than once for ${line.dialogueLineId}.`,
          );
        }

        const normalizedTaskId =
          acceptance.taskId.trim();

        if (!normalizedTaskId) {
          throw new Error(
            `Direct SeedAudio provider submission acceptance returned an empty task ID for ${line.dialogueLineId}.`,
          );
        }

        const providerEstimatedCredits =
          requireProviderEstimatedCredits(
            acceptance
              .providerEstimatedCredits,
          );

        const submissionInput:
          DialogueDirectSeedAudioSubmissionInput = {
            reservationId:
              reservation.record
                .reservationId,

            episodeId:
              input.plan.episodeId,

            sceneId:
              input.plan.sceneId,

            shotId:
              input.plan.shotId,

            dialogueLineId:
              line.dialogueLineId,

            planKey:
              input.plan.planKey,

            provider:
              "RUNWAY",

            providerExecutionId:
              normalizedTaskId,

            providerEstimatedCredits,

            recoveryMetadata:
              acceptance
                .recoveryMetadata,
          };

        const durableSubmission =
          await dependencies
            .createSubmission(
              input.mediaRoot,
              submissionInput,
            );

        submission =
          durableSubmission;

        acceptedProviderExecutionId =
          normalizedTaskId;
      };

  const providerExecution =
    await dependencies
      .runTransaction(
        {
          plan:
            input.plan,

          dialogueLineId:
            line.dialogueLineId,

          mediaRoot:
            input.mediaRoot,

          ffprobeExecutable:
            input.ffprobeExecutable,

          localCreditCeiling,

          waitTimeoutMs,
        },
        onSubmissionAccepted,
      );

  const durableSubmission =
    requireDurableSubmission(
      submission,
      line.dialogueLineId,
    );

  const durableAcceptedProviderExecutionId =
    requireAcceptedProviderExecutionId(
      acceptedProviderExecutionId,
      line.dialogueLineId,
    );

  const returnedProviderExecutionId =
    providerExecution
      .record
      .providerExecutionId
      .trim();

  if (
    !returnedProviderExecutionId
  ) {
    throw new Error(
      `Direct SeedAudio provider execution for ${line.dialogueLineId} returned an empty provider execution ID.`,
    );
  }

  if (
    returnedProviderExecutionId !==
    durableAcceptedProviderExecutionId
  ) {
    throw new Error(
      `Direct SeedAudio provider execution ID ${returnedProviderExecutionId} does not match accepted submission ID ${acceptedProviderExecutionId} for ${line.dialogueLineId}.`,
    );
  }

  if (
    providerExecution
      .record
      .provider !==
    "RUNWAY"
  ) {
    throw new Error(
      `Direct SeedAudio provider execution returned provider ${providerExecution.record.provider} for ${line.dialogueLineId}; expected RUNWAY.`,
    );
  }

  if (
    providerExecution
      .record
      .credits
      .providerEstimated !==
    durableSubmission.record
      .providerEstimatedCredits
  ) {
    throw new Error(
      `Direct SeedAudio provider estimated credits do not match the durable submission for ${line.dialogueLineId}.`,
    );
  }

  const returnedPlan =
    providerExecution
      .record
      .plan;

  if (
    returnedPlan.episodeId !==
      input.plan.episodeId ||
    returnedPlan.sceneId !==
      input.plan.sceneId ||
    returnedPlan.shotId !==
      input.plan.shotId ||
    returnedPlan.dialogueLineId !==
      line.dialogueLineId ||
    returnedPlan.planKey !==
      input.plan.planKey
  ) {
    throw new Error(
      `Direct SeedAudio provider generation record identity does not match the reserved canonical plan for ${line.dialogueLineId}.`,
    );
  }

  const generationRecordPath =
    providerExecution
      .recordPath
      .trim();

  if (!generationRecordPath) {
    throw new Error(
      `Direct SeedAudio provider execution for ${line.dialogueLineId} returned an empty generation record path.`,
    );
  }

  const completionInput:
    DialogueCompletionInput = {
      reservationId:
        reservation.record
          .reservationId,

      episodeId:
        input.plan.episodeId,

      sceneId:
        input.plan.sceneId,

      shotId:
        input.plan.shotId,

      dialogueLineId:
        line.dialogueLineId,

      planKey:
        input.plan.planKey,

      provider:
        "RUNWAY",

      providerExecutionId:
        returnedProviderExecutionId,

      generationRecordPath,
    };

  const completion =
    await dependencies
      .recoverCompletion(
        input.mediaRoot,
        completionInput,
      );

  return Object.freeze({
    reservation,
    submission:
      durableSubmission,

    providerExecution,
    completion,
  });
}
