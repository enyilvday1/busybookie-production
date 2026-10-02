import {
  createRunwayClient,
} from "../runway/createRunwayClient.js";

import type {
  RunwayCredentialSource,
} from "../runway/runway.types.js";

import {
  loadDialogueVoicePolicy,
} from "../validation/loadDialogueVoicePolicy.js";

import {
  createDialogueReservation,
} from "./createDialogueReservation.js";

import {
  createDialogueSubmission,
} from "./createDialogueSubmission.js";

import {
  createRunwayDialogueProductionTransactionRunner,
} from "./createRunwayDialogueProductionTransactionRunner.js";

import {
  executeDialogueLine,
  type ExecuteDialogueLineInput,
  type ExecuteDialogueLineResult,
} from "./executeDialogueLine.js";

import {
  recoverDialogueCompletion,
} from "./recoverDialogueCompletion.js";

export type RunwayDialogueProductionExecutionInput =
  Omit<
    ExecuteDialogueLineInput,
    "policy"
  >;

export type RunwayDialogueProductionExecutor =
  (
    input:
      RunwayDialogueProductionExecutionInput,
  ) =>
    Promise<
      ExecuteDialogueLineResult
    >;

export type RunwayDialogueProductionExecutorDependencies =
  Readonly<{
    loadPolicy:
      typeof loadDialogueVoicePolicy;

    createClient:
      typeof createRunwayClient;

    createTransactionRunner:
      typeof createRunwayDialogueProductionTransactionRunner;

    createReservation:
      typeof createDialogueReservation;

    createSubmission:
      typeof createDialogueSubmission;

    recoverCompletion:
      typeof recoverDialogueCompletion;

    executeLifecycle:
      typeof executeDialogueLine;
  }>;

const defaultDependencies:
  RunwayDialogueProductionExecutorDependencies =
    Object.freeze({
      loadPolicy:
        loadDialogueVoicePolicy,

      createClient:
        createRunwayClient,

      createTransactionRunner:
        createRunwayDialogueProductionTransactionRunner,

      createReservation:
        createDialogueReservation,

      createSubmission:
        createDialogueSubmission,

      recoverCompletion:
        recoverDialogueCompletion,

      executeLifecycle:
        executeDialogueLine,
    });

export async function prepareRunwayDialogueProductionExecutor(
  credentialSource:
    RunwayCredentialSource,

  dependencies:
    RunwayDialogueProductionExecutorDependencies =
      defaultDependencies,
): Promise<
  RunwayDialogueProductionExecutor
> {
  const policy =
    await dependencies
      .loadPolicy();

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
        {
          ...input,

          policy,
        },
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

export function createRunwayDialogueProductionExecutor(
  credentialSource:
    RunwayCredentialSource,

  dependencies:
    RunwayDialogueProductionExecutorDependencies =
      defaultDependencies,
): RunwayDialogueProductionExecutor {
  let preparedExecutorPromise:
    Promise<
      RunwayDialogueProductionExecutor
    > | null =
      null;

  return async (
    input,
  ) => {
    if (
      !preparedExecutorPromise
    ) {
      preparedExecutorPromise =
        prepareRunwayDialogueProductionExecutor(
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
