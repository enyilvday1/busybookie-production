import { createDurableAcceptanceHandler, AcceptanceNotDurableError, type AcceptanceContext, type WorkerProviderAcceptance } from "./acceptanceHandler.js";
import type { AcceptanceJournal, AcceptanceRecord } from "./acceptanceJournal.js";
import { defaultMonotonicNow, defaultRecoverySleep, type MonotonicClock, type RecoverySleep } from "./acceptanceRecoveryPolicy.js";
import type { HostFaultLatch } from "./hostFaultLatch.js";
import { realDeadlineTimer, type DeadlineTimer } from "./preProviderOrchestration.js";
import { recoverAcceptanceRecord } from "./startupJournalReconciliation.js";
import { atMostTwoAttempts, reportSubmissionFailureWithPolicy } from "./failureReportPolicy.js";
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
// R44B9: the failure-report policy now lives in failureReportPolicy.ts,
// shared with the fake-provider composer; the values are unchanged.
export {
  SUBMISSION_FAILURE_REPORT_MAX_ATTEMPTS as ACCEPTANCE_FAILURE_REPORT_MAX_ATTEMPTS,
  SUBMISSION_FAILURE_REPORT_REQUEST_DEADLINE_MS as ACCEPTANCE_FAILURE_REPORT_REQUEST_DEADLINE_MS,
} from "./failureReportPolicy.js";

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
    // The shared policy never throws; whatever it establishes, the
    // authoritative SUBMITTING expiry sweep remains.
    await reportSubmissionFailureWithPolicy({ client, deadlineTimer: timer }, executionAttemptId, fixedProof, report);
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
