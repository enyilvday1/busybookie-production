import { randomBytes, randomUUID } from "node:crypto";
import { getEventListeners } from "node:events";

import { GOOGLE_PROVIDER_ID, RUNWAY_PROVIDER_ID } from "commercial-worker-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CredentialOpener } from "../src/credentialContracts.js";
import { bindProviderVerificationCredential } from "../src/providerVerificationCredentialOpening.js";
import { isProviderVerificationResultReport } from "../src/providerVerificationContract.js";
import {
  performProviderVerification,
  PROVIDER_VERIFICATION_RESPONSE_MAX_BYTES,
  PROVIDER_VERIFICATION_TIMEOUT_MS,
  type ProviderVerificationDeadlineTimer,
  type ProviderVerificationInput,
  type ProviderVerificationTransportDependencies,
} from "../src/providerVerificationTransport.js";
import { createHttpProviderVerificationControlClient } from "../src/workerControlClient.js";
import { WorkerError, type WorkerErrorCode } from "../src/workerError.js";
import { createTestCredentialOpener, createTestCredentialSealer, generateTestKey } from "./support/testCredentialOpening.js";

// R44B11F Phase 6: the provider verification transport (architecture
// "Deadline, caller abort and composition", "Response body bound", "Throw
// versus return", "Phase 6 test contract"). Injected fake fetchImpl, timer,
// signals and streams only; nothing reaches a provider or the network.

const GOOGLE_POLICY = "GOOGLE_GENAI_MODELS_LIST_V1BETA";
const RUNWAY_POLICY = "RUNWAY_ORGANIZATION_GET_V1_2024_11_06";
const CREDENTIAL = `fixture-verification-key-${randomBytes(16).toString("hex")}`;
const encoder = new TextEncoder();

