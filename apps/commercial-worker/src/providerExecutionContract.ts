import type { WorkerProviderAcceptance } from "./acceptanceHandler.js";

// The worker's single entry to the shared provider execution ID rule
// (packages/commercial-worker-protocol, migration 0004). The journal and the
// submitted client import it from here, so the rule is never copied.
export { isProviderExecutionId, MAX_PROVIDER_EXECUTION_ID_LENGTH } from "commercial-worker-protocol";

// R44B9: the worker-local, provider-neutral submission-phase contract
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 36,
// "First fake-provider execution slice", R44B9A). It covers only the provider
// create/submit plus the awaited durable acceptance callback; never polling,
// download, output or completion.
//
// The callback is the sole authority for the provider execution ID: an
// outcome never carries one. ACCEPTED is valid only after the callback has
// resolved. Provider-originated failures are typed outcomes; anything else
// (an untyped throw) is a contract violation for the composer to fail closed on.

export type ProviderSubmissionOutcome =
  | Readonly<{ kind: "ACCEPTED" }>
  // The provider unambiguously refused: nothing was accepted.
  | Readonly<{ kind: "DEFINITIVE_FAILURE" }>
  // Acceptance cannot be ruled out (timeout, reset, uncertain response).
  | Readonly<{ kind: "AMBIGUOUS_FAILURE" }>;

export type ProviderAcceptanceCallback = (acceptance: WorkerProviderAcceptance) => Promise<void>;

// Executes the provider create at most once per operation. It must await the
// callback before settling ACCEPTED. No retry facility exists.
export type ProviderSubmissionOperation = Readonly<{
  execute: (onAccepted: ProviderAcceptanceCallback) => Promise<ProviderSubmissionOutcome>;
}>;

// The only data an operation is constructed from: non-secret identity. No
// credential, lease token, worker credential or API key.
export type ProviderSubmissionRequest = Readonly<{
  executionAttemptId: string;
  provider: string;
}>;

// Called only after the pre-provider permit exists, so no
// submission-capable object exists before it.
export type ProviderSubmissionOperationFactory = (request: ProviderSubmissionRequest) => ProviderSubmissionOperation;
