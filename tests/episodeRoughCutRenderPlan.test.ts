import {
  createHash,
} from "node:crypto";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildEpisodeRoughCutRenderPlan,
} from "../src/composition/buildEpisodeRoughCutRenderPlan.js";

import type {
  PreparedEpisodeComposition,
  PreparedEpisodeCompositionShot,
} from "../src/composition/prepareEpisodeComposition.js";

import type {
  ProductionRules,
} from "../src/schemas/productionRules.schema.js";

const MEDIA_ROOT =
  "D:/Busybookie/Production";

const PROFILE_ID =
  "busybookie-episode-rough-cut-v1";

const postProduction:
  ProductionRules["postProduction"] =
    Object.freeze({
      aspectRatio:
        "16:9",

      width:
        1920,

      height:
        1080,

      timelineFps:
        25,

      audioSampleRateHz:
        48000,
    });

function makePreparedShot(
  input: Readonly<{
    shotId: "S01" | "S02";
    order: 1 | 2;
    nativeAudio: boolean;
    provider: "RUNWAY" | "VEO";
    sourceShaCharacter: string;
    normalizedShaCharacter: string;
    normalizedBytes: number;
  }>,
): PreparedEpisodeCompositionShot {
  const sourceSha256 =
    input.sourceShaCharacter.repeat(
      64,
    );

  const normalizationCacheKey =
    input.shotId ===
      "S01"
      ? "a".repeat(
          64,
        )
      : "b".repeat(
          64,
        );

  const sourceVideoPath =
    `${MEDIA_ROOT}/generated-video/EP02/${input.shotId}/${input.shotId}_01.mp4`;

  const normalizedOutputPath =
    `${MEDIA_ROOT}/cache/composition-normalized/EP02/${input.shotId}/EP02_${input.shotId}_${normalizationCacheKey}.mp4`;

  const normalizationPlan =
    Object.freeze({
      schemaVersion:
        "1.0" as const,

      profileId:
        "busybookie-master-normalization-v1" as const,

      episodeId:
        "EP02",

      shotId:
        input.shotId,

      sourceVideoPath,

      sourceSha256,

      sourceDurationSeconds:
        4,

      targetDurationSeconds:
        4,

      durationToleranceSeconds:
        1 / 24,

      durationMode:
        "MANIFEST_LOCKED" as const,

      nativeAudio:
        input.nativeAudio,

      container:
        "mp4" as const,

      video:
        Object.freeze({
          codecName:
            "h264" as const,

          width:
            1920,

          height:
            1080,

          frameRate:
            25,

          pixelFormat:
            "yuv420p" as const,

          scaleMode:
            "FIT_PAD" as const,
        }),

      audio:
        Object.freeze({
          mode:
            input.nativeAudio
              ? "PRESERVE_NATIVE" as const
              : "SYNTHETIC_SILENCE" as const,

          codecName:
            "aac" as const,

          sampleRateHz:
            48000,

          channels:
            2 as const,

          channelLayout:
            "stereo" as const,
        }),

      cacheKey:
        normalizationCacheKey,

      outputPath:
        normalizedOutputPath,
    });

  const normalizedArtifact =
    Object.freeze({
      outputPath:
        normalizedOutputPath,

      bytes:
        input.normalizedBytes,

      sha256:
        input.normalizedShaCharacter.repeat(
          64,
        ),

      contentType:
        "video/mp4" as const,

      durationSeconds:
        4,

      durationToleranceSeconds:
        1 / 25,
    });

  return Object.freeze({
    sceneId:
      "SC01",

    shotId:
      input.shotId,

    order:
      input.order,

    title:
      `Shot ${input.shotId}`,

    durationSeconds:
      4,

    nativeAudio:
      input.nativeAudio,

    provider:
      input.provider,

    providerExecutionId:
      input.provider ===
        "RUNWAY"
        ? `task-${input.shotId}`
        : `operations/${input.shotId}`,

    sourceVideoPath,

    sourceBytes:
      1_000 +
      input.order,

    sourceSha256,

    sourceContentType:
      "video/mp4",

    normalizationPlan,

    normalizationCacheStatus:
      input.shotId ===
        "S01"
        ? "HIT" as const
        : "MATERIALIZED" as const,

    normalizedArtifact,
  });
}

