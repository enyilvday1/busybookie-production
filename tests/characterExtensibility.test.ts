import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CharacterBibleSchema,
  CharacterIdSchema,
} from "../src/schemas/character.schema.js";

import {
  EpisodeManifestSchema,
} from "../src/schemas/episodeManifest.schema.js";

import {
  evaluateShotProvider,
} from "../src/routing/evaluateShotProvider.js";

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

import {
  validateEpisodeProduction,
} from "../src/validation/validateEpisodeProduction.js";

function createGuestBibleCandidate(
  source: Awaited<
    ReturnType<typeof loadCharacterBible>
  >,
) {
  const template =
    source.characters.find(
      (character) =>
        character.id === "OLLIE",
    );

  if (!template) {
    throw new Error(
      "Extensibility fixture requires Ollie.",
    );
  }

  return {
    ...source,
    characters: [
      ...source.characters,
      {
        ...template,
        id: "TEST_GUEST",
        name: "Test Guest",
        role:
          "synthetic character extensibility fixture",
        promptAnchor:
          "Synthetic test-only Busybookie guest character.",
        // A future character starts PENDING (CharacterBible v2 requires visualIdentity; LOCKED needs an approval).
        visualIdentity: {
          schemaVersion:
            "2.0" as const,
          status:
            "PENDING" as const,
          characterId:
            "TEST_GUEST",
          identityVersion:
            1,
          referenceBindings:
            [],
          invariantTraits:
            [],
          prohibitedVariations:
            [],
          approvedTraitDecisions:
            [],
        },
        voice: {
          selectionStatus:
            "LOCKED",
          provider:
            "RUNWAY",
          voiceName:
            "Chad",
          deliveryTraits: [
            ...template.voice
              .deliveryTraits,
          ],
        },
      },
    ],
  };
}

function createGuestDialogueEpisodeCandidate(
  source: Awaited<
    ReturnType<typeof loadEpisodeManifest>
  >,
) {
  return {
    ...source,
    scenes: source.scenes.map(
      (scene) => ({
        ...scene,
        shots: scene.shots.map(
          (shot) =>
            shot.id === "S02"
              ? {
                  ...shot,
                  characters: [
                    "TEST_GUEST",
                  ],
                  dialogue: [
                    {
                      characterId:
                        "TEST_GUEST",
                      text:
                        "Hello from Littleleaf Valley!",
                    },
                  ],
                }
              : shot,
        ),
      }),
    ),
  };
}

function createUnknownVisualCharacterEpisodeCandidate(
  source: Awaited<
    ReturnType<typeof loadEpisodeManifest>
  >,
) {
  return {
    ...source,
    scenes: source.scenes.map(
      (scene) => ({
        ...scene,
        shots: scene.shots.map(
          (shot) =>
            shot.id === "S01"
              ? {
                  ...shot,
                  characters: [
                    "TEST_GUEST",
                  ],
                }
              : shot,
        ),
      }),
    ),
  };
}

