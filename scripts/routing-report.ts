import {
  runRoutingReportCli,
} from "../src/routing/cli/runRoutingReportCli.js";

runRoutingReportCli().catch(
  (error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown routing report CLI error";

    console.error("");
    console.error(
      `Routing report failed: ${message}`,
    );

    process.exitCode = 1;
  },
);
