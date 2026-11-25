import { randomBytes, randomUUID } from "node:crypto";
import { getEventListeners } from "node:events";

import { GOOGLE_PROVIDER_ID, RUNWAY_PROVIDER_ID } from "commercial-worker-protocol";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { PROVIDER_VERIFICATION_LEASE_SECONDS } from "../../commercial-api/src/workerControl/workerProviderVerificationLeaseService.js";
import type { CredentialOpener } from "../src/credentialContracts.js";
import { FORBIDDEN_PROVIDER_ENVIRONMENT_VARIABLES } from "../src/providerEnvironment.js";
import { loadProviderVerificationConfig, PROVIDER_VERIFICATION_CONFIG_KEY, type ProviderVerificationConfig } from "../src/providerVerificationConfig.js";
import { PROVIDER_VERIFICATION_REASONS_BY_OUTCOME, type ProviderVerificationResultReport } from "../src/providerVerificationContract.js";
import * as runModule from "../src/providerVerificationRun.js";
import {
  PROVIDER_VERIFICATION_RUN_CLOCK_MARGIN_MS,
  PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS,
  PROVIDER_VERIFICATION_RUN_LEASE_MS,
  PROVIDER_VERIFICATION_RUN_PRE_GRANT_MIN_MS,
  PROVIDER_VERIFICATION_RUN_PRE_TRANSPORT_MIN_MS,
  PROVIDER_VERIFICATION_RUN_PRE_VERIFYING_MIN_MS,
  PROVIDER_VERIFICATION_RUN_RESULT_RESERVE_MS,
  PROVIDER_VERIFICATION_RUN_TRANSPORT_SETUP_MARGIN_MS,
  runProviderVerification,
  type ProviderVerificationRunDependencies,
  type ProviderVerificationRunInput,
  type ProviderVerificationRunResult,
} from "../src/providerVerificationRun.js";
import { performProviderVerification, PROVIDER_VERIFICATION_TIMEOUT_MS, type ProviderVerificationDeadlineTimer } from "../src/providerVerificationTransport.js";
import { createHttpProviderVerificationControlClient, type ProviderVerificationControlClient } from "../src/workerControlClient.js";
import { WorkerError } from "../src/workerError.js";
import { createTestCredentialOpener, createTestCredentialSealer, generateTestKey } from "./support/testCredentialOpening.js";

// R44B11F Phase 7: the library-only provider verification run (architecture
// "R44B11F Phase 7 library-only verification run composition contract
// amendment", "Phase 7 test contract"). Injected fakes only: the real Phase 5
// client over a fake control fetch (so every lease, grant and acknowledgement
// is genuinely issued), a fake opener over the test crypto, a fake provider
// fetch behind the real Phase 6 transport, a virtual clock and timer, and an
// injected passing liveGate. No network, database or provider is contacted,
// and no credential value is ever printed.

const key = generateTestKey("worker-verification-run-unit/v1");
const sealer = createTestCredentialSealer(key);
const realOpener = createTestCredentialOpener(key);

const MACHINE = `fixture-machine-${randomBytes(12).toString("hex")}`;
const PLAINTEXT = `fixture-verification-key-${randomBytes(18).toString("hex")}`;
const LEASE_TOKEN = randomBytes(32).toString("base64url");
const JOB = randomUUID();
const FENCE = 9;
const GOOGLE_POLICY = "GOOGLE_GENAI_MODELS_LIST_V1BETA";
const RUNWAY_POLICY = "RUNWAY_ORGANIZATION_GET_V1_2024_11_06";
const WALL_BASE = Date.parse("2026-11-24T10:00:00.000Z");
// R44B11G: the deferral instant the fake control API acknowledges (d(1) = 300 s).
const DEFERRED_UNTIL_MS = WALL_BASE + 300_000;
const DISABLED_CONFIG: ProviderVerificationConfig = loadProviderVerificationConfig({});

const contextFor = (provider: string) => ({
  accountId: randomUUID(),
  providerConnectionId: randomUUID(),
  provider,
  credentialVersion: 4,
  purpose: "provider-credential" as const,
});
const GOOGLE_CONTEXT = contextFor(GOOGLE_PROVIDER_ID);
const GOOGLE_ENVELOPE = await sealer.seal(PLAINTEXT, GOOGLE_CONTEXT);
const RUNWAY_CONTEXT = contextFor(RUNWAY_PROVIDER_ID);
const RUNWAY_ENVELOPE = await sealer.seal(PLAINTEXT, RUNWAY_CONTEXT);
// A stored credential outside the Phase 6 shape (it contains a space).
const SHAPE_INVALID_ENVELOPE = await sealer.seal("fixture key with a space", GOOGLE_CONTEXT);

const encoder = new TextEncoder();
const iso = (ms: number) => new Date(ms).toISOString();

// --- infrastructure ---------------------------------------------------------

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

// Lets every promise chain and stream read that is not waiting on virtual
// time run to completion.
const settle = async () => {
  for (let index = 0; index < 40; index += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

// Unhandled rejections are counted for the whole file; there must be none.
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
beforeAll(() => {
  process.on("unhandledRejection", onUnhandled);
});
afterAll(() => {
  process.off("unhandledRejection", onUnhandled);
});
afterEach(async () => {
  await settle();
  expect(unhandled.length).toBe(0);
});

// Every result returned in this file, for the cross-cutting checks at the end.
const allResults: ProviderVerificationRunResult[] = [];

// A virtual monotonic timeline with a manual timer. advanceTo() fires due
// timers in order; jump() moves the clock without running any callback, as
// event-loop lag does.
type VirtualTimer = { id: number; ms: number; at: number; onExpiry: () => void; cleared: number; fired: boolean };

function virtualTime() {
  const state = {
    now: 0,
    // Worker wall clock = WALL_BASE + now + workerWallOffset; the database wall
    // clock is WALL_BASE + now.
    workerWallOffset: 0,
    monoReads: 0,
    wallReads: 0,
    timers: [] as VirtualTimer[],
    onWallRead: undefined as undefined | (() => void),
    monoValue: undefined as undefined | ((read: number, now: number) => unknown),
  };
  const timer: ProviderVerificationDeadlineTimer = (ms, onExpiry) => {
    const entry: VirtualTimer = { id: state.timers.length, ms, at: state.now + ms, onExpiry, cleared: 0, fired: false };
    state.timers.push(entry);
    return () => {
      entry.cleared += 1;
    };
  };
  const live = () => state.timers.filter((entry) => entry.cleared === 0 && !entry.fired);
  const advanceTo = (target: number) => {
    for (;;) {
      const due = live()
        .filter((entry) => entry.at <= target)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (due === undefined) break;
      state.now = Math.max(state.now, due.at);
      due.fired = true;
      due.onExpiry();
    }
    state.now = Math.max(state.now, target);
  };
  const advance = (ms: number) => advanceTo(state.now + ms);
  const jump = (ms: number) => {
    state.now += ms;
  };
  const mono = (): number => {
    state.monoReads += 1;
    return (state.monoValue === undefined ? state.now : state.monoValue(state.monoReads, state.now)) as number;
  };
  const wall = (): number => {
    state.wallReads += 1;
    const value = WALL_BASE + state.now + state.workerWallOffset;
    state.onWallRead?.();
    return value;
  };
  const budgetTimers = () => state.timers.filter((entry) => entry.ms !== PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS && entry.ms !== PROVIDER_VERIFICATION_TIMEOUT_MS);
  return { state, timer, live, advance, advanceTo, jump, mono, wall, budgetTimers };
}

// R44B11G adds the unsupported-lease deferral route.
type Route = "lease" | "grant" | "verifying" | "result" | "unsupported";
type Answer = Readonly<{
  // The fake control fetch records the request, then fails as a transport
  // (the server may have committed; the response is lost).
  transportFailure?: boolean;
  // A non-200 status, mapped by the real client.
  status?: number;
  // The request never settles and ignores its signal.
  hang?: boolean;
  // A manually settled fake fetch, still parsed and validated by the real client.
  response?: Promise<Response>;
  // Virtual time the request takes (fires due timers).
  advance?: number;
  // Clock lag after the answer, with no timer callback.
  jump?: number;
  // The client method rejects with a plain Error instead of sending.
  plainError?: boolean;
  body?: unknown;
  before?: () => void;
  // Lease only: no work, another provider or policy, or an explicit expiry
  // relative to the worker wall clock at the answer.
  noWork?: boolean;
  provider?: string;
  policy?: string;
  expiresIn?: number;
  // The value the client returns, transformed (for example a copy).
  transform?: (value: unknown) => unknown;
}>;

type Setup = Readonly<{
  answers?: Partial<Record<Route, Answer[]>>;
  runway?: boolean;
  envelope?: unknown;
  provider?: (init: RequestInit | undefined) => unknown;
  environment?: Record<string, string | undefined>;
}>;

const streamOf = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
const providerResponse = (status: number, text = '{"models":[]}', headers: Record<string, string> = {}) => ({ status, headers: new Headers(headers), body: streamOf(text) });

function setup(options: Setup = {}) {
  const time = virtualTime();
  const log: string[] = [];
  const answers: Record<Route, Answer[]> = { lease: [], grant: [], verifying: [], result: [], unsupported: [], ...options.answers } as Record<Route, Answer[]>;
  const pendingAnswer: Partial<Record<Route, Answer>> = {};
  const sent: Record<Route, unknown[]> = { lease: [], grant: [], verifying: [], result: [], unsupported: [] };
  const signals: Record<Route, AbortSignal[]> = { lease: [], grant: [], verifying: [], result: [], unsupported: [] };
  const sentAt: Record<Route, number[]> = { lease: [], grant: [], verifying: [], result: [], unsupported: [] };
  const provider = options.runway === true ? RUNWAY_PROVIDER_ID : GOOGLE_PROVIDER_ID;
  const policy = options.runway === true ? RUNWAY_POLICY : GOOGLE_POLICY;
  const envelope = "envelope" in options ? options.envelope : options.runway === true ? RUNWAY_ENVELOPE : GOOGLE_ENVELOPE;
  const context = options.runway === true ? RUNWAY_CONTEXT : GOOGLE_CONTEXT;

  // The fake worker-control API behind the real client.
  const controlFetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const route: Route = path.endsWith("/lease")
      ? "lease"
      : path.endsWith("/credential-grant")
        ? "grant"
        : path.endsWith("/verifying")
          ? "verifying"
          : path.endsWith("/unsupported")
            ? "unsupported"
            : "result";
    const requestBody: Record<string, unknown> = init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>);
    sent[route].push(init?.body === undefined ? undefined : JSON.parse(String(init.body)));
    sentAt[route].push(time.state.now);
    const answer = pendingAnswer[route] ?? {};
    const enteredWall = WALL_BASE + time.state.now;
    if (answer.hang === true) return new Promise<Response>(() => undefined);
    if (answer.response !== undefined) return answer.response;
    if (answer.transportFailure === true) throw new TypeError("fixture lost response");
    if (answer.advance !== undefined) time.advance(answer.advance);
    const status = answer.status ?? 200;
    let payload: unknown = {};
    if (status === 200) {
      if (answer.body !== undefined) payload = answer.body;
      else if (route === "lease") {
        const expiresAt =
          answer.expiresIn === undefined ? enteredWall + PROVIDER_VERIFICATION_RUN_LEASE_MS : WALL_BASE + time.state.now + time.state.workerWallOffset + answer.expiresIn;
        payload =
          answer.noWork === true
            ? { lease: null }
            : {
                lease: {
                  providerVerificationJobId: JOB,
                  provider: answer.provider ?? provider,
                  verificationPolicyId: answer.policy ?? policy,
                  leaseToken: LEASE_TOKEN,
                  fencingCounter: FENCE,
                  leaseExpiresAt: iso(expiresAt),
                },
              };
      } else if (route === "grant") {
        payload = { providerVerificationJobId: JOB, fencingCounter: FENCE, credentialGrantedAt: iso(WALL_BASE), credential: { sealedEnvelope: envelope, openingContext: context } };
      } else if (route === "verifying") {
        payload = { providerVerificationJobId: JOB, fencingCounter: FENCE, state: "VERIFYING", verifyingAt: iso(WALL_BASE) };
      } else if (route === "unsupported") {
        payload = { providerVerificationJobId: JOB, fencingCounter: FENCE, state: "QUEUED", deferredUntil: iso(DEFERRED_UNTIL_MS) };
      } else {
        payload = {
          providerVerificationJobId: JOB,
          fencingCounter: FENCE,
          state: "COMPLETED",
          outcome: requestBody.outcome,
          reasonCode: requestBody.reasonCode,
          completedAt: iso(WALL_BASE + 1000),
        };
      }
    }
    if (answer.jump !== undefined) time.jump(answer.jump);
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const real = createHttpProviderVerificationControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: MACHINE, fetchImpl: controlFetch });

  const calls = { lease: 0, grant: [] as unknown[][], verifying: [] as unknown[][], result: [] as unknown[][], defer: [] as unknown[][], receivers: [] as unknown[] };
  const through = async (route: Route, call: () => Promise<unknown>): Promise<unknown> => {
    const answer = answers[route].shift() ?? {};
    pendingAnswer[route] = answer;
    answer.before?.();
    if (answer.plainError === true) throw new Error("fixture control failure");
    const value = await call();
    return answer.transform === undefined ? value : answer.transform(value);
  };
  const client: ProviderVerificationControlClient = {
    leaseProviderVerification(signal?: AbortSignal) {
      log.push("lease");
      calls.lease += 1;
      calls.receivers.push(this);
      if (signal !== undefined) signals.lease.push(signal);
      return through("lease", () => real.leaseProviderVerification(signal)) as never;
    },
    requestProviderVerificationCredentialGrant(jobId: string, proof, signal?: AbortSignal) {
      log.push("grant");
      calls.grant.push([jobId, proof, signal]);
      calls.receivers.push(this);
      if (signal !== undefined) signals.grant.push(signal);
      return through("grant", () => real.requestProviderVerificationCredentialGrant(jobId, proof, signal)) as never;
    },
    acknowledgeProviderVerificationVerifying(jobId: string, proof, signal?: AbortSignal) {
      log.push("verifying");
      calls.verifying.push([jobId, proof, signal]);
      calls.receivers.push(this);
      if (signal !== undefined) signals.verifying.push(signal);
      return through("verifying", () => real.acknowledgeProviderVerificationVerifying(jobId, proof, signal)) as never;
    },
    reportProviderVerificationResult(jobId: string, proof, report, signal?: AbortSignal) {
      log.push("result");
      calls.result.push([jobId, proof, report, signal]);
      calls.receivers.push(this);
      if (signal !== undefined) signals.result.push(signal);
      return through("result", () => real.reportProviderVerificationResult(jobId, proof, report, signal)) as never;
    },
    deferUnsupportedProviderVerification(jobId: string, proof, refusal, signal?: AbortSignal) {
      log.push("defer");
      calls.defer.push([jobId, proof, refusal, signal]);
      calls.receivers.push(this);
      if (signal !== undefined) signals.unsupported.push(signal);
      return through("unsupported", () => real.deferUnsupportedProviderVerification(jobId, proof, refusal, signal)) as never;
    },
  };

  // The fake opener over the test crypto. Its open member is an accessor so
  // that the dependency-validation read is observable.
  const openerState = {
    opened: 0,
    advance: 0,
    hold: null as null | ReturnType<typeof deferred<void>>,
    fail: false,
    afterOpen: undefined as undefined | (() => void),
  };
  const opener = {
    get open() {
      log.push("read-open");
      return async (sealed: unknown, sealingContext: unknown) => {
        log.push("open");
        openerState.opened += 1;
        if (openerState.advance > 0) time.advance(openerState.advance);
        if (openerState.hold !== null) await openerState.hold.promise;
        if (openerState.fail) throw new Error("fixture opener failure");
        const plaintext = await realOpener.open(sealed as never, sealingContext as never);
        openerState.afterOpen?.();
        return plaintext;
      };
    },
  } as unknown as CredentialOpener;

  // The fake provider behind the real Phase 6 transport.
  const providerCalls: Array<{ url: unknown; init: RequestInit | undefined; keyMatched: boolean; externalListeners: number }> = [];
  const shutdown = new AbortController();
  const externalSignal = shutdown.signal;
  Object.defineProperty(externalSignal, "addEventListener", {
    value(this: AbortSignal, ...args: Parameters<AbortSignal["addEventListener"]>) {
      log.push("shutdown-link");
      return EventTarget.prototype.addEventListener.apply(this, args as never);
    },
  });
  const providerFetch = ((url: unknown, init?: RequestInit) => {
    log.push("transport");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    providerCalls.push({
      url,
      init,
      keyMatched: Object.values(headers).includes(PLAINTEXT) || Object.values(headers).includes(`Bearer ${PLAINTEXT}`),
      externalListeners: getEventListeners(externalSignal, "abort").length,
    });
    return (options.provider ?? (() => providerResponse(200)))(init);
  }) as unknown as typeof fetch;

  const environment = new Proxy(options.environment ?? ({} as Record<string, string | undefined>), {
    ownKeys(target) {
      log.push("environment");
      return Reflect.ownKeys(target);
    },
  });

  const gateCalls: unknown[] = [];
  const liveGate = (config: ProviderVerificationConfig): void => {
    log.push("gate");
    gateCalls.push(config);
  };

  const input: ProviderVerificationRunInput = { config: DISABLED_CONFIG, environment, shutdownSignal: externalSignal };
  const dependencies: ProviderVerificationRunDependencies = {
    client,
    opener,
    fetchImpl: providerFetch,
    deadlineTimer: time.timer,
    wallClock: time.wall,
    monotonicClock: time.mono,
    liveGate,
  };

  const start = (inputOverride: Record<string, unknown> = {}, dependencyOverride: Record<string, unknown> = {}) => {
    const promise = runProviderVerification({ ...input, ...inputOverride } as never, { ...dependencies, ...dependencyOverride } as never);
    void promise.then((result) => allResults.push(result));
    return promise;
  };
  const run = async (inputOverride: Record<string, unknown> = {}, dependencyOverride: Record<string, unknown> = {}) => {
    const promise = start(inputOverride, dependencyOverride);
    await settle();
    return promise;
  };
  const quiescent = () => {
    expect(time.live(), "live virtual timers").toEqual([]);
    expect(getEventListeners(externalSignal, "abort").length, "external listeners").toBe(0);
  };
  return {
    time,
    log,
    answers,
    sent,
    sentAt,
    signals,
    calls,
    client,
    opener,
    openerState,
    providerCalls,
    shutdown,
    externalSignal,
    environment,
    gateCalls,
    input,
    dependencies,
    start,
    run,
    quiescent,
  };
}

