import {
  inspectExecutionLifecycle,
} from "../inspectExecutionLifecycle.js";

import type {
  ExecutionLifecycleReconciliationDependencies,
  ExecutionLifecycleReconciliationInput,
  ExecutionLifecycleReconciliationResult,
} from "../reconcileExecutionLifecycle.js";

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
  parseExecutionReconcileCliArgs,
} from "./executionReconcileCliArgs.js";

type ReconcileLifecycle =
  (
    input:
      ExecutionLifecycleReconciliationInput,

    dependencies:
      ExecutionLifecycleReconciliationDependencies,
  ) =>
    Promise<
      ExecutionLifecycleReconciliationResult
    >;

export type RunExecutionReconcileCliDependencies =
  Readonly<{
    loadEnvironment:
      typeof loadEnvironment;

    loadProductionRules:
      typeof loadProductionRules;

    resolveMediaRoot:
      typeof resolveAndValidateMediaRootPath;

    inspectLifecycle:
      typeof inspectExecutionLifecycle;

    reconcileLifecycle:
      ReconcileLifecycle;

  }>;

export async function runExecutionReconcileCli(
  args:
    readonly string[],

  dependencies:
    RunExecutionReconcileCliDependencies,
): Promise<void> {
  const options =
    parseExecutionReconcileCliArgs(
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

  const lifecycle =
    await dependencies
      .inspectLifecycle(
        mediaRoot,
        options.episodeId,
        options.shotId,
      );

  if (
    lifecycle.state !==
    "COMPLETED"
  ) {
    throw new Error(
      `Execution reconciliation CLI currently supports COMPLETED lifecycle only; received ${lifecycle.state}.`,
    );
  }

  const cachedInspectLifecycle:
    typeof inspectExecutionLifecycle =
    async () =>
      lifecycle;

  await dependencies
    .reconcileLifecycle(
      {
        mediaRoot,
        episodeId:
          options.episodeId,
        shotId:
          options.shotId,
      },
      {
        inspectLifecycle:
          cachedInspectLifecycle,
      },
    );
}
