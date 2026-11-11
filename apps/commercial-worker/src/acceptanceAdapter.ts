import { createDurableAcceptanceHandler, AcceptanceNotDurableError, type AcceptanceContext, type WorkerProviderAcceptance } from "./acceptanceHandler.js";
import type { AcceptanceJournal, AcceptanceRecord } from "./acceptanceJournal.js";
import { defaultMonotonicNow, defaultRecoverySleep, type MonotonicClock, type RecoverySleep } from "./acceptanceRecoveryPolicy.js";
import type { HostFaultLatch } from "./hostFaultLatch.js";
import { realDeadlineTimer, type DeadlineTimer } from "./preProviderOrchestration.js";
import { recoverAcceptanceRecord } from "./startupJournalReconciliation.js";
import type { LeaseProof, WorkerControlClient } from "./workerControlClient.js";
import { WorkerError } from "./workerError.js";

// The outer acceptance adapter
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 18,
// "Acceptance handler and adapter", R44B6Y0). It is the future provider
// acceptance callback and resolves only after authoritative reconciliation:
//
//   inner durable handler -> exact durable record
//   -> live submitted report (at most two attempts)
//   -> on refusal or exhausted unavailability: the shared acceptance-recovery
//      step for that exact record
//   -> resolve; otherwise trip the host-fault latch and throw
//
// Before durable acceptance it makes only a best-effort failure report;
// after it, never. It never decides lease liveness from a local clock, never
// prepares or deletes the journal record itself, and knows no provider. No
// worker path constructs it yet.

export const LIVE_SUBMITTED_MAX_ATTEMPTS = 2;
export const LIVE_SUBMITTED_REQUEST_DEADLINE_MS = 10000;
export const ACCEPTANCE_FAILURE_REPORT_MAX_ATTEMPTS = 2;
export const ACCEPTANCE_FAILURE_REPORT_REQUEST_DEADLINE_MS = 10000;

export type AcceptanceAdapterDependencies = Readonly<{
  journal: Pick<AcceptanceJournal, "publish" | "removeAcknowledgedRecord">;
  client: Pick<WorkerControlClient, "reportSubmitted" | "reportSubmissionFailed" | "recoverAcceptance">;
  latch: HostFaultLatch;
  clock?: () => Date;
  deadlineTimer?: DeadlineTimer;
  // The shared acceptance-recovery time source (section 17 policy).
  monotonicNow?: MonotonicClock;
  sleep?: RecoverySleep;
}>;

export type AcceptanceAdapter = (acceptance: WorkerProviderAcceptance) => Promise<void>;

// One request under a fresh controller and its own deadline; the timer is
// cancelled as soon as the request settles, so it can never abort later work.
async function withRequestDeadline<T>(timer: DeadlineTimer, deadlineMs: number, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const cancel = timer(deadlineMs, () => controller.abort());
  try {
    return await request(controller.signal);
  } finally {
    cancel();
  }
}

// At most two attempts, both immediate; only CONTROL_API_UNAVAILABLE earns the second.
async function atMostTwoAttempts<T>(timer: DeadlineTimer, deadlineMs: number, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  try {
    return await withRequestDeadline(timer, deadlineMs, request);
  } catch (error) {
    if (!(error instanceof WorkerError) || error.code !== "CONTROL_API_UNAVAILABLE") throw error;
  }
  return withRequestDeadline(timer, deadlineMs, request);
}

const asWorkerError = (error: unknown) => (error instanceof WorkerError ? error : new WorkerError("ACCEPTANCE_RECONCILIATION_FAILED"));

export function createAcceptanceAdapter(context: AcceptanceContext, proof: LeaseProof, dependencies: AcceptanceAdapterDependencies): AcceptanceAdapter {
  if (proof.fencingCounter !== context.permit.fencingCounter) throw new WorkerError("WORKER_CONFIGURATION_INVALID");
  const { journal, client, latch } = dependencies;
  const timer = dependencies.deadlineTimer ?? realDeadlineTimer;
  const recovery = Object.freeze({
    client,
    monotonicNow: dependencies.monotonicNow ?? defaultMonotonicNow,
    sleep: dependencies.sleep ?? defaultRecoverySleep,
  });
  const executionAttemptId = context.permit.executionAttemptId;
  // One fixed proof for every request: never changed, derived or renewed.
  const fixedProof: LeaseProof = Object.freeze({ fencingCounter: proof.fencingCounter, leaseToken: proof.leaseToken });
  const handler = createDurableAcceptanceHandler(context, { journal, latch, ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }) });

  // Best effort, before any durable acceptance only. Its own failure changes
  // nothing: the latch is already tripped and the caller still fails closed.
  async function reportNotDurable(failure: AcceptanceNotDurableError): Promise<void> {
    const report = Object.freeze({ outcome: "OUTCOME_UNKNOWN" as const, failureCode: failure.failureCode });
    try {
      await atMostTwoAttempts(timer, ACCEPTANCE_FAILURE_REPORT_REQUEST_DEADLINE_MS, (signal) =>
        client.reportSubmissionFailed(executionAttemptId, fixedProof, report, signal),
      );
    } catch {
      // The authoritative SUBMITTING expiry sweep remains.
    }
  }

  // After durable acceptance: the live report, then the shared recovery step.
  async function reconcile(record: AcceptanceRecord): Promise<void> {
    try {
      await atMostTwoAttempts(timer, LIVE_SUBMITTED_REQUEST_DEADLINE_MS, (signal) =>
        client.reportSubmitted(record.executionAttemptId, fixedProof, record.providerExecutionId, signal),
      );
      return;
    } catch (error) {
      // A refusal is not lease expiry, and exhausted unavailability may hide a
      // commit: both go to recovery. Anything else is a host fault.
      const handOver = error instanceof WorkerError && (error.code === "SUBMITTED_REPORT_REJECTED" || error.code === "CONTROL_API_UNAVAILABLE");
      if (!handOver) {
        latch.trip();
        throw asWorkerError(error);
      }
    }
    try {
      await recoverAcceptanceRecord(journal, record, recovery);
    } catch (error) {
      latch.trip();
      throw asWorkerError(error);
    }
  }

  return async (acceptance) => {
    let record: AcceptanceRecord;
    try {
      record = await handler(acceptance);
    } catch (error) {
      latch.trip();
      if (error instanceof AcceptanceNotDurableError) {
        await reportNotDurable(error);
        throw error.workerError;
      }
      // A repeated invocation: no report of any kind.
      throw asWorkerError(error);
    }
    // Durable acceptance exists: never a failure report from here on.
    await reconcile(record);
  };
}
