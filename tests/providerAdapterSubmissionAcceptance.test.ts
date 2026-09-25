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
  SingleShotProviderExecutionInput,
  SingleShotSubmissionAcceptedHandler,
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

async function makeProviderInput(
  episodeId:
    "EP90" | "EP91",

  onSubmissionAccepted:
    SingleShotSubmissionAcceptedHandler,
): Promise<
  SingleShotProviderExecutionInput
> {
  const [
    episode,
    bible,
    rules,
    routingPolicy,
  ] =
    await Promise.all([
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
      routingPolicy,
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
      `Expected ${episodeId}/S01 to be executable.`,
    );
  }

  const mediaRoot =
    resolve(
      process.cwd(),
      ".adapter-acceptance-test-media",
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

    reservation: {
      record: {
        schemaVersion:
          "1.0",

        reservationId:
          "11111111-1111-4111-8111-111111111111",

        reservedAt:
          "2026-09-24T20:45:00.000Z",

        status:
          "RESERVED",

        episodeId:
          episode.episodeId,

        shotId:
          shot.id,

        provider:
          readiness.executionProvider,
      },

      reservationPath:
        resolve(
          mediaRoot,
          "generated-video",
          episode.episodeId,
          shot.id,
          `${episode.episodeId}_${shot.id}.execution-reservation.json`,
        ),
    },

    onSubmissionAccepted,
  };
}

describe(
  "Busybookie provider adapter submission acceptance",
  () => {
    it(
      "forwards the Runway submission-acceptance handler to the transaction runner",
      async () => {
        const events:
          string[] = [];

        const onSubmissionAccepted =
          vi.fn<
            SingleShotSubmissionAcceptedHandler
          >(
            async (
              acceptance,
            ) => {
              events.push(
                `accepted:${acceptance.providerExecutionId}`,
              );
            },
          );

        const [
          input,
          policy,
        ] =
          await Promise.all([
            makeProviderInput(
              "EP90",
              onSubmissionAccepted,
            ),

            loadRunwayPolicy(),
          ]);

        const runTransaction =
          vi.fn(
            async (
              _transactionInput,
              acceptanceHandler,
            ) => {
              events.push(
                "transaction-start",
              );

              await acceptanceHandler({
                provider:
                  "RUNWAY",

                providerExecutionId:
                  "runway-task-accept-1",

                providerEstimatedCredits:
                  1,
              });

              events.push(
                "transaction-after-acceptance",
              );

              return {
                record: {
                  taskId:
                    "runway-task-accept-1",
                },

                recordPath:
                  resolve(
                    input.mediaRoot,
                    "generated-video",
                    "EP90",
                    "S01",
                    "EP90_S01_runway-task-accept-1.runway-generation.json",
                  ),
              };
            },
          );

        const dependencies = {
          policy,

          buildPrompt:
            () =>
              "Mock Runway prompt.",

          runTransaction,
        } satisfies
          RunwaySingleShotAdapterDependencies;

        const result =
          await executeRunwaySingleShot(
            input,
            dependencies,
          );

        expect(
          events,
        ).toEqual([
          "transaction-start",
          "accepted:runway-task-accept-1",
          "transaction-after-acceptance",
        ]);

        expect(
          onSubmissionAccepted,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          onSubmissionAccepted,
        ).toHaveBeenCalledWith({
          provider:
            "RUNWAY",

          providerExecutionId:
            "runway-task-accept-1",

          providerEstimatedCredits:
            1,
        });

        expect(
          runTransaction
            .mock
            .calls[0]?.[1],
        ).toBe(
          input.onSubmissionAccepted,
        );

        expect(
          result.providerExecutionId,
        ).toBe(
          "runway-task-accept-1",
        );
      },
    );

    it(
      "forwards the Veo submission-acceptance handler to the transaction runner",
      async () => {
        const events:
          string[] = [];

        const onSubmissionAccepted =
          vi.fn<
            SingleShotSubmissionAcceptedHandler
          >(
            async (
              acceptance,
            ) => {
              events.push(
                `accepted:${acceptance.providerExecutionId}`,
              );
            },
          );

        const [
          input,
          policy,
        ] =
          await Promise.all([
            makeProviderInput(
              "EP91",
              onSubmissionAccepted,
            ),

            loadVeoPolicy(),
          ]);

        const runTransaction =
          vi.fn(
            async (
              _transactionInput,
              acceptanceHandler,
            ) => {
              events.push(
                "transaction-start",
              );

              await acceptanceHandler({
                provider:
                  "VEO",

                providerExecutionId:
                  "operations/veo-accept-1",
              });

              events.push(
                "transaction-after-acceptance",
              );

              return {
                record: {
                  operationName:
                    "operations/veo-accept-1",
                },

                recordPath:
                  resolve(
                    input.mediaRoot,
                    "generated-video",
                    "EP91",
                    "S01",
                    "EP91_S01_veo-accept-1.veo-generation.json",
                  ),
              };
            },
          );

        const dependencies = {
          policy,

          buildPrompt:
            () =>
              "Mock Veo prompt.",

          runTransaction,
        } satisfies
          VeoSingleShotAdapterDependencies;

        const result =
          await executeVeoSingleShot(
            input,
            dependencies,
          );

        expect(
          events,
        ).toEqual([
          "transaction-start",
          "accepted:operations/veo-accept-1",
          "transaction-after-acceptance",
        ]);

        expect(
          onSubmissionAccepted,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          onSubmissionAccepted,
        ).toHaveBeenCalledWith({
          provider:
            "VEO",

          providerExecutionId:
            "operations/veo-accept-1",
        });

        expect(
          runTransaction
            .mock
            .calls[0]?.[1],
        ).toBe(
          input.onSubmissionAccepted,
        );

        expect(
          result.providerExecutionId,
        ).toBe(
          "operations/veo-accept-1",
        );
      },
    );
  },
);