describe(
  "Busybookie character extensibility",
  () => {
    it(
      "accepts syntactically valid future character ids",
      () => {
        expect(
          CharacterIdSchema.safeParse(
            "TEST_GUEST",
          ).success,
        ).toBe(true);

        expect(
          CharacterIdSchema.safeParse(
            "JON",
          ).success,
        ).toBe(true);

        expect(
          CharacterIdSchema.safeParse(
            "GRANDMA_01",
          ).success,
        ).toBe(true);
      },
    );

    it(
      "rejects malformed character ids",
      () => {
        expect(
          CharacterIdSchema.safeParse(
            "test_guest",
          ).success,
        ).toBe(false);

        expect(
          CharacterIdSchema.safeParse(
            "Test Guest",
          ).success,
        ).toBe(false);

        expect(
          CharacterIdSchema.safeParse(
            "_TEST_GUEST",
          ).success,
        ).toBe(false);
      },
    );

    it(
      "accepts a fourth registered character in the Character Bible",
      async () => {
        const source =
          await loadCharacterBible();

        const result =
          CharacterBibleSchema.safeParse(
            createGuestBibleCandidate(
              source,
            ),
          );

        expect(result.success).toBe(
          true,
        );
      },
    );

    it(
      "preserves duplicate character id protection",
      async () => {
        const source =
          await loadCharacterBible();

        const template =
          source.characters[0];

        if (!template) {
          throw new Error(
            "Character Bible fixture is empty.",
          );
        }

        const result =
          CharacterBibleSchema.safeParse({
            ...source,
            characters: [
              ...source.characters,
              {
                ...template,
                name:
                  "Duplicate Ollie Fixture",
              },
            ],
          });

        expect(result.success).toBe(
          false,
        );
      },
    );

    it(
      "accepts a registered future character in an episode",
      async () => {
        const source =
          await loadEpisodeManifest(
            "EP02",
          );

        const result =
          EpisodeManifestSchema.safeParse(
            createGuestDialogueEpisodeCandidate(
              source,
            ),
          );

        expect(result.success).toBe(
          true,
        );
      },
    );

    it(
      "allows production validation when the future character is registered",
      async () => {
        const [
          sourceEpisode,
          sourceBible,
          rules,
        ] = await Promise.all([
          loadEpisodeManifest("EP02"),
          loadCharacterBible(),
          loadProductionRules(),
        ]);

        expect(() => {
          const episode =
            EpisodeManifestSchema.parse(
              createGuestDialogueEpisodeCandidate(
                sourceEpisode,
              ),
            );

          const bible =
            CharacterBibleSchema.parse(
              createGuestBibleCandidate(
                sourceBible,
              ),
            );

          validateEpisodeProduction(
            episode,
            bible,
            rules,
          );
        }).not.toThrow();
      },
    );

    it(
      "rejects an unknown visual character even before generation",
      async () => {
        const [
          sourceEpisode,
          bible,
          rules,
        ] = await Promise.all([
          loadEpisodeManifest("EP02"),
          loadCharacterBible(),
          loadProductionRules(),
        ]);

        expect(() => {
          const episode =
            EpisodeManifestSchema.parse(
              createUnknownVisualCharacterEpisodeCandidate(
                sourceEpisode,
              ),
            );

          validateEpisodeProduction(
            episode,
            bible,
            rules,
          );
        }).toThrow(
          /unknown character TEST_GUEST/,
        );
      },
    );

    it(
      "rejects an unknown dialogue character before generation",
      async () => {
        const [
          sourceEpisode,
          bible,
          rules,
        ] = await Promise.all([
          loadEpisodeManifest("EP02"),
          loadCharacterBible(),
          loadProductionRules(),
        ]);

        expect(() => {
          const episode =
            EpisodeManifestSchema.parse(
              createGuestDialogueEpisodeCandidate(
                sourceEpisode,
              ),
            );

          validateEpisodeProduction(
            episode,
            bible,
            rules,
          );
        }).toThrow(
          /unknown dialogue character TEST_GUEST/,
        );
      },
    );

    it(
      "routes a registered future dialogue character without character-specific code",
      async () => {
        const [
          sourceEpisode,
          sourceBible,
          rules,
          policy,
        ] = await Promise.all([
          loadEpisodeManifest("EP02"),
          loadCharacterBible(),
          loadProductionRules(),
          loadProviderRoutingPolicy(),
        ]);

        const episode =
          EpisodeManifestSchema.parse(
            createGuestDialogueEpisodeCandidate(
              sourceEpisode,
            ),
          );

        const bible =
          CharacterBibleSchema.parse(
            createGuestBibleCandidate(
              sourceBible,
            ),
          );

        const shot =
          episode.scenes
            .flatMap(
              (scene) =>
                scene.shots,
            )
            .find(
              (candidate) =>
                candidate.id === "S02",
            );

        if (!shot) {
          throw new Error(
            "EP02 S02 fixture not found.",
          );
        }

        const decision =
          evaluateShotProvider(
            shot,
            bible,
            rules,
            policy,
          );

        expect(
          decision.disposition,
        ).toBe("MANUAL_REVIEW");

        expect(
          decision.blockers,
        ).toEqual([]);
      },
    );
  },
);
