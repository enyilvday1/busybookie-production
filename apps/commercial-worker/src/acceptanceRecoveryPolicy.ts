import { setTimeout as timerDelay } from "node:timers/promises";

import { WorkerError } from "./workerError.js";

// The bounded per-record startup acceptance-recovery retry policy
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 17,
// "Startup acceptance-recovery retry policy", revision R44B6S0; section 37).
//
// Only the control-plane database decides recovery eligibility and lease
// expiry. This worker clock only bounds how long startup keeps asking; it
// never declares a lease expired and never shortens one.
//
// Time is injected: a monotonic clock in milliseconds and a sleep function.
// The same sleep bounds an in-flight request by the remaining budget, so
// tests drive the whole 150-second policy with no real waiting.

export const ACCEPTANCE_RECOVERY_RETRY_MAX_ATTEMPTS = 18;
export const ACCEPTANCE_RECOVERY_RETRY_MAX_ELAPSED_MS = 150000;
export const ACCEPTANCE_RECOVERY_RETRY_INITIAL_BACKOFF_MS = 1000;
export const ACCEPTANCE_RECOVERY_RETRY_MULTIPLIER = 2;
export const ACCEPTANCE_RECOVERY_RETRY_MAX_BACKOFF_MS = 10000;

// Resolves after `ms` on the injected time source, or as soon as `signal`
// aborts. It must never reject.
export type RecoverySleep = (ms: number, signal?: AbortSignal) => Promise<void>;
export type MonotonicClock = () => number;

export type AcceptanceRecoveryTime = Readonly<{ monotonicNow: MonotonicClock; sleep: RecoverySleep }>;

export const defaultMonotonicNow: MonotonicClock = () => performance.now();

export const defaultRecoverySleep: RecoverySleep = async (ms, signal) => {
  try {
    await timerDelay(ms, undefined, signal === undefined ? {} : { signal });
  } catch {
    // Cancelled: the request settled first.
  }
};

// One request's result as the client returns it. The acknowledgement is
// already exact (attempt, fencing counter, provider execution ID, state).
export type AcceptanceRecoveryResponse<A> =
  | Readonly<{ status: "ACKNOWLEDGED"; acknowledgement: A }>
  | Readonly<{ status: "ATTEMPT_STILL_SUBMITTING" }>;

export type AcceptanceRecoveryAttemptOutcome<A> =
  | Readonly<{ kind: "ACKNOWLEDGED"; acknowledgement: A }>
  | Readonly<{ kind: "STILL_SUBMITTING" }>
  | Readonly<{ kind: "RETRYABLE_UNAVAILABLE" }>
  | Readonly<{ kind: "NON_RETRYABLE_FAILURE"; error: WorkerError }>;

// Only ATTEMPT_STILL_SUBMITTING and the existing CONTROL_API_UNAVAILABLE
// (transport failure, HTTP 5xx, the recovery deadline abort) are retried.
// Authentication, definitive refusal and malformed responses keep their own
// closed worker code; anything unknown fails closed as unresolved evidence.
export function classifyRecoveryAttempt<A>(settled: { value: AcceptanceRecoveryResponse<A> } | { error: unknown }): AcceptanceRecoveryAttemptOutcome<A> {
  if ("value" in settled) {
    return settled.value.status === "ACKNOWLEDGED"
      ? Object.freeze({ kind: "ACKNOWLEDGED", acknowledgement: settled.value.acknowledgement })
      : Object.freeze({ kind: "STILL_SUBMITTING" });
  }
  const { error } = settled;
  if (error instanceof WorkerError && error.code === "CONTROL_API_UNAVAILABLE") return Object.freeze({ kind: "RETRYABLE_UNAVAILABLE" });
  return Object.freeze({
    kind: "NON_RETRYABLE_FAILURE",
    error: error instanceof WorkerError ? error : new WorkerError("ACCEPTANCE_RECONCILIATION_FAILED"),
  });
}

const DEADLINE = Symbol("deadline");
const exhausted = () => new WorkerError("ACCEPTANCE_RECONCILIATION_FAILED");

// Runs one record's recovery under a fresh budget. `request` must reuse the
// exact journal identity on every call; it receives an abort signal that
// fires when the remaining elapsed budget is consumed.
export async function runAcceptanceRecoveryWithRetry<A>(
  request: (signal: AbortSignal) => Promise<AcceptanceRecoveryResponse<A>>,
  time: AcceptanceRecoveryTime,
): Promise<A> {
  const startedAt = time.monotonicNow();
  const elapsed = () => time.monotonicNow() - startedAt;
  let backoff = ACCEPTANCE_RECOVERY_RETRY_INITIAL_BACKOFF_MS;

  for (let attempt = 1; ; attempt += 1) {
    // Request duration counts: the in-flight request is bounded by what is left.
    const remaining = ACCEPTANCE_RECOVERY_RETRY_MAX_ELAPSED_MS - elapsed();
    if (remaining <= 0) throw exhausted();
    const abort = new AbortController();
    const cancelDeadline = new AbortController();
    const settled = request(abort.signal).then(
      (value) => classifyRecoveryAttempt<A>({ value }),
      (error: unknown) => classifyRecoveryAttempt<A>({ error }),
    );
    const reached = (): typeof DEADLINE => DEADLINE;
    const deadline = time.sleep(remaining, cancelDeadline.signal).then(reached, reached);
    const outcome = await Promise.race([settled, deadline]);
    if (outcome === DEADLINE) {
      // The request consumed the whole remaining budget. Abort it (the client
      // classifies that as CONTROL_API_UNAVAILABLE) and start nothing else:
      // no budget is left, so no second request can overlap this one.
      abort.abort();
      throw exhausted();
    }
    cancelDeadline.abort();

    if (outcome.kind === "ACKNOWLEDGED") return outcome.acknowledgement;
    if (outcome.kind === "NON_RETRYABLE_FAILURE") throw outcome.error;

    // Retryable. Attempt 1 counts; attempt 19 never starts.
    if (attempt >= ACCEPTANCE_RECOVERY_RETRY_MAX_ATTEMPTS) throw exhausted();
    // No sleep the budget cannot honour: the next request could not start.
    if (elapsed() + backoff >= ACCEPTANCE_RECOVERY_RETRY_MAX_ELAPSED_MS) throw exhausted();
    await time.sleep(backoff);
    if (elapsed() >= ACCEPTANCE_RECOVERY_RETRY_MAX_ELAPSED_MS) throw exhausted();
    backoff = Math.min(backoff * ACCEPTANCE_RECOVERY_RETRY_MULTIPLIER, ACCEPTANCE_RECOVERY_RETRY_MAX_BACKOFF_MS);
  }
}
