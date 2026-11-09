import { runCommercialApiProcess } from "./runCommercialApiProcess.js";

// Process entry point and the only module that reads process.env. The
// configuration layer reads only COMMERCIAL_API_* keys from it.
void runCommercialApiProcess({
  environment: process.env,
  onSignal: (signal, listener) => {
    process.once(signal, listener);
  },
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
