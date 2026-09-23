import type {
  GenerationProvider,
} from "../schemas/productionRules.schema.js";

export type ProviderRoutingDisposition =
  | "ROUTABLE"
  | "BLOCKED"
  | "MANUAL_REVIEW"
  | "CONFLICT";

export type ProviderRoutingDecision = Readonly<{
  disposition: ProviderRoutingDisposition;
  recommendedProvider: GenerationProvider | null;
  currentProvider: GenerationProvider;
  currentProviderMatchesRecommendation: boolean | null;
  manifestConflict: boolean;
  reasons: readonly string[];
  blockers: readonly string[];
}>;
