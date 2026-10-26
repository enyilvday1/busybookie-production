import type { GoogleGenAiFetch, GoogleGenAiRecoveryContext, GoogleGenAiSecureOutputTransportPolicy, GoogleGenAiVerifiedFileMetadata } from "./googleGenAiSecureOutputTransport.types.js";
import { GoogleGenAiSecureOutputTransportError } from "./googleGenAiSecureOutputTransportError.js";
import { validateGoogleGenAiFilesDownloadUri } from "./validateGoogleGenAiFilesDownloadUri.js";
import { rejectDuplicateGoogleGenAiJsonKeys } from "./parseGoogleGenAiInteractionSse.js";

function invalid(): never { throw new GoogleGenAiSecureOutputTransportError("FILES_METADATA_INVALID"); }
function configuration(): never { throw new GoogleGenAiSecureOutputTransportError("SECURE_TRANSPORT_CONFIGURATION_INVALID"); }
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

function expiration(value: unknown): number {
  const fail = (): never => { throw new GoogleGenAiSecureOutputTransportError("FILE_EXPIRATION_INVALID"); };
  if (typeof value !== "string") return fail();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(value);
  if (!match || match[0] !== value) return fail();
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const ms = Number((match[7] ?? "").padEnd(3, "0").slice(0, 3));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, ms);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return fail();
  return date.getTime();
}

function providerHash(value: unknown): string {
  const fail = (): never => { throw new GoogleGenAiSecureOutputTransportError("FILE_HASH_FORMAT_UNSUPPORTED"); };
  if (typeof value !== "string" || value.length !== 88 || !/^[A-Za-z0-9+/]{86}==$/.test(value)) return fail();
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== value) return fail();
  const hex = decoded.toString("latin1");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return fail();
  return hex.toLowerCase();
}

