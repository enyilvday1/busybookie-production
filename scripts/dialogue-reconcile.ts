import {
  runDialogueReconcileCli,
} from "../src/dialogue/cli/runDialogueReconcileCli.js";

runDialogueReconcileCli().catch(
  (error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown dialogue reconciliation CLI error";

    console.error("");
    console.error(
      `Dialogue reconciliation failed: ${message}`,
    );

    process.exitCode = 1;
  },
);
