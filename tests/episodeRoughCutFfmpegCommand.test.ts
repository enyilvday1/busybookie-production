import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildEpisodeRoughCutFfmpegCommand,
} from "../src/composition/buildEpisodeRoughCutFfmpegCommand.js";

import type {
  EpisodeRoughCutRenderPlan,
} from "../src/composition/buildEpisodeRoughCutRenderPlan.js";

function createPlan(): EpisodeRoughCutRenderPlan {
  const renderKey =
    "e".repeat(
      64,
    );

  return Object.freeze({
    schemaVersion:
      "1.0",

    profileId:
      "busybookie-episode-rough-cut-v1",

    assemblyMode:
      "STRAIGHT_CUT",

    episodeId:
      "EP02",

    title:
      "FFmpeg rough cut contract",

    totalShots:
      2,

    totalDurationSeconds:
      8,

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

    renderKey,

    outputPath:
      `D:/Busybookie/Production/exports/EP02/rough-cut/EP02_rough-cut_${renderKey}.mp4`,

    shots:
      Object.freeze([
        Object.freeze({
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
            "D:/Busybookie/Production/cache/composition-normalized/EP02/S01/EP02_S01_a.mp4",

          sourceBytes:
            2_001,

          sourceSha256:
            "c".repeat(
              64,
            ),
        }),

        Object.freeze({
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
            "D:/Busybookie/Production/cache/composition-normalized/EP02/S02/EP02_S02_b.mp4",

          sourceBytes:
            2_002,

          sourceSha256:
            "d".repeat(
              64,
            ),
        }),
      ]),
  });
}

describe(
  "Busybookie episode rough-cut FFmpeg command",
  () => {
    it(
      "builds the exact deterministic two-shot straight-cut assembly command",
      () => {
        const ffmpegExecutable =
          "C:/Tools/ffmpeg.exe";

        const outputPath =
          "D:/Busybookie/Production/exports/EP02/rough-cut/output.mp4.part-test";

        const plan =
          createPlan();

        const command =
          buildEpisodeRoughCutFfmpegCommand({
            ffmpegExecutable,

            plan,

            outputPath,
          });

        const filterComplex =
          [
            "[0:v:0]",
            "[0:a:0]",
            "[1:v:0]",
            "[1:a:0]",
            "concat=n=2:v=1:a=1",
            "[v]",
            "[a]",
          ].join(
            "",
          );

        expect(
          command,
        ).toEqual({
          executable:
            ffmpegExecutable,

          args: [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-n",

            "-i",
            plan.shots[0]!
              .sourceVideoPath,

            "-i",
            plan.shots[1]!
              .sourceVideoPath,

            "-filter_complex",
            filterComplex,

            "-map",
            "[v]",

            "-map",
            "[a]",

            "-c:v",
            "libx264",

            "-preset",
            "medium",

            "-crf",
            "18",

            "-profile:v",
            "high",

            "-pix_fmt",
            "yuv420p",

            "-r",
            "25",

            "-c:a",
            "aac",

            "-b:a",
            "192k",

            "-ar",
            "48000",

            "-ac",
            "2",

            "-t",
            "8",

            "-map_metadata",
            "-1",

            "-map_chapters",
            "-1",

            "-movflags",
            "+faststart",

            "-f",
            "mp4",

            outputPath,
          ],
        });

        expect(
          Object.isFrozen(
            command,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            command.args,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "fails closed when the rough-cut master profile is altered",
      () => {
        const plan =
          createPlan();

        const malformedPlan:
          EpisodeRoughCutRenderPlan =
            Object.freeze({
              ...plan,

              video:
                Object.freeze({
                  ...plan.video,

                  frameRate:
                    24,
                }),
            });

        expect(
          () =>
            buildEpisodeRoughCutFfmpegCommand({
              ffmpegExecutable:
                "C:/Tools/ffmpeg.exe",

              plan:
                malformedPlan,

              outputPath:
                "D:/Busybookie/Production/exports/EP02/rough-cut/output.mp4.part-test",
            }),
        ).toThrow(
          /master profile|25 fps/i,
        );
      },
    );

    it(
      "fails closed when the requested output would overwrite a normalized source",
      () => {
        const plan =
          createPlan();

        expect(
          () =>
            buildEpisodeRoughCutFfmpegCommand({
              ffmpegExecutable:
                "C:/Tools/ffmpeg.exe",

              plan,

              outputPath:
                plan.shots[0]!
                  .sourceVideoPath,
            }),
        ).toThrow(
          /output path.*source/i,
        );
      },
    );
  },
);