const reported = (outcome: string, reasonCode: string) => ({
  status: "REPORTED",
  providerVerificationJobId: JOB,
  fencingCounter: FENCE,
  outcome,
  reasonCode,
  completedAt: new Date(WALL_BASE + 1000),
});
const stoppedAt = (stage: string, code: string, job: string | null = JOB) => ({ status: "STOPPED", stage, code, providerVerificationJobId: job });
const abandonedAt = (stage: string, cause: string, job: string | null = JOB) => ({ status: "ABANDONED", stage, cause, providerVerificationJobId: job });
const nothingAfterLease = (h: ReturnType<typeof setup>) => {
  expect(h.calls.grant).toHaveLength(0);
  expect(h.calls.verifying).toHaveLength(0);
  expect(h.openerState.opened).toBe(0);
  expect(h.providerCalls).toHaveLength(0);
  expect(h.calls.result).toHaveLength(0);
};

// The canonical Phase 6 report for a provider answer, obtained from the real
// transport directly, so identity can be compared with what the run reports.
async function canonicalReport(answer: (init: RequestInit | undefined) => unknown, runway = false): Promise<ProviderVerificationResultReport> {
  return performProviderVerification(
    { provider: runway ? RUNWAY_PROVIDER_ID : GOOGLE_PROVIDER_ID, verificationPolicyId: runway ? RUNWAY_POLICY : GOOGLE_POLICY, credential: PLAINTEXT },
    { fetchImpl: ((_url: unknown, init?: RequestInit) => answer(init)) as unknown as typeof fetch },
  );
}

// --- surface, constants and live gate ----------------------------------------

describe("run surface and constants", () => {
  it("pins the locked constants and their composition, with LEASE_MS drift-tested against the API", () => {
    expect(PROVIDER_VERIFICATION_RUN_LEASE_MS).toBe(30000);
    expect(PROVIDER_VERIFICATION_RUN_LEASE_MS).toBe(PROVIDER_VERIFICATION_LEASE_SECONDS * 1000);
    expect(PROVIDER_VERIFICATION_RUN_CLOCK_MARGIN_MS).toBe(2000);
    expect(PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS).toBe(3000);
    expect(PROVIDER_VERIFICATION_RUN_RESULT_RESERVE_MS).toBe(6000);
    expect(PROVIDER_VERIFICATION_RUN_RESULT_RESERVE_MS).toBe(2 * PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS);
    expect(PROVIDER_VERIFICATION_RUN_TRANSPORT_SETUP_MARGIN_MS).toBe(250);
    expect(PROVIDER_VERIFICATION_RUN_PRE_TRANSPORT_MIN_MS).toBe(16250);
    expect(PROVIDER_VERIFICATION_RUN_PRE_TRANSPORT_MIN_MS).toBe(
      PROVIDER_VERIFICATION_TIMEOUT_MS + PROVIDER_VERIFICATION_RUN_RESULT_RESERVE_MS + PROVIDER_VERIFICATION_RUN_TRANSPORT_SETUP_MARGIN_MS,
    );
    expect(PROVIDER_VERIFICATION_RUN_PRE_VERIFYING_MIN_MS).toBe(19250);
    expect(PROVIDER_VERIFICATION_RUN_PRE_VERIFYING_MIN_MS).toBe(PROVIDER_VERIFICATION_RUN_PRE_TRANSPORT_MIN_MS + PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS);
    expect(PROVIDER_VERIFICATION_RUN_PRE_GRANT_MIN_MS).toBe(22250);
    expect(PROVIDER_VERIFICATION_RUN_PRE_GRANT_MIN_MS).toBe(PROVIDER_VERIFICATION_RUN_PRE_VERIFYING_MIN_MS + PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS);
  });

  it("exports exactly the locked runtime surface: no bypass, skip or alternate gate", () => {
    expect(Object.keys(runModule).sort()).toEqual([
      "PROVIDER_VERIFICATION_RUN_CLOCK_MARGIN_MS",
      "PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS",
      "PROVIDER_VERIFICATION_RUN_LEASE_MS",
      "PROVIDER_VERIFICATION_RUN_PRE_GRANT_MIN_MS",
      "PROVIDER_VERIFICATION_RUN_PRE_TRANSPORT_MIN_MS",
      "PROVIDER_VERIFICATION_RUN_PRE_VERIFYING_MIN_MS",
      "PROVIDER_VERIFICATION_RUN_RESULT_RESERVE_MS",
      "PROVIDER_VERIFICATION_RUN_TRANSPORT_SETUP_MARGIN_MS",
      "runProviderVerification",
    ]);
  });

  it("importing the module has no side effect: no fetch, timer, interval or clock read", async () => {
    vi.resetModules();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const fresh = await import("../src/providerVerificationRun.js");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(typeof fresh.runProviderVerification).toBe("function");
  });
});

describe("live gate (P7-M1)", () => {
  it("refuses every loadable configuration with the default gate: DISABLED, no lease, no fetch of either kind, no clock read", async () => {
    for (const environment of [{}, { [PROVIDER_VERIFICATION_CONFIG_KEY]: "disabled" }]) {
      const h = setup();
      const result = await h.run({ config: loadProviderVerificationConfig(environment) }, { liveGate: undefined });
      expect(result).toEqual({ status: "DISABLED" });
      expect(Object.isFrozen(result)).toBe(true);
      expect(h.calls.lease).toBe(0);
      expect(h.sent.lease).toHaveLength(0);
      expect(h.providerCalls).toHaveLength(0);
      expect(h.time.state.monoReads).toBe(0);
      expect(h.time.state.wallReads).toBe(0);
      expect(h.log).toEqual([]);
      h.quiescent();
    }
  });

  it("an injected passing gate permits composition, receiving the configuration", async () => {
    const h = setup();
    expect(await h.run()).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
    expect(h.gateCalls).toEqual([DISABLED_CONFIG]);
    expect(h.gateCalls[0]).toBe(DISABLED_CONFIG);
    h.quiescent();
  });

  it("handles a throwing, value-returning or non-function injected gate as locked, never reaching the lease", async () => {
    const cases: Array<[unknown, unknown]> = [
      [
        () => {
          throw new WorkerError("PROVIDER_VERIFICATION_DISABLED");
        },
        { status: "DISABLED" },
      ],
      [
        () => {
          throw new WorkerError("PROVIDER_VERIFICATION_CONFIG_INVALID");
        },
        stoppedAt("GATE", "PROVIDER_VERIFICATION_CONFIG_INVALID", null),
      ],
      [
        () => {
          throw new TypeError("fixture gate failure");
        },
        stoppedAt("GATE", "WORKER_CONFIGURATION_INVALID", null),
      ],
      [() => true, stoppedAt("GATE", "WORKER_CONFIGURATION_INVALID", null)],
      [() => Promise.reject(new Error("fixture async gate")), stoppedAt("GATE", "WORKER_CONFIGURATION_INVALID", null)],
      [() => Promise.resolve(), stoppedAt("GATE", "WORKER_CONFIGURATION_INVALID", null)],
      ["not a gate", stoppedAt("GATE", "WORKER_CONFIGURATION_INVALID", null)],
      [null, stoppedAt("GATE", "WORKER_CONFIGURATION_INVALID", null)],
    ];
    for (const [liveGate, expected] of cases) {
      const h = setup();
      expect(await h.run({}, { liveGate })).toEqual(expected);
      expect(h.calls.lease).toBe(0);
      expect(h.time.state.monoReads + h.time.state.wallReads).toBe(0);
      h.quiescent();
    }
  });
});

