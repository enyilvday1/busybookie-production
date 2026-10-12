import {
  createRunwayClient,
} from "../runway/createRunwayClient.js";

import type {
  RunwayCredentialSource,
} from "../runway/runway.types.js";

import {
  admitDialogueLineGeneration,
} from "./admitDialogueLineGeneration.js";

import {
  createDialogueDirectSeedAudioReservation,
} from "./createDialogueDirectSeedAudioReservation.js";

import {
  createDialogueDirectSeedAudioSubmission,
} from "./createDialogueDirectSeedAudioSubmission.js";

import {
  createRunwayDirectSeedAudioProductionTransactionRunner,
} from "./createRunwayDirectSeedAudioProductionTransactionRunner.js";

import {
  executeDialogueDirectSeedAudioLine,
  type ExecuteDialogueDirectSeedAudioLineInput,
  type ExecuteDialogueDirectSeedAudioLineResult,
} from "./executeDialogueDirectSeedAudioLine.js";

import {
  recoverDialogueDirectSeedAudioCompletion,
} from "./recoverDialogueDirectSeedAudioCompletion.js";

export type RunwayDirectSeedAudioProductionExecutionInput =
  ExecuteDialogueDirectSeedAudioLineInput;

export type RunwayDirectSeedAudioProductionExecutor =
  (
    input:
      RunwayDirectSeedAudioProductionExecutionInput,
  ) =>
    Promise<
      ExecuteDialogueDirectSeedAudioLineResult
    >;

export type RunwayDirectSeedAudioProductionExecutorDependencies =
  Readonly<{
    createClient:
      typeof createRunwayClient;

    createTransactionRunner:
      typeof createRunwayDirectSeedAudioProductionTransactionRunner;

    createReservation:
      typeof createDialogueDirectSeedAudioReservation;

    createSubmission:
      typeof createDialogueDirectSeedAudioSubmission;

    recoverCompletion:
      typeof recoverDialogueDirectSeedAudioCompletion;

    executeLifecycle:
      typeof executeDialogueDirectSeedAudioLine;

    admitGeneration:
      typeof admitDialogueLineGeneration;
  }>;

const defaultDependencies:
  RunwayDirectSeedAudioProductionExecutorDependencies =
    Object.freeze({
      createClient:
        createRunwayClient,

      createTransactionRunner:
        createRunwayDirectSeedAudioProductionTransactionRunner,

      createReservation:
        createDialogueDirectSeedAudioReservation,

      createSubmission:
        createDialogueDirectSeedAudioSubmission,

      recoverCompletion:
        recoverDialogueDirectSeedAudioCompletion,

      executeLifecycle:
        executeDialogueDirectSeedAudioLine,

      admitGeneration:
        admitDialogueLineGeneration,
    });

export async function prepareRunwayDirectSeedAudioProductionExecutor(
  credentialSource:
    RunwayCredentialSource,

  dependencies:
    RunwayDirectSeedAudioProductionExecutorDependencies =
      defaultDependencies,
): Promise<
  RunwayDirectSeedAudioProductionExecutor
> {
  const client =
    dependencies
      .createClient(
        credentialSource,
      );

  const runTransaction =
    dependencies
      .createTransactionRunner(
        client,
      );

  // C6a: paid confirmation, then the shared per-line admission (new or exact
  // resume), strictly before the unchanged namespace reservation and provider.
  return async (
    input,
  ) => {
    await dependencies
      .admitGeneration({
        mediaRoot:
          input.mediaRoot,

        plan:
          input.plan,

        dialogueLineId:
          input.dialogueLineId,

        generationNamespace:
          "DIRECT_SEED_AUDIO",

        confirmPaidGeneration:
          input.confirmPaidGeneration,
      });

    return dependencies
      .executeLifecycle(
        input,
        {
          createReservation:
            dependencies
              .createReservation,

          createSubmission:
            dependencies
              .createSubmission,

          runTransaction,

          recoverCompletion:
            dependencies
              .recoverCompletion,
        },
      );
  };
}

export function createRunwayDirectSeedAudioProductionExecutor(
  credentialSource:
    RunwayCredentialSource,

  dependencies:
    RunwayDirectSeedAudioProductionExecutorDependencies =
      defaultDependencies,
): RunwayDirectSeedAudioProductionExecutor {
  let preparedExecutorPromise:
    Promise<
      RunwayDirectSeedAudioProductionExecutor
    > | null =
      null;

  return async (
    input,
  ) => {
    if (
      !preparedExecutorPromise
    ) {
      preparedExecutorPromise =
        prepareRunwayDirectSeedAudioProductionExecutor(
          credentialSource,
          dependencies,
        );
    }

    const preparedExecutor =
      await preparedExecutorPromise;

    return preparedExecutor(
      input,
    );
  };
}
