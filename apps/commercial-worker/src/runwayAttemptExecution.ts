import type { WorkerProviderAcceptance } from "./acceptanceHandler.js";
import { createAcceptanceAdapter, type AcceptanceAdapterDependencies } from "./acceptanceAdapter.js";
import type { RecoverySleep } from "./acceptanceRecoveryPolicy.js";
import { openLeasedCredentialOnce, type CredentialOpeningClient, type CredentialOpeningRunDependencies } from "./credentialOpeningRun.js";
import { reportSubmissionFailureWithPolicy } from "./failureReportPolicy.js";
import type { HostFaultLatch } from "./hostFaultLatch.js";
import { runWithInFlightHeartbeat, type InFlightHeartbeatContext } from "./inFlightHeartbeat.js";
import { handleInputMediaFailure, type InputMediaFailureDependencies, type InputMediaFailureOutcome } from "./inputMediaFailurePolicy.js";
import { retrieveVerifiedReferenceImage, type VerifiedReferenceImage } from "./inputMediaRetrieval.js";
import type { ObjectStore } from "./objectStorageContract.js";
import { obtainPreProviderPermit, realDeadlineTimer, type DeadlineTimer, type PreProviderOrchestrationDependencies } from "./preProviderOrchestration.js";
import { assertNoProviderProcessEnvironment } from "./providerEnvironment.js";
import { prepareRunwaySubmission, type RunwaySubmissionDependencies, type RunwaySubmissionOperation, type RunwaySubmissionOutcome } from "./runwayProviderAdapter.js";
import { admitRunwayLease, RUNWAY_MAX_REFERENCE_IMAGE_BYTES, type RunwayGenerationRequest } from "./runwayProviderContract.js";
import type { SubmissionFailureReport, SubmissionFailureState } from "./workerControlClient.js";
import type { WorkerConfig } from "./workerConfig.js";
import { WorkerError } from "./workerError.js";
import { bindWorkerStateRoot, type WorkerStateRootBindingDependencies } from "./workerStateRoot.js";

// The second real-provider execution composer
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 36,
// "Second real-provider adapter: Runway Gen-4.5 (revision R44B10B)").
// Library-only and default-off: no process, runner, selector or production
// caller exists, and the provider transport is always injected explicitly.
// One invocation: startup, at most one lease, at most one provider create:
//
//   actual-process environment refusal -> bindWorkerStateRoot -> startup
//   reconciliation -> lease -> provider, model and closed-request admission
//   (before any grant) -> grant -> open, verify, discard (sealed capability
//   kept) -> verified reference image (Runway raw-byte ceiling) -> R44B10P2
//   policy on failure (stop) -> obtainPreProviderPermit -> re-open the same
//   sealed grant -> inline data URI -> construct one client
//   -> runWithInFlightHeartbeat(one create -> awaited durable acceptance)
//   -> SUBMITTED; or one typed provider failure through the shared policy
//
// It ends at SUBMITTED: no task retrieval, waiting, upload, output or
// completion. The Google and fake-provider composers stay separate; none of
// them reaches another.

export type RunwayProviderAttemptDependencies = Omit<CredentialOpeningRunDependencies, "journal" | "client"> &
  WorkerStateRootBindingDependencies &
  Readonly<{
    // Exactly what the composed steps already require; nothing new.
    client: CredentialOpeningClient &
      PreProviderOrchestrationDependencies["client"] &
      InFlightHeartbeatContext["client"] &
      AcceptanceAdapterDependencies["client"] &
      InputMediaFailureDependencies["client"];
    latch: HostFaultLatch;
    // Required: there is no default object store.
    store: ObjectStore;
    // Required: the explicit provider transport (tests inject a non-network one).
    provider: RunwaySubmissionDependencies;
    deadlineTimer?: DeadlineTimer;
    // The in-flight keeper's abortable cadence sleep.
    keeperSleep?: RecoverySleep;
    clock?: () => Date;
  }>;

export type RunwayProviderAttemptResult =
  | Readonly<{ status: "NO_WORK" }>
  // The acceptance is durable and the control plane recorded it.
  | Readonly<{ status: "SUBMITTED"; executionAttemptId: string }>
  // The input image stopped the attempt before any permit or client.
  | Readonly<{ status: "STOPPED_ON_INPUT_MEDIA"; executionAttemptId: string; input: InputMediaFailureOutcome }>
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

