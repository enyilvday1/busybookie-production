import { GOOGLE_PROVIDER_ID, RUNWAY_PROVIDER_ID } from "commercial-worker-protocol";

import { buildGoogleVerificationRequest, classifyGoogleVerificationOutcome } from "./googleProviderVerification.js";
import { classifyProviderVerificationLease, type ProviderVerificationResultReport } from "./providerVerificationContract.js";
import { buildRunwayVerificationRequest, classifyRunwayVerificationOutcome } from "./runwayProviderVerification.js";
import { WorkerError } from "./workerError.js";

// R44B11F Phase 6: the single provider verification entry point (architecture
// "R44B11F Phase 6 provider verification transport contract amendment").
//
// Local validation, pair dispatch, the one fixed GET through the injected
// fetchImpl, the 10-second deadline, caller-abort composition and the bounded
// body read. Provider-neutral apart from dispatch: no origin, path, header
// name or status rule lives here. Every provider condition is returned as a
// report; only local faults detected before any request is sent are thrown.
// Nothing is logged, retained, retried or persisted.

export const PROVIDER_VERIFICATION_TIMEOUT_MS = 10000;
export const PROVIDER_VERIFICATION_RESPONSE_MAX_BYTES = 65536;

export type ProviderVerificationDeadlineTimer = (ms: number, onExpiry: () => void) => () => void;

export type ProviderVerificationRequest = Readonly<{ url: string; headers: Readonly<Record<string, string>> }>;

export type ProviderVerificationRawOutcome =
  | Readonly<{ kind: "RESPONSE"; status: number; body: Uint8Array }>
  | Readonly<{ kind: "BODY_TOO_LARGE" }>
  | Readonly<{ kind: "TIMEOUT" }>
  | Readonly<{ kind: "CALLER_ABORT" }>
  | Readonly<{ kind: "NETWORK_FAILURE" }>;

export type ProviderVerificationTransportDependencies = Readonly<{
  fetchImpl: typeof fetch;
  deadlineTimer?: ProviderVerificationDeadlineTimer;
}>;

export type ProviderVerificationInput = Readonly<{
  provider: string;
  verificationPolicyId: string;
  credential: string;
  signal?: AbortSignal;
}>;

type Cause = "TIMEOUT" | "CALLER_ABORT";
type Classifier = (outcome: ProviderVerificationRawOutcome) => ProviderVerificationResultReport;

const BODY_TOO_LARGE: ProviderVerificationRawOutcome = Object.freeze({ kind: "BODY_TOO_LARGE" });
const NETWORK_FAILURE: ProviderVerificationRawOutcome = Object.freeze({ kind: "NETWORK_FAILURE" });
const CAUSE_OUTCOMES: Readonly<Record<Cause, ProviderVerificationRawOutcome>> = Object.freeze({
  TIMEOUT: Object.freeze({ kind: "TIMEOUT" }),
  CALLER_ABORT: Object.freeze({ kind: "CALLER_ABORT" }),
});

// 1 to 4096 visible ASCII characters (0x21 to 0x7E), nothing else.
const CREDENTIAL_SHAPE = /^[!-~]{1,4096}$/;
// A canonical non-negative decimal integer: no sign, no leading zero, no space.
const CANONICAL_LENGTH = /^(0|[1-9][0-9]*)$/;

// The default deadline: the only timer primitive in the verification modules.
const defaultDeadlineTimer: ProviderVerificationDeadlineTimer = (ms, onExpiry) => {
  const handle = setTimeout(onExpiry, ms);
  return () => clearTimeout(handle);
};

type Waited = Readonly<{ kind: "VALUE"; value: unknown }> | Readonly<{ kind: "FAILED" }> | Readonly<{ kind: "CANCELLED" }>;
const FAILED: Waited = Object.freeze({ kind: "FAILED" });
const CANCELLED: Waited = Object.freeze({ kind: "CANCELLED" });

