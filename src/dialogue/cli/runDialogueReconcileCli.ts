import {
  createRunwayDialogueProductionReconciler,
  type RunwayDialogueProductionReconciler,
} from "../createRunwayDialogueProductionReconciler.js";

import {
  createRunwayDirectSeedAudioProductionReconciler,
  type RunwayDirectSeedAudioProductionReconciler,
} from "../createRunwayDirectSeedAudioProductionReconciler.js";

import {
  buildShotDialoguePlan,
} from "../buildShotDialoguePlan.js";

import type {
  RunwayCredentialSource,
} from "../../runway/runway.types.js";

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
  validateEpisodeProduction,
} from "../../validation/validateEpisodeProduction.js";

import {
  resolveAndValidateMediaRootPath,
} from "../../validation/validateMediaRoot.js";

import {
  parseDialogueReconcileCliArgs,
} from "./dialogueReconcileCliArgs.js";

export type RunDialogueReconcileCliDependencies =
  Readonly<{
    loadEnvironment:
      typeof loadEnvironment;

    loadProductionRules:
      typeof loadProductionRules;

    loadCharacterBible:
      typeof loadCharacterBible;

    loadEpisodeManifest:
      typeof loadEpisodeManifest;

    validateEpisodeProduction:
      typeof validateEpisodeProduction;

    resolveMediaRoot:
      typeof resolveAndValidateMediaRootPath;

    buildShotDialoguePlan:
      typeof buildShotDialoguePlan;

    createReconciler:
      typeof createRunwayDialogueProductionReconciler;

    createDirectSeedAudioReconciler:
      typeof createRunwayDirectSeedAudioProductionReconciler;
  }>;

const defaultDependencies:
  RunDialogueReconcileCliDependencies =
    Object.freeze({
      loadEnvironment,

      loadProductionRules,

      loadCharacterBible,

      loadEpisodeManifest,

      validateEpisodeProduction,

      resolveMediaRoot:
        resolveAndValidateMediaRootPath,

      buildShotDialoguePlan,

      createReconciler:
        createRunwayDialogueProductionReconciler,

      createDirectSeedAudioReconciler:
        createRunwayDirectSeedAudioProductionReconciler,
    });

export async function runDialogueReconcileCli(
  args:
    readonly string[] =
      process.argv.slice(
        2,
      ),

  dependencies:
    RunDialogueReconcileCliDependencies =
      defaultDependencies,
): Promise<void> {
  const options =
    parseDialogueReconcileCliArgs(
      args,
    );

  const env =
    dependencies
      .loadEnvironment();

  const [
    rules,
    bible,
    episode,
  ] =
    await Promise.all([
      dependencies
        .loadProductionRules(),

      dependencies
        .loadCharacterBible(),

      dependencies
        .loadEpisodeManifest(
          options.episodeId,
        ),
    ]);

  const mediaRoot =
    dependencies
      .resolveMediaRoot(
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
      `Dialogue reconciliation scene ${options.sceneId} was not found in episode ${episode.episodeId}.`,
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
      `Dialogue reconciliation shot ${options.shotId} was not found in scene ${scene.id}.`,
    );
  }

  const plan =
    dependencies
      .buildShotDialoguePlan({
        episodeId:
          episode.episodeId,

        sceneId:
          scene.id,

        shot,

        bible,
      });

  const matchingLines =
    plan.lines.filter(
      (candidate) =>
        candidate.dialogueLineId ===
        options.dialogueLineId,
    );

  if (
    matchingLines.length ===
    0
  ) {
    throw new Error(
      `Dialogue line ${options.dialogueLineId} was not found in the rebuilt canonical dialogue plan.`,
    );
  }

  if (
    matchingLines.length !==
    1
  ) {
    throw new Error(
      `Canonical dialogue plan must contain exactly one dialogue line ${options.dialogueLineId}; found ${matchingLines.length}.`,
    );
  }

  const line =
    matchingLines[0]!;

  const usesRunwayReferenceAudio =
    (
      "executionMode" in
        line.voice &&
      line.voice.executionMode ===
        "RUNWAY_REFERENCE_AUDIO"
    );

  const runwayApiSecret =
    env.RUNWAYML_API_SECRET
      ?.trim();

  const credentialSource:
    RunwayCredentialSource =
      runwayApiSecret
        ? Object.freeze({
            RUNWAYML_API_SECRET:
              runwayApiSecret,
          })
        : Object.freeze({});

  const result =
    usesRunwayReferenceAudio
      ? await (
          dependencies
            .createDirectSeedAudioReconciler(
              credentialSource,
            ) as
              RunwayDirectSeedAudioProductionReconciler
        )({
          mediaRoot,

          episodeId:
            options.episodeId,

          sceneId:
            options.sceneId,

          shotId:
            options.shotId,

          dialogueLineId:
            options.dialogueLineId,

          planKey:
            plan.planKey,
        })
      : await (
          dependencies
            .createReconciler(
              credentialSource,
            ) as
              RunwayDialogueProductionReconciler
        )({
          mediaRoot,

          episodeId:
            options.episodeId,

          sceneId:
            options.sceneId,

          shotId:
            options.shotId,

          dialogueLineId:
            options.dialogueLineId,
        });

  console.log("");
  console.log(
    "===== Busybookie Dialogue Reconciliation =====",
  );

  console.log(
    `Episode: ${options.episodeId}`,
  );

  console.log(
    `Scene: ${options.sceneId}`,
  );

  console.log(
    `Shot: ${options.shotId}`,
  );

  console.log(
    `Dialogue line: ${options.dialogueLineId}`,
  );

  console.log(
    `Lifecycle state: ${result.lifecycleState}`,
  );

  console.log(
    `Reconciliation mode: ${result.reconciliationMode}`,
  );

  console.log(
    `Provider: ${result.provider}`,
  );

  console.log(
    `Provider execution ID: ${result.providerExecutionId}`,
  );

  console.log(
    `Generation record: ${result.generationRecordPath}`,
  );

  console.log(
    `Completion record: ${result.completionPath}`,
  );

  console.log(
    "==============================================",
  );
}
