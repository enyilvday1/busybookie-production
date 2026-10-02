import {
  loadCharacterBible,
} from "../../validation/loadCharacterBible.js";

import {
  loadDialogueVoicePolicy,
} from "../../validation/loadDialogueVoicePolicy.js";

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
  validateEpisodeProduction,
} from "../../validation/validateEpisodeProduction.js";

import {
  validateMediaRoot,
} from "../../validation/validateMediaRoot.js";

import {
  buildRunwayElevenV3Request,
} from "../buildRunwayElevenV3Request.js";

import {
  buildShotDialoguePlan,
} from "../buildShotDialoguePlan.js";

import {
  createRunwayDialogueProductionExecutor,
  type RunwayDialogueProductionExecutor,
} from "../createRunwayDialogueProductionExecutor.js";

import {
  assertDialogueWithinBudget,
} from "../dialogueVoiceBudget.js";

import {
  parseDialogueGenerationCliArgs,
} from "./dialogueGenerationCliArgs.js";

export type RunDialogueGenerationCliDependencies =
  Readonly<{
    loadEnvironment:
      typeof loadEnvironment;

    loadProductionRules:
      typeof loadProductionRules;

    loadDialogueVoicePolicy:
      typeof loadDialogueVoicePolicy;

    loadCharacterBible:
      typeof loadCharacterBible;

    loadEpisodeManifest:
      typeof loadEpisodeManifest;

    validateMediaRoot:
      typeof validateMediaRoot;

    validateEpisodeProduction:
      typeof validateEpisodeProduction;

    createExecutor:
      (
        credentialSource:
          Readonly<{
            RUNWAYML_API_SECRET:
              string;
          }>,
      ) =>
        RunwayDialogueProductionExecutor;
  }>;

const defaultDependencies:
  RunDialogueGenerationCliDependencies =
    Object.freeze({
      loadEnvironment,

      loadProductionRules,

      loadDialogueVoicePolicy,

      loadCharacterBible,

      loadEpisodeManifest,

      validateMediaRoot,

      validateEpisodeProduction,

      createExecutor:
        createRunwayDialogueProductionExecutor,
    });

export async function runDialogueGenerationCli(
  args:
    readonly string[] =
      process.argv.slice(
        2,
      ),

  dependencies:
    RunDialogueGenerationCliDependencies =
      defaultDependencies,
): Promise<void> {
  const options =
    parseDialogueGenerationCliArgs(
      args,
    );

  const env =
    dependencies
      .loadEnvironment();

  const [
    rules,
    policy,
    bible,
    episode,
  ] = await Promise.all([
    dependencies
      .loadProductionRules(),

    dependencies
      .loadDialogueVoicePolicy(),

    dependencies
      .loadCharacterBible(),

    dependencies
      .loadEpisodeManifest(
        options.episodeId,
      ),
  ]);

  const mediaRoot =
    await dependencies
      .validateMediaRoot(
        env,
        rules,
      );

  dependencies
    .validateEpisodeProduction(
      episode,
      bible,
      rules,
    );

  const scene =
    episode.scenes.find(
      (candidate) =>
        candidate.id ===
        options.sceneId,
    );

  if (!scene) {
    throw new Error(
      `Dialogue generation CLI could not find scene ${options.sceneId} in episode ${episode.episodeId}.`,
    );
  }

  const shot =
    scene.shots.find(
      (candidate) =>
        candidate.id ===
        options.shotId,
    );

  if (!shot) {
    throw new Error(
      `Dialogue generation CLI could not find shot ${options.shotId} in scene ${scene.id} of episode ${episode.episodeId}.`,
    );
  }

  const plan =
    buildShotDialoguePlan({
      episodeId:
        episode.episodeId,

      sceneId:
        scene.id,

      shot,

      bible,
    });

  const line =
    plan.lines.find(
      (candidate) =>
        candidate.dialogueLineId ===
        options.dialogueLineId,
    );

  if (!line) {
    throw new Error(
      `Dialogue generation CLI could not find canonical line ${options.dialogueLineId} in ${episode.episodeId}/${scene.id}/${shot.id}.`,
    );
  }

  const locallyExpectedCredits =
    assertDialogueWithinBudget(
      line.text,
      policy,
    );

  const request =
    buildRunwayElevenV3Request({
      line,
      policy,
    });

  console.log("");
  console.log(
    "===== Busybookie Dialogue Voice Preflight =====",
  );

  console.log(
    `Episode: ${episode.episodeId} - ${episode.title}`,
  );

  console.log(
    `Scene: ${scene.id} - ${scene.title}`,
  );

  console.log(
    `Shot: ${shot.id} - ${shot.title}`,
  );

  console.log(
    `Dialogue line: ${line.dialogueLineId}`,
  );

  console.log(
    `Character: ${line.characterName} (${line.characterId})`,
  );

  console.log(
    `Provider: ${line.voice.provider}`,
  );

  console.log(
    `Voice: ${line.voice.voiceName}`,
  );

  console.log(
    `Model: ${request.model}`,
  );

  console.log(
    `Dialogue: ${line.text}`,
  );

  console.log(
    `Local expected credits: ${locallyExpectedCredits}`,
  );

  console.log(
    `Local credit ceiling: ${policy.generation.maxCreditsPerLine}`,
  );

  console.log(
    `Media root: ${mediaRoot}`,
  );

  console.log(
    `Plan key: ${plan.planKey}`,
  );

  console.log(
    `Paid-generation confirmation: ${
      options.confirmPaidGeneration
        ? "YES"
        : "NO"
    }`,
  );

  console.log(
    "==============================================",
  );

  console.log("");

  if (
    !options.confirmPaidGeneration
  ) {
    console.log(
      "DRY RUN ONLY: no Runway dialogue generation request was submitted and no credits were used.",
    );

    return;
  }

  const runwayApiSecret =
    env.RUNWAYML_API_SECRET
      ?.trim();

  if (!runwayApiSecret) {
    throw new Error(
      "Paid dialogue generation blocked: RUNWAYML_API_SECRET is not configured.",
    );
  }

  const executor =
    dependencies
      .createExecutor({
        RUNWAYML_API_SECRET:
          runwayApiSecret,
      });

  console.log(
    "PAID DIALOGUE GENERATION CONFIRMED. Submitting one Runway voice task...",
  );

  const result =
    await executor({
      plan,

      dialogueLineId:
        line.dialogueLineId,

      mediaRoot,

      confirmPaidGeneration:
        true,
    });

  console.log(
    `Dialogue generation completed: ${result.providerExecution.record.providerExecutionId}`,
  );

  console.log(
    `Completion record: ${result.completion.completionPath}`,
  );
}
