import { loadServerConfig, ServerConfigError, type ConfigEnvironment } from "./config.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "./startCommercialApiServer.js";

export const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

export type CommercialApiProcessDependencies = Readonly<{
  environment: ConfigEnvironment;
  onSignal: (signal: ShutdownSignal, listener: () => void) => void;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
  setExitCode: (code: number) => void;
  startServer?: typeof startCommercialApiServer;
}>;

// Process startup: configuration, listen, and graceful shutdown on SIGINT or
// SIGTERM. Returns the running server, or null when startup failed (the exit
// code is then already set).
export async function runCommercialApiProcess(
  dependencies: CommercialApiProcessDependencies,
): Promise<RunningCommercialApiServer | null> {
  const startServer = dependencies.startServer ?? startCommercialApiServer;
  let running: RunningCommercialApiServer;

  try {
    const config = loadServerConfig(dependencies.environment);
    running = await startServer({ host: config.host, port: config.port });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    const message =
      error instanceof ServerConfigError
        ? `Configuration error: ${error.message}`
        : `Could not listen on the configured host and port${typeof code === "string" ? ` (${code})` : ""}.`;
    dependencies.writeStderr(`commercial-api: ${message}\n`);
    dependencies.setExitCode(1);
    return null;
  }

  dependencies.writeStdout(`commercial-api listening on ${running.host}:${running.port}\n`);

  let shuttingDown = false;

  for (const signal of SHUTDOWN_SIGNALS) {
    dependencies.onSignal(signal, () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;

      dependencies.writeStdout(`commercial-api: ${signal} received, shutting down\n`);
      running.close().then(
        () => dependencies.writeStdout("commercial-api: stopped\n"),
        () => {
          dependencies.writeStderr("commercial-api: shutdown did not complete cleanly\n");
          dependencies.setExitCode(1);
        },
      );
    });
  }

  return running;
}