const VERIFIED = { outcome: "VERIFIED", reasonCode: "VERIFICATION_SUCCEEDED" };
const TIMEOUT = { outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_TIMEOUT" };
const AMBIGUOUS = { outcome: "INCONCLUSIVE", reasonCode: "VERIFICATION_AMBIGUOUS" };
const NETWORK = { outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_NETWORK_FAILURE" };
const TOO_LARGE = { outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_RESPONSE_TOO_LARGE" };
const MALFORMED = { outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_RESPONSE_MALFORMED" };
const DRIFT = { outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_OPERATION_DRIFT" };
const UNAVAILABLE = { outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_UNAVAILABLE" };
const RATE = { outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_RATE_OR_QUOTA_LIMITED" };

const googleInput = (extra: Partial<Record<keyof ProviderVerificationInput, unknown>> = {}) =>
  ({ provider: GOOGLE_PROVIDER_ID, verificationPolicyId: GOOGLE_POLICY, credential: CREDENTIAL, ...extra }) as ProviderVerificationInput;
const deps = (extra: Partial<Record<keyof ProviderVerificationTransportDependencies, unknown>>) => extra as unknown as ProviderVerificationTransportDependencies;

// --- fakes -----------------------------------------------------------------

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const streamOf = (...chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
const okBody = (text = "{}") => streamOf(encoder.encode(text));
const fakeResponse = (status: number, body: unknown = okBody(), headers: Record<string, string> = {}) => ({ status, headers: new Headers(headers), body });

// Plain counting wrappers, never vi.fn: a spy observes every promise its
// function returns, which would hide an unhandled rejection the transport
// failed to observe.
function counted<A extends unknown[], R>(implementation: (...args: A) => R) {
  const wrapper = Object.assign(
    (...args: A): R => {
      wrapper.count += 1;
      return implementation(...args);
    },
    { count: 0 },
  );
  return wrapper;
}

// A fetchImpl that records every call and answers with the given function.
function fakeFetch(answer: (init: RequestInit | undefined) => unknown = () => fakeResponse(200)) {
  const calls: Array<{ url: unknown; init: RequestInit | undefined }> = [];
  const fetchImpl = ((url: unknown, init?: RequestInit) => {
    calls.push({ url, init });
    return answer(init);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

// A fetchImpl that ignores every signal and settles only when told to.
function ignoringFetch() {
  const pending = deferred<unknown>();
  const { fetchImpl, calls } = fakeFetch(() => pending.promise);
  return { fetchImpl, calls, pending };
}

// A manual deadline timer: records each call, exposes the expiry callback and
// counts cleanup calls.
function manualTimer(cleanup: () => void = () => undefined) {
  const state = { calls: 0, ms: [] as number[], cleared: 0, expire: (): void => undefined };
  const timer: ProviderVerificationDeadlineTimer = (ms, onExpiry) => {
    state.calls += 1;
    state.ms.push(ms);
    state.expire = onExpiry;
    return () => {
      state.cleared += 1;
      cleanup();
    };
  };
  return { timer, state };
}

// A real caller signal whose abort listeners are observed through the
// platform's own listener list (the transport bypasses any instance
// override). active() is the number of abort listeners currently installed;
// timed(timer) samples that number each time the deadline is installed, which
// is after start step 3a.
function observedSignal() {
  const controller = new AbortController();
  const signal = controller.signal;
  const atTimer: number[] = [];
  const active = () => getEventListeners(signal, "abort").length;
  const timed =
    (timer: ProviderVerificationDeadlineTimer): ProviderVerificationDeadlineTimer =>
    (ms, onExpiry) => {
      atTimer.push(active());
      return timer(ms, onExpiry);
    };
  return { controller, signal, atTimer, active, timed };
}

// A body whose reader read() resolves only when told to; cancel is observed.
function controlledBody(cancel: () => unknown = () => Promise.resolve()) {
  const reads: Array<ReturnType<typeof deferred<unknown>>> = [];
  const reader = {
    read: counted(() => {
      const next = deferred<unknown>();
      reads.push(next);
      return next.promise;
    }),
    cancel: counted(cancel),
    releaseLock: () => undefined,
  };
  const body = { getReader: counted(() => reader), cancel: counted(() => Promise.resolve()) };
  return { body, reader, reads };
}

// A body that hands out the given chunks, then done; every call is observed.
function chunkedBody(chunks: unknown[], cancel: () => unknown = () => Promise.resolve()) {
  let index = 0;
  const reader = {
    read: counted(async () => (index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined })),
    cancel: counted(cancel),
    releaseLock: () => undefined,
  };
  const body = { getReader: counted(() => reader), cancel: counted(cancel) };
  return { body, reader };
}

const flush = async () => {
  for (let turn = 0; turn < 6; turn += 1) await new Promise((resolve) => setImmediate(resolve));
};

function watchUnhandledRejections() {
  const seen: unknown[] = [];
  const onRejection = (reason: unknown) => seen.push(reason);
  process.on("unhandledRejection", onRejection);
  return { seen, stop: () => process.off("unhandledRejection", onRejection) };
}

function watchConsole() {
  return (["log", "info", "warn", "error", "debug", "trace"] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the invocation to throw");
}

function expectLocalFault(error: unknown, code: WorkerErrorCode) {
  expect(error).toBeInstanceOf(WorkerError);
  expect((error as WorkerError).code).toBe(code);
  expect((error as Error).cause).toBeUndefined();
  expect(Object.hasOwn(error as object, "cause")).toBe(false);
  expect(String(error)).not.toContain(CREDENTIAL);
  expect((error as Error).stack ?? "").not.toContain(CREDENTIAL);
  expect(JSON.stringify(error)).not.toContain(CREDENTIAL);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// --- local validation ----------------------------------------------------------

describe("local validation (R44B11F Phase 6)", () => {
  it.each([
    ["dependencies null", null],
    ["dependencies undefined", undefined],
    ["dependencies a string", "fetch"],
    ["fetchImpl missing", {}],
    ["fetchImpl null", { fetchImpl: null }],
    ["fetchImpl not a function", { fetchImpl: {} }],
    ["deadlineTimer null", { fetchImpl: "F", deadlineTimer: null }],
    ["deadlineTimer a number", { fetchImpl: "F", deadlineTimer: 0 }],
    ["deadlineTimer false", { fetchImpl: "F", deadlineTimer: false }],
    ["deadlineTimer an object", { fetchImpl: "F", deadlineTimer: {} }],
  ])("throws WORKER_CONFIGURATION_INVALID for %s, with no request", async (_name, raw) => {
    const { fetchImpl, calls } = fakeFetch();
    const dependencies = raw !== null && typeof raw === "object" && "fetchImpl" in raw && raw.fetchImpl === "F" ? { ...raw, fetchImpl } : raw;
    expectLocalFault(await rejectionOf(performProviderVerification(googleInput(), dependencies as unknown as ProviderVerificationTransportDependencies)), "WORKER_CONFIGURATION_INVALID");
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["input null", null],
    ["input a string", "GOOGLE"],
    ["provider missing", { verificationPolicyId: GOOGLE_POLICY, credential: CREDENTIAL }],
    ["provider not a string", googleInput({ provider: 1 })],
    ["policy not a string", googleInput({ verificationPolicyId: null })],
    ["signal null", googleInput({ signal: null })],
    ["signal a plain object", googleInput({ signal: { aborted: false, addEventListener: () => undefined } })],
    ["signal false", googleInput({ signal: false })],
    ["signal an AbortController", googleInput({ signal: new AbortController() })],
  ])("throws PROVIDER_VERIFICATION_REQUEST_INVALID for %s, with no request", async (_name, input) => {
    const { fetchImpl, calls } = fakeFetch();
    const { timer, state } = manualTimer();
    const error = await rejectionOf(performProviderVerification(input as unknown as ProviderVerificationInput, { fetchImpl, deadlineTimer: timer }));
    expectLocalFault(error, "PROVIDER_VERIFICATION_REQUEST_INVALID");
    expect((error as Error).message).toBe("The provider verification request is invalid and was not sent.");
    expect([calls.length, state.calls]).toEqual([0, 0]);
  });

  it.each([
    ["an unsupported provider", { provider: "OTHER", verificationPolicyId: GOOGLE_POLICY }, "PROVIDER_VERIFICATION_PROVIDER_UNSUPPORTED"],
    ["a lower-case provider", { provider: GOOGLE_PROVIDER_ID.toLowerCase(), verificationPolicyId: GOOGLE_POLICY }, "PROVIDER_VERIFICATION_PROVIDER_UNSUPPORTED"],
    ["an unsupported policy", { provider: GOOGLE_PROVIDER_ID, verificationPolicyId: "OTHER" }, "PROVIDER_VERIFICATION_POLICY_UNSUPPORTED"],
    ["a mismatched pair", { provider: GOOGLE_PROVIDER_ID, verificationPolicyId: RUNWAY_POLICY }, "PROVIDER_VERIFICATION_POLICY_UNSUPPORTED"],
    ["the other mismatched pair", { provider: RUNWAY_PROVIDER_ID, verificationPolicyId: GOOGLE_POLICY }, "PROVIDER_VERIFICATION_POLICY_UNSUPPORTED"],
  ] as const)("uses the Phase 5 admission mapping for %s, with no request", async (_name, pair, code) => {
    const { fetchImpl, calls } = fakeFetch();
    expectLocalFault(await rejectionOf(performProviderVerification(googleInput(pair), { fetchImpl })), code);
    expect(calls).toHaveLength(0);
  });

  it("checks in the locked order: dependencies, input shape, admission, credential, then the already-aborted signal", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const aborted = AbortSignal.abort();
    // Dependencies before everything.
    expectLocalFault(await rejectionOf(performProviderVerification(null as unknown as ProviderVerificationInput, deps({ fetchImpl: null }))), "WORKER_CONFIGURATION_INVALID");
    expectLocalFault(await rejectionOf(performProviderVerification(googleInput({ signal: null }), deps({ fetchImpl, deadlineTimer: null }))), "WORKER_CONFIGURATION_INVALID");
    // Input shape before admission.
    expectLocalFault(await rejectionOf(performProviderVerification(googleInput({ provider: "OTHER", signal: null }), { fetchImpl })), "PROVIDER_VERIFICATION_REQUEST_INVALID");
    // Admission before the credential.
    expectLocalFault(await rejectionOf(performProviderVerification(googleInput({ provider: "OTHER", credential: "" }), { fetchImpl })), "PROVIDER_VERIFICATION_PROVIDER_UNSUPPORTED");
    // The credential before the already-aborted signal (which would be returned).
    expectLocalFault(await rejectionOf(performProviderVerification(googleInput({ credential: "", signal: aborted }), { fetchImpl })), "PROVIDER_VERIFICATION_REQUEST_INVALID");
    expect(calls).toHaveLength(0);
  });

  it("reads each input and dependency member exactly once", async () => {
    const reads: Record<string, number> = {};
    const counted = <T extends object>(name: string, source: T) =>
      new Proxy(source, {
        get(target, key, receiver) {
          reads[`${name}.${String(key)}`] = (reads[`${name}.${String(key)}`] ?? 0) + 1;
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
    const { fetchImpl } = fakeFetch();
    const { timer } = manualTimer();
    const caller = new AbortController();
    const result = await performProviderVerification(counted("input", googleInput({ signal: caller.signal })), counted("deps", { fetchImpl, deadlineTimer: timer }));
    expect(result).toEqual(VERIFIED);
    expect(reads).toEqual({
      "deps.fetchImpl": 1,
      "deps.deadlineTimer": 1,
      "input.provider": 1,
      "input.verificationPolicyId": 1,
      "input.credential": 1,
      "input.signal": 1,
    });
  });

  it("treats a throwing input or dependency member as a fault of that argument, with no request", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const throwingInput = Object.defineProperty({ ...googleInput() }, "credential", {
      get: () => {
        throw new Error(CREDENTIAL);
      },
    }) as ProviderVerificationInput;
    expectLocalFault(await rejectionOf(performProviderVerification(throwingInput, { fetchImpl })), "PROVIDER_VERIFICATION_REQUEST_INVALID");
    const throwingDependencies = Object.defineProperty({ fetchImpl }, "deadlineTimer", {
      get: () => {
        throw new Error(CREDENTIAL);
      },
    }) as ProviderVerificationTransportDependencies;
    expectLocalFault(await rejectionOf(performProviderVerification(googleInput(), throwingDependencies)), "WORKER_CONFIGURATION_INVALID");
    expect(calls).toHaveLength(0);
  });
});

describe("caller signal platform brand (R44B11F Phase 6, M1)", () => {
  // A forged signal with observable listener methods, so a listener
  // installation attempt would be counted instead of failing natively.
  function forgedSignal(base: object) {
    const addEventListener = counted(() => undefined);
    const removeEventListener = counted(() => undefined);
    Object.defineProperty(base, "addEventListener", { value: addEventListener });
    Object.defineProperty(base, "removeEventListener", { value: removeEventListener });
    return { signal: base, addEventListener, removeEventListener };
  }

  it.each([
    ["Object.create(AbortSignal.prototype)", () => Object.create(AbortSignal.prototype) as object],
    ["a forged object with an own aborted value", () => Object.defineProperty(Object.create(AbortSignal.prototype) as object, "aborted", { value: false })],
    [
      "a proxy whose prototype lookup throws",
      () =>
        new Proxy(new AbortController().signal, {
          getPrototypeOf() {
            throw new TypeError(`hostile prototype ${CREDENTIAL}`);
          },
        }),
    ],
  ])("A/C. rejects %s as PROVIDER_VERIFICATION_REQUEST_INVALID before any listener, timer or request", async (_name, make) => {
    const forged = forgedSignal(make());
    const { timer, state } = manualTimer();
    const { fetchImpl, calls } = fakeFetch();
    const error = await rejectionOf(performProviderVerification(googleInput({ signal: forged.signal }), { fetchImpl, deadlineTimer: timer }));
    expectLocalFault(error, "PROVIDER_VERIFICATION_REQUEST_INVALID");
    expect((error as Error).message).toBe("The provider verification request is invalid and was not sent.");
    expect([calls.length, state.calls, forged.addEventListener.count, forged.removeEventListener.count]).toEqual([0, 0, 0, 0]);
  });

  // A genuine signal whose own aborted accessor shadows the platform getter.
  function shadowedSignal(get: () => boolean) {
    const caller = observedSignal();
    const reads = counted(get);
    Object.defineProperty(caller.signal, "aborted", { get: reads });
    return { ...caller, reads };
  }

  it("B. ignores a throwing own aborted getter on a genuine, not-aborted signal and proceeds normally", async () => {
    const caller = shadowedSignal(() => {
      throw new Error(`hostile aborted getter ${CREDENTIAL}`);
    });
    const { timer, state } = manualTimer();
    const { fetchImpl, calls } = fakeFetch();
    expect(await performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: caller.timed(timer) })).toEqual(VERIFIED);
    expect([caller.reads.count, calls.length, state.calls, state.cleared, caller.atTimer, caller.active()]).toEqual([0, 1, 1, 1, [1], 0]);
  });

  it("B. follows the platform state of a genuine aborted signal whose own getter claims it is not aborted", async () => {
    const caller = shadowedSignal(() => false);
    caller.controller.abort();
    const { timer, state } = manualTimer();
    const { fetchImpl, calls } = fakeFetch();
    expect(await performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: timer })).toEqual(AMBIGUOUS);
    expect([caller.reads.count, calls.length, state.calls, caller.active()]).toEqual([0, 0, 0, 0]);
  });

  it("B. does not treat a genuine live signal as aborted because its own getter claims so", async () => {
    const caller = shadowedSignal(() => true);
    const { fetchImpl, calls } = fakeFetch();
    expect(await performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl })).toEqual(VERIFIED);
    expect([caller.reads.count, calls.length, caller.active()]).toEqual([0, 1, 0]);
  });

  it("B. re-checks the platform state after listener installation, not the own getter", async () => {
    // A transparent proxy over a genuine signal (the platform accepts it as
    // that signal). Only the platform addEventListener reads the internal
    // new-listener hook, and it does so before the new listener is stored, so
    // the trap aborts the real signal during start step 3a without that
    // listener ever being dispatched: only the post-installation platform
    // re-check can observe the abort.
    const controller = new AbortController();
    const target = controller.signal;
    const reads = counted(() => false);
    Object.defineProperty(target, "aborted", { get: reads });
    let abortedDuringInstall = false;
    const signal = new Proxy(target, {
      get(object, key, receiver) {
        if (typeof key === "symbol" && key.description === "kNewListener" && !abortedDuringInstall) {
          abortedDuringInstall = true;
          controller.abort();
        }
        return Reflect.get(object, key, receiver) as unknown;
      },
    });
    const { timer, state } = manualTimer();
    const { fetchImpl, calls } = fakeFetch();
    expect(await performProviderVerification(googleInput({ signal }), { fetchImpl, deadlineTimer: timer })).toEqual(AMBIGUOUS);
    expect(abortedDuringInstall).toBe(true);
    expect([reads.count, calls.length, state.calls, state.cleared, getEventListeners(target, "abort").length]).toEqual([0, 0, 1, 1, 0]);
  });

  it("A. rejects a forgery that copies the platform abort state but is not an EventTarget receiver", async () => {
    // Copying only the internal abort-state symbol satisfies the aborted
    // getter; the platform EventTarget methods still refuse the receiver.
    const genuine = new AbortController().signal;
    const abortedSymbol = Object.getOwnPropertySymbols(genuine).find((symbol) => symbol.description === "kAborted");
    expect(abortedSymbol).toBeDefined();
    const copied = Object.create(AbortSignal.prototype) as Record<symbol, unknown>;
    copied[abortedSymbol!] = (genuine as unknown as Record<symbol, unknown>)[abortedSymbol!];
    // The forgery does pass the aborted-getter brand check on its own.
    const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;
    expect(Reflect.apply(abortedGetter, copied, [])).toBe(false);
    const forged = forgedSignal(copied);
    const { timer, state } = manualTimer();
    const { fetchImpl, calls } = fakeFetch();
    const error = await rejectionOf(performProviderVerification(googleInput({ signal: forged.signal }), { fetchImpl, deadlineTimer: timer }));
    expectLocalFault(error, "PROVIDER_VERIFICATION_REQUEST_INVALID");
    expect((error as Error).message).toBe("The provider verification request is invalid and was not sent.");
    expect([calls.length, state.calls, forged.addEventListener.count, forged.removeEventListener.count]).toEqual([0, 0, 0, 0]);
  });

  it("A. rejects a forgery that is an EventTarget receiver but carries no platform abort state (the aborted getter decides)", async () => {
    // Copying only the internal event-map symbol satisfies the platform
    // EventTarget methods; the platform aborted getter still refuses the
    // receiver. Only the aborted-getter validation can reject this forgery.
    const genuine = new AbortController().signal;
    const eventsSymbol = Object.getOwnPropertySymbols(genuine).find((symbol) => symbol.description === "kEvents");
    expect(eventsSymbol, "Node internal kEvents symbol must be present").toBeDefined();
    const copied = Object.create(AbortSignal.prototype) as Record<symbol, unknown>;
    copied[eventsSymbol!] = (genuine as unknown as Record<symbol, unknown>)[eventsSymbol!];
    // Preconditions, checked against the platform methods themselves.
    expect(copied instanceof AbortSignal).toBe(true);
    expect(() => Reflect.apply(EventTarget.prototype.removeEventListener, copied, ["abort", () => undefined])).not.toThrow();
    const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;
    expect(() => Reflect.apply(abortedGetter, copied, [])).toThrow(TypeError);
    const forged = forgedSignal(copied);
    const { timer, state } = manualTimer();
    const { fetchImpl, calls } = fakeFetch();
    const error = await rejectionOf(performProviderVerification(googleInput({ signal: forged.signal }), { fetchImpl, deadlineTimer: timer }));
    expectLocalFault(error, "PROVIDER_VERIFICATION_REQUEST_INVALID");
    expect((error as Error).message).toBe("The provider verification request is invalid and was not sent.");
    // No listener reached the shared platform event map, no own method was used, no timer, no request.
    expect([calls.length, state.calls, forged.addEventListener.count, forged.removeEventListener.count, getEventListeners(genuine, "abort").length]).toEqual([0, 0, 0, 0, 0]);
  });

  // A genuine signal whose own listener methods throw and are counted.
  function overriddenListeners() {
    const caller = observedSignal();
    const add = counted(() => {
      throw new TypeError(`hostile addEventListener ${CREDENTIAL}`);
    });
    const remove = counted(() => {
      throw new TypeError(`hostile removeEventListener ${CREDENTIAL}`);
    });
    Object.defineProperty(caller.signal, "addEventListener", { value: add });
    Object.defineProperty(caller.signal, "removeEventListener", { value: remove });
    return { ...caller, add, remove };
  }

  it("installs and removes the caller listener with the platform methods, never the signal's own overrides", async () => {
    const caller = overriddenListeners();
    const { timer, state } = manualTimer();
    const { fetchImpl, calls } = fakeFetch();
    expect(await performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: caller.timed(timer) })).toEqual(VERIFIED);
    expect([caller.add.count, caller.remove.count, calls.length, state.cleared, caller.atTimer, caller.active()]).toEqual([0, 0, 1, 1, [1], 0]);
  });

  it("keeps platform abort semantics on a signal with overridden listener methods: a caller abort during the request is observed", async () => {
    const caller = overriddenListeners();
    const { timer, state } = manualTimer();
    const { fetchImpl, calls } = ignoringFetch();
    const invocation = performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: caller.timed(timer) });
    await flush();
    caller.controller.abort();
    expect(await invocation).toEqual(AMBIGUOUS);
    expect([caller.add.count, caller.remove.count, calls.length, state.cleared, caller.atTimer, caller.active()]).toEqual([0, 0, 1, 1, [1], 0]);
  });
});

describe("credential shape (R44B11F Phase 6)", () => {
  const visible = (length: number) => "!".repeat(length);

  it.each([
    ["empty", ""],
    ["a space", "abc def"],
    ["a leading space", " abc"],
    ["a trailing newline", "abc\n"],
    ["NUL", `abc${String.fromCharCode(0x00)}`],
    ["a tab", `abc${String.fromCharCode(0x09)}`],
    ["a 0x1f control", `abc${String.fromCharCode(0x1f)}`],
    ["DEL", `abc${String.fromCharCode(0x7f)}`],
    ["a Latin-1 letter", `abc${String.fromCharCode(0xe9)}`],
    ["a no-break space", `abc${String.fromCharCode(0xa0)}`],
    ["a full-width exclamation mark", `abc${String.fromCharCode(0xff01)}`],
    ["an astral character", `abc${String.fromCodePoint(0x1f511)}`],
    ["a lone surrogate", `abc${String.fromCharCode(0xd800)}`],
    ["4097 characters", visible(4097)],
    ["not a string", 12345],
    ["a String object", Object("abc")],
  ])("rejects %s with PROVIDER_VERIFICATION_REQUEST_INVALID and no request", async (_name, credential) => {
    const { fetchImpl, calls } = fakeFetch();
    expectLocalFault(await rejectionOf(performProviderVerification(googleInput({ credential }), { fetchImpl })), "PROVIDER_VERIFICATION_REQUEST_INVALID");
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["1 character", "!"],
    ["4096 characters", visible(4096)],
    ["the full visible range", Array.from({ length: 0x7e - 0x21 + 1 }, (_value, index) => String.fromCharCode(0x21 + index)).join("")],
  ])("accepts %s and sends it unchanged", async (_name, credential) => {
    const { fetchImpl, calls } = fakeFetch();
    expect(await performProviderVerification(googleInput({ credential }), { fetchImpl })).toEqual(VERIFIED);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.headers).toEqual({ "x-goog-api-key": credential });
  });
});

describe("optional values: present means not undefined (R44B11F Phase 6)", () => {
  it("treats signal: undefined and deadlineTimer: undefined as absent and uses the default 10000 ms timer", async () => {
    const setSpy = vi.spyOn(globalThis, "setTimeout");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const { fetchImpl, calls } = fakeFetch();
    expect(await performProviderVerification(googleInput({ signal: undefined }), deps({ fetchImpl, deadlineTimer: undefined }))).toEqual(VERIFIED);
    expect(calls).toHaveLength(1);
    const deadlineCalls = setSpy.mock.calls.filter(([, ms]) => ms === PROVIDER_VERIFICATION_TIMEOUT_MS);
    expect(deadlineCalls).toHaveLength(1);
    const handle = setSpy.mock.results[setSpy.mock.calls.indexOf(deadlineCalls[0]!)]?.value as unknown;
    expect(clearSpy).toHaveBeenCalledWith(handle);
  });

  it("fires the default 10000 ms deadline as PROVIDER_TIMEOUT", async () => {
    vi.useFakeTimers();
    const { fetchImpl, calls } = ignoringFetch();
    const invocation = performProviderVerification(googleInput(), { fetchImpl });
    await vi.advanceTimersByTimeAsync(PROVIDER_VERIFICATION_TIMEOUT_MS - 1);
    let settled = false;
    void invocation.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await invocation).toEqual(TIMEOUT);
    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refuses signal: null and deadlineTimer: null", async () => {
    const { fetchImpl, calls } = fakeFetch();
    expectLocalFault(await rejectionOf(performProviderVerification(googleInput({ signal: null }), { fetchImpl })), "PROVIDER_VERIFICATION_REQUEST_INVALID");
    expectLocalFault(await rejectionOf(performProviderVerification(googleInput(), deps({ fetchImpl, deadlineTimer: null }))), "WORKER_CONFIGURATION_INVALID");
    expect(calls).toHaveLength(0);
  });
});

// --- timer installation (F1) -----------------------------------------------------

describe("deadline timer installation matrix A-E (R44B11F Phase 6, F1)", () => {
  type Behaviour = Readonly<{ expireFirst: boolean; result: "THROW" | "NON_FUNCTION" | "VALID" }>;
  async function install(behaviour: Behaviour) {
    const consoleSpies = watchConsole();
    const caller = observedSignal();
    const { fetchImpl, calls } = fakeFetch();
    const cleanup = vi.fn();
    const timer = vi.fn((_ms: number, onExpiry: () => void) => {
      if (behaviour.expireFirst) onExpiry();
      if (behaviour.result === "THROW") throw new Error(`timer failure ${CREDENTIAL}`);
      if (behaviour.result === "NON_FUNCTION") return { cancel: cleanup } as unknown as () => void;
      return cleanup;
    });
    let thrown: unknown = null;
    let result: unknown = null;
    try {
      result = await performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: caller.timed(timer) });
    } catch (error) {
      thrown = error;
    }
    await flush();
    expect(timer).toHaveBeenCalledTimes(1);
    expect(timer.mock.calls[0]?.[0]).toBe(PROVIDER_VERIFICATION_TIMEOUT_MS);
    expect(calls).toHaveLength(0);
    // The caller listener was installed (3a) before the timer call, and removed.
    expect(caller.atTimer).toEqual([1]);
    expect(caller.active()).toBe(0);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(result) ?? "").not.toContain(CREDENTIAL);
    return { thrown, result, cleanup };
  }

  it("A. onExpiry not called, installation throws: WORKER_CONFIGURATION_INVALID, no cause, listener removed", async () => {
    const { thrown, result } = await install({ expireFirst: false, result: "THROW" });
    expectLocalFault(thrown, "WORKER_CONFIGURATION_INVALID");
    expect(result).toBeNull();
  });

  it("B. onExpiry not called, installation returns a non-function: WORKER_CONFIGURATION_INVALID, no cause, listener removed", async () => {
    const { thrown, result, cleanup } = await install({ expireFirst: false, result: "NON_FUNCTION" });
    expectLocalFault(thrown, "WORKER_CONFIGURATION_INVALID");
    expect(result).toBeNull();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("C. onExpiry called synchronously, then installation throws: WORKER_CONFIGURATION_INVALID, the recorded TIMEOUT is not returned", async () => {
    const { thrown, result } = await install({ expireFirst: true, result: "THROW" });
    expectLocalFault(thrown, "WORKER_CONFIGURATION_INVALID");
    expect(result).toBeNull();
  });

  it("D. onExpiry called synchronously, then installation returns a non-function: WORKER_CONFIGURATION_INVALID, no report, the recorded TIMEOUT is not returned", async () => {
    const { thrown, result, cleanup } = await install({ expireFirst: true, result: "NON_FUNCTION" });
    expectLocalFault(thrown, "WORKER_CONFIGURATION_INVALID");
    expect(result).toBeNull();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("E. onExpiry called synchronously, then a valid cleanup: installed, no throw, INCONCLUSIVE / PROVIDER_TIMEOUT, cleanup called", async () => {
    const { thrown, result, cleanup } = await install({ expireFirst: true, result: "VALID" });
    expect(thrown).toBeNull();
    expect(result).toEqual(TIMEOUT);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("calls onExpiry after a failed installation harmlessly: nothing is sent and nothing changes", async () => {
    let late: () => void = () => undefined;
    const { fetchImpl, calls } = fakeFetch();
    const timer = (_ms: number, onExpiry: () => void) => {
      late = onExpiry;
      return null as unknown as () => void;
    };
    expectLocalFault(await rejectionOf(performProviderVerification(googleInput(), { fetchImpl, deadlineTimer: timer })), "WORKER_CONFIGURATION_INVALID");
    expect(() => late()).not.toThrow();
    await flush();
    expect(calls).toHaveLength(0);
  });
});

// --- composition, cancellation and terminality ------------------------------------

describe("deadline and caller-signal composition (R44B11F Phase 6)", () => {
  it("installs the 10000 ms deadline once, covering a stalled response", async () => {
    const { timer, state } = manualTimer();
    const { fetchImpl, calls } = ignoringFetch();
    const invocation = performProviderVerification(googleInput(), { fetchImpl, deadlineTimer: timer });
    await flush();
    expect(state.ms).toEqual([10000]);
    expect(calls).toHaveLength(1);
    state.expire();
    expect(await invocation).toEqual(TIMEOUT);
    expect(state.cleared).toBe(1);
  });

  it("returns an already-aborted caller signal as VERIFICATION_AMBIGUOUS with no listener, timer call or request", async () => {
    const caller = observedSignal();
    caller.controller.abort();
    const { timer, state } = manualTimer();
    const { fetchImpl, calls } = fakeFetch();
    expect(await performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: timer })).toEqual(AMBIGUOUS);
    expect([calls.length, state.calls, caller.active()]).toEqual([0, 0, 0]);
  });

  it("returns CALLER_ABORT, with no request, when the caller aborts during timer installation", async () => {
    const caller = observedSignal();
    const cleanup = vi.fn();
    const timer = () => {
      caller.controller.abort();
      return cleanup;
    };
    const { fetchImpl, calls } = fakeFetch();
    expect(await performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: timer })).toEqual(AMBIGUOUS);
    expect(calls).toHaveLength(0);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(caller.active()).toBe(0);
  });

  it.each([
    ["during the request", "REQUEST"],
    ["during the body read", "BODY"],
  ] as const)("distinguishes timeout from caller abort %s: the first cause wins", async (_name, stage) => {
    for (const order of [
      ["TIMEOUT", "ABORT"],
      ["ABORT", "TIMEOUT"],
    ] as const) {
      const caller = observedSignal();
      const { timer, state } = manualTimer();
      const stalled = controlledBody();
      const { fetchImpl, calls } = stage === "REQUEST" ? ignoringFetch() : fakeFetch(() => fakeResponse(200, stalled.body));
      const invocation = performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: timer });
      await flush();
      if (stage === "BODY") expect(stalled.reader.read.count).toBe(1);
      for (const trigger of order) {
        if (trigger === "TIMEOUT") state.expire();
        else caller.controller.abort();
      }
      expect(await invocation).toEqual(order[0] === "TIMEOUT" ? TIMEOUT : AMBIGUOUS);
      expect(calls).toHaveLength(1);
      expect([state.cleared, caller.active()]).toEqual([1, 0]);
    }
  });

  it("hands fetchImpl the transport-owned internal signal, never the caller signal; a caller abort aborts it", async () => {
    const caller = observedSignal();
    const { timer, state } = manualTimer();
    const { fetchImpl, calls } = ignoringFetch();
    const invocation = performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: timer });
    await flush();
    expect(calls).toHaveLength(1);
    const internal = calls[0]?.init?.signal;
    expect(internal).toBeInstanceOf(AbortSignal);
    expect(internal).not.toBe(caller.signal);
    expect(internal?.aborted).toBe(false);
    caller.controller.abort();
    expect(internal?.aborted).toBe(true);
    expect(await invocation).toEqual(AMBIGUOUS);
    await flush();
    expect([calls.length, state.cleared, caller.active()]).toEqual([1, 1, 0]);
  });

  it("aborts the internal fetch signal on the provider deadline while the caller signal stays un-aborted", async () => {
    const caller = observedSignal();
    const { timer, state } = manualTimer();
    const { fetchImpl, calls } = ignoringFetch();
    const invocation = performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: timer });
    await flush();
    const internal = calls[0]?.init?.signal;
    expect(internal).toBeInstanceOf(AbortSignal);
    expect(internal).not.toBe(caller.signal);
    expect(internal?.aborted).toBe(false);
    state.expire();
    expect(internal?.aborted).toBe(true);
    expect(caller.signal.aborted).toBe(false);
    expect(await invocation).toEqual(TIMEOUT);
    await flush();
    expect(caller.signal.aborted).toBe(false);
    expect([calls.length, state.cleared, caller.active()]).toEqual([1, 1, 0]);
  });

  it("aborts the internal signal handed to fetchImpl when a cause is recorded, and only then", async () => {
    const { timer, state } = manualTimer();
    const { fetchImpl, calls } = ignoringFetch();
    const invocation = performProviderVerification(googleInput(), { fetchImpl, deadlineTimer: timer });
    await flush();
    const internal = calls[0]?.init?.signal;
    expect(internal?.aborted).toBe(false);
    state.expire();
    expect(internal?.aborted).toBe(true);
    expect(await invocation).toEqual(TIMEOUT);
  });
});