export async function runRunwayProviderAttemptOnce(config: WorkerConfig, dependencies: RunwayProviderAttemptDependencies): Promise<RunwayProviderAttemptResult> {
  const { host, journalFileSystem, client, latch, store, provider, deadlineTimer, keeperSleep, clock, ...opening } = dependencies;

  // The environment the provider SDK itself reads, before any request.
  try {
    assertNoProviderProcessEnvironment();
  } catch (error) {
    opening.log?.({ stage: "STARTUP", outcome: "FAILED", code: "FORBIDDEN_PROVIDER_ENVIRONMENT" });
    throw error;
  }

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

  // Startup reconciliation, lease, admission, grant and open: the one shared
  // path. Admission runs on the authoritative lease before any grant.
  const admitted: { request?: RunwayGenerationRequest } = {};
  const opened = await openLeasedCredentialOnce(
    { ...opening, journal, client },
    (lease) => {
      try {
        admitted.request = admitRunwayLease(lease);
      } catch (error) {
        // Incompatible work or an issuer invariant violation: no grant, no
        // report; the lease is left to authoritative expiry.
        latch.trip();
        throw error;
      }
    },
    { retainSealedCredential: true },
  );
  if (opened.status === "NO_WORK") return Object.freeze({ status: "NO_WORK" });

  const { context, sealedCredential } = opened;
  const { proof } = context;
  const executionAttemptId = context.lease.executionAttemptId;
  const timer = deadlineTimer ?? realDeadlineTimer;
  const request = admitted.request;
  if (request === undefined || sealedCredential === undefined) {
    latch.trip();
    throw new WorkerError("PROVIDER_CONTRACT_VIOLATION");
  }

  // The verified reference image, after the grant and before any permit.
  let image: VerifiedReferenceImage;
  try {
    image = await retrieveVerifiedReferenceImage(
      { accountId: context.accountId, reference: request.referenceImage, maxBytes: RUNWAY_MAX_REFERENCE_IMAGE_BYTES },
      { store, deadlineTimer: timer },
    );
  } catch (error) {
    // R44B10P2: report a permanent input failure, ignore a transient outage,
    // latch a host fault; in every case nothing more happens here.
    const input = await handleInputMediaFailure({ client, deadlineTimer: timer, latch }, executionAttemptId, proof, error);
    return Object.freeze({ status: "STOPPED_ON_INPUT_MEDIA", executionAttemptId, input });
  }

  // Journal preparation, the provider-call barrier and the mandatory
  // renewal; a failure propagates with nothing constructed or dispatched.
  const permit = await obtainPreProviderPermit({ journal, client, deadlineTimer: timer }, executionAttemptId, proof);

  // Only now does a submission-capable object exist. A failure here is
  // before any dispatch: a host fault, no provider report, and the
  // authoritative expiry sweep converges the attempt.
  let operation: RunwaySubmissionOperation;
  try {
    operation = await prepareRunwaySubmission({ executionAttemptId, provider: context.lease.provider, request, image, sealedCredential }, provider);
  } catch (error) {
    latch.trip();
    throw error instanceof WorkerError ? error : new WorkerError("PROVIDER_CONTRACT_VIOLATION");
  }

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
  let outcome: RunwaySubmissionOutcome;
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
    // Accepted authority is fixed; any other result changes nothing upstream.
    if (kind === "ACCEPTED") return Object.freeze({ status: "SUBMITTED", executionAttemptId });
    return violation();
  }
  if (acceptance() === "REJECTED") return rethrowAdapterError();
  // A callback still running was not awaited: nothing more may be reported.
  if (acceptance() === "INVOKED") return violation();

  if (kind === "ACCEPTED" || (outcome as { hostFault?: unknown }).hostFault !== undefined) {
    // ACCEPTED without durable acceptance, or a malformed provider success:
    // dispatch may have succeeded, so ambiguous, and a host fault.
    latch.trip();
    await reportSubmissionFailureWithPolicy({ client, deadlineTimer: timer }, executionAttemptId, proof, AMBIGUOUS);
    throw new WorkerError("PROVIDER_CONTRACT_VIOLATION");
  }
  if (kind !== "DEFINITIVE_FAILURE" && kind !== "AMBIGUOUS_FAILURE") return violation();

  // An ordinary provider failure before acceptance: reported once, never
  // retried, and not a host fault.
  const reported = await reportSubmissionFailureWithPolicy({ client, deadlineTimer: timer }, executionAttemptId, proof, kind === "DEFINITIVE_FAILURE" ? DEFINITIVE : AMBIGUOUS);
  if (reported.status === "REPORTED") {
    return Object.freeze({ status: "PROVIDER_FAILURE_REPORTED", executionAttemptId, outcome: kind, state: reported.acknowledgement.state });
  }
  return Object.freeze({ status: "PROVIDER_FAILURE_UNREPORTED", executionAttemptId, outcome: kind });
}
