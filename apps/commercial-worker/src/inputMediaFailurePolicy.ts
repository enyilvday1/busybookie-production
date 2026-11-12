import { atMostTwoAttempts } from "./failureReportPolicy.js";
import type { HostFaultLatch } from "./hostFaultLatch.js";
import { InputMediaRetrievalError, type InputMediaFailure } from "./inputMediaRetrieval.js";
import type { DeadlineTimer } from "./preProviderOrchestration.js";
import type { InputFailureCode, LeaseProof, WorkerControlClient, WorkerInputFailedAcknowledgement } from "./workerControlClient.js";

// The caller-side input-media failure policy
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 18,
// "input-failed route", R44B10P2). It consumes the closed classification
// that input-media retrieval attaches to a failure and owns the report and
// latch decisions:
//
//   PERMANENT_INPUT    report through the input-failed route, no latch
//   TRANSIENT_STORAGE  no report, no latch; the lease is left to expiry
//   HOST_FAULT         trip the host-fault latch, no report
//
// Every outcome means the attempt stops here: no pre-provider permit, no
// SUBMITTING acknowledgement, no provider construction or dispatch, no
// local terminal state and never OUTCOME_UNKNOWN. The control plane stays
// authoritative: the attempt is either the committed input failure or still
// LEASED for expiry and recovery. Unwired: no composer calls it yet.
//
// The report is a control-plane report, never a provider retry: at most two
// immediate attempts, a fresh controller and its own 10000 ms deadline each,
// and only CONTROL_API_UNAVAILABLE earns the second (the shared helper).

export const INPUT_FAILURE_REPORT_MAX_ATTEMPTS = 2;
export const INPUT_FAILURE_REPORT_REQUEST_DEADLINE_MS = 10000;

export type InputFailureReportResult =
  // The first transition or an exact replay of the committed report.
  | Readonly<{ status: "REPORTED"; acknowledgement: WorkerInputFailedAcknowledgement }>
  // Unavailable twice, refused (409) or rejected otherwise: nothing was
  // established here.
  | Readonly<{ status: "UNREPORTED" }>;

export type InputFailureReportDependencies = Readonly<{
  client: Pick<WorkerControlClient, "reportInputFailed">;
  deadlineTimer: DeadlineTimer;
}>;

// The same immutable proof and code on both attempts. Never throws.
export async function reportInputFailureWithPolicy(
  dependencies: InputFailureReportDependencies,
  executionAttemptId: string,
  proof: LeaseProof,
  failureCode: InputFailureCode,
): Promise<InputFailureReportResult> {
  try {
    const acknowledgement = await atMostTwoAttempts(dependencies.deadlineTimer, INPUT_FAILURE_REPORT_REQUEST_DEADLINE_MS, (signal) =>
      dependencies.client.reportInputFailed(executionAttemptId, proof, failureCode, signal),
    );
    return Object.freeze({ status: "REPORTED", acknowledgement });
  } catch {
    return Object.freeze({ status: "UNREPORTED" });
  }
}

export type InputMediaFailureOutcome =
  // The attempt is authoritatively FAILED_BEFORE_SUBMISSION.
  | Readonly<{ status: "PERMANENT_INPUT_REPORTED"; failureCode: InputFailureCode }>
  // The report is unconfirmed; the control plane decides by expiry.
  | Readonly<{ status: "PERMANENT_INPUT_UNREPORTED"; failureCode: InputFailureCode }>
  | Readonly<{ status: "TRANSIENT_STORAGE" }>
  | Readonly<{ status: "HOST_FAULT" }>;

export type InputMediaFailureDependencies = InputFailureReportDependencies & Readonly<{ latch: HostFaultLatch }>;

const UNCLASSIFIED: InputMediaFailure = Object.freeze({ kind: "HOST_FAULT" });

// Consumes what retrieveVerifiedReferenceImage threw. Anything that is not a
// classified retrieval failure is a host fault. Never throws.
export async function handleInputMediaFailure(
  dependencies: InputMediaFailureDependencies,
  executionAttemptId: string,
  proof: LeaseProof,
  error: unknown,
): Promise<InputMediaFailureOutcome> {
  const failure = error instanceof InputMediaRetrievalError ? error.failure : UNCLASSIFIED;
  switch (failure.kind) {
    case "PERMANENT_INPUT": {
      const report = await reportInputFailureWithPolicy(
        { client: dependencies.client, deadlineTimer: dependencies.deadlineTimer },
        executionAttemptId,
        proof,
        failure.reason,
      );
      return Object.freeze({ status: report.status === "REPORTED" ? "PERMANENT_INPUT_REPORTED" : "PERMANENT_INPUT_UNREPORTED", failureCode: failure.reason });
    }
    case "TRANSIENT_STORAGE":
      return Object.freeze({ status: "TRANSIENT_STORAGE" });
    default:
      dependencies.latch.trip();
      return Object.freeze({ status: "HOST_FAULT" });
  }
}
