import type {
  CharacterBible,
} from "../schemas/character.schema.js";

import type {
  EpisodeManifest,
  Shot,
} from "../schemas/episodeManifest.schema.js";

import type {
  ProviderRoutingPolicy,
} from "../schemas/providerRoutingPolicy.schema.js";

import type {
  ProductionRules,
} from "../schemas/productionRules.schema.js";

import {
  assertRunwayGen45ShotReady,
} from "../runway/cli/assertRunwayGen45ShotReady.js";

import {
  assertVeoShotReady,
} from "../veo/cli/assertVeoShotReady.js";

import {
  assertEpisodeApprovals,
  assertShotCanProgress,
} from "../validation/validateEpisodeProduction.js";

import {
  evaluateShotProvider,
} from "../routing/evaluateShotProvider.js";

import type {
  ManualReviewExecutionResolution,
  ShotExecutionReadiness,
} from "./executionReadiness.types.js";

function errorMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : "Unknown execution-readiness failure.";
}

export function evaluateShotExecutionReadiness(
  episode: EpisodeManifest,
  shot: Shot,
  bible: CharacterBible,
  rules: ProductionRules,
  policy: ProviderRoutingPolicy,
  manualReviewResolution?:
    ManualReviewExecutionResolution,
): ShotExecutionReadiness {
  const routing =
    evaluateShotProvider(
      shot,
      bible,
      rules,
      policy,
    );

  if (
    routing.disposition === "BLOCKED"
  ) {
    return {
      disposition: "BLOCKED",
      executionProvider: null,
      routing,
      reasons: routing.reasons,
      blockers: routing.blockers,
    };
  }

  if (
    routing.disposition === "CONFLICT"
  ) {
    return {
      disposition: "CONFLICT",
      executionProvider: null,
      routing,
      reasons: routing.reasons,
      blockers: routing.blockers,
    };
  }

  let executionProvider =
    routing.recommendedProvider;

  const resolvedManualReview =
    routing.disposition ===
      "MANUAL_REVIEW" &&
    manualReviewResolution !==
      undefined;

  if (
    manualReviewResolution &&
    routing.disposition !==
      "MANUAL_REVIEW"
  ) {
    return {
      disposition: "BLOCKED",
      executionProvider: null,
      routing,
      reasons: routing.reasons,
      blockers: [
        `${shot.id}: durable manual-review resolution cannot be applied when routing disposition is ${routing.disposition}.`,
      ],
    };
  }

  if (
    routing.disposition === "MANUAL_REVIEW"
  ) {
    if (!manualReviewResolution) {
      return {
        disposition: "MANUAL_REVIEW",
        executionProvider: null,
        routing,
        reasons: routing.reasons,
        blockers: routing.blockers,
      };
    }

    if (
      routing.blockers.length >
      0
    ) {
      return {
        disposition: "BLOCKED",
        executionProvider: null,
        routing,
        reasons: routing.reasons,
        blockers: [
          ...routing.blockers,
          `${shot.id}: durable manual-review resolution cannot override routing blockers.`,
        ],
      };
    }

    if (
      shot.generation.provider !==
      manualReviewResolution.provider
    ) {
      return {
        disposition: "CONFLICT",
        executionProvider: null,
        routing,
        reasons: routing.reasons,
        blockers: [
          `${shot.id}: authorized provider ${manualReviewResolution.provider} does not match manifest generation provider ${shot.generation.provider}.`,
        ],
      };
    }

    if (
      !rules.generation
        .supportedProviders
        .includes(
          manualReviewResolution.provider,
        )
    ) {
      return {
        disposition: "BLOCKED",
        executionProvider: null,
        routing,
        reasons: routing.reasons,
        blockers: [
          `${shot.id}: authorized provider ${manualReviewResolution.provider} is not enabled by production rules.`,
        ],
      };
    }

    executionProvider =
      manualReviewResolution.provider;
  }

  if (!executionProvider) {
    return {
      disposition: "BLOCKED",
      executionProvider: null,
      routing,
      reasons: routing.reasons,
      blockers: [
        `${shot.id}: routable shot has no recommended execution provider.`,
      ],
    };
  }

  try {
    assertEpisodeApprovals(
      episode,
      rules,
    );

    assertShotCanProgress(
      shot,
      bible,
      rules,
    );
  } catch (error) {
    return {
      disposition: "NOT_READY",
      executionProvider,
      routing,
      reasons: routing.reasons,
      blockers: [
        errorMessage(error),
      ],
    };
  }

  try {
    switch (executionProvider) {
      case "RUNWAY":
        assertRunwayGen45ShotReady(
          episode,
          shot,
        );
        break;

      case "VEO":
        assertVeoShotReady(
          episode,
          shot,
          resolvedManualReview
            ? "DURABLE_AUTHORIZED_DIALOGUE_VISUAL"
            : "CONNECTIVITY_CLI",
        );
        break;

      // B5C-X1: technical readiness only. Google admission, cost and the
      // paid-activation switch are owned by the Google orchestrator, which
      // shared execution reaches before any reservation or provider call.
      case "GOOGLE_GENAI":
        break;

      case "KREA":
        return {
          disposition: "BLOCKED",
          executionProvider: null,
          routing,
          reasons: routing.reasons,
          blockers: [
            `${shot.id}: KREA is a provider identity placeholder and has no production execution readiness guard.`,
          ],
        };

      case "MANUAL":
        return {
          disposition: "MANUAL_REVIEW",
          executionProvider,
          routing,
          reasons: [
            ...routing.reasons,
            `${shot.id}: execution provider is MANUAL and requires human handling.`,
          ],
          blockers: [],
        };

      default: {
        const unsupportedProvider: never =
          executionProvider;

        return {
          disposition: "BLOCKED",
          executionProvider: null,
          routing,
          reasons: routing.reasons,
          blockers: [
            `${shot.id}: no execution readiness guard exists for provider ${String(unsupportedProvider)}.`,
          ],
        };
      }
    }
  } catch (error) {
    return {
      disposition: "NOT_READY",
      executionProvider,
      routing,
      reasons: routing.reasons,
      blockers: [
        errorMessage(error),
      ],
    };
  }

  return {
    disposition: "EXECUTABLE",
    executionProvider,
    routing,
    reasons: [
      ...routing.reasons,
      ...(
        resolvedManualReview
          ? [
              `${shot.id}: dialogue visual provider ${executionProvider} was explicitly resolved by durable human authorization.`,
            ]
          : []
      ),
      `${shot.id}: ${executionProvider} execution readiness checks passed.`,
    ],
    blockers: [],
  };
}
