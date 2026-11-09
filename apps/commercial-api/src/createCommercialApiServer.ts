import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

// Foundation HTTP adapter. One route, GET /__health; everything else is a
// deterministic JSON error. Responses never echo the request target, query,
// headers or error details.

export const HEALTH_PATH = "/__health";

export const HEALTH_BODY = Object.freeze({
  status: "ok",
  service: "commercial-api",
});

export type ErrorCode = "BAD_REQUEST" | "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "INTERNAL_ERROR";

export type CommercialApiServerDependencies = Readonly<{
  // Test seam: produces the health body. Production uses HEALTH_BODY.
  readHealth?: () => unknown;
  // Server-side only; never reaches the client.
  reportError?: (error: unknown) => void;
}>;

function defaultReportError(error: unknown): void {
  const detail = error instanceof Error ? (error.stack ?? error.name) : "non-error value thrown";
  process.stderr.write(`commercial-api: request handler failed\n${detail}\n`);
}

function serializeJson(status: number, body: unknown, extraHeaders: Readonly<Record<string, string>> = {}) {
  const payload = `${JSON.stringify(body)}\n`;

  return {
    payload,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(Buffer.byteLength(payload)),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
    status,
  };
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Readonly<Record<string, string>>,
): void {
  // Serialize before writing so a failure cannot leave a partial response.
  const serialized = serializeJson(status, body, extraHeaders);
  response.writeHead(serialized.status, serialized.headers);
  response.end(serialized.payload);
}

function sendError(
  response: ServerResponse,
  status: number,
  code: ErrorCode,
  extraHeaders?: Readonly<Record<string, string>>,
): void {
  sendJson(response, status, { status: "error", code }, extraHeaders);
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

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  readHealth: () => unknown,
): void {
  const pathname = requestPathname(request.url ?? "");

  if (pathname === null) {
    sendError(response, 400, "BAD_REQUEST");
    return;
  }

  if (pathname !== HEALTH_PATH) {
    sendError(response, 404, "NOT_FOUND");
    return;
  }

  if (request.method !== "GET") {
    sendError(response, 405, "METHOD_NOT_ALLOWED", { Allow: "GET" });
    return;
  }

  sendJson(response, 200, readHealth());
}

export function createCommercialApiServer(dependencies: CommercialApiServerDependencies = {}): Server {
  const readHealth = dependencies.readHealth ?? (() => HEALTH_BODY);
  const reportError = dependencies.reportError ?? defaultReportError;

  const server = createServer((request, response) => {
    // No route reads a request body; discard any that arrives.
    request.resume();

    try {
      handleRequest(request, response, readHealth);
    } catch (error) {
      reportError(error);

      if (response.headersSent) {
        response.destroy();
        return;
      }

      sendError(response, 500, "INTERNAL_ERROR");
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
