import type { DeadlineTimer } from "./preProviderOrchestration.js";
import type { LeaseProof, SubmissionFailureReport, WorkerControlClient, WorkerSubmissionFailedAcknowledgement } from "./workerControlClient.js";
import { WorkerError } from "./workerError.js";

// The shared worker-control reporting policy
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 18,
// R44B6Y0; extracted unchanged by R44B9 so that the acceptance adapter and
// the fake-provider composer use one implementation, section 36 R44B9A).
//
// Every request gets a fresh controller and its own deadline, and at most
// two attempts are made, both immediate: only CONTROL_API_UNAVAILABLE earns
// the second. No backoff, no jitter, no provider retry. The submission
// failure report is best effort: its own failure changes nothing here; the
// caller decides, and the authoritative expiry sweep remains.

export const SUBMISSION_FAILURE_REPORT_MAX_ATTEMPTS = 2;
export const SUBMISSION_FAILURE_REPORT_REQUEST_DEADLINE_MS = 10000;

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
export async function atMostTwoAttempts<T>(timer: DeadlineTimer, deadlineMs: number, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  try {
    return await withRequestDeadline(timer, deadlineMs, request);
  } catch (error) {
    if (!(error instanceof WorkerError) || error.code !== "CONTROL_API_UNAVAILABLE") throw error;
  }
  return withRequestDeadline(timer, deadlineMs, request);
}

export type SubmissionFailureReportResult =
  | Readonly<{ status: "REPORTED"; acknowledgement: WorkerSubmissionFailedAcknowledgement }>
  // Unavailable twice, refused (409, for example after lost lease authority),
  // or rejected otherwise: nothing was established.
  | Readonly<{ status: "UNREPORTED" }>;

export type SubmissionFailureReportDependencies = Readonly<{
  client: Pick<WorkerControlClient, "reportSubmissionFailed">;
  deadlineTimer: DeadlineTimer;
}>;

// The same immutable report and proof on both attempts. Never throws.
export async function reportSubmissionFailureWithPolicy(
  dependencies: SubmissionFailureReportDependencies,
  executionAttemptId: string,
  proof: LeaseProof,
  report: SubmissionFailureReport,
): Promise<SubmissionFailureReportResult> {
  try {
    const acknowledgement = await atMostTwoAttempts(dependencies.deadlineTimer, SUBMISSION_FAILURE_REPORT_REQUEST_DEADLINE_MS, (signal) =>
      dependencies.client.reportSubmissionFailed(executionAttemptId, proof, report, signal),
    );
    return Object.freeze({ status: "REPORTED", acknowledgement });
  } catch {
    return Object.freeze({ status: "UNREPORTED" });
  }
}
