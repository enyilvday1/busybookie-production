import {
  runExecutionPlanCli,
} from "../src/planning/cli/runExecutionPlanCli.js";

runExecutionPlanCli().catch(
  (error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown execution plan CLI error";

    console.error("");
    console.error(
      `Execution plan failed: ${message}`,
    );

    process.exitCode = 1;
  },
);
