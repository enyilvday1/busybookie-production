import { defaultRecoverySleep, type RecoverySleep } from "./acceptanceRecoveryPolicy.js";
import type { HostFaultLatch } from "./hostFaultLatch.js";
import { realDeadlineTimer, type DeadlineTimer } from "./preProviderOrchestration.js";
import type { LeaseProof, WorkerControlClient } from "./workerControlClient.js";
import { WorkerError } from "./workerError.js";

// The generic in-flight lease keeper
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 15,
// "In-flight provider heartbeat", R44B6Z0). It starts one supplied operation
// exactly once, renews the lease alongside it, and returns or rethrows that
// operation's own outcome:
//
//   operation started (ownership of its promise taken first)
//   -> quiet 30000 ms -> one tick (at most two requests, 10000 ms each)
//   -> quiet 30000 ms after the tick settles -> next tick ...
//   -> operation settles -> keeper-owned stop -> join -> outcome
//
// A heartbeat result never cancels, replaces or abandons the operation, and
// no heartbeat signal ever reaches it. The schedule is proactive only: no
// local lease-expiry decision is made here. Nothing here knows a provider,
// credential, acceptance record or journal, and no worker path calls it yet.

export const IN_FLIGHT_HEARTBEAT_FIRST_TICK_DELAY_MS = 30000;
export const IN_FLIGHT_HEARTBEAT_QUIET_INTERVAL_MS = 30000;
export const IN_FLIGHT_HEARTBEAT_REQUEST_DEADLINE_MS = 10000;
export const IN_FLIGHT_HEARTBEAT_MAX_ATTEMPTS_PER_TICK = 2;

export type InFlightHeartbeatContext = Readonly<{
  executionAttemptId: string;
  proof: LeaseProof;
  client: Pick<WorkerControlClient, "heartbeat">;
  latch: HostFaultLatch;
  deadlineTimer?: DeadlineTimer;
  // Resolves after `ms` or as soon as `signal` aborts; never rejects.
  sleep?: RecoverySleep;
}>;

type TickResult = "CONTINUE" | "STOP";

export async function runWithInFlightHeartbeat<T>(context: InFlightHeartbeatContext, operation: () => Promise<T>): Promise<T> {
  // Started exactly once, before anything else; a synchronous throw is the
  // operation's own failure and no keeper starts.
  const outcome: Promise<T> = Promise.resolve(operation());

  const timer = context.deadlineTimer ?? realDeadlineTimer;
  const sleep = context.sleep ?? defaultRecoverySleep;
  const { executionAttemptId, client, latch } = context;
  // One fixed proof for every request: never changed, derived or renewed.
  const proof: LeaseProof = Object.freeze({ fencingCounter: context.proof.fencingCounter, leaseToken: context.proof.leaseToken });
  // Keeper-owned: aborted only because the operation settled.
  const stop = new AbortController();

  // Ownership of the operation promise: both outcomes are observed, so it is
  // never unhandled, and settlement stops the keeper.
  const settled = outcome.then(
    () => stop.abort(),
    () => stop.abort(),
  );

  let requestActive = false;

  // One heartbeat request under a fresh controller and its own deadline. The
  // keeper's stop also aborts it; both cancellations are removed on settle.
  async function request(): Promise<void> {
    if (requestActive) throw new Error("overlapping in-flight heartbeat request");
    requestActive = true;
    const controller = new AbortController();
    const cancelDeadline = timer(IN_FLIGHT_HEARTBEAT_REQUEST_DEADLINE_MS, () => controller.abort());
    const onStop = () => controller.abort();
    stop.signal.addEventListener("abort", onStop, { once: true });
    try {
      await client.heartbeat(executionAttemptId, proof, controller.signal);
    } finally {
      cancelDeadline();
      stop.signal.removeEventListener("abort", onStop);
      requestActive = false;
    }
  }

  // At most two attempts, both immediate; only CONTROL_API_UNAVAILABLE earns
  // the second. An abort caused by the keeper's own stop is not a failure.
  async function tick(): Promise<TickResult> {
    for (let attempt = 1; attempt <= IN_FLIGHT_HEARTBEAT_MAX_ATTEMPTS_PER_TICK; attempt += 1) {
      if (stop.signal.aborted) return "STOP";
      try {
        await request();
        return "CONTINUE";
      } catch (error) {
        const code = error instanceof WorkerError ? error.code : undefined;
        if (code === "CONTROL_API_UNAVAILABLE") {
          if (stop.signal.aborted) return "STOP";
          continue;
        }
        // The route refused this proof or state: stop renewing. It says
        // nothing about the provider and is not a host fault.
        if (code === "HEARTBEAT_REJECTED") return "STOP";
        // Authentication, malformed response or anything unexpected.
        latch.trip();
        return "STOP";
      }
    }
    // Exhausted unavailability: the cadence continues.
    return "CONTINUE";
  }

  async function keep(): Promise<void> {
    let delay = IN_FLIGHT_HEARTBEAT_FIRST_TICK_DELAY_MS;
    while (!stop.signal.aborted) {
      await sleep(delay, stop.signal);
      if (stop.signal.aborted) return;
      if ((await tick()) === "STOP") return;
      delay = IN_FLIGHT_HEARTBEAT_QUIET_INTERVAL_MS;
    }
  }

  // An unexpected keeper failure (including a broken invariant) is a host
  // fault; it never rejects this function and never detaches the operation.
  const keeper = keep().catch(() => latch.trip());

  await settled;
  await keeper;
  return outcome;
}
