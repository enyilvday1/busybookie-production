import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_GENAI_ACTIVATION_LIMITS as policy } from "../src/googleGenai/googleGenAiActivationLimits.js";
import type { GoogleGenAiFetch, GoogleGenAiOutputChunkSink, GoogleGenAiOutputUriDownloader, GoogleGenAiSecureOutputTransportPolicy, GoogleGenAiVerifiedFileMetadata } from "../src/googleGenai/transport/googleGenAiSecureOutputTransport.types.js";
import { GoogleGenAiSecureOutputTransportError } from "../src/googleGenai/transport/googleGenAiSecureOutputTransportError.js";
import { downloadGoogleGenAiFile } from "../src/googleGenai/transport/downloadGoogleGenAiFile.js";

const uri = "https://generativelanguage.googleapis.com/v1beta/files/test-123:download?alt=media";
const key = "synthetic-download-key";
const now = Date.UTC(2026, 9, 25);
const bytes = Uint8Array.from({ length: 1000 }, (_value, index) => (index * 7) % 256);
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const sha256 = digest(bytes);
const metadata: GoogleGenAiVerifiedFileMetadata = Object.freeze({
  resource: Object.freeze({ fileId: "test-123", name: "files/test-123", downloadUri: uri }),
  byteCount: bytes.length, sha256, mimeType: "video/mp4", expirationTime: "2026-10-25T02:00:00Z", expirationTimeMs: now + 7200000,
});
const context = (remaining = 1_200_000, signal = new AbortController().signal) => ({ signal, remainingMs: () => remaining });
function split(value: Uint8Array, size = 300): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < value.length; offset += size) chunks.push(value.slice(offset, offset + size));
  return chunks;
}
function stream(chunks: readonly unknown[] = split(bytes), cancel = vi.fn()) {
  return new ReadableStream<Uint8Array>({ start(c) { for (const chunk of chunks) c.enqueue(chunk as Uint8Array); c.close(); }, cancel });
}
function media(body: ReadableStream<Uint8Array> | null = stream(), headers: Record<string, string> = {}, status = 200) {
  return new Response(body, { status, headers: { "content-type": "video/mp4", ...headers } });
}
function collector() {
  const chunks: Uint8Array[] = [];
  const sink: GoogleGenAiOutputChunkSink & { chunks: Uint8Array[]; writeChunk: ReturnType<typeof vi.fn> } = { chunks, writeChunk: vi.fn(async (chunk: Uint8Array) => { chunks.push(Uint8Array.from(chunk)); }) };
  return sink;
}
const joined = (chunks: readonly Uint8Array[]) => Uint8Array.from(chunks.flatMap((chunk) => [...chunk]));
type Options = { metadata?: unknown; sink?: GoogleGenAiOutputChunkSink; remaining?: number; signal?: AbortSignal; apiKey?: string; policy?: GoogleGenAiSecureOutputTransportPolicy; nowMs?: () => number; monotonicNowMs?: () => number; remainingMs?: () => number };
function run(fetchImpl: GoogleGenAiFetch, options: Options = {}) {
  const ctx = context(options.remaining, options.signal);
  return downloadGoogleGenAiFile((options.metadata ?? metadata) as GoogleGenAiVerifiedFileMetadata, options.sink ?? collector(),
    options.remainingMs ? { ...ctx, remainingMs: options.remainingMs } : ctx,
    { apiKey: options.apiKey ?? key, policy: options.policy ?? policy, nowMs: options.nowMs ?? (() => now), fetchImpl, ...(options.monotonicNowMs ? { monotonicNowMs: options.monotonicNowMs } : {}) });
}
function capture<T>(promise: Promise<T>) { return promise.then((result) => ({ result, error: undefined }), (error: unknown) => ({ result: undefined, error })); }
function leakText(error: unknown) { return String(error) + (error as Error).stack + JSON.stringify(error) + (error as Error).message; }
function expectSanitized(error: unknown) {
  expect(error).toBeInstanceOf(GoogleGenAiSecureOutputTransportError);
  const text = leakText(error);
  for (const secret of [key, uri, sha256, "SECRET", "test-123", "generativelanguage"]) expect(text).not.toContain(secret);
  expect(Object.hasOwn(error as object, "cause")).toBe(false);
}
function withPolicy(patch: { limits?: object; timeouts?: object; recovery?: object }): GoogleGenAiSecureOutputTransportPolicy {
  return { ...policy, limits: { ...policy.limits, ...patch.limits }, timeouts: { ...policy.timeouts, ...patch.timeouts }, recovery: { ...policy.recovery, ...patch.recovery } } as GoogleGenAiSecureOutputTransportPolicy;
}
/** Wraps the stream reader so each provider read is observable without changing semantics. */
function observedReads(body: ReadableStream<Uint8Array>) {
  const reads = vi.fn(); const original = body.getReader.bind(body);
  vi.spyOn(body, "getReader").mockImplementation((() => {
    const live = original(), read = live.read.bind(live);
    vi.spyOn(live, "read").mockImplementation(() => { reads(); return read(); });
    return live;
  }) as typeof body.getReader);
  return reads;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real network forbidden"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers(); vi.restoreAllMocks();
});

