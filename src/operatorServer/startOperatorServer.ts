import {
  createOperatorServer,
  type OperatorServerDependencies,
} from "./createOperatorServer.js";

import {
  generateOperatorLaunchToken,
} from "./operatorRequestSecurity.js";

import type {
  OperatorConsoleAssets,
} from "./operatorConsoleAssets.js";

// The only bind address. It is not configurable: D1 is loopback-only, and a
// failed bind is never retried on another interface or port.
export const OPERATOR_SERVER_HOST =
  "127.0.0.1" as const;

export type StartOperatorServerOptions =
  Readonly<{
    // 0 selects an ephemeral loopback port (tests).
    port:
      number;

    // Test seam only; production generates a fresh per-launch token.
    token?:
      string;

    dependencies?:
      Partial<OperatorServerDependencies>;

    log?:
      (text: string) => void;

    // Loaded by the caller before listening (the CLI fails fast without it).
    consoleAssets?:
      OperatorConsoleAssets;
  }>;

export type RunningOperatorServer =
  Readonly<{
    origin:
      string;

    port:
      number;

    token:
      string;

    close:
      () => Promise<void>;
  }>;

export async function startOperatorServer(
  options:
    StartOperatorServerOptions,
): Promise<RunningOperatorServer> {
  if (
    !Number.isInteger(
      options.port,
    ) ||
    options.port < 0 ||
    options.port > 65535
  ) {
    throw new Error(
      "Operator server port must be an integer from 0 to 65535.",
    );
  }

  const token =
    options.token ??
    generateOperatorLaunchToken();

  const server =
    createOperatorServer({
      token,

      ...(options.dependencies ===
        undefined
        ? {}
        : {
            dependencies:
              options.dependencies,
          }),

      ...(options.log ===
        undefined
        ? {}
        : {
            log:
              options.log,
          }),

      ...(options.consoleAssets ===
        undefined
        ? {}
        : {
            consoleAssets:
              options.consoleAssets,
          }),
    });

  await new Promise<void>(
    (
      resolveListen,
      rejectListen,
    ) => {
      const onError =
        (error: Error) => {
          rejectListen(
            error,
          );
        };

      server.once(
        "error",
        onError,
      );

      server.listen(
        {
          host:
            OPERATOR_SERVER_HOST,

          port:
            options.port,

          exclusive:
            true,
        },
        () => {
          server.off(
            "error",
            onError,
          );

          resolveListen();
        },
      );
    },
  );

  let closing:
    Promise<void> | undefined;

  const close =
    (): Promise<void> => {
      closing ??=
        new Promise<void>(
          (
            resolveClose,
            rejectClose,
          ) => {
            server.close(
              (error) => {
                if (error) {
                  rejectClose(
                    error,
                  );
                  return;
                }

                resolveClose();
              },
            );

            server.closeAllConnections();
          },
        );

      return closing;
    };

  const address =
    server.address();

  if (
    address ===
      null ||
    typeof address !==
      "object" ||
    address.address !==
      OPERATOR_SERVER_HOST ||
    address.family !==
      "IPv4"
  ) {
    await close();

    throw new Error(
      "Operator server did not bind exclusively to the IPv4 loopback address.",
    );
  }

  return Object.freeze({
    origin:
      `http://${OPERATOR_SERVER_HOST}:${address.port}`,

    port:
      address.port,

    token,

    close,
  });
}
