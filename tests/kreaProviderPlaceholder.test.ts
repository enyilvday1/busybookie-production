import {
  describe,
  expect,
  it,
} from "vitest";

import {
  EpisodeManifestSchema,
} from "../src/schemas/episodeManifest.schema.js";

import {
  GenerationProviderSchema,
  ProductionRulesSchema,
} from "../src/schemas/productionRules.schema.js";

import {
  ProviderRoutingPolicySchema,
} from "../src/schemas/providerRoutingPolicy.schema.js";

import {
  ExecutionReservationProviderSchema,
} from "../src/execution/executionReservation.schema.js";

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
  "Busybookie Krea provider placeholder",
  () => {
    it(
      "recognizes KREA as a generation-provider identity",
      () => {
        expect(
          GenerationProviderSchema.safeParse(
            "KREA",
          ).success,
        ).toBe(true);
      },
    );

    it(
      "allows an episode manifest to declare KREA as provider identity",
      async () => {
        const source =
          await loadEpisodeManifest(
            "EP90",
          );

        const rawEpisode =
          JSON.parse(
            JSON.stringify(source),
          ) as {
            scenes: Array<{
              shots: Array<{
                generation: {
                  provider: string;
                };
              }>;
            }>;
          };

        const shot =
          rawEpisode.scenes[0]
            ?.shots[0];

        if (!shot) {
          throw new Error(
            "Expected EP90 S01.",
          );
        }

        shot.generation.provider =
          "KREA";

        expect(
          EpisodeManifestSchema.safeParse(
            rawEpisode,
          ).success,
        ).toBe(true);
      },
    );

    it(
      "does not allow KREA to be enabled as a production-supported provider",
      async () => {
        const sourceRules =
          await loadProductionRules();

        const rawRules =
          JSON.parse(
            JSON.stringify(
              sourceRules,
            ),
          ) as {
            generation: {
              supportedProviders:
                string[];
            };
          };

        rawRules.generation
          .supportedProviders
          .push(
            "KREA",
          );

        expect(
          ProductionRulesSchema.safeParse(
            rawRules,
          ).success,
        ).toBe(false);
      },
    );

    it(
      "does not allow KREA into the paid execution reservation boundary",
      () => {
        expect(
          ExecutionReservationProviderSchema
            .safeParse(
              "KREA",
            )
            .success,
        ).toBe(false);
      },
    );

    it(
      "does not allow automatic routing policy to select KREA",
      async () => {
        const sourcePolicy =
          await loadProviderRoutingPolicy();

        const rawPolicy =
          JSON.parse(
            JSON.stringify(
              sourcePolicy,
            ),
          ) as {
            nonDialogue: {
              nativeAudioProvider:
                string;
              visualOnlyProvider:
                string;
            };
          };

        rawPolicy.nonDialogue
          .visualOnlyProvider =
          "KREA";

        expect(
          ProviderRoutingPolicySchema
            .safeParse(
              rawPolicy,
            )
            .success,
        ).toBe(false);
      },
    );

    it(
      "keeps KREA absent from the authoritative production provider list",
      async () => {
        const rules =
          await loadProductionRules();

        expect(
          rules.generation
            .supportedProviders,
        ).not.toContain(
          "KREA",
        );
      },
    );
  },
);
