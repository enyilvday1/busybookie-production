import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_GENAI_ACTIVATION_LIMITS as policy } from "../src/googleGenai/googleGenAiActivationLimits.js";
import type { GoogleGenAiFetch, GoogleGenAiPrepareOutputUri, GoogleGenAiSecureOutputTransportPolicy } from "../src/googleGenai/transport/googleGenAiSecureOutputTransport.types.js";
import { GoogleGenAiSecureOutputTransportError } from "../src/googleGenai/transport/googleGenAiSecureOutputTransportError.js";
import { getGoogleGenAiFilesMetadata } from "../src/googleGenai/transport/getGoogleGenAiFilesMetadata.js";

const uri = "https://generativelanguage.googleapis.com/v1beta/files/test-123:download?alt=media";
const key = "synthetic-metadata-key";
const now = Date.UTC(2026, 9, 25);
const hex = "abcdef0123456789".repeat(4);
const encodedHash = (text: string) => Buffer.from(text, "ascii").toString("base64");
const fixture = { name: "files/test-123", state: "ACTIVE", mimeType: "video/mp4", sizeBytes: "123", sha256Hash: encodedHash(hex), expirationTime: "2026-10-25T02:00:00Z" };
const request = { uri, maxOutputBytes: policy.limits.maxOutputBytes };
const encoder = new TextEncoder();
const context = (remaining = 1_200_000) => ({ signal: new AbortController().signal, remainingMs: () => remaining });
const response = (value: unknown = fixture, headers: HeadersInit = {}) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json", ...headers } });
function run(fetchImpl: GoogleGenAiFetch, options: { valuePolicy?: GoogleGenAiSecureOutputTransportPolicy; remaining?: number; nowMs?: () => number; signal?: AbortSignal; max?: number; uri?: string; apiKey?: string } = {}) {
  return getGoogleGenAiFilesMetadata({ ...request, uri: options.uri ?? uri, maxOutputBytes: options.max ?? request.maxOutputBytes },
    { ...context(options.remaining), ...(options.signal ? { signal: options.signal } : {}) },
    { apiKey: options.apiKey ?? key, policy: options.valuePolicy ?? policy, nowMs: options.nowMs ?? (() => now), fetchImpl });
}
function raw(text: string | Uint8Array, headers: Record<string, string> = {}) {
  return new Response(typeof text === "string" ? encoder.encode(text) : new Uint8Array(text), { headers: { "content-type": "application/json", ...headers } });
}
function padded(size: number) {
  const base = JSON.stringify({ ...fixture, padding: "" });
  return JSON.stringify({ ...fixture, padding: "x".repeat(size - encoder.encode(base).length) });
}
function capture<T>(promise: Promise<T>) { return promise.then((result) => ({ result, error: undefined }), (error: unknown) => ({ result: undefined, error })); }
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real network forbidden"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers(); vi.restoreAllMocks();
});

