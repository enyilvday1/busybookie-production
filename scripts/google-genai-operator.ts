import {
  runGoogleGenAiOperatorCli,
} from "../src/execution/cli/runGoogleGenAiOperatorCli.js";

runGoogleGenAiOperatorCli().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.stderr.write(
      "GOOGLE_GENAI_OPERATOR_RESULT=FAILED\nERROR_CODE=INTERNAL_ERROR\n",
    );
    process.exitCode = 4;
  },
);
