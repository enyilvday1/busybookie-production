import { runDatabaseCommand } from "./runDatabaseCommand.js";

// Process entry point for the explicit migration command.
void runDatabaseCommand("migrate", {
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