describe("single-attempt bounded streaming Google file download", () => {
  it("is downloader-closure compatible, sends one exact fixed request and returns narrow frozen local evidence", async () => {
    const body = stream(); const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => media(body, { "content-length": String(bytes.length) }));
    const sink = collector();
    const downloader: GoogleGenAiOutputUriDownloader = (m, s, c) => downloadGoogleGenAiFile(m, s, c, { apiKey: ` ${key} `, policy, nowMs: () => now, fetchImpl });
    const result = await downloader(metadata, sink, context());
    expect(result).toEqual({ byteCount: bytes.length, sha256, mimeType: "video/mp4" }); expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result).sort()).toEqual(["byteCount", "mimeType", "sha256"]);
    expect(joined(sink.chunks)).toEqual(bytes); expect(sink.writeChunk).toHaveBeenCalledTimes(4);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(uri); expect(url).not.toContain(key); expect([...new URL(url).searchParams]).toEqual([["alt", "media"]]);
    expect(Object.keys(init).sort()).toEqual(["headers", "method", "redirect", "signal"]);
    expect(init).toMatchObject({ method: "GET", redirect: "manual" });
    expect(init.headers).toEqual({ "x-goog-api-key": key, Accept: "video/mp4", "Accept-Encoding": "identity" });
    expect(JSON.stringify(init.headers)).not.toMatch(/range/i); expect(Object.hasOwn(init, "body")).toBe(false);
    expect(init.signal!.aborted).toBe(true); expect(body.locked).toBe(false);
  });
  it("accepts an absent Content-Length, MIME case/parameters and explicit identity encoding", async () => {
    for (const headers of [{}, { "content-type": "Video/MP4; codecs=avc1" }, { "content-encoding": "identity" }, { "content-encoding": " IDENTITY " }]) {
      expect(await run(async () => media(stream(), headers))).toEqual({ byteCount: bytes.length, sha256, mimeType: "video/mp4" });
    }
  });

  it.each([
    ["uri with extra query", { ...metadata, resource: { ...metadata.resource, downloadUri: uri + "&key=SECRET" } }, "DOWNLOAD_URI_INVALID"],
    ["foreign host", { ...metadata, resource: { ...metadata.resource, downloadUri: uri.replace("generativelanguage", "evil") } }, "DOWNLOAD_URI_INVALID"],
    ["fileId mismatch", { ...metadata, resource: { ...metadata.resource, fileId: "other" } }, "DOWNLOAD_URI_INVALID"],
    ["name mismatch", { ...metadata, resource: { ...metadata.resource, name: "files/other" } }, "DOWNLOAD_URI_INVALID"],
    ["missing resource", { ...metadata, resource: null }, "DOWNLOAD_URI_INVALID"],
    ["null metadata", null, "DOWNLOAD_URI_INVALID"],
    ["mime", { ...metadata, mimeType: "video/webm" }, "DOWNLOAD_CONTENT_TYPE_INVALID"],
    ...[0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1, "1000"].map((byteCount) => [`byteCount ${String(byteCount)}`, { ...metadata, byteCount }, "SECURE_TRANSPORT_CONFIGURATION_INVALID"] as const),
    ...[sha256.toUpperCase(), sha256.slice(1), sha256 + "0", "g".repeat(64), undefined].map((hash, index) => [`sha256 #${index}`, { ...metadata, sha256: hash }, "SECURE_TRANSPORT_CONFIGURATION_INVALID"] as const),
    ...[NaN, 1.5, Infinity, "1"].map((expirationTimeMs) => [`expiry ${String(expirationTimeMs)}`, { ...metadata, expirationTimeMs }, "FILE_EXPIRATION_INVALID"] as const),
    ["expiry string", { ...metadata, expirationTime: undefined }, "FILE_EXPIRATION_INVALID"],
  ] as const)("revalidates metadata (%s) before credentials or fetch", async (_label, value, code) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(); const readKey = vi.fn(() => key);
    const error = (await capture(downloadGoogleGenAiFile(value as GoogleGenAiVerifiedFileMetadata, collector(), context(), { get apiKey() { return readKey(); }, policy, nowMs: () => now, fetchImpl }))).error;
    expect(error).toMatchObject({ code, retryable: false }); expectSanitized(error);
    expect(fetchImpl).not.toHaveBeenCalled(); expect(readKey).not.toHaveBeenCalled();
  });
  it("rejects metadata byteCount above the output cap before fetch", async () => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>();
    await expect(run(fetchImpl, { policy: withPolicy({ limits: { maxOutputBytes: bytes.length - 1 } }) })).rejects.toMatchObject({ code: "DOWNLOAD_TOO_LARGE" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    { limits: { maxOutputBytes: 0 } }, { limits: { maxOutputBytes: 1.5 } }, { limits: { maxOutputBytes: NaN } },
    { timeouts: { filesDownloadTimeoutMs: 0 } }, { timeouts: { filesDownloadTimeoutMs: Infinity } }, { recovery: { filesMinRemainingLifetimeMs: -1 } },
  ])("rejects malformed policy %j before fetch", async (patch) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(); await expect(run(fetchImpl, { policy: withPolicy(patch) })).rejects.toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects a malformed sink before fetch", async () => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>();
    await expect(run(fetchImpl, { sink: {} as GoogleGenAiOutputChunkSink })).rejects.toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID" }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(["", " ", "bad key", "bad\nkey", "π", "\u007f"])("rejects malformed key %j before fetch", async (apiKey) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(); await expect(run(fetchImpl, { apiKey })).rejects.toMatchObject({ code: "CREDENTIALS_INVALID" }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity, -Infinity, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER + 1, "1200000"])("refuses malformed budget %s before fetch", async (remaining) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(); await expect(run(fetchImpl, { remainingMs: () => remaining as number })).rejects.toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID" }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("refuses a throwing budget before fetch", async () => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(); await expect(run(fetchImpl, { remainingMs: () => { throw new Error(key); } })).rejects.toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID" }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([-1, 0, 30000, 599999.5])("refuses insufficient budget %s with zero fetch", async (remaining) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(); await expect(run(fetchImpl, { remaining })).rejects.toMatchObject({ code: "RECOVERY_BUDGET_EXHAUSTED", retryable: false }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([600000, 600000.5])("admits exactly sufficient budget %s", async (remaining) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => media()); expect((await run(fetchImpl, { remaining })).byteCount).toBe(bytes.length); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([() => NaN, () => Infinity, () => Number.MAX_SAFE_INTEGER + 1, () => { throw new Error(key); }])("rejects malformed wall clock %# before fetch", async (nowMs) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(); await expect(run(fetchImpl, { nowMs })).rejects.toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID" }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([() => NaN, () => { throw new Error(key); }])("rejects malformed monotonic clock %# before fetch", async (monotonicNowMs) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(); await expect(run(fetchImpl, { monotonicNowMs })).rejects.toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID" }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("accepts exactly the minimum remaining lifetime and rejects one millisecond less before fetch", async () => {
    expect((await run(async () => media(), { nowMs: () => metadata.expirationTimeMs - 3600000 })).byteCount).toBe(bytes.length);
    const fetchImpl = vi.fn<GoogleGenAiFetch>();
    for (const offset of [3599999, 0, -1]) await expect(run(fetchImpl, { nowMs: () => metadata.expirationTimeMs - offset })).rejects.toMatchObject({ code: "FILE_EXPIRATION_TOO_CLOSE" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("refuses an already aborted parent with safe classification and zero fetch", async () => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>();
    const timeout = new AbortController(); timeout.abort(new GoogleGenAiSecureOutputTransportError("RECONCILIATION_TIMEOUT"));
    await expect(run(fetchImpl, { signal: timeout.signal })).rejects.toMatchObject({ code: "RECONCILIATION_TIMEOUT" });
    const aborted = new AbortController(); aborted.abort(new Error(key));
    await expect(run(fetchImpl, { signal: aborted.signal })).rejects.toMatchObject({ code: "OPERATION_ABORTED", retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([301, 302, 303, 307, 308])("rejects redirect %s without following it and releases the body", async (status) => {
    const cancel = vi.fn(); const body = new ReadableStream<Uint8Array>({ cancel }); const sink = collector();
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => new Response(body, { status, headers: { location: "https://evil.test/" + key } }));
    const { error } = await capture(run(fetchImpl, { sink }));
    expect(error).toMatchObject({ code: "DOWNLOAD_REDIRECT_REJECTED", httpStatus: status, retryable: false }); expectSanitized(error);
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false); expect(sink.writeChunk).not.toHaveBeenCalled();
  });
  it.each([
    [400, false], [401, false], [403, false], [404, false], [201, false], [206, false], [429, true], [500, true], [503, true],
  ] as const)("rejects HTTP %s once with retryability %s left to the caller", async (status, retryable) => {
    const cancel = vi.fn(); const body = new ReadableStream<Uint8Array>({ cancel });
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => new Response(body, { status, headers: { "content-type": "video/mp4" } }));
    await expect(run(fetchImpl)).rejects.toMatchObject({ code: "DOWNLOAD_HTTP_FAILED", httpStatus: status, retryable });
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false);
  });
  it("rejects a missing body as a non-retryable semantic failure", async () => {
    await expect(run(async () => media(null))).rejects.toMatchObject({ code: "DOWNLOAD_HTTP_FAILED", retryable: false });
  });
  it.each(["text/html", "", "video/mp4x", "application/octet-stream", "video/webm"])("rejects Content-Type %j before reading", async (contentType) => {
    const body = stream(); const reads = observedReads(body);
    await expect(run(async () => media(body, { "content-type": contentType }))).rejects.toMatchObject({ code: "DOWNLOAD_CONTENT_TYPE_INVALID", retryable: false });
    expect(reads).not.toHaveBeenCalled(); expect(body.locked).toBe(false);
  });
  it("rejects a missing Content-Type", async () => {
    await expect(run(async () => new Response(stream()))).rejects.toMatchObject({ code: "DOWNLOAD_CONTENT_TYPE_INVALID" });
  });
  it.each(["gzip", "br", "deflate", "identity, gzip", "x-custom"])("rejects Content-Encoding %j before reading the body", async (encoding) => {
    const body = stream(); const reads = observedReads(body); const sink = collector();
    await expect(run(async () => media(body, { "content-encoding": encoding }), { sink })).rejects.toMatchObject({ code: "DOWNLOAD_HTTP_FAILED", httpStatus: 200, retryable: false });
    expect(reads).not.toHaveBeenCalled(); expect(sink.writeChunk).not.toHaveBeenCalled(); expect(body.locked).toBe(false);
  });
  it.each(["-1", "+1000", "1000.0", "1e3", "1000, 1000", "01000", "garbage", "0x3e8", "1000 1000"])("rejects malformed Content-Length %j", async (length) => {
    const response = media(); response.headers.set("content-length", length);
    await expect(run(async () => response)).rejects.toMatchObject({ code: "DOWNLOAD_CONTENT_LENGTH_INVALID", retryable: false });
  });
  it("rejects advertised excess over the cap using exact integer comparison before reading", async () => {
    const body = stream(); const reads = observedReads(body);
    await expect(run(async () => media(body, { "content-length": "999999999999999999999999999" }))).rejects.toMatchObject({ code: "DOWNLOAD_TOO_LARGE" });
    await expect(run(async () => media(stream(), { "content-length": String(policy.limits.maxOutputBytes + 1) }))).rejects.toMatchObject({ code: "DOWNLOAD_TOO_LARGE" });
    expect(reads).not.toHaveBeenCalled();
  });
  it.each(["999", "1001", "0"])("rejects advertised length %s that differs from verified metadata", async (length) => {
    await expect(run(async () => media(stream(), { "content-length": length }))).rejects.toMatchObject({ code: "DOWNLOAD_SIZE_MISMATCH", retryable: false });
  });

  it("rejects a short body at EOF after writing only received bytes", async () => {
    const sink = collector();
    await expect(run(async () => media(stream(split(bytes.slice(0, 999)))), { sink })).rejects.toMatchObject({ code: "DOWNLOAD_SIZE_MISMATCH" });
    expect(joined(sink.chunks)).toEqual(bytes.slice(0, 999));
  });
  it("rejects an empty body", async () => {
    await expect(run(async () => media(stream([])))).rejects.toMatchObject({ code: "DOWNLOAD_SIZE_MISMATCH" });
  });
  it("rejects actual excess over metadata without writing the overflow chunk and cancels the body", async () => {
    const cancel = vi.fn(); const extra = Uint8Array.from([...bytes, 1]); const sink = collector();
    // Left open so the provider stream is still live when the overflow is detected.
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(extra.slice(0, 600)); c.enqueue(extra.slice(600)); }, cancel });
    await expect(run(async () => media(body), { sink })).rejects.toMatchObject({ code: "DOWNLOAD_SIZE_MISMATCH" });
    expect(sink.chunks).toEqual([extra.slice(0, 600)]); expect(cancel).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false);
  });
  it("rejects actual excess over the cap even with a small advertised length, before the sink sees it", async () => {
    const sink = collector(); const small = withPolicy({ limits: { maxOutputBytes: bytes.length } });
    await expect(run(async () => media(stream([bytes.slice(0, 10), Uint8Array.from([...bytes.slice(10), 9, 9])])), { sink, policy: small })).rejects.toMatchObject({ code: "DOWNLOAD_TOO_LARGE" });
    expect(sink.chunks).toEqual([bytes.slice(0, 10)]);
  });
  it("accepts a body at exactly the output cap", async () => {
    const exact = withPolicy({ limits: { maxOutputBytes: bytes.length } });
    expect((await run(async () => media(), { policy: exact })).byteCount).toBe(bytes.length);
  });
  it("handles one-byte chunks, skips empty chunks and never calls whole-body convenience APIs", async () => {
    const chunks = [new Uint8Array(0), ...split(bytes, 1), new Uint8Array(0)]; const sink = collector();
    const response = media(stream(chunks));
    const spies = (["text", "json", "arrayBuffer", "blob", "bytes"] as const).filter((name) => typeof response[name] === "function").map((name) => vi.spyOn(response, name));
    expect((await run(async () => response, { sink })).sha256).toBe(sha256);
    expect(sink.writeChunk).toHaveBeenCalledTimes(bytes.length); expect(sink.chunks.every((chunk) => chunk.length === 1)).toBe(true);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
  it("rejects a non-byte chunk as a non-retryable failure", async () => {
    await expect(run(async () => media(stream(["text" as unknown as Uint8Array])))).rejects.toMatchObject({ code: "DOWNLOAD_HTTP_FAILED", retryable: false });
  });
  it("rejects a hash mismatch without exposing either digest", async () => {
    const other = Uint8Array.from(bytes); other[500] = bytes[500]! ^ 1;
    const { error } = await capture(run(async () => media(stream(split(other)))));
    expect(error).toMatchObject({ code: "DOWNLOAD_HASH_MISMATCH", retryable: false }); expectSanitized(error);
    expect(leakText(error)).not.toContain(digest(other));
  });

  it("awaits each sink write before the next provider read, with at most one write in flight", async () => {
    const body = stream(); const reads = observedReads(body);
    let inFlight = 0, maxInFlight = 0; const releases: Array<() => void> = [];
    const sink: GoogleGenAiOutputChunkSink = { writeChunk: vi.fn(() => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); return new Promise<void>((resolve) => { releases.push(() => { inFlight--; resolve(); }); }); }) };
    const outcome = capture(run(async () => media(body), { sink }));
    for (let index = 0; index < 4; index++) {
      await vi.advanceTimersByTimeAsync(0);
      expect(reads).toHaveBeenCalledTimes(index + 1); expect(sink.writeChunk).toHaveBeenCalledTimes(index + 1); expect(inFlight).toBe(1);
      await vi.advanceTimersByTimeAsync(0); expect(reads).toHaveBeenCalledTimes(index + 1);
      releases[index]!();
    }
    expect((await outcome).result).toEqual({ byteCount: bytes.length, sha256, mimeType: "video/mp4" }); expect(maxInFlight).toBe(1); expect(reads).toHaveBeenCalledTimes(5);
  });
  it.each(["async", "sync"])("maps a %s sink failure to TEMP_WRITE_FAILED and never reads another chunk", async (mode) => {
    const cancel = vi.fn(); const body = stream(split(bytes), cancel); const reads = observedReads(body);
    const failure = new Error(`${key} ${uri} ${sha256} SECRET disk path`);
    const sink: GoogleGenAiOutputChunkSink = { writeChunk: vi.fn(mode === "sync" ? () => { throw failure; } : async () => { throw failure; }) };
    const { error } = await capture(run(async () => media(body), { sink }));
    expect(error).toMatchObject({ code: "TEMP_WRITE_FAILED", retryable: false }); expectSanitized(error); expect(leakText(error)).not.toContain("disk path");
    expect(sink.writeChunk).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false);
  });
  it("preserves an already-sanitized transport error from the sink", async () => {
    const sink: GoogleGenAiOutputChunkSink = { writeChunk: async () => { throw new GoogleGenAiSecureOutputTransportError("OUTPUT_PUBLICATION_FAILED"); } };
    await expect(run(async () => media(), { sink })).rejects.toMatchObject({ code: "OUTPUT_PUBLICATION_FAILED" });
  });
  it.each(["fetch", "read"])("sanitizes a %s failure as retryable without internal retry", async (stage) => {
    const body = new ReadableStream<Uint8Array>({ start(c) { c.error(new Error(key + uri)); } });
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => { if (stage === "fetch") throw new Error(key + uri); return media(body); });
    const { error } = await capture(run(fetchImpl));
    expect(error).toMatchObject({ code: "DOWNLOAD_HTTP_FAILED", httpStatus: undefined, retryable: true }); expectSanitized(error);
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false);
  });

  it.each(["headers", "body"])("one 600000-ms timer bounds stalled %s with no retry, sleep or idle timer", async (stage) => {
    const cancel = vi.fn(); const body = new ReadableStream<Uint8Array>({ cancel });
    const fetchImpl = vi.fn<GoogleGenAiFetch>((_url, init) => stage === "body" ? Promise.resolve(media(body)) : new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error(key)), { once: true })));
    const outcome = capture(run(fetchImpl)); await vi.advanceTimersByTimeAsync(599999); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1); const { error } = await outcome;
    expect(error).toMatchObject({ code: "DOWNLOAD_TIMEOUT", retryable: true }); expectSanitized(error);
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false); if (stage === "body") expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("the body receives only the remainder of the same deadline", async () => {
    let deliver!: (r: Response) => void; const fetchImpl = vi.fn<GoogleGenAiFetch>(() => new Promise((resolve) => { deliver = resolve; }));
    const outcome = capture(run(fetchImpl)); await vi.advanceTimersByTimeAsync(400000);
    deliver(media(new ReadableStream())); await vi.advanceTimersByTimeAsync(200000);
    expect((await outcome).error).toMatchObject({ code: "DOWNLOAD_TIMEOUT" }); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("waits for a pending sink write to settle after the timeout before returning", async () => {
    let release!: () => void; const body = stream(); const reads = observedReads(body);
    const sink: GoogleGenAiOutputChunkSink = { writeChunk: vi.fn(() => new Promise<void>((resolve) => { release = resolve; })) };
    const outcome = capture(run(async () => media(body), { sink })); let settled = false; void outcome.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(600000); expect(settled).toBe(false); expect(sink.writeChunk).toHaveBeenCalledTimes(1);
    release(); expect((await outcome).error).toMatchObject({ code: "DOWNLOAD_TIMEOUT" });
    expect(sink.writeChunk).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false);
  });
  it("enforces the monotonic deadline even when synchronous work starves the timer", async () => {
    let elapsed = 0; const sink: GoogleGenAiOutputChunkSink = { writeChunk: async () => { elapsed = 600000; } };
    await expect(run(async () => media(), { sink, monotonicNowMs: () => elapsed })).rejects.toMatchObject({ code: "DOWNLOAD_TIMEOUT" });
  });
  it.each(["headers", "body", "sink"])("propagates parent cancellation during %s with listener cleanup", async (stage) => {
    const parent = new AbortController(); const add = vi.spyOn(parent.signal, "addEventListener"), remove = vi.spyOn(parent.signal, "removeEventListener");
    let release!: () => void; const body = stage === "sink" ? stream() : new ReadableStream<Uint8Array>();
    const sink: GoogleGenAiOutputChunkSink = { writeChunk: vi.fn(() => new Promise<void>((resolve) => { release = resolve; })) };
    const fetchImpl = vi.fn<GoogleGenAiFetch>((_url, init) => stage === "headers" ? new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error(key)), { once: true })) : Promise.resolve(media(body)));
    const outcome = capture(run(fetchImpl, { signal: parent.signal, sink })); await vi.advanceTimersByTimeAsync(0); parent.abort(new Error(key));
    if (stage === "sink") { await vi.advanceTimersByTimeAsync(0); release(); }
    const { error } = await outcome;
    expect(error).toMatchObject({ code: "OPERATION_ABORTED", retryable: false }); expectSanitized(error);
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false); expect(add).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
    if (stage === "sink") expect(sink.writeChunk).toHaveBeenCalledTimes(1);
  });
  it("preserves parent reconciliation timeout mid-stream and the first abort reason wins", async () => {
    const parent = new AbortController();
    const outcome = capture(run(async () => media(new ReadableStream()), { signal: parent.signal })); await vi.advanceTimersByTimeAsync(0);
    parent.abort(new GoogleGenAiSecureOutputTransportError("RECONCILIATION_TIMEOUT"));
    expect((await outcome).error).toMatchObject({ code: "RECONCILIATION_TIMEOUT" });
    const late = new AbortController(); let release!: () => void;
    const sink: GoogleGenAiOutputChunkSink = { writeChunk: () => new Promise<void>((resolve) => { release = resolve; }) };
    const second = capture(run(async () => media(), { signal: late.signal, sink })); await vi.advanceTimersByTimeAsync(600000);
    late.abort(new Error(key)); release();
    expect((await second).error).toMatchObject({ code: "DOWNLOAD_TIMEOUT" });
  });
  it("awaits body cancellation before releasing the reader lock", async () => {
    let finish!: () => void; const cancel = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const outcome = capture(run(async () => media(body, { "content-length": "1" }))); let settled = false; void outcome.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0); expect(cancel).toHaveBeenCalledTimes(1); expect(settled).toBe(false); expect(body.locked).toBe(true);
    finish(); expect((await outcome).error).toMatchObject({ code: "DOWNLOAD_SIZE_MISMATCH" }); expect(body.locked).toBe(false);
  });
  it("removes the timer and parent listener on success", async () => {
    const parent = new AbortController(); const remove = vi.spyOn(parent.signal, "removeEventListener");
    const result = await run(async () => media(), { signal: parent.signal });
    expect(remove).toHaveBeenCalledTimes(1); expect(JSON.stringify(result)).not.toContain(key); expect(vi.getTimerCount()).toBe(0);
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

describe("B4V8C downloader closed dependency-error boundary (fetch seam and sink seam)", () => {
  beforeEach(() => { b4v8cGetterReads.count = 0; });
  type Seam = "fetch" | "sink";
  /** Injects the dependency failure at the chosen seam; the other side behaves normally. */
  function runWithFailure(seam: Seam, make: () => unknown) {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => { if (seam === "fetch") throw make(); return media(); });
    const writeChunk = vi.fn(async () => { throw make(); });
    const sink: GoogleGenAiOutputChunkSink = seam === "sink" ? { writeChunk } : collector();
    return { fetchImpl, writeChunk, outcome: capture(run(fetchImpl, { sink })) };
  }
  const SEAMS: readonly Seam[] = ["fetch", "sink"];

  for (const seam of SEAMS) {
    it.each(B4V8C_MALFORMED)(`fails a %s transport-looking ${seam} error closed as nonretryable CONFIG`, async (_label, make) => {
      let raw: unknown;
      const { fetchImpl, outcome } = runWithFailure(seam, () => (raw = make()));
      const { error } = await outcome;
      expect(error).toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID", retryable: false });
      b4v8cExpectSanitized(error, raw);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it.each(B4V8C_ACCESSOR_FIELDS)(`never executes an accessor-backed %s getter from the ${seam} seam`, async (field) => {
      let raw: unknown;
      const { outcome } = runWithFailure(seam, () => (raw = b4v8cAccessorBacked(field)));
      const { error } = await outcome;
      expect(b4v8cGetterReads.count).toBe(0);
      expect(error).toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID", retryable: false });
      b4v8cExpectSanitized(error, raw);
    });

    it(`reconstructs a hostile genuine frozen base error from the ${seam} seam freshly`, async () => {
      const raw = b4v8cHostileBase("DOWNLOAD_HASH_MISMATCH");
      const { outcome } = runWithFailure(seam, () => raw);
      const { error } = await outcome;
      expect(error).toMatchObject({ code: "DOWNLOAD_HASH_MISMATCH", retryable: false });
      b4v8cExpectSanitized(error, raw);
    });

    it(`normalizes a genuine subclass from the ${seam} seam to a fresh base error`, async () => {
      class GenuineSubclass extends GoogleGenAiSecureOutputTransportError {}
      const raw = new GenuineSubclass("DOWNLOAD_HTTP_FAILED", { httpStatus: 404 });
      const { outcome } = runWithFailure(seam, () => raw);
      const { error } = await outcome;
      expect(error).toMatchObject({ code: "DOWNLOAD_HTTP_FAILED", httpStatus: 404, retryable: false });
      b4v8cExpectSanitized(error, raw);
    });
  }

  it("keeps legitimate retry semantics of a genuine transient fetch failure (fresh, no internal retry)", async () => {
    const raw = b4v8cHostileBase("DOWNLOAD_HTTP_FAILED", { httpStatus: 503 });
    const { fetchImpl, outcome } = runWithFailure("fetch", () => raw);
    const { error } = await outcome;
    expect(error).toMatchObject({ code: "DOWNLOAD_HTTP_FAILED", httpStatus: 503, retryable: true });
    b4v8cExpectSanitized(error, raw);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["fetch", "DOWNLOAD_HTTP_FAILED", true],
    ["sink", "TEMP_WRITE_FAILED", false],
  ] as const)("keeps the frozen %s fallback for an ordinary error, discarding its cause and custom data", async (seam, code, retryable) => {
    let raw: unknown;
    const { writeChunk, outcome } = runWithFailure(seam, () => (raw = b4v8cOrdinary()));
    const { error } = await outcome;
    expect(error).toMatchObject({ code, retryable });
    b4v8cExpectSanitized(error, raw);
    if (seam === "sink") expect(writeChunk).toHaveBeenCalledTimes(1);
  });

  it("stops reading after a sink failure and still releases the reader (backpressure preserved)", async () => {
    const body = stream();
    const reads = vi.fn(); const original = body.getReader.bind(body);
    vi.spyOn(body, "getReader").mockImplementation((() => {
      const live = original(), read = live.read.bind(live);
      vi.spyOn(live, "read").mockImplementation(() => { reads(); return read(); });
      return live;
    }) as typeof body.getReader);
    const raw = b4v8cHostileBase("TEMP_WRITE_FAILED");
    const { error } = await capture(run(async () => media(body), { sink: { writeChunk: async () => { throw raw; } } }));
    expect(error).toMatchObject({ code: "TEMP_WRITE_FAILED" });
    b4v8cExpectSanitized(error, raw);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
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
