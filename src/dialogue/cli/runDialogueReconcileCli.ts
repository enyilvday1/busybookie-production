import {
  createRunwayDialogueProductionReconciler,
  type RunwayDialogueProductionReconciler,
} from "../createRunwayDialogueProductionReconciler.js";

import type {
  RunwayCredentialSource,
} from "../../runway/runway.types.js";

import {
  loadEnvironment,
} from "../../validation/loadEnvironment.js";

import {
  loadProductionRules,
} from "../../validation/loadProductionRules.js";

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

    resolveMediaRoot:
      typeof resolveAndValidateMediaRootPath;

    createReconciler:
      typeof createRunwayDialogueProductionReconciler;
  }>;

const defaultDependencies:
  RunDialogueReconcileCliDependencies =
    Object.freeze({
      loadEnvironment,

      loadProductionRules,

      resolveMediaRoot:
        resolveAndValidateMediaRootPath,

      createReconciler:
        createRunwayDialogueProductionReconciler,
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

  const rules =
    await dependencies
      .loadProductionRules();

  const mediaRoot =
    dependencies
      .resolveMediaRoot(
        env,
        rules,
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

  const reconcile:
    RunwayDialogueProductionReconciler =
      dependencies
        .createReconciler(
          credentialSource,
        );

  const result =
    await reconcile({
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