describe(
  "Busybookie episode rough-cut render planning",
  () => {
    it(
      "builds a deterministic straight-cut render plan from ordered trusted normalized artifacts",
      () => {
        const shot1 =
          makePreparedShot({
            shotId:
              "S01",

            order:
              1,

            nativeAudio:
              false,

            provider:
              "RUNWAY",

            sourceShaCharacter:
              "1",

            normalizedShaCharacter:
              "c",

            normalizedBytes:
              2_001,
          });

        const shot2 =
          makePreparedShot({
            shotId:
              "S02",

            order:
              2,

            nativeAudio:
              true,

            provider:
              "VEO",

            sourceShaCharacter:
              "2",

            normalizedShaCharacter:
              "d",

            normalizedBytes:
              2_002,
          });

        const preparedComposition:
          PreparedEpisodeComposition =
            Object.freeze({
              episodeId:
                "EP02",

              title:
                "Rough cut contract episode",

              totalShots:
                2,

              totalDurationSeconds:
                8,

              shots:
                Object.freeze([
                  shot1,
                  shot2,
                ]),
            });

        const expectedRenderIdentity =
          [
            PROFILE_ID,
            "EP02",
            "2",
            "8",
            "1920x1080@25",
            "48000",

            "S01",
            "1",
            "4",
            "c".repeat(
              64,
            ),

            "S02",
            "2",
            "4",
            "d".repeat(
              64,
            ),
          ].join(
            "\n",
          );

        const expectedRenderKey =
          createHash(
            "sha256",
          )
            .update(
              expectedRenderIdentity,
              "utf8",
            )
            .digest(
              "hex",
            );

        const result =
          buildEpisodeRoughCutRenderPlan({
            mediaRoot:
              MEDIA_ROOT,

            preparedComposition,

            postProduction,
          });

        expect(
          result,
        ).toEqual({
          schemaVersion:
            "1.0",

          profileId:
            PROFILE_ID,

          assemblyMode:
            "STRAIGHT_CUT",

          episodeId:
            "EP02",

          title:
            "Rough cut contract episode",

          totalShots:
            2,

          totalDurationSeconds:
            8,

          container:
            "mp4",

          video: {
            codecName:
              "h264",

            profile:
              "High",

            width:
              1920,

            height:
              1080,

            frameRate:
              25,

            pixelFormat:
              "yuv420p",
          },

          audio: {
            codecName:
              "aac",

            sampleRateHz:
              48000,

            channels:
              2,

            channelLayout:
              "stereo",
          },

          renderKey:
            expectedRenderKey,

          outputPath:
            result.outputPath,

          shots: [
            {
              sceneId:
                "SC01",

              shotId:
                "S01",

              order:
                1,

              title:
                "Shot S01",

              durationSeconds:
                4,

              sourceVideoPath:
                shot1
                  .normalizedArtifact
                  .outputPath,

              sourceBytes:
                2_001,

              sourceSha256:
                "c".repeat(
                  64,
                ),
            },

            {
              sceneId:
                "SC01",

              shotId:
                "S02",

              order:
                2,

              title:
                "Shot S02",

              durationSeconds:
                4,

              sourceVideoPath:
                shot2
                  .normalizedArtifact
                  .outputPath,

              sourceBytes:
                2_002,

              sourceSha256:
                "d".repeat(
                  64,
                ),
            },
          ],
        });

        expect(
          result.outputPath.replaceAll(
            "\\",
            "/",
          ),
        ).toBe(
          `${MEDIA_ROOT}/exports/EP02/rough-cut/EP02_rough-cut_${expectedRenderKey}.mp4`,
        );

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            result.video,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            result.audio,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            result.shots,
          ),
        ).toBe(
          true,
        );

        expect(
          result.shots.every(
            (
              shot,
            ) =>
              Object.isFrozen(
                shot,
              ),
          ),
        ).toBe(
          true,
        );
      },
    );
  },
);

function makeValidationComposition(
  shots:
    readonly PreparedEpisodeCompositionShot[],

  overrides:
    Readonly<{
      totalShots?: number;
      totalDurationSeconds?: number;
    }> =
      {},
): PreparedEpisodeComposition {
  return Object.freeze({
    episodeId:
      "EP02",

    title:
      "Rough cut validation episode",

    totalShots:
      overrides.totalShots ??
      shots.length,

    totalDurationSeconds:
      overrides.totalDurationSeconds ??
      shots.reduce(
        (
          total,
          shot,
        ) =>
          total +
          shot.durationSeconds,
        0,
      ),

    shots:
      Object.freeze([
        ...shots,
      ]),
  });
}

function buildValidationPlan(
  preparedComposition:
    PreparedEpisodeComposition,
) {
  return buildEpisodeRoughCutRenderPlan({
    mediaRoot:
      MEDIA_ROOT,

    preparedComposition,

    postProduction,
  });
}

