import type {
  DialogueVoicePolicy,
} from "../schemas/dialogueVoicePolicy.schema.js";

import {
  buildRunwayElevenV3Request,
} from "./buildRunwayElevenV3Request.js";

import type {
  ShotDialoguePlan,
  ShotDialoguePlanLine,
} from "./buildShotDialoguePlan.js";

import type {
  CreateDialogueReservationResult,
} from "./createDialogueReservation.js";

import type {
  DialogueReservationInput,
} from "./dialogueReservation.schema.js";

import type {
  CreateDialogueSubmissionResult,
} from "./createDialogueSubmission.js";

import type {
  DialogueSubmissionInput,
} from "./dialogueSubmission.schema.js";

import {
  assertDialogueWithinBudget,
} from "./dialogueVoiceBudget.js";

import type {
  DialogueGenerationRecoveryMetadata,
  RunwayElevenV3DialogueTransactionInput,
  RunwayElevenV3DialogueTransactionResult,
} from "./runRunwayElevenV3Transaction.js";

import type {
  DialogueCompletionInput,
} from "./dialogueCompletion.schema.js";

import type {
  RecoverDialogueCompletionResult,
} from "./recoverDialogueCompletion.js";

export type DialogueLineSubmissionAcceptance =
  Readonly<{
    taskId:
      string;

    providerEstimatedCredits:
      number;

    recoveryMetadata:
      DialogueGenerationRecoveryMetadata;
  }>;

export type DialogueLineSubmissionAcceptedHandler =
  (
    acceptance:
      DialogueLineSubmissionAcceptance,
  ) =>
    Promise<void>;

export type DialogueLineTransactionRunner =
  (
    input:
      RunwayElevenV3DialogueTransactionInput,

    onSubmissionAccepted:
      DialogueLineSubmissionAcceptedHandler,
  ) =>
    Promise<
      RunwayElevenV3DialogueTransactionResult
    >;

export type ExecuteDialogueLineInput =
  Readonly<{
    plan:
      ShotDialoguePlan;

    dialogueLineId:
      string;

    mediaRoot:
      string;

    policy:
      DialogueVoicePolicy;

    confirmPaidGeneration:
      boolean;
  }>;

export type ExecuteDialogueLineDependencies =
  Readonly<{
    createReservation:
      (
        mediaRoot:
          string,

        input:
          DialogueReservationInput,
      ) =>
        Promise<
          CreateDialogueReservationResult
        >;

    createSubmission:
      (
        mediaRoot:
          string,

        input:
          DialogueSubmissionInput,
      ) =>
        Promise<
          CreateDialogueSubmissionResult
        >;

    runTransaction:
      DialogueLineTransactionRunner;

    recoverCompletion:
      (
        mediaRoot:
          string,

        input:
          DialogueCompletionInput,
      ) =>
        Promise<
          RecoverDialogueCompletionResult
        >;
  }>;

export type ExecuteDialogueLineResult =
  Readonly<{
    reservation:
      CreateDialogueReservationResult;

    submission:
      CreateDialogueSubmissionResult;

    providerExecution:
      RunwayElevenV3DialogueTransactionResult;

    completion:
      RecoverDialogueCompletionResult;
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
      "Dialogue paid execution requires a non-empty dialogue line ID.",
    );
  }

  if (
    requestedId !==
    dialogueLineId
  ) {
    throw new Error(
      "Dialogue paid execution requires the exact canonical dialogue line ID without surrounding whitespace.",
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
      `Dialogue paid execution requires exactly one canonical line ${requestedId} in the supplied dialogue plan.`,
    );
  }

  const line =
    matches[0];

  if (!line) {
    throw new Error(
      `Dialogue line ${requestedId} was not found in the canonical dialogue plan.`,
    );
  }

  return line;
}

