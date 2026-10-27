import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_GENAI_ACTIVATION_LIMITS as published } from "../src/googleGenai/googleGenAiActivationLimits.js";
import type { GoogleGenAiFetch, GoogleGenAiRecoveryContext, GoogleGenAiSecureOutputTransportPolicy as Policy } from "../src/googleGenai/transport/googleGenAiSecureOutputTransport.types.js";
import { GoogleGenAiSecureOutputTransportError } from "../src/googleGenai/transport/googleGenAiSecureOutputTransportError.js";
import { replayGoogleGenAiInteraction } from "../src/googleGenai/transport/replayGoogleGenAiInteraction.js";

const id = "interaction_test";
const key = "synthetic-replay-test-key";
const encoder = new TextEncoder();
type Event = { event_type: string; [key: string]: unknown };
const frame = (event: Event) => `event: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`;
const pending = (status = "in_progress") => frame({ event_type: "interaction.created", interaction: { id, status } });
const completed = pending() + [
  { event_type: "step.start", index: 0, step: { type: "model_output" } },
  { event_type: "step.delta", index: 0, delta: { type: "video", mime_type: "video/mp4", uri: "https://generativelanguage.googleapis.com/v1beta/files/test:download?alt=media" } },
  { event_type: "step.stop", index: 0 },
  { event_type: "interaction.completed", interaction: { id, status: "completed" } },
].map(frame).join("");
const done = "event: done\ndata: [DONE]\n\n";
function policy(overrides: { limits?: Partial<Policy["limits"]>; timeouts?: Partial<Policy["timeouts"]>; recovery?: Partial<Policy["recovery"]> } = {}): Policy {
  return { limits: { ...published.limits, ...overrides.limits }, timeouts: { ...published.timeouts, ...overrides.timeouts }, recovery: { ...published.recovery, ...overrides.recovery } };
}
function context() {
  const parent = new AbortController();
  const ctx: GoogleGenAiRecoveryContext = { signal: parent.signal, remainingMs: vi.fn(() => 9_000_000) };
  return { parent, ctx };
}
function body(text: string, status = 200, contentType = "text/event-stream") {
  return new Response(encoder.encode(text), { status, headers: { "content-type": contentType } });
}
function run(fetchImpl: GoogleGenAiFetch, p = policy(), c = context().ctx, sourceId = id, apiKey = key) {
  return replayGoogleGenAiInteraction(sourceId, c, { apiKey, policy: p, fetchImpl });
}
function capture<T>(promise: Promise<T>) {
  return promise.then((result) => ({ result, error: undefined }), (error: unknown) => ({ result: undefined, error }));
}
function waitingFetch(): GoogleGenAiFetch {
  return vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new Error(key)), { once: true });
  }));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real network is forbidden in these offline tests."));
});
afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("one bounded same-ID logical replay", () => {
  it("sends only the exact fixed GET/header/query contract and returns a frozen result", async () => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => body(completed));
    const result = await run(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/interactions/${id}?stream=true&include_input=false`);
    expect(init.method).toBe("GET"); expect(init.redirect).toBe("manual");
    expect(init.headers).toEqual({ "x-goog-api-key": key, Accept: "text/event-stream" });
    expect(Object.hasOwn(init, "body")).toBe(false);
    expect([...new URL(url).searchParams.keys()]).toEqual(["stream", "include_input"]);
    expect(url).not.toContain(key); expect(url).not.toContain("last_event_id");
    expect(result.status).toBe("completed"); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.outputVideo)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(key);
    expect(init.signal!.aborted).toBe(true);
  });

  it.each(["", " leading", "trailing ", "a/b", "a\\b", "a?key=x", "a#x", "a%2fb", "..", "π"])("rejects unsupported durable ID %j before fetch", async (sourceId) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>();
    await expect(run(fetchImpl, policy(), context().ctx, sourceId)).rejects.toMatchObject({ code: "INTERACTION_REPLAY_CONTRACT_CHANGED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "bad\nkey", "bad key", "π"])("rejects malformed explicit credential without exposing it", async (apiKey) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>();
    await expect(run(fetchImpl, policy(), context().ctx, id, apiKey)).rejects.toMatchObject({ code: "CREDENTIALS_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["queued", "in_progress", "failed", "cancelled", "incomplete", "budget_exceeded", "requires_action"])("does not retry a valid %s observation", async (status) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => body(pending(status)));
    expect(await run(fetchImpl)).toEqual({ id, status, outputVideo: null });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    frame({ event_type: "interaction.created", interaction: { id: "wrong", status: "in_progress" } }),
    pending("unknown-" + key),
    frame({ event_type: "error", error: { message: key } }),
    'event: interaction.created\ndata: {"event_type":"interaction.created","event_type":"interaction.created"}\n\n',
    "event: unknown\ndata: {\n\n",
  ])("never retries a contract/parser/provider failure %#", async (text) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => body(text));
    const { error } = await capture(run(fetchImpl));
    expect(error).toBeInstanceOf(GoogleGenAiSecureOutputTransportError);
    expect((error as GoogleGenAiSecureOutputTransportError).retryable).toBe(false);
    expect(String(error) + (error as Error).stack + JSON.stringify(error)).not.toContain(key);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([302, 307, 400, 401, 403, 404, 201])("rejects nonretryable HTTP %s, cancels and releases its reader", async (status) => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => new Response(stream, { status, headers: { "content-type": "text/event-stream" } }));
    await expect(run(fetchImpl)).rejects.toMatchObject({ code: "SSE_HTTP_FAILED", httpStatus: status, retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
  });

  it.each(["missing", "application/json", ""])("rejects %s body/content type before parsing", async (kind) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => kind === "missing" ? new Response(null, { headers: { "content-type": "text/event-stream" } }) : body(pending(), 200, kind));
    await expect(run(fetchImpl)).rejects.toMatchObject({ code: "SSE_HTTP_FAILED", retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([429, 500, 503])("retries HTTP %s once after precisely 5000 ms with same ID", async (status) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>().mockResolvedValueOnce(body("", status)).mockImplementation(async () => body(completed));
    const outcome = capture(run(fetchImpl));
    await vi.advanceTimersByTimeAsync(4999); expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect((await outcome).result?.status).toBe("completed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new Set(fetchImpl.mock.calls.map(([url]) => url)).size).toBe(1);
  });

  it("uses 5000/15000 retry waits, never a fourth attempt, and sanitizes raw fetch failures", async () => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => { throw new Error(key); });
    const outcome = capture(run(fetchImpl));
    await vi.advanceTimersByTimeAsync(4999); expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(14999); expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    const { error } = await outcome;
    expect(error).toMatchObject({ code: "SSE_HTTP_FAILED", attempt: 3 }); expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(String(error) + (error as Error).stack + JSON.stringify(error)).not.toContain(key);
    expect(Object.hasOwn(error as object, "cause")).toBe(false);
    for (const [url, init] of fetchImpl.mock.calls) { expect(url).toContain(`/interactions/${id}?`); expect(init.method).toBe("GET"); }
  });

  it("resets parser, counters and controller after a mid-body read failure", async () => {
    let reads = 0;
    const failed = new ReadableStream<Uint8Array>({ pull(controller) {
      if (reads++ === 0) controller.enqueue(encoder.encode(pending())); else controller.error(new Error(key));
    } });
    const fetchImpl = vi.fn<GoogleGenAiFetch>().mockResolvedValueOnce(new Response(failed, { headers: { "content-type": "text/event-stream" } })).mockImplementation(async () => body(pending()));
    const outcome = capture(run(fetchImpl, policy({ limits: { sseMaxResponseBytesPerAttempt: encoder.encode(pending()).length } })));
    await vi.advanceTimersByTimeAsync(5000);
    expect((await outcome).result?.status).toBe("in_progress"); expect(failed.locked).toBe(false);
    expect(fetchImpl.mock.calls[0]![1].signal).not.toBe(fetchImpl.mock.calls[1]![1].signal);
  });

  it("enforces total response bytes before parser and accepts the exact cap", async () => {
    expect(published.limits.sseMaxResponseBytesPerAttempt).toBe(16777216);
    const cap = encoder.encode(pending()).length;
    expect((await run(async () => body(pending()), policy({ limits: { sseMaxResponseBytesPerAttempt: cap } }))).status).toBe("in_progress");
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => body(pending() + "\n"));
    await expect(run(fetchImpl, policy({ limits: { sseMaxResponseBytesPerAttempt: cap } }))).rejects.toMatchObject({ code: "SSE_RESPONSE_TOO_LARGE" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(["bytes", "events"])("never retries a parser %s cap failure", async (kind) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => body(": comment\n\n" + pending()));
    const p = policy({ limits: kind === "bytes" ? { sseMaxEventBytes: 16 } : { sseMaxEventsPerAttempt: 1 } });
    await expect(run(fetchImpl, p)).rejects.toMatchObject({ code: kind === "bytes" ? "SSE_EVENT_TOO_LARGE" : "SSE_EVENT_LIMIT_EXCEEDED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("has an exact 30000-ms headers timeout and cleans every timer", async () => {
    const fetchImpl = waitingFetch();
    const outcome = capture(run(fetchImpl, policy({ recovery: { maxStreamRecoveryAttemptsPerReconciliation: 1 } })));
    await vi.advanceTimersByTimeAsync(29999); expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(1); expect((await outcome).error).toMatchObject({ code: "SSE_HEADERS_TIMEOUT" });
  });

  it("fresh headers timers begin only after the retry delay", async () => {
    const waiting = waitingFetch();
    const fetchImpl = vi.fn<GoogleGenAiFetch>().mockResolvedValueOnce(body("", 503)).mockImplementation(waiting);
    const outcome = capture(run(fetchImpl, policy({ recovery: { maxStreamRecoveryAttemptsPerReconciliation: 2 } })));
    await vi.advanceTimersByTimeAsync(5000); expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(29999); expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(1); expect((await outcome).error).toMatchObject({ code: "SSE_HEADERS_TIMEOUT", attempt: 2 });
  });

  it("retries a timed-out HTTP attempt only after cleanup and the published wait", async () => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>().mockImplementationOnce(waitingFetch()).mockImplementation(async () => body(completed));
    const outcome = capture(run(fetchImpl));
    await vi.advanceTimersByTimeAsync(34999); expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect((await outcome).result?.status).toBe("completed"); expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("awaits reader cancellation before beginning a retry or its delay", async () => {
    let finishCancel!: () => void;
    const cancellation = new Promise<void>((resolve) => { finishCancel = resolve; });
    const cancel = vi.fn(() => cancellation);
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const fetchImpl = vi.fn<GoogleGenAiFetch>().mockResolvedValueOnce(new Response(stream, { status: 503 })).mockImplementation(async () => body(pending()));
    const outcome = capture(run(fetchImpl));
    await vi.advanceTimersByTimeAsync(20000); expect(cancel).toHaveBeenCalledTimes(1); expect(fetchImpl).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    finishCancel(); await vi.advanceTimersByTimeAsync(4999); expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect((await outcome).result?.status).toBe("in_progress"); expect(stream.locked).toBe(false);
  });

  it("accepts Content-Type essence independent of MIME case and parameters", async () => {
    expect((await run(async () => body(pending(), 200, "Text/Event-Stream; charset=utf-8"))).status).toBe("in_progress");
  });

  it("zero-byte chunks do not reset the 120000-ms idle timeout", async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(c) { streamController = c; }, cancel });
    const outcome = capture(run(async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }), policy({ recovery: { maxStreamRecoveryAttemptsPerReconciliation: 1 } })));
    await vi.advanceTimersByTimeAsync(110000); streamController.enqueue(new Uint8Array());
    await vi.advanceTimersByTimeAsync(10000);
    expect((await outcome).error).toMatchObject({ code: "SSE_IDLE_TIMEOUT" }); expect(cancel).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
  });

  it("nonempty chunks reset idle but not the 900000-ms attempt deadline", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    const outcome = capture(run(async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }), policy({ recovery: { maxStreamRecoveryAttemptsPerReconciliation: 1 } })));
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 8; i++) { await vi.advanceTimersByTimeAsync(110000); controller.enqueue(encoder.encode(": live\n\n")); await vi.advanceTimersByTimeAsync(0); }
    await vi.advanceTimersByTimeAsync(20000); expect((await outcome).error).toMatchObject({ code: "SSE_ATTEMPT_TIMEOUT" });
  });

  it("cancels early success, releases its reader and removes parent listeners", async () => {
    const { ctx } = context(); const add = vi.spyOn(ctx.signal, "addEventListener"); const remove = vi.spyOn(ctx.signal, "removeEventListener");
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode(completed + done)); c.close(); }, cancel });
    expect((await run(async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }), policy(), ctx)).status).toBe("completed");
    expect(cancel).toHaveBeenCalledTimes(0); expect(stream.locked).toBe(false); expect(add).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
  });

  it.each(["headers", "read", "delay"])("propagates parent abort during %s and does not retry", async (stage) => {
    const { ctx, parent } = context();
    const fetchImpl = stage === "headers" ? waitingFetch() : vi.fn<GoogleGenAiFetch>(async () => stage === "delay" ? body("", 503) : new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } }));
    const outcome = capture(run(fetchImpl, policy(), ctx));
    await vi.advanceTimersByTimeAsync(0); parent.abort(new Error(key));
    expect((await outcome).error).toMatchObject({ code: "OPERATION_ABORTED", retryable: false }); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("preserves only the safe parent reconciliation timeout classification", async () => {
    const { ctx, parent } = context(); parent.abort(new GoogleGenAiSecureOutputTransportError("RECONCILIATION_TIMEOUT"));
    const fetchImpl = vi.fn<GoogleGenAiFetch>();
    await expect(run(fetchImpl, policy(), ctx)).rejects.toMatchObject({ code: "RECONCILIATION_TIMEOUT" }); expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires full attempt budget before first call and delay+attempt before retry", async () => {
    const { ctx } = context(); const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => body("", 503));
    vi.mocked(ctx.remainingMs).mockReturnValue(899999);
    await expect(run(fetchImpl, policy(), ctx)).rejects.toMatchObject({ code: "RECOVERY_BUDGET_EXHAUSTED" }); expect(fetchImpl).not.toHaveBeenCalled();
    vi.mocked(ctx.remainingMs).mockReturnValueOnce(900000).mockReturnValue(904999);
    await expect(run(fetchImpl, policy(), ctx)).rejects.toMatchObject({ code: "RECOVERY_BUDGET_EXHAUSTED" }); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rechecks remaining budget after an admitted wait", async () => {
    const { ctx } = context(); vi.mocked(ctx.remainingMs).mockReturnValueOnce(900000).mockReturnValueOnce(905000).mockReturnValue(899999);
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => body("", 503)); const outcome = capture(run(fetchImpl, policy(), ctx));
    await vi.advanceTimersByTimeAsync(5000); expect((await outcome).error).toMatchObject({ code: "RECOVERY_BUDGET_EXHAUSTED" }); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([Number.MAX_VALUE, Number.MAX_SAFE_INTEGER + 1, -(Number.MAX_SAFE_INTEGER + 1), NaN, Infinity, -Infinity])("rejects malformed remaining budget %s before any request or wait", async (remaining) => {
    const { ctx } = context(); vi.mocked(ctx.remainingMs).mockReturnValue(remaining);
    const fetchImpl = vi.fn<GoogleGenAiFetch>();
    const timers = vi.spyOn(globalThis, "setTimeout");
    await expect(run(fetchImpl, policy(), ctx)).rejects.toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled(); expect(timers).not.toHaveBeenCalled();
  });

  it("allows sufficient fractional milliseconds without rounding", async () => {
    const { ctx } = context(); vi.mocked(ctx.remainingMs).mockReturnValue(900000.5);
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => body(pending()));
    expect(await run(fetchImpl, policy(), ctx)).toEqual({ id, status: "in_progress", outputVideo: null });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([-1, 0])("treats valid insufficient budget %s as exhaustion", async (remaining) => {
    const { ctx } = context(); vi.mocked(ctx.remainingMs).mockReturnValue(remaining);
    const fetchImpl = vi.fn<GoogleGenAiFetch>();
    await expect(run(fetchImpl, policy(), ctx)).rejects.toMatchObject({ code: "RECOVERY_BUDGET_EXHAUSTED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([Number.MAX_VALUE, Number.MAX_SAFE_INTEGER + 1])("rejects unsafe pre-retry budget %s before starting the wait", async (remaining) => {
    const { ctx } = context(); vi.mocked(ctx.remainingMs).mockReturnValueOnce(900000).mockReturnValue(remaining);
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => body("", 503));
    const timers = vi.spyOn(globalThis, "setTimeout");
    await expect(run(fetchImpl, policy(), ctx)).rejects.toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // A 503 creates only headers/attempt timers; a retry wait would create a third.
    expect(timers.mock.calls.map(([, delay]) => delay)).toEqual([30000, 900000]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["streamRecoveryFirstRetryDelayMs", "streamRecoverySecondRetryDelayMs"] as const)("rejects an unsafe combined admission duration for %s before fetch", async (field) => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>();
    const timers = vi.spyOn(globalThis, "setTimeout");
    await expect(run(fetchImpl, policy({ recovery: { [field]: Number.MAX_SAFE_INTEGER } }))).rejects.toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled(); expect(timers).not.toHaveBeenCalled();
  });

  it("rejects invalid injected policy rather than multiplying retries", async () => {
    const fetchImpl = vi.fn<GoogleGenAiFetch>();
    await expect(run(fetchImpl, policy({ recovery: { maxStreamRecoveryAttemptsPerReconciliation: 4 } }))).rejects.toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID" });
    expect(fetchImpl).not.toHaveBeenCalled();
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

describe("B4V8C replay closed dependency-error boundary (validate before classify)", () => {
  beforeEach(() => { b4v8cGetterReads.count = 0; });
  const throwing = (make: () => unknown) => vi.fn<GoogleGenAiFetch>(async () => { throw make(); });

  it.each(B4V8C_MALFORMED)("fails a %s transport-looking dependency error closed: CONFIG, nonretryable, one attempt", async (_label, make) => {
    let raw: unknown;
    const fetchImpl = throwing(() => (raw = make()));
    const { error } = await capture(run(fetchImpl));
    expect(error).toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID", retryable: false });
    b4v8cExpectSanitized(error, raw);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(B4V8C_ACCESSOR_FIELDS)("never executes an accessor-backed %s getter during retry classification", async (field) => {
    let raw: unknown;
    const fetchImpl = throwing(() => (raw = b4v8cAccessorBacked(field)));
    const { error } = await capture(run(fetchImpl));
    expect(b4v8cGetterReads.count).toBe(0);
    expect(error).toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID", retryable: false });
    b4v8cExpectSanitized(error, raw);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reconstructs a hostile genuine frozen base error freshly (no identity, stack, cause or custom data)", async () => {
    const raw = b4v8cHostileBase("SSE_PROVIDER_ERROR");
    const fetchImpl = throwing(() => raw);
    const { error } = await capture(run(fetchImpl));
    expect(error).toMatchObject({ code: "SSE_PROVIDER_ERROR", retryable: false, attempt: undefined, httpStatus: undefined });
    b4v8cExpectSanitized(error, raw);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps legitimate constructor-derived retry semantics: a genuine 503 retries with 5000/15000 waits and surfaces fresh", async () => {
    const raw = b4v8cHostileBase("SSE_HTTP_FAILED", { attempt: 1, httpStatus: 503 });
    const fetchImpl = throwing(() => raw);
    const outcome = capture(run(fetchImpl));
    await vi.advanceTimersByTimeAsync(0); expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999); expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15000);
    const { error } = await outcome;
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(error).toMatchObject({ code: "SSE_HTTP_FAILED", attempt: 1, httpStatus: 503, retryable: true });
    b4v8cExpectSanitized(error, raw);
  });

  it("normalizes a genuine subclass to a fresh base error with its exact nonretryable semantics", async () => {
    class GenuineSubclass extends GoogleGenAiSecureOutputTransportError {}
    const raw = new GenuineSubclass("SSE_HTTP_FAILED", { httpStatus: 404 });
    const fetchImpl = throwing(() => raw);
    const { error } = await capture(run(fetchImpl));
    expect(error).toMatchObject({ code: "SSE_HTTP_FAILED", httpStatus: 404, retryable: false });
    b4v8cExpectSanitized(error, raw);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps the frozen network-failure fallback for an ordinary error, discarding its cause and custom data", async () => {
    let raw: unknown;
    const fetchImpl = throwing(() => (raw = b4v8cOrdinary()));
    const outcome = capture(run(fetchImpl));
    await vi.advanceTimersByTimeAsync(20000);
    const { error } = await outcome;
    expect(error).toMatchObject({ code: "SSE_HTTP_FAILED", httpStatus: undefined, retryable: true });
    b4v8cExpectSanitized(error, raw);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("is semantically stable across repeated normalization (a fresh CONFIG stays CONFIG)", async () => {
    const raw = new GoogleGenAiSecureOutputTransportError("SECURE_TRANSPORT_CONFIGURATION_INVALID");
    const { error } = await capture(run(throwing(() => raw)));
    expect(error).toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID", retryable: false, attempt: undefined, httpStatus: undefined });
    expect(error).not.toBe(raw);
  });

  it("classifies a parent abort reason without executing its getters and without echoing it", async () => {
    const parent = new AbortController();
    const reason = b4v8cAccessorBacked("code");
    parent.abort(reason);
    const fetchImpl = vi.fn<GoogleGenAiFetch>();
    const { error } = await capture(run(fetchImpl, policy(), { signal: parent.signal, remainingMs: () => 9_000_000 }));
    expect(b4v8cGetterReads.count).toBe(0);
    expect(error).toMatchObject({ code: "OPERATION_ABORTED" });
    b4v8cExpectSanitized(error, reason);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("completed replay termination: EOF-only release with one exact done frame", () => {
  const video = { type: "video", mime_type: "video/mp4", uri: "https://generativelanguage.googleapis.com/v1beta/files/test:download?alt=media" };
  const unknown = frame({ event_type: "ping" });
  function chunked(parts: string[], close = true) {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(c) { for (const part of parts) c.enqueue(encoder.encode(part)); if (close) c.close(); }, cancel });
    const fetchImpl = vi.fn<GoogleGenAiFetch>(async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }));
    return { stream, cancel, fetchImpl };
  }
  const partitions = (tail: string): Array<[string, string[]]> => [
    ["one chunk (completed and tail together)", [completed + tail]],
    ["completed ends at a chunk boundary", [completed, tail]],
    ["tail split across five chunks", [completed, tail.slice(0, 3), tail.slice(3, 9), tail.slice(9, 15), tail.slice(15, 20), tail.slice(20)]],
    ["one byte at a time over the terminal region", [completed.slice(0, -40), ...(completed.slice(-40) + tail).split("")]],
  ];

  it.each(partitions(done))("returns the completed result only at EOF after done: %s", async (_name, parts) => {
    const { stream, cancel, fetchImpl } = chunked(parts);
    expect(await run(fetchImpl)).toEqual({ id, status: "completed", outputVideo: video });
    expect(cancel).not.toHaveBeenCalled(); expect(stream.locked).toBe(false); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps historical completed -> EOF without a done frame", async () => {
    const { stream, fetchImpl } = chunked([completed]);
    expect(await run(fetchImpl)).toEqual({ id, status: "completed", outputVideo: video });
    expect(stream.locked).toBe(false);
  });

  it.each([...partitions(unknown), ...partitions(done + unknown), ...partitions(done + done)])(
    "rejects invalid post-completion content in every chunk partition: %s",
    async (_name, parts) => {
      const { stream, fetchImpl } = chunked(parts);
      const { result, error } = await capture(run(fetchImpl));
      expect(result).toBeUndefined();
      expect(error).toMatchObject({ code: "INTERACTION_REPLAY_CONTRACT_CHANGED", retryable: false });
      expect(stream.locked).toBe(false); expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it.each([["completed", completed], ["completed and done", completed + done]])(
    "never reports success for a stream left open after %s; fails by the existing idle timeout",
    async (_name, text) => {
      const { ctx } = context(); const add = vi.spyOn(ctx.signal, "addEventListener"); const remove = vi.spyOn(ctx.signal, "removeEventListener");
      const { stream, cancel, fetchImpl } = chunked([text], false);
      let settled = false;
      const outcome = capture(run(fetchImpl, policy({ recovery: { maxStreamRecoveryAttemptsPerReconciliation: 1 } }), ctx)).finally(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(119999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const { result, error } = await outcome;
      expect(result).toBeUndefined(); expect(error).toMatchObject({ code: "SSE_IDLE_TIMEOUT" });
      expect(cancel).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false); expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
    },
  );
});
