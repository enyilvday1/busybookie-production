import {
  runProductionExecutionReconcileCli,
} from "../src/execution/cli/runProductionExecutionReconcileCli.js";

runProductionExecutionReconcileCli().catch(
  (error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown execution reconciliation CLI error";

    console.error("");
    console.error(
      `Execution reconciliation failed: ${message}`,
    );

    process.exitCode = 1;
  },
);
