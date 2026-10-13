import {
  formatOperatorServerCliError,
  runOperatorServerCli,
} from "../src/operatorServer/cli/runOperatorServerCli.js";

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
