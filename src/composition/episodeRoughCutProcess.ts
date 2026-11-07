import {
  formatEpisodeRoughCutCliError,
  runEpisodeRoughCutCli,
} from "./cli/runEpisodeRoughCutCli.js";

runEpisodeRoughCutCli().catch(
  (error: unknown) => {
    process.stderr.write(
      formatEpisodeRoughCutCliError(
        error,
      ),
    );

    process.exitCode = 1;
  },
);