describe("signal-independent cancellation (R44B11F Phase 6)", () => {
  it.each([
    ["fetchImpl never settles; the internal deadline fires", "REQUEST", "TIMEOUT"],
    ["fetchImpl never settles; the caller aborts", "REQUEST", "ABORT"],
    ["a body read never settles; the internal deadline fires", "BODY", "TIMEOUT"],
    ["a body read never settles; the caller aborts", "BODY", "ABORT"],
  ] as const)("%s", async (_name, stage, trigger) => {
    const watch = watchUnhandledRejections();
    try {
      const caller = observedSignal();
      const { timer, state } = manualTimer();
      const stalled = controlledBody();
      const request = ignoringFetch();
      const answered = fakeFetch(() => fakeResponse(200, stalled.body));
      const { fetchImpl, calls } = stage === "REQUEST" ? request : answered;
      const invocation = performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: timer });
      await flush();
      if (trigger === "TIMEOUT") state.expire();
      else caller.controller.abort();
      expect(await invocation).toEqual(trigger === "TIMEOUT" ? TIMEOUT : AMBIGUOUS);
      expect(calls).toHaveLength(1);
      expect([state.cleared, caller.active()]).toEqual([1, 0]);
      if (stage === "BODY") expect(stalled.reader.cancel.count).toBe(1);
      // A late settlement or rejection of the abandoned wait is ignored.
      if (stage === "REQUEST") request.pending.reject(new Error(`late failure ${CREDENTIAL}`));
      else stalled.reads[0]?.reject(new Error(`late failure ${CREDENTIAL}`));
      await flush();
      expect(watch.seen).toEqual([]);
      expect(calls).toHaveLength(1);
    } finally {
      watch.stop();
    }
  });

  it("ignores a late successful response after the deadline", async () => {
    const watch = watchUnhandledRejections();
    try {
      const { timer, state } = manualTimer();
      const { fetchImpl, calls, pending } = ignoringFetch();
      const invocation = performProviderVerification(googleInput(), { fetchImpl, deadlineTimer: timer });
      await flush();
      state.expire();
      expect(await invocation).toEqual(TIMEOUT);
      pending.resolve(fakeResponse(200));
      await flush();
      expect(watch.seen).toEqual([]);
      expect(calls).toHaveLength(1);
    } finally {
      watch.stop();
    }
  });

  it("ignores a late body chunk after the caller abort", async () => {
    const caller = observedSignal();
    const stalled = controlledBody();
    const { fetchImpl } = fakeFetch(() => fakeResponse(200, stalled.body));
    const invocation = performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl });
    await flush();
    caller.controller.abort();
    expect(await invocation).toEqual(AMBIGUOUS);
    stalled.reads[0]?.resolve({ done: false, value: encoder.encode("{}") });
    await flush();
    expect(stalled.reader.read.count).toBe(1);
  });
});