type PendingWindow = Readonly<{
  signal: AbortSignal;
  recorded: () => Cause | null;
  wait: (pending: unknown) => Promise<Waited>;
  end: (candidate: ProviderVerificationRawOutcome) => ProviderVerificationRawOutcome;
}>;

// Start steps 3a and 3b, in their own scope so that no callback handed to the
// caller signal or the timer can reach the credential or the request.
//
// While the window is open the first recorded cause wins. The first end()
// establishes the terminal raw outcome (a cause recorded earlier replaces the
// candidate), closes the window, cancels the deadline and removes the caller
// listener; a later trigger or a later end() then changes nothing. A failed deadline installation closes
// the window and throws WORKER_CONFIGURATION_INVALID, whatever was recorded
// during the same call.
function openPendingWindow(callerSignal: AbortSignal | undefined, deadlineTimer: ProviderVerificationDeadlineTimer): PendingWindow {
  const controller = new AbortController();
  let open = true;
  let recordedCause: Cause | null = null;
  let terminal: ProviderVerificationRawOutcome | null = null;
  let wake: () => void = () => undefined;
  const cancelled = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const record = (next: Cause): void => {
    if (!open || recordedCause !== null) return;
    recordedCause = next;
    wake();
    controller.abort();
  };

  const onCallerAbort = (): void => record("CALLER_ABORT");
  let listening = false;
  const removeListener = (): void => {
    if (!listening || callerSignal === undefined) return;
    listening = false;
    try {
      Reflect.apply(platformRemoveEventListener as (...args: unknown[]) => unknown, callerSignal, ["abort", onCallerAbort]);
    } catch {
      // Cleanup only: never replaces the selected outcome.
    }
  };

  // 3a.
  if (callerSignal !== undefined) {
    Reflect.apply(platformAddEventListener as (...args: unknown[]) => unknown, callerSignal, ["abort", onCallerAbort, { once: true }]);
    listening = true;
    if (abortedOf(callerSignal)) record("CALLER_ABORT");
  }

  // 3b.
  let installed: unknown = undefined;
  let installFailed = false;
  try {
    installed = deadlineTimer(PROVIDER_VERIFICATION_TIMEOUT_MS, () => record("TIMEOUT"));
  } catch {
    installFailed = true;
  }
  if (installFailed || typeof installed !== "function") {
    open = false;
    removeListener();
    throw new WorkerError("WORKER_CONFIGURATION_INVALID");
  }
  const cancelDeadline = installed as () => void;

  const close = (): void => {
    if (!open) return;
    open = false;
    try {
      cancelDeadline();
    } catch {
      // A throwing timer cleanup is swallowed; the selected outcome stands.
    }
    removeListener();
  };

  return Object.freeze({
    signal: controller.signal,
    recorded: () => recordedCause,
    // Settles when the awaited value settles or a cause is recorded, whichever
    // comes first, so no wait depends on fetchImpl or the stream honouring the
    // internal signal. A late settlement or rejection is observed and ignored.
    wait: (pending: unknown): Promise<Waited> => {
      let settled: Promise<Waited>;
      try {
        settled = Promise.resolve(pending).then(
          (value): Waited => Object.freeze({ kind: "VALUE", value }),
          (): Waited => FAILED,
        );
      } catch {
        settled = Promise.resolve(FAILED);
      }
      return Promise.race([settled, cancelled.then((): Waited => CANCELLED)]);
    },
    // The first end() selects the terminal raw outcome; every later end()
    // returns that same outcome, so a later failure can never replace it.
    end: (candidate: ProviderVerificationRawOutcome): ProviderVerificationRawOutcome => {
      if (terminal === null) terminal = recordedCause === null ? candidate : CAUSE_OUTCOMES[recordedCause];
      const outcome = terminal;
      close();
      return outcome;
    },
  });
}

// Attempts to cancel a body stream or reader. A synchronous throw or a
// rejected promise is observed and ignored: it never changes the outcome,
// escapes, retries or is logged.
function cancelQuietly(target: unknown): void {
  try {
    if (typeof target !== "object" || target === null) return;
    const cancel: unknown = (target as { cancel?: unknown }).cancel;
    if (typeof cancel !== "function") return;
    const result: unknown = cancel.call(target);
    Promise.resolve(result).catch(() => undefined);
  } catch {
    // Ignored.
  }
}

