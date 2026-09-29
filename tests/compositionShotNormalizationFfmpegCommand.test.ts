import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildCompositionShotNormalizationFfmpegCommand,
} from "../src/composition/buildCompositionShotNormalizationFfmpegCommand.js";

import type {
  CompositionShotNormalizationPlan,
} from "../src/composition/buildCompositionShotNormalizationPlan.js";

function createPlan(
  input:
    Readonly<{
      episodeId:
        "EP90" | "EP91";

      durationSeconds:
        4 | 5;

      nativeAudio:
        boolean;

      audioMode:
        "PRESERVE_NATIVE" |
        "SYNTHETIC_SILENCE";

      sourceVideoPath:
        string;

      sourceSha256:
        string;
    }>,
): CompositionShotNormalizationPlan {
  return Object.freeze({
    schemaVersion:
      "1.0",

    profileId:
      "busybookie-master-normalization-v1",

    episodeId:
      input.episodeId,

    shotId:
      "S01",

    sourceVideoPath:
      input.sourceVideoPath,

    sourceSha256:
      input.sourceSha256,

    sourceDurationSeconds:
      input.durationSeconds === 5
        ? 5.041667
        : 4,

    targetDurationSeconds:
      input.durationSeconds,

    durationToleranceSeconds:
      1 / 24,

    durationMode:
      "MANIFEST_LOCKED",

    nativeAudio:
      input.nativeAudio,

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
          input.audioMode,

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
      input.episodeId ===
      "EP90"
        ? "a".repeat(
            64,
          )
        : "b".repeat(
            64,
          ),

    outputPath:
      `D:/Busybookie/Production/cache/composition-normalized/${input.episodeId}/S01/${input.episodeId}_S01_normalized.mp4`,
  });
}

describe(
  "Busybookie composition shot normalization FFmpeg command",
  () => {
    it(
      "builds the exact synthetic-silence command for a Runway normalization plan",
      () => {
        const ffmpegExecutable =
          "C:/Tools/ffmpeg.exe";

        const outputPath =
          "D:/Busybookie/Production/cache/composition-normalized/EP90/S01/output.mp4.part-test";

        const plan =
          createPlan({
            episodeId:
              "EP90",

            durationSeconds:
              5,

            nativeAudio:
              false,

            audioMode:
              "SYNTHETIC_SILENCE",

            sourceVideoPath:
              "D:/Busybookie/Production/generated-video/EP90/S01/EP90_S01_ab297ae3-b36b-47ed-a339-8dc574b8f17c_01.mp4",

            sourceSha256:
              "1f2d3cb765ba2ff0379af6d1ad9a34901a8a1b2153cad45875da3a3c072ff982",
          });

        const command =
          buildCompositionShotNormalizationFfmpegCommand({
            ffmpegExecutable,
            plan,
            outputPath,
          });

        const filterComplex =
          [
            "[0:v:0]",
            "scale=w=1920:h=1080:force_original_aspect_ratio=decrease:force_divisible_by=2,",
            "pad=w=1920:h=1080:x=(ow-iw)/2:y=(oh-ih)/2,",
            "setsar=1,",
            "fps=fps=25,",
            "tpad=stop_mode=clone:stop_duration=5,",
            "trim=duration=5,",
            "setpts=PTS-STARTPTS",
            "[v];",
            "anullsrc=channel_layout=stereo:sample_rate=48000:duration=5,",
            "atrim=duration=5,",
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
            plan.sourceVideoPath,
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
            "5",
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
      "builds the exact native-audio-preserving command for a Veo normalization plan",
      () => {
        const ffmpegExecutable =
          "C:/Tools/ffmpeg.exe";

        const outputPath =
          "D:/Busybookie/Production/cache/composition-normalized/EP91/S01/output.mp4.part-test";

        const plan =
          createPlan({
            episodeId:
              "EP91",

            durationSeconds:
              4,

            nativeAudio:
              true,

            audioMode:
              "PRESERVE_NATIVE",

            sourceVideoPath:
              "D:/Busybookie/Production/generated-video/EP91/S01/EP91_S01_6fyqkhhf9fj5_01.mp4",

            sourceSha256:
              "e68af876046f62a60dcd5efeb2eecf54c2d395efcce594b4b81b8635afc931aa",
          });

        const command =
          buildCompositionShotNormalizationFfmpegCommand({
            ffmpegExecutable,
            plan,
            outputPath,
          });

        const filterComplex =
          [
            "[0:v:0]",
            "scale=w=1920:h=1080:force_original_aspect_ratio=decrease:force_divisible_by=2,",
            "pad=w=1920:h=1080:x=(ow-iw)/2:y=(oh-ih)/2,",
            "setsar=1,",
            "fps=fps=25,",
            "tpad=stop_mode=clone:stop_duration=4,",
            "trim=duration=4,",
            "setpts=PTS-STARTPTS",
            "[v];",
            "[0:a:0]",
            "aresample=sample_rate=48000:out_chlayout=stereo,",
            "apad=whole_dur=4,",
            "atrim=duration=4,",
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
            plan.sourceVideoPath,
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
            "4",
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
  },
);
