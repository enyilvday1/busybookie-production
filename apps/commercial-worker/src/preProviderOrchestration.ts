import type { AcceptanceJournal } from "./acceptanceJournal.js";
import type { LeaseProof, WorkerControlClient } from "./workerControlClient.js";
import { WorkerError } from "./workerError.js";

// The pre-provider orchestration (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md
// section 15, "Pre-provider orchestration" R44B6V0 and "Worker heartbeat
// client and pre-provider heartbeat" R44B6W0). It runs after the credential
// was validated and opened, and ends at the pre-provider permit:
//
//   per-attempt journal.prepare()
//   -> SUBMITTING acknowledgement (at most two attempts)
//   -> mandatory heartbeat (at most two attempts)
//   -> pre-provider permit, then STOP
//
// It constructs, selects and invokes nothing beyond the journal and the two
// worker-control requests, and no worker path calls it yet. Each request has
// its own 10000 ms deadline under a fresh controller that this module owns;
// that signal never extends past its request. The second attempt is made only
// after CONTROL_API_UNAVAILABLE, immediately, with exactly the same proof.
// Any other failure, and a failed heartbeat after a committed SUBMITTING,
// simply propagates its closed code: no submission-failed report, no other
// lifecycle change, no permit. The control plane decides lease validity; the
// local clock is used only to bound a request.

export const PRE_PROVIDER_MAX_ATTEMPTS = 2;
export const PRE_PROVIDER_REQUEST_DEADLINE_MS = 10000;

// Starts one request deadline and returns its cancellation. Injectable so
// tests drive the deadline without real waiting.
export type DeadlineTimer = (ms: number, onExpiry: () => void) => () => void;

export const realDeadlineTimer: DeadlineTimer = (ms, onExpiry) => {
  const timer = setTimeout(onExpiry, ms);
  return () => clearTimeout(timer);
};

// The completed preconditions: an exact SUBMITTING acknowledgement and an
// exact heartbeat for this attempt and fencing generation. It carries no
// secret and calls nothing; holding it is not itself a security boundary.
export type PreProviderPermit = Readonly<{
  executionAttemptId: string;
  fencingCounter: number;
}>;

export type PreProviderOrchestrationDependencies = Readonly<{
  journal: Pick<AcceptanceJournal, "prepare">;
  client: Pick<WorkerControlClient, "acknowledgeSubmitting" | "heartbeat">;
  deadlineTimer?: DeadlineTimer;
}>;

// One request under a fresh controller and its own deadline; the timer is
// cancelled as soon as the request settles, so it can never abort later work.
async function withRequestDeadline<T>(timer: DeadlineTimer, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const cancel = timer(PRE_PROVIDER_REQUEST_DEADLINE_MS, () => controller.abort());
  try {
    return await request(controller.signal);
  } finally {
    cancel();
  }
}

// At most two attempts; only CONTROL_API_UNAVAILABLE earns the second.
async function atMostTwoAttempts<T>(timer: DeadlineTimer, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  try {
    return await withRequestDeadline(timer, request);
  } catch (error) {
    if (!(error instanceof WorkerError) || error.code !== "CONTROL_API_UNAVAILABLE") throw error;
  }
  return withRequestDeadline(timer, request);
}

export async function obtainPreProviderPermit(
  dependencies: PreProviderOrchestrationDependencies,
  executionAttemptId: string,
  proof: LeaseProof,
): Promise<PreProviderPermit> {
  const timer = dependencies.deadlineTimer ?? realDeadlineTimer;
  // One fixed proof for every request: never changed, derived or renewed.
  const fixedProof: LeaseProof = Object.freeze({ fencingCounter: proof.fencingCounter, leaseToken: proof.leaseToken });

  // Per attempt, not only at startup: no provider authority without a
  // journal that can record its acceptance.
  try {
    await dependencies.journal.prepare();
  } catch {
    throw new WorkerError("STATE_ROOT_UNSUITABLE");
  }

  const acknowledgement = await atMostTwoAttempts(timer, (signal) => dependencies.client.acknowledgeSubmitting(executionAttemptId, fixedProof, signal));
  const renewal = await atMostTwoAttempts(timer, (signal) => dependencies.client.heartbeat(executionAttemptId, fixedProof, signal));

  // Both responses were already checked against this attempt and proof.
  return Object.freeze({ executionAttemptId: acknowledgement.executionAttemptId, fencingCounter: renewal.fencingCounter });
}