/** One bounded metadata operation; endpoint identity comes only from the replay URI. */
export async function getGoogleGenAiFilesMetadata(
  request: Readonly<{ uri: string; maxOutputBytes: number }>,
  context: GoogleGenAiRecoveryContext,
  dependencies: Readonly<{ apiKey: string; policy: GoogleGenAiSecureOutputTransportPolicy; nowMs: () => number; fetchImpl?: GoogleGenAiFetch }>,
): Promise<GoogleGenAiVerifiedFileMetadata> {
  const resource = validateGoogleGenAiFilesDownloadUri(request.uri);
  const cap = dependencies.policy.limits.filesMetadataMaxResponseBytes;
  const timeoutMs = dependencies.policy.timeouts.filesMetadataTimeoutMs;
  const policyMax = dependencies.policy.limits.maxOutputBytes;
  const minimumLifetime = dependencies.policy.recovery.filesMinRemainingLifetimeMs;
  if ([cap, timeoutMs, policyMax, minimumLifetime, request.maxOutputBytes].some((n) => !Number.isSafeInteger(n) || n <= 0)) configuration();
  const maxOutputBytes = Math.min(request.maxOutputBytes, policyMax);
  const key = typeof dependencies.apiKey === "string" ? dependencies.apiKey.trim() : "";
  if (!key || !/^[\x21-\x7e]+$/.test(key)) throw new GoogleGenAiSecureOutputTransportError("CREDENTIALS_INVALID");
  const pathname = `/v1beta/files/${resource.fileId}`;
  const url = new URL(`https://generativelanguage.googleapis.com${pathname}`);
  if (url.protocol !== "https:" || url.hostname !== "generativelanguage.googleapis.com" || url.host !== "generativelanguage.googleapis.com"
    || url.port || url.username || url.password || url.hash || url.pathname !== pathname || url.search
    || url.href !== `https://generativelanguage.googleapis.com${pathname}`) configuration();
  if (context.signal.aborted) throw parentFailure(context);
  let remaining: number;
  try { remaining = context.remainingMs(); } catch { return configuration(); }
  if (typeof remaining !== "number" || !Number.isFinite(remaining) || Math.abs(remaining) > Number.MAX_SAFE_INTEGER) configuration();
  if (remaining < timeoutMs) throw new GoogleGenAiSecureOutputTransportError("RECOVERY_BUDGET_EXHAUSTED");
  // Validate deterministic clock authority before any credential-bearing request.
  const now = (): number => {
    let value: number;
    try { value = dependencies.nowMs(); } catch { return configuration(); }
    if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) configuration();
    return value;
  };
  now();
  const controller = new AbortController();
  let reason: GoogleGenAiSecureOutputTransportError | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancellation: Promise<void> | undefined;
  let ended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = performance.now();
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
    // Also enforce the deadline after synchronous decoding/validation blocks the timer.
    if (!reason && performance.now() - started >= timeoutMs) abort(new GoogleGenAiSecureOutputTransportError("FILES_METADATA_TIMEOUT"));
    if (reason) throw reason;
  };
  try {
    context.signal.addEventListener("abort", onParentAbort, { once: true });
    checkActive();
    timer = setTimeout(() => abort(new GoogleGenAiSecureOutputTransportError("FILES_METADATA_TIMEOUT")), timeoutMs);
    const response = await (dependencies.fetchImpl ?? fetch)(url.href, {
      method: "GET", redirect: "manual", signal: controller.signal,
      headers: { "x-goog-api-key": key, Accept: "application/json" },
    });
    reader = response.body?.getReader();
    checkActive();
    if (response.status !== 200 || !reader) throw new GoogleGenAiSecureOutputTransportError("FILES_METADATA_HTTP_FAILED", { httpStatus: response.status });
    if (response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") invalid();
    const advertised = response.headers.get("content-length");
    if (advertised !== null) {
      if (/^(?:0|[1-9][0-9]*)$/.exec(advertised)?.[0] !== advertised) invalid();
      if (BigInt(advertised) > BigInt(cap)) throw new GoogleGenAiSecureOutputTransportError("FILES_METADATA_RESPONSE_TOO_LARGE");
    }
    const bytes = new Uint8Array(cap);
    let length = 0;
    while (true) {
      const chunk = await reader.read();
      checkActive();
      if (chunk.done) { ended = true; break; }
      if (!(chunk.value instanceof Uint8Array)) invalid();
      if (chunk.value.byteLength > cap - length) throw new GoogleGenAiSecureOutputTransportError("FILES_METADATA_RESPONSE_TOO_LARGE");
      bytes.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
    let parsed: unknown;
    try {
      const json = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
      rejectDuplicateGoogleGenAiJsonKeys(json);
      parsed = JSON.parse(json);
    } catch { invalid(); }
    checkActive();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) invalid();
    const metadata = parsed as Record<string, unknown>;
    const own = (field: string): unknown => Object.hasOwn(metadata, field) ? metadata[field] : undefined;
    if (typeof own("name") !== "string") invalid();
    if (own("name") !== resource.name) throw new GoogleGenAiSecureOutputTransportError("FILE_IDENTITY_MISMATCH");
    const state = own("state");
    if (state !== undefined && typeof state !== "string") invalid();
    if (state !== "ACTIVE") throw new GoogleGenAiSecureOutputTransportError("FILE_NOT_ACTIVE");
    if (Object.hasOwn(metadata, "source") && own("source") !== "GENERATED") invalid();
    if (own("mimeType") !== "video/mp4") throw new GoogleGenAiSecureOutputTransportError("FILE_MIME_INVALID");
    const size = own("sizeBytes");
    let byteCount: number;
    if (typeof size === "string") {
      if (/^[1-9][0-9]*$/.exec(size)?.[0] !== size || BigInt(size) > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
      byteCount = Number(size);
    } else if (typeof size === "number") byteCount = size;
    else return invalid();
    if (!Number.isSafeInteger(byteCount) || byteCount <= 0) invalid();
    if (byteCount > maxOutputBytes) throw new GoogleGenAiSecureOutputTransportError("FILE_TOO_LARGE");
    const sha256 = providerHash(own("sha256Hash"));
    const expirationTimeMs = expiration(own("expirationTime"));
    if (expirationTimeMs - now() < minimumLifetime) throw new GoogleGenAiSecureOutputTransportError("FILE_EXPIRATION_TOO_CLOSE");
    checkActive();
    return Object.freeze({ resource, byteCount, sha256, mimeType: "video/mp4", expirationTime: own("expirationTime") as string, expirationTimeMs });
  } catch (error) {
    throw reason ?? (context.signal.aborted ? parentFailure(context)
      : normalizeDependencyFailure(error, () => new GoogleGenAiSecureOutputTransportError("FILES_METADATA_HTTP_FAILED")));
  } finally {
    clearTimeout(timer);
    context.signal.removeEventListener("abort", onParentAbort);
    controller.abort();
    if (!ended) cancelReader();
    await cancellation;
    reader?.releaseLock();
  }
}
