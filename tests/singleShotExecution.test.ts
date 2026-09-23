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
  createExecutionReservation,
  type CreateExecutionReservationResult,
} from "../src/execution/createExecutionReservation.js";

import type {
  ExecutionReservationInput,
} from "../src/execution/executionReservation.schema.js";

import {
  readExecutionReservation,
} from "../src/execution/readExecutionReservation.js";

import {
  executeSingleShot,
} from "../src/execution/executeSingleShot.js";

import type {
  SingleShotExecutionDependencies,
  SingleShotProviderExecutionInput,
  SingleShotProviderExecutionResult,
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
        "busybookie-single-shot-",
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

type ExecutionContext =
  Awaited<
    ReturnType<
      typeof loadExecutionContext
    >
  >;

function requireShot(
  episode: EpisodeManifest,
  shotId: string,
): Shot {
  for (const scene of episode.scenes) {
    const shot =
      scene.shots.find(
        (candidate) =>
          candidate.id === shotId,
      );

    if (shot) {
      return shot;
    }
  }

  throw new Error(
    `Expected shot ${shotId}.`,
  );
}

function makeRequest(
  episode: EpisodeManifest,
  shotId: string,
  context: ExecutionContext,
  confirmPaidGeneration = true,
  mediaRoot =
    "D:/Busybookie/Production",
) {
  return {
    episode,
    shotId,
    bible: context.bible,
    rules: context.rules,
    policy: context.policy,
    mediaRoot,
    sourceImagePath:
      join(
        mediaRoot,
        "references",
        "test-reference.png",
      ),
    confirmPaidGeneration,
  };
}

function makeDependencies(
  events: string[] = [],
) {
  const createReservation =
    vi.fn(
      async (
        mediaRoot: string,
        input:
          ExecutionReservationInput,
      ): Promise<
        CreateExecutionReservationResult
      > => {
        events.push(
          "reservation",
        );

        return {
          record: {
            schemaVersion: "1.0",
            reservationId:
              "11111111-1111-4111-8111-111111111111",
            reservedAt:
              "2026-09-23T21:00:00.000Z",
            status: "RESERVED",
            episodeId:
              input.episodeId,
            shotId:
              input.shotId,
            provider:
              input.provider,
          },

          reservationPath:
            join(
              mediaRoot,
              "generated-video",
              input.episodeId,
              input.shotId,
              `${input.episodeId}_${input.shotId}.execution-reservation.json`,
            ),
        };
      },
    );

  const executeRunway =
    vi.fn(
      async (
        input:
          SingleShotProviderExecutionInput,
      ): Promise<
        SingleShotProviderExecutionResult
      > => {
        events.push(
          "runway",
        );

        return {
          providerExecutionId:
            "mock-runway-task-1",
          recordPath:
            join(
              input.mediaRoot,
              "mock-runway-record.json",
            ),
        };
      },
    );

  const executeVeo =
    vi.fn(
      async (
        input:
          SingleShotProviderExecutionInput,
      ): Promise<
        SingleShotProviderExecutionResult
      > => {
        events.push(
          "veo",
        );

        return {
          providerExecutionId:
            "operations/mock-veo-1",
          recordPath:
            join(
              input.mediaRoot,
              "mock-veo-record.json",
            ),
        };
      },
    );

  const dependencies = {
    createReservation,
    executeRunway,
    executeVeo,
  } satisfies
    SingleShotExecutionDependencies;

  return {
    dependencies,
    createReservation,
    executeRunway,
    executeVeo,
  };
}

describe(
  "Busybookie single-shot execution orchestration",
  () => {
    it(
      "reserves before dispatching exactly one ready Runway shot",
      async () => {
        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest(
            "EP90",
          ),
          loadExecutionContext(),
        ]);

        const events:
          string[] = [];

        const mocks =
          makeDependencies(
            events,
          );

        const result =
          await executeSingleShot(
            makeRequest(
              episode,
              "S01",
              context,
            ),
            mocks.dependencies,
          );

        expect(events).toEqual([
          "reservation",
          "runway",
        ]);

        expect(
          mocks.createReservation,
        ).toHaveBeenCalledWith(
          "D:/Busybookie/Production",
          {
            episodeId: "EP90",
            shotId: "S01",
            provider: "RUNWAY",
          },
        );

        expect(
          mocks.executeRunway,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks.executeVeo,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeRunway,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            shot:
              expect.objectContaining({
                id: "S01",
              }),

            reservation:
              expect.objectContaining({
                record:
                  expect.objectContaining({
                    provider:
                      "RUNWAY",
                  }),
              }),
          }),
        );

        expect(result.provider).toBe(
          "RUNWAY",
        );

        expect(
          result.providerExecution
            .providerExecutionId,
        ).toBe(
          "mock-runway-task-1",
        );
      },
    );

    it(
      "reserves before dispatching exactly one ready Veo shot",
      async () => {
        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest(
            "EP91",
          ),
          loadExecutionContext(),
        ]);

        const events:
          string[] = [];

        const mocks =
          makeDependencies(
            events,
          );

        const result =
          await executeSingleShot(
            makeRequest(
              episode,
              "S01",
              context,
            ),
            mocks.dependencies,
          );

        expect(events).toEqual([
          "reservation",
          "veo",
        ]);

        expect(
          mocks.createReservation,
        ).toHaveBeenCalledWith(
          "D:/Busybookie/Production",
          {
            episodeId: "EP91",
            shotId: "S01",
            provider: "VEO",
          },
        );

        expect(
          mocks.executeVeo,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks.executeRunway,
        ).not.toHaveBeenCalled();

        expect(result.provider).toBe(
          "VEO",
        );

        expect(
          result.providerExecution
            .providerExecutionId,
        ).toBe(
          "operations/mock-veo-1",
        );
      },
    );

    it(
      "does not reserve or dispatch without explicit paid-generation confirmation",
      async () => {
        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest(
            "EP90",
          ),
          loadExecutionContext(),
        ]);

        const mocks =
          makeDependencies();

        await expect(
          executeSingleShot(
            makeRequest(
              episode,
              "S01",
              context,
              false,
            ),
            mocks.dependencies,
          ),
        ).rejects.toThrow(
          /paid.*confirmation/i,
        );

        expect(
          mocks.createReservation,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeRunway,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeVeo,
        ).not.toHaveBeenCalled();
      },
    );
    it(
      "blocks NOT_READY before reservation or provider dispatch",
      async () => {
        const [
          sourceEpisode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest(
            "EP90",
          ),
          loadExecutionContext(),
        ]);

        const episode =
          structuredClone(
            sourceEpisode,
          );

        episode.status =
          "DRAFT";

        const mocks =
          makeDependencies();

        await expect(
          executeSingleShot(
            makeRequest(
              episode,
              "S01",
              context,
            ),
            mocks.dependencies,
          ),
        ).rejects.toThrow(
          /NOT_READY/,
        );

        expect(
          mocks.createReservation,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeRunway,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeVeo,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "blocks MANUAL_REVIEW before reservation or provider dispatch",
      async () => {
        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest(
            "EP02",
          ),
          loadExecutionContext(),
        ]);

        const mocks =
          makeDependencies();

        await expect(
          executeSingleShot(
            makeRequest(
              episode,
              "S02",
              context,
            ),
            mocks.dependencies,
          ),
        ).rejects.toThrow(
          /MANUAL_REVIEW/,
        );

        expect(
          mocks.createReservation,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeRunway,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeVeo,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "blocks routing CONFLICT before reservation or provider dispatch",
      async () => {
        const [
          sourceEpisode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest(
            "EP90",
          ),
          loadExecutionContext(),
        ]);

        const episode =
          structuredClone(
            sourceEpisode,
          );

        requireShot(
          episode,
          "S01",
        ).generation.provider =
          "VEO";

        const mocks =
          makeDependencies();

        await expect(
          executeSingleShot(
            makeRequest(
              episode,
              "S01",
              context,
            ),
            mocks.dependencies,
          ),
        ).rejects.toThrow(
          /CONFLICT/,
        );

        expect(
          mocks.createReservation,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeRunway,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeVeo,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "blocks routing BLOCKED before reservation or provider dispatch",
      async () => {
        const [
          episode,
          sourceContext,
        ] = await Promise.all([
          loadEpisodeManifest(
            "EP90",
          ),
          loadExecutionContext(),
        ]);

        const context =
          structuredClone(
            sourceContext,
          );

        context.rules
          .generation
          .supportedProviders = [
            "VEO",
            "MANUAL",
          ];

        const mocks =
          makeDependencies();

        await expect(
          executeSingleShot(
            makeRequest(
              episode,
              "S01",
              context,
            ),
            mocks.dependencies,
          ),
        ).rejects.toThrow(
          /BLOCKED/,
        );

        expect(
          mocks.createReservation,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeRunway,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeVeo,
        ).not.toHaveBeenCalled();
      },
    );
    it(
      "does not dispatch when durable reservation creation fails",
      async () => {
        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest(
            "EP90",
          ),
          loadExecutionContext(),
        ]);

        const mocks =
          makeDependencies();

        mocks.createReservation
          .mockRejectedValueOnce(
            new Error(
              "Execution reservation already exists.",
            ),
          );

        await expect(
          executeSingleShot(
            makeRequest(
              episode,
              "S01",
              context,
            ),
            mocks.dependencies,
          ),
        ).rejects.toThrow(
          /reservation already exists/i,
        );

        expect(
          mocks.executeRunway,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeVeo,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "does not automatically retry a failed provider execution",
      async () => {
        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest(
            "EP90",
          ),
          loadExecutionContext(),
        ]);

        const mocks =
          makeDependencies();

        mocks.executeRunway
          .mockRejectedValueOnce(
            new Error(
              "Mock provider failure.",
            ),
          );

        await expect(
          executeSingleShot(
            makeRequest(
              episode,
              "S01",
              context,
            ),
            mocks.dependencies,
          ),
        ).rejects.toThrow(
          /mock provider failure/i,
        );

        expect(
          mocks.createReservation,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks.executeRunway,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks.executeVeo,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "keeps the durable reservation after provider execution fails",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest(
            "EP90",
          ),
          loadExecutionContext(),
        ]);

        const executeRunway =
          vi.fn(
            async (
              _input:
                SingleShotProviderExecutionInput,
            ): Promise<
              SingleShotProviderExecutionResult
            > => {
              throw new Error(
                "Mock provider failure.",
              );
            },
          );

        const executeVeo =
          vi.fn(
            async (
              _input:
                SingleShotProviderExecutionInput,
            ): Promise<
              SingleShotProviderExecutionResult
            > => ({
              providerExecutionId:
                "unused",
              recordPath:
                "unused",
            }),
          );

        const dependencies = {
          createReservation:
            (
              root:
                string,
              input:
                ExecutionReservationInput,
            ) =>
              createExecutionReservation(
                root,
                input,
              ),

          executeRunway,
          executeVeo,
        } satisfies
          SingleShotExecutionDependencies;

        await expect(
          executeSingleShot(
            makeRequest(
              episode,
              "S01",
              context,
              true,
              mediaRoot,
            ),
            dependencies,
          ),
        ).rejects.toThrow(
          /mock provider failure/i,
        );

        const reservation =
          await readExecutionReservation(
            mediaRoot,
            "EP90",
            "S01",
          );

        expect(reservation).not.toBeNull();

        expect(
          reservation?.provider,
        ).toBe(
          "RUNWAY",
        );

        expect(
          executeRunway,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
    it(
      "rejects an unknown explicit shot before reservation",
      async () => {
        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest(
            "EP90",
          ),
          loadExecutionContext(),
        ]);

        const mocks =
          makeDependencies();

        await expect(
          executeSingleShot(
            makeRequest(
              episode,
              "S99",
              context,
            ),
            mocks.dependencies,
          ),
        ).rejects.toThrow(
          /shot S99.*not found/i,
        );

        expect(
          mocks.createReservation,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeRunway,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeVeo,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "executes only the explicitly selected shot when multiple shots are executable",
      async () => {
        const [
          sourceEpisode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest(
            "EP90",
          ),
          loadExecutionContext(),
        ]);

        const episode =
          structuredClone(
            sourceEpisode,
          );

        const scene =
          episode.scenes[0];

        const sourceShot =
          scene?.shots[0];

        if (
          !scene ||
          !sourceShot
        ) {
          throw new Error(
            "Expected EP90 S01.",
          );
        }

        const secondShot =
          structuredClone(
            sourceShot,
          );

        secondShot.id =
          "S02";

        secondShot.order =
          2;

        secondShot.title =
          "Second executable shot";

        scene.shots.push(
          secondShot,
        );

        const mocks =
          makeDependencies();

        await executeSingleShot(
          makeRequest(
            episode,
            "S02",
            context,
          ),
          mocks.dependencies,
        );

        expect(
          mocks.createReservation,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks.createReservation,
        ).toHaveBeenCalledWith(
          "D:/Busybookie/Production",
          {
            episodeId: "EP90",
            shotId: "S02",
            provider: "RUNWAY",
          },
        );

        expect(
          mocks.executeRunway,
        ).toHaveBeenCalledTimes(
          1,
        );

        const providerInput =
          mocks.executeRunway
            .mock.calls[0]?.[0];

        expect(
          providerInput?.shot.id,
        ).toBe(
          "S02",
        );
      },
    );
  },
);
