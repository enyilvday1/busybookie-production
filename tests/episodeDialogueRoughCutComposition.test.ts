import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  composeEpisodeRoughCut,
} from "../src/composition/composeEpisodeRoughCut.js";

import type {
  EpisodeCompositionPlan,
} from "../src/composition/buildEpisodeCompositionPlan.js";

import type {
  CharacterBible,
} from "../src/schemas/character.schema.js";

import type {
  EpisodeManifest,
} from "../src/schemas/episodeManifest.schema.js";

import type {
  ProductionRules,
} from "../src/schemas/productionRules.schema.js";

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

const compositionPlan:
  EpisodeCompositionPlan =
    Object.freeze({
      episodeId:
        "EP02",

      title:
        "Dialogue composition forwarding",

      totalShots:
        1,

      totalDurationSeconds:
        4,

      shots:
        Object.freeze([]),
    });

// Opaque canonical inputs: composition only forwards them to preparation.
const episode =
  Object.freeze({
    episodeId:
      "EP02",
  }) as unknown as EpisodeManifest;

const bible =
  Object.freeze({
    characters:
      [],
  }) as unknown as CharacterBible;

describe(
  "Busybookie dialogue-aware rough-cut composition orchestration",
  () => {
    it(
      "forwards canonical episode and bible into preparation and forwards no caller-supplied dialogue audio plans",
      async () => {
        let capturedPrepareInput:
          unknown =
            null;

        const prepareComposition =
          vi.fn(
            async (
              input:
                unknown,
            ) => {
              capturedPrepareInput =
                input;

              throw new Error(
                "stop-after-prepare",
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
          ),
        ).rejects.toThrow(
          "stop-after-prepare",
        );

        expect(
          capturedPrepareInput,
        ).toStrictEqual({
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
        });

        expect(
          capturedPrepareInput,
        ).not.toHaveProperty(
          "dialogueAudioPlans",
        );

        expect(
          (
            capturedPrepareInput as {
              episode: unknown;
              bible: unknown;
            }
          ).episode,
        ).toBe(
          episode,
        );

        expect(
          (
            capturedPrepareInput as {
              episode: unknown;
              bible: unknown;
            }
          ).bible,
        ).toBe(
          bible,
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
