import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  EpisodeCompositionPlan,
} from "../src/composition/buildEpisodeCompositionPlan.js";

import type {
  EpisodeRoughCutRenderPlan,
} from "../src/composition/buildEpisodeRoughCutRenderPlan.js";

import type {
  EnsuredEpisodeRoughCutRender,
} from "../src/composition/ensureEpisodeRoughCutRender.js";

import type {
  PreparedEpisodeComposition,
} from "../src/composition/prepareEpisodeComposition.js";

import type {
  ProductionRules,
} from "../src/schemas/productionRules.schema.js";

import {
  composeEpisodeRoughCut,
} from "../src/composition/composeEpisodeRoughCut.js";

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

const compositionPlan =
  Object.freeze({
    episodeId:
      "EP02",

    title:
      "Production composition",

    totalShots:
      1,

    totalDurationSeconds:
      4,

    shots:
      Object.freeze([]),
  }) as unknown as
    EpisodeCompositionPlan;

const preparedComposition =
  Object.freeze({
    episodeId:
      "EP02",

    title:
      "Production composition",

    totalShots:
      1,

    totalDurationSeconds:
      4,

    shots:
      Object.freeze([]),
  }) as
    PreparedEpisodeComposition;

const renderPlan =
  Object.freeze({
    schemaVersion:
      "1.0",

    profileId:
      "busybookie-episode-rough-cut-v1",

    assemblyMode:
      "STRAIGHT_CUT",

    episodeId:
      "EP02",

    title:
      "Production composition",

    totalShots:
      1,

    totalDurationSeconds:
      4,

    container:
      "mp4",

    video:
      Object.freeze({
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
      }),

    audio:
      Object.freeze({
        codecName:
          "aac",

        sampleRateHz:
          48000,

        channels:
          2,

        channelLayout:
          "stereo",
      }),

    renderKey:
      "e".repeat(
        64,
      ),

    outputPath:
      `D:/Busybookie/Production/exports/EP02/rough-cut/EP02_rough-cut_${"e".repeat(64)}.mp4`,

    shots:
      Object.freeze([]),
  }) as
    EpisodeRoughCutRenderPlan;

const ensuredRender:
  EnsuredEpisodeRoughCutRender =
    Object.freeze({
      renderStatus:
        "MATERIALIZED",

      artifact:
        Object.freeze({
          outputPath:
            renderPlan.outputPath,

          bytes:
            654_321,

          sha256:
            "d".repeat(
              64,
            ),

          contentType:
            "video/mp4",

          durationSeconds:
            4,

          durationToleranceSeconds:
            1 / 25,
        }),
    });

describe(
  "Busybookie episode rough-cut production composition orchestration",
  () => {
    it(
      "prepares, plans, and reconciles the episode rough cut in strict sequence",
      async () => {
        const calls:
          string[] =
            [];

        const prepareComposition =
          vi.fn(
            async (
              _input:
                unknown,
            ) => {
              calls.push(
                "prepare",
              );

              return preparedComposition;
            },
          );

        const buildRenderPlan =
          vi.fn(
            (
              _input:
                unknown,
            ) => {
              calls.push(
                "plan",
              );

              return renderPlan;
            },
          );

        const ensureRender =
          vi.fn(
            async (
              _input:
                unknown,
            ) => {
              calls.push(
                "render",
              );

              return ensuredRender;
            },
          );

        const result =
          await composeEpisodeRoughCut(
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
          calls,
        ).toEqual([
          "prepare",
          "plan",
          "render",
        ]);

        expect(
          prepareComposition,
        ).toHaveBeenCalledWith({
          compositionPlan,

          mediaRoot:
            MEDIA_ROOT,

          postProduction,

          ffmpegExecutable:
            FFMPEG_EXECUTABLE,

          ffprobeExecutable:
            FFPROBE_EXECUTABLE,
        });

        expect(
          buildRenderPlan,
        ).toHaveBeenCalledWith({
          mediaRoot:
            MEDIA_ROOT,

          preparedComposition,

          postProduction,
        });

        expect(
          ensureRender,
        ).toHaveBeenCalledWith({
          ffmpegExecutable:
            FFMPEG_EXECUTABLE,

          ffprobeExecutable:
            FFPROBE_EXECUTABLE,

          plan:
            renderPlan,
        });

        expect(
          result,
        ).toEqual({
          preparedComposition,

          renderPlan,

          renderStatus:
            "MATERIALIZED",

          artifact:
            ensuredRender.artifact,
        });

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "fails immediately when preparation fails and never plans or renders",
      async () => {
        const prepareComposition =
          vi.fn(
            async () => {
              throw new Error(
                "normalization preparation failed",
              );
            },
          );

        const buildRenderPlan =
          vi.fn();

        const ensureRender =
          vi.fn();

        await expect(
          composeEpisodeRoughCut(
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
            {
              prepareComposition:
                prepareComposition as never,

              buildRenderPlan:
                buildRenderPlan as never,

              ensureRender:
                ensureRender as never,
            },
          ),
        ).rejects.toThrow(
          /normalization preparation failed/i,
        );

        expect(
          buildRenderPlan,
        ).not.toHaveBeenCalled();

        expect(
          ensureRender,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
