import type {
  GenerationProvider,
} from "../schemas/productionRules.schema.js";

import type {
  ProviderRoutingDecision,
} from "../routing/providerRouter.types.js";

export type ExecutionReadinessDisposition =
  | "EXECUTABLE"
  | "NOT_READY"
  | "MANUAL_REVIEW"
  | "CONFLICT"
  | "BLOCKED";

export type ShotExecutionReadiness = Readonly<{
  disposition: ExecutionReadinessDisposition;
  executionProvider: GenerationProvider | null;
  routing: ProviderRoutingDecision;
  reasons: readonly string[];
  blockers: readonly string[];
}>;
