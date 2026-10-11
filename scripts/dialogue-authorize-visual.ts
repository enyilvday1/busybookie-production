import {
  runDialogueVisualAuthorizationCli,
} from "../src/dialogue/cli/runDialogueVisualAuthorizationCli.js";

runDialogueVisualAuthorizationCli()
  .catch(
    (
      error:
        unknown,
    ) => {
      console.error("");

      console.error(
        error instanceof Error
          ? error.message
          : String(
              error,
            ),
      );

      process.exitCode =
        1;
    },
  );
