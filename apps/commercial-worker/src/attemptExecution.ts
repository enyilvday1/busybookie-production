import type { WorkerProviderAcceptance } from "./acceptanceHandler.js";
import { createAcceptanceAdapter, type AcceptanceAdapterDependencies } from "./acceptanceAdapter.js";
import type { RecoverySleep } from "./acceptanceRecoveryPolicy.js";
import { openLeasedCredentialOnce, type CredentialOpeningClient, type CredentialOpeningRunDependencies } from "./credentialOpeningRun.js";
import { createFakeProviderOperationFactory, FAKE_PROVIDER_ID } from "./fakeProvider.js";
import { reportSubmissionFailureWithPolicy } from "./failureReportPolicy.js";
import type { HostFaultLatch } from "./hostFaultLatch.js";
import { runWithInFlightHeartbeat, type InFlightHeartbeatContext } from "./inFlightHeartbeat.js";
import { obtainPreProviderPermit, realDeadlineTimer, type DeadlineTimer, type PreProviderOrchestrationDependencies } from "./preProviderOrchestration.js";
import type { ProviderSubmissionOperationFactory, ProviderSubmissionOutcome } from "./providerExecutionContract.js";
import type { SubmissionFailureReport, SubmissionFailureState } from "./workerControlClient.js";
import type { WorkerConfig } from "./workerConfig.js";
import { WorkerError } from "./workerError.js";
import { bindWorkerStateRoot, type WorkerStateRootBindingDependencies } from "./workerStateRoot.js";

// The first production fake-provider execution composer
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 36,
// "First fake-provider execution slice", R44B9A). Library-only: one startup,
// at most one leased attempt, at most one provider dispatch, and it stops at
// SUBMITTED or a reported provider failure:
//
//   development only -> bindWorkerStateRoot -> startup reconciliation -> lease
//   -> lease.provider must be BUSYBOOKIE_FAKE (before any grant)
//   -> grant -> open, verify, discard -> obtainPreProviderPermit
//   -> only now construct the operation -> acceptance adapter
//   -> runWithInFlightHeartbeat(create -> awaited durable acceptance)
//   -> SUBMITTED; or a typed failure reported through the shared policy
//
// It is fake-only by construction: no real provider, SDK, network or provider
// mode exists here, and the operation receives no credential or lease token.
// There is no loop, retry, daemon or process entry point.

export type FakeProviderAttemptDependencies = Omit<CredentialOpeningRunDependencies, "journal" | "client"> &
  WorkerStateRootBindingDependencies &
  Readonly<{
    // Exactly what the composed steps already require; nothing new.
    client: CredentialOpeningClient &
      PreProviderOrchestrationDependencies["client"] &
      InFlightHeartbeatContext["client"] &
      AcceptanceAdapterDependencies["client"];
    latch: HostFaultLatch;
    // The production fake by default; tests may inject another operation
    // through this same seam (for example a pending one).
    operationFactory?: ProviderSubmissionOperationFactory;
    deadlineTimer?: DeadlineTimer;
    // The in-flight keeper's abortable cadence sleep.
    keeperSleep?: RecoverySleep;
    clock?: () => Date;
  }>;

export type FakeProviderAttemptResult =
  | Readonly<{ status: "NO_WORK" }>
  // The acceptance is durable and the control plane recorded it (live report
  // or acceptance recovery).
  | Readonly<{ status: "SUBMITTED"; executionAttemptId: string }>
  // A typed failure before acceptance, and what the shared report policy
  // established; UNREPORTED leaves the authoritative expiry sweep in charge.
  | Readonly<{
      status: "PROVIDER_FAILURE_REPORTED";
      executionAttemptId: string;
      outcome: "DEFINITIVE_FAILURE" | "AMBIGUOUS_FAILURE";
      state: SubmissionFailureState;
    }>
  | Readonly<{ status: "PROVIDER_FAILURE_UNREPORTED"; executionAttemptId: string; outcome: "DEFINITIVE_FAILURE" | "AMBIGUOUS_FAILURE" }>;

const DEFINITIVE: SubmissionFailureReport = Object.freeze({ outcome: "DEFINITIVELY_REJECTED", failureCode: "PROVIDER_REJECTED_DEFINITIVELY" });
const AMBIGUOUS: SubmissionFailureReport = Object.freeze({ outcome: "OUTCOME_UNKNOWN", failureCode: "PROVIDER_SUBMISSION_AMBIGUOUS" });

type AcceptanceState = "NONE" | "INVOKED" | "COMPLETED" | "REJECTED";

