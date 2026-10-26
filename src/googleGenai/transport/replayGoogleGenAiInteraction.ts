import type { GoogleGenAiFetch, GoogleGenAiInteractionReplayResult, GoogleGenAiRecoveryContext, GoogleGenAiSecureOutputTransportPolicy } from "./googleGenAiSecureOutputTransport.types.js";
import { GoogleGenAiSecureOutputTransportError } from "./googleGenAiSecureOutputTransportError.js";
import { createGoogleGenAiInteractionSseParser } from "./parseGoogleGenAiInteractionSse.js";

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

function requireBudget(context: GoogleGenAiRecoveryContext, required: number): void {
  if (context.signal.aborted) throw parentFailure(context);
  let remaining: number;
  try { remaining = context.remainingMs(); } catch { throw new GoogleGenAiSecureOutputTransportError("SECURE_TRANSPORT_CONFIGURATION_INVALID"); }
  if (typeof remaining !== "number" || !Number.isFinite(remaining) || Math.abs(remaining) > Number.MAX_SAFE_INTEGER) {
    throw new GoogleGenAiSecureOutputTransportError("SECURE_TRANSPORT_CONFIGURATION_INVALID");
  }
  if (remaining < required) throw new GoogleGenAiSecureOutputTransportError("RECOVERY_BUDGET_EXHAUSTED");
}

async function waitForRetry(delay: number, context: GoogleGenAiRecoveryContext): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      onAbort = () => { reject(parentFailure(context)); };
      context.signal.addEventListener("abort", onAbort, { once: true });
      if (context.signal.aborted) { onAbort(); return; }
      timer = setTimeout(resolve, delay);
    });
  } finally {
    clearTimeout(timer);
    context.signal.removeEventListener("abort", onAbort);
  }
}

