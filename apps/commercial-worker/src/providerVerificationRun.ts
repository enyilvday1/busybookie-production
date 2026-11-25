import { requireLiveProviderVerification, type ProviderVerificationConfig } from "./providerVerificationConfig.js";
import {
  classifyProviderVerificationLease,
  type ProviderVerificationOutcome,
  type ProviderVerificationReasonCode,
  type ProviderVerificationResultReport,
} from "./providerVerificationContract.js";
import { bindProviderVerificationCredential } from "./providerVerificationCredentialOpening.js";
import {
  performProviderVerification,
  type ProviderVerificationDeadlineTimer,
  type ProviderVerificationTransportDependencies,
} from "./providerVerificationTransport.js";
import type { LeaseProof, ProviderVerificationControlClient } from "./workerControlClient.js";
import { WorkerError, type WorkerErrorCode } from "./workerError.js";
import { assertNoProviderEnvironment, type WorkerEnvironment } from "./providerEnvironment.js";

// R44B11F Phase 7: library-only composition of one provider verification run
// (architecture "R44B11F Phase 7 library-only verification run composition
// contract amendment").
//
// One invocation leases at most one job and handles at most that one job:
// live gate, dependency validation, provider-environment guard, shutdown link,
// lease, admission, lease budget, credential grant, VERIFYING, binding,
// openOnceFor, the Phase 6 call inside use, and the result report. No loop,
// cadence, process access, logging, journal or module state; importing this
// module executes declarations only. Every fault is returned as data and the
// returned promise never rejects.

export const PROVIDER_VERIFICATION_RUN_LEASE_MS = 30000;
export const PROVIDER_VERIFICATION_RUN_CLOCK_MARGIN_MS = 2000;
export const PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS = 3000;
export const PROVIDER_VERIFICATION_RUN_RESULT_RESERVE_MS = 6000;
export const PROVIDER_VERIFICATION_RUN_TRANSPORT_SETUP_MARGIN_MS = 250;
export const PROVIDER_VERIFICATION_RUN_PRE_TRANSPORT_MIN_MS = 16250;
export const PROVIDER_VERIFICATION_RUN_PRE_VERIFYING_MIN_MS = 19250;
export const PROVIDER_VERIFICATION_RUN_PRE_GRANT_MIN_MS = 22250;

// The binding input type, derived from the Phase 5 binder itself, so that no
// credential-contract module is imported here.
type BindingInput = Parameters<typeof bindProviderVerificationCredential>[0];

export type ProviderVerificationRunInput = Readonly<{
  config: ProviderVerificationConfig;
  environment: WorkerEnvironment;
  shutdownSignal?: AbortSignal;
}>;

export type ProviderVerificationRunDependencies = Readonly<{
  client: ProviderVerificationControlClient;
  opener: BindingInput["opener"];
  fetchImpl: ProviderVerificationTransportDependencies["fetchImpl"];
  deadlineTimer?: ProviderVerificationDeadlineTimer;
  wallClock?: () => number;
  monotonicClock?: () => number;
  liveGate?: (config: ProviderVerificationConfig) => void;
}>;

export type ProviderVerificationRunStage = "START" | "GATE" | "ENVIRONMENT" | "LEASE" | "GRANT" | "VERIFYING" | "BIND" | "VERIFICATION" | "RESULT";

export type ProviderVerificationRunAbandonedStage = "START" | "LEASE" | "GRANT" | "VERIFYING" | "BIND" | "VERIFICATION";

type RunCause = "SHUTDOWN" | "LEASE_BUDGET";
type AdmissionRefusal = "UNSUPPORTED_PROVIDER" | "UNSUPPORTED_POLICY" | "PROVIDER_POLICY_MISMATCH";

export type ProviderVerificationRunResult =
  | Readonly<{ status: "DISABLED" }>
  | Readonly<{ status: "NO_WORK" }>
  // R44B11G: a refused lease is deferred, never made terminal. disposition is
  // the worker's knowledge of the server-side deferral; cause is whether a
  // shutdown was recorded before the result was returned (independent of it).
  | Readonly<{
      status: "UNSUPPORTED_LEASE";
      providerVerificationJobId: string;
      reason: AdmissionRefusal;
      disposition: "DEFERRED";
      deferredUntil: Date;
      cause: "SHUTDOWN" | null;
    }>
  | Readonly<{
      status: "UNSUPPORTED_LEASE";
      providerVerificationJobId: string;
      reason: AdmissionRefusal;
      disposition: "REJECTED" | "UNCONFIRMED" | "NOT_SENT";
      detail: WorkerErrorCode | "SHUTDOWN";
      cause: "SHUTDOWN" | null;
    }>
  | Readonly<{
      status: "REPORTED";
      providerVerificationJobId: string;
      fencingCounter: number;
      outcome: ProviderVerificationOutcome;
      reasonCode: ProviderVerificationReasonCode;
      completedAt: Date;
    }>
  | Readonly<{ status: "ABANDONED"; stage: ProviderVerificationRunAbandonedStage; cause: RunCause; providerVerificationJobId: string | null }>
  | Readonly<{ status: "STOPPED"; stage: ProviderVerificationRunStage; code: WorkerErrorCode; providerVerificationJobId: string | null }>;

