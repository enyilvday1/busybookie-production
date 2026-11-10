import type { IncomingMessage } from "node:http";

// Bounded, strict request bodies. Bodies are never logged or echoed.

// Ample for a title (200 characters) and an idempotency key (128), including
// multi-byte characters and JSON escaping; nowhere near megabytes.
export const MAX_JSON_BODY_BYTES = 4096;

export type BodyErrorCode = "INVALID_REQUEST" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE";

export class RequestBodyError extends Error {
  override readonly name = "RequestBodyError";

  constructor(readonly code: BodyErrorCode) {
    super(code);
  }
}

const JSON_MEDIA_TYPE = /^application\/json\s*(;\s*charset\s*=\s*"?utf-8"?\s*)?$/i;

async function readBoundedBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = request.headers["content-length"];
  if (declared !== undefined && (!/^[0-9]+$/.test(declared) || Number(declared) > maxBytes)) {
    throw new RequestBodyError(/^[0-9]+$/.test(declared) ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) {
      throw new RequestBodyError("PAYLOAD_TOO_LARGE");
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

// Collects the member names of the top-level object from JSON text that
// JSON.parse has already accepted, so duplicates (which JSON.parse silently
// collapses to the last value) can be rejected.
function topLevelMemberNames(text: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let index = 0;

  while (index < text.length) {
    const character = text[index]!;
    if (character === '"') {
      let end = index + 1;
      while (text[end] !== '"') {
        end += text[end] === "\\" ? 2 : 1;
      }
      if (depth === 1) {
        let next = end + 1;
        while (/\s/.test(text[next] ?? "")) next += 1;
        if (text[next] === ":") {
          names.push(JSON.parse(text.slice(index, end + 1)) as string);
        }
      }
      index = end + 1;
      continue;
    }
    if (character === "{" || character === "[") depth += 1;
    if (character === "}" || character === "]") depth -= 1;
    index += 1;
  }
  return names;
}

// Credential-bearing routes carry a provider credential of up to 8192 UTF-8
// bytes, which JSON escaping can expand several times over. Those routes opt
// in to this larger, still bounded, limit; every other route keeps
// MAX_JSON_BODY_BYTES.
export const MAX_CREDENTIAL_JSON_BODY_BYTES = 65_536;

// Reads a JSON object body: exact JSON media type, bounded size, valid UTF-8,
// a single object (not an array, null or primitive), no duplicate members,
// and only the allowed member names.
export async function readJsonObjectBody(
  request: IncomingMessage,
  allowedMembers: ReadonlySet<string>,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<Record<string, unknown>> {
  if (!JSON_MEDIA_TYPE.test(request.headers["content-type"] ?? "")) {
    throw new RequestBodyError("UNSUPPORTED_MEDIA_TYPE");
  }

  const bytes = await readBoundedBody(request, maxBytes);

  let text: string;
  let parsed: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(text);
  } catch {
    throw new RequestBodyError("INVALID_REQUEST");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RequestBodyError("INVALID_REQUEST");
  }

  const names = topLevelMemberNames(text);
  if (new Set(names).size !== names.length || names.some((name) => !allowedMembers.has(name))) {
    throw new RequestBodyError("INVALID_REQUEST");
  }

  return parsed as Record<string, unknown>;
}

// For routes that take no body: anything other than an empty body is rejected.
export async function readEmptyBody(request: IncomingMessage): Promise<void> {
  const bytes = await readBoundedBody(request, MAX_JSON_BODY_BYTES);
  if (bytes.length !== 0) {
    throw new RequestBodyError("INVALID_REQUEST");
  }
}
