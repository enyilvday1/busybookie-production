import {
  runVeoCli,
} from "../src/veo/cli/runVeoCli.js";

runVeoCli().catch(
  (error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown Veo CLI error";

    console.error("");
    console.error(
      `Veo generation failed: ${message}`,
    );

    process.exitCode = 1;
  },
);