export async function runConfiguredFakeProviderAttemptOnce(config: WorkerConfig, dependencies: FakeProviderAttemptDependencies): Promise<FakeProviderAttemptResult> {
  const { host, journalFileSystem, client, latch, operationFactory, deadlineTimer, keeperSleep, clock, ...opening } = dependencies;
  // Fake execution never runs in production: refused before any request.
  if (config.mode !== "development") throw new WorkerError("WORKER_CONFIGURATION_INVALID");

  let journal;
  try {
    journal = await bindWorkerStateRoot(config, {
      ...(host === undefined ? {} : { host }),
      ...(journalFileSystem === undefined ? {} : { journalFileSystem }),
    });
  } catch {
    opening.log?.({ stage: "STARTUP", outcome: "FAILED", code: "STATE_ROOT_UNSUITABLE" });
    throw new WorkerError("STATE_ROOT_UNSUITABLE");
  }

  // Startup reconciliation, lease, admission, grant and open: the one shared path.
  const opened = await openLeasedCredentialOnce({ ...opening, journal, client }, (lease) => {
    if (lease.provider !== FAKE_PROVIDER_ID) {
      // Incompatible work for a fake-only worker: no grant, no opening, no
      // report. The lease is left to normal authoritative expiry.
      latch.trip();
      throw new WorkerError("LEASED_PROVIDER_INCOMPATIBLE");
    }
  });
  if (opened.status === "NO_WORK") return Object.freeze({ status: "NO_WORK" });

  const { context } = opened;
  const { proof } = context;
  const executionAttemptId = context.lease.executionAttemptId;
  const timer = deadlineTimer ?? realDeadlineTimer;

  // Journal preparation, SUBMITTING and the mandatory renewal; a failure
  // propagates with nothing constructed or dispatched.
  const permit = await obtainPreProviderPermit({ journal, client, deadlineTimer: timer }, executionAttemptId, proof);

  // Only now does a submission-capable object exist.
  const operation = (operationFactory ?? createFakeProviderOperationFactory())({ executionAttemptId, provider: context.lease.provider });

  const adapter = createAcceptanceAdapter({ lease: context.lease, accountId: context.accountId, permit }, proof, {
    journal,
    client,
    latch,
    deadlineTimer: timer,
    ...(clock === undefined ? {} : { clock }),
    ...(opening.monotonicNow === undefined ? {} : { monotonicNow: opening.monotonicNow }),
    ...(opening.sleep === undefined ? {} : { sleep: opening.sleep }),
  });

  // Local tracking only; the durable authority stays with the adapter.
  const tracked: { state: AcceptanceState; error: unknown } = { state: "NONE", error: undefined };
  const onAccepted = async (accepted: WorkerProviderAcceptance): Promise<void> => {
    if (tracked.state === "NONE") tracked.state = "INVOKED";
    try {
      await adapter(accepted);
    } catch (error) {
      if (tracked.state !== "COMPLETED") {
        tracked.state = "REJECTED";
        tracked.error = error;
      }
      throw error;
    }
    tracked.state = "COMPLETED";
  };
  const acceptance = (): AcceptanceState => tracked.state;
  const rethrowAdapterError = (): never => {
    throw tracked.error instanceof WorkerError ? tracked.error : new WorkerError("PROVIDER_CONTRACT_VIOLATION");
  };

  const violation = (): never => {
    latch.trip();
    throw new WorkerError("PROVIDER_CONTRACT_VIOLATION");
  };

  // The single dispatch: one invocation, inside the keeper, with no retry.
  let outcome: ProviderSubmissionOutcome;
  try {
    outcome = await runWithInFlightHeartbeat(
      { executionAttemptId, proof, client, latch, deadlineTimer: timer, ...(keeperSleep === undefined ? {} : { sleep: keeperSleep }) },
      () => operation.execute(onAccepted),
    );
  } catch {
    // The adapter already reported, latched and failed closed: no duplicate report.
    if (acceptance() === "REJECTED") return rethrowAdapterError();
    // An untyped throw, before or after acceptance: never a provider outcome.
    return violation();
  }

  const kind = (outcome as { kind?: unknown } | null)?.kind;
  if (acceptance() === "COMPLETED") {
    // Accepted authority is fixed; any other result is a contract violation
    // that changes nothing upstream.
    if (kind === "ACCEPTED") return Object.freeze({ status: "SUBMITTED", executionAttemptId });
    return violation();
  }
  if (acceptance() === "REJECTED") return rethrowAdapterError();
  // A callback still running was not awaited: nothing more may be reported.
  if (acceptance() === "INVOKED") return violation();

  if (kind === "ACCEPTED") {
    // ACCEPTED without durable acceptance: ambiguous, and a violation.
    latch.trip();
    await reportSubmissionFailureWithPolicy({ client, deadlineTimer: timer }, executionAttemptId, proof, AMBIGUOUS);
    throw new WorkerError("PROVIDER_CONTRACT_VIOLATION");
  }
  if (kind !== "DEFINITIVE_FAILURE" && kind !== "AMBIGUOUS_FAILURE") return violation();

  // An ordinary provider failure before acceptance: reported, never retried,
  // and not a host fault.
  const reported = await reportSubmissionFailureWithPolicy({ client, deadlineTimer: timer }, executionAttemptId, proof, kind === "DEFINITIVE_FAILURE" ? DEFINITIVE : AMBIGUOUS);
  if (reported.status === "REPORTED") {
    return Object.freeze({ status: "PROVIDER_FAILURE_REPORTED", executionAttemptId, outcome: kind, state: reported.acknowledgement.state });
  }
  return Object.freeze({ status: "PROVIDER_FAILURE_UNREPORTED", executionAttemptId, outcome: kind });
}