describe("bounded Files metadata authority", () => {
  it("is prepare-closure compatible and sends one exact fixed request, returning narrow frozen evidence", async () => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => response({ ...fixture, source: "GENERATED", uri: "https://evil.test/secret", downloadUri: "https://evil.test/secret" }));
    const prepare: GoogleGenAiPrepareOutputUri = (input, ctx) => getGoogleGenAiFilesMetadata(input, ctx, { apiKey: key, policy, nowMs: () => now, fetchImpl });
    const result = await prepare(request, context());
    expect(result).toEqual({ resource: { fileId: "test-123", name: fixture.name, downloadUri: uri }, byteCount: 123, sha256: hex, mimeType: "video/mp4", expirationTime: fixture.expirationTime, expirationTimeMs: now + 7200000 });
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.resource)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/evil|secret|synthetic|"(?:sha256Hash|source|state)":/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/files/test-123");
    expect(init).toMatchObject({ method: "GET", redirect: "manual", headers: { "x-goog-api-key": key, Accept: "application/json" } });
    expect(Object.hasOwn(init, "body")).toBe(false); expect(init.headers).toEqual({ "x-goog-api-key": key, Accept: "application/json" });
    expect(url).not.toContain(key); expect(new URL(url).search).toBe(""); expect(init.signal!.aborted).toBe(true);
  });
  it("rejects URI authority before touching credentials or fetch", async () => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(); const readKey = vi.fn(() => key);
    await expect(getGoogleGenAiFilesMetadata({ ...request, uri: uri + "&key=SECRET" }, context(), { get apiKey() { return readKey(); }, policy, nowMs: () => now, fetchImpl })).rejects.toMatchObject({ code: "DOWNLOAD_URI_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled(); expect(readKey).not.toHaveBeenCalled();
  });
  it.each([301, 302, 307, 308, 400, 401, 403, 404, 429, 500, 503, 201])("rejects HTTP %s with zero internal retries and releases body", async (status) => {
    const cancel = vi.fn(); const stream = new ReadableStream<Uint8Array>({ cancel });
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => new Response(stream, { status }));
    await expect(run(fetchImpl)).rejects.toMatchObject({ code: "FILES_METADATA_HTTP_FAILED", httpStatus: status });
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
  });
  it("rejects missing body", async () => {
    await expect(run(async () => new Response(null, { headers: { "content-type": "application/json" } }))).rejects.toMatchObject({ code: "FILES_METADATA_HTTP_FAILED" });
  });
  it.each(["text/plain", "", "application/jsonx"])("rejects wrong Content-Type %s", async (contentType) => {
    await expect(run(async () => response(fixture, { "content-type": contentType }))).rejects.toMatchObject({ code: "FILES_METADATA_INVALID", retryable: false });
  });
  it("accepts MIME case/parameters and ignores compressed/small Content-Length as application-byte authority", async () => {
    expect((await run(async () => response(fixture, { "content-type": "Application/JSON; charset=utf-8", "content-length": "1", "content-encoding": "gzip" }))).byteCount).toBe(123);
  });
  it.each(["fetch", "read"])("sanitizes %s failure and does not retry", async (stage) => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.error(new Error(key + uri)); } });
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => { if (stage === "fetch") throw new Error(key + uri); return new Response(stream, { headers: { "content-type": "application/json" } }); });
    const { error } = await capture(run(fetchImpl));
    expect(error).toMatchObject({ code: "FILES_METADATA_HTTP_FAILED" }); expect(fetchImpl).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
    expect(String(error) + (error as Error).stack + JSON.stringify(error)).not.toContain(key);
    expect(String(error) + (error as Error).stack + JSON.stringify(error)).not.toContain(uri); expect(Object.hasOwn(error as object, "cause")).toBe(false);
  });

  it.each([
    ["name", "files/other", "FILE_IDENTITY_MISMATCH"], ["name", " files/test-123", "FILE_IDENTITY_MISMATCH"],
    ["name", undefined, "FILES_METADATA_INVALID"], ["name", 1, "FILES_METADATA_INVALID"],
    ...["PROCESSING", "FAILED", "UNKNOWN", undefined].map((state) => ["state", state, "FILE_NOT_ACTIVE"]),
    ["state", null, "FILES_METADATA_INVALID"], ["state", 1, "FILES_METADATA_INVALID"],
    ["source", "UPLOADED", "FILES_METADATA_INVALID"], ["source", null, "FILES_METADATA_INVALID"], ["source", 1, "FILES_METADATA_INVALID"],
    ...["video/webm", "VIDEO/MP4", undefined, null, 7].map((mime) => ["mimeType", mime, "FILE_MIME_INVALID"]),
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "0", "-1", "01", "+1", "1.5", "1e2", "1 ", "1\n", "9007199254740992", null, undefined].map((size) => ["sizeBytes", size, "FILES_METADATA_INVALID"]),
  ])("rejects invalid metadata field %s=%s with exact classification", async (field, value, code) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => response({ ...fixture, [field as string]: value }));
    await expect(run(fetchImpl)).rejects.toMatchObject({ code, retryable: false }); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([123, "123", policy.limits.maxOutputBytes])("accepts safe size %s at its exact maximum", async (sizeBytes) => {
    expect((await run(async () => response({ ...fixture, sizeBytes }), { max: Number(sizeBytes) })).byteCount).toBe(Number(sizeBytes));
  });
  it.each([
    ["request", 124, 123], ["policy", policy.limits.maxOutputBytes + 1, Number.MAX_SAFE_INTEGER],
  ] as const)("enforces %s output maximum", async (_label, sizeBytes, max) => {
    await expect(run(async () => response({ ...fixture, sizeBytes }), { max })).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });
  it.each([0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid maxOutputBytes %s before fetch", async (max) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(); await expect(run(fetchImpl, { max })).rejects.toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID" }); expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["-1", "+1", "1.5", "1e2", "1, 1", "01", "garbage"])("rejects malformed Content-Length %s", async (length) => {
    await expect(run(async () => response(fixture, { "content-length": length }))).rejects.toMatchObject({ code: "FILES_METADATA_INVALID" });
  });
  it("rejects advertised excess before read, but awaits cancellation before releasing lock", async () => {
    let finish!: () => void; const cancel = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const stream = new ReadableStream<Uint8Array>({ cancel }); const read = vi.fn();
    const original = stream.getReader.bind(stream);
    const getReader = vi.spyOn(stream, "getReader").mockImplementation(() => {
      const live = original(), originalRead = live.read.bind(live);
      vi.spyOn(live, "read").mockImplementation(() => { read(); return originalRead(); });
      return live;
    });
    const outcome = capture(run(async () => new Response(stream, { headers: { "content-type": "application/json", "content-length": "999999999999999999999999999" } })));
    let settled = false; void outcome.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0); expect(getReader).toHaveBeenCalledTimes(1); expect(read).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledTimes(1); expect(settled).toBe(false); expect(stream.locked).toBe(true);
    finish(); expect((await outcome).error).toMatchObject({ code: "FILES_METADATA_RESPONSE_TOO_LARGE" }); expect(stream.locked).toBe(false);
  });
  it("accepts exactly 65536 bytes and counts overflows regardless of advertised length or encoding", async () => {
    const exact = padded(65536); expect(encoder.encode(exact).length).toBe(65536);
    const result = await run(async () => raw(exact, { "content-length": "65536" })); expect(result.byteCount).toBe(123);
    await expect(run(async () => raw(padded(65537), { "content-length": "1", "content-encoding": "gzip" }))).rejects.toMatchObject({ code: "FILES_METADATA_RESPONSE_TOO_LARGE" });
  });
  it.each(["split", "giant"])("rejects %s actual overflow before decode/retention", async (kind) => {
    const cancel = vi.fn(); const stream = new ReadableStream<Uint8Array>({ start(c) {
      if (kind === "split") { c.enqueue(new Uint8Array(65536)); c.enqueue(new Uint8Array(1)); }
      else c.enqueue(new Uint8Array(65537));
    }, cancel });
    await expect(run(async () => new Response(stream, { headers: { "content-type": "application/json" } }))).rejects.toMatchObject({ code: "FILES_METADATA_RESPONSE_TOO_LARGE" });
    expect(cancel).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
  });
  it("handles one-byte chunks and never calls whole-body convenience APIs", async () => {
    const bytes = encoder.encode(JSON.stringify({ ...fixture, ignored: "π🙂" }));
    const stream = new ReadableStream<Uint8Array>({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } });
    const res = new Response(stream, { headers: { "content-type": "application/json" } });
    const text = vi.spyOn(res, "text"), json = vi.spyOn(res, "json"), arrayBuffer = vi.spyOn(res, "arrayBuffer");
    expect((await run(async () => res)).byteCount).toBe(123); expect(text).not.toHaveBeenCalled(); expect(json).not.toHaveBeenCalled(); expect(arrayBuffer).not.toHaveBeenCalled(); expect(stream.locked).toBe(false);
  });
  it.each([
    "{", "null", "[]", "42", '"text"', new Uint8Array([255]),
    JSON.stringify(fixture).replace('"state":"ACTIVE"', '"state":"ACTIVE","state":"ACTIVE"'),
    JSON.stringify({ ...fixture, extra: {} }).replace('"extra":{}', '"extra":{"x":1,"x":2}'),
    JSON.stringify(fixture).replace('"state":"ACTIVE"', '"state":"ACTIVE","\\u0073tate":"ACTIVE"'),
  ])("rejects invalid UTF-8/JSON/duplicate keys %#", async (input) => {
    await expect(run(async () => raw(input))).rejects.toMatchObject({ code: "FILES_METADATA_INVALID", retryable: false });
  });
  it("allows identical keys in different nested scopes while ignoring nonauthoritative fields", async () => {
    expect((await run(async () => response({ ...fixture, extra: [{ id: 1 }, { id: 2 }] }))).byteCount).toBe(123);
  });

  it.each([hex, hex.toUpperCase(), "aBcDeF0123456789".repeat(4)])("normalizes canonical Base64-of-ASCII-hex %s", async (value) => {
    expect((await run(async () => response({ ...fixture, sha256Hash: encodedHash(value) }))).sha256).toBe(value.toLowerCase());
  });
  it.each([
    undefined, null, hex, encodedHash(hex).slice(0, -2), Buffer.from(hex).toString("base64url"), Buffer.alloc(32).toString("base64"),
    encodedHash("g".repeat(64)), encodedHash("a".repeat(63)), encodedHash("a".repeat(65)), encodedHash(hex) + "\n",
    encodedHash(hex).slice(0, 85) + "R==", " " + encodedHash(hex),
  ])("rejects unsupported hash format %#", async (sha256Hash) => {
    await expect(run(async () => response({ ...fixture, sha256Hash }))).rejects.toMatchObject({ code: "FILE_HASH_FORMAT_UNSUPPORTED" });
  });
  it.each([
    ["2026-10-25T01:00:00Z", now + 3600000], ["2026-10-25T01:00:00.123Z", now + 3600123],
    ["2026-10-25T01:00:00.000999999Z", now + 3600000],
  ] as const)("validates expiry and floors fractional precision %s", async (expirationTime, expirationTimeMs) => {
    expect((await run(async () => response({ ...fixture, expirationTime }))).expirationTimeMs).toBe(expirationTimeMs);
  });
  it.each(["2026-10-25T00:59:59.999Z", "2026-10-25T00:00:00Z", "2026-10-24T00:00:00Z"])("rejects too-close/expired %s", async (expirationTime) => {
    await expect(run(async () => response({ ...fixture, expirationTime }))).rejects.toMatchObject({ code: "FILE_EXPIRATION_TOO_CLOSE" });
  });
  it.each([undefined, null, 1, "bad", "2026-13-25T02:00:00Z", "2026-00-25T02:00:00Z", "2026-10-00T02:00:00Z", "2026-04-31T02:00:00Z", "2026-02-29T02:00:00Z", "2026-10-25T24:00:00Z", "2026-10-25T02:60:00Z", "2026-10-25T02:00:60Z", "2026-10-25T02:00:00+00:00", " 2026-10-25T02:00:00Z", "2026-10-25T02:00:00Z\n"])("rejects invalid calendar/time serialization %s", async (expirationTime) => {
    await expect(run(async () => response({ ...fixture, expirationTime }))).rejects.toMatchObject({ code: "FILE_EXPIRATION_INVALID" });
  });
  it("accepts an actual leap day", async () => {
    expect((await run(async () => response({ ...fixture, expirationTime: "2028-02-29T12:00:00Z" }))).expirationTimeMs).toBe(Date.UTC(2028, 1, 29, 12));
  });

  it.each([NaN, Infinity, -Infinity, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER + 1, -(Number.MAX_SAFE_INTEGER + 1)])("refuses malformed budget %s before fetch", async (remaining) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(); await expect(run(fetchImpl, { remaining })).rejects.toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID" }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([-1, 0, 29999.5])("refuses insufficient valid budget %s before fetch", async (remaining) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(); await expect(run(fetchImpl, { remaining })).rejects.toMatchObject({ code: "RECOVERY_BUDGET_EXHAUSTED" }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("admits sufficient fractional milliseconds", async () => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => response()); expect((await run(fetchImpl, { remaining: 30000.5 })).byteCount).toBe(123); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each(["", " ", "bad key", "bad\nkey", "π"])("rejects malformed key %s before fetch", async (apiKey) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(); await expect(run(fetchImpl, { apiKey })).rejects.toMatchObject({ code: "CREDENTIALS_INVALID" }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(["headers", "body"])("one 30000-ms timer bounds stalled %s without retry", async (stage) => {
    const cancel = vi.fn(); const stream = new ReadableStream<Uint8Array>({ cancel });
    const fetchImpl = vi.fn<GoogleGenAiFetch>((_url, init) => stage === "body" ? Promise.resolve(new Response(stream, { headers: { "content-type": "application/json" } })) : new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error(key)), { once: true })));
    const outcome = capture(run(fetchImpl)); await vi.advanceTimersByTimeAsync(29999); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1); expect((await outcome).error).toMatchObject({ code: "FILES_METADATA_TIMEOUT" }); expect(fetchImpl).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false); if (stage === "body") expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("the body receives only the remainder of the same headers-started deadline", async () => {
    let deliver!: (r: Response) => void;
    const fetchImpl = vi.fn<GoogleGenAiFetch>(() => new Promise((resolve) => { deliver = resolve; }));
    const outcome = capture(run(fetchImpl)); await vi.advanceTimersByTimeAsync(20000);
    deliver(new Response(new ReadableStream(), { headers: { "content-type": "application/json" } }));
    await vi.advanceTimersByTimeAsync(10000); expect((await outcome).error).toMatchObject({ code: "FILES_METADATA_TIMEOUT" }); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each(["headers", "body"])("propagates parent cancellation in %s with cleanup", async (stage) => {
    const parent = new AbortController(); const add = vi.spyOn(parent.signal, "addEventListener"), remove = vi.spyOn(parent.signal, "removeEventListener");
    const stream = new ReadableStream();
    const fetchImpl = vi.fn<GoogleGenAiFetch>((_url, init) => stage === "body" ? Promise.resolve(new Response(stream, { headers: { "content-type": "application/json" } })) : new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error(key)), { once: true })));
    const outcome = capture(run(fetchImpl, { signal: parent.signal })); await vi.advanceTimersByTimeAsync(0); parent.abort(new Error(key));
    const { error } = await outcome; expect(error).toMatchObject({ code: "OPERATION_ABORTED", retryable: false }); expect(fetchImpl).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false); expect(add).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1); expect((error as Error).stack + JSON.stringify(error)).not.toContain(key);
  });
  it("preserves safe parent timeout classification and refuses an already aborted operation", async () => {
    const parent = new AbortController(); parent.abort(new GoogleGenAiSecureOutputTransportError("RECONCILIATION_TIMEOUT")); const fetchImpl = vi.fn<GoogleGenAiFetch>();
    await expect(run(fetchImpl, { signal: parent.signal })).rejects.toMatchObject({ code: "RECONCILIATION_TIMEOUT" }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("checks the deadline after synchronous validation and samples expiry clock again", async () => {
    let elapsed = 0, samples = 0; vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    const nowMs = () => { if (samples++ > 0) elapsed = 30000; return now; };
    await expect(run(async () => response(), { nowMs })).rejects.toMatchObject({ code: "FILES_METADATA_TIMEOUT" });
  });
  it("removes timer and parent listener on success and exposes no raw metadata", async () => {
    const parent = new AbortController(); const remove = vi.spyOn(parent.signal, "removeEventListener");
    const result = await run(async () => response({ ...fixture, private: key }), { signal: parent.signal });
    expect(remove).toHaveBeenCalledTimes(1); expect(Object.keys(result).sort()).toEqual(["byteCount", "expirationTime", "expirationTimeMs", "mimeType", "resource", "sha256"]); expect(JSON.stringify(result)).not.toContain(key);
  });
});

// ---- B4V8C closed dependency-error boundary fixtures (synthetic data only) ----
const B4V8C_MARKER = "SYNTHETIC_DEPENDENCY_SECRET";
const B4V8C_URI = "https://generativelanguage.googleapis.com/v1beta/files/hostile-999:download?alt=media";
type B4v8cCode = GoogleGenAiSecureOutputTransportError["code"];
const b4v8cGetterReads = { count: 0 };

/** Genuine constructor-produced frozen base error whose runtime stack accessor accepts hostile content. */
function b4v8cHostileBase(code: B4v8cCode, details: { attempt?: number; httpStatus?: number } = {}): GoogleGenAiSecureOutputTransportError {
  const raw = new GoogleGenAiSecureOutputTransportError(code, details);
  expect(Object.isFrozen(raw)).toBe(true);
  (raw as { stack?: string }).stack = `${B4V8C_MARKER} ${B4V8C_URI}`;
  expect(raw.stack).toContain(B4V8C_MARKER);
  return raw;
}

/** Transport-prototype candidate NOT built by the trusted constructor, carrying hostile data. */
function b4v8cForged(fields: Record<string, unknown>, getters: readonly string[] = [], inherited = false): GoogleGenAiSecureOutputTransportError {
  const descriptors: PropertyDescriptorMap = {
    message: { value: `${B4V8C_MARKER} message`, enumerable: true },
    stack: { value: `${B4V8C_MARKER} ${B4V8C_URI}`, enumerable: true },
    cause: { value: new Error(`${B4V8C_MARKER} cause`), enumerable: true },
    providerBody: { value: `${B4V8C_MARKER} body`, enumerable: true },
  };
  for (const [field, value] of Object.entries(fields)) descriptors[field] = { value, enumerable: true };
  for (const field of getters) {
    descriptors[field] = { enumerable: true, get: () => { b4v8cGetterReads.count += 1; throw new Error(`${B4V8C_MARKER} getter ${field}`); } };
  }
  const carrier = Object.create(GoogleGenAiSecureOutputTransportError.prototype, descriptors) as object;
  return (inherited ? Object.create(carrier) : carrier) as GoogleGenAiSecureOutputTransportError;
}

function b4v8cOrdinary(): Error {
  return Object.assign(new Error(`${B4V8C_MARKER} ordinary ${B4V8C_URI}`, { cause: new Error(`${B4V8C_MARKER} cause`) }), { providerBody: `${B4V8C_MARKER} body` });
}

const B4V8C_VALID_FIELDS = { code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, httpStatus: 503, retryable: true } as const;
const B4V8C_MALFORMED: ReadonlyArray<readonly [string, () => unknown]> = [
  ["string status '404'", () => b4v8cForged({ code: "DOWNLOAD_HTTP_FAILED", attempt: 1, httpStatus: "404", retryable: false })],
  ["NaN status", () => b4v8cForged({ code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, httpStatus: Number.NaN, retryable: true })],
  ["out-of-range status 600", () => b4v8cForged({ code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, httpStatus: 600, retryable: true })],
  ["invalid attempt -1", () => b4v8cForged({ code: "DOWNLOAD_HTTP_FAILED", attempt: -1, httpStatus: 503, retryable: true })],
  ["contradictory 503 with retryable=false", () => b4v8cForged({ ...B4V8C_VALID_FIELDS, retryable: false })],
  ["contradictory 404 with retryable=true", () => b4v8cForged({ code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, httpStatus: 404, retryable: true })],
  ["contradictory timeout with retryable=false", () => b4v8cForged({ code: "DOWNLOAD_TIMEOUT", attempt: undefined, httpStatus: undefined, retryable: false })],
  ["inherited semantic fields", () => b4v8cForged({ ...B4V8C_VALID_FIELDS }, [], true)],
  ["unknown code", () => b4v8cForged({ code: "NOT_A_CODE", attempt: undefined, httpStatus: 503, retryable: true })],
  ["missing retryable field", () => b4v8cForged({ code: "DOWNLOAD_TIMEOUT", attempt: undefined, httpStatus: undefined })],
];
const B4V8C_ACCESSOR_FIELDS = ["code", "attempt", "httpStatus", "retryable"] as const;
function b4v8cAccessorBacked(field: typeof B4V8C_ACCESSOR_FIELDS[number]): GoogleGenAiSecureOutputTransportError {
  const fields: Record<string, unknown> = { ...B4V8C_VALID_FIELDS };
  delete fields[field];
  return b4v8cForged(fields, [field]);
}

/** Outward error is a fresh trusted base instance with nothing dependency-owned reachable. */
function b4v8cExpectSanitized(outward: unknown, raw: unknown): void {
  expect(outward).not.toBe(raw);
  expect(outward).toBeInstanceOf(GoogleGenAiSecureOutputTransportError);
  expect(Object.getPrototypeOf(outward)).toBe(GoogleGenAiSecureOutputTransportError.prototype);
  expect(Object.isFrozen(outward)).toBe(true);
  for (const field of ["cause", "providerBody"]) expect(Object.hasOwn(outward as object, field)).toBe(false);
  const seen = new Set<unknown>();
  const visit = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      for (const secret of [B4V8C_MARKER, B4V8C_URI, "hostile-999"]) expect(value, path).not.toContain(secret);
      return;
    }
    if (value === null || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) return;
    seen.add(value);
    expect(value, path).not.toBe(raw);
    if (value instanceof Error) { visit(value.message, `${path}.message`); visit(value.stack, `${path}.stack`); visit(String(value), `${path}.toString`); }
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if ("value" in descriptor) visit(descriptor.value, `${path}.${String(key)}`);
    }
  };
  visit(outward, "outward");
  expect(JSON.stringify(outward)).not.toContain(B4V8C_MARKER);
}