describe("terminal outcomes are final (R44B11F Phase 6)", () => {
  // The timer cleanup runs once the terminal raw outcome is established; this
  // one fires the deadline and the caller abort from inside it.
  function lateCancellation() {
    const caller = observedSignal();
    let fire: () => void = () => undefined;
    const timer: ProviderVerificationDeadlineTimer = (_ms, onExpiry) => {
      fire = () => {
        onExpiry();
        caller.controller.abort();
      };
      return () => fire();
    };
    return { caller, timer };
  }

  it.each([
    ["a completed RESPONSE", () => fakeResponse(200), VERIFIED],
    ["a completed RESPONSE with an error status", () => fakeResponse(503, okBody("")), UNAVAILABLE],
    ["a declared BODY_TOO_LARGE", () => fakeResponse(200, okBody(), { "content-length": "65537" }), TOO_LARGE],
    ["a streamed BODY_TOO_LARGE", () => fakeResponse(200, streamOf(new Uint8Array(PROVIDER_VERIFICATION_RESPONSE_MAX_BYTES + 1))), TOO_LARGE],
    [
      "a NETWORK_FAILURE",
      () => {
        throw new TypeError("fetch failed");
      },
      NETWORK,
    ],
    ["a NETWORK_FAILURE from a non-response", () => ({ status: 700 }), NETWORK],
  ] as const)("keeps %s when the deadline and the caller abort fire afterwards", async (_name, answer, expected) => {
    const { caller, timer } = lateCancellation();
    const { fetchImpl, calls } = fakeFetch(answer);
    expect(await performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: timer })).toEqual(expected);
    expect(caller.controller.signal.aborted).toBe(true);
    expect(calls).toHaveLength(1);
    expect(caller.active()).toBe(0);
  });

  it("keeps the selected outcome when a trigger fires after the invocation has returned", async () => {
    const caller = observedSignal();
    const { timer, state } = manualTimer();
    const { fetchImpl, calls } = fakeFetch();
    const result = await performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: timer });
    expect(() => state.expire()).not.toThrow();
    caller.controller.abort();
    await flush();
    expect(result).toEqual(VERIFIED);
    expect([calls.length, state.cleared, caller.active()]).toEqual([1, 1, 0]);
  });
});

