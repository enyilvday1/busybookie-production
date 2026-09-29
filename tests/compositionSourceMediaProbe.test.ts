import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  probeCompositionSourceMedia,
  type CompositionSourceMediaProbeRunner,
} from "../src/composition/probeCompositionSourceMedia.js";

describe(
  "Busybookie composition source media probe",
  () => {
    it(
      "returns validated video and native-audio metadata from ffprobe JSON",
      async () => {
        const runProbe:
          CompositionSourceMediaProbeRunner =
          vi.fn(
            async (
              executable,
              args,
            ) => ({
              executable,
              args,
              stdout: JSON.stringify({
                streams: [
                  {
                    index: 0,
                    codec_name: "h264",
                    profile: "High",
                    codec_type: "video",
                    width: 1280,
                    height: 720,
                    pix_fmt: "yuv420p",
                    r_frame_rate: "24/1",
                    avg_frame_rate: "24/1",
                    duration: "4.000000",
                  },
                  {
                    index: 1,
                    codec_name: "aac",
                    profile: "LC",
                    codec_type: "audio",
                    sample_rate: "48000",
                    channels: 2,
                    channel_layout: "stereo",
                    duration: "4.000000",
                  },
                ],
                format: {
                  format_name:
                    "mov,mp4,m4a,3gp,3g2,mj2",
                  duration:
                    "4.000000",
                  size:
                    "4511709",
                },
              }),
              stderr: "",
            }),
          );

        const result =
          await probeCompositionSourceMedia(
            {
              ffprobeExecutable:
                "D:/Tools/ffmpeg/bin/ffprobe.exe",

              sourceVideoPath:
                "D:/Busybookie/Production/generated-video/EP91/S01/EP91_S01_test_01.mp4",

              nativeAudio:
                true,
            },
            {
              runProbe,
            },
          );

        expect(
          runProbe,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result,
        ).toEqual({
          sourceVideoPath:
            "D:/Busybookie/Production/generated-video/EP91/S01/EP91_S01_test_01.mp4",

          formatName:
            "mov,mp4,m4a,3gp,3g2,mj2",

          durationSeconds:
            4,

          video: {
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
          },

          audio: {
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
          },
        });

        expect(
          Object.isFrozen(result),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(result.video),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(result.audio),
        ).toBe(
          true,
        );
      },
    );

    it(
      "fails closed when native audio is required but the source has no audio stream",
      async () => {
        const runProbe:
          CompositionSourceMediaProbeRunner =
          vi.fn(
            async (
              executable,
              args,
            ) => ({
              executable,
              args,
              stdout: JSON.stringify({
                streams: [
                  {
                    index: 0,
                    codec_name: "h264",
                    codec_type: "video",
                    width: 1280,
                    height: 720,
                    pix_fmt: "yuv420p",
                    r_frame_rate: "24/1",
                    avg_frame_rate: "24/1",
                    duration: "4.000000",
                  },
                ],
                format: {
                  format_name:
                    "mov,mp4,m4a,3gp,3g2,mj2",
                  duration:
                    "4.000000",
                  size:
                    "4511709",
                },
              }),
              stderr: "",
            }),
          );

        await expect(
          probeCompositionSourceMedia(
            {
              ffprobeExecutable:
                "D:/Tools/ffmpeg/bin/ffprobe.exe",

              sourceVideoPath:
                "D:/Busybookie/Production/generated-video/EP91/S01/EP91_S01_test_01.mp4",

              nativeAudio:
                true,
            },
            {
              runProbe,
            },
          ),
        ).rejects.toThrow(
          /native audio.*audio stream|audio stream.*native audio/i,
        );
      },
    );
  },
);

describe(
  "Busybookie composition source media ffprobe contract",
  () => {
    it(
      "invokes ffprobe once with exact read-only arguments and the exact source path",
      async () => {
        const sourceVideoPath =
          "D:/Busybookie/Production/generated-video/EP91/S01/EP91_S01_contract_01.mp4";

        const ffprobeExecutable =
          "D:/Tools/ffmpeg/bin/ffprobe.exe";

        const runProbe:
          CompositionSourceMediaProbeRunner =
          vi.fn(
            async (
              executable,
              args,
            ) => ({
              executable,
              args,
              stdout: JSON.stringify({
                streams: [
                  {
                    index: 0,
                    codec_name: "h264",
                    codec_type: "video",
                    width: 1280,
                    height: 720,
                    pix_fmt: "yuv420p",
                    r_frame_rate: "24/1",
                    avg_frame_rate: "24/1",
                    duration: "4.000000",
                  },
                ],
                format: {
                  format_name:
                    "mov,mp4,m4a,3gp,3g2,mj2",
                  duration:
                    "4.000000",
                  size:
                    "4511709",
                },
              }),
              stderr: "",
            }),
          );

        await probeCompositionSourceMedia(
          {
            ffprobeExecutable,

            sourceVideoPath,

            nativeAudio:
              false,
          },
          {
            runProbe,
          },
        );

        expect(
          runProbe,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          runProbe,
        ).toHaveBeenCalledWith(
          ffprobeExecutable,
          [
            "-v",
            "error",
            "-show_entries",
            "format=format_name,duration,size:stream=index,codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,avg_frame_rate,sample_rate,channels,channel_layout,duration",
            "-of",
            "json",
            sourceVideoPath,
          ],
        );
      },
    );
  },
);

describe(
  "Busybookie composition source media audio admission",
  () => {
    it(
      "ignores incidental source audio when native audio is disabled",
      async () => {
        const runProbe:
          CompositionSourceMediaProbeRunner =
          vi.fn(
            async (
              executable,
              args,
            ) => ({
              executable,
              args,
              stdout: JSON.stringify({
                streams: [
                  {
                    index: 0,
                    codec_name: "h264",
                    codec_type: "video",
                    width: 1280,
                    height: 720,
                    pix_fmt: "yuv420p",
                    r_frame_rate: "24/1",
                    avg_frame_rate: "24/1",
                    duration: "4.000000",
                  },
                  {
                    index: 1,
                    codec_name: "aac",
                    codec_type: "audio",
                  },
                ],
                format: {
                  format_name:
                    "mov,mp4,m4a,3gp,3g2,mj2",
                  duration:
                    "4.000000",
                  size:
                    "4511709",
                },
              }),
              stderr: "",
            }),
          );

        const result =
          await probeCompositionSourceMedia(
            {
              ffprobeExecutable:
                "D:/Tools/ffmpeg/bin/ffprobe.exe",

              sourceVideoPath:
                "D:/Busybookie/Production/generated-video/EP90/S01/EP90_S01_visual_only_01.mp4",

              nativeAudio:
                false,
            },
            {
              runProbe,
            },
          );

        expect(
          result.audio,
        ).toBeNull();
      },
    );
  },
);
