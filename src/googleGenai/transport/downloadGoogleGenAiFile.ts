import { createHash, timingSafeEqual } from "node:crypto";
import type { GoogleGenAiDownloadedFile, GoogleGenAiFetch, GoogleGenAiOutputChunkSink, GoogleGenAiRecoveryContext, GoogleGenAiSecureOutputTransportPolicy, GoogleGenAiVerifiedFileMetadata } from "./googleGenAiSecureOutputTransport.types.js";
import { GoogleGenAiSecureOutputTransportError } from "./googleGenAiSecureOutputTransportError.js";
import { validateGoogleGenAiFilesDownloadUri } from "./validateGoogleGenAiFilesDownloadUri.js";

export type GoogleGenAiFilesDownloadDependencies = Readonly<{
  apiKey: string; policy: GoogleGenAiSecureOutputTransportPolicy; nowMs: () => number;
  fetchImpl?: GoogleGenAiFetch; monotonicNowMs?: () => number;
}>;

function fail(code: GoogleGenAiSecureOutputTransportError["code"], httpStatus?: number): never {
  throw new GoogleGenAiSecureOutputTransportError(code, httpStatus === undefined ? {} : { httpStatus });
}
function configuration(): never { return fail("SECURE_TRANSPORT_CONFIGURATION_INVALID"); }
// Closed-error boundary: a dependency-owned error is never trusted by identity or instanceof
// alone. Semantic fields are read only as OWN DATA descriptors (no getter ever runs), and the
// trusted constructor must round-trip code/attempt/httpStatus/retryable exactly. Only the fresh
// reconstruction crosses; message/stack/cause/custom data never do. Malformed candidates fail
// closed as nonretryable configuration errors; ordinary errors keep the frozen stage fallback.
const CLOSED_ERROR_FIELDS = ["code", "attempt", "httpStatus", "retryable"] as const;
function ownDataField(error: object, field: typeof CLOSED_ERROR_FIELDS[number]): { value: unknown } | undefined {
  const descriptor = Reflect.getOwnPropertyDescriptor(error, field);
  return descriptor !== undefined && "value" in descriptor ? { value: descriptor.value } : undefined;
}
function normalizeDependencyFailure(error: unknown, ordinaryFallback: () => GoogleGenAiSecureOutputTransportError): GoogleGenAiSecureOutputTransportError {
  const invalid = () => new GoogleGenAiSecureOutputTransportError("SECURE_TRANSPORT_CONFIGURATION_INVALID");
  try {
    if (!(error instanceof GoogleGenAiSecureOutputTransportError)) return ordinaryFallback();
    const [code, attempt, httpStatus, retryable] = CLOSED_ERROR_FIELDS.map((field) => ownDataField(error, field));
    if (!code || !attempt || !httpStatus || !retryable || typeof code.value !== "string" || typeof retryable.value !== "boolean"
      || (attempt.value !== undefined && typeof attempt.value !== "number")
      || (httpStatus.value !== undefined && typeof httpStatus.value !== "number")) return invalid();
    const rebuilt = new GoogleGenAiSecureOutputTransportError(code.value as GoogleGenAiSecureOutputTransportError["code"], {
      ...(attempt.value === undefined ? {} : { attempt: attempt.value as number }),
      ...(httpStatus.value === undefined ? {} : { httpStatus: httpStatus.value as number }),
    });
    return rebuilt.code === code.value && Object.is(rebuilt.attempt, attempt.value) && Object.is(rebuilt.httpStatus, httpStatus.value)
      && rebuilt.retryable === retryable.value ? rebuilt : invalid();
  } catch {
    return invalid();
  }
}

function parentFailure(context: GoogleGenAiRecoveryContext): GoogleGenAiSecureOutputTransportError {
  // The parent reason is classified only through the same closed boundary (no getter executes).
  const reason = normalizeDependencyFailure(context.signal.reason, () => new GoogleGenAiSecureOutputTransportError("OPERATION_ABORTED"));
  return new GoogleGenAiSecureOutputTransportError(reason.code === "RECONCILIATION_TIMEOUT" ? "RECONCILIATION_TIMEOUT" : "OPERATION_ABORTED");
}
function sample(clock: () => number): number {
  let value: number;
  try { value = clock(); } catch { return configuration(); }
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) configuration();
  return value;
}