// --- cleanup ----------------------------------------------------------------------

describe("cleanup on every terminal path (R44B11F Phase 6)", () => {
  it.each([
    ["RESPONSE", () => fakeResponse(200), VERIFIED, null],
    ["BODY_TOO_LARGE", () => fakeResponse(200, okBody(), { "content-length": "99999" }), TOO_LARGE, null],
    ["NETWORK_FAILURE", () => Promise.reject(new TypeError("fetch failed")), NETWORK, null],
    ["TIMEOUT", () => new Promise(() => undefined), TIMEOUT, "TIMEOUT"],
    ["CALLER_ABORT", () => new Promise(() => undefined), AMBIGUOUS, "ABORT"],
  ] as const)("cancels the deadline once and removes the caller listener on %s", async (_name, answer, expected, trigger) => {
    const caller = observedSignal();
    const { timer, state } = manualTimer();
    const { fetchImpl } = fakeFetch(answer);
    const invocation = performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: caller.timed(timer) });
    await flush();
    if (trigger === "TIMEOUT") state.expire();
    if (trigger === "ABORT") caller.controller.abort();
    expect(await invocation).toEqual(expected);
    expect(state.cleared).toBe(1);
    // Installed once before the deadline, and no listener remains afterwards.
    expect(caller.atTimer).toEqual([1]);
    expect(caller.active()).toBe(0);
  });

  it("swallows a throwing timer cleanup: the outcome stands, nothing escapes, no retry", async () => {
    const watch = watchUnhandledRejections();
    try {
      const caller = observedSignal();
      const { timer, state } = manualTimer(() => {
        throw new Error(`cleanup failure ${CREDENTIAL}`);
      });
      const { fetchImpl, calls } = fakeFetch();
      expect(await performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: timer })).toEqual(VERIFIED);
      expect([state.cleared, calls.length, caller.active()]).toEqual([1, 1, 0]);
      await flush();
      expect(watch.seen).toEqual([]);
    } finally {
      watch.stop();
    }
  });

  it.each([
    [
      "throws synchronously",
      () => {
        throw new Error(`cancel failure ${CREDENTIAL}`);
      },
    ],
    ["returns a rejecting promise", () => Promise.reject(new Error(`cancel failure ${CREDENTIAL}`))],
    ["returns a thenable whose then throws", () => ({ then: () => { throw new Error("then failure"); } })],
  ])("swallows a stream cancellation that %s, on oversize, timeout and caller abort", async (_name, cancel) => {
    const consoleSpies = watchConsole();
    const watch = watchUnhandledRejections();
    try {
      // Streamed oversize.
      const big = chunkedBody([new Uint8Array(PROVIDER_VERIFICATION_RESPONSE_MAX_BYTES), new Uint8Array(1), new Uint8Array(1)], cancel);
      const oversize = fakeFetch(() => fakeResponse(200, big.body));
      expect(await performProviderVerification(googleInput(), { fetchImpl: oversize.fetchImpl })).toEqual(TOO_LARGE);
      expect(big.reader.cancel.count).toBe(1);
      expect(oversize.calls).toHaveLength(1);
      // Declared oversize: the unread body itself is cancelled.
      const declared = chunkedBody([encoder.encode("{}")], cancel);
      expect(await performProviderVerification(googleInput(), { fetchImpl: fakeFetch(() => fakeResponse(200, declared.body, { "content-length": "65537" })).fetchImpl })).toEqual(TOO_LARGE);
      expect(declared.body.cancel.count).toBe(1);
      expect(declared.body.getReader.count).toBe(0);
      // Cancellation during a stalled read.
      for (const trigger of ["TIMEOUT", "ABORT"] as const) {
        const caller = observedSignal();
        const { timer, state } = manualTimer();
        const stalled = controlledBody(cancel);
        const { fetchImpl, calls } = fakeFetch(() => fakeResponse(200, stalled.body));
        const invocation = performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: timer });
        await flush();
        if (trigger === "TIMEOUT") state.expire();
        else caller.controller.abort();
        expect(await invocation).toEqual(trigger === "TIMEOUT" ? TIMEOUT : AMBIGUOUS);
        expect(stalled.reader.cancel.count).toBe(1);
        expect(calls).toHaveLength(1);
      }
      await flush();
      expect(watch.seen).toEqual([]);
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    } finally {
      watch.stop();
    }
  });
});

