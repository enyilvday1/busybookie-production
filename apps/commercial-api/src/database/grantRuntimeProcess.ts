import { runDatabaseCommand } from "./runDatabaseCommand.js";

// Process entry point for synchronising the runtime role's privileges.
void runDatabaseCommand("grant-runtime", {
  environment: process.env,
  writeStdout: (text) => {
    process.stdout.write(text);
  },
  writeStderr: (text) => {
    process.stderr.write(text);
  },
  setExitCode: (code) => {
    process.exitCode = code;
  },
});