/** One bounded media download; bytes stream through the hash into the sink and are never retained. */
export async function downloadGoogleGenAiFile(
  metadata: GoogleGenAiVerifiedFileMetadata,
  sink: GoogleGenAiOutputChunkSink,
  context: GoogleGenAiRecoveryContext,
  dependencies: GoogleGenAiFilesDownloadDependencies,
): Promise<GoogleGenAiDownloadedFile> {
  // Revalidate caller evidence without trusting its object identity or types.
  if (metadata === null || typeof metadata !== "object" || metadata.resource === null || typeof metadata.resource !== "object") fail("DOWNLOAD_URI_INVALID");
  const resource = validateGoogleGenAiFilesDownloadUri(metadata.resource.downloadUri);
  if (metadata.resource.fileId !== resource.fileId || metadata.resource.name !== resource.name) fail("DOWNLOAD_URI_INVALID");
  if (metadata.mimeType !== "video/mp4") fail("DOWNLOAD_CONTENT_TYPE_INVALID");
  const byteCount = metadata.byteCount;
  if (typeof byteCount !== "number" || !Number.isSafeInteger(byteCount) || byteCount <= 0) configuration();
  if (typeof metadata.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(metadata.sha256)) configuration();
  const expected = Buffer.from(metadata.sha256, "hex");
  const expirationTimeMs = metadata.expirationTimeMs;
  if (typeof metadata.expirationTime !== "string" || typeof expirationTimeMs !== "number" || !Number.isSafeInteger(expirationTimeMs)) fail("FILE_EXPIRATION_INVALID");
  if (typeof sink !== "object" || sink === null || typeof sink.writeChunk !== "function") configuration();
  const cap = dependencies.policy.limits.maxOutputBytes;
  const timeoutMs = dependencies.policy.timeouts.filesDownloadTimeoutMs;
  const minimumLifetime = dependencies.policy.recovery.filesMinRemainingLifetimeMs;
  if ([cap, timeoutMs, minimumLifetime].some((n) => !Number.isSafeInteger(n) || n <= 0)) configuration();
  if (byteCount > cap) fail("DOWNLOAD_TOO_LARGE");
  const key = typeof dependencies.apiKey === "string" ? dependencies.apiKey.trim() : "";
  if (!key || !/^[\x21-\x7e]+$/.test(key)) fail("CREDENTIALS_INVALID");
  const pathname = `/v1beta/files/${resource.fileId}:download`;
  const url = new URL(`https://generativelanguage.googleapis.com${pathname}?alt=media`);
  const pairs = [...url.searchParams];
  if (url.protocol !== "https:" || url.hostname !== "generativelanguage.googleapis.com" || url.host !== "generativelanguage.googleapis.com"
    || url.port || url.username || url.password || url.hash || url.pathname !== pathname || url.search !== "?alt=media"
    || pairs.length !== 1 || pairs[0]?.[0] !== "alt" || pairs[0]?.[1] !== "media"
    || url.href !== resource.downloadUri || url.href !== `https://generativelanguage.googleapis.com${pathname}?alt=media`) configuration();
  if (context.signal.aborted) throw parentFailure(context);
  let remaining: number;
  try { remaining = context.remainingMs(); } catch { return configuration(); }
  if (typeof remaining !== "number" || !Number.isFinite(remaining) || Math.abs(remaining) > Number.MAX_SAFE_INTEGER) configuration();
  if (remaining < timeoutMs) fail("RECOVERY_BUDGET_EXHAUSTED");
  // Validate both clocks before any credential-bearing request.
  if (expirationTimeMs - sample(dependencies.nowMs) < minimumLifetime) fail("FILE_EXPIRATION_TOO_CLOSE");
  const monotonic = dependencies.monotonicNowMs ?? (() => performance.now());
  const started = sample(monotonic);
  const controller = new AbortController();
  let reason: GoogleGenAiSecureOutputTransportError | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancellation: Promise<void> | undefined;
  let ended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelReader = (): void => { if (reader && !cancellation) cancellation = reader.cancel().catch(() => {}); };
  const abort = (error: GoogleGenAiSecureOutputTransportError): void => {
    if (reason) return;
    reason = error;
    controller.abort(error);
    cancelReader();
  };
  const onParentAbort = (): void => abort(parentFailure(context));
  const checkActive = (): void => {
    if (!reason && context.signal.aborted) abort(parentFailure(context));
    // Also enforce the deadline after synchronous hashing or a slow sink blocks the timer.
    if (!reason && sample(monotonic) - started >= timeoutMs) abort(new GoogleGenAiSecureOutputTransportError("DOWNLOAD_TIMEOUT"));
    if (reason) throw reason;
  };
  try {
    context.signal.addEventListener("abort", onParentAbort, { once: true });
    checkActive();
    timer = setTimeout(() => abort(new GoogleGenAiSecureOutputTransportError("DOWNLOAD_TIMEOUT")), timeoutMs);
    const response = await (dependencies.fetchImpl ?? fetch)(url.href, {
      method: "GET", redirect: "manual", signal: controller.signal,
      headers: { "x-goog-api-key": key, Accept: "video/mp4", "Accept-Encoding": "identity" },
    });
    reader = response.body?.getReader();
    checkActive();
    if (response.status >= 300 && response.status <= 399) fail("DOWNLOAD_REDIRECT_REJECTED", response.status);
    if (response.status !== 200) fail("DOWNLOAD_HTTP_FAILED", response.status);
    // Status 200 keeps semantic response failures non-retryable.
    if (!reader) fail("DOWNLOAD_HTTP_FAILED", 200);
    if (response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "video/mp4") fail("DOWNLOAD_CONTENT_TYPE_INVALID");
    const encoding = response.headers.get("content-encoding");
    if (encoding !== null && encoding.trim().toLowerCase() !== "identity") fail("DOWNLOAD_HTTP_FAILED", 200);
    const advertised = response.headers.get("content-length");
    if (advertised !== null) {
      if (/^(?:0|[1-9][0-9]*)$/.exec(advertised)?.[0] !== advertised) fail("DOWNLOAD_CONTENT_LENGTH_INVALID");
      if (BigInt(advertised) > BigInt(cap)) fail("DOWNLOAD_TOO_LARGE");
      if (BigInt(advertised) !== BigInt(byteCount)) fail("DOWNLOAD_SIZE_MISMATCH");
    }
    const hash = createHash("sha256");
    let count = 0;
    while (true) {
      const chunk = await reader.read();
      checkActive();
      if (chunk.done) { ended = true; break; }
      if (!(chunk.value instanceof Uint8Array)) fail("DOWNLOAD_HTTP_FAILED", 200);
      if (chunk.value.byteLength === 0) continue;
      const next = count + chunk.value.byteLength;
      // Overflow chunks are rejected before they reach the hash or the sink.
      if (next > cap) fail("DOWNLOAD_TOO_LARGE");
      if (next > byteCount) fail("DOWNLOAD_SIZE_MISMATCH");
      hash.update(chunk.value);
      count = next;
      // Awaiting each write before the next read is the backpressure: one write in flight.
      try { await sink.writeChunk(chunk.value); } catch (error) {
        throw normalizeDependencyFailure(error, () => new GoogleGenAiSecureOutputTransportError("TEMP_WRITE_FAILED"));
      }
      checkActive();
    }
    if (count <= 0 || count !== byteCount || (advertised !== null && BigInt(count) !== BigInt(advertised))) fail("DOWNLOAD_SIZE_MISMATCH");
    const digest = hash.digest();
    if (digest.length !== expected.length || !timingSafeEqual(digest, expected)) fail("DOWNLOAD_HASH_MISMATCH");
    checkActive();
    return Object.freeze({ byteCount: count, sha256: digest.toString("hex"), mimeType: "video/mp4" });
  } catch (error) {
    throw reason ?? (context.signal.aborted ? parentFailure(context)
      : normalizeDependencyFailure(error, () => new GoogleGenAiSecureOutputTransportError("DOWNLOAD_HTTP_FAILED")));
  } finally {
    clearTimeout(timer);
    context.signal.removeEventListener("abort", onParentAbort);
    controller.abort();
    if (!ended) cancelReader();
    await cancellation;
    reader?.releaseLock();
  }
}
