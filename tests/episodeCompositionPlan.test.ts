import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  ExecutionLifecycleReconciliationResult,
} from "../src/execution/reconcileExecutionLifecycle.js";

import {
  buildEpisodeCompositionPlan,
  type BuildEpisodeCompositionPlanDependencies,
} from "../src/composition/buildEpisodeCompositionPlan.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

function makeVerifiedShot(
  shotId: string,
  provider: "RUNWAY" | "VEO",
  outputPaths: readonly string[],
): ExecutionLifecycleReconciliationResult {
  const providerExecutionId =
    provider === "RUNWAY"
      ? `task-${shotId}`
      : `operations/${shotId}`;

  return Object.freeze({
    lifecycleState:
      "COMPLETED",

    reconciliationMode:
      "DURABLE_COMPLETION",

    provider,

    providerExecutionId,

    generationRecord:
      Object.freeze({
        outputs:
          outputPaths.map(
            (
              destinationPath,
              zeroBasedIndex,
            ) =>
              Object.freeze({
                outputIndex:
                  zeroBasedIndex + 1,

                destinationPath,

                bytes:
                  100 + zeroBasedIndex,

                sha256:
                  String(
                    zeroBasedIndex + 1,
                  ).repeat(
                    64,
                  ),

                contentType:
                  "video/mp4",
              }),
          ),
      }),

    generationRecordPath:
      `D:/Busybookie/Production/generated-video/EP02/${shotId}/${shotId}.generation.json`,

    completion:
      Object.freeze({}),

    completionPath:
      `D:/Busybookie/Production/generated-video/EP02/${shotId}/${shotId}.execution-completion.json`,
  }) as unknown as
    ExecutionLifecycleReconciliationResult;
}

describe(
  "Busybookie episode composition plan",
  () => {
    it(
      "builds deterministic composition inputs in global shot order",
      async () => {
        const sourceEpisode =
          await loadEpisodeManifest(
            "EP02",
          );

        const episode =
          structuredClone(
            sourceEpisode,
          );

        const scene =
          episode.scenes[0];

        if (!scene) {
          throw new Error(
            "Expected EP02 scene SC01.",
          );
        }

        scene.shots.reverse();

        const mediaRoot =
          "D:/Busybookie/Production";

        const verifyShot =
          vi.fn(
            async (
              input: {
                mediaRoot: string;
                episodeId: string;
                shotId: string;
              },
            ) => {
              if (
                input.shotId ===
                "S01"
              ) {
                return makeVerifiedShot(
                  "S01",
                  "RUNWAY",
                  [
                    `${mediaRoot}/generated-video/EP02/S01/S01_01.mp4`,
                  ],
                );
              }

              if (
                input.shotId ===
                "S02"
              ) {
                return makeVerifiedShot(
                  "S02",
                  "VEO",
                  [
                    `${mediaRoot}/generated-video/EP02/S02/S02_01.mp4`,
                  ],
                );
              }

              throw new Error(
                `Unexpected shot ${input.shotId}.`,
              );
            },
          );

        const dependencies:
          BuildEpisodeCompositionPlanDependencies =
          {
            verifyShot:
              verifyShot as unknown as
                BuildEpisodeCompositionPlanDependencies[
                  "verifyShot"
                ],
          };

        const plan =
          await buildEpisodeCompositionPlan(
            {
              mediaRoot,
              episode,
            },
            dependencies,
          );

        expect(
          plan.episodeId,
        ).toBe(
          "EP02",
        );

        expect(
          plan.totalShots,
        ).toBe(
          2,
        );

        expect(
          plan.totalDurationSeconds,
        ).toBe(
          sourceEpisode.scenes
            .flatMap(
              (item) =>
                item.shots,
            )
            .reduce(
              (
                total,
                shot,
              ) =>
                total +
                shot.durationSeconds,
              0,
            ),
        );

        expect(
          plan.shots.map(
            (shot) => ({
              shotId:
                shot.shotId,

              order:
                shot.order,

              provider:
                shot.provider,

              sourceVideoPath:
                shot.sourceVideoPath,
            }),
          ),
        ).toEqual([
          {
            shotId:
              "S01",

            order:
              1,

            provider:
              "RUNWAY",

            sourceVideoPath:
              `${mediaRoot}/generated-video/EP02/S01/S01_01.mp4`,
          },
          {
            shotId:
              "S02",

            order:
              2,

            provider:
              "VEO",

            sourceVideoPath:
              `${mediaRoot}/generated-video/EP02/S02/S02_01.mp4`,
          },
        ]);

        expect(
          verifyShot,
        ).toHaveBeenCalledTimes(
          2,
        );
      },
    );

    it(
      "fails closed when a verified shot contains more than one output",
      async () => {
        const episode =
          await loadEpisodeManifest(
            "EP90",
          );

        const verifyShot =
          vi.fn(
            async () =>
              makeVerifiedShot(
                "S01",
                "RUNWAY",
                [
                  "D:/Busybookie/Production/generated-video/EP90/S01/S01_01.mp4",
                  "D:/Busybookie/Production/generated-video/EP90/S01/S01_02.mp4",
                ],
              ),
          );

        const dependencies:
          BuildEpisodeCompositionPlanDependencies =
          {
            verifyShot:
              verifyShot as unknown as
                BuildEpisodeCompositionPlanDependencies[
                  "verifyShot"
                ],
          };

        await expect(
          buildEpisodeCompositionPlan(
            {
              mediaRoot:
                "D:/Busybookie/Production",

              episode,
            },
            dependencies,
          ),
        ).rejects.toThrow(
          /exactly one verified output.*S01.*received 2/i,
        );
      },
    );
  },
);
