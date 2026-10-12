import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  buildDialogueCompositionShotNormalizationPlan,
} from "../src/composition/buildDialogueCompositionShotNormalizationPlan.js";

import {
  buildEpisodeRoughCutRenderPlan,
} from "../src/composition/buildEpisodeRoughCutRenderPlan.js";

import type {
  EpisodeCompositionPlan,
  EpisodeCompositionPlanShot,
} from "../src/composition/buildEpisodeCompositionPlan.js";

import {
  composeEpisodeRoughCut,
} from "../src/composition/composeEpisodeRoughCut.js";

import {
  prepareEpisodeComposition,
} from "../src/composition/prepareEpisodeComposition.js";

import type {
  CompositionSourceMediaMetadata,
} from "../src/composition/probeCompositionSourceMedia.js";

import type {
  DialogueCompositionAudioPlan,
} from "../src/dialogue/buildDialogueCompositionAudioPlan.js";

import {
  buildShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import type {
  ProductionRules,
} from "../src/schemas/productionRules.schema.js";

import {
  loadCharacterBible,
} from "../src/validation/loadCharacterBible.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

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

const shot:
  EpisodeCompositionPlanShot =
    Object.freeze({
      sceneId:
        "SC01",

      shotId:
        "S02",

      order:
        1,

      title:
        "Dialogue integration shot",

      durationSeconds:
        4,

      nativeAudio:
        true,

      provider:
        "VEO",

      providerExecutionId:
        "operations/dialogue-integration",

      sourceVideoPath:
        `${MEDIA_ROOT}/generated-video/EP02/S02/S02_01.mp4`,

      sourceBytes:
        10_001,

      sourceSha256:
        "3".repeat(
          64,
        ),

      sourceContentType:
        "video/mp4",
    });

const compositionPlan:
  EpisodeCompositionPlan =
    Object.freeze({
      episodeId:
        "EP02",

      title:
        "Dialogue top-level integration",

      totalShots:
        1,

      totalDurationSeconds:
        4,

      shots:
        Object.freeze([
          shot,
        ]),
    });

const dialogueAudio:
  DialogueCompositionAudioPlan =
    Object.freeze({
      schemaVersion:
        "1.0",

      audioMode:
        "REPLACE_SOURCE_WITH_DIALOGUE",

      mixNativeAudio:
        false,

      episodeId:
        "EP02",

      sceneId:
        "SC01",

      shotId:
        "S02",

      dialoguePlanKey:
        "b".repeat(
          64,
        ),

      shotDurationSeconds:
        4,

      sourceNativeAudio:
        true,

      sourceAudioDisposition:
        "DISCARD_NATIVE_AUDIO",

      lines:
        Object.freeze([
          Object.freeze({
            lineNumber:
              1,

            dialogueLineId:
              "EP02_SC01_S02_L01",

            sourceAudioPath:
              `${MEDIA_ROOT}/voices/EP02/S02/EP02_SC01_S02_L01/line.audio`,

            sourceBytes:
              12_345,

            sourceSha256:
              "c".repeat(
                64,
              ),

            startSeconds:
              0.5,

            durationSeconds:
              1.5,

            endSeconds:
              2,
          }),
        ]),

      audioKey:
        "d".repeat(
          64,
        ),
    });

const sourceMedia:
  CompositionSourceMediaMetadata =
    Object.freeze({
      sourceVideoPath:
        shot.sourceVideoPath,

      formatName:
        "mov,mp4,m4a,3gp,3g2,mj2",

      durationSeconds:
        4,

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
        Object.freeze({
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
        }),
    });

describe(
  "Busybookie top-level dialogue rough-cut integration",
  () => {
    it(
      "routes trusted dialogue evidence through real preparation and real rough-cut planning before the controlled render boundary",
      async () => {
        const events:
          string[] =
            [];

        const probeSource =
          vi.fn(
            async () => {
              events.push(
                "probe:S02",
              );

              return sourceMedia;
            },
          );

        const buildNormalizationPlan =
          vi.fn(
            () => {
              throw new Error(
                "Unexpected v1 normalization planning.",
              );
            },
          );

        const ensureNormalizationCache =
          vi.fn(
            async () => {
              throw new Error(
                "Unexpected v1 normalization cache.",
              );
            },
          );

        const buildDialogueNormalizationPlan =
          vi.fn(
            (
              input:
                Parameters<
                  typeof buildDialogueCompositionShotNormalizationPlan
                >[0],
            ) => {
              events.push(
                `plan-v2:${input.shot.shotId}`,
              );

              return buildDialogueCompositionShotNormalizationPlan(
                input,
              );
            },
          );

        const ensureDialogueNormalizationCache =
          vi.fn(
            async (
              input:
                Readonly<{
                  plan:
                    ReturnType<
                      typeof buildDialogueCompositionShotNormalizationPlan
                    >;
                }>,
            ) => {
              events.push(
                `ensure-v2:${input.plan.shotId}`,
              );

              return Object.freeze({
                cacheStatus:
                  "MATERIALIZED" as const,

                artifact:
                  Object.freeze({
                    outputPath:
                      input.plan.outputPath,

                    bytes:
                      22_002,

                    sha256:
                      "1".repeat(
                        64,
                      ),

                    contentType:
                      "video/mp4" as const,

                    durationSeconds:
                      4,

                    durationToleranceSeconds:
                      1 / 25,
                  }),
              });
            },
          );

        const buildDialoguePlan =
          vi.fn(
            buildShotDialoguePlan,
          );

        const resolveDialogueAudioPlan =
          vi.fn(
            async () => {
              events.push(
                "resolve:S02",
              );

              return dialogueAudio;
            },
          );

        const prepareComposition =
          vi.fn(
            async (
              input:
                Parameters<
                  typeof prepareEpisodeComposition
                >[0],
            ) => {
              events.push(
                "prepare",
              );

              return prepareEpisodeComposition(
                input,
                {
                  probeSource:
                    probeSource as never,

                  buildNormalizationPlan:
                    buildNormalizationPlan as never,

                  ensureNormalizationCache:
                    ensureNormalizationCache as never,

                  buildDialoguePlan:
                    buildDialoguePlan as never,

                  resolveDialogueAudioPlan:
                    resolveDialogueAudioPlan as never,

                  buildDialogueNormalizationPlan:
                    buildDialogueNormalizationPlan as never,

                  ensureDialogueNormalizationCache:
                    ensureDialogueNormalizationCache as never,
                },
              );
            },
          );

        const buildRenderPlan =
          vi.fn(
            (
              input:
                Parameters<
                  typeof buildEpisodeRoughCutRenderPlan
                >[0],
            ) => {
              events.push(
                "plan-rough-cut",
              );

              return buildEpisodeRoughCutRenderPlan(
                input,
              );
            },
          );

        const ensureRender =
          vi.fn(
            async (
              input:
                Readonly<{
                  plan:
                    ReturnType<
                      typeof buildEpisodeRoughCutRenderPlan
                    >;
                }>,
            ) => {
              events.push(
                "render-boundary",
              );

              return Object.freeze({
                renderStatus:
                  "MATERIALIZED" as const,

                artifact:
                  Object.freeze({
                    outputPath:
                      input.plan.outputPath,

                    bytes:
                      33_003,

                    sha256:
                      "9".repeat(
                        64,
                      ),

                    contentType:
                      "video/mp4" as const,

                    durationSeconds:
                      4,

                    durationToleranceSeconds:
                      1 / 25,
                  }),
              });
            },
          );

        const [
          episode,
          bible,
        ] =
          await Promise.all([
            loadEpisodeManifest(
              "EP02",
            ),

            loadCharacterBible(),
          ]);

        const result =
          await composeEpisodeRoughCut(
            {
              compositionPlan,

              episode,

              bible,

              mediaRoot:
                MEDIA_ROOT,

              postProduction,

              ffmpegExecutable:
                FFMPEG_EXECUTABLE,

              ffprobeExecutable:
                FFPROBE_EXECUTABLE,
            },
            {
              prepareComposition:
                prepareComposition as never,

              buildRenderPlan:
                buildRenderPlan as never,

              ensureRender:
                ensureRender as never,
            },
          );

        expect(
          events,
        ).toEqual([
          "prepare",
          "resolve:S02",
          "probe:S02",
          "plan-v2:S02",
          "ensure-v2:S02",
          "plan-rough-cut",
          "render-boundary",
        ]);

        expect(
          buildNormalizationPlan,
        ).not.toHaveBeenCalled();

        expect(
          ensureNormalizationCache,
        ).not.toHaveBeenCalled();

        expect(
          buildDialogueNormalizationPlan,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          ensureDialogueNormalizationCache,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result.preparedComposition
            .shots,
        ).toHaveLength(
          1,
        );

        const preparedShot =
          result.preparedComposition
            .shots[0];

        if (!preparedShot) {
          throw new Error(
            "Expected one prepared dialogue shot.",
          );
        }

        expect(
          preparedShot.normalizationPlan
            .schemaVersion,
        ).toBe(
          "2.0",
        );

        expect(
          preparedShot.normalizationPlan
            .profileId,
        ).toBe(
          "busybookie-master-normalization-v2-dialogue",
        );

        expect(
          preparedShot.normalizationCacheStatus,
        ).toBe(
          "MATERIALIZED",
        );

        expect(
          preparedShot.normalizedArtifact
            .sha256,
        ).toBe(
          "1".repeat(
            64,
          ),
        );

        expect(
          result.renderPlan.shots,
        ).toHaveLength(
          1,
        );

        const roughCutShot =
          result.renderPlan.shots[0];

        if (!roughCutShot) {
          throw new Error(
            "Expected one rough-cut shot.",
          );
        }

        expect(
          roughCutShot.sourceVideoPath,
        ).toBe(
          preparedShot.normalizedArtifact
            .outputPath,
        );

        expect(
          roughCutShot.sourceBytes,
        ).toBe(
          preparedShot.normalizedArtifact
            .bytes,
        );

        expect(
          roughCutShot.sourceSha256,
        ).toBe(
          preparedShot.normalizedArtifact
            .sha256,
        );

        expect(
          result.renderStatus,
        ).toBe(
          "MATERIALIZED",
        );

        expect(
          result.artifact.outputPath,
        ).toBe(
          result.renderPlan.outputPath,
        );

        expect(
          ensureRender,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);