function requireRunwayVoiceProvider(
  line:
    ShotDialoguePlanLine,
): void {
  if (
    line.voice.provider !==
    "RUNWAY"
  ) {
    throw new Error(
      `Dialogue paid execution requires RUNWAY as the locked voice provider for ${line.dialogueLineId}.`,
    );
  }
}

function preflightDialogueGeneration(
  line:
    ShotDialoguePlanLine,

  policy:
    DialogueVoicePolicy,
): void {
  assertDialogueWithinBudget(
    line.text,
    policy,
  );

  buildRunwayElevenV3Request({
    line,
    policy,
  });
}

export async function executeDialogueLine(
  input:
    ExecuteDialogueLineInput,

  dependencies:
    ExecuteDialogueLineDependencies,
): Promise<
  ExecuteDialogueLineResult
> {
  const line =
    requireDialogueLine(
      input.plan,
      input.dialogueLineId,
    );

  requireRunwayVoiceProvider(
    line,
  );

  if (
    !input.confirmPaidGeneration
  ) {
    throw new Error(
      "Paid-generation confirmation is required before creating a dialogue reservation.",
    );
  }

  preflightDialogueGeneration(
    line,
    input.policy,
  );

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
    CreateDialogueSubmissionResult | null =
      null;

  let acceptedProviderExecutionId:
    string | null =
      null;

  let submissionAttempted =
    false;

  const onSubmissionAccepted:
    DialogueLineSubmissionAcceptedHandler =
      async (
        acceptance,
      ): Promise<void> => {
        if (
          submissionAttempted
        ) {
          throw new Error(
            `Dialogue provider submission acceptance was reported more than once for ${line.dialogueLineId}.`,
          );
        }

        submissionAttempted =
          true;

        const normalizedTaskId =
          acceptance.taskId.trim();

        if (!normalizedTaskId) {
          throw new Error(
            `Dialogue provider submission acceptance returned an empty task ID for ${line.dialogueLineId}.`,
          );
        }

        const durableSubmission =
          await dependencies
            .createSubmission(
              input.mediaRoot,
              {
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

                providerEstimatedCredits:
                  acceptance
                    .providerEstimatedCredits,

                recoveryMetadata:
                  acceptance
                    .recoveryMetadata,
              },
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

          policy:
            input.policy,
        },
        onSubmissionAccepted,
      );

  if (
    !submission ||
    !acceptedProviderExecutionId
  ) {
    throw new Error(
      `Dialogue provider execution for ${line.dialogueLineId} completed without durable submission acceptance.`,
    );
  }

  const returnedProviderExecutionId =
    providerExecution
      .record
      .providerExecutionId
      .trim();

  if (
    !returnedProviderExecutionId
  ) {
    throw new Error(
      `Dialogue provider execution for ${line.dialogueLineId} returned an empty provider execution ID.`,
    );
  }

  if (
    returnedProviderExecutionId !==
    acceptedProviderExecutionId
  ) {
    throw new Error(
      `Dialogue provider execution ID ${returnedProviderExecutionId} does not match accepted submission ID ${acceptedProviderExecutionId} for ${line.dialogueLineId}.`,
    );
  }

  if (
    providerExecution.record.provider !==
    "RUNWAY"
  ) {
    throw new Error(
      `Dialogue provider execution returned provider ${providerExecution.record.provider} for ${line.dialogueLineId}; expected RUNWAY.`,
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
      `Dialogue provider generation record identity does not match the reserved canonical plan for ${line.dialogueLineId}.`,
    );
  }

  const generationRecordPath =
    providerExecution
      .recordPath
      .trim();

  if (
    !generationRecordPath
  ) {
    throw new Error(
      `Dialogue provider execution for ${line.dialogueLineId} returned an empty generation record path.`,
    );
  }

  const completion =
    await dependencies
      .recoverCompletion(
        input.mediaRoot,
        {
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
        },
      );

  return Object.freeze({
    reservation,
    submission,
    providerExecution,
    completion,
  });
}
