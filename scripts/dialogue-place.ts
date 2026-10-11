import {
  runDialoguePlacementCli,
} from "../src/dialogue/cli/runDialoguePlacementCli.js";

runDialoguePlacementCli().catch((error: unknown) => {
  console.error("");
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
