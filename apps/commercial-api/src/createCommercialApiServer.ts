import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

// Foundation HTTP adapter. Two routes: GET /__health (liveness, never touches
// the database) and GET /__ready (readiness); everything else is a
// deterministic JSON error. Responses never echo the request target, query,
// headers or error details.

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

export type ErrorCode = "BAD_REQUEST" | "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "NOT_READY" | "INTERNAL_ERROR";

export type CommercialApiServerDependencies = Readonly<{
  // Test seam: produces the health body. Production uses HEALTH_BODY.
  readHealth?: () => unknown;
  // Resolves true only when the service can take traffic. Must be bounded;
  // a rejection is treated as not ready. Defaults to never ready.
  checkReadiness?: () => Promise<boolean>;
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
  readHealth: () => unknown,
  checkReadiness: () => Promise<boolean>,
): void | Promise<void> {
  const pathname = requestPathname(request.url ?? "");

  if (pathname === null) {
    sendError(response, 400, "BAD_REQUEST");
    return;
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

  const fail = (response: ServerResponse, error: unknown) => {
    reportError(error);

    if (response.headersSent) {
      response.destroy();
      return;
    }

    sendError(response, 500, "INTERNAL_ERROR");
  };

  const server = createServer((request, response) => {
    // No route reads a request body; discard any that arrives.
    request.resume();

    try {
      const pending = handleRequest(request, response, readHealth, checkReadiness);
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
