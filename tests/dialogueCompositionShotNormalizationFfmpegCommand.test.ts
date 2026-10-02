import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  DialogueCompositionShotNormalizationPlan,
} from "../src/composition/buildDialogueCompositionShotNormalizationPlan.js";

import {
  buildDialogueCompositionShotNormalizationFfmpegCommand,
} from "../src/composition/buildDialogueCompositionShotNormalizationFfmpegCommand.js";

const SOURCE_VIDEO_PATH =
  "D:/Busybookie/Production/generated-video/EP02/S02/source.mp4";

const LINE_1_PATH =
  "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/line1.audio";

const LINE_2_PATH =
  "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L02/line2.audio";

const OUTPUT_PATH =
  "D:/Busybookie/Production/cache/composition-normalized/EP02/S02/output.mp4.part-test";

function createPlan():
DialogueCompositionShotNormalizationPlan {
  return Object.freeze({
    schemaVersion:
      "2.0",

    profileId:
      "busybookie-master-normalization-v2-dialogue",

    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    sourceVideoPath:
      SOURCE_VIDEO_PATH,

    sourceSha256:
      "a".repeat(
        64,
      ),

    sourceDurationSeconds:
      6,

    targetDurationSeconds:
      6,

    durationToleranceSeconds:
      1 / 24,

    durationMode:
      "MANIFEST_LOCKED",

    nativeAudio:
      true,

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
          "REPLACE_SOURCE_WITH_DIALOGUE",

        mixNativeAudio:
          false,

        sourceAudioDisposition:
          "DISCARD_NATIVE_AUDIO",

        dialoguePlanKey:
          "b".repeat(
            64,
          ),

        audioKey:
          "c".repeat(
            64,
          ),

        lines:
          Object.freeze([
            Object.freeze({
              lineNumber:
                1,

              dialogueLineId:
                "EP02_SC01_S02_L01",

              sourceAudioPath:
                LINE_1_PATH,

              sourceBytes:
                1001,

              sourceSha256:
                "1".repeat(
                  64,
                ),

              startSeconds:
                0.5,

              durationSeconds:
                1.5,

              endSeconds:
                2,
            }),

            Object.freeze({
              lineNumber:
                2,

              dialogueLineId:
                "EP02_SC01_S02_L02",

              sourceAudioPath:
                LINE_2_PATH,

              sourceBytes:
                1002,

              sourceSha256:
                "2".repeat(
                  64,
                ),

              startSeconds:
                2.5,

              durationSeconds:
                2.25,

              endSeconds:
                4.75,
            }),
          ]),

        codecName:
          "aac",

        sampleRateHz:
          48000,

        channels:
          2,

        channelLayout:
          "stereo",
      }),

    cacheKey:
      "d".repeat(
        64,
      ),

    outputPath:
      "D:/Busybookie/Production/cache/composition-normalized/EP02/S02/final.mp4",
  });
}

describe(
  "Busybookie dialogue composition normalization FFmpeg command",
  () => {
    it(
      "builds an exact dialogue-replacement graph without consuming source native audio",
      () => {
        const ffmpegExecutable =
          "C:/Tools/ffmpeg.exe";

        const plan =
          createPlan();

        const command =
          buildDialogueCompositionShotNormalizationFfmpegCommand({
            ffmpegExecutable,
            plan,
            outputPath:
              OUTPUT_PATH,
          });

        const filterComplex =
          [
            "[0:v:0]",
            "scale=w=1920:h=1080:force_original_aspect_ratio=decrease:force_divisible_by=2,",
            "pad=w=1920:h=1080:x=(ow-iw)/2:y=(oh-ih)/2,",
            "setsar=1,",
            "fps=fps=25,",
            "tpad=stop_mode=clone:stop_duration=6,",
            "trim=duration=6,",
            "setpts=PTS-STARTPTS",
            "[v];",

            "anullsrc=channel_layout=stereo:sample_rate=48000:duration=6,",
            "atrim=duration=6,",
            "asetpts=PTS-STARTPTS",
            "[base];",

            "[1:a:0]",
            "aresample=sample_rate=48000:out_chlayout=stereo,",
            "atrim=duration=1.5,",
            "asetpts=PTS-STARTPTS,",
            "adelay=24000S:all=1",
            "[d0];",

            "[2:a:0]",
            "aresample=sample_rate=48000:out_chlayout=stereo,",
            "atrim=duration=2.25,",
            "asetpts=PTS-STARTPTS,",
            "adelay=120000S:all=1",
            "[d1];",

            "[base][d0][d1]",
            "amix=inputs=3:duration=longest:dropout_transition=0:normalize=0,",
            "atrim=duration=6,",
            "asetpts=PTS-STARTPTS",
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
            SOURCE_VIDEO_PATH,

            "-i",
            LINE_1_PATH,

            "-i",
            LINE_2_PATH,

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
            "6",

            "-map_metadata",
            "-1",

            "-map_chapters",
            "-1",

            "-movflags",
            "+faststart",

            "-f",
            "mp4",

            OUTPUT_PATH,
          ],
        });

        expect(
          filterComplex,
        ).not.toContain(
          "[0:a:0]",
        );

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
      "preserves fractional-second placement directly in the audio timeline",
      () => {
        const plan =
          createPlan();

        const fractionalPlan =
          Object.freeze({
            ...plan,

            audio:
              Object.freeze({
                ...plan.audio,

                lines:
                  Object.freeze([
                    plan.audio.lines[0],

                    Object.freeze({
                      ...plan.audio.lines[1],

                      startSeconds:
                        2.375,

                      endSeconds:
                        4.625,
                    }),
                  ]),
              }),
          }) as
            DialogueCompositionShotNormalizationPlan;

        const command =
          buildDialogueCompositionShotNormalizationFfmpegCommand({
            ffmpegExecutable:
              "C:/Tools/ffmpeg.exe",

            plan:
              fractionalPlan,

            outputPath:
              OUTPUT_PATH,
          });

        const filterIndex =
          command.args.indexOf(
            "-filter_complex",
          );

        expect(
          filterIndex,
        ).toBeGreaterThan(
          -1,
        );

        expect(
          command.args[
            filterIndex +
            1
          ],
        ).toContain(
          "adelay=114000S:all=1",
        );
      },
    );

    it(
      "rejects any dialogue plan that enables native-audio mixing",
      () => {
        const plan =
          createPlan();

        const unsafePlan =
          Object.freeze({
            ...plan,

            audio:
              Object.freeze({
                ...plan.audio,

                mixNativeAudio:
                  true,
              }),
          }) as unknown as
            DialogueCompositionShotNormalizationPlan;

        expect(
          () =>
            buildDialogueCompositionShotNormalizationFfmpegCommand({
              ffmpegExecutable:
                "C:/Tools/ffmpeg.exe",

              plan:
                unsafePlan,

              outputPath:
                OUTPUT_PATH,
            }),
        ).toThrow(
          /mixNativeAudio|native.*mix|mix.*native/i,
        );
      },
    );

    it(
      "rejects an output path equal to the source video path",
      () => {
        expect(
          () =>
            buildDialogueCompositionShotNormalizationFfmpegCommand({
              ffmpegExecutable:
                "C:/Tools/ffmpeg.exe",

              plan:
                createPlan(),

              outputPath:
                SOURCE_VIDEO_PATH,
            }),
        ).toThrow(
          /output path.*differ|source video/i,
        );
      },
    );
  },
);
