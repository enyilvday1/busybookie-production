import {
  runDialogueVisualAuthorizationCli,
} from "./cli/runDialogueVisualAuthorizationCli.js";

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
