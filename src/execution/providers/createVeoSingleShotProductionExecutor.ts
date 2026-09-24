import {
  createVeoClient,
} from "../../veo/createVeoClient.js";

import {
  buildVeoPrompt,
} from "../../veo/cli/buildVeoPrompt.js";

import {
  loadVeoPolicy,
} from "../../validation/loadVeoPolicy.js";

import {
  createVeoSingleShotProductionTransactionRunner,
} from "./createVeoSingleShotProductionTransactionRunner.js";

import {
  executeVeoSingleShot,
} from "./executeVeoSingleShot.js";

import type {
  SingleShotProviderExecutor,
} from "../singleShotExecution.types.js";

export type VeoSingleShotProductionExecutorDependencies =
  Readonly<{
    loadPolicy:
      typeof loadVeoPolicy;

    createClient:
      typeof createVeoClient;

    createTransactionRunner:
      typeof createVeoSingleShotProductionTransactionRunner;

    buildPrompt:
      typeof buildVeoPrompt;

    executeAdapter:
      typeof executeVeoSingleShot;
  }>;

const defaultDependencies:
  VeoSingleShotProductionExecutorDependencies =
  Object.freeze({
    loadPolicy:
      loadVeoPolicy,

    createClient:
      createVeoClient,

    createTransactionRunner:
      createVeoSingleShotProductionTransactionRunner,

    buildPrompt:
      buildVeoPrompt,

    executeAdapter:
      executeVeoSingleShot,
  });

export async function prepareVeoSingleShotProductionExecutor(
  apiKey:
    string,

  dependencies:
    VeoSingleShotProductionExecutorDependencies =
      defaultDependencies,
): Promise<SingleShotProviderExecutor> {
  const policy =
    await dependencies
      .loadPolicy();

  const client =
    dependencies
      .createClient(
        apiKey,
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
      .executeAdapter(
        input,
        {
          policy,

          buildPrompt:
            dependencies
              .buildPrompt,

          runTransaction,
        },
      );
}

export function createVeoSingleShotProductionExecutor(
  apiKey:
    string,

  dependencies:
    VeoSingleShotProductionExecutorDependencies =
      defaultDependencies,
): SingleShotProviderExecutor {
  let preparedExecutorPromise:
    Promise<SingleShotProviderExecutor> | null =
    null;

  return async (
    input,
  ) => {
    if (!preparedExecutorPromise) {
      preparedExecutorPromise =
        prepareVeoSingleShotProductionExecutor(
          apiKey,
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