// --- start: dependency and environment validation ----------------------------

describe("dependency validation and environment guard (before any lease)", () => {
  it("stops at START for a non-object input or dependencies, calling nothing including the gate", async () => {
    for (const [input, dependencies] of [
      [null, {}],
      ["input", {}],
      [{}, null],
      [{}, 42],
      [undefined, undefined],
    ] as const) {
      const result = await runProviderVerification(input as never, dependencies as never);
      allResults.push(result);
      expect(result).toEqual(stoppedAt("START", "WORKER_CONFIGURATION_INVALID", null));
    }
    const h = setup();
    expect(await runProviderVerification(null as never, h.dependencies)).toEqual(stoppedAt("START", "WORKER_CONFIGURATION_INVALID", null));
    expect(h.gateCalls).toHaveLength(0);
  });

  it("stops at START when reading an input or dependency member throws", async () => {
    const h = setup();
    const input = Object.defineProperty({ ...h.input }, "environment", {
      get() {
        throw new TypeError("fixture accessor");
      },
    });
    expect(await runProviderVerification(input, h.dependencies)).toEqual(stoppedAt("START", "WORKER_CONFIGURATION_INVALID", null));
    expect(h.calls.lease).toBe(0);
  });

  it("stops at START / WORKER_CONFIGURATION_INVALID for every invalid dependency, with no lease and no raw TypeError", async () => {
    const forgedSignal = Object.create(AbortSignal.prototype) as AbortSignal;
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ["client null", {}, { client: null }],
      ["client not an object", {}, { client: "client" }],
      ["client method missing", {}, { client: { leaseProviderVerification: () => null } }],
      ["opener null", {}, { opener: null }],
      ["opener not an object", {}, { opener: () => "x" }],
      ["opener.open missing", {}, { opener: {} }],
      ["opener.open not a function", {}, { opener: { open: "open" } }],
      [
        "opener.open accessor throws",
        {},
        {
          opener: Object.defineProperty({}, "open", {
            get() {
              throw new TypeError("fixture");
            },
          }),
        },
      ],
      ["fetchImpl missing", {}, { fetchImpl: undefined }],
      ["deadlineTimer not a function", {}, { deadlineTimer: 5 }],
      ["wallClock not a function", {}, { wallClock: "now" }],
      ["monotonicClock not a function", {}, { monotonicClock: {} }],
      ["shutdownSignal plain object", { shutdownSignal: { aborted: false } }, {}],
      ["environment null", { environment: null }, {}],
      ["environment string", { environment: "PATH=x" }, {}],
      ["environment number", { environment: 7 }, {}],
    ];
    for (const [name, input, dependencies] of cases) {
      const h = setup();
      const result = await h.run(input, dependencies);
      expect(result, name).toEqual(stoppedAt("START", "WORKER_CONFIGURATION_INVALID", null));
      expect(h.calls.lease, name).toBe(0);
      expect(h.sent.lease, name).toHaveLength(0);
      nothingAfterLease(h);
    }
    // A forged signal passes instanceof but its state cannot be read: still START.
    const h = setup();
    expect(await h.run({ shutdownSignal: forgedSignal })).toEqual(stoppedAt("START", "WORKER_CONFIGURATION_INVALID", null));
    expect(h.calls.lease).toBe(0);
  });

  it("reads the opener's open member for validation only and never calls it before VERIFYING", async () => {
    const h = setup({ answers: { lease: [{ noWork: true }] } });
    expect(await h.run()).toEqual({ status: "NO_WORK" });
    expect(h.log.filter((entry) => entry === "read-open")).toHaveLength(1);
    expect(h.openerState.opened).toBe(0);
  });

  it("refuses a well-formed environment naming a forbidden provider variable at ENVIRONMENT, before any lease", async () => {
    for (const name of [FORBIDDEN_PROVIDER_ENVIRONMENT_VARIABLES[0]!, FORBIDDEN_PROVIDER_ENVIRONMENT_VARIABLES[4]!.toLowerCase()]) {
      const h = setup({ environment: { [name]: "" } });
      expect(await h.run()).toEqual(stoppedAt("ENVIRONMENT", "FORBIDDEN_PROVIDER_ENVIRONMENT", null));
      expect(h.calls.lease).toBe(0);
      expect(h.log).toEqual(["gate", "read-open", "environment"]);
      h.quiescent();
    }
  });

  it("maps a throwing environment record to ENVIRONMENT / WORKER_CONFIGURATION_INVALID (no raw TypeError)", async () => {
    const h = setup();
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new TypeError("fixture proxy trap");
        },
      },
    );
    expect(await h.run({ environment: hostile })).toEqual(stoppedAt("ENVIRONMENT", "WORKER_CONFIGURATION_INVALID", null));
    expect(h.calls.lease).toBe(0);
  });
});

// --- lease, admission and order ---------------------------------------------