describe("B4V8C metadata closed dependency-error boundary", () => {
  beforeEach(() => { b4v8cGetterReads.count = 0; });
  const throwing = (make: () => unknown) => vi.fn<GoogleGenAiFetch>(async () => { throw make(); });

  it.each(B4V8C_MALFORMED)("fails a %s transport-looking dependency error closed as nonretryable CONFIG", async (_label, make) => {
    let raw: unknown;
    const fetchImpl = throwing(() => (raw = make()));
    const { error } = await capture(run(fetchImpl));
    expect(error).toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID", retryable: false });
    b4v8cExpectSanitized(error, raw);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(B4V8C_ACCESSOR_FIELDS)("never executes an accessor-backed %s getter", async (field) => {
    let raw: unknown;
    const { error } = await capture(run(throwing(() => (raw = b4v8cAccessorBacked(field)))));
    expect(b4v8cGetterReads.count).toBe(0);
    expect(error).toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID", retryable: false });
    b4v8cExpectSanitized(error, raw);
  });

  it("reconstructs a hostile genuine frozen base error freshly", async () => {
    const raw = b4v8cHostileBase("FILE_NOT_ACTIVE");
    const { error } = await capture(run(throwing(() => raw)));
    expect(error).toMatchObject({ code: "FILE_NOT_ACTIVE", retryable: false });
    b4v8cExpectSanitized(error, raw);
  });

  it("keeps legitimate retry semantics of a genuine transient 503 without an internal retry", async () => {
    const raw = b4v8cHostileBase("FILES_METADATA_HTTP_FAILED", { httpStatus: 503 });
    const fetchImpl = throwing(() => raw);
    const { error } = await capture(run(fetchImpl));
    expect(error).toMatchObject({ code: "FILES_METADATA_HTTP_FAILED", httpStatus: 503, retryable: true });
    b4v8cExpectSanitized(error, raw);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("normalizes a genuine subclass to a fresh base error", async () => {
    class GenuineSubclass extends GoogleGenAiSecureOutputTransportError {}
    const raw = new GenuineSubclass("FILES_METADATA_HTTP_FAILED", { httpStatus: 404 });
    const { error } = await capture(run(throwing(() => raw)));
    expect(error).toMatchObject({ code: "FILES_METADATA_HTTP_FAILED", httpStatus: 404, retryable: false });
    b4v8cExpectSanitized(error, raw);
  });

  it("keeps the frozen network-failure fallback for an ordinary error, discarding its cause and custom data", async () => {
    let raw: unknown;
    const { error } = await capture(run(throwing(() => (raw = b4v8cOrdinary()))));
    expect(error).toMatchObject({ code: "FILES_METADATA_HTTP_FAILED", httpStatus: undefined, retryable: true });
    b4v8cExpectSanitized(error, raw);
  });

  it("classifies a parent abort reason without executing its getters", async () => {
    const parent = new AbortController();
    const reason = b4v8cAccessorBacked("code");
    parent.abort(reason);
    const fetchImpl = vi.fn<GoogleGenAiFetch>();
    const { error } = await capture(run(fetchImpl, { signal: parent.signal }));
    expect(b4v8cGetterReads.count).toBe(0);
    expect(error).toMatchObject({ code: "OPERATION_ABORTED" });
    b4v8cExpectSanitized(error, reason);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
