import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  EpisodeCompositionPlan,
  EpisodeCompositionPlanShot,
} from "../src/composition/buildEpisodeCompositionPlan.js";

import type {
  BuildCompositionShotNormalizationPlanInput,
  CompositionShotNormalizationPlan,
} from "../src/composition/buildCompositionShotNormalizationPlan.js";

import type {
  CompositionSourceMediaMetadata,
  CompositionSourceMediaProbeInput,
} from "../src/composition/probeCompositionSourceMedia.js";

import type {
  MaterializeCompositionShotNormalizationInput,
  MaterializedCompositionShotNormalization,
} from "../src/composition/materializeCompositionShotNormalization.js";

import type {
  ProductionRules,
} from "../src/schemas/productionRules.schema.js";

import {
  prepareEpisodeComposition,
  type PrepareEpisodeCompositionDependencies,
} from "../src/composition/prepareEpisodeComposition.js";

const MEDIA_ROOT =
  "D:/Busybookie/Production";

const FFMPEG_EXECUTABLE =
  "D:/Tools/ffmpeg/bin/ffmpeg.exe";

const FFPROBE_EXECUTABLE =
  "D:/Tools/ffmpeg/bin/ffprobe.exe";

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

function makeCompositionShot(
  input: Readonly<{
    shotId: string;
    order: number;
    nativeAudio: boolean;
    provider: "RUNWAY" | "VEO";
    shaCharacter: string;
  }>,
): EpisodeCompositionPlanShot {
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

    sourceVideoPath:
      `${MEDIA_ROOT}/generated-video/EP02/${input.shotId}/${input.shotId}_01.mp4`,

    sourceBytes:
      1_000 +
      input.order,

    sourceSha256:
      input.shaCharacter.repeat(
        64,
      ),

    sourceContentType:
      "video/mp4",
  });
}

function makeSourceMedia(
  shot:
    EpisodeCompositionPlanShot,
): CompositionSourceMediaMetadata {
  return Object.freeze({
    sourceVideoPath:
      shot.sourceVideoPath,

    formatName:
      "mov,mp4,m4a,3gp,3g2,mj2",

    durationSeconds:
      shot.durationSeconds,

    video:
      Object.freeze({
        codecName:
          "h264",

        profile:
          "High",

        width:
          1280,

        height:
          720,

        pixelFormat:
          "yuv420p",

        frameRate:
          24,
      }),

    audio:
      shot.nativeAudio
        ? Object.freeze({
            codecName:
              "aac",

            profile:
              "LC",

            sampleRateHz:
              48000,

            channels:
              2,

            channelLayout:
              "stereo",
          })
        : null,
  });
}

function makeNormalizationPlan(
  shot:
    EpisodeCompositionPlanShot,
): CompositionShotNormalizationPlan {
  const cacheKey =
    shot.shotId ===
      "S01"
      ? "a".repeat(
          64,
        )
      : "b".repeat(
          64,
        );

  return Object.freeze({
    schemaVersion:
      "1.0",

    profileId:
      "busybookie-master-normalization-v1",

    episodeId:
      "EP02",

    shotId:
      shot.shotId,

    sourceVideoPath:
      shot.sourceVideoPath,

    sourceSha256:
      shot.sourceSha256,

    sourceDurationSeconds:
      4,

    targetDurationSeconds:
      4,

    durationToleranceSeconds:
      1 / 24,

    durationMode:
      "MANIFEST_LOCKED",

    nativeAudio:
      shot.nativeAudio,

    container:
      "mp4",

    video:
      Object.freeze({
        codecName:
          "h264",

        width:
          1920,

        height:
          1080,

        frameRate:
          25,

        pixelFormat:
          "yuv420p",

        scaleMode:
          "FIT_PAD",
      }),

    audio:
      Object.freeze({
        mode:
          shot.nativeAudio
            ? "PRESERVE_NATIVE"
            : "SYNTHETIC_SILENCE",

        codecName:
          "aac",

        sampleRateHz:
          48000,

        channels:
          2,

        channelLayout:
          "stereo",
      }),

    cacheKey,

    outputPath:
      `${MEDIA_ROOT}/cache/composition-normalized/EP02/${shot.shotId}/EP02_${shot.shotId}_${cacheKey}.mp4`,
  });
}

function makeNormalizedArtifact(
  plan:
    CompositionShotNormalizationPlan,
): MaterializedCompositionShotNormalization {
  return Object.freeze({
    outputPath:
      plan.outputPath,

    bytes:
      plan.shotId ===
        "S01"
        ? 2_001
        : 2_002,

    sha256:
      plan.shotId ===
        "S01"
        ? "c".repeat(
            64,
          )
        : "d".repeat(
            64,
          ),

    contentType:
      "video/mp4",

    durationSeconds:
      plan.targetDurationSeconds,

    durationToleranceSeconds:
      1 /
      plan.video.frameRate,
  });
}