// --- body bound -------------------------------------------------------------------

describe("response body bound (R44B11F Phase 6)", () => {
  const padded = (length: number) => encoder.encode(`{}${" ".repeat(length - 2)}`);

  it("accepts exactly 65536 bytes, in one chunk or several", async () => {
    for (const chunks of [[padded(65536)], [padded(65536).subarray(0, 40000), padded(65536).subarray(40000)]]) {
      const { fetchImpl } = fakeFetch(() => fakeResponse(200, streamOf(...chunks), { "content-length": "65536" }));
      expect(await performProviderVerification(googleInput(), { fetchImpl })).toEqual(VERIFIED);
    }
  });

  it("stops at 65536 + 1 streamed bytes and cancels the stream, for every status", async () => {
    for (const status of [200, 401, 404, 500]) {
      const big = chunkedBody([new Uint8Array(65536), new Uint8Array(1), new Uint8Array(10)]);
      const { fetchImpl } = fakeFetch(() => fakeResponse(status, big.body));
      expect(await performProviderVerification(googleInput(), { fetchImpl })).toEqual(TOO_LARGE);
      expect(big.reader.read.count).toBe(2);
      expect(big.reader.cancel.count).toBe(1);
    }
  });

  it("refuses a canonical declared length above 65536 unread, for every status", async () => {
    for (const [status, declared] of [
      [200, "65537"],
      [302, "1000000"],
      [403, "99999999999999999999999"],
    ] as const) {
      const body = chunkedBody([encoder.encode("{}")]);
      const { fetchImpl } = fakeFetch(() => fakeResponse(status, body.body, { "content-length": declared }));
      expect(await performProviderVerification(googleInput(), { fetchImpl })).toEqual(TOO_LARGE);
      expect(body.body.getReader.count).toBe(0);
      expect(body.body.cancel.count).toBe(1);
    }
  });

  // A raw headers object, so no Headers normalisation (trimming, value
  // validation) hides the exact declared text from the transport.
  const declaring = (declared: string) => ({ get: (name: string) => (name === "content-length" ? declared : null) });
  const nonCanonical = ["065537", "+70000", " 70000", "70000 ", "7e4", "70000.0", "0x11171", "70000, 70000", "-70000", "-1", "abc", "", `${String.fromCharCode(0xff11)}00000`];

  it.each(nonCanonical)("ignores the non-canonical declared length %j and counts the streamed bytes", async (declared) => {
    const small = chunkedBody([encoder.encode("{}")]);
    const smallFetch = fakeFetch(() => ({ status: 200, headers: declaring(declared), body: small.body }));
    expect(await performProviderVerification(googleInput(), { fetchImpl: smallFetch.fetchImpl })).toEqual(VERIFIED);
    expect(small.body.getReader.count).toBe(1);
    expect(small.body.cancel.count).toBe(0);
    const big = chunkedBody([new Uint8Array(65537)]);
    const bigFetch = fakeFetch(() => ({ status: 200, headers: declaring(declared), body: big.body }));
    expect(await performProviderVerification(googleInput(), { fetchImpl: bigFetch.fetchImpl })).toEqual(TOO_LARGE);
  });

  it("uses a canonical declared length, including through real Headers", async () => {
    const raw = chunkedBody([encoder.encode("{}")]);
    expect(await performProviderVerification(googleInput(), { fetchImpl: fakeFetch(() => ({ status: 200, headers: declaring("65537"), body: raw.body })).fetchImpl })).toEqual(TOO_LARGE);
    const real = chunkedBody([encoder.encode("{}")]);
    expect(await performProviderVerification(googleInput(), { fetchImpl: fakeFetch(() => fakeResponse(200, real.body, { "content-length": "65537" })).fetchImpl })).toEqual(TOO_LARGE);
    const exact = chunkedBody([encoder.encode("{}")]);
    expect(await performProviderVerification(googleInput(), { fetchImpl: fakeFetch(() => ({ status: 200, headers: declaring("65536"), body: exact.body })).fetchImpl })).toEqual(VERIFIED);
  });

  it("counts the streamed bytes even under a small canonical declared length", async () => {
    const big = chunkedBody([new Uint8Array(40000), new Uint8Array(40000)]);
    const { fetchImpl } = fakeFetch(() => fakeResponse(200, big.body, { "content-length": "2" }));
    expect(await performProviderVerification(googleInput(), { fetchImpl })).toEqual(TOO_LARGE);
  });

  it("treats a null or missing body as an empty body", async () => {
    for (const body of [null, undefined]) {
      const answer = (status: number) => () => ({ status, headers: new Headers(), body });
      expect(await performProviderVerification(googleInput(), { fetchImpl: fakeFetch(answer(200)).fetchImpl })).toEqual(MALFORMED);
      expect(await performProviderVerification(googleInput(), { fetchImpl: fakeFetch(answer(404)).fetchImpl })).toEqual(DRIFT);
    }
    // A response object with no body member at all.
    expect(await performProviderVerification(googleInput(), { fetchImpl: fakeFetch(() => ({ status: 410, headers: new Headers() })).fetchImpl })).toEqual(DRIFT);
  });

  it("reads a real Response through its stream", async () => {
    const response = new Response(JSON.stringify({ models: [] }), { status: 200 });
    const json = vi.spyOn(response, "json");
    const text = vi.spyOn(response, "text");
    const arrayBuffer = vi.spyOn(response, "arrayBuffer");
    expect(await performProviderVerification(googleInput(), { fetchImpl: fakeFetch(() => response).fetchImpl })).toEqual(VERIFIED);
    expect([json, text, arrayBuffer].map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);
  });
});

// --- network hardening (M2) -----------------------------------------------------------

describe("non-response and invalid-status hardening (R44B11F Phase 6, M2)", () => {
  const throwing = (member: string) =>
    Object.defineProperty({ status: 200, headers: new Headers(), body: null }, member, {
      get: () => {
        throw new Error("accessor failure");
      },
    });
  it.each([
    ["null", () => null],
    ["undefined", () => undefined],
    ["a number", () => 200],
    ["a string", () => "200 OK"],
    ["an empty object", () => ({})],
    ["a status without headers", () => ({ status: 200, body: null })],
    ["headers without get()", () => ({ status: 200, headers: {}, body: null })],
    ["status 600", () => fakeResponse(600)],
    ["status 1000", () => fakeResponse(1000)],
    ["status -1", () => fakeResponse(-1)],
    ["status 200.5", () => fakeResponse(200.5)],
    ["status NaN", () => fakeResponse(Number.NaN)],
    ["status Infinity", () => fakeResponse(Number.POSITIVE_INFINITY)],
    ["status as a string", () => fakeResponse("200" as unknown as number)],
    ["a body without getReader()", () => fakeResponse(200, { cancel: () => undefined })],
    ["a body that is a string", () => fakeResponse(200, "{}")],
    ["a throwing status accessor", () => throwing("status")],
    ["a throwing headers accessor", () => throwing("headers")],
    ["a throwing headers.get()", () => ({ status: 200, headers: { get: () => { throw new Error("x"); } }, body: null })],
    ["a throwing getReader()", () => fakeResponse(200, { getReader: () => { throw new Error("x"); } })],
    ["a reader without read()", () => fakeResponse(200, { getReader: () => ({}) })],
    ["a throwing read()", () => fakeResponse(200, { getReader: () => ({ read: () => { throw new Error("x"); } }) })],
    ["a rejecting read()", () => fakeResponse(200, { getReader: () => ({ read: () => Promise.reject(new Error("reset")) }) })],
    ["a non-object read result", () => fakeResponse(200, { getReader: () => ({ read: async () => 7 }) })],
    ["a string chunk", () => fakeResponse(200, chunkedBody(["{}"]).body)],
    ["an ArrayBuffer chunk", () => fakeResponse(200, chunkedBody([new ArrayBuffer(2)]).body)],
  ])("maps a fulfilled value with %s to NETWORK_FAILURE (PROVIDER_NETWORK_FAILURE), never MALFORMED", async (_name, answer) => {
    const { fetchImpl, calls } = fakeFetch(answer);
    const result = await performProviderVerification(googleInput(), { fetchImpl });
    expect(result).toEqual(NETWORK);
    expect(calls).toHaveLength(1);
  });

  it("maps a synchronous fetchImpl throw and a rejection to NETWORK_FAILURE", async () => {
    for (const answer of [
      () => {
        throw new TypeError(`fetch failed ${CREDENTIAL}`);
      },
      () => Promise.reject(new TypeError(`fetch failed ${CREDENTIAL}`)),
    ]) {
      const { fetchImpl, calls } = fakeFetch(answer);
      expect(await performProviderVerification(googleInput(), { fetchImpl })).toEqual(NETWORK);
      expect(calls).toHaveLength(1);
    }
  });

  it("accepts every status from 0 to 599 as a response", async () => {
    for (const [status, expected] of [
      [0, DRIFT],
      [599, UNAVAILABLE],
      [429, RATE],
    ] as const) {
      expect(await performProviderVerification(googleInput(), { fetchImpl: fakeFetch(() => fakeResponse(status, null)).fetchImpl })).toEqual(expected);
    }
  });
});