// Attempts to cancel the body of a fulfilled fetch value that arrived after
// the terminal raw outcome was selected. Never throws.
function cancelBodyOf(value: unknown): void {
  try {
    if (typeof value !== "object" || value === null) return;
    cancelQuietly((value as { body?: unknown }).body);
  } catch {
    // Ignored.
  }
}

// A fetch that settles after the window ended is observed: a late response
// has its body cancelled, a late rejection is ignored. The handler holds only
// the abandoned promise, never the request or the credential.
function cancelLateResponseBody(pending: unknown): void {
  try {
    Promise.resolve(pending).then(cancelBodyOf, () => undefined);
  } catch {
    // Ignored.
  }
}

// The intrinsic %TypedArray%.prototype.byteLength getter, captured once, so a
// chunk cannot misreport its own size through an overriding accessor.
const intrinsicByteLength: unknown = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, "byteLength")?.get;

function byteLengthOf(chunk: Uint8Array): number {
  if (typeof intrinsicByteLength !== "function") throw new TypeError("no intrinsic byte length");
  const size: unknown = Reflect.apply(intrinsicByteLength, chunk, []);
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) throw new TypeError("invalid byte length");
  return size;
}

// The intrinsic AbortSignal.prototype aborted getter, captured once. It both
// brand-checks a candidate signal (it throws for a forged object that only
// passes instanceof) and reads the platform abort state, so an overriding
// instance accessor is never consulted.
const intrinsicAborted: unknown = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;

function abortedOf(signal: AbortSignal): boolean {
  if (typeof intrinsicAborted !== "function") throw new TypeError("no intrinsic aborted getter");
  return Reflect.apply(intrinsicAborted, signal, []) === true;
}

// The platform EventTarget listener methods, captured once. The transport
// installs and removes its caller listener only through these, never through
// a signal's own (overridable) addEventListener or removeEventListener.
const platformAddEventListener: unknown = EventTarget.prototype.addEventListener;
const platformRemoveEventListener: unknown = EventTarget.prototype.removeEventListener;

// A present caller signal must be a platform AbortSignal: instanceof alone
// accepts a forged object, so the intrinsic aborted getter must accept it, and
// the platform removeEventListener must accept it as a receiver (removing a
// fresh listener that was never added: no listener is installed and no state
// changes). Any failure, including a throwing prototype lookup, is a
// non-signal.
function isPlatformAbortSignal(value: unknown): value is AbortSignal {
  try {
    if (!(value instanceof AbortSignal)) return false;
    if (typeof platformAddEventListener !== "function" || typeof platformRemoveEventListener !== "function") return false;
    abortedOf(value);
    Reflect.apply(platformRemoveEventListener, value, ["abort", () => undefined]);
    return true;
  } catch {
    return false;
  }
}

type ResponseView = Readonly<{ status: number; declaredLength: string | null; body: unknown }>;

// A fulfilled value is a response only with an integer status from 0 to 599,
// a headers object with get(), and a body that is absent or has getReader().
function viewResponse(value: unknown): ResponseView | null {
  try {
    if (typeof value !== "object" || value === null) return null;
    const { status, headers, body } = value as { status?: unknown; headers?: unknown; body?: unknown };
    if (typeof status !== "number" || !Number.isInteger(status) || status < 0 || status > 599) return null;
    if (typeof headers !== "object" || headers === null) return null;
    const get: unknown = (headers as { get?: unknown }).get;
    if (typeof get !== "function") return null;
    const declared: unknown = get.call(headers, "content-length");
    if (body !== undefined && body !== null && (typeof body !== "object" || typeof (body as { getReader?: unknown }).getReader !== "function")) return null;
    return Object.freeze({ status, declaredLength: typeof declared === "string" ? declared : null, body });
  } catch {
    return null;
  }
}

