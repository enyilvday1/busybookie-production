import {
  runExecutionStatusCli,
} from "../src/execution/cli/runExecutionStatusCli.js";

runExecutionStatusCli().catch(
  (error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown execution status CLI error";

    console.error("");
    console.error(
      `Execution status failed: ${message}`,
    );

    process.exitCode = 1;
  },
);
