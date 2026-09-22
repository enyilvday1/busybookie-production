import {
  runRunwayGen45Cli,
} from "../src/runway/cli/runRunwayGen45Cli.js";

runRunwayGen45Cli().catch(
  (error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown Runway CLI error";

    console.error("");
    console.error(
      `Runway generation failed: ${message}`,
    );

    process.exitCode = 1;
  },
);
