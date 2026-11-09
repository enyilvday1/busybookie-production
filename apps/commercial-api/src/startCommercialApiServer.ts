import type { AddressInfo } from "node:net";

import { createCommercialApiServer, type CommercialApiServerDependencies } from "./createCommercialApiServer.js";

export type StartCommercialApiServerOptions = Readonly<{
  host: string;
  // 0 selects an ephemeral port (tests).
  port: number;
  dependencies?: CommercialApiServerDependencies;
  // In-flight requests get this long to finish before connections are forced closed.
  shutdownGraceMs?: number;
}>;

export type RunningCommercialApiServer = Readonly<{
  host: string;
  port: number;
  close: () => Promise<void>;
}>;

const DEFAULT_SHUTDOWN_GRACE_MS = 5000;

export async function startCommercialApiServer(
  options: StartCommercialApiServerOptions,
): Promise<RunningCommercialApiServer> {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error("Commercial API port must be an integer from 0 to 65535.");
  }

  const server = createCommercialApiServer(options.dependencies);

  // Bind exactly the configured host. A failed bind is reported, never retried
  // on another interface or port.
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen({ host: options.host, port: options.port, exclusive: true }, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const graceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  let closing: Promise<void> | undefined;

  // Stops accepting connections, closes idle keep-alive connections, lets
  // in-flight requests finish, then forces any remainder closed after the grace period.
  const close = (): Promise<void> => {
    closing ??= new Promise<void>((resolveClose, rejectClose) => {
      const forceTimer = setTimeout(() => server.closeAllConnections(), graceMs);
      forceTimer.unref();

      server.close((error) => {
        clearTimeout(forceTimer);
        if (error) {
          rejectClose(error);
          return;
        }
        resolveClose();
      });

      server.closeIdleConnections();
    });

    return closing;
  };

  const address = server.address() as AddressInfo;

  return Object.freeze({ host: options.host, port: address.port, close });
}
