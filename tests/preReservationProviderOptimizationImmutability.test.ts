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

describe(
  "Busybookie pre-reservation provider optimization immutability",
  () => {
    it(
      "returns an immutable E10-owned routing-decision snapshot",
      async () => {
        const [
          episode,
          bible,
          rules,
          policy,
        ] =
          await Promise.all([
            loadEpisodeManifest(
              "EP90",
            ),
            loadCharacterBible(),
            loadProductionRules(),
            loadProviderRoutingPolicy(),
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
            bible,
            rules,
            policy,
          );

        expect(
          assessment
            .selectedProvider,
        ).toBe(
          "RUNWAY",
        );

        expect(
          assessment
            .optimizationApplied,
        ).toBe(
          false,
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

        expect(
          Object.isFrozen(
            assessment
              .routingDecision,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            assessment
              .routingDecision
              .reasons,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            assessment
              .routingDecision
              .blockers,
          ),
        ).toBe(
          true,
        );

        expect(
          Reflect.set(
            assessment
              .routingDecision,
            "recommendedProvider",
            "VEO",
          ),
        ).toBe(
          false,
        );

        expect(
          Reflect.set(
            assessment
              .routingDecision
              .reasons,
            0,
            "tampered",
          ),
        ).toBe(
          false,
        );

        expect(
          Reflect.set(
            assessment
              .routingDecision
              .blockers,
            0,
            "tampered",
          ),
        ).toBe(
          false,
        );

        expect(
          assessment
            .routingDecision
            .recommendedProvider,
        ).toBe(
          "RUNWAY",
        );

        expect(
          assessment
            .selectedProvider,
        ).toBe(
          "RUNWAY",
        );
      },
    );
  },
);