async function exchange(inflight: PendingWindow, fetchImpl: typeof fetch, request: ProviderVerificationRequest): Promise<ProviderVerificationRawOutcome> {
  // 3c.
  if (inflight.recorded() !== null) return inflight.end(NETWORK_FAILURE);

  // 3d: exactly one request.
  let pending: unknown;
  try {
    pending = fetchImpl(request.url, { method: "GET", headers: request.headers, redirect: "manual", signal: inflight.signal });
  } catch {
    return inflight.end(NETWORK_FAILURE);
  }
  const fetched = await inflight.wait(pending);
  if (fetched.kind === "CANCELLED") {
    const outcome = inflight.end(NETWORK_FAILURE);
    cancelLateResponseBody(pending);
    return outcome;
  }
  if (fetched.kind !== "VALUE") return inflight.end(NETWORK_FAILURE);
  if (inflight.recorded() !== null) {
    const outcome = inflight.end(NETWORK_FAILURE);
    cancelBodyOf(fetched.value);
    return outcome;
  }

  // Post-send safety net: an unexpected throw while handling the response
  // ends the window as NETWORK_FAILURE (or keeps the outcome already selected),
  // with full terminal cleanup and the stream cancelled; nothing escapes.
  const held: { stream: unknown } = { stream: undefined };
  try {
    return await readResponse(inflight, fetched.value, held);
  } catch {
    const outcome = inflight.end(NETWORK_FAILURE);
    cancelQuietly(held.stream);
    return outcome;
  }
}

