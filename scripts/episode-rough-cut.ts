import {
  formatEpisodeRoughCutCliError,
  runEpisodeRoughCutCli,
} from "../src/composition/cli/runEpisodeRoughCutCli.js";

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
