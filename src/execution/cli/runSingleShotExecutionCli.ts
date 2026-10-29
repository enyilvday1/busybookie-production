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
  assertEpisodeApprovals,
  assertShotCanProgress,
} from "../../validation/validateEpisodeProduction.js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readBoundFile } from "../episodeInputBinding.js";
import { BoundEpisodeError } from "../boundEpisodeProduction.types.js";
import { EpisodeManifestSchema } from "../../schemas/episodeManifest.schema.js";
import { CharacterBibleSchema } from "../../schemas/character.schema.js";
import { ProductionRulesSchema } from "../../schemas/productionRules.schema.js";
import { ProviderRoutingPolicySchema } from "../../schemas/providerRoutingPolicy.schema.js";
import { acquireEpisodeExecutionGuard, releaseEpisodeExecutionGuard, checkedEpisodeExecutionData,
  assertCheckedEpisodeAdmission, readCheckedEpisodeJson, consumeEpisodeGenerationAllowance,
  type CheckedEpisodeExecutionContext } from "../episodeExecutionGuard.js";

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
  checkedContext?: CheckedEpisodeExecutionContext,
): Promise<void> {
  const options = parseSingleShotExecutionCliArgs(
    args
  );

  if (!options.confirmPaidGeneration) throw new BoundEpisodeError("ACTION_REJECTED");
  if (checkedContext) {
    const data = checkedEpisodeExecutionData(checkedContext);
    const action = data.plan.actions[0];
    if (action.kind !== "VISUAL_GENERATE" || options.episodeId !== action.episodeId || options.shotId !== action.shotId ||
        options.sourceImagePath !== action.referenceBinding.canonicalAbsolutePath) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
    await assertCheckedEpisodeAdmission(checkedContext);
    const original = dependencies;
    const required = <T>(value: T | null): T => { if (value === null) throw new BoundEpisodeError("INPUT_BINDING_DRIFT"); return value; };
    dependencies = { ...original,
      loadEpisodeManifest: async () => required(await readCheckedEpisodeJson(checkedContext, "MANIFEST", value => EpisodeManifestSchema.parse(value))),
      loadCharacterBible: async () => required(await readCheckedEpisodeJson(checkedContext, "CHARACTERS", value => CharacterBibleSchema.parse(value))),
      loadProductionRules: async () => required(await readCheckedEpisodeJson(checkedContext, "PRODUCTION_RULES", value => ProductionRulesSchema.parse(value))),
      loadProviderRoutingPolicy: async () => required(await readCheckedEpisodeJson(checkedContext, "ROUTING", value => ProviderRoutingPolicySchema.parse(value))),
      validateEpisodeProduction: (episode, bible, rules) => {
        assertEpisodeApprovals(episode, rules);
        const shot = episode.scenes.flatMap(scene => scene.shots).find(row => row.id === action.shotId);
        if (!shot) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
        assertShotCanProgress(shot, bible, rules);
      },
      createDependencies: credentials => original.createDependencies(credentials, undefined, checkedContext),
    };
  }

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

  if (checkedContext && mediaRoot !== checkedEpisodeExecutionData(checkedContext).plan.inputBinding.runtimeIdentity.mediaRoot) {
    throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
  }
  const standaloneGuard = checkedContext ? null : await (async () => {
    const manifest = await readBoundFile({ root: process.cwd(), canonicalPath: resolve(process.cwd(), "episodes", options.episodeId, "episode.json"),
      role: "MANIFEST", maxBytes: 1048576 });
    if (!manifest.binding.rawSha256) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
    return acquireEpisodeExecutionGuard({ mediaRoot, episodeId: options.episodeId,
      manifestRawSha256: manifest.binding.rawSha256, sessionId: randomUUID() });
  })();
  try {

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
    if (checkedContext) consumeEpisodeGenerationAllowance(checkedEpisodeExecutionData(checkedContext).invocation);
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

  // Controlled callers consume typed durable post-observations, never this
  // standalone CLI's raw provider execution identity or path diagnostics.
  if (checkedContext) return;

  // B5C-X1: a Google submission is durably SUBMITTED, never completed here.
  if (
    result.provider === "GOOGLE_GENAI"
  ) {
    console.log(
      `Single-shot execution submitted: ${episode.episodeId}/${options.shotId} (${result.provider})`
    );
    console.log(
      `Provider execution: ${result.submitted.providerExecutionId}`
    );
    console.log(
      `Submission record: ${result.submitted.submissionPath}`
    );
    console.log(
      `Reconcile later with npm run execution:reconcile -- --episode ${options.episodeId} --shot ${options.shotId}. Do not resubmit.`
    );

    return;
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
  } finally { if (standaloneGuard) await releaseEpisodeExecutionGuard(standaloneGuard); }
}