async function readResponse(inflight: PendingWindow, value: unknown, held: { stream: unknown }): Promise<ProviderVerificationRawOutcome> {
  const response = viewResponse(value);
  if (response === null) return inflight.end(NETWORK_FAILURE);
  const { status, declaredLength, body } = response;
  held.stream = body;

  if (declaredLength !== null && CANONICAL_LENGTH.test(declaredLength) && Number(declaredLength) > PROVIDER_VERIFICATION_RESPONSE_MAX_BYTES) {
    const outcome = inflight.end(BODY_TOO_LARGE);
    cancelQuietly(body);
    return outcome;
  }
  if (body === undefined || body === null) return inflight.end(Object.freeze({ kind: "RESPONSE", status, body: new Uint8Array(0) }));

  let reader: unknown;
  try {
    reader = (body as { getReader: () => unknown }).getReader();
  } catch {
    return inflight.end(NETWORK_FAILURE);
  }
  held.stream = reader;
  if (typeof reader !== "object" || reader === null || typeof (reader as { read?: unknown }).read !== "function") {
    const outcome = inflight.end(NETWORK_FAILURE);
    cancelQuietly(body);
    return outcome;
  }

  // The single bounded body-read loop.
  const chunks: Array<Readonly<{ chunk: Uint8Array; size: number }>> = [];
  let total = 0;
  for (;;) {
    let next: unknown;
    try {
      next = (reader as { read: () => unknown }).read();
    } catch {
      const outcome = inflight.end(NETWORK_FAILURE);
      cancelQuietly(reader);
      return outcome;
    }
    const step = await inflight.wait(next);
    if (inflight.recorded() !== null || step.kind !== "VALUE") {
      const outcome = inflight.end(NETWORK_FAILURE);
      cancelQuietly(reader);
      return outcome;
    }
    let done: unknown;
    let chunk: unknown;
    try {
      if (typeof step.value !== "object" || step.value === null) throw new TypeError("not a read result");
      ({ done, value: chunk } = step.value as { done?: unknown; value?: unknown });
    } catch {
      const outcome = inflight.end(NETWORK_FAILURE);
      cancelQuietly(reader);
      return outcome;
    }
    if (done === true) break;
    if (!(chunk instanceof Uint8Array)) {
      const outcome = inflight.end(NETWORK_FAILURE);
      cancelQuietly(reader);
      return outcome;
    }
    // The size comes from the intrinsic typed-array getter, never the chunk.
    const size = byteLengthOf(chunk);
    total += size;
    if (total > PROVIDER_VERIFICATION_RESPONSE_MAX_BYTES) {
      const outcome = inflight.end(BODY_TOO_LARGE);
      cancelQuietly(reader);
      return outcome;
    }
    chunks.push(Object.freeze({ chunk, size }));
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach(({ chunk, size }) => {
    bytes.set(chunk, offset);
    offset += size;
  });
  return inflight.end(Object.freeze({ kind: "RESPONSE", status, body: bytes }));
}

export async function performProviderVerification(
  input: ProviderVerificationInput,
  dependencies: ProviderVerificationTransportDependencies,
): Promise<ProviderVerificationResultReport> {
  // Every caller-supplied member is read exactly once into a local before any
  // check; a member read that throws is a fault of that argument.
  let fetchImpl: unknown = undefined;
  let deadlineTimer: unknown = undefined;
  let dependenciesReadable = false;
  if (typeof dependencies === "object" && dependencies !== null) {
    try {
      fetchImpl = dependencies.fetchImpl;
      deadlineTimer = dependencies.deadlineTimer;
      dependenciesReadable = true;
    } catch {
      dependenciesReadable = false;
    }
  }
  let provider: unknown = undefined;
  let verificationPolicyId: unknown = undefined;
  let credential: unknown = undefined;
  let signal: unknown = undefined;
  let inputReadable = false;
  if (typeof input === "object" && input !== null) {
    try {
      provider = input.provider;
      verificationPolicyId = input.verificationPolicyId;
      credential = input.credential;
      signal = input.signal;
      inputReadable = true;
    } catch {
      inputReadable = false;
    }
  }

  // Dependencies.
  if (!dependenciesReadable || typeof fetchImpl !== "function" || (deadlineTimer !== undefined && typeof deadlineTimer !== "function")) {
    throw new WorkerError("WORKER_CONFIGURATION_INVALID");
  }
  // Input shape.
  if (!inputReadable || typeof provider !== "string" || typeof verificationPolicyId !== "string" || (signal !== undefined && !isPlatformAbortSignal(signal))) {
    throw new WorkerError("PROVIDER_VERIFICATION_REQUEST_INVALID");
  }
  // Pair admission (the Phase 5 mapping).
  const admission = classifyProviderVerificationLease({ provider, verificationPolicyId });
  if (admission.status === "REFUSED") {
    throw new WorkerError(admission.reason === "UNSUPPORTED_PROVIDER" ? "PROVIDER_VERIFICATION_PROVIDER_UNSUPPORTED" : "PROVIDER_VERIFICATION_POLICY_UNSUPPORTED");
  }
  // Credential shape.
  if (typeof credential !== "string" || !CREDENTIAL_SHAPE.test(credential)) throw new WorkerError("PROVIDER_VERIFICATION_REQUEST_INVALID");

  // Pair dispatch by exact equality against the two canonical constants.
  let classify: Classifier;
  let request: ProviderVerificationRequest;
  if (provider === GOOGLE_PROVIDER_ID) {
    classify = classifyGoogleVerificationOutcome;
    request = buildGoogleVerificationRequest(credential);
  } else if (provider === RUNWAY_PROVIDER_ID) {
    classify = classifyRunwayVerificationOutcome;
    request = buildRunwayVerificationRequest(credential);
  } else {
    throw new WorkerError("PROVIDER_VERIFICATION_PROVIDER_UNSUPPORTED");
  }

  // The already-aborted caller signal: returned, not thrown, with no listener,
  // no timer call and no request.
  const callerSignal = signal as AbortSignal | undefined;
  if (callerSignal !== undefined && abortedOf(callerSignal)) return classify(CAUSE_OUTCOMES.CALLER_ABORT);

  const inflight = openPendingWindow(callerSignal, (deadlineTimer as ProviderVerificationDeadlineTimer | undefined) ?? defaultDeadlineTimer);
  return classify(await exchange(inflight, fetchImpl as typeof fetch, request));
}
