import {
  describe,
  expect,
  it,
} from "vitest";

import {
  assessPreReservationProviderOptimization,
} from "../src/routing/assessPreReservationProviderOptimization.js";

import {
  loadCharacterBible,
} from "../src/validation/loadCharacterBible.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

import {
  loadProductionRules,
} from "../src/validation/loadProductionRules.js";

import {
  loadProviderRoutingPolicy,
} from "../src/validation/loadProviderRoutingPolicy.js";

async function loadAssessmentContext() {
  const [
    bible,
    rules,
    policy,
  ] =
    await Promise.all([
      loadCharacterBible(),
      loadProductionRules(),
      loadProviderRoutingPolicy(),
    ]);

  return {
    bible,
    rules,
    policy,
  };
}

describe(
  "Busybookie pre-reservation provider optimization assessment",
  () => {
    it(
      "preserves the canonical Runway route for a visual-only non-dialogue shot",
      async () => {
        const [
          episode,
          context,
        ] =
          await Promise.all([
            loadEpisodeManifest(
              "EP90",
            ),
            loadAssessmentContext(),
          ]);

        const shot =
          episode.scenes[0]
            ?.shots[0];

        if (!shot) {
          throw new Error(
            "Expected EP90 S01.",
          );
        }

        const assessment =
          assessPreReservationProviderOptimization(
            shot,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(
          assessment
            .assessmentDisposition,
        ).toBe(
          "PRESERVE_CANONICAL_ROUTING",
        );

        expect(
          assessment
            .routingDecision
            .disposition,
        ).toBe(
          "ROUTABLE",
        );

        expect(
          assessment
            .selectedProvider,
        ).toBe(
          "RUNWAY",
        );

        expect(
          assessment
            .eligibleProviders,
        ).toEqual([
          "RUNWAY",
        ]);

        expect(
          assessment
            .optimizationApplied,
        ).toBe(
          false,
        );

        expect(
          assessment
            .reasonCode,
        ).toBe(
          "CANONICAL_ROUTING_PRESERVED",
        );

        expect(
          Object.isFrozen(
            assessment,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            assessment
              .eligibleProviders,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "preserves the canonical Veo route for a native-audio non-dialogue shot",
      async () => {
        const [
          episode,
          context,
        ] =
          await Promise.all([
            loadEpisodeManifest(
              "EP91",
            ),
            loadAssessmentContext(),
          ]);

        const shot =
          episode.scenes[0]
            ?.shots[0];

        if (!shot) {
          throw new Error(
            "Expected EP91 S01.",
          );
        }

        const assessment =
          assessPreReservationProviderOptimization(
            shot,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(
          assessment
            .assessmentDisposition,
        ).toBe(
          "PRESERVE_CANONICAL_ROUTING",
        );

        expect(
          assessment
            .selectedProvider,
        ).toBe(
          "VEO",
        );

        expect(
          assessment
            .eligibleProviders,
        ).toEqual([
          "VEO",
        ]);

        expect(
          assessment
            .optimizationApplied,
        ).toBe(
          false,
        );

        expect(
          assessment
            .routingDecision
            .currentProviderMatchesRecommendation,
        ).toBe(
          true,
        );
      },
    );

    it(
      "does not optimize a dialogue shot that canonical routing requires to remain manual",
      async () => {
        const [
          episode,
          context,
        ] =
          await Promise.all([
            loadEpisodeManifest(
              "EP02",
            ),
            loadAssessmentContext(),
          ]);

        const shot =
          episode.scenes[0]
            ?.shots[1];

        if (!shot) {
          throw new Error(
            "Expected EP02 S02.",
          );
        }

        const assessment =
          assessPreReservationProviderOptimization(
            shot,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(
          assessment
            .assessmentDisposition,
        ).toBe(
          "NOT_APPLICABLE",
        );

        expect(
          assessment
            .routingDecision
            .disposition,
        ).toBe(
          "MANUAL_REVIEW",
        );

        expect(
          assessment
            .selectedProvider,
        ).toBeNull();

        expect(
          assessment
            .eligibleProviders,
        ).toEqual([]);

        expect(
          assessment
            .optimizationApplied,
        ).toBe(
          false,
        );

        expect(
          assessment
            .reasonCode,
        ).toBe(
          "CANONICAL_ROUTING_NOT_ROUTABLE",
        );
      },
    );

    it(
      "does not optimize a canonical manifest-provider conflict",
      async () => {
        const [
          episode,
          context,
        ] =
          await Promise.all([
            loadEpisodeManifest(
              "EP91",
            ),
            loadAssessmentContext(),
          ]);

        const sourceShot =
          episode.scenes[0]
            ?.shots[0];

        if (!sourceShot) {
          throw new Error(
            "Expected EP91 S01.",
          );
        }

        const shot =
          structuredClone(
            sourceShot,
          );

        shot.generation.provider =
          "RUNWAY";

        const assessment =
          assessPreReservationProviderOptimization(
            shot,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(
          assessment
            .assessmentDisposition,
        ).toBe(
          "NOT_APPLICABLE",
        );

        expect(
          assessment
            .routingDecision
            .disposition,
        ).toBe(
          "CONFLICT",
        );

        expect(
          assessment
            .routingDecision
            .recommendedProvider,
        ).toBe(
          "VEO",
        );

        expect(
          assessment
            .selectedProvider,
        ).toBeNull();

        expect(
          assessment
            .eligibleProviders,
        ).toEqual([]);

        expect(
          assessment
            .optimizationApplied,
        ).toBe(
          false,
        );
      },
    );

    it(
      "does not optimize when the canonical recommended provider is disabled",
      async () => {
        const [
          episode,
          context,
        ] =
          await Promise.all([
            loadEpisodeManifest(
              "EP91",
            ),
            loadAssessmentContext(),
          ]);

        const shot =
          episode.scenes[0]
            ?.shots[0];

        if (!shot) {
          throw new Error(
            "Expected EP91 S01.",
          );
        }

        const rules =
          structuredClone(
            context.rules,
          );

        rules.generation
          .supportedProviders = [
            "RUNWAY",
            "MANUAL",
          ];

        const assessment =
          assessPreReservationProviderOptimization(
            shot,
            context.bible,
            rules,
            context.policy,
          );

        expect(
          assessment
            .assessmentDisposition,
        ).toBe(
          "NOT_APPLICABLE",
        );

        expect(
          assessment
            .routingDecision
            .disposition,
        ).toBe(
          "BLOCKED",
        );

        expect(
          assessment
            .routingDecision
            .recommendedProvider,
        ).toBe(
          "VEO",
        );

        expect(
          assessment
            .selectedProvider,
        ).toBeNull();

        expect(
          assessment
            .eligibleProviders,
        ).toEqual([]);

        expect(
          assessment
            .optimizationApplied,
        ).toBe(
          false,
        );
      },
    );

    it(
      "is deterministic and never applies an optimization in the first slice",
      async () => {
        const [
          episode,
          context,
        ] =
          await Promise.all([
            loadEpisodeManifest(
              "EP90",
            ),
            loadAssessmentContext(),
          ]);

        const shot =
          episode.scenes[0]
            ?.shots[0];

        if (!shot) {
          throw new Error(
            "Expected EP90 S01.",
          );
        }

        const first =
          assessPreReservationProviderOptimization(
            shot,
            context.bible,
            context.rules,
            context.policy,
          );

        const second =
          assessPreReservationProviderOptimization(
            shot,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(
          second,
        ).toEqual(
          first,
        );

        expect(
          first.optimizationApplied,
        ).toBe(
          false,
        );

        expect(
          second.optimizationApplied,
        ).toBe(
          false,
        );
      },
    );
  },
);