/** One invocation is one logical replay. HTTP retries never change its durable identity. */
export async function replayGoogleGenAiInteraction(
  providerExecutionId: string,
  context: GoogleGenAiRecoveryContext,
  dependencies: Readonly<{ apiKey: string; policy: GoogleGenAiSecureOutputTransportPolicy; fetchImpl?: GoogleGenAiFetch }>,
): Promise<GoogleGenAiInteractionReplayResult> {
  if (typeof providerExecutionId !== "string" || !/^[A-Za-z0-9_-]+$/.test(providerExecutionId)) {
    throw new GoogleGenAiSecureOutputTransportError("INTERACTION_REPLAY_CONTRACT_CHANGED");
  }
  const key = typeof dependencies.apiKey === "string" ? dependencies.apiKey.trim() : "";
  if (!key || !/^[\x21-\x7e]+$/.test(key)) throw new GoogleGenAiSecureOutputTransportError("CREDENTIALS_INVALID");
  const encodedId = encodeURIComponent(providerExecutionId);
  const path = `/v1beta/interactions/${encodedId}`;
  const url = new URL(`https://generativelanguage.googleapis.com${path}?stream=true&include_input=false`);
  if (url.origin !== "https://generativelanguage.googleapis.com" || url.protocol !== "https:" || url.hostname !== "generativelanguage.googleapis.com"
    || url.port || url.username || url.password || url.hash || url.pathname !== path || url.search !== "?stream=true&include_input=false") {
    throw new GoogleGenAiSecureOutputTransportError("INTERACTION_REPLAY_CONTRACT_CHANGED");
  }
  // Snapshot only structural operational values; later caller mutation cannot change an in-flight replay.
  const limits = Object.freeze({
    sseMaxEventBytes: dependencies.policy.limits.sseMaxEventBytes,
    sseMaxEventsPerAttempt: dependencies.policy.limits.sseMaxEventsPerAttempt,
  });
  const maxResponse = dependencies.policy.limits.sseMaxResponseBytesPerAttempt;
  const headersMs = dependencies.policy.timeouts.streamConnectHeadersTimeoutMs;
  const idleMs = dependencies.policy.timeouts.streamIdleTimeoutMs;
  const attemptMs = dependencies.policy.timeouts.streamAttemptTimeoutMs;
  const attempts = dependencies.policy.recovery.maxStreamRecoveryAttemptsPerReconciliation;
  const delays = [dependencies.policy.recovery.streamRecoveryFirstRetryDelayMs, dependencies.policy.recovery.streamRecoverySecondRetryDelayMs];
  if ([...Object.values(limits), maxResponse, headersMs, idleMs, attemptMs, attempts, ...delays].some((n) => !Number.isSafeInteger(n) || n <= 0)
    || attempts > delays.length + 1
    || delays.some((delay) => delay > Number.MAX_SAFE_INTEGER - attemptMs)) {
    throw new GoogleGenAiSecureOutputTransportError("SECURE_TRANSPORT_CONFIGURATION_INVALID");
  }
  const fetchImpl = dependencies.fetchImpl ?? fetch;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    requireBudget(context, attemptMs);
    const controller = new AbortController();
    let reason: GoogleGenAiSecureOutputTransportError | undefined;
    let headersTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let totalTimer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let cancellation: Promise<void> | undefined;
    let ended = false;
    const cancelReader = (): void => {
      if (reader && !cancellation) cancellation = reader.cancel().catch(() => {});
    };
    const abort = (failure: GoogleGenAiSecureOutputTransportError): void => {
      if (reason) return;
      reason = failure;
      controller.abort(failure);
      cancelReader();
    };
    const onParentAbort = (): void => abort(parentFailure(context));
    const resetIdle = (): void => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => abort(new GoogleGenAiSecureOutputTransportError("SSE_IDLE_TIMEOUT", { attempt })), idleMs);
    };
    let failure: GoogleGenAiSecureOutputTransportError | undefined;
    try {
      context.signal.addEventListener("abort", onParentAbort, { once: true });
      if (context.signal.aborted) throw parentFailure(context);
      headersTimer = setTimeout(() => abort(new GoogleGenAiSecureOutputTransportError("SSE_HEADERS_TIMEOUT", { attempt })), headersMs);
      totalTimer = setTimeout(() => abort(new GoogleGenAiSecureOutputTransportError("SSE_ATTEMPT_TIMEOUT", { attempt })), attemptMs);
      const response = await fetchImpl(url.href, {
        method: "GET", redirect: "manual", signal: controller.signal,
        headers: { "x-goog-api-key": key, Accept: "text/event-stream" },
      });
      clearTimeout(headersTimer);
      reader = response.body?.getReader();
      if (reason) throw reason;
      if (response.status !== 200 || !reader || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "text/event-stream") {
        throw new GoogleGenAiSecureOutputTransportError("SSE_HTTP_FAILED", { attempt, httpStatus: response.status });
      }
      const parser = createGoogleGenAiInteractionSseParser({ providerExecutionId, limits });
      let responseBytes = 0;
      resetIdle();
      while (true) {
        const chunk = await reader.read();
        if (reason) throw reason;
        if (context.signal.aborted) throw parentFailure(context);
        if (chunk.done) { ended = true; return parser.finish(); }
        if (!(chunk.value instanceof Uint8Array)) throw new GoogleGenAiSecureOutputTransportError("SSE_MALFORMED_EVENT");
        if (chunk.value.byteLength > maxResponse - responseBytes) throw new GoogleGenAiSecureOutputTransportError("SSE_RESPONSE_TOO_LARGE", { attempt });
        responseBytes += chunk.value.byteLength;
        if (chunk.value.byteLength !== 0) resetIdle();
        const observed = parser.push(chunk.value);
        if (observed) return observed;
      }
    } catch (error) {
      // Normalized BEFORE retry classification: only the fresh error's retryable is read below.
      failure = reason ?? (context.signal.aborted ? parentFailure(context)
        : normalizeDependencyFailure(error, () => new GoogleGenAiSecureOutputTransportError("SSE_HTTP_FAILED", { attempt })));
    } finally {
      clearTimeout(headersTimer);
      clearTimeout(idleTimer);
      clearTimeout(totalTimer);
      context.signal.removeEventListener("abort", onParentAbort);
      controller.abort();
      if (!ended) cancelReader();
      await cancellation;
      reader?.releaseLock();
    }
    if (!failure) throw new GoogleGenAiSecureOutputTransportError("SECURE_TRANSPORT_CONFIGURATION_INVALID");
    if (!failure.retryable || attempt === attempts) throw failure;
    const delay = delays[attempt - 1]!;
    requireBudget(context, delay + attemptMs);
    await waitForRetry(delay, context);
  }
  throw new GoogleGenAiSecureOutputTransportError("SECURE_TRANSPORT_CONFIGURATION_INVALID");
}
