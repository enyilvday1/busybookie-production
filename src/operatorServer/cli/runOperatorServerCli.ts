import {
  formatOperatorErrorChain,
} from "../createOperatorServer.js";

import {
  startOperatorServer,
} from "../startOperatorServer.js";

export const DEFAULT_OPERATOR_SERVER_PORT =
  4381;

const MIN_CLI_PORT =
  1024;

const MAX_CLI_PORT =
  65535;

export type OperatorServerCliOptions =
  Readonly<{
    port: number;
  }>;

export type RunOperatorServerCliDependencies =
  Readonly<{
    startServer:
      typeof startOperatorServer;

    writeStdout:
      (text: string) => void;

    waitForShutdownSignal:
      () => Promise<void>;
  }>;

// Exactly: [--port <1024-65535>]. No host, token, path or other option.
export function parseOperatorServerCliArgs(
  args:
    readonly string[],
): OperatorServerCliOptions {
  let port:
    number | undefined;

  for (
    let index = 0;
    index < args.length;
    index += 1
  ) {
    const argument =
      args[index];

    if (
      argument ===
      "--port"
    ) {
      if (
        port !==
        undefined
      ) {
        throw new Error(
          "Duplicate operator server CLI argument: --port",
        );
      }

      const value =
        args[index + 1];

      if (
        value ===
          undefined ||
        !/^[0-9]{1,5}$/.test(
          value,
        )
      ) {
        throw new Error(
          "--port requires a port number.",
        );
      }

      const parsed =
        Number(
          value,
        );

      if (
        parsed < MIN_CLI_PORT ||
        parsed > MAX_CLI_PORT
      ) {
        throw new Error(
          `--port must be from ${MIN_CLI_PORT} to ${MAX_CLI_PORT}.`,
        );
      }

      port =
        parsed;

      index += 1;
      continue;
    }

    if (
      argument?.startsWith(
        "--",
      ) &&
      argument.includes(
        "=",
      )
    ) {
      throw new Error(
        `Operator server CLI arguments do not accept --flag=value forms: ${argument.split("=")[0]}`,
      );
    }

    throw new Error(
      argument?.startsWith(
        "-",
      )
        ? `Unknown operator server CLI argument: ${argument}`
        : "Unexpected positional operator server CLI argument.",
    );
  }

  return Object.freeze({
    port:
      port ??
      DEFAULT_OPERATOR_SERVER_PORT,
  });
}

function waitForProcessShutdownSignal(): Promise<void> {
  return new Promise(
    (resolveSignal) => {
      const onSignal =
        () => {
          process.off(
            "SIGINT",
            onSignal,
          );

          process.off(
            "SIGTERM",
            onSignal,
          );

          resolveSignal();
        };

      process.once(
        "SIGINT",
        onSignal,
      );

      process.once(
        "SIGTERM",
        onSignal,
      );
    },
  );
}

const defaultDependencies:
  RunOperatorServerCliDependencies =
    Object.freeze({
      startServer:
        startOperatorServer,

      writeStdout:
        (text: string) => {
          process.stdout.write(
            text,
          );
        },

      waitForShutdownSignal:
        waitForProcessShutdownSignal,
    });

export async function runOperatorServerCli(
  args:
    readonly string[] =
      process.argv.slice(
        2,
      ),

  dependencies:
    RunOperatorServerCliDependencies =
      defaultDependencies,
): Promise<void> {
  const options =
    parseOperatorServerCliArgs(
      args,
    );

  const running =
    await dependencies
      .startServer({
        port:
          options.port,
      });

  // The one-time bootstrap: the token is shown once, on the launching
  // terminal only. It is never logged, persisted or put in a URL.
  dependencies
    .writeStdout(
      [
        `BusyBookie operator API (read-only) listening on ${running.origin}`,
        `Operator token for this launch: ${running.token}`,
        "Press Ctrl+C to stop.",
      ].join(
        "\n",
      ) +
        "\n",
    );

  await dependencies
    .waitForShutdownSignal();

  await running.close();
}

// One bounded line for the launcher's stderr; no stack or object dump.
export function formatOperatorServerCliError(
  error:
    unknown,
): string {
  const [
    reason,
  ] =
    formatOperatorErrorChain(
      error,
    );

  return `Operator server failed. ${reason ?? "Reason: unknown."}\n`;
}
