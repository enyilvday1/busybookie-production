import {
  evaluateShotProvider,
} from "./evaluateShotProvider.js";

type ProviderRoutingDecision =
  ReturnType<
    typeof evaluateShotProvider
  >;

type ProviderRoutingArguments =
  Parameters<
    typeof evaluateShotProvider
  >;

type ImmutableProviderRoutingDecision =
  Readonly<
    Omit<
      ProviderRoutingDecision,
      "reasons" |
      "blockers"
    > & {
      reasons:
        ReadonlyArray<string>;

      blockers:
        ReadonlyArray<string>;
    }
  >;

export type OptimizableVisualProvider =
  | "RUNWAY"
  | "VEO";

export type PreReservationProviderOptimizationAssessment =
  Readonly<{
    schemaVersion:
      "1.0";

    assessmentDisposition:
      | "PRESERVE_CANONICAL_ROUTING"
      | "NOT_APPLICABLE";

    routingDecision:
      ImmutableProviderRoutingDecision;

    selectedProvider:
      OptimizableVisualProvider |
      null;

    eligibleProviders:
      ReadonlyArray<
        OptimizableVisualProvider
      >;

    optimizationApplied:
      false;

    reasonCode:
      | "CANONICAL_ROUTING_PRESERVED"
      | "CANONICAL_ROUTING_NOT_ROUTABLE";
  }>;

function isOptimizableVisualProvider(
  value: unknown,
): value is OptimizableVisualProvider {
  return value ===
    "RUNWAY" ||
    value ===
      "VEO";
}

function createImmutableRoutingDecision(
  routingDecision:
    ProviderRoutingDecision,
): ImmutableProviderRoutingDecision {
  const reasons =
    Object.freeze([
      ...routingDecision
        .reasons,
    ]);

  const blockers =
    Object.freeze([
      ...routingDecision
        .blockers,
    ]);

  return Object.freeze({
    ...routingDecision,

    reasons,

    blockers,
  });
}

function assessCanonicalRoutingDecision(
  routingDecision:
    ProviderRoutingDecision,
): PreReservationProviderOptimizationAssessment {
  const immutableRoutingDecision =
    createImmutableRoutingDecision(
      routingDecision,
    );

  if (
    immutableRoutingDecision
      .disposition !==
    "ROUTABLE"
  ) {
    return Object.freeze({
      schemaVersion:
        "1.0",

      assessmentDisposition:
        "NOT_APPLICABLE",

      routingDecision:
        immutableRoutingDecision,

      selectedProvider:
        null,

      eligibleProviders:
        Object.freeze(
          [],
        ) as ReadonlyArray<
          OptimizableVisualProvider
        >,

      optimizationApplied:
        false,

      reasonCode:
        "CANONICAL_ROUTING_NOT_ROUTABLE",
    });
  }

  if (
    immutableRoutingDecision
      .blockers.length !==
    0
  ) {
    throw new Error(
      "E10 pre-reservation optimization refused an internally inconsistent ROUTABLE decision with blockers.",
    );
  }

  if (
    immutableRoutingDecision
      .manifestConflict !==
    false
  ) {
    throw new Error(
      "E10 pre-reservation optimization refused an internally inconsistent ROUTABLE decision with a manifest conflict.",
    );
  }

  if (
    immutableRoutingDecision
      .currentProviderMatchesRecommendation !==
    true
  ) {
    throw new Error(
      "E10 pre-reservation optimization refused a ROUTABLE decision whose current provider does not match the canonical recommendation.",
    );
  }

  const provider =
    immutableRoutingDecision
      .recommendedProvider;

  if (
    !isOptimizableVisualProvider(
      provider,
    )
  ) {
    throw new Error(
      "E10 pre-reservation optimization requires a ROUTABLE canonical recommendation of RUNWAY or VEO.",
    );
  }

  if (
    immutableRoutingDecision
      .currentProvider !==
    provider
  ) {
    throw new Error(
      "E10 pre-reservation optimization refused a ROUTABLE decision whose provider identity is internally inconsistent.",
    );
  }

  return Object.freeze({
    schemaVersion:
      "1.0",

    assessmentDisposition:
      "PRESERVE_CANONICAL_ROUTING",

    routingDecision:
      immutableRoutingDecision,

    selectedProvider:
      provider,

    eligibleProviders:
      Object.freeze([
        provider,
      ]),

    optimizationApplied:
      false,

    reasonCode:
      "CANONICAL_ROUTING_PRESERVED",
  });
}

// E10 first implementation slice.
//
// This function is deliberately a pure wrapper around the canonical provider
// router. It performs no provider calls, cost lookup, capability probing,
// reservation, submission or recovery work. It cannot switch providers.
//
// The routing decision exposed by the assessment is an E10-owned immutable
// snapshot. The canonical router's return object is never frozen or mutated.
//
// A later E10 slice may consume this assessment before durable reservation,
// but only after a separately reviewed normalized pre-reservation economics
// and capability contract exists.
export function assessPreReservationProviderOptimization(
  ...args:
    ProviderRoutingArguments
): PreReservationProviderOptimizationAssessment {
  const routingDecision =
    evaluateShotProvider(
      ...args,
    );

  return assessCanonicalRoutingDecision(
    routingDecision,
  );
}
