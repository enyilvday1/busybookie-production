import {
  resolve,
} from "node:path";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  evaluateShotExecutionReadiness,
} from "../src/planning/evaluateShotExecutionReadiness.js";

import type {
  EpisodeManifest,
  Shot,
} from "../src/schemas/episodeManifest.schema.js";

import {
  executeRunwaySingleShot,
  type RunwaySingleShotAdapterDependencies,
} from "../src/execution/providers/executeRunwaySingleShot.js";

import {
  executeVeoSingleShot,
  type VeoSingleShotAdapterDependencies,
} from "../src/execution/providers/executeVeoSingleShot.js";

import type {
  CreateExecutionReservationResult,
} from "../src/execution/createExecutionReservation.js";

import type {
  SingleShotProviderExecutionInput,
} from "../src/execution/singleShotExecution.types.js";

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
  loadRunwayPolicy,
} from "../src/validation/loadRunwayPolicy.js";

import {
  loadVeoPolicy,
} from "../src/validation/loadVeoPolicy.js";

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
    `Expected ${shotId} in ${episode.episodeId}.`,
  );
}

function makeReservation(
  mediaRoot: string,
  episodeId: string,
  shotId: string,
  provider: "RUNWAY" | "VEO",
): CreateExecutionReservationResult {
  return {
    record: {
      schemaVersion: "1.0",
      reservationId:
        "11111111-1111-4111-8111-111111111111",
      reservedAt:
        "2026-09-23T22:00:00.000Z",
      status: "RESERVED",
      episodeId,
      shotId,
      provider,
    },

    reservationPath:
      resolve(
        mediaRoot,
        "generated-video",
        episodeId,
        shotId,
        `${episodeId}_${shotId}.execution-reservation.json`,
      ),
  };
}

async function makeProviderInput(
  episodeId: "EP90" | "EP91",
): Promise<SingleShotProviderExecutionInput> {
  const [
    episode,
    bible,
    rules,
    policy,
  ] = await Promise.all([
    loadEpisodeManifest(
      episodeId,
    ),
    loadCharacterBible(),
    loadProductionRules(),
    loadProviderRoutingPolicy(),
  ]);

  const shot =
    requireShot(
      episode,
      "S01",
    );

  const readiness =
    evaluateShotExecutionReadiness(
      episode,
      shot,
      bible,
      rules,
      policy,
    );

  if (
    readiness.disposition !==
    "EXECUTABLE" ||
    (
      readiness.executionProvider !==
        "RUNWAY" &&
      readiness.executionProvider !==
        "VEO"
    )
  ) {
    throw new Error(
      `Expected ${episodeId} S01 to be executable.`,
    );
  }

  const mediaRoot =
    resolve(
      process.cwd(),
      ".adapter-test-media",
    );

  return {
    episode,
    shot,
    readiness,
    mediaRoot,

    sourceImagePath:
      resolve(
        mediaRoot,
        "references",
        "approved-reference.png",
      ),

    reservation:
      makeReservation(
        mediaRoot,
        episode.episodeId,
        shot.id,
        readiness.executionProvider,
      ),

    onSubmissionAccepted:
      vi.fn(
        async () =>
          undefined,
      ),
  };
}

