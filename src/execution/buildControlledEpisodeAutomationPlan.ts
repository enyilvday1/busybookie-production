import type { BoundEpisodePreflight, ControlledEpisodeAutomationPlan, EvidenceAdoption } from "./boundEpisodeProduction.types.js";
import { parseEpisodeAutomationPlan } from "./episodeAutomationPlan.schema.js";

// B7E5D8Z16-B5: the pure preflight -> schema-2.0 plan transformation. The
// single action comes only from preflight.nextActionCandidate; the caller
// supplies nothing but the reviewed evidence adoptions. No I/O, environment,
// provider or durable mutation: parseEpisodeAutomationPlan stays the authority.

export type BuildControlledEpisodeAutomationPlanInput = Readonly<{
  preflight: BoundEpisodePreflight;
  evidenceAdoptions: readonly EvidenceAdoption[];
}>;

const INPUT_KEYS = ["evidenceAdoptions", "preflight"];
const OPERATING_CONDITION = { singleOperator: true, noConcurrentAuthoring: true, noUnguardedRunners: true } as const;

function buildError(detail: string): Error {
  return new Error(`Controlled episode automation plan cannot be built: ${detail}`);
}

export function buildControlledEpisodeAutomationPlan(input: BuildControlledEpisodeAutomationPlanInput): ControlledEpisodeAutomationPlan {
  // Reject any caller-supplied action, allowance or other extra authority.
  if (input === null || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).sort().join(",") !== INPUT_KEYS.join(",")) {
    throw new TypeError("Controlled plan input must contain exactly preflight and evidenceAdoptions.");
  }
  const { preflight, evidenceAdoptions } = input;
  if (preflight === null || typeof preflight !== "object") throw new TypeError("Controlled plan input requires a preflight.");
  if (!Array.isArray(evidenceAdoptions)) throw new TypeError("Controlled plan input requires explicit reviewed evidenceAdoptions.");
  if (preflight.inventory.complete !== true) throw buildError("the preflight inventory is incomplete.");
  if (preflight.binding === null) throw buildError("the preflight has no input binding.");
  if (preflight.bindingSha256 === null) throw buildError("the preflight has no input binding digest.");
  const candidate = preflight.nextActionCandidate;
  if (candidate === null) throw buildError("the preflight has no next action candidate.");

  const target = { episodeId: candidate.episodeId, sceneId: candidate.sceneId, shotId: candidate.shotId, order: candidate.order };
  let action: Readonly<Record<string, unknown>>;
  switch (candidate.kind) {
    case "VISUAL_GENERATE":
      action = { ...target, kind: candidate.kind, expectedLifecycle: candidate.expectedLifecycle, resolvedProvider: candidate.provider,
        referenceBinding: candidate.referenceBinding, costAuthority: { unit: candidate.cost.unit, modeledValue: candidate.cost.modeledValue,
          maxModeledValue: candidate.cost.perShotCap, policySha256: candidate.cost.policySha256 }, confirmPaidGeneration: true };
      break;
    case "VISUAL_RECONCILE":
      action = { ...target, kind: candidate.kind, expectedLifecycle: candidate.expectedLifecycle,
        reservationId: candidate.observation.reservationId, durableProvider: candidate.observation.durableProvider,
        providerExecutionIdentitySha256: candidate.observation.providerExecutionIdentitySha256,
        submissionSha256: candidate.observation.submissionSha256, reservationSha256: candidate.observation.reservationSha256,
        confirmReconciliation: true };
      break;
    case "VISUAL_ATTEMPT_GENERATE":
      // The attempt number is copied verbatim: never inferred, incremented or scanned.
      action = { ...target, kind: candidate.kind, attemptNumber: candidate.attemptNumber,
        expectedAttemptLifecycle: candidate.expectedAttemptLifecycle, resolvedProvider: candidate.provider,
        referenceBinding: candidate.referenceBinding, costAuthority: { unit: candidate.cost.unit, modeledValue: candidate.cost.modeledValue,
          maxModeledValue: candidate.cost.perShotCap, policySha256: candidate.cost.policySha256 }, confirmPaidGeneration: true };
      break;
    default: {
      const unsupported: never = candidate;
      void unsupported;
      throw buildError("unsupported candidate kind.");
    }
  }

  const plan = parseEpisodeAutomationPlan({ schemaVersion: "2.0", mode: "CONTROLLED_VISUAL", episodeId: preflight.episodeId,
    scope: preflight.scope, inputBinding: preflight.binding, inputBindingSha256: preflight.bindingSha256,
    observations: preflight.observations, observationsSha256: preflight.observationsSha256, evidenceAdoptions,
    maximumNewProviderCreates: candidate.kind === "VISUAL_RECONCILE" ? 0 : 1, operatingCondition: OPERATING_CONDITION,
    actions: [action] });
  if (plan.schemaVersion !== "2.0") throw buildError("the parser did not return a controlled plan.");
  return plan;
}
