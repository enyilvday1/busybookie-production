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
  DialogueCompositionAudioPlan,
} from "../src/dialogue/buildDialogueCompositionAudioPlan.js";

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
        "S01",

      dialoguePlanKey:
        "a".repeat(
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
              "EP02_SC01_S01_L01",

            sourceAudioPath:
              `${MEDIA_ROOT}/voices/EP02/S01/EP02_SC01_S01_L01/line.audio`,

            sourceBytes:
              12_345,

            sourceSha256:
              "b".repeat(
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
        "c".repeat(
          64,
        ),
    });

describe(
  "Busybookie dialogue-aware rough-cut composition orchestration",
  () => {
    it(
      "forwards trusted dialogue audio plans unchanged into episode composition preparation",
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

              dialogueAudioPlans:
                Object.freeze([
                  dialogueAudio,
                ]),

              mediaRoot:
                MEDIA_ROOT,

              postProduction,

              ffmpegExecutable:
                FFMPEG_EXECUTABLE,

              ffprobeExecutable:
                FFPROBE_EXECUTABLE,
            } as unknown as
              Parameters<
                typeof composeEpisodeRoughCut
              >[0],
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
        ).toEqual({
          compositionPlan,

          dialogueAudioPlans:
            Object.freeze([
              dialogueAudio,
            ]),

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
        ).not.toHaveBeenCalled();

        expect(
          ensureRender,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