describe("lease and admission", () => {
  it("returns NO_WORK for a null lease, with one lease call, no wall-clock read and no budget timer", async () => {
    const h = setup({ answers: { lease: [{ noWork: true }] } });
    expect(await h.run()).toEqual({ status: "NO_WORK" });
    expect(h.calls.lease).toBe(1);
    expect(h.time.state.wallReads).toBe(0);
    expect(h.time.budgetTimers()).toEqual([]);
    nothingAfterLease(h);
    h.quiescent();
  });

  it("stops at LEASE with no retry for 409, 401, 403, 503, malformed, deadline and plain throws", async () => {
    const cases: Array<[Answer, string]> = [
      [{ status: 409 }, "PROVIDER_VERIFICATION_LEASE_REJECTED"],
      [{ status: 401 }, "WORKER_AUTHENTICATION_REJECTED"],
      [{ status: 403 }, "WORKER_AUTHENTICATION_REJECTED"],
      [{ status: 503 }, "CONTROL_API_UNAVAILABLE"],
      [{ body: { lease: { providerVerificationJobId: "x" } } }, "MALFORMED_CONTROL_RESPONSE"],
      [{ plainError: true }, "WORKER_CONFIGURATION_INVALID"],
    ];
    for (const [answer, code] of cases) {
      const h = setup({ answers: { lease: [answer] } });
      expect(await h.run(), code).toEqual(stoppedAt("LEASE", code, null));
      expect(h.calls.lease).toBe(1);
      expect(h.time.state.wallReads).toBe(0);
      nothingAfterLease(h);
      h.quiescent();
    }
    // The 3000 ms lease deadline is CONTROL_API_UNAVAILABLE, also with no retry.
    const h = setup({ answers: { lease: [{ hang: true }] } });
    const pending = h.start();
    await settle();
    expect(h.time.live().map((entry) => entry.ms)).toEqual([PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS]);
    h.time.advance(2999);
    await settle();
    expect(h.signals.lease[0]!.aborted).toBe(false);
    h.time.advance(1);
    expect(await pending).toEqual(stoppedAt("LEASE", "CONTROL_API_UNAVAILABLE", null));
    expect(h.signals.lease[0]!.aborted).toBe(true);
    expect(h.calls.lease).toBe(1);
    h.quiescent();
  });

  // R44B11G supersedes the Phase 7 "leave the lease to expire" disposition for
  // this path only: classification before grant, no grant, VERIFYING or result
  // report are kept, and "STOP" becomes exactly one deferral request.
  it("refuses an unsupported provider, policy or pair before any grant, then defers it with exactly one request", async () => {
    const cases: Array<[Answer, string]> = [
      [{ provider: "OTHER_PROVIDER" }, "UNSUPPORTED_PROVIDER"],
      [{ policy: "OTHER_POLICY_V1" }, "UNSUPPORTED_POLICY"],
      [{ policy: RUNWAY_POLICY }, "PROVIDER_POLICY_MISMATCH"],
    ];
    for (const [answer, reason] of cases) {
      const h = setup({ answers: { lease: [answer] } });
      const result = await h.run();
      expect(result).toEqual({
        status: "UNSUPPORTED_LEASE",
        providerVerificationJobId: JOB,
        reason,
        disposition: "DEFERRED",
        deferredUntil: new Date(DEFERRED_UNTIL_MS),
        cause: null,
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(h.calls.lease).toBe(1);
      expect(h.calls.defer).toHaveLength(1);
      expect(h.sent.unsupported).toEqual([{ fencingCounter: FENCE, leaseToken: LEASE_TOKEN, refusal: reason }]);
      expect(h.time.state.wallReads).toBe(0);
      expect(h.time.budgetTimers()).toEqual([]);
      nothingAfterLease(h);
      h.quiescent();
    }
  });

  it("runs the locked order: gate < validation < environment < shutdown link < lease < budget < grant < VERIFYING < bind < open < transport < result", async () => {
    const h = setup();
    expect(await h.run()).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
    // read-open (validation), environment (guard), wall (budget establishment,
    // after admission), environment again (the binder's own guard), read-open
    // and open (openOnceFor).
    expect(h.log).toEqual([
      "gate",
      "read-open",
      "environment",
      "shutdown-link",
      "lease",
      "grant",
      "verifying",
      "environment",
      "read-open",
      "open",
      "transport",
      "result",
    ]);
    expect(h.time.state.wallReads).toBe(1);
    // Every client method runs with the client as its receiver.
    expect(h.calls.receivers.every((receiver) => receiver === h.client)).toBe(true);
    // Budget establishment follows the lease and precedes the grant: the
    // budget timer is installed before the first grant request is sent.
    const budget = h.time.budgetTimers();
    expect(budget).toHaveLength(1);
    expect(budget[0]!.id).toBeLessThan(h.time.state.timers.findIndex((entry, index) => index > 0 && entry.ms === PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS));
    h.quiescent();
  });
});

// --- budget ----------------------------------------------------------------

describe("lease budget (P7-M2)", () => {
  it("zero skew: budgetEnd = 28000, the budget timer fires at budgetAbortAt = 22000; one wall read only", async () => {
    const h = setup();
    expect(await h.run()).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
    const [budget] = h.time.budgetTimers();
    expect(budget).toMatchObject({ ms: 22000, at: 22000, cleared: 1, fired: false });
    expect(h.time.state.wallReads).toBe(1);
    // leaseSent, receipt, pre-grant, timer installation, pre-VERIFYING, transport.
    expect(h.time.state.monoReads).toBe(6);
  });

  it("slow lease and a worker clock 4000 ms behind: the leaseSentMono anchor abandons the transport checkpoint (P7-M2 schedule)", async () => {
    // leaseSentMono 0; lease answered at 2900; database lease time 0, so
    // leaseExpiresAt = 30000 on the database clock; worker wall 4000 behind.
    // localLeaseCapEnd 30000, serverExpiryProjectedEnd 34000, budgetEnd 28000,
    // budgetAbortAt 22000.
    const h = setup({
      answers: {
        lease: [{ advance: 2900 }],
        // Grant answered by 8700 (inside its deadline), VERIFYING by 11600.
        grant: [{ advance: 2990 }],
        verifying: [{ advance: 2900 }],
      },
    });
    h.time.state.workerWallOffset = -4000;
    // Local processing lag between receipt and the first grant checkpoint: 2810.
    h.time.state.onWallRead = () => h.time.jump(2810);
    // The opener settles at 11800.
    h.openerState.advance = 200;
    const result = await h.run();
    expect(result).toEqual(abandonedAt("VERIFICATION", "LEASE_BUDGET"));
    const [budget] = h.time.budgetTimers();
    // Installed at 5710 with the delay charged from the absolute anchor.
    expect(budget).toMatchObject({ ms: 16290, at: 22000 });
    expect(h.sentAt.grant).toEqual([5710]);
    expect(h.sentAt.verifying).toEqual([8700]);
    expect(h.time.state.now).toBe(11800);
    // remaining() at the transport checkpoint was 28000 - 11800 = 16200 < 16250.
    expect(h.providerCalls).toHaveLength(0);
    expect(h.openerState.opened).toBe(1);
    expect(h.calls.result).toHaveLength(0);
    h.quiescent();
  });

  it("a worker clock behind the database cannot extend the budget beyond the local cap", async () => {
    const h = setup();
    h.time.state.workerWallOffset = -60000;
    expect(await h.run()).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
    expect(h.time.budgetTimers()[0]).toMatchObject({ at: 22000 });
  });

  it("a worker clock ahead of the database fails closed before the grant", async () => {
    const h = setup();
    h.time.state.workerWallOffset = 6000;
    // serverExpiryProjectedEnd 24000, budgetEnd 22000 < 22250.
    expect(await h.run()).toEqual(abandonedAt("GRANT", "LEASE_BUDGET"));
    expect(h.calls.grant).toHaveLength(0);
    expect(h.time.state.wallReads).toBe(1);
    h.quiescent();
  });

  it("the server-expiry projection bounds the budget when shorter than the local cap", async () => {
    const h = setup({ answers: { lease: [{ expiresIn: 26000 }] } });
    expect(await h.run()).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
    // budgetEnd = 26000 - 2000 = 24000, budgetAbortAt 18000.
    expect(h.time.budgetTimers()[0]).toMatchObject({ ms: 18000, at: 18000 });
  });

  it("checkpoints compare with >= at exactly 22250, 19250 and 16250, and the failing side sends nothing further", async () => {
    // Grant: remaining() = expiresIn - 2000 at monotonic 0.
    {
      const h = setup({ answers: { lease: [{ expiresIn: 24249 }] } });
      expect(await h.run()).toEqual(abandonedAt("GRANT", "LEASE_BUDGET"));
      expect(h.calls.grant).toHaveLength(0);
      expect(h.time.budgetTimers()).toEqual([]);
      nothingAfterLease(h);
      h.quiescent();
    }
    {
      const h = setup({ answers: { lease: [{ expiresIn: 24250 }] } });
      expect(await h.run()).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
      expect(h.calls.grant).toHaveLength(1);
    }
    // VERIFYING: budgetEnd 28000; clock lag after the grant answer.
    {
      const h = setup({ answers: { grant: [{ jump: 8751 }] } });
      expect(await h.run()).toEqual(abandonedAt("VERIFYING", "LEASE_BUDGET"));
      expect(h.calls.verifying).toHaveLength(0);
      expect(h.openerState.opened).toBe(0);
      h.quiescent();
    }
    {
      const h = setup({ answers: { grant: [{ jump: 8750 }] } });
      expect(await h.run()).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
      expect(h.calls.verifying).toHaveLength(1);
    }
    // Transport: the opener's duration is charged at the transport checkpoint.
    for (const [advance, expected] of [
      [11751, false],
      [12000, false],
      [11750, true],
    ] as const) {
      const h = setup();
      h.openerState.advance = advance;
      const result = await h.run();
      expect(result, String(advance)).toEqual(expected ? reported("VERIFIED", "VERIFICATION_SUCCEEDED") : abandonedAt("VERIFICATION", "LEASE_BUDGET"));
      expect(h.providerCalls, String(advance)).toHaveLength(expected ? 1 : 0);
      expect(h.calls.result, String(advance)).toHaveLength(expected ? 1 : 0);
      h.quiescent();
    }
  });

  it("a non-finite or throwing clock read stops with the current stage; a failed leaseSentMono read sends no lease", async () => {
    {
      const h = setup();
      h.time.state.monoValue = (read, now) => (read === 1 ? Number.NaN : now);
      expect(await h.run()).toEqual(stoppedAt("LEASE", "WORKER_CONFIGURATION_INVALID", null));
      expect(h.calls.lease).toBe(0);
    }
    {
      const h = setup();
      h.time.state.monoValue = (read, now) => (read === 2 ? Number.POSITIVE_INFINITY : now);
      expect(await h.run()).toEqual(stoppedAt("GRANT", "WORKER_CONFIGURATION_INVALID"));
      expect(h.calls.grant).toHaveLength(0);
      expect(h.time.state.wallReads).toBe(0);
    }
    {
      const h = setup();
      expect(
        await h.run(
          {},
          {
            wallClock: () => {
              throw new TypeError("fixture clock");
            },
          },
        ),
      ).toEqual(stoppedAt("GRANT", "WORKER_CONFIGURATION_INVALID"));
      expect(h.calls.grant).toHaveLength(0);
    }
    {
      // The pre-VERIFYING checkpoint read.
      const h = setup();
      h.time.state.monoValue = (read, now) => (read === 5 ? "5" : now);
      expect(await h.run()).toEqual(stoppedAt("VERIFYING", "WORKER_CONFIGURATION_INVALID"));
      expect(h.calls.verifying).toHaveLength(0);
      h.quiescent();
    }
    {
      // The transport checkpoint read, inside use.
      const h = setup();
      h.time.state.monoValue = (read, now) => (read === 6 ? Number.NaN : now);
      expect(await h.run()).toEqual(stoppedAt("VERIFICATION", "WORKER_CONFIGURATION_INVALID"));
      expect(h.providerCalls).toHaveLength(0);
      expect(h.calls.result).toHaveLength(0);
      h.quiescent();
    }
  });

  it("the Phase 6 provider timeout wins distinctly when the transport starts with remaining() >= 17000", async () => {
    const h = setup({ provider: () => new Promise(() => undefined) });
    // The transport checkpoint at 11000: remaining() = 17000.
    h.openerState.advance = 11000;
    const pending = h.start();
    await settle();
    expect(h.providerCalls).toHaveLength(1);
    const phase6 = h.time.state.timers.find((entry) => entry.ms === PROVIDER_VERIFICATION_TIMEOUT_MS)!;
    expect(phase6.at).toBe(21000);
    h.time.advanceTo(21000);
    expect(await pending).toEqual(reported("INCONCLUSIVE", "PROVIDER_TIMEOUT"));
    expect(h.time.budgetTimers()[0]).toMatchObject({ at: 22000, fired: false, cleared: 1 });
    expect(h.sent.result).toEqual([{ fencingCounter: FENCE, leaseToken: LEASE_TOKEN, outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_TIMEOUT" }]);
    h.quiescent();
  });

  it("the Phase 7 budget timer fires at budgetAbortAt, aborts the in-flight transport, and nothing is reported", async () => {
    const h = setup({ provider: () => new Promise(() => undefined) });
    // A Phase 6 deadline that never fires.
    const silentPhase6: ProviderVerificationDeadlineTimer = (ms, onExpiry) => (ms === PROVIDER_VERIFICATION_TIMEOUT_MS ? () => undefined : h.time.timer(ms, onExpiry));
    const pending = h.start({}, { deadlineTimer: silentPhase6 });
    await settle();
    expect(h.providerCalls).toHaveLength(1);
    const providerSignal = h.providerCalls[0]!.init!.signal!;
    h.time.advanceTo(21999);
    await settle();
    expect(providerSignal.aborted).toBe(false);
    h.time.advanceTo(22000);
    expect(await pending).toEqual(abandonedAt("VERIFICATION", "LEASE_BUDGET"));
    expect(providerSignal.aborted).toBe(true);
    expect(h.calls.result).toHaveLength(0);
    h.quiescent();
  });
});

// --- control retries ----------------------------------------------------------

describe("grant and VERIFYING control retries (P7-M5)", () => {
  for (const route of ["grant", "verifying"] as const) {
    const stage = route === "grant" ? "GRANT" : "VERIFYING";
    const rejected = route === "grant" ? "PROVIDER_VERIFICATION_GRANT_REJECTED" : "PROVIDER_VERIFICATION_VERIFYING_REJECTED";
    const calls = (h: ReturnType<typeof setup>) => h.calls[route];

    it(`${route}: CONTROL_API_UNAVAILABLE then one exact retry succeeds, with the same job ID and proof, and still one bind, open and transport`, async () => {
      const h = setup({ answers: { [route]: [{ status: 503 }] } });
      expect(await h.run()).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
      expect(calls(h)).toHaveLength(2);
      expect(calls(h)[1]![0]).toBe(calls(h)[0]![0]);
      expect(calls(h)[1]![1]).toBe(calls(h)[0]![1]);
      expect(h.sent[route][1]).toEqual(h.sent[route][0]);
      expect(h.openerState.opened).toBe(1);
      expect(h.providerCalls).toHaveLength(1);
      expect(h.calls.result).toHaveLength(1);
      h.quiescent();
    });

    it(`${route}: a per-attempt deadline is treated as CONTROL_API_UNAVAILABLE and retried once`, async () => {
      const h = setup({ answers: { [route]: [{ hang: true }] } });
      const pending = h.start();
      await settle();
      expect(calls(h)).toHaveLength(1);
      h.time.advance(PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS);
      expect(await pending).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
      expect(calls(h)).toHaveLength(2);
      expect(h.signals[route][0]!.aborted).toBe(true);
      expect(h.openerState.opened).toBe(1);
      expect(h.providerCalls).toHaveLength(1);
      h.quiescent();
    });

    it(`${route}: two CONTROL_API_UNAVAILABLE stop, with no third attempt`, async () => {
      const h = setup({ answers: { [route]: [{ status: 503 }, { status: 502 }, {}] } });
      expect(await h.run()).toEqual(stoppedAt(stage, "CONTROL_API_UNAVAILABLE"));
      expect(calls(h)).toHaveLength(2);
      expect(h.openerState.opened).toBe(0);
      expect(h.calls.result).toHaveLength(0);
      h.quiescent();
    });

    it(`${route}: 409, authentication rejection, malformed response and a plain throw stop with no retry`, async () => {
      for (const [answer, code] of [
        [{ status: 409 }, rejected],
        [{ status: 401 }, "WORKER_AUTHENTICATION_REJECTED"],
        [{ status: 403 }, "WORKER_AUTHENTICATION_REJECTED"],
        [{ body: { providerVerificationJobId: JOB } }, "MALFORMED_CONTROL_RESPONSE"],
        [{ status: 404 }, "MALFORMED_CONTROL_RESPONSE"],
        [{ plainError: true }, "WORKER_CONFIGURATION_INVALID"],
      ] as const) {
        const h = setup({ answers: { [route]: [answer, {}] } });
        expect(await h.run(), code).toEqual(stoppedAt(stage, code));
        expect(calls(h), code).toHaveLength(1);
        expect(h.openerState.opened).toBe(0);
        expect(h.providerCalls).toHaveLength(0);
        expect(h.calls.result).toHaveLength(0);
        h.quiescent();
      }
    });

    it(`${route}: no retry when the checkpoint fails again before the replay`, async () => {
      // The first attempt answers 503 after clock lag that leaves the retry
      // checkpoint one millisecond short.
      const lag = route === "grant" ? 5751 : 8751;
      const h = setup({ answers: { [route]: [{ status: 503, jump: lag }, {}] } });
      expect(await h.run()).toEqual(abandonedAt(stage, "LEASE_BUDGET"));
      expect(calls(h)).toHaveLength(1);
      expect(h.openerState.opened).toBe(0);
      h.quiescent();
    });
  }

  it("never makes a VERIFYING call after an obtained acknowledgement, nor a grant after VERIFYING", async () => {
    const h = setup({ answers: { grant: [{ status: 503 }], verifying: [{ status: 503 }] } });
    expect(await h.run()).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
    expect(h.log.filter((entry) => ["grant", "verifying"].includes(entry))).toEqual(["grant", "grant", "verifying", "verifying"]);
    expect(h.calls.lease).toBe(1);
    expect(h.openerState.opened).toBe(1);
    expect(h.providerCalls).toHaveLength(1);
  });
});

describe("result reporting", () => {
  it("success on the first attempt: the report payload is exactly the Phase 6 report, forwarded by identity", async () => {
    const answer = () => providerResponse(200);
    const canonical = await canonicalReport(answer);
    const h = setup({ provider: answer });
    expect(await h.run()).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
    expect(h.calls.result).toHaveLength(1);
    const [jobId, proof, report, signal] = h.calls.result[0]!;
    expect(jobId).toBe(JOB);
    expect(proof).toBe(h.calls.grant[0]![1]);
    expect(report).toBe(canonical);
    expect((signal as AbortSignal).aborted).toBe(false);
    expect(h.sent.result).toEqual([{ fencingCounter: FENCE, leaseToken: LEASE_TOKEN, outcome: "VERIFIED", reasonCode: "VERIFICATION_SUCCEEDED" }]);
  });

  it("CONTROL_API_UNAVAILABLE then an exact replay: identical job ID, fencing counter, lease token, outcome and reason", async () => {
    for (const first of [{ status: 503 }, { hang: true }] as const) {
      const h = setup({ answers: { result: [first] } });
      const pending = h.start();
      await settle();
      h.time.advance(PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS);
      expect(await pending).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
      expect(h.calls.result).toHaveLength(2);
      expect(h.calls.result[1]![0]).toBe(h.calls.result[0]![0]);
      expect(h.calls.result[1]![1]).toBe(h.calls.result[0]![1]);
      expect(h.calls.result[1]![2]).toBe(h.calls.result[0]![2]);
      expect(h.sent.result).toHaveLength(2);
      expect(h.sent.result[1]).toEqual(h.sent.result[0]);
      h.quiescent();
    }
  });

  it("a second CONTROL_API_UNAVAILABLE stops at RESULT with no third attempt", async () => {
    const h = setup({ answers: { result: [{ status: 503 }, { status: 503 }, {}] } });
    expect(await h.run()).toEqual(stoppedAt("RESULT", "CONTROL_API_UNAVAILABLE"));
    expect(h.calls.result).toHaveLength(2);
    h.quiescent();
  });

  it("409, authentication rejection, malformed response and a plain throw stop at RESULT with no retry", async () => {
    for (const [answer, code] of [
      [{ status: 409 }, "PROVIDER_VERIFICATION_RESULT_REJECTED"],
      [{ status: 401 }, "WORKER_AUTHENTICATION_REJECTED"],
      [{ body: { providerVerificationJobId: JOB, state: "COMPLETED" } }, "MALFORMED_CONTROL_RESPONSE"],
      [{ plainError: true }, "WORKER_CONFIGURATION_INVALID"],
    ] as const) {
      const h = setup({ answers: { result: [answer, {}] } });
      expect(await h.run(), code).toEqual(stoppedAt("RESULT", code));
      expect(h.calls.result, code).toHaveLength(1);
      h.quiescent();
    }
  });

  it("shutdown after use settles does not cancel the result report", async () => {
    const h = setup();
    h.answers.result.push({ before: () => h.shutdown.abort() });
    expect(await h.run()).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
    expect(h.signals.result[0]!.aborted).toBe(false);
    h.quiescent();
  });

  it("replay after budgetEnd under scheduling lag: shutdown and budget never cancel result delivery; the server decides", async () => {
    for (const replay of [{}, { status: 409 }] as const) {
      const h = setup({
        provider: () => {
          // The provider answers at 20750, before budgetAbortAt (22000).
          h.time.advance(9000);
          return providerResponse(200);
        },
      });
      // The transport starts at 11750 (remaining() 16250).
      h.openerState.advance = 11750;
      h.answers.result.push({ hang: true }, replay);
      const pending = h.start();
      await settle();
      expect(h.calls.result).toHaveLength(1);
      expect(h.sentAt.result).toEqual([20750]);
      // The cause window is closed: the budget timer is cancelled and the
      // shutdown listener is gone, so shutdown aborts nothing in delivery.
      expect(h.time.budgetTimers()[0]).toMatchObject({ cleared: 1, fired: false });
      h.shutdown.abort();
      await settle();
      expect(h.signals.result[0]!.aborted).toBe(false);
      // Timer and callback scheduling lag: the clock is observed past
      // budgetEnd (28000) by the time the replay is sent.
      h.time.advanceTo(28500);
      const result = await pending;
      expect(h.calls.result).toHaveLength(2);
      expect(h.sentAt.result[1]).toBe(28500);
      expect(h.sentAt.result[1]).toBeGreaterThan(28000);
      expect(h.sent.result[1]).toEqual(h.sent.result[0]);
      expect(h.calls.result[1]![2]).toBe(h.calls.result[0]![2]);
      expect(h.signals.result[1]!.aborted).toBe(false);
      expect(result).toEqual(replay.status === 409 ? stoppedAt("RESULT", "PROVIDER_VERIFICATION_RESULT_REJECTED") : reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
      h.quiescent();
    }
  });
});

// --- capability, open and transport --------------------------------------

describe("capability, openOnceFor and the transport inside use", () => {
  it("binds once, opens once, and gives the transport the plaintext and the internal signal only", async () => {
    const h = setup();
    expect(await h.run()).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
    expect(h.openerState.opened).toBe(1);
    expect(h.providerCalls).toHaveLength(1);
    const call = h.providerCalls[0]!;
    // The provider header carries the plaintext string the opener produced.
    expect(call.keyMatched).toBe(true);
    // The external signal was never forwarded: during the request it carried
    // only the run's own listener, and Phase 6 added none.
    expect(call.externalListeners).toBe(1);
    expect(call.init!.signal).toBeInstanceOf(AbortSignal);
    expect(call.init!.signal).not.toBe(h.externalSignal);
    // The transport ran inside use: after the open, before the result.
    expect(h.log.indexOf("transport")).toBeGreaterThan(h.log.indexOf("open"));
    expect(h.log.indexOf("transport")).toBeLessThan(h.log.indexOf("result"));
  });

  it("the run controller is linked into Phase 6: an external shutdown during the transport aborts the provider request", async () => {
    const h = setup({ provider: () => new Promise(() => undefined) });
    const pending = h.start();
    await settle();
    const providerSignal = h.providerCalls[0]!.init!.signal!;
    expect(providerSignal.aborted).toBe(false);
    h.shutdown.abort();
    expect(await pending).toEqual(abandonedAt("VERIFICATION", "SHUTDOWN"));
    expect(providerSignal.aborted).toBe(true);
    expect(h.calls.result).toHaveLength(0);
    h.quiescent();
  });

  it("a Runway lease runs through the same composition", async () => {
    const answer = () => providerResponse(200, "{}");
    const canonical = await canonicalReport(answer, true);
    const h = setup({ runway: true, provider: answer });
    expect(await h.run()).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
    expect(h.calls.result[0]![2]).toBe(canonical);
    expect(h.providerCalls[0]!.keyMatched).toBe(true);
  });

  it("forwards every Phase 6 result verbatim, never remapped", async () => {
    const cases: Array<[string, string, (init: RequestInit | undefined) => unknown]> = [
      ["VERIFIED", "VERIFICATION_SUCCEEDED", () => providerResponse(200)],
      ["DEFINITIVE_FAILURE", "CREDENTIAL_REJECTED", () => providerResponse(401, '{"error":{"status":"UNAUTHENTICATED"}}')],
      ["DEFINITIVE_FAILURE", "CREDENTIAL_NOT_AUTHORIZED", () => providerResponse(403, '{"error":{"status":"PERMISSION_DENIED"}}')],
      ["INCONCLUSIVE", "PROVIDER_NETWORK_FAILURE", () => Promise.reject(new TypeError("fixture network"))],
      ["INCONCLUSIVE", "PROVIDER_OPERATION_DRIFT", () => providerResponse(302, "")],
      ["INCONCLUSIVE", "VERIFICATION_AMBIGUOUS", () => providerResponse(400, "{}")],
      ["INCONCLUSIVE", "PROVIDER_RESPONSE_TOO_LARGE", () => providerResponse(200, "{}", { "content-length": "70000" })],
      ["INCONCLUSIVE", "PROVIDER_RATE_OR_QUOTA_LIMITED", () => providerResponse(429, "{}")],
      ["INCONCLUSIVE", "PROVIDER_UNAVAILABLE", () => providerResponse(503, "{}")],
      ["INCONCLUSIVE", "PROVIDER_RESPONSE_MALFORMED", () => providerResponse(200, "not json")],
    ];
    // Both definitive reasons of the closed Phase 3 vocabulary are covered.
    expect(PROVIDER_VERIFICATION_REASONS_BY_OUTCOME.DEFINITIVE_FAILURE).toEqual(["CREDENTIAL_REJECTED", "CREDENTIAL_NOT_AUTHORIZED"]);
    for (const [outcome, reasonCode, answer] of cases) {
      const canonical = await canonicalReport(answer);
      expect(canonical, reasonCode).toEqual({ outcome, reasonCode });
      const h = setup({ provider: answer });
      expect(await h.run(), reasonCode).toEqual(reported(outcome, reasonCode));
      expect(h.calls.result[0]![2], reasonCode).toBe(canonical);
      expect(h.sent.result, reasonCode).toEqual([{ fencingCounter: FENCE, leaseToken: LEASE_TOKEN, outcome, reasonCode }]);
      // One provider request, whatever the result: no provider retry.
      expect(h.providerCalls, reasonCode).toHaveLength(1);
      expect(h.openerState.opened, reasonCode).toBe(1);
      h.quiescent();
    }
  });
});

// --- signal and shutdown ------------------------------------------------------

describe("internal signal and external shutdown", () => {
  it("an already-aborted external signal abandons at START with no lease and no listener", async () => {
    const h = setup();
    h.shutdown.abort();
    expect(await h.run()).toEqual(abandonedAt("START", "SHUTDOWN", null));
    expect(h.calls.lease).toBe(0);
    expect(h.time.state.monoReads + h.time.state.wallReads).toBe(0);
    h.quiescent();
  });

  it("an external signal whose listener installation throws stops at START", async () => {
    const h = setup();
    const signal = new AbortController().signal;
    Object.defineProperty(signal, "addEventListener", {
      value() {
        throw new TypeError("fixture listener");
      },
    });
    expect(await h.run({ shutdownSignal: signal })).toEqual(stoppedAt("START", "WORKER_CONFIGURATION_INVALID", null));
    expect(h.calls.lease).toBe(0);
  });

  for (const [stage, route] of [
    ["LEASE", "lease"],
    ["GRANT", "grant"],
    ["VERIFYING", "verifying"],
  ] as const) {
    it(`shutdown during ${route} abandons with SHUTDOWN at ${stage}, aborts that request's signal, and sends nothing further`, async () => {
      const h = setup({ answers: { [route]: [{ hang: true }] } });
      const pending = h.start();
      await settle();
      expect(h.signals[route]).toHaveLength(1);
      h.shutdown.abort();
      expect(await pending).toEqual(abandonedAt(stage, "SHUTDOWN", route === "lease" ? null : JOB));
      expect(h.signals[route][0]!.aborted).toBe(true);
      expect(h.openerState.opened).toBe(0);
      expect(h.providerCalls).toHaveLength(0);
      expect(h.calls.result).toHaveLength(0);
      if (route === "lease") expect(h.calls.grant).toHaveLength(0);
      if (route !== "verifying") expect(h.calls.verifying).toHaveLength(0);
      h.quiescent();
    });
  }

  it("shutdown while the opener is pending, opener then succeeds: use checks the cause, no transport, ABANDONED / VERIFICATION", async () => {
    const h = setup();
    const hold = deferred<void>();
    h.openerState.hold = hold;
    const pending = h.start();
    await settle();
    expect(h.openerState.opened).toBe(1);
    h.shutdown.abort();
    await settle();
    hold.resolve();
    expect(await pending).toEqual(abandonedAt("VERIFICATION", "SHUTDOWN"));
    expect(h.openerState.opened).toBe(1);
    expect(h.providerCalls).toHaveLength(0);
    expect(h.calls.result).toHaveLength(0);
    h.quiescent();
  });

  it("shutdown while the opener is pending, opener then fails: the first cause still decides", async () => {
    const h = setup();
    const hold = deferred<void>();
    h.openerState.hold = hold;
    h.openerState.fail = true;
    const pending = h.start();
    await settle();
    h.shutdown.abort();
    await settle();
    hold.resolve();
    expect(await pending).toEqual(abandonedAt("VERIFICATION", "SHUTDOWN"));
    expect(h.openerState.opened).toBe(1);
    expect(h.providerCalls).toHaveLength(0);
    expect(h.calls.result).toHaveLength(0);
    h.quiescent();
  });

  it("the budget expiring while the opener is pending does not race openOnceFor, and no transport follows", async () => {
    const h = setup();
    const hold = deferred<void>();
    h.openerState.hold = hold;
    const pending = h.start();
    await settle();
    h.time.advanceTo(22000);
    await settle();
    // Still pending: openOnceFor is awaited to settlement, never raced.
    let done = false;
    void pending.then(() => {
      done = true;
    });
    await settle();
    expect(done).toBe(false);
    hold.resolve();
    expect(await pending).toEqual(abandonedAt("VERIFICATION", "LEASE_BUDGET"));
    expect(h.providerCalls).toHaveLength(0);
    h.quiescent();
  });

  it("shutdown raised from inside the opener's settlement, after use is entered but before the transport: same result", async () => {
    const h = setup();
    h.openerState.afterOpen = () => h.shutdown.abort();
    expect(await h.run()).toEqual(abandonedAt("VERIFICATION", "SHUTDOWN"));
    expect(h.openerState.opened).toBe(1);
    expect(h.providerCalls).toHaveLength(0);
    expect(h.calls.result).toHaveLength(0);
    h.quiescent();
  });

  it("the first cause wins: a later shutdown or budget expiry changes nothing", async () => {
    {
      const h = setup({ provider: () => new Promise(() => undefined) });
      const pending = h.start({}, { deadlineTimer: (ms: number, onExpiry: () => void) => (ms === PROVIDER_VERIFICATION_TIMEOUT_MS ? () => undefined : h.time.timer(ms, onExpiry)) });
      await settle();
      h.shutdown.abort();
      h.time.advanceTo(30000);
      expect(await pending).toEqual(abandonedAt("VERIFICATION", "SHUTDOWN"));
    }
    {
      const h = setup({ provider: () => new Promise(() => undefined) });
      const pending = h.start({}, { deadlineTimer: (ms: number, onExpiry: () => void) => (ms === PROVIDER_VERIFICATION_TIMEOUT_MS ? () => undefined : h.time.timer(ms, onExpiry)) });
      await settle();
      h.time.advanceTo(22000);
      h.shutdown.abort();
      expect(await pending).toEqual(abandonedAt("VERIFICATION", "LEASE_BUDGET"));
    }
  });
});

// --- timers -------------------------------------------------------------------

describe("timer installation, expiry and cleanup", () => {
  it("a control deadline installation that throws or returns a non-function stops with no request", async () => {
    for (const bad of [
      () => {
        throw new TypeError("fixture timer");
      },
      () => "not a cleanup",
    ]) {
      const h = setup();
      expect(await h.run({}, { deadlineTimer: bad })).toEqual(stoppedAt("LEASE", "WORKER_CONFIGURATION_INVALID", null));
      expect(h.calls.lease).toBe(0);
      h.quiescent();
    }
  });

  it("a budget timer installation that fails stops at GRANT, even when it recorded expiry during the same call", async () => {
    for (const fireFirst of [false, true]) {
      const h = setup();
      const timer: ProviderVerificationDeadlineTimer = (ms, onExpiry) => {
        if (ms === PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS) return h.time.timer(ms, onExpiry);
        if (fireFirst) onExpiry();
        throw new TypeError("fixture budget timer");
      };
      expect(await h.run({}, { deadlineTimer: timer })).toEqual(stoppedAt("GRANT", "WORKER_CONFIGURATION_INVALID"));
      expect(h.calls.grant).toHaveLength(0);
      h.quiescent();
    }
  });

  it("synchronous expiry during installation: the guarded request is not sent", async () => {
    {
      // The budget timer expires as it is installed.
      const h = setup();
      const timer: ProviderVerificationDeadlineTimer = (ms, onExpiry) => {
        if (ms === PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS) return h.time.timer(ms, onExpiry);
        onExpiry();
        return () => undefined;
      };
      expect(await h.run({}, { deadlineTimer: timer })).toEqual(abandonedAt("GRANT", "LEASE_BUDGET"));
      expect(h.calls.grant).toHaveLength(0);
    }
    {
      // The lease deadline expires as it is installed: unavailable, nothing sent.
      const h = setup();
      const timer: ProviderVerificationDeadlineTimer = (_ms, onExpiry) => {
        onExpiry();
        return () => undefined;
      };
      expect(await h.run({}, { deadlineTimer: timer })).toEqual(stoppedAt("LEASE", "CONTROL_API_UNAVAILABLE", null));
      expect(h.calls.lease).toBe(0);
    }
  });

  it("late callbacks change nothing and throwing cleanups are swallowed", async () => {
    const h = setup();
    const timer: ProviderVerificationDeadlineTimer = (ms, onExpiry) => {
      const cancel = h.time.timer(ms, onExpiry);
      return () => {
        cancel();
        throw new TypeError("fixture cleanup");
      };
    };
    expect(await h.run({}, { deadlineTimer: timer })).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
    const before = JSON.stringify({ calls: h.calls.result.length, lease: h.calls.lease, grant: h.calls.grant.length, log: h.log });
    for (const entry of h.time.state.timers) entry.onExpiry();
    await settle();
    expect(JSON.stringify({ calls: h.calls.result.length, lease: h.calls.lease, grant: h.calls.grant.length, log: h.log })).toBe(before);
  });

  it("late control settlements and rejections after a deadline produce no unhandled rejection", async () => {
    const late = deferred<never>();
    const h = setup();
    const client = {
      ...h.client,
      requestProviderVerificationCredentialGrant: (...args: unknown[]) => {
        h.calls.grant.push(args);
        return late.promise;
      },
    };
    const pending = h.start({}, { client });
    await settle();
    h.time.advance(PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS);
    await settle();
    h.time.advance(PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS);
    expect(await pending).toEqual(stoppedAt("GRANT", "CONTROL_API_UNAVAILABLE"));
    late.reject(new Error("fixture late rejection"));
    await settle();
    expect(unhandled).toHaveLength(0);
  });

  it("uses the module-local default timer and clocks when none are injected", async () => {
    const h = setup();
    // The fake database stamps the lease from real time here.
    const realLeaseClient: ProviderVerificationControlClient = {
      ...h.client,
      leaseProviderVerification: async (signal?: AbortSignal) => {
        h.answers.lease.push({ expiresIn: PROVIDER_VERIFICATION_RUN_LEASE_MS });
        h.time.state.workerWallOffset = Date.now() - WALL_BASE;
        return h.client.leaseProviderVerification.call(h.client, signal);
      },
    };
    const result = await runProviderVerification(h.input, {
      client: realLeaseClient,
      opener: h.opener,
      fetchImpl: h.dependencies.fetchImpl,
      liveGate: h.dependencies.liveGate!,
    });
    allResults.push(result);
    expect(result).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
    expect(h.time.state.monoReads + h.time.state.wallReads).toBe(0);
    expect(getEventListeners(h.externalSignal, "abort").length).toBe(0);
  });
});

// --- local faults after VERIFYING ------------------------------------------

describe("post-VERIFYING local faults: no result report, server reconciliation", () => {
  it("credential shape failure inside use stops at VERIFICATION with PROVIDER_VERIFICATION_REQUEST_INVALID", async () => {
    const h = setup({ envelope: SHAPE_INVALID_ENVELOPE });
    expect(await h.run()).toEqual(stoppedAt("VERIFICATION", "PROVIDER_VERIFICATION_REQUEST_INVALID"));
    expect(h.calls.verifying).toHaveLength(1);
    expect(h.openerState.opened).toBe(1);
    expect(h.providerCalls).toHaveLength(0);
    expect(h.calls.result).toHaveLength(0);
    h.quiescent();
  });

  it("an opener failure (a plain throw, surfacing as CREDENTIAL_OPEN_FAILED) stops at VERIFICATION", async () => {
    const h = setup();
    h.openerState.fail = true;
    expect(await h.run()).toEqual(stoppedAt("VERIFICATION", "CREDENTIAL_OPEN_FAILED"));
    expect(h.openerState.opened).toBe(1);
    expect(h.providerCalls).toHaveLength(0);
    expect(h.calls.result).toHaveLength(0);
    h.quiescent();
  });

  it("ENVELOPE_INVALID at binding stops at BIND, opening nothing", async () => {
    const h = setup({ envelope: "not-an-envelope" });
    expect(await h.run()).toEqual(stoppedAt("BIND", "ENVELOPE_INVALID"));
    expect(h.calls.verifying).toHaveLength(1);
    expect(h.openerState.opened).toBe(0);
    expect(h.calls.result).toHaveLength(0);
    h.quiescent();
  });

  it("PROVIDER_VERIFICATION_AUTHORITY_MISMATCH at binding (a non-issued grant copy) stops at BIND", async () => {
    const h = setup({ answers: { grant: [{ transform: (value) => ({ ...(value as object) }) }] } });
    expect(await h.run()).toEqual(stoppedAt("BIND", "PROVIDER_VERIFICATION_AUTHORITY_MISMATCH"));
    expect(h.openerState.opened).toBe(0);
    expect(h.calls.result).toHaveLength(0);
  });

  it("FORBIDDEN_PROVIDER_ENVIRONMENT at the binder's own guard (defence in depth) stops at BIND", async () => {
    const environment: Record<string, string | undefined> = {};
    const h = setup({ environment, answers: { verifying: [{ before: () => (environment[FORBIDDEN_PROVIDER_ENVIRONMENT_VARIABLES[0]!] = "") }] } });
    expect(await h.run()).toEqual(stoppedAt("BIND", "FORBIDDEN_PROVIDER_ENVIRONMENT"));
    expect(h.openerState.opened).toBe(0);
    expect(h.calls.result).toHaveLength(0);
  });

  it("a Phase 6 deadline installation fault (plain TypeError for the 10000 ms timer only) stops at VERIFICATION with WORKER_CONFIGURATION_INVALID", async () => {
    const h = setup();
    const timer: ProviderVerificationDeadlineTimer = (ms, onExpiry) => {
      if (ms === PROVIDER_VERIFICATION_TIMEOUT_MS) throw new TypeError("fixture provider timer");
      return h.time.timer(ms, onExpiry);
    };
    expect(await h.run({}, { deadlineTimer: timer })).toEqual(stoppedAt("VERIFICATION", "WORKER_CONFIGURATION_INVALID"));
    expect(h.openerState.opened).toBe(1);
    expect(h.providerCalls).toHaveLength(0);
    expect(h.calls.result).toHaveLength(0);
    h.quiescent();
  });
});

// --- never reject -------------------------------------------------------------

describe("the run promise never rejects", () => {
  it("plain throws from every client method become STOPPED with the current stage and WORKER_CONFIGURATION_INVALID", async () => {
    for (const [route, stage] of [
      ["lease", "LEASE"],
      ["grant", "GRANT"],
      ["verifying", "VERIFYING"],
      ["result", "RESULT"],
    ] as const) {
      const h = setup();
      const method = {
        lease: "leaseProviderVerification",
        grant: "requestProviderVerificationCredentialGrant",
        verifying: "acknowledgeProviderVerificationVerifying",
        result: "reportProviderVerificationResult",
      }[route];
      // A synchronous throw of a non-Error value as well as a rejection.
      for (const thrower of [
        () => {
          throw "fixture";
        },
        () => Promise.reject(new Error("fixture")),
      ]) {
        const counted = { calls: 0 };
        const client = {
          ...h.client,
          [method]: (...args: unknown[]) => {
            counted.calls += 1;
            void args;
            return thrower();
          },
        };
        const result = await h.run({}, { client });
        expect(result, route).toEqual(stoppedAt(stage, "WORKER_CONFIGURATION_INVALID", route === "lease" ? null : JOB));
        expect(counted.calls, route).toBe(1);
        expect(Object.keys(result).sort()).toEqual(["code", "providerVerificationJobId", "stage", "status"]);
      }
    }
  });

  it("the same throw after a recorded cause inside the cause window returns ABANDONED with that cause", async () => {
    for (const [route, stage] of [
      ["grant", "GRANT"],
      ["verifying", "VERIFYING"],
    ] as const) {
      const h = setup();
      h.answers[route].push({ before: () => h.shutdown.abort(), plainError: true });
      expect(await h.run(), route).toEqual(abandonedAt(stage, "SHUTDOWN"));
    }
  });

  it("an opener accessor that changes between validation and opening still settles", async () => {
    const h = setup();
    let reads = 0;
    const opener = {
      get open() {
        reads += 1;
        if (reads === 1) return async () => PLAINTEXT;
        throw new TypeError("fixture accessor");
      },
    };
    expect(await h.run({}, { opener })).toEqual(stoppedAt("VERIFICATION", "CREDENTIAL_OPEN_FAILED"));
    expect(h.providerCalls).toHaveLength(0);
  });
});

// --- R44B11G unsupported-lease deferral ---------------------------------------
//
// Architecture R44B11G 5.2 and 11 (R1-R13, SD1-SD12, SD4-A/B/C, SD12-S). Every
// decisive case is deterministic: the injected deadlineTimer counts its calls
// (call #1 is the lease attempt, call #2 the deferral attempt), a lease member
// getter records shutdown synchronously, and injected deferral methods settle
// under test control.

describe("R44B11G unsupported-lease deferral run (R1-R13, SD1-SD12)", () => {
  const DEFERRED_KEYS = ["cause", "deferredUntil", "disposition", "providerVerificationJobId", "reason", "status"];
  const OTHER_KEYS = ["cause", "detail", "disposition", "providerVerificationJobId", "reason", "status"];
  const DEFERRED_UNTIL = new Date(DEFERRED_UNTIL_MS);
  // Every disposition x cause combination produced in this block (SD10).
  const produced = new Set<string>();

  // A lease the worker refuses (UNSUPPORTED_PROVIDER), answered by the fake API.
  const unsupported = () => setup({ answers: { lease: [{ provider: "OTHER_PROVIDER" }] } });

  function expectUnsupported(result: ProviderVerificationRunResult, disposition: string, detailOrUntil: string | Date, cause: "SHUTDOWN" | null) {
    const common = { status: "UNSUPPORTED_LEASE", providerVerificationJobId: JOB, reason: "UNSUPPORTED_PROVIDER", disposition };
    expect(result).toEqual(disposition === "DEFERRED" ? { ...common, deferredUntil: detailOrUntil, cause } : { ...common, detail: detailOrUntil, cause });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result).sort()).toEqual(disposition === "DEFERRED" ? DEFERRED_KEYS : OTHER_KEYS);
    produced.add(`${disposition}|${cause}`);
  }

  // Nothing after classification but the deferral: no budget, grant,
  // VERIFYING, open, transport or result report, and no wall-clock read.
  const nothingButDeferral = (h: ReturnType<typeof setup>) => {
    nothingAfterLease(h);
    expect(h.time.budgetTimers()).toEqual([]);
    expect(h.time.state.wallReads).toBe(0);
    expect(h.log.filter((entry) => ["grant", "verifying", "open", "transport", "result"].includes(entry))).toEqual([]);
  };

  // The counting deadline-timer seam: call #2 (the deferral attempt) is replaced.
  function seamTimer(h: ReturnType<typeof setup>, second: (ms: number, onExpiry: () => void) => unknown) {
    const counter = { calls: 0 };
    const timer = ((ms: number, onExpiry: () => void) => {
      counter.calls += 1;
      return counter.calls === 2 ? second(ms, onExpiry) : h.time.timer(ms, onExpiry);
    }) as ProviderVerificationDeadlineTimer;
    return { timer, counter };
  }
  // Call #2 returns a cancel that synchronously records shutdown (SD4 seam).
  const shutdownOnCancel = (h: ReturnType<typeof setup>) => (ms: number, onExpiry: () => void) => {
    const cancel = h.time.timer(ms, onExpiry);
    return () => {
      cancel();
      h.shutdown.abort();
    };
  };
  // SD2 technique: a lease member getter records shutdown synchronously, after
  // the lease and before the deferral attempt.
  const shutdownDuringLeaseRead = (h: ReturnType<typeof setup>) => {
    h.answers.lease.splice(0, h.answers.lease.length, {
      provider: "OTHER_PROVIDER",
      transform: (value) => {
        const lease = value as Record<string, unknown>;
        return {
          ...lease,
          get leaseExpiresAt() {
            h.shutdown.abort();
            return lease.leaseExpiresAt;
          },
        };
      },
    });
  };
  // An injected deferral method, counting its calls.
  const injectedDefer = (h: ReturnType<typeof setup>, answer: () => unknown) => ({
    ...h.client,
    deferUnsupportedProviderVerification: (...args: unknown[]) => {
      h.calls.defer.push(args);
      return answer();
    },
  });

  it("R6/SD5: a validated deferral is DEFERRED with cause null, from exactly one request carrying exactly the proof and refusal", async () => {
    const h = unsupported();
    const result = await h.run();
    expectUnsupported(result, "DEFERRED", DEFERRED_UNTIL, null);
    expect(h.calls.defer).toHaveLength(1);
    const [jobId, proof, refusal, signal] = h.calls.defer[0]!;
    expect([jobId, proof, refusal]).toEqual([JOB, { fencingCounter: FENCE, leaseToken: LEASE_TOKEN }, "UNSUPPORTED_PROVIDER"]);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(h.calls.receivers.at(-1)).toBe(h.client);
    expect(h.sent.unsupported).toEqual([{ fencingCounter: FENCE, leaseToken: LEASE_TOKEN, refusal: "UNSUPPORTED_PROVIDER" }]);
    // CLASSIFY -> DEFERRAL, then return: the deferral is the only request after the lease.
    expect(h.log).toEqual(["gate", "read-open", "environment", "shutdown-link", "lease", "defer"]);
    // The deferral attempt uses the 3000 ms control deadline, and no budget timer.
    expect(h.time.state.timers.map((entry) => entry.ms)).toEqual([PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS, PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS]);
    nothingButDeferral(h);
    h.quiescent();
  });

  it("R7: 409 and 401/403 are REJECTED with the client's code, with no retry", async () => {
    for (const [status, code] of [
      [409, "PROVIDER_VERIFICATION_DEFERRAL_REJECTED"],
      [401, "WORKER_AUTHENTICATION_REJECTED"],
      [403, "WORKER_AUTHENTICATION_REJECTED"],
    ] as const) {
      const h = unsupported();
      h.answers.unsupported.push({ status }, {});
      expectUnsupported(await h.run(), "REJECTED", code, null);
      expect(h.calls.defer, String(status)).toHaveLength(1);
      expect(h.sent.unsupported).toHaveLength(1);
      nothingButDeferral(h);
      h.quiescent();
    }
  });

  it("R9/SD8: 5xx, a lost response and the 3000 ms deadline are UNCONFIRMED / CONTROL_API_UNAVAILABLE, never DEFERRED, with no retry", async () => {
    for (const answer of [{ status: 500 }, { status: 503 }, { transportFailure: true }] as const) {
      const h = unsupported();
      h.answers.unsupported.push(answer, {});
      expectUnsupported(await h.run(), "UNCONFIRMED", "CONTROL_API_UNAVAILABLE", null);
      expect(h.calls.defer).toHaveLength(1);
      expect(h.sent.unsupported).toHaveLength(1);
      nothingButDeferral(h);
      h.quiescent();
    }
    const h = unsupported();
    h.answers.unsupported.push({ hang: true });
    const pending = h.start();
    await settle();
    expect(h.calls.defer).toHaveLength(1);
    h.time.advance(PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS - 1);
    await settle();
    expect(h.signals.unsupported[0]!.aborted).toBe(false);
    h.time.advance(1);
    expectUnsupported(await pending, "UNCONFIRMED", "CONTROL_API_UNAVAILABLE", null);
    expect(h.signals.unsupported[0]!.aborted).toBe(true);
    expect(h.calls.defer).toHaveLength(1);
    nothingButDeferral(h);
    h.quiescent();
  });

  it("R10/SD9/M1: a 404 from an older API, another unexpected status or a malformed 200 is UNCONFIRMED / MALFORMED_CONTROL_RESPONSE", async () => {
    for (const answer of [
      { status: 404 },
      { status: 400 },
      { status: 405 },
      { body: { providerVerificationJobId: JOB, fencingCounter: FENCE, state: "LEASED", deferredUntil: iso(DEFERRED_UNTIL_MS) } },
      { body: { providerVerificationJobId: JOB, fencingCounter: FENCE + 1, state: "QUEUED", deferredUntil: iso(DEFERRED_UNTIL_MS) } },
      { body: { providerVerificationJobId: JOB, fencingCounter: FENCE, state: "QUEUED", deferredUntil: "soon" } },
      { body: { providerVerificationJobId: JOB, fencingCounter: FENCE, state: "QUEUED", deferredUntil: iso(DEFERRED_UNTIL_MS), deferralSeconds: 300 } },
      { body: { providerVerificationJobId: JOB, fencingCounter: FENCE, state: "QUEUED" } },
    ] as const) {
      const h = unsupported();
      h.answers.unsupported.push(answer, {});
      expectUnsupported(await h.run(), "UNCONFIRMED", "MALFORMED_CONTROL_RESPONSE", null);
      expect(h.calls.defer).toHaveLength(1);
      nothingButDeferral(h);
      h.quiescent();
    }
  });

  it("R11: any other closed code (including a plain throw, as WORKER_CONFIGURATION_INVALID) is UNCONFIRMED with that code", async () => {
    const h = unsupported();
    h.answers.unsupported.push({ plainError: true });
    expectUnsupported(await h.run(), "UNCONFIRMED", "WORKER_CONFIGURATION_INVALID", null);
    expect(h.calls.defer).toHaveLength(1);
    const other = unsupported();
    expectUnsupported(
      await other.run({}, { client: injectedDefer(other, () => Promise.reject(new WorkerError("LEASE_EXPIRED"))) }),
      "UNCONFIRMED",
      "LEASE_EXPIRED",
      null,
    );
    expect(other.calls.defer).toHaveLength(1);
    nothingButDeferral(other);
    other.quiescent();
  });

  it("R4: PROVIDER_VERIFICATION_REQUEST_INVALID from the client's local validation is NOT_SENT, synchronous or asynchronous", async () => {
    for (const answer of [
      () => {
        throw new WorkerError("PROVIDER_VERIFICATION_REQUEST_INVALID");
      },
      () => Promise.reject(new WorkerError("PROVIDER_VERIFICATION_REQUEST_INVALID")),
    ]) {
      const h = unsupported();
      expectUnsupported(await h.run({}, { client: injectedDefer(h, answer) }), "NOT_SENT", "PROVIDER_VERIFICATION_REQUEST_INVALID", null);
      expect(h.calls.defer).toHaveLength(1);
      expect(h.sent.unsupported).toHaveLength(0);
      nothingButDeferral(h);
      h.quiescent();
    }
  });

  it("R1/SD7: a deferral deadline timer that throws or is not a function is NOT_SENT / WORKER_CONFIGURATION_INVALID with zero requests", async () => {
    for (const second of [
      () => {
        throw new TypeError("fixture timer");
      },
      () => "not a cancel",
    ]) {
      const h = unsupported();
      const seam = seamTimer(h, second);
      expectUnsupported(await h.run({}, { deadlineTimer: seam.timer }), "NOT_SENT", "WORKER_CONFIGURATION_INVALID", null);
      expect(seam.counter.calls).toBe(2);
      expect(h.calls.defer).toHaveLength(0);
      expect(h.sent.unsupported).toHaveLength(0);
      nothingButDeferral(h);
      h.quiescent();
    }
    // SD7 with a cause already recorded (SD2 technique): the timer failure ranks first; the cause is reported.
    const h = unsupported();
    shutdownDuringLeaseRead(h);
    const seam = seamTimer(h, () => {
      throw new TypeError("fixture timer");
    });
    expectUnsupported(await h.run({}, { deadlineTimer: seam.timer }), "NOT_SENT", "WORKER_CONFIGURATION_INVALID", "SHUTDOWN");
    expect(h.calls.defer).toHaveLength(0);
    nothingButDeferral(h);
    h.quiescent();
  });

  it("R2/SD2: shutdown recorded after the lease and before the send is NOT_SENT / SHUTDOWN, cause SHUTDOWN, zero deferral requests", async () => {
    const h = unsupported();
    shutdownDuringLeaseRead(h);
    expectUnsupported(await h.run(), "NOT_SENT", "SHUTDOWN", "SHUTDOWN");
    expect(h.calls.lease).toBe(1);
    expect(h.calls.defer).toHaveLength(0);
    expect(h.sent.unsupported).toHaveLength(0);
    nothingButDeferral(h);
    h.quiescent();
  });

  it("R3/SD11: a deadline fired synchronously while installing the deferral timer is NOT_SENT / CONTROL_API_UNAVAILABLE; with a recorded cause, cause SHUTDOWN", async () => {
    const expiresAtInstall = (_ms: number, onExpiry: () => void) => {
      onExpiry();
      return () => undefined;
    };
    for (const recordCause of [false, true]) {
      const h = unsupported();
      if (recordCause) shutdownDuringLeaseRead(h);
      const seam = seamTimer(h, expiresAtInstall);
      expectUnsupported(await h.run({}, { deadlineTimer: seam.timer }), "NOT_SENT", "CONTROL_API_UNAVAILABLE", recordCause ? "SHUTDOWN" : null);
      // sent === false: the closure never ran, so no client call and no control request.
      expect(h.calls.defer).toHaveLength(0);
      expect(h.sent.unsupported).toHaveLength(0);
      nothingButDeferral(h);
      h.quiescent();
    }
  });

  it("R8/SD3: shutdown while the deferral is in flight is UNCONFIRMED / SHUTDOWN, one request, and the late settlement is absorbed", async () => {
    // The real client over a request that never settles.
    const h = unsupported();
    h.answers.unsupported.push({ hang: true });
    const pending = h.start();
    await settle();
    expect(h.calls.defer).toHaveLength(1);
    h.shutdown.abort();
    expectUnsupported(await pending, "UNCONFIRMED", "SHUTDOWN", "SHUTDOWN");
    expect(h.signals.unsupported[0]!.aborted).toBe(true);
    nothingButDeferral(h);
    h.quiescent();
    // An injected method whose promise settles after the run returned: resolution and rejection.
    for (const settleLate of ["resolve", "reject"] as const) {
      const late = deferred<unknown>();
      const g = unsupported();
      const running = g.start({}, { client: injectedDefer(g, () => late.promise) });
      await settle();
      g.shutdown.abort();
      expectUnsupported(await running, "UNCONFIRMED", "SHUTDOWN", "SHUTDOWN");
      if (settleLate === "resolve") late.resolve({ providerVerificationJobId: JOB, fencingCounter: FENCE, state: "QUEUED", deferredUntil: DEFERRED_UNTIL });
      else late.reject(new WorkerError("CONTROL_API_UNAVAILABLE"));
      await settle();
      expect(g.calls.defer).toHaveLength(1);
      g.quiescent();
    }
  });

  it("SD4-A: a validated deferral settled before a shutdown recorded inside finish() stays DEFERRED, with cause SHUTDOWN", async () => {
    const h = unsupported();
    const seam = seamTimer(h, shutdownOnCancel(h));
    expectUnsupported(await h.run({}, { deadlineTimer: seam.timer }), "DEFERRED", DEFERRED_UNTIL, "SHUTDOWN");
    expect(seam.counter.calls).toBe(2);
    // Call #1's cancel did not abort: the lease attempt was unaffected.
    expect(h.calls.lease).toBe(1);
    expect(h.calls.defer).toHaveLength(1);
    // The recorded cause took effect once; a second abort changes nothing.
    h.shutdown.abort();
    await settle();
    nothingButDeferral(h);
    h.quiescent();
  });

  it("SD4-B: a 409 settled before a shutdown recorded inside finish() stays REJECTED, with cause SHUTDOWN", async () => {
    const h = unsupported();
    h.answers.unsupported.push({ status: 409 });
    const seam = seamTimer(h, shutdownOnCancel(h));
    expectUnsupported(await h.run({}, { deadlineTimer: seam.timer }), "REJECTED", "PROVIDER_VERIFICATION_DEFERRAL_REJECTED", "SHUTDOWN");
    expect(h.calls.lease).toBe(1);
    expect(h.calls.defer).toHaveLength(1);
    nothingButDeferral(h);
    h.quiescent();
  });

  it("SD4-C (supplementary race): shutdown in the same turn as the deferral keeps the invariants", async () => {
    const h = unsupported();
    h.answers.unsupported.push({ before: () => h.shutdown.abort() });
    const result = await h.run();
    expect(result.status).toBe("UNSUPPORTED_LEASE");
    if (result.status !== "UNSUPPORTED_LEASE") return;
    expect(result.cause).toBe("SHUTDOWN");
    if (result.disposition === "DEFERRED") expect(result.deferredUntil).toEqual(DEFERRED_UNTIL);
    else expect(result.disposition).toBe("UNCONFIRMED");
    expect(h.calls.defer).toHaveLength(1);
    h.quiescent();
  });

  it.each(["same synchronous turn", "later microtask"] as const)("SD4-C: successful fake control response resolves with shutdown in the %s", async (schedule) => {
    const h = unsupported();
    const fetchResponse = deferred<Response>();
    const response = new Response(
      JSON.stringify({ providerVerificationJobId: JOB, fencingCounter: FENCE, state: "QUEUED", deferredUntil: iso(DEFERRED_UNTIL_MS) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
    let validated = 0;
    h.answers.unsupported.push({
      response: fetchResponse.promise,
      transform: (value) => {
        // through() reaches this hook only after the real HTTP client validated.
        expect(value).toEqual({ providerVerificationJobId: JOB, fencingCounter: FENCE, state: "QUEUED", deferredUntil: DEFERRED_UNTIL });
        validated += 1;
        return value;
      },
    });
    const added = vi.spyOn(AbortSignal.prototype, "addEventListener");
    const removed = vi.spyOn(AbortSignal.prototype, "removeEventListener");
    const events: string[] = [];
    let shutdownRecorded = false;
    const pending = h.start();
    const returned = pending.then((result) => {
      events.push("return");
      return { result, shutdownRecorded, validated };
    });
    try {
      // Drain runnable work, without advancing time: the actual fetch is pending.
      await settle();
      expect(h.calls.lease).toBe(1);
      expect(h.calls.defer).toHaveLength(1);
      expect(h.sent.unsupported).toHaveLength(1);
      expect(validated).toBe(0);
      expect(h.externalSignal.aborted).toBe(false);
      expect(getEventListeners(h.externalSignal, "abort")).toHaveLength(1);
      expect(h.signals.unsupported[0]!.aborted).toBe(false);
      // Both linked attempts install their listener on the internal run signal.
      const links = added.mock.calls.flatMap((args, index) =>
        args[0] === "abort" ? [{ signal: added.mock.contexts[index] as AbortSignal, listener: args[1] }] : [],
      );
      expect(links).toHaveLength(2);
      expect(links[0]!.signal).toBe(links[1]!.signal);
      const abort = () => {
        events.push("shutdown");
        h.shutdown.abort();
        // Observing the internal signal proves the run recorded the shutdown.
        shutdownRecorded = links[1]!.signal.aborted;
      };
      events.push("resolve");
      fetchResponse.resolve(response);
      if (schedule === "same synchronous turn") abort();
      else queueMicrotask(abort);

      const atReturn = await returned;
      expect(events).toEqual(["resolve", "shutdown", "return"]);
      expect(atReturn.shutdownRecorded).toBe(true);
      expect(atReturn.result.status).toBe("UNSUPPORTED_LEASE");
      if (atReturn.result.status !== "UNSUPPORTED_LEASE") throw new Error("fixture expected unsupported lease");
      const cause = atReturn.shutdownRecorded ? "SHUTDOWN" : null;
      if (atReturn.result.disposition === "DEFERRED") {
        expect(atReturn.validated).toBe(1);
        expectUnsupported(atReturn.result, "DEFERRED", DEFERRED_UNTIL, cause);
      } else {
        expectUnsupported(atReturn.result, "UNCONFIRMED", "SHUTDOWN", cause);
        expect(h.signals.unsupported[0]!.aborted).toBe(true);
      }
      h.quiescent();
      for (const { signal, listener } of links) {
        expect(getEventListeners(signal, "abort")).toHaveLength(0);
        expect(removed.mock.calls.filter((args, index) => removed.mock.contexts[index] === signal && args[0] === "abort" && args[1] === listener)).toHaveLength(1);
      }
      const snapshot = JSON.stringify(atReturn.result);
      // Let the losing client's parsing/validation chain finish after cancellation.
      await settle();
      expect(validated).toBe(1);
      expect(response.bodyUsed).toBe(true);
      h.shutdown.abort();
      h.time.advance(PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS);
      await settle();
      expect(JSON.stringify(atReturn.result)).toBe(snapshot);
      expect(h.calls.defer).toHaveLength(1);
      expect(h.sent.unsupported).toHaveLength(1);
      expect(h.calls.lease).toBe(1);
      expect(h.time.state.timers).toHaveLength(2);
      expect(h.time.state.timers.every((timer) => timer.cleared === 1 && !timer.fired)).toBe(true);
      nothingButDeferral(h);
      h.quiescent();
      expect(unhandled).toHaveLength(0);
    } finally {
      h.shutdown.abort();
      fetchResponse.resolve(response);
      await returned;
      await settle();
      added.mockRestore();
      removed.mockRestore();
    }
  });

  it("SD6: a shutdown after the run returned changes nothing and finds no listener", async () => {
    const h = unsupported();
    const result = await h.run();
    expectUnsupported(result, "DEFERRED", DEFERRED_UNTIL, null);
    h.quiescent();
    const snapshot = JSON.stringify(result);
    h.shutdown.abort();
    await settle();
    expect(JSON.stringify(result)).toBe(snapshot);
    expect(h.calls.defer).toHaveLength(1);
  });

  it("R5/SD12: an injected value with an unusable deferredUntil is UNCONFIRMED / WORKER_CONFIGURATION_INVALID, never DEFERRED, read at most once, never rejecting", async () => {
    const forged = Object.create(Date.prototype) as Date;
    const cases: Array<[string, (reads: { count: number }) => unknown]> = [
      ["invalid Date", () => ({ providerVerificationJobId: JOB, fencingCounter: FENCE, state: "QUEUED", deferredUntil: new Date(Number.NaN) })],
      ["string", () => ({ providerVerificationJobId: JOB, fencingCounter: FENCE, state: "QUEUED", deferredUntil: "2026-11-24T00:00:00.000Z" })],
      [
        "throwing getter",
        (reads) => ({
          providerVerificationJobId: JOB,
          fencingCounter: FENCE,
          state: "QUEUED",
          get deferredUntil() {
            reads.count += 1;
            throw new TypeError("fixture accessor");
          },
        }),
      ],
      ["forged Date", () => ({ providerVerificationJobId: JOB, fencingCounter: FENCE, state: "QUEUED", deferredUntil: forged })],
      ["null value", () => null],
    ];
    for (const [name, value] of cases) {
      const reads = { count: 0 };
      const h = unsupported();
      const result = await h.run({}, { client: injectedDefer(h, () => Promise.resolve(value(reads))) });
      expectUnsupported(result, "UNCONFIRMED", "WORKER_CONFIGURATION_INVALID", null);
      expect(h.calls.defer, name).toHaveLength(1);
      expect(reads.count, name).toBeLessThanOrEqual(1);
      nothingButDeferral(h);
      h.quiescent();
    }
  });

  it("SD12-S: an unusable deferredUntil with a shutdown recorded inside finish() is UNCONFIRMED with cause SHUTDOWN, read exactly once", async () => {
    for (const variant of ["NaN", "throws"] as const) {
      const reads = { count: 0 };
      const h = unsupported();
      const value = {
        providerVerificationJobId: JOB,
        fencingCounter: FENCE,
        state: "QUEUED",
        get deferredUntil(): Date {
          reads.count += 1;
          if (variant === "throws") throw new TypeError("fixture accessor");
          return new Date(Number.NaN);
        },
      };
      const seam = seamTimer(h, shutdownOnCancel(h));
      const result = await h.run({}, { client: injectedDefer(h, () => Promise.resolve(value)), deadlineTimer: seam.timer });
      expectUnsupported(result, "UNCONFIRMED", "WORKER_CONFIGURATION_INVALID", "SHUTDOWN");
      expect(reads.count, variant).toBe(1);
      expect(h.calls.lease).toBe(1);
      expect(h.calls.defer).toHaveLength(1);
      nothingButDeferral(h);
      h.quiescent();
    }
  });

  it("R12: at most one deferral request on every path, and exactly one wherever the closure ran", async () => {
    // The cases above each assert their single call; here, a retryable-looking
    // failure followed by a success answer is still never retried.
    for (const first of [{ status: 503 }, { transportFailure: true }, { status: 409 }, { status: 404 }] as const) {
      const h = unsupported();
      h.answers.unsupported.push(first, {}, {});
      await h.run();
      expect(h.calls.defer, JSON.stringify(first)).toHaveLength(1);
      expect(h.sent.unsupported, JSON.stringify(first)).toHaveLength(1);
    }
  });

  it("R13: a client without the deferral method stops at START before any lease", async () => {
    const h = unsupported();
    const { deferUnsupportedProviderVerification: _omitted, ...withoutDeferral } = h.client;
    expect(await h.run({}, { client: withoutDeferral })).toEqual(stoppedAt("START", "WORKER_CONFIGURATION_INVALID", null));
    expect(await h.run({}, { client: { ...h.client, deferUnsupportedProviderVerification: "defer" } })).toEqual(stoppedAt("START", "WORKER_CONFIGURATION_INVALID", null));
    expect(h.calls.lease).toBe(0);
    expect(h.calls.defer).toHaveLength(0);
  });

  it("SD1: an external signal already aborted at entry is ABANDONED / START / SHUTDOWN with no lease and no deferral", async () => {
    const h = unsupported();
    h.shutdown.abort();
    expect(await h.run()).toEqual(abandonedAt("START", "SHUTDOWN", null));
    expect(h.calls.lease).toBe(0);
    expect(h.calls.defer).toHaveLength(0);
    h.quiescent();
  });

  it("supported verification is unchanged: no deferral request on the supported path", async () => {
    const h = setup();
    expect(await h.run()).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
    expect(h.calls.defer).toHaveLength(0);
    expect(h.sent.unsupported).toHaveLength(0);
  });

  it("the default live gate still refuses before any lease or deferral", async () => {
    const h = unsupported();
    expect(await h.run({}, { liveGate: undefined })).toEqual({ status: "DISABLED" });
    expect(h.calls.lease).toBe(0);
    expect(h.calls.defer).toHaveLength(0);
  });

  it("SD10: every disposition x cause combination was produced deterministically above", () => {
    expect([...produced].sort()).toEqual(
      [
        "DEFERRED|null",
        "DEFERRED|SHUTDOWN",
        "REJECTED|null",
        "REJECTED|SHUTDOWN",
        "UNCONFIRMED|null",
        "UNCONFIRMED|SHUTDOWN",
        "NOT_SENT|null",
        "NOT_SENT|SHUTDOWN",
      ].sort(),
    );
  });
});

// --- cross-cutting checks over every result in this file ---------------------

describe("secret safety and result shapes (all results above)", () => {
  it("no result carries a credential, lease token, machine credential, envelope or error object, and nothing is logged", async () => {
    const spies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((name) => vi.spyOn(console, name));
    const h = setup();
    const result = await h.run();
    expect(result).toEqual(reported("VERIFIED", "VERIFICATION_SUCCEEDED"));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(allResults.length).toBeGreaterThan(50);
    for (const entry of allResults) {
      const text = JSON.stringify(entry);
      expect(text.includes(PLAINTEXT)).toBe(false);
      expect(text.includes(LEASE_TOKEN)).toBe(false);
      expect(text.includes(MACHINE)).toBe(false);
      expect(text.includes("ciphertext") || text.includes("sealed")).toBe(false);
      expect(Object.isFrozen(entry)).toBe(true);
      for (const value of Object.values(entry)) {
        expect(value === null || ["string", "number"].includes(typeof value) || value instanceof Date).toBe(true);
        expect(value instanceof Error).toBe(false);
      }
      const keys = Object.keys(entry).sort();
      // R44B11G widens the UNSUPPORTED_LEASE member: a DEFERRED result carries
      // deferredUntil, every other disposition carries detail.
      const expectedKeys: Record<string, string[]> = {
        DISABLED: ["status"],
        NO_WORK: ["status"],
        UNSUPPORTED_LEASE:
          entry.status === "UNSUPPORTED_LEASE" && entry.disposition === "DEFERRED"
            ? ["cause", "deferredUntil", "disposition", "providerVerificationJobId", "reason", "status"]
            : ["cause", "detail", "disposition", "providerVerificationJobId", "reason", "status"],
        REPORTED: ["completedAt", "fencingCounter", "outcome", "providerVerificationJobId", "reasonCode", "status"],
        ABANDONED: ["cause", "providerVerificationJobId", "stage", "status"],
        STOPPED: ["code", "providerVerificationJobId", "stage", "status"],
      };
      expect(keys).toEqual(expectedKeys[entry.status]);
      if (entry.status === "ABANDONED") {
        expect(["START", "LEASE", "GRANT", "VERIFYING", "BIND", "VERIFICATION"]).toContain(entry.stage);
        expect(["GATE", "ENVIRONMENT", "RESULT"]).not.toContain(entry.stage);
      }
    }
    // The result report payloads never carry the credential either.
    expect(JSON.stringify(h.sent).includes(PLAINTEXT)).toBe(false);
  });

  it("covers every orchestration status", () => {
    expect([...new Set(allResults.map((entry) => entry.status))].sort()).toEqual(["ABANDONED", "DISABLED", "NO_WORK", "REPORTED", "STOPPED", "UNSUPPORTED_LEASE"]);
  });
});