// --- one request, no retry, secrecy -----------------------------------------------------

describe("one request, no retry, no secret exposure (R44B11F Phase 6)", () => {
  it("sends exactly one request for every outcome and never retries", async () => {
    for (const answer of [
      () => fakeResponse(200),
      () => fakeResponse(500, null),
      () => fakeResponse(429, null),
      () => fakeResponse(302, null),
      () => Promise.reject(new TypeError("fetch failed")),
      () => null,
      () => fakeResponse(200, okBody(), { "content-length": "70000" }),
    ]) {
      const { fetchImpl, calls } = fakeFetch(answer);
      await performProviderVerification(googleInput(), { fetchImpl });
      await flush();
      expect(calls).toHaveLength(1);
    }
    const { timer, state } = manualTimer();
    const stalled = ignoringFetch();
    const invocation = performProviderVerification(googleInput(), { fetchImpl: stalled.fetchImpl, deadlineTimer: timer });
    await flush();
    state.expire();
    await invocation;
    await flush();
    expect(stalled.calls).toHaveLength(1);
  });

  it("dispatches each admitted pair to its own fixed request with redirect manual", async () => {
    for (const [provider, verificationPolicyId, url] of [
      [GOOGLE_PROVIDER_ID, GOOGLE_POLICY, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1"],
      [RUNWAY_PROVIDER_ID, RUNWAY_POLICY, "https://api.dev.runwayml.com/v1/organization"],
    ] as const) {
      const { fetchImpl, calls } = fakeFetch();
      expect(await performProviderVerification({ provider, verificationPolicyId, credential: CREDENTIAL }, { fetchImpl })).toEqual(VERIFIED);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe(url);
      expect(calls[0]?.init?.redirect).toBe("manual");
      expect(calls[0]?.init?.method).toBe("GET");
      expect(calls[0]?.init && "body" in calls[0].init).toBe(false);
    }
  });

  it("returns only a frozen report: no raw outcome, status, header, body or request", async () => {
    const { fetchImpl } = fakeFetch(() => fakeResponse(503, okBody(`{"leak":"${CREDENTIAL}"}`), { "x-request-id": "abc" }));
    const result = await performProviderVerification(googleInput(), { fetchImpl });
    expect(result).toEqual(UNAVAILABLE);
    expect(Object.keys(result).sort()).toEqual(["outcome", "reasonCode"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(isProviderVerificationResultReport(result)).toBe(true);
  });

  it("keeps the credential out of every report, error, serialization and console output", async () => {
    const consoleSpies = watchConsole();
    const outputs: unknown[] = [];
    for (const answer of [
      () => fakeResponse(200, okBody(`{"models":[],"echo":"${CREDENTIAL}"}`)),
      () => fakeResponse(401, okBody(`{"error":{"status":"UNAUTHENTICATED","message":"${CREDENTIAL}"}}`)),
      () => Promise.reject(new Error(CREDENTIAL)),
      () => {
        throw new Error(CREDENTIAL);
      },
    ]) {
      outputs.push(await performProviderVerification(googleInput(), { fetchImpl: fakeFetch(answer).fetchImpl }));
    }
    const timer = () => {
      throw new Error(CREDENTIAL);
    };
    outputs.push(await rejectionOf(performProviderVerification(googleInput(), { fetchImpl: fakeFetch().fetchImpl, deadlineTimer: timer })));
    outputs.push(await rejectionOf(performProviderVerification(googleInput({ provider: "OTHER" }), { fetchImpl: fakeFetch().fetchImpl })));
    for (const output of outputs) {
      expect(JSON.stringify(output)).not.toContain(CREDENTIAL);
      expect(String(output)).not.toContain(CREDENTIAL);
      if (output instanceof Error) expect(output.stack ?? "").not.toContain(CREDENTIAL);
    }
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});

// --- late response body cleanup (R1) ----------------------------------------------------

describe("late fulfilled response after the window ended (R44B11F Phase 6, R1)", () => {
  // A response body whose cancel is observed with a plain counter (never vi.fn,
  // which would observe a rejected cancel promise itself).
  function lateResponse(cancel: () => unknown = () => Promise.resolve()) {
    const body = { getReader: counted(() => ({ read: () => new Promise(() => undefined) })), cancel: counted(cancel) };
    return { response: { status: 200, headers: new Headers(), body }, body };
  }

  it.each([
    ["A. TIMEOUT wins, then fetchImpl resolves", "TIMEOUT"],
    ["B. CALLER_ABORT wins, then fetchImpl resolves", "ABORT"],
  ] as const)("%s: the late body is cancelled exactly once and the outcome stays final", async (_name, trigger) => {
    const watch = watchUnhandledRejections();
    const consoleSpies = watchConsole();
    try {
      const caller = observedSignal();
      const { timer, state } = manualTimer();
      const { fetchImpl, calls, pending } = ignoringFetch();
      const invocation = performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: timer });
      await flush();
      if (trigger === "TIMEOUT") state.expire();
      else caller.controller.abort();
      const result = await invocation;
      expect(result).toEqual(trigger === "TIMEOUT" ? TIMEOUT : AMBIGUOUS);
      const late = lateResponse();
      pending.resolve(late.response);
      await flush();
      expect(late.body.cancel.count).toBe(1);
      expect(late.body.getReader.count).toBe(0);
      expect(result).toEqual(trigger === "TIMEOUT" ? TIMEOUT : AMBIGUOUS);
      expect([calls.length, state.cleared, caller.active()]).toEqual([1, 1, 0]);
      expect(watch.seen).toEqual([]);
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    } finally {
      watch.stop();
    }
  });

  it.each([
    [
      "C. throws synchronously",
      () => {
        throw new Error(`late cancel failure ${CREDENTIAL}`);
      },
    ],
    ["D. returns a rejecting promise", () => Promise.reject(new Error(`late cancel failure ${CREDENTIAL}`))],
  ])("swallows a late body cancel that %s: nothing escapes, no unhandled rejection, no second request", async (_name, cancel) => {
    const watch = watchUnhandledRejections();
    try {
      for (const trigger of ["TIMEOUT", "ABORT"] as const) {
        const caller = observedSignal();
        const { timer, state } = manualTimer();
        const { fetchImpl, calls, pending } = ignoringFetch();
        const invocation = performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: timer });
        await flush();
        if (trigger === "TIMEOUT") state.expire();
        else caller.controller.abort();
        expect(await invocation).toEqual(trigger === "TIMEOUT" ? TIMEOUT : AMBIGUOUS);
        const late = lateResponse(cancel);
        pending.resolve(late.response);
        await flush();
        expect(late.body.cancel.count).toBe(1);
        expect(calls).toHaveLength(1);
      }
      expect(watch.seen).toEqual([]);
    } finally {
      watch.stop();
    }
  });

  it("cancels the body of a response that is already available when the caller aborts inside fetchImpl", async () => {
    const watch = watchUnhandledRejections();
    try {
      const caller = observedSignal();
      const { timer, state } = manualTimer();
      const late = lateResponse(() => Promise.reject(new Error("late cancel failure")));
      const { fetchImpl, calls } = fakeFetch(() => {
        caller.controller.abort();
        return Promise.resolve(late.response);
      });
      expect(await performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: timer })).toEqual(AMBIGUOUS);
      await flush();
      expect(late.body.cancel.count).toBe(1);
      expect(late.body.getReader.count).toBe(0);
      expect([calls.length, state.cleared, caller.active()]).toEqual([1, 1, 0]);
      expect(watch.seen).toEqual([]);
    } finally {
      watch.stop();
    }
  });
});

// --- defensive chunk handling (R2) ---------------------------------------------------------

