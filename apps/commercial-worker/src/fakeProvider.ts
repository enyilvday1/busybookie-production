import { isProviderExecutionId, type ProviderSubmissionOperationFactory, type ProviderSubmissionOutcome } from "./providerExecutionContract.js";
import { WorkerError } from "./workerError.js";

// The production fake provider
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 36,
// "First fake-provider execution slice", R44B9A). A deterministic local
// submission phase for the dedicated BUSYBOOKIE_FAKE provider identifier: no
// network, no SDK, no credential, no retry, and no polling or output. Its
// default behaviour accepts immediately with an attempt-bound execution ID;
// the typed failure behaviours exist only behind an explicit dependency
// seam, never an environment setting.

export const FAKE_PROVIDER_ID = "BUSYBOOKIE_FAKE";

export type FakeProviderBehavior = "ACCEPT" | "DEFINITIVE_FAILURE" | "AMBIGUOUS_FAILURE";

export type FakeProviderOptions = Readonly<{
  // Explicit dependency seam; the default is ACCEPT.
  behavior?: FakeProviderBehavior;
}>;

// Deterministic, attempt-bound and obviously fake; validated against the
// shared provider execution ID rule rather than assumed.
export function fakeProviderExecutionId(executionAttemptId: string): string {
  const id = `${FAKE_PROVIDER_ID}-${executionAttemptId}`;
  if (!isProviderExecutionId(id)) throw new WorkerError("PROVIDER_CONTRACT_VIOLATION");
  return id;
}

export function createFakeProviderOperationFactory(options: FakeProviderOptions = {}): ProviderSubmissionOperationFactory {
  const behavior = options.behavior ?? "ACCEPT";
  return (request) => {
    // Defence in depth: the composer admits only BUSYBOOKIE_FAKE leases.
    if (request.provider !== FAKE_PROVIDER_ID) throw new WorkerError("LEASED_PROVIDER_INCOMPATIBLE");
    const { executionAttemptId } = request;
    let dispatched = false;
    return Object.freeze({
      execute: async (onAccepted): Promise<ProviderSubmissionOutcome> => {
        // At most one dispatch per operation; there is no retry path.
        if (dispatched) throw new WorkerError("PROVIDER_CONTRACT_VIOLATION");
        dispatched = true;
        if (behavior === "DEFINITIVE_FAILURE") return Object.freeze({ kind: "DEFINITIVE_FAILURE" });
        if (behavior === "AMBIGUOUS_FAILURE") return Object.freeze({ kind: "AMBIGUOUS_FAILURE" });
        // Accepted: the callback is the durable acceptance and is awaited first.
        await onAccepted({ provider: FAKE_PROVIDER_ID, providerExecutionId: fakeProviderExecutionId(executionAttemptId) });
        return Object.freeze({ kind: "ACCEPTED" });
      },
    });
  };
}
