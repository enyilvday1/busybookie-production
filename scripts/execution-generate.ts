import {
  runSingleShotExecutionCli,
} from "../src/execution/cli/runSingleShotExecutionCli.js";

runSingleShotExecutionCli().catch(
  (
    error: unknown
  ) => {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown single-shot execution CLI error";

    console.error(
      `Single-shot execution failed: ${message}`
    );

    process.exitCode = 1;
  }
);
