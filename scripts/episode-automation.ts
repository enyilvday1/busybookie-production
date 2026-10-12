import {
  formatEpisodeAutomationCliError,
  runEpisodeAutomationCli,
} from "../src/execution/cli/runEpisodeAutomationCli.js";

runEpisodeAutomationCli().catch(
  (error: unknown) => {
    console.error(
      formatEpisodeAutomationCliError(
        error,
      ),
    );

    process.exitCode = 1;
  },
);
