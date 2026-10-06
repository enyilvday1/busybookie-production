import {
  createRunwayClient,
} from "../runway/createRunwayClient.js";

import type {
  RunwayCredentialSource,
} from "../runway/runway.types.js";

import {
  createDialogueReservation,
} from "./createDialogueReservation.js";

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
  recoverDialogueCompletion,
} from "./recoverDialogueCompletion.js";

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
      typeof createDialogueReservation;

    createSubmission:
      typeof createDialogueDirectSeedAudioSubmission;

    recoverCompletion:
      typeof recoverDialogueCompletion;

    executeLifecycle:
      typeof executeDialogueDirectSeedAudioLine;
  }>;

const defaultDependencies:
  RunwayDirectSeedAudioProductionExecutorDependencies =
    Object.freeze({
      createClient:
        createRunwayClient,

      createTransactionRunner:
        createRunwayDirectSeedAudioProductionTransactionRunner,

      createReservation:
        createDialogueReservation,

      createSubmission:
        createDialogueDirectSeedAudioSubmission,

      recoverCompletion:
        recoverDialogueCompletion,

      executeLifecycle:
        executeDialogueDirectSeedAudioLine,
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

  return async (
    input,
  ) =>
    dependencies
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
