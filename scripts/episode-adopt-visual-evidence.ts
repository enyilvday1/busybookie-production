import {
  formatVisualEvidenceAdoptionCliError,
  runVisualEvidenceAdoptionCli,
} from "../src/execution/cli/runVisualEvidenceAdoptionCli.js";

runVisualEvidenceAdoptionCli().catch(
  (error: unknown) => {
    console.error(
      formatVisualEvidenceAdoptionCliError(
        error,
      ),
    );

    process.exitCode = 1;
  },
);
