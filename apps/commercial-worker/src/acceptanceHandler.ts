import { AcceptanceJournalError, buildAcceptanceRecord, type AcceptanceJournal, type AcceptanceRecord } from "./acceptanceJournal.js";
import type { HostFaultLatch } from "./hostFaultLatch.js";
import { isProviderExecutionId } from "./providerExecutionContract.js";
import type { SubmissionFailureCode, WorkerLease } from "./workerControlClient.js";
import { WorkerError } from "./workerError.js";

// The inner durable acceptance handler
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 18,
// "Acceptance handler and adapter", R44B6Y0):
//
//   claim single use (before any await)
//   -> validate the provider and the provider execution ID, unchanged
//   -> build the exact record once
//   -> publish that exact record durably, once
//   -> return it
//
// It reports nothing upstream, never prepares the journal, never deletes the
// record and knows no provider. The outer acceptance adapter owns every
// control-plane request. Once it returns, durable acceptance exists.

// The worker-local acceptance fact: data only, never a provider port.
export type WorkerProviderAcceptance = Readonly<{
  provider: string;
  providerExecutionId: string;
}>;

// The immutable identity of the attempt that made the call. The permit
// fields are those of the pre-provider permit, passed structurally.
export type AcceptanceContext = Readonly<{
  lease: Pick<WorkerLease, "executionJobId" | "executionAttemptId" | "attemptNumber" | "provider" | "generationRequestSha256">;
  // From the credential grant's opening context.
  accountId: string;
  permit: Readonly<{ executionAttemptId: string; fencingCounter: number; submittingAt: Date }>;
}>;

export type DurableAcceptanceHandlerDependencies = Readonly<{
  journal: Pick<AcceptanceJournal, "publish">;
  latch: HostFaultLatch;
  // Worker clock for providerAcceptedAt and recordedAt: informational only.
  clock?: () => Date;
}>;

export type DurableAcceptanceHandler = (acceptance: WorkerProviderAcceptance) => Promise<AcceptanceRecord>;

// Thrown when this invocation owned the acceptance but could not make it
// durable. `failureCode` is the control-plane classification (always reported
// with OUTCOME_UNKNOWN); `workerError` keeps the precise local code.
export class AcceptanceNotDurableError extends Error {
  override readonly name = "AcceptanceNotDurableError";

  constructor(
    readonly failureCode: Extract<SubmissionFailureCode, "PROVIDER_EXECUTION_ID_INVALID" | "ACCEPTANCE_JOURNAL_WRITE_FAILED">,
    readonly workerError: WorkerError,
  ) {
    super(workerError.message);
  }
}

export function createDurableAcceptanceHandler(context: AcceptanceContext, dependencies: DurableAcceptanceHandlerDependencies): DurableAcceptanceHandler {
  const { lease, accountId, permit } = context;
  if (permit.executionAttemptId !== lease.executionAttemptId) throw new WorkerError("WORKER_CONFIGURATION_INVALID");
  const { journal, latch } = dependencies;
  const clock = dependencies.clock ?? (() => new Date());
  let claimed = false;

  const notDurable = (failureCode: AcceptanceNotDurableError["failureCode"], workerError: WorkerError) => {
    latch.trip();
    return new AcceptanceNotDurableError(failureCode, workerError);
  };

  return async (acceptance) => {
    // Synchronous claim: a second invocation, concurrent or later, never
    // passes this point and never competes with the first.
    if (claimed) {
      latch.trip();
      throw new WorkerError("PROVIDER_ACCEPTANCE_INVALID");
    }
    claimed = true;
    const providerAcceptedAt = clock();

    const provider: unknown = acceptance?.provider;
    const providerExecutionId: unknown = acceptance?.providerExecutionId;
    // Exactly as received: no trim, case change or other normalisation.
    if (provider !== lease.provider || !isProviderExecutionId(providerExecutionId)) {
      throw notDurable("PROVIDER_EXECUTION_ID_INVALID", new WorkerError("PROVIDER_ACCEPTANCE_INVALID"));
    }

    let record: AcceptanceRecord;
    try {
      record = buildAcceptanceRecord(
        {
          executionAttemptId: lease.executionAttemptId,
          executionJobId: lease.executionJobId,
          accountId,
          attemptNumber: lease.attemptNumber,
          fencingCounter: permit.fencingCounter,
          provider: lease.provider,
          generationRequestSha256: lease.generationRequestSha256,
          submittingAt: permit.submittingAt,
          providerExecutionId,
          providerAcceptedAt,
        },
        clock(),
      );
    } catch {
      throw notDurable("ACCEPTANCE_JOURNAL_WRITE_FAILED", new WorkerError("ACCEPTANCE_JOURNAL_WRITE_FAILED"));
    }

    // One publication of the one record (R44B6P1 authorises no automatic
    // in-handler retry). A conflict keeps its precise local code but is
    // reported upstream as a write failure.
    try {
      await journal.publish(record);
    } catch (error) {
      const conflict = error instanceof AcceptanceJournalError && error.code === "ACCEPTANCE_JOURNAL_CONFLICT";
      throw notDurable("ACCEPTANCE_JOURNAL_WRITE_FAILED", new WorkerError(conflict ? "ACCEPTANCE_JOURNAL_CONFLICT" : "ACCEPTANCE_JOURNAL_WRITE_FAILED"));
    }
    return record;
  };
}