describe(
  "Busybookie episode rough-cut render planning fail-closed invariants",
  () => {
    it(
      "rejects a prepared total-shot count that disagrees with the shot list",
      () => {
        const shot =
          makePreparedShot({
            shotId:
              "S01",

            order:
              1,

            nativeAudio:
              false,

            provider:
              "RUNWAY",

            sourceShaCharacter:
              "1",

            normalizedShaCharacter:
              "c",

            normalizedBytes:
              2_001,
          });

        const preparedComposition =
          makeValidationComposition(
            [
              shot,
            ],
            {
              totalShots:
                2,
            },
          );

        expect(
          () =>
            buildValidationPlan(
              preparedComposition,
            ),
        ).toThrow(
          "Episode rough-cut render planning total shot count does not match the prepared shot list.",
        );
      },
    );

    it(
      "rejects non-contiguous prepared shot ordering",
      () => {
        const shot =
          makePreparedShot({
            shotId:
              "S02",

            order:
              2,

            nativeAudio:
              true,

            provider:
              "VEO",

            sourceShaCharacter:
              "2",

            normalizedShaCharacter:
              "d",

            normalizedBytes:
              2_002,
          });

        const preparedComposition =
          makeValidationComposition([
            shot,
          ]);

        expect(
          () =>
            buildValidationPlan(
              preparedComposition,
            ),
        ).toThrow(
          "Episode rough-cut render planning requires continuous ordered shots. Expected order 1, found 2 for EP02/S02.",
        );
      },
    );

    it(
      "rejects a normalized artifact path that disagrees with its normalization plan",
      () => {
        const shot =
          makePreparedShot({
            shotId:
              "S01",

            order:
              1,

            nativeAudio:
              false,

            provider:
              "RUNWAY",

            sourceShaCharacter:
              "1",

            normalizedShaCharacter:
              "c",

            normalizedBytes:
              2_001,
          });

        const tamperedShot:
          PreparedEpisodeCompositionShot =
            Object.freeze({
              ...shot,

              normalizedArtifact:
                Object.freeze({
                  ...shot
                    .normalizedArtifact,

                  outputPath:
                    `${MEDIA_ROOT}/cache/composition-normalized/EP02/S01/tampered.mp4`,
                }),
            });

        const preparedComposition =
          makeValidationComposition([
            tamperedShot,
          ]);

        expect(
          () =>
            buildValidationPlan(
              preparedComposition,
            ),
        ).toThrow(
          "Episode rough-cut render planning normalized artifact path does not match the normalization plan for EP02/S01.",
        );
      },
    );

    it(
      "rejects a prepared total duration that disagrees with the ordered shot durations",
      () => {
        const shot1 =
          makePreparedShot({
            shotId:
              "S01",

            order:
              1,

            nativeAudio:
              false,

            provider:
              "RUNWAY",

            sourceShaCharacter:
              "1",

            normalizedShaCharacter:
              "c",

            normalizedBytes:
              2_001,
          });

        const shot2 =
          makePreparedShot({
            shotId:
              "S02",

            order:
              2,

            nativeAudio:
              true,

            provider:
              "VEO",

            sourceShaCharacter:
              "2",

            normalizedShaCharacter:
              "d",

            normalizedBytes:
              2_002,
          });

        const preparedComposition =
          makeValidationComposition(
            [
              shot1,
              shot2,
            ],
            {
              totalDurationSeconds:
                9,
            },
          );

        expect(
          () =>
            buildValidationPlan(
              preparedComposition,
            ),
        ).toThrow(
          "Episode rough-cut render planning total duration does not match the ordered prepared shots.",
        );
      },
    );

    it(
      "changes the render identity and output path when normalized media content changes",
      () => {
        const originalShot =
          makePreparedShot({
            shotId:
              "S01",

            order:
              1,

            nativeAudio:
              false,

            provider:
              "RUNWAY",

            sourceShaCharacter:
              "1",

            normalizedShaCharacter:
              "c",

            normalizedBytes:
              2_001,
          });

        const revisedShot =
          makePreparedShot({
            shotId:
              "S01",

            order:
              1,

            nativeAudio:
              false,

            provider:
              "RUNWAY",

            sourceShaCharacter:
              "1",

            normalizedShaCharacter:
              "e",

            normalizedBytes:
              2_101,
          });

        const originalPlan =
          buildValidationPlan(
            makeValidationComposition([
              originalShot,
            ]),
          );

        const revisedPlan =
          buildValidationPlan(
            makeValidationComposition([
              revisedShot,
            ]),
          );

        expect(
          revisedPlan.renderKey,
        ).not.toBe(
          originalPlan.renderKey,
        );

        expect(
          revisedPlan.outputPath,
        ).not.toBe(
          originalPlan.outputPath,
        );
      },
    );
  },
);