describe("defensive body-chunk handling after the request was sent (R44B11F Phase 6, R2)", () => {
  // Uint8Array subclasses whose byteLength accessor misreports.
  const misreporting = (get: () => number) => {
    class Misreporting extends Uint8Array {}
    Object.defineProperty(Misreporting.prototype, "byteLength", { get });
    return Misreporting;
  };
  const ReportsZero = misreporting(() => 0);
  const ReportsHuge = misreporting(() => 10 ** 9);
  const ThrowsOnByteLength = misreporting(() => {
    throw new Error("instance byteLength must not be consulted");
  });

  it("A. a chunk that under-reports its byteLength cannot bypass the 65536-byte bound", async () => {
    for (const chunks of [[new ReportsZero(PROVIDER_VERIFICATION_RESPONSE_MAX_BYTES + 1)], [new ReportsZero(40000), new ReportsZero(40000)]]) {
      const big = chunkedBody(chunks);
      const { fetchImpl, calls } = fakeFetch(() => fakeResponse(200, big.body));
      expect(await performProviderVerification(googleInput(), { fetchImpl })).toEqual(TOO_LARGE);
      expect(big.reader.cancel.count).toBe(1);
      expect(calls).toHaveLength(1);
    }
  });

  it("B. the byte count comes from the intrinsic typed-array length, never the instance accessor", async () => {
    for (const make of [(bytes: Uint8Array) => new ReportsHuge(bytes), (bytes: Uint8Array) => new ThrowsOnByteLength(bytes)]) {
      const small = chunkedBody([make(encoder.encode('{"models":[]}'))]);
      const { fetchImpl } = fakeFetch(() => fakeResponse(200, small.body));
      expect(await performProviderVerification(googleInput(), { fetchImpl })).toEqual(VERIFIED);
      expect(small.reader.cancel.count).toBe(0);
    }
    // Exactly 65536 intrinsic bytes are still accepted through a misreporting subclass.
    const exact = new ReportsHuge(PROVIDER_VERIFICATION_RESPONSE_MAX_BYTES);
    exact.set(encoder.encode("{}"));
    exact.fill(0x20, 2);
    expect(await performProviderVerification(googleInput(), { fetchImpl: fakeFetch(() => fakeResponse(200, chunkedBody([exact]).body)).fetchImpl })).toEqual(VERIFIED);
  });

  // Chunks that make post-send body processing throw: a proxy whose prototype
  // lookup throws (instanceof), and a proxy around a real Uint8Array that
  // passes instanceof but is not a typed array for the intrinsic getter.
  const hostileChunks = () => [
    [
      "a chunk whose prototype lookup throws",
      new Proxy(new Uint8Array(2), {
        getPrototypeOf() {
          throw new RangeError(`hostile chunk ${CREDENTIAL}`);
        },
      }),
    ],
    ["a proxied chunk that is not a typed array", new Proxy(new Uint8Array(2), {})],
  ] as const;

  it("C. maps an unexpected post-send processing exception to PROVIDER_NETWORK_FAILURE with full cleanup and no second request", async () => {
    for (const [name, chunk] of hostileChunks()) {
      const watch = watchUnhandledRejections();
      const consoleSpies = watchConsole();
      try {
        const caller = observedSignal();
        const { timer, state } = manualTimer();
        const hostile = chunkedBody([chunk]);
        const { fetchImpl, calls } = fakeFetch(() => fakeResponse(200, hostile.body));
        let thrown: unknown = null;
        const result = await performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: timer }).catch((error: unknown) => {
          thrown = error;
          return null;
        });
        expect(thrown, name).toBeNull();
        expect(result, name).toEqual(NETWORK);
        expect([calls.length, state.cleared, caller.active()], name).toEqual([1, 1, 0]);
        expect(hostile.reader.cancel.count, name).toBe(1);
        await flush();
        expect(calls).toHaveLength(1);
        expect(watch.seen).toEqual([]);
        expect(JSON.stringify(result)).not.toContain(CREDENTIAL);
        for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
      } finally {
        watch.stop();
        vi.restoreAllMocks();
      }
    }
  });

  it("C. keeps a cause recorded before the post-send exception instead of NETWORK_FAILURE", async () => {
    const caller = observedSignal();
    const { timer, state } = manualTimer();
    const chunk = new Proxy(new Uint8Array(2), {
      getPrototypeOf() {
        caller.controller.abort();
        throw new RangeError("hostile chunk");
      },
    });
    const hostile = chunkedBody([chunk]);
    const { fetchImpl, calls } = fakeFetch(() => fakeResponse(200, hostile.body));
    expect(await performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: timer })).toEqual(AMBIGUOUS);
    expect([calls.length, state.cleared, caller.active()]).toEqual([1, 1, 0]);
    expect(hostile.reader.cancel.count).toBe(1);
  });

  it("D. a TIMEOUT or CALLER_ABORT that already won stays final when a malformed chunk settles late", async () => {
    for (const trigger of ["TIMEOUT", "ABORT"] as const) {
      for (const [name, chunk] of hostileChunks()) {
        const watch = watchUnhandledRejections();
        try {
          const caller = observedSignal();
          const { timer, state } = manualTimer();
          const stalled = controlledBody();
          const { fetchImpl, calls } = fakeFetch(() => fakeResponse(200, stalled.body));
          const invocation = performProviderVerification(googleInput({ signal: caller.signal }), { fetchImpl, deadlineTimer: timer });
          await flush();
          if (trigger === "TIMEOUT") state.expire();
          else caller.controller.abort();
          const result = await invocation;
          stalled.reads[0]?.resolve({ done: false, value: chunk });
          await flush();
          expect(result, name).toEqual(trigger === "TIMEOUT" ? TIMEOUT : AMBIGUOUS);
          expect([calls.length, state.cleared, caller.active(), stalled.reader.read.count, stalled.reader.cancel.count], name).toEqual([1, 1, 0, 1, 1]);
          expect(watch.seen).toEqual([]);
        } finally {
          watch.stop();
        }
      }
    }
  });
});

// --- credential integration --------------------------------------------------------------

describe("credential integration through the real Phase 5 capability (R44B11F Phase 6)", () => {
  it("receives only the plaintext inside openOnceFor's use callback; the opener is called once and no capability reaches the transport", async () => {
    const key = generateTestKey("worker-verification-transport/v1");
    const sealer = createTestCredentialSealer(key);
    const realOpener = createTestCredentialOpener(key);
    const plaintext = `fixture-plaintext-${randomBytes(18).toString("hex")}`;
    const context = { accountId: randomUUID(), providerConnectionId: randomUUID(), provider: GOOGLE_PROVIDER_ID, credentialVersion: 1, purpose: "provider-credential" as const };
    const sealedEnvelope = await sealer.seal(plaintext, context);
    const job = randomUUID();
    const leaseToken = randomBytes(32).toString("base64url");
    const leaseBody = {
      lease: { providerVerificationJobId: job, provider: GOOGLE_PROVIDER_ID, verificationPolicyId: GOOGLE_POLICY, leaseToken, fencingCounter: 4, leaseExpiresAt: "2026-11-23T10:00:30.000Z" },
    };
    const grantBody = { providerVerificationJobId: job, fencingCounter: 4, credentialGrantedAt: "2026-11-23T10:00:01.000Z", credential: { sealedEnvelope, openingContext: context } };
    const verifyingBody = { providerVerificationJobId: job, fencingCounter: 4, state: "VERIFYING", verifyingAt: "2026-11-23T10:00:02.000Z" };
    const controlFetch = (async (url: Parameters<typeof fetch>[0]) => {
      const path = new URL(String(url)).pathname;
      const body = path.endsWith("/lease") ? leaseBody : path.endsWith("/credential-grant") ? grantBody : verifyingBody;
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const client = createHttpProviderVerificationControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: `machine-${randomBytes(12).toString("hex")}`, fetchImpl: controlFetch });
    const lease = (await client.leaseProviderVerification())!;
    const proof = { fencingCounter: 4, leaseToken };
    const grant = await client.requestProviderVerificationCredentialGrant(job, proof);
    const acknowledgement = await client.acknowledgeProviderVerificationVerifying(job, proof);
    let opened = 0;
    const opener: CredentialOpener = {
      open: async (envelope, openingContext) => {
        opened += 1;
        return realOpener.open(envelope, openingContext);
      },
    };
    const capability = bindProviderVerificationCredential({ environment: {}, opener, lease, grant, acknowledgement });

    const provider = fakeFetch();
    const received: unknown[] = [];
    const result = await capability.openOnceFor(
      { providerVerificationJobId: lease.providerVerificationJobId, provider: lease.provider, verificationPolicyId: lease.verificationPolicyId, fencingCounter: lease.fencingCounter },
      async (credential) => {
        received.push(credential);
        return performProviderVerification({ provider: lease.provider, verificationPolicyId: lease.verificationPolicyId, credential }, { fetchImpl: provider.fetchImpl });
      },
    );
    expect(result).toEqual(VERIFIED);
    expect(opened).toBe(1);
    expect(received).toEqual([plaintext]);
    expect(typeof received[0]).toBe("string");
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.init?.headers).toEqual({ "x-goog-api-key": plaintext });
    // Nothing the transport saw is or holds the capability.
    const seen = [provider.calls[0]?.url, ...Object.values(provider.calls[0]?.init ?? {})];
    expect(seen.some((value) => value === capability)).toBe(false);
    expect(JSON.stringify(result)).not.toContain(plaintext);
    // The capability is single use: no second credential path.
    await expect(capability.openOnceFor({ providerVerificationJobId: job, provider: GOOGLE_PROVIDER_ID, verificationPolicyId: GOOGLE_POLICY, fencingCounter: 4 }, () => undefined)).rejects.toMatchObject({
      code: "PROVIDER_VERIFICATION_AUTHORITY_MISMATCH",
    });
    expect(opened).toBe(1);
  });
});