describe(
  "Busybookie episode composition preparation",
  () => {
    it(
      "prepares every admitted shot in deterministic episode order using trusted normalized cache artifacts",
      async () => {
        const shot1 =
          makeCompositionShot({
            shotId:
              "S01",
            order:
              1,
            nativeAudio:
              false,
            provider:
              "RUNWAY",
            shaCharacter:
              "1",
          });

        const shot2 =
          makeCompositionShot({
            shotId:
              "S02",
            order:
              2,
            nativeAudio:
              true,
            provider:
              "VEO",
            shaCharacter:
              "2",
          });

        const compositionPlan:
          EpisodeCompositionPlan =
            Object.freeze({
              episodeId:
                "EP02",

              title:
                "Preparation contract episode",

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

        const events:
          string[] =
            [];

        const probeSource =
          vi.fn(
            async (
              input:
                CompositionSourceMediaProbeInput,
            ): Promise<
              CompositionSourceMediaMetadata
            > => {
              const shot =
                compositionPlan
                  .shots
                  .find(
                    (
                      candidate,
                    ) =>
                      candidate
                        .sourceVideoPath ===
                      input
                        .sourceVideoPath,
                  );

              if (!shot) {
                throw new Error(
                  `Unexpected source path ${input.sourceVideoPath}.`,
                );
              }

              events.push(
                `probe:${shot.shotId}`,
              );

              return makeSourceMedia(
                shot,
              );
            },
          );

        const buildNormalizationPlan =
          vi.fn(
            (
              input:
                BuildCompositionShotNormalizationPlanInput,
            ): CompositionShotNormalizationPlan => {
              events.push(
                `plan:${input.shot.shotId}`,
              );

              return makeNormalizationPlan(
                input.shot,
              );
            },
          );

        const ensureNormalizationCache =
          vi.fn(
            async (
              input:
                MaterializeCompositionShotNormalizationInput,
            ) => {
              events.push(
                `ensure:${input.plan.shotId}`,
              );

              return Object.freeze({
                cacheStatus:
                  input.plan.shotId ===
                    "S01"
                    ? "HIT" as const
                    : "MATERIALIZED" as const,

                artifact:
                  makeNormalizedArtifact(
                    input.plan,
                  ),
              });
            },
          );

        const dependencies:
          PrepareEpisodeCompositionDependencies =
            {
              probeSource:
                probeSource as unknown as
                  PrepareEpisodeCompositionDependencies[
                    "probeSource"
                  ],

              buildNormalizationPlan:
                buildNormalizationPlan as unknown as
                  PrepareEpisodeCompositionDependencies[
                    "buildNormalizationPlan"
                  ],

              ensureNormalizationCache:
                ensureNormalizationCache as unknown as
                  PrepareEpisodeCompositionDependencies[
                    "ensureNormalizationCache"
                  ],
            };

        const result =
          await prepareEpisodeComposition(
            {
              compositionPlan,

              mediaRoot:
                MEDIA_ROOT,

              postProduction,

              ffmpegExecutable:
                FFMPEG_EXECUTABLE,

              ffprobeExecutable:
                FFPROBE_EXECUTABLE,
            },
            dependencies,
          );

        expect(
          events,
        ).toEqual([
          "probe:S01",
          "plan:S01",
          "ensure:S01",
          "probe:S02",
          "plan:S02",
          "ensure:S02",
        ]);

        expect(
          probeSource,
        ).toHaveBeenNthCalledWith(
          1,
          {
            ffprobeExecutable:
              FFPROBE_EXECUTABLE,

            sourceVideoPath:
              shot1.sourceVideoPath,

            nativeAudio:
              false,
          },
        );

        expect(
          probeSource,
        ).toHaveBeenNthCalledWith(
          2,
          {
            ffprobeExecutable:
              FFPROBE_EXECUTABLE,

            sourceVideoPath:
              shot2.sourceVideoPath,

            nativeAudio:
              true,
          },
        );

        expect(
          buildNormalizationPlan,
        ).toHaveBeenNthCalledWith(
          1,
          {
            mediaRoot:
              MEDIA_ROOT,

            episodeId:
              "EP02",

            shot:
              shot1,

            sourceMedia:
              makeSourceMedia(
                shot1,
              ),

            postProduction,
          },
        );

        expect(
          ensureNormalizationCache,
        ).toHaveBeenCalledTimes(
          2,
        );

        const normalizationPlan1 =
          makeNormalizationPlan(
            shot1,
          );

        const normalizationPlan2 =
          makeNormalizationPlan(
            shot2,
          );

        expect(
          ensureNormalizationCache,
        ).toHaveBeenNthCalledWith(
          1,
          {
            ffmpegExecutable:
              FFMPEG_EXECUTABLE,

            ffprobeExecutable:
              FFPROBE_EXECUTABLE,

            plan:
              normalizationPlan1,
          },
        );

        expect(
          ensureNormalizationCache,
        ).toHaveBeenNthCalledWith(
          2,
          {
            ffmpegExecutable:
              FFMPEG_EXECUTABLE,

            ffprobeExecutable:
              FFPROBE_EXECUTABLE,

            plan:
              normalizationPlan2,
          },
        );

        expect(
          result,
        ).toEqual({
          episodeId:
            "EP02",

          title:
            "Preparation contract episode",

          totalShots:
            2,

          totalDurationSeconds:
            8,

          shots: [
            {
              ...shot1,

              normalizationPlan:
                normalizationPlan1,

              normalizationCacheStatus:
                "HIT",

              normalizedArtifact:
                makeNormalizedArtifact(
                  normalizationPlan1,
                ),
            },
            {
              ...shot2,

              normalizationPlan:
                normalizationPlan2,

              normalizationCacheStatus:
                "MATERIALIZED",

              normalizedArtifact:
                makeNormalizedArtifact(
                  normalizationPlan2,
                ),
            },
          ],
        });

        expect(
          Object.isFrozen(
            result,
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