// One control-plane attempt, decided by the first of: the client settling,
// the per-attempt deadline (treated as CONTROL_API_UNAVAILABLE), or the run
// controller aborting (CANCELLED). A failed deadline installation is
// TIMER_INVALID and sends nothing.
type ControlAttempt =
  | Readonly<{ kind: "VALUE"; value: unknown }>
  | Readonly<{ kind: "FAILED"; code: WorkerErrorCode }>
  | Readonly<{ kind: "CANCELLED" }>
  | Readonly<{ kind: "TIMER_INVALID" }>;

// A retryable control step: the value, a retryable unavailability, or a
// terminal run result.
type ControlStep = Readonly<{ kind: "VALUE"; value: unknown }> | Readonly<{ kind: "UNAVAILABLE" }> | Readonly<{ kind: "END"; result: ProviderVerificationRunResult }>;

const CONFIGURATION_INVALID: WorkerErrorCode = "WORKER_CONFIGURATION_INVALID";
const UNAVAILABLE_CODE: WorkerErrorCode = "CONTROL_API_UNAVAILABLE";

const ignore = (): void => undefined;

// The module-local default deadline: one setTimeout and one clearTimeout.
const defaultDeadlineTimer: ProviderVerificationDeadlineTimer = (ms, onExpiry) => {
  const handle = setTimeout(onExpiry, ms);
  return () => clearTimeout(handle);
};
const defaultWallClock = (): number => Date.now();
const defaultMonotonicClock = (): number => performance.now();

const stopped = (stage: ProviderVerificationRunStage, code: WorkerErrorCode, providerVerificationJobId: string | null): ProviderVerificationRunResult =>
  Object.freeze({ status: "STOPPED", stage, code, providerVerificationJobId });

const abandoned = (stage: ProviderVerificationRunAbandonedStage, cause: RunCause, providerVerificationJobId: string | null): ProviderVerificationRunResult =>
  Object.freeze({ status: "ABANDONED", stage, cause, providerVerificationJobId });

const asAbandonedStage = (stage: ProviderVerificationRunStage): ProviderVerificationRunAbandonedStage | null =>
  stage === "GATE" || stage === "ENVIRONMENT" || stage === "RESULT" ? null : stage;

// The closed code of a thrown value: a WorkerError keeps its code; anything
// else, or a value whose inspection throws, is WORKER_CONFIGURATION_INVALID.
// The thrown value itself is never retained.
function closedCodeOf(thrown: unknown): WorkerErrorCode {
  try {
    if (thrown instanceof WorkerError) {
      const code: unknown = thrown.code;
      if (typeof code === "string") return code as WorkerErrorCode;
    }
  } catch {
    // Fall through to the configuration code.
  }
  return CONFIGURATION_INVALID;
}

