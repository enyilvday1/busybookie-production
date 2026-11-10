import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

import { sendError, sendJson, serializeJson } from "./http/jsonResponse.js";

// An application route reads its own request body; the server enforces the
// method list (405 with Allow) before calling handle.
export type ApplicationRoute = Readonly<{
  methods: readonly string[];
  handle: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
}>;

export type ApplicationRouter = Readonly<{
  // Returns null when the path is not an application route.
  route: (pathname: string) => ApplicationRoute | null;
}>;

// HTTP adapter. Built-in routes: GET /__health (liveness, never touches the
// database) and GET /__ready (readiness). Customer application routes exist
// only when an ApplicationRouter is injected; without one, as in the default
// process composition, every other path is a JSON 404. Responses never echo
// the request target, query, headers or error details.

export const HEALTH_PATH = "/__health";
export const READY_PATH = "/__ready";

export const HEALTH_BODY = Object.freeze({
  status: "ok",
  service: "commercial-api",
});

export const READY_BODY = Object.freeze({
  status: "ready",
  service: "commercial-api",
});

export type CommercialApiServerDependencies = Readonly<{
  // Test seam: produces the health body. Production uses HEALTH_BODY.
  readHealth?: () => unknown;
  // Resolves true only when the service can take traffic. Must be bounded;
  // a rejection is treated as not ready. Defaults to never ready.
  checkReadiness?: () => Promise<boolean>;
  // Customer routes. Absent by default, so they are not exposed.
  application?: ApplicationRouter;
  // Server-side only; never reaches the client.
  reportError?: (error: unknown) => void;
}>;

function defaultReportError(error: unknown): void {
  const detail = error instanceof Error ? (error.stack ?? error.name) : "non-error value thrown";
  process.stderr.write(`commercial-api: request handler failed\n${detail}\n`);
}

function requestPathname(target: string): string | null {
  // Origin-form only ("/path?query"). Absolute-form, authority-form and "*"
  // targets are rejected rather than interpreted.
  if (!target.startsWith("/")) {
    return null;
  }

  const queryIndex = target.indexOf("?");
  return queryIndex === -1 ? target : target.slice(0, queryIndex);
}

async function respondReadiness(response: ServerResponse, checkReadiness: () => Promise<boolean>): Promise<void> {
  let ready = false;
  try {
    ready = await checkReadiness();
  } catch {
    ready = false;
  }

  if (ready) {
    sendJson(response, 200, READY_BODY);
  } else {
    sendError(response, 503, "NOT_READY");
  }
}

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string | null,
  applicationRoute: ApplicationRoute | null,
  readHealth: () => unknown,
  checkReadiness: () => Promise<boolean>,
): void | Promise<void> {
  if (pathname === null) {
    sendError(response, 400, "BAD_REQUEST");
    return;
  }

  if (applicationRoute !== null) {
    if (!applicationRoute.methods.includes(request.method ?? "")) {
      request.resume();
      sendError(response, 405, "METHOD_NOT_ALLOWED", { Allow: applicationRoute.methods.join(", ") });
      return;
    }
    return applicationRoute.handle(request, response);
  }

  if (pathname !== HEALTH_PATH && pathname !== READY_PATH) {
    sendError(response, 404, "NOT_FOUND");
    return;
  }

  if (request.method !== "GET") {
    sendError(response, 405, "METHOD_NOT_ALLOWED", { Allow: "GET" });
    return;
  }

  if (pathname === READY_PATH) {
    return respondReadiness(response, checkReadiness);
  }

  sendJson(response, 200, readHealth());
}

export function createCommercialApiServer(dependencies: CommercialApiServerDependencies = {}): Server {
  const readHealth = dependencies.readHealth ?? (() => HEALTH_BODY);
  const checkReadiness = dependencies.checkReadiness ?? (async () => false);
  const reportError = dependencies.reportError ?? defaultReportError;
  const application = dependencies.application;

  const fail = (response: ServerResponse, error: unknown) => {
    reportError(error);

    if (response.headersSent) {
      response.destroy();
      return;
    }

    sendError(response, 500, "INTERNAL_ERROR");
  };

  const server = createServer((request, response) => {
    try {
      const pathname = requestPathname(request.url ?? "");
      const applicationRoute = pathname !== null && application !== undefined ? application.route(pathname) : null;

      // Only application routes read a request body; discard any other.
      if (applicationRoute === null) {
        request.resume();
      }

      const pending = handleRequest(request, response, pathname, applicationRoute, readHealth, checkReadiness);
      pending?.catch((error: unknown) => fail(response, error));
    } catch (error) {
      fail(response, error);
    }
  });

  // Malformed HTTP never reaches the handler; answer with the same JSON shape
  // instead of Node's default plain-text response.
  server.on("clientError", (_error: Error, socket: Socket) => {
    if (!socket.writable) {
      socket.destroy();
      return;
    }

    const { payload, headers } = serializeJson(400, { status: "error", code: "BAD_REQUEST" });
    const headerLines = Object.entries({ ...headers, Connection: "close" })
      .map(([name, value]) => `${name}: ${value}`)
      .join("\r\n");
    socket.end(`HTTP/1.1 400 Bad Request\r\n${headerLines}\r\n\r\n${payload}`);
  });

  return server;
}
