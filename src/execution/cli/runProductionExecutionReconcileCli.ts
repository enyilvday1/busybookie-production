import {
  createProductionExecutionReconcileDependencies,
} from "../createProductionExecutionReconcileDependencies.js";

import {
  runExecutionReconcileCli,
} from "./runExecutionReconcileCli.js";

export type RunProductionExecutionReconcileCliDependencies =
  Readonly<{
    createDependencies:
      typeof createProductionExecutionReconcileDependencies;

    runCli:
      typeof runExecutionReconcileCli;
  }>;

const defaultDependencies:
  RunProductionExecutionReconcileCliDependencies =
  Object.freeze({
    createDependencies:
      createProductionExecutionReconcileDependencies,

    runCli:
      runExecutionReconcileCli,
  });

export async function runProductionExecutionReconcileCli(
  args:
    readonly string[] =
      process.argv.slice(
        2,
      ),

  dependencies:
    RunProductionExecutionReconcileCliDependencies =
      defaultDependencies,
): Promise<void> {
  const reconcileDependencies =
    dependencies
      .createDependencies();

  await dependencies
    .runCli(
      args,
      reconcileDependencies,
    );
}