describe(
  "Busybookie provider execution adapters",
  () => {
    it(
      "maps a Runway shot into the existing Runway transaction contract",
      async () => {
        const [
          input,
          policy,
        ] = await Promise.all([
          makeProviderInput(
            "EP90",
          ),
          loadRunwayPolicy(),
        ]);

        const buildPrompt =
          vi.fn(
            () =>
              "Mock Runway prompt.",
          );

        const runTransaction =
          vi.fn(
            async (
              _transactionInput:
                Parameters<
                  RunwaySingleShotAdapterDependencies[
                    "runTransaction"
                  ]
                >[0],

              _onSubmissionAccepted:
                Parameters<
                  RunwaySingleShotAdapterDependencies[
                    "runTransaction"
                  ]
                >[1],
            ) => ({
              record: {
                taskId:
                  "runway-task-123",
              },

              recordPath:
                resolve(
                  input.mediaRoot,
                  "runway-record.json",
                ),
            }),
          );

        const dependencies = {
          policy,
          buildPrompt,
          runTransaction,
        } satisfies
          RunwaySingleShotAdapterDependencies;

        const result =
          await executeRunwaySingleShot(
            input,
            dependencies,
          );

        expect(
          buildPrompt,
        ).toHaveBeenCalledWith(
          input.shot,
        );

        expect(
          runTransaction,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          runTransaction
            .mock.calls[0]?.[0],
        ).toEqual({
          episodeId:
            "EP90",

          shotId:
            "S01",

          sourceImagePath:
            input.sourceImagePath,

          promptText:
            "Mock Runway prompt.",

          durationSeconds:
            input.shot
              .durationSeconds,

          mediaRoot:
            input.mediaRoot,

          policy,
        });

        expect(result).toEqual({
          providerExecutionId:
            "runway-task-123",

          recordPath:
            resolve(
              input.mediaRoot,
              "runway-record.json",
            ),
        });
      },
    );
    it(
      "maps a Veo shot into the existing Veo transaction contract",
      async () => {
        const [
          input,
          policy,
        ] = await Promise.all([
          makeProviderInput(
            "EP91",
          ),
          loadVeoPolicy(),
        ]);

        const buildPrompt =
          vi.fn(
            () =>
              "Mock Veo prompt.",
          );

        const runTransaction =
          vi.fn(
            async (
              _transactionInput:
                Parameters<
                  VeoSingleShotAdapterDependencies[
                    "runTransaction"
                  ]
                >[0],

              _onSubmissionAccepted:
                Parameters<
                  VeoSingleShotAdapterDependencies[
                    "runTransaction"
                  ]
                >[1],
            ) => ({
              record: {
                operationName:
                  "operations/veo-123",
              },

              recordPath:
                resolve(
                  input.mediaRoot,
                  "veo-record.json",
                ),
            }),
          );

        const dependencies = {
          policy,
          buildPrompt,
          runTransaction,
        } satisfies
          VeoSingleShotAdapterDependencies;

        const result =
          await executeVeoSingleShot(
            input,
            dependencies,
          );

        expect(
          buildPrompt,
        ).toHaveBeenCalledWith(
          input.shot,
        );

        expect(
          runTransaction,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          runTransaction
            .mock.calls[0]?.[0],
        ).toEqual({
          episodeId:
            "EP91",

          shotId:
            "S01",

          sourceImagePath:
            input.sourceImagePath,

          promptText:
            "Mock Veo prompt.",

          durationSeconds:
            input.shot
              .durationSeconds,

          mediaRoot:
            input.mediaRoot,

          policy,
        });

        expect(result).toEqual({
          providerExecutionId:
            "operations/veo-123",

          recordPath:
            resolve(
              input.mediaRoot,
              "veo-record.json",
            ),
        });
      },
    );
    it(
      "blocks Runway when readiness is not EXECUTABLE",
      async () => {
        const [
          input,
          policy,
        ] = await Promise.all([
          makeProviderInput(
            "EP90",
          ),
          loadRunwayPolicy(),
        ]);

        const runTransaction =
          vi.fn();

        await expect(
          executeRunwaySingleShot(
            {
              ...input,

              readiness: {
                ...input.readiness,
                disposition:
                  "NOT_READY",
              },
            },
            {
              policy,

              buildPrompt:
                () => "unused",

              runTransaction,
            },
          ),
        ).rejects.toThrow(
          /EXECUTABLE/i,
        );

        expect(
          runTransaction,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "blocks Veo when readiness is not EXECUTABLE",
      async () => {
        const [
          input,
          policy,
        ] = await Promise.all([
          makeProviderInput(
            "EP91",
          ),
          loadVeoPolicy(),
        ]);

        const runTransaction =
          vi.fn();

        await expect(
          executeVeoSingleShot(
            {
              ...input,

              readiness: {
                ...input.readiness,
                disposition:
                  "NOT_READY",
              },
            },
            {
              policy,

              buildPrompt:
                () => "unused",

              runTransaction,
            },
          ),
        ).rejects.toThrow(
          /EXECUTABLE/i,
        );

        expect(
          runTransaction,
        ).not.toHaveBeenCalled();
      },
    );
    it(
      "blocks Runway when readiness resolves to another provider",
      async () => {
        const [
          input,
          policy,
        ] = await Promise.all([
          makeProviderInput(
            "EP90",
          ),
          loadRunwayPolicy(),
        ]);

        const runTransaction =
          vi.fn();

        await expect(
          executeRunwaySingleShot(
            {
              ...input,

              readiness: {
                ...input.readiness,
                executionProvider:
                  "VEO",
              },
            },
            {
              policy,

              buildPrompt:
                () => "unused",

              runTransaction,
            },
          ),
        ).rejects.toThrow(
          /RUNWAY/i,
        );

        expect(
          runTransaction,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "blocks Veo when readiness resolves to another provider",
      async () => {
        const [
          input,
          policy,
        ] = await Promise.all([
          makeProviderInput(
            "EP91",
          ),
          loadVeoPolicy(),
        ]);

        const runTransaction =
          vi.fn();

        await expect(
          executeVeoSingleShot(
            {
              ...input,

              readiness: {
                ...input.readiness,
                executionProvider:
                  "RUNWAY",
              },
            },
            {
              policy,

              buildPrompt:
                () => "unused",

              runTransaction,
            },
          ),
        ).rejects.toThrow(
          /VEO/i,
        );

        expect(
          runTransaction,
        ).not.toHaveBeenCalled();
      },
    );
    it(
      "blocks Runway when the reservation does not belong to Runway",
      async () => {
        const [
          input,
          policy,
        ] = await Promise.all([
          makeProviderInput(
            "EP90",
          ),
          loadRunwayPolicy(),
        ]);

        const runTransaction =
          vi.fn();

        await expect(
          executeRunwaySingleShot(
            {
              ...input,

              reservation:
                makeReservation(
                  input.mediaRoot,
                  "EP90",
                  "S01",
                  "VEO",
                ),
            },
            {
              policy,

              buildPrompt:
                () => "unused",

              runTransaction,
            },
          ),
        ).rejects.toThrow(
          /reservation.*RUNWAY/i,
        );

        expect(
          runTransaction,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "blocks Veo when the reservation belongs to another shot",
      async () => {
        const [
          input,
          policy,
        ] = await Promise.all([
          makeProviderInput(
            "EP91",
          ),
          loadVeoPolicy(),
        ]);

        const runTransaction =
          vi.fn();

        await expect(
          executeVeoSingleShot(
            {
              ...input,

              reservation:
                makeReservation(
                  input.mediaRoot,
                  "EP91",
                  "S02",
                  "VEO",
                ),
            },
            {
              policy,

              buildPrompt:
                () => "unused",

              runTransaction,
            },
          ),
        ).rejects.toThrow(
          /reservation.*S01/i,
        );

        expect(
          runTransaction,
        ).not.toHaveBeenCalled();
      },
    );
    it(
      "blocks Runway reference images outside the Busybookie reference root",
      async () => {
        const [
          input,
          policy,
        ] = await Promise.all([
          makeProviderInput(
            "EP90",
          ),
          loadRunwayPolicy(),
        ]);

        const buildPrompt =
          vi.fn(
            () => "unused",
          );

        const runTransaction =
          vi.fn();

        await expect(
          executeRunwaySingleShot(
            {
              ...input,

              sourceImagePath:
                resolve(
                  input.mediaRoot,
                  "..",
                  "outside.png",
                ),
            },
            {
              policy,
              buildPrompt,
              runTransaction,
            },
          ),
        ).rejects.toThrow(
          /reference.*inside/i,
        );

        expect(
          buildPrompt,
        ).not.toHaveBeenCalled();

        expect(
          runTransaction,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "blocks Veo reference images outside the Busybookie reference root",
      async () => {
        const [
          input,
          policy,
        ] = await Promise.all([
          makeProviderInput(
            "EP91",
          ),
          loadVeoPolicy(),
        ]);

        const buildPrompt =
          vi.fn(
            () => "unused",
          );

        const runTransaction =
          vi.fn();

        await expect(
          executeVeoSingleShot(
            {
              ...input,

              sourceImagePath:
                resolve(
                  input.mediaRoot,
                  "..",
                  "outside.png",
                ),
            },
            {
              policy,
              buildPrompt,
              runTransaction,
            },
          ),
        ).rejects.toThrow(
          /reference.*inside/i,
        );

        expect(
          buildPrompt,
        ).not.toHaveBeenCalled();

        expect(
          runTransaction,
        ).not.toHaveBeenCalled();
      },
    );
    it(
      "propagates a Runway transaction failure without retrying",
      async () => {
        const [
          input,
          policy,
        ] = await Promise.all([
          makeProviderInput(
            "EP90",
          ),
          loadRunwayPolicy(),
        ]);

        const runTransaction =
          vi.fn(
            async () => {
              throw new Error(
                "Mock Runway transaction failure.",
              );
            },
          );

        await expect(
          executeRunwaySingleShot(
            input,
            {
              policy,

              buildPrompt:
                () =>
                  "Mock prompt.",

              runTransaction,
            },
          ),
        ).rejects.toThrow(
          /Mock Runway transaction failure/,
        );

        expect(
          runTransaction,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "propagates a Veo transaction failure without retrying",
      async () => {
        const [
          input,
          policy,
        ] = await Promise.all([
          makeProviderInput(
            "EP91",
          ),
          loadVeoPolicy(),
        ]);

        const runTransaction =
          vi.fn(
            async () => {
              throw new Error(
                "Mock Veo transaction failure.",
              );
            },
          );

        await expect(
          executeVeoSingleShot(
            input,
            {
              policy,

              buildPrompt:
                () =>
                  "Mock prompt.",

              runTransaction,
            },
          ),
        ).rejects.toThrow(
          /Mock Veo transaction failure/,
        );

        expect(
          runTransaction,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);
