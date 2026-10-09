import {
  loadCharacterBible,
} from "../../validation/loadCharacterBible.js";

import {
  loadEnvironment,
} from "../../validation/loadEnvironment.js";

import {
  loadEpisodeManifest,
} from "../../validation/loadEpisodeManifest.js";

import {
  loadProductionRules,
} from "../../validation/loadProductionRules.js";

import {
  loadProviderRoutingPolicy,
} from "../../validation/loadProviderRoutingPolicy.js";

import {
  validateEpisodeProduction,
} from "../../validation/validateEpisodeProduction.js";

import {
  validateMediaRoot,
} from "../../validation/validateMediaRoot.js";

import {
  createProductionSingleShotExecutionDependencies,
} from "../createProductionSingleShotExecutionDependencies.js";

import {
  executeSingleShot,
} from "../executeSingleShot.js";

import {
  inspectExecutionLifecycle,
} from "../inspectExecutionLifecycle.js";

import {
  parseSingleShotExecutionCliArgs,
} from "./singleShotExecutionCliArgs.js";

export type RunSingleShotExecutionCliDependencies =
  Readonly<{
    loadEnvironment:
      typeof loadEnvironment;

    loadEpisodeManifest:
      typeof loadEpisodeManifest;

    loadCharacterBible:
      typeof loadCharacterBible;

    loadProductionRules:
      typeof loadProductionRules;

    loadProviderRoutingPolicy:
      typeof loadProviderRoutingPolicy;

    validateEpisodeProduction:
      typeof validateEpisodeProduction;

    validateMediaRoot:
      typeof validateMediaRoot;

    inspectExecutionLifecycle:
      typeof inspectExecutionLifecycle;

    createDependencies:
      typeof createProductionSingleShotExecutionDependencies;

    executeSingleShot:
      typeof executeSingleShot;
  }>;

const defaultDependencies:
  RunSingleShotExecutionCliDependencies =
  Object.freeze({
    loadEnvironment,
    loadEpisodeManifest,
    loadCharacterBible,
    loadProductionRules,
    loadProviderRoutingPolicy,
    validateEpisodeProduction,
    validateMediaRoot,
    inspectExecutionLifecycle,
    createDependencies: createProductionSingleShotExecutionDependencies,
    executeSingleShot,
  });

export async function runSingleShotExecutionCli(
  args:
    readonly string[] =
      process.argv.slice(
        2
      ),

  dependencies:
    RunSingleShotExecutionCliDependencies =
      defaultDependencies,
): Promise<void> {
  const options = parseSingleShotExecutionCliArgs(
    args
  );

  const env = dependencies.loadEnvironment();

  const [
    episode,
    bible,
    rules,
    policy
  ] = await Promise.all([
    dependencies.loadEpisodeManifest(
      options.episodeId
    ),
    dependencies.loadCharacterBible(),
    dependencies.loadProductionRules(),
    dependencies.loadProviderRoutingPolicy(),
  ]);

  if (
    episode.episodeId !== options.episodeId
  ) {
    throw new Error(
      "Loaded episode identity does not match --episode."
    );
  }

  dependencies.validateEpisodeProduction(
    episode,
    bible,
    rules
  );

  const mediaRoot = await dependencies.validateMediaRoot(
    env,
    rules
  );

  const reconciliationGuidance =
    `Inspect durable evidence with npm run execution:reconcile -- --episode ${options.episodeId} --shot ${options.shotId}. Do not delete lifecycle records or automatically retry generation.`;

  try {
    const lifecycle = await dependencies.inspectExecutionLifecycle(
      mediaRoot,
      options.episodeId,
      options.shotId,
    );

    if (
      lifecycle.state !== "NOTHING"
    ) {
      throw new Error(
        `Existing execution lifecycle state is ${lifecycle.state}.`
      );
    }
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Lifecycle inspection failed.";

    throw new Error(
      `Single-shot execution blocked: ${detail} ${reconciliationGuidance}`,
      {
        cause: error
      }
    );
  }

  const executionDependencies = dependencies.createDependencies({
    ...(
      env.RUNWAYML_API_SECRET === undefined
        ? {}
        : {
            RUNWAYML_API_SECRET: env.RUNWAYML_API_SECRET
          }
    ),
    ...(
      env.GEMINI_API_KEY === undefined
        ? {}
        : {
            GEMINI_API_KEY: env.GEMINI_API_KEY
          }
    ),
  });

  // The secured executor owns readiness, confirmation, verification and the
  // durable lifecycle. In particular, only its verified path reaches a provider.
  let result;

  try {
    result = await dependencies.executeSingleShot(
      {
        episode,
        shotId: options.shotId,
        bible,
        rules,
        policy,
        mediaRoot,
        sourceImagePath: options.sourceImagePath,
        confirmPaidGeneration: options.confirmPaidGeneration,
      },
      executionDependencies
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Unknown secured execution error.";

    throw new Error(
      `${detail} If execution evidence was created, ${reconciliationGuidance}`,
      {
        cause: error
      }
    );
  }

  console.log(
    `Single-shot execution completed: ${episode.episodeId}/${options.shotId} (${result.provider})`
  );
  console.log(
    `Provider execution: ${result.providerExecution.providerExecutionId}`
  );
  console.log(
    `Completion record: ${result.completion.completionPath}`
  );
}
