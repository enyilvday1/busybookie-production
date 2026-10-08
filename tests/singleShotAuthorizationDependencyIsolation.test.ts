import {
  mkdtemp,
  rm,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createProductionSingleShotExecutionDependencies,
  type ProductionSingleShotExecutionCompositionDependencies,
} from "../src/execution/createProductionSingleShotExecutionDependencies.js";

import {
  executeSingleShot,
} from "../src/execution/executeSingleShot.js";

import type {
  SingleShotExecutionDependencies,
} from "../src/execution/singleShotExecution.types.js";

import type {
  EpisodeManifest,
  Shot,
} from "../src/schemas/episodeManifest.schema.js";

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

const temporaryDirectories:
  string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(
        (directory) =>
          rm(
            directory,
            {
              recursive: true,
              force: true,
            },
          ),
      ),
  );
});

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-auth-dependency-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

async function loadExecutionContext() {
  const [
    bible,
    rules,
    policy,
  ] = await Promise.all([
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

function requireShot(
  episode:
    EpisodeManifest,
  shotId:
    string,
): Shot {
  for (
    const scene
    of episode.scenes
  ) {
    const shot =
      scene.shots.find(
        (candidate) =>
          candidate.id ===
          shotId,
      );

    if (shot) {
      return shot;
    }
  }

  throw new Error(
    `Expected shot ${shotId}.`,
  );
}

function lockOllieVoice(
  bible:
    Awaited<
      ReturnType<
        typeof loadCharacterBible
      >
    >,
): void {
  const ollie =
    bible.characters.find(
      (character) =>
        character.id ===
        "OLLIE",
    );

  if (!ollie) {
    throw new Error(
      "Expected OLLIE in character bible.",
    );
  }

  ollie.voice = {
    selectionStatus:
      "LOCKED",

    provider:
      "RUNWAY",

    voiceName:
      "Chad",

    deliveryTraits: [
      ...ollie.voice
        .deliveryTraits,
    ],
  };
}

function makeNonExecutingDependencies():
SingleShotExecutionDependencies {
  return {
    createReservation:
      vi.fn(
        async () => {
          throw new Error(
            "Reservation must not run.",
          );
        },
      ),

    createSubmission:
      vi.fn(
        async () => {
          throw new Error(
            "Submission must not run.",
          );
        },
      ),

    createCompletion:
      vi.fn(
        async () => {
          throw new Error(
            "Completion must not run.",
          );
        },
      ),

    executeRunway:
      vi.fn(
        async () => {
          throw new Error(
            "Runway must not run.",
          );
        },
      ),

    executeVeo:
      vi.fn(
        async () => {
          throw new Error(
            "Veo must not run.",
          );
        },
      ),
  } satisfies
    SingleShotExecutionDependencies;
}

describe(
  "Busybookie single-shot dialogue-visual authorization dependency isolation",
  () => {
    it(
      "fails closed instead of falling back to the real filesystem when the authorization reader dependency is missing",
      async () => {
        const [
          sourceEpisode,
          context,
          mediaRoot,
        ] = await Promise.all([
          loadEpisodeManifest(
            "EP02",
          ),
          loadExecutionContext(),
          makeTempDirectory(),
        ]);

        const episode =
          structuredClone(
            sourceEpisode,
          );

        const bible =
          structuredClone(
            context.bible,
          );

        lockOllieVoice(
          bible,
        );

        const dependencies =
          makeNonExecutingDependencies();

        await expect(
          executeSingleShot(
            {
              episode,
              shotId:
                "S02",
              bible,
              rules:
                context.rules,
              policy:
                context.policy,
              mediaRoot,
              sourceImagePath:
                join(
                  mediaRoot,
                  "references",
                  "ollie.png",
                ),
              confirmPaidGeneration:
                true,
            },
            dependencies,
          ),
        ).rejects.toThrow(
          /readDialogueVisualAuthorization.*required/i,
        );

        expect(
          dependencies
            .createReservation,
        ).not.toHaveBeenCalled();

        expect(
          dependencies
            .executeRunway,
        ).not.toHaveBeenCalled();

        expect(
          dependencies
            .executeVeo,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "passes the configured authorization reader through the production dependency factory",
      () => {
        const readAuthorization =
          vi.fn(
            async () =>
              null,
          );

        const composition = {
          readDialogueVisualAuthorization:
            readAuthorization,

          createReservation:
            vi.fn(
              async () => {
                throw new Error(
                  "Reservation must not run.",
                );
              },
            ),

          createSubmission:
            vi.fn(
              async () => {
                throw new Error(
                  "Submission must not run.",
                );
              },
            ),

          createCompletion:
            vi.fn(
              async () => {
                throw new Error(
                  "Completion must not run.",
                );
              },
            ),

          prepareRunwayExecutor:
            vi.fn(
              async () => {
                throw new Error(
                  "Runway executor preparation must not run.",
                );
              },
            ),

          prepareVeoExecutor:
            vi.fn(
              async () => {
                throw new Error(
                  "Veo executor preparation must not run.",
                );
              },
            ),
        } satisfies
          ProductionSingleShotExecutionCompositionDependencies;

        const dependencies =
          createProductionSingleShotExecutionDependencies(
            {},
            composition,
          );

        expect(
          dependencies
            .readDialogueVisualAuthorization,
        ).toBe(
          readAuthorization,
        );

        expect(
          composition
            .prepareRunwayExecutor,
        ).not.toHaveBeenCalled();

        expect(
          composition
            .prepareVeoExecutor,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "does not consult dialogue-visual authorization for ordinary ROUTABLE non-dialogue execution",
      async () => {
        const [
          sourceEpisode,
          sourceContext,
          mediaRoot,
        ] = await Promise.all([
          loadEpisodeManifest(
            "EP90",
          ),
          loadExecutionContext(),
          makeTempDirectory(),
        ]);

        const episode =
          structuredClone(
            sourceEpisode,
          );

        const rules =
          structuredClone(
            sourceContext.rules,
          );

        const policy =
          structuredClone(
            sourceContext.policy,
          );

        const shot =
          requireShot(
            episode,
            "S01",
          );

        expect(
          shot.dialogue,
        ).toHaveLength(
          0,
        );

        expect(
          shot.generation.provider,
        ).toBe(
          "RUNWAY",
        );

        const readAuthorization =
          vi.fn(
            async () => {
              throw new Error(
                "Authorization reader must not run for ordinary MANUAL provider review.",
              );
            },
          );

        const dependencies = {
          ...makeNonExecutingDependencies(),

          readDialogueVisualAuthorization:
            readAuthorization,
        } satisfies
          SingleShotExecutionDependencies;

        await expect(
          executeSingleShot(
            {
              episode,
              shotId:
                "S01",
              bible:
                sourceContext.bible,
              rules,
              policy,
              mediaRoot,
              sourceImagePath:
                join(
                  mediaRoot,
                  "references",
                  "reference.png",
                ),
              confirmPaidGeneration:
                false,
            },
            dependencies,
          ),
        ).rejects.toThrow(
          /paid-generation confirmation is required/i,
        );

        expect(
          readAuthorization,
        ).not.toHaveBeenCalled();

        expect(
          dependencies
            .createReservation,
        ).not.toHaveBeenCalled();

        expect(
          dependencies
            .executeRunway,
        ).not.toHaveBeenCalled();

        expect(
          dependencies
            .executeVeo,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
