import {
  formatOperatorServerCliError,
  runOperatorServerCli,
} from "./cli/runOperatorServerCli.js";

runOperatorServerCli().catch(
  (error: unknown) => {
    process.stderr.write(
      formatOperatorServerCliError(
        error,
      ),
    );

    process.exitCode = 1;
  },
);
