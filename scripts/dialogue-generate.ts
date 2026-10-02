import {
  runDialogueGenerationCli,
} from "../src/dialogue/cli/runDialogueGenerationCli.js";

runDialogueGenerationCli().catch(
  (error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown dialogue generation CLI error";

    console.error("");
    console.error(
      `Dialogue generation failed: ${message}`,
    );

    process.exitCode = 1;
  },
);
