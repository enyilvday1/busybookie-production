import type { ServerResponse } from "node:http";

// One JSON response shape for the whole API. Error bodies are always
// {"status":"error","code":<code>} and never carry request, identity, SQL or
// credential material.

export type ErrorCode =
  | "BAD_REQUEST"
  | "INVALID_REQUEST"
  | "AUTHENTICATION_REQUIRED"
  | "ACCOUNT_UNAVAILABLE"
  | "ENTITLEMENT_NOT_AVAILABLE"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "INTERNAL_ERROR"
  | "NOT_READY"
  | "SERVICE_UNAVAILABLE";

export type Headers = Readonly<Record<string, string>>;

export function serializeJson(status: number, body: unknown, extraHeaders: Headers = {}) {
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

export function sendJson(response: ServerResponse, status: number, body: unknown, extraHeaders?: Headers): void {
  // Serialize before writing so a failure cannot leave a partial response.
  const serialized = serializeJson(status, body, extraHeaders);
  response.writeHead(serialized.status, serialized.headers);
  response.end(serialized.payload);
}

export function sendError(response: ServerResponse, status: number, code: ErrorCode, extraHeaders?: Headers): void {
  sendJson(response, status, { status: "error", code }, extraHeaders);
}
