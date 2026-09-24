import {
  createRunwayClient,
} from "../../runway/createRunwayClient.js";

import type {
  RunwayCredentialSource,
} from "../../runway/runway.types.js";

import {
  buildRunwayGen45Prompt,
} from "../../runway/cli/buildRunwayGen45Prompt.js";

import {
  loadRunwayPolicy,
} from "../../validation/loadRunwayPolicy.js";

import {
  createRunwaySingleShotProductionTransactionRunner,
} from "./createRunwaySingleShotProductionTransactionRunner.js";

import {
  executeRunwaySingleShot,
} from "./executeRunwaySingleShot.js";

import type {
  SingleShotProviderExecutor,
} from "../singleShotExecution.types.js";

export type RunwaySingleShotProductionExecutorDependencies =
  Readonly<{
    loadPolicy:
      typeof loadRunwayPolicy;

    createClient:
      typeof createRunwayClient;

    createTransactionRunner:
      typeof createRunwaySingleShotProductionTransactionRunner;

    buildPrompt:
      typeof buildRunwayGen45Prompt;

    executeAdapter:
      typeof executeRunwaySingleShot;
  }>;

const defaultDependencies:
  RunwaySingleShotProductionExecutorDependencies =
  Object.freeze({
    loadPolicy:
      loadRunwayPolicy,

    createClient:
      createRunwayClient,

    createTransactionRunner:
      createRunwaySingleShotProductionTransactionRunner,

    buildPrompt:
      buildRunwayGen45Prompt,

    executeAdapter:
      executeRunwaySingleShot,
  });

export async function prepareRunwaySingleShotProductionExecutor(
  credentialSource:
    RunwayCredentialSource,

  dependencies:
    RunwaySingleShotProductionExecutorDependencies =
      defaultDependencies,
): Promise<SingleShotProviderExecutor> {
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

export function createRunwaySingleShotProductionExecutor(
  credentialSource:
    RunwayCredentialSource,

  dependencies:
    RunwaySingleShotProductionExecutorDependencies =
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
        prepareRunwaySingleShotProductionExecutor(
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