// A finite clock reading, or null for a throw or any other value.
function readClock(clock: () => number): number | null {
  try {
    const value: unknown = clock();
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

// A promise returned by the gate is observed and ignored, never awaited.
function observeQuietly(value: unknown): void {
  try {
    if (value instanceof Promise) Reflect.apply(Promise.prototype.then, value, [undefined, ignore]);
  } catch {
    // Ignored.
  }
}

export async function runProviderVerification(
  input: ProviderVerificationRunInput,
  dependencies: ProviderVerificationRunDependencies,
): Promise<ProviderVerificationRunResult> {
  // 0. Each input and dependency member is read exactly once into a local.
  if (typeof input !== "object" || input === null || typeof dependencies !== "object" || dependencies === null) {
    return stopped("START", CONFIGURATION_INVALID, null);
  }
  let config: unknown = undefined;
  let environment: unknown = undefined;
  let shutdownSignal: unknown = undefined;
  let client: unknown = undefined;
  let opener: unknown = undefined;
  let fetchImpl: unknown = undefined;
  let deadlineTimer: unknown = undefined;
  let wallClock: unknown = undefined;
  let monotonicClock: unknown = undefined;
  let liveGate: unknown = undefined;
  try {
    config = input.config;
    environment = input.environment;
    shutdownSignal = input.shutdownSignal;
    client = dependencies.client;
    opener = dependencies.opener;
    fetchImpl = dependencies.fetchImpl;
    deadlineTimer = dependencies.deadlineTimer;
    wallClock = dependencies.wallClock;
    monotonicClock = dependencies.monotonicClock;
    liveGate = dependencies.liveGate;
  } catch {
    return stopped("START", CONFIGURATION_INVALID, null);
  }

  // 1. Live gate. The default is the Phase 5 gate, which refuses every
  // configuration; liveGate is the test-only seam.
  const effectiveGate: unknown = liveGate === undefined ? requireLiveProviderVerification : liveGate;
  if (typeof effectiveGate !== "function") return stopped("GATE", CONFIGURATION_INVALID, null);
  try {
    const returned: unknown = Reflect.apply(effectiveGate, undefined, [config]);
    if (returned !== undefined) {
      observeQuietly(returned);
      return stopped("GATE", CONFIGURATION_INVALID, null);
    }
  } catch (thrown) {
    const code = closedCodeOf(thrown);
    return code === "PROVIDER_VERIFICATION_DISABLED" ? Object.freeze({ status: "DISABLED" }) : stopped("GATE", code, null);
  }

  // 2. Dependency and input shape, before anything is leased. The five client
  // methods (R44B11G adds the deferral) are read once here and later invoked
  // with the client as receiver; the opener's open member is read for this
  // check only and never called.
  let leaseProviderVerification: unknown = undefined;
  let requestProviderVerificationCredentialGrant: unknown = undefined;
  let acknowledgeProviderVerificationVerifying: unknown = undefined;
  let reportProviderVerificationResult: unknown = undefined;
  let deferUnsupportedProviderVerification: unknown = undefined;
  let valid = false;
  try {
    if (typeof client === "object" && client !== null && typeof opener === "object" && opener !== null) {
      const methods = client as Readonly<Record<string, unknown>>;
      leaseProviderVerification = methods.leaseProviderVerification;
      requestProviderVerificationCredentialGrant = methods.requestProviderVerificationCredentialGrant;
      acknowledgeProviderVerificationVerifying = methods.acknowledgeProviderVerificationVerifying;
      reportProviderVerificationResult = methods.reportProviderVerificationResult;
      deferUnsupportedProviderVerification = methods.deferUnsupportedProviderVerification;
      const openMember: unknown = (opener as Readonly<Record<string, unknown>>).open;
      valid =
        typeof leaseProviderVerification === "function" &&
        typeof requestProviderVerificationCredentialGrant === "function" &&
        typeof acknowledgeProviderVerificationVerifying === "function" &&
        typeof reportProviderVerificationResult === "function" &&
        typeof deferUnsupportedProviderVerification === "function" &&
        typeof openMember === "function" &&
        typeof fetchImpl === "function" &&
        (deadlineTimer === undefined || typeof deadlineTimer === "function") &&
        (wallClock === undefined || typeof wallClock === "function") &&
        (monotonicClock === undefined || typeof monotonicClock === "function") &&
        (shutdownSignal === undefined || shutdownSignal instanceof AbortSignal) &&
        typeof environment === "object" &&
        environment !== null;
    }
  } catch {
    valid = false;
  }
  if (!valid) return stopped("START", CONFIGURATION_INVALID, null);
  const workerEnvironment = environment as WorkerEnvironment;
  const timer = (deadlineTimer === undefined ? defaultDeadlineTimer : deadlineTimer) as ProviderVerificationDeadlineTimer;
  const wall = (wallClock === undefined ? defaultWallClock : wallClock) as () => number;
  const mono = (monotonicClock === undefined ? defaultMonotonicClock : monotonicClock) as () => number;
  const externalSignal = shutdownSignal as AbortSignal | undefined;

  // 3. Provider-environment guard on the injected record, before any lease.
  try {
    assertNoProviderEnvironment(workerEnvironment);
  } catch (thrown) {
    return stopped("ENVIRONMENT", closedCodeOf(thrown), null);
  }

  // 4. Shutdown link. The one internal run controller; its signal is the only
  // signal Phase 6 ever receives. The external signal is observed, never
  // forwarded. The cause window opens here.
  const runController = new AbortController();
  const runSignal = runController.signal;
  let recordedCause: RunCause | null = null;
  let windowOpen = true;
  let cancelBudget: (() => void) | null = null;
  let shutdownListening = false;
  const currentCause = (): RunCause | null => recordedCause;
  // The first cause recorded while the window is open wins; any later cause,
  // or a cause after the window closed, changes nothing.
  const record = (next: RunCause): void => {
    if (!windowOpen || recordedCause !== null) return;
    recordedCause = next;
    runController.abort();
  };
  const onShutdown = (): void => record("SHUTDOWN");
  // Closes the cause window: cancels the budget timer and removes the
  // shutdown listener. Cleanup failures are swallowed.
  const closeWindow = (): void => {
    windowOpen = false;
    const cancel = cancelBudget;
    cancelBudget = null;
    if (cancel !== null) {
      try {
        cancel();
      } catch {
        // A throwing timer cleanup never changes the selected result.
      }
    }
    if (shutdownListening && externalSignal !== undefined) {
      shutdownListening = false;
      try {
        externalSignal.removeEventListener("abort", onShutdown);
      } catch {
        // Cleanup only.
      }
    }
  };

  let stage: ProviderVerificationRunStage = "START";
  let providerVerificationJobId: string | null = null;
  const abandonedNow = (cause: RunCause): ProviderVerificationRunResult => {
    const at = asAbandonedStage(stage);
    return at === null ? stopped(stage, CONFIGURATION_INVALID, providerVerificationJobId) : abandoned(at, cause, providerVerificationJobId);
  };
  // Precedence inside the cause window: a recorded cause decides the run,
  // whatever the step in progress settled with; otherwise the closed code.
  const decide = (code: WorkerErrorCode): ProviderVerificationRunResult => {
    const cause = currentCause();
    return cause !== null ? abandonedNow(cause) : stopped(stage, code, providerVerificationJobId);
  };

  // One control-plane attempt under its own controller and CONTROL_DEADLINE.
  // Linked attempts (lease, grant, VERIFYING) are also cancelled by the run
  // controller; result attempts are not. The wait settles no later than the
  // deadline or the cancellation; a late settlement is observed and ignored.
  const controlAttempt = async (send: (signal: AbortSignal) => unknown, linked: boolean): Promise<ControlAttempt> => {
    const attemptController = new AbortController();
    let interruption: ControlAttempt | null = null;
    let wake: (outcome: ControlAttempt) => void = ignore;
    const interrupted = new Promise<ControlAttempt>((resolve) => {
      wake = resolve;
    });
    let ended = false;
    const interruptionNow = (): ControlAttempt | null => interruption;
    const interrupt = (outcome: ControlAttempt): void => {
      if (ended || interruption !== null) return;
      interruption = outcome;
      wake(outcome);
      attemptController.abort();
    };
    const onRunAbort = (): void => interrupt(Object.freeze({ kind: "CANCELLED" }));
    if (linked) runSignal.addEventListener("abort", onRunAbort, { once: true });
    const unlink = (): void => {
      if (linked) runSignal.removeEventListener("abort", onRunAbort);
    };

    let installed: unknown = undefined;
    let installFailed = false;
    try {
      installed = timer(PROVIDER_VERIFICATION_RUN_CONTROL_DEADLINE_MS, () => interrupt(Object.freeze({ kind: "FAILED", code: UNAVAILABLE_CODE })));
    } catch {
      installFailed = true;
    }
    if (installFailed || typeof installed !== "function") {
      ended = true;
      unlink();
      return Object.freeze({ kind: "TIMER_INVALID" });
    }
    const cancelDeadline = installed as () => void;
    const finish = (outcome: ControlAttempt): ControlAttempt => {
      ended = true;
      try {
        cancelDeadline();
      } catch {
        // Swallowed.
      }
      unlink();
      return outcome;
    };

    // An expiry during installation, or a cause already recorded: the guarded
    // request is not sent.
    const early = interruptionNow();
    if (early !== null) return finish(early);
    if (linked && runSignal.aborted) return finish(Object.freeze({ kind: "CANCELLED" }));

    let settled: Promise<ControlAttempt>;
    try {
      const pending: unknown = send(attemptController.signal);
      settled = Promise.resolve(pending).then(
        (value): ControlAttempt => Object.freeze({ kind: "VALUE", value }),
        (thrown: unknown): ControlAttempt => Object.freeze({ kind: "FAILED", code: closedCodeOf(thrown) }),
      );
    } catch (thrown) {
      return finish(Object.freeze({ kind: "FAILED", code: closedCodeOf(thrown) }));
    }
    return finish(await Promise.race([settled, interrupted]));
  };

  // A linked attempt judged in the locked precedence: timer installation
  // failure, then a recorded cause, then the settlement.
  const controlStep = async (send: (signal: AbortSignal) => unknown): Promise<ControlStep> => {
    const attempt = await controlAttempt(send, true);
    if (attempt.kind === "TIMER_INVALID") return Object.freeze({ kind: "END", result: stopped(stage, CONFIGURATION_INVALID, providerVerificationJobId) });
    if (currentCause() !== null || attempt.kind === "CANCELLED") return Object.freeze({ kind: "END", result: decide(CONFIGURATION_INVALID) });
    if (attempt.kind === "VALUE") return Object.freeze({ kind: "VALUE", value: attempt.value });
    if (attempt.code === UNAVAILABLE_CODE) return Object.freeze({ kind: "UNAVAILABLE" });
    return Object.freeze({ kind: "END", result: stopped(stage, attempt.code, providerVerificationJobId) });
  };

  try {
    if (externalSignal !== undefined) {
      let alreadyAborted = false;
      try {
        alreadyAborted = externalSignal.aborted === true;
        if (!alreadyAborted) {
          externalSignal.addEventListener("abort", onShutdown, { once: true });
          shutdownListening = true;
        }
      } catch {
        return stopped("START", CONFIGURATION_INVALID, null);
      }
      if (alreadyAborted) return abandoned("START", "SHUTDOWN", null);
    }
    if (currentCause() !== null) return decide(CONFIGURATION_INVALID);

    // 5. The single lease request; leaseSentMono is read immediately before it.
    stage = "LEASE";
    const leaseSentMono = readClock(mono);
    if (currentCause() !== null || leaseSentMono === null) return decide(CONFIGURATION_INVALID);
    const leased = await controlStep((signal) => Reflect.apply(leaseProviderVerification as (...args: unknown[]) => unknown, client, [signal]));
    if (leased.kind === "END") return leased.result;
    if (leased.kind === "UNAVAILABLE") return stopped(stage, UNAVAILABLE_CODE, null);
    if (leased.value === null) return Object.freeze({ status: "NO_WORK" });

    // The lease members, read once.
    const lease = leased.value;
    let leaseJobId: unknown;
    let provider: unknown;
    let verificationPolicyId: unknown;
    let leaseToken: unknown;
    let fencingCounter: unknown;
    let expiresAtMs: unknown;
    try {
      if (typeof lease !== "object" || lease === null) return stopped(stage, CONFIGURATION_INVALID, null);
      const members = lease as Readonly<Record<string, unknown>>;
      leaseJobId = members.providerVerificationJobId;
      provider = members.provider;
      verificationPolicyId = members.verificationPolicyId;
      leaseToken = members.leaseToken;
      fencingCounter = members.fencingCounter;
      const leaseExpiresAt: unknown = members.leaseExpiresAt;
      expiresAtMs = leaseExpiresAt instanceof Date ? Reflect.apply(Date.prototype.getTime, leaseExpiresAt, []) : null;
    } catch {
      return stopped(stage, CONFIGURATION_INVALID, null);
    }
    if (
      typeof leaseJobId !== "string" ||
      typeof provider !== "string" ||
      typeof verificationPolicyId !== "string" ||
      typeof leaseToken !== "string" ||
      typeof fencingCounter !== "number" ||
      typeof expiresAtMs !== "number"
    ) {
      return stopped(stage, CONFIGURATION_INVALID, null);
    }
    providerVerificationJobId = leaseJobId;
    const jobId = leaseJobId;
    const proof: LeaseProof = Object.freeze({ fencingCounter, leaseToken });

    // 6. Admission, before any grant. R44B11G: a refused lease is deferred by
    // exactly one linked control attempt (CLASSIFY -> DEFERRAL, then return):
    // no budget, grant, VERIFYING, bind, open, transport or result report, no
    // retry. The cause window stays open through the attempt; the finally
    // below closes it after the result has been built.
    const admission = classifyProviderVerificationLease({ provider, verificationPolicyId });
    if (admission.status === "REFUSED") {
      const reason = admission.reason;
      // Whether the send closure ran: set as its first statement.
      const dispatch = { sent: false };
      const sendDeferral = (signal: AbortSignal): unknown => {
        dispatch.sent = true;
        return Reflect.apply(deferUnsupportedProviderVerification as (...args: unknown[]) => unknown, client, [jobId, proof, reason, signal]);
      };
      const attempt = await controlAttempt(sendDeferral, true);
      const outcome = deferralOutcome(attempt, dispatch.sent);
      // Sampled once, after the attempt returned and with no await before the
      // return, so no shutdown can be recorded between the sample and the result.
      const cause = currentCause() === "SHUTDOWN" ? "SHUTDOWN" : null;
      return outcome.disposition === "DEFERRED"
        ? Object.freeze({ status: "UNSUPPORTED_LEASE", providerVerificationJobId: jobId, reason, disposition: "DEFERRED", deferredUntil: outcome.deferredUntil, cause })
        : Object.freeze({ status: "UNSUPPORTED_LEASE", providerVerificationJobId: jobId, reason, disposition: outcome.disposition, detail: outcome.detail, cause });
    }

    // 7. Lease budget: one monotonic receipt instant and the run's only wall
    // clock read, then monotonic remaining() only.
    stage = "GRANT";
    const receiptMono = readClock(mono);
    if (currentCause() !== null || receiptMono === null) return decide(CONFIGURATION_INVALID);
    const receiptWallMs = readClock(wall);
    if (currentCause() !== null || receiptWallMs === null) return decide(CONFIGURATION_INVALID);
    const localLeaseCapEnd = leaseSentMono + PROVIDER_VERIFICATION_RUN_LEASE_MS;
    const serverExpiryProjectedEnd = receiptMono + (expiresAtMs - receiptWallMs);
    const budgetEnd = Math.min(localLeaseCapEnd, serverExpiryProjectedEnd) - PROVIDER_VERIFICATION_RUN_CLOCK_MARGIN_MS;
    const budgetAbortAt = budgetEnd - PROVIDER_VERIFICATION_RUN_RESULT_RESERVE_MS;
    if (!Number.isFinite(budgetEnd)) return stopped(stage, CONFIGURATION_INVALID, jobId);

    // A checkpoint: remaining() = budgetEnd - monotonicClock(), compared with
    // >=. A failure records LEASE_BUDGET and the step does not start.
    const checkpoint = (minimum: number): ProviderVerificationRunResult | null => {
      const now = readClock(mono);
      if (currentCause() !== null) return decide(CONFIGURATION_INVALID);
      if (now === null) return stopped(stage, CONFIGURATION_INVALID, jobId);
      if (budgetEnd - now >= minimum) return null;
      record("LEASE_BUDGET");
      return decide(CONFIGURATION_INVALID);
    };
    // One allowed exact retry after CONTROL_API_UNAVAILABLE, re-checking the
    // same minimum; a second unavailability stops.
    const retriedStep = async (minimum: number, send: (signal: AbortSignal) => unknown, first: ControlStep): Promise<ControlStep> => {
      if (first.kind !== "UNAVAILABLE") return first;
      const refused = checkpoint(minimum);
      if (refused !== null) return Object.freeze({ kind: "END", result: refused });
      const second = await controlStep(send);
      return second.kind === "UNAVAILABLE" ? Object.freeze({ kind: "END", result: stopped(stage, UNAVAILABLE_CODE, jobId) }) : second;
    };

    const grantRefused = checkpoint(PROVIDER_VERIFICATION_RUN_PRE_GRANT_MIN_MS);
    if (grantRefused !== null) return grantRefused;
    // The budget timer, anchored to budgetAbortAt at installation time.
    const installedAt = readClock(mono);
    if (currentCause() !== null || installedAt === null) return decide(CONFIGURATION_INVALID);
    let installedBudget: unknown = undefined;
    let budgetInstallFailed = false;
    try {
      installedBudget = timer(Math.max(0, budgetAbortAt - installedAt), () => record("LEASE_BUDGET"));
    } catch {
      budgetInstallFailed = true;
    }
    if (budgetInstallFailed || typeof installedBudget !== "function") return stopped(stage, CONFIGURATION_INVALID, jobId);
    cancelBudget = installedBudget as () => void;
    if (currentCause() !== null) return decide(CONFIGURATION_INVALID);

    // 8. Credential grant.
    const sendGrant = (signal: AbortSignal): unknown =>
      Reflect.apply(requestProviderVerificationCredentialGrant as (...args: unknown[]) => unknown, client, [jobId, proof, signal]);
    const granted = await retriedStep(PROVIDER_VERIFICATION_RUN_PRE_GRANT_MIN_MS, sendGrant, await controlStep(sendGrant));
    if (granted.kind !== "VALUE") return granted.kind === "END" ? granted.result : stopped(stage, UNAVAILABLE_CODE, jobId);
    const grant = granted.value;

    // 9. VERIFYING acknowledgement, before binding and opening.
    stage = "VERIFYING";
    if (currentCause() !== null) return decide(CONFIGURATION_INVALID);
    const verifyingRefused = checkpoint(PROVIDER_VERIFICATION_RUN_PRE_VERIFYING_MIN_MS);
    if (verifyingRefused !== null) return verifyingRefused;
    const sendVerifying = (signal: AbortSignal): unknown =>
      Reflect.apply(acknowledgeProviderVerificationVerifying as (...args: unknown[]) => unknown, client, [jobId, proof, signal]);
    const acknowledged = await retriedStep(PROVIDER_VERIFICATION_RUN_PRE_VERIFYING_MIN_MS, sendVerifying, await controlStep(sendVerifying));
    if (acknowledged.kind !== "VALUE") return acknowledged.kind === "END" ? acknowledged.result : stopped(stage, UNAVAILABLE_CODE, jobId);
    const acknowledgement = acknowledged.value;

    // 10. Binding, at most once. Synchronous; a closed fault after VERIFYING
    // is never reported (server reconciliation converges the job).
    stage = "BIND";
    if (currentCause() !== null) return decide(CONFIGURATION_INVALID);
    let capability: ReturnType<typeof bindProviderVerificationCredential>;
    try {
      capability = bindProviderVerificationCredential({
        environment: workerEnvironment,
        opener: opener as BindingInput["opener"],
        lease: lease as BindingInput["lease"],
        grant: grant as BindingInput["grant"],
        acknowledgement: acknowledgement as BindingInput["acknowledgement"],
      });
    } catch (thrown) {
      return decide(closedCodeOf(thrown));
    }
    if (currentCause() !== null) return decide(CONFIGURATION_INVALID);

    // 11 and 12. openOnceFor, at most once and never raced; inside use, the
    // recorded-cause check, the transport checkpoint and the single Phase 6
    // call with the plaintext and the internal signal only.
    stage = "VERIFICATION";
    const binding = Object.freeze({ providerVerificationJobId: jobId, provider, verificationPolicyId, fencingCounter });
    const transportDependencies: ProviderVerificationTransportDependencies =
      deadlineTimer === undefined
        ? Object.freeze({ fetchImpl: fetchImpl as ProviderVerificationTransportDependencies["fetchImpl"] })
        : Object.freeze({ fetchImpl: fetchImpl as ProviderVerificationTransportDependencies["fetchImpl"], deadlineTimer: timer });
    let settledReport: ProviderVerificationResultReport | null;
    try {
      settledReport = await capability.openOnceFor(binding, async (credential: string): Promise<ProviderVerificationResultReport | null> => {
        if (currentCause() !== null) return null;
        const now = readClock(mono);
        if (currentCause() !== null) return null;
        if (now === null) throw new WorkerError("WORKER_CONFIGURATION_INVALID");
        if (!(budgetEnd - now >= PROVIDER_VERIFICATION_RUN_PRE_TRANSPORT_MIN_MS)) {
          record("LEASE_BUDGET");
          return null;
        }
        return performProviderVerification({ provider, verificationPolicyId, credential, signal: runSignal }, transportDependencies);
      });
    } catch (thrown) {
      return decide(closedCodeOf(thrown));
    }
    if (currentCause() !== null || settledReport === null) return decide(CONFIGURATION_INVALID);
    // The cause window closes in the same turn: from here shutdown and the
    // lease budget no longer cancel anything.
    closeWindow();
    const report = settledReport;

    // 13. The result report: the Phase 6 report verbatim, one exact replay on
    // CONTROL_API_UNAVAILABLE whatever the remaining budget, never a third.
    stage = "RESULT";
    const sendResult = (signal: AbortSignal): unknown =>
      Reflect.apply(reportProviderVerificationResult as (...args: unknown[]) => unknown, client, [jobId, proof, report, signal]);
    const first = await controlAttempt(sendResult, false);
    const delivered =
      first.kind === "FAILED" && first.code === UNAVAILABLE_CODE ? await controlAttempt(sendResult, false) : first;
    if (delivered.kind === "TIMER_INVALID") return stopped(stage, CONFIGURATION_INVALID, jobId);
    if (delivered.kind === "FAILED") return stopped(stage, delivered.code, jobId);
    if (delivered.kind !== "VALUE") return stopped(stage, CONFIGURATION_INVALID, jobId);
    return reportedFrom(delivered.value, jobId);
  } catch {
    return decide(CONFIGURATION_INVALID);
  } finally {
    closeWindow();
  }
}

type DeferralOutcome =
  | Readonly<{ disposition: "DEFERRED"; deferredUntil: Date }>
  | Readonly<{ disposition: "REJECTED" | "UNCONFIRMED" | "NOT_SENT"; detail: WorkerErrorCode | "SHUTDOWN" }>;

const deferralDetail = (disposition: "REJECTED" | "UNCONFIRMED" | "NOT_SENT", detail: WorkerErrorCode | "SHUTDOWN"): DeferralOutcome =>
  Object.freeze({ disposition, detail });

// R44B11G disposition of the one deferral attempt: the first matching row of
// the locked precedence, from the attempt kind, whether the send closure ran,
// and the settled value. NOT_SENT asserts only that no dispatch can have
// happened; UNCONFIRMED makes no delivery claim; only a validated value is
// DEFERRED. Never throws.
function deferralOutcome(attempt: ControlAttempt, sent: boolean): DeferralOutcome {
  // Row 1: the deadline timer could not be installed; nothing was sent.
  if (attempt.kind === "TIMER_INVALID") return deferralDetail("NOT_SENT", CONFIGURATION_INVALID);
  // Rows 2 and 8: cancelled before the closure ran, or while in flight.
  if (attempt.kind === "CANCELLED") return sent ? deferralDetail("UNCONFIRMED", "SHUTDOWN") : deferralDetail("NOT_SENT", "SHUTDOWN");
  if (attempt.kind === "FAILED") {
    // Row 3: expiry during timer installation, before the closure ran.
    if (!sent) return deferralDetail("NOT_SENT", attempt.code);
    // Row 4: the real client's local validation, which runs before dispatch.
    if (attempt.code === "PROVIDER_VERIFICATION_REQUEST_INVALID") return deferralDetail("NOT_SENT", attempt.code);
    // Row 7: a definitive refusal.
    if (attempt.code === "PROVIDER_VERIFICATION_DEFERRAL_REJECTED" || attempt.code === "WORKER_AUTHENTICATION_REJECTED") {
      return deferralDetail("REJECTED", attempt.code);
    }
    // Rows 9, 10 and 11: deadline, 5xx, transport, lost response, malformed
    // (including 404 from an older API) or any other closed code.
    return deferralDetail("UNCONFIRMED", attempt.code);
  }
  // Rows 5 and 6: a value whose deferredUntil is usable is DEFERRED; anything
  // else stays fail-closed (the deferral may still have committed).
  const deferredUntil = usableDeferredUntil(attempt.value);
  return deferredUntil === null ? deferralDetail("UNCONFIRMED", CONFIGURATION_INVALID) : Object.freeze({ disposition: "DEFERRED", deferredUntil });
}

// deferredUntil, read exactly once: a Date whose getTime (applied directly, so
// a forged non-Date throws) is finite, else null. Never throws.
function usableDeferredUntil(value: unknown): Date | null {
  try {
    if (typeof value !== "object" || value === null) return null;
    const read: unknown = (value as Readonly<Record<string, unknown>>).deferredUntil;
    const instant: unknown = Reflect.apply(Date.prototype.getTime, read, []);
    return typeof instant === "number" && Number.isFinite(instant) ? (read as Date) : null;
  } catch {
    return null;
  }
}

// REPORTED copies the job, fence, outcome, reason and completion instant of
// the issued result acknowledgement, each read once.
function reportedFrom(acknowledgement: unknown, jobId: string): ProviderVerificationRunResult {
  try {
    if (typeof acknowledgement !== "object" || acknowledgement === null) return stopped("RESULT", CONFIGURATION_INVALID, jobId);
    const members = acknowledgement as Readonly<Record<string, unknown>>;
    const providerVerificationJobId: unknown = members.providerVerificationJobId;
    const fencingCounter: unknown = members.fencingCounter;
    const outcome: unknown = members.outcome;
    const reasonCode: unknown = members.reasonCode;
    const completedAt: unknown = members.completedAt;
    if (
      typeof providerVerificationJobId !== "string" ||
      typeof fencingCounter !== "number" ||
      typeof outcome !== "string" ||
      typeof reasonCode !== "string" ||
      !(completedAt instanceof Date)
    ) {
      return stopped("RESULT", CONFIGURATION_INVALID, jobId);
    }
    return Object.freeze({
      status: "REPORTED",
      providerVerificationJobId,
      fencingCounter,
      outcome: outcome as ProviderVerificationOutcome,
      reasonCode: reasonCode as ProviderVerificationReasonCode,
      completedAt,
    });
  } catch {
    return stopped("RESULT", CONFIGURATION_INVALID, jobId);
  }
}
