import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  probeDialogueAudio,
  type DialogueAudioProbeRunner,
} from "../src/dialogue/probeDialogueAudio.js";

describe(
  "Busybookie dialogue audio probe",
  () => {
    it(
      "returns validated metadata for exactly one audio-only stream",
      async () => {
        const sourceAudioPath =
          "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01_RUNWAY_task-123_01.audio";

        const ffprobeExecutable =
          "D:/Tools/ffmpeg/bin/ffprobe.exe";

        const runProbe:
          DialogueAudioProbeRunner =
          vi.fn(
            async (
              executable,
              args,
            ) => ({
              executable,
              args,
              stdout:
                JSON.stringify({
                  streams: [
                    {
                      index:
                        0,

                      codec_type:
                        "audio",

                      codec_name:
                        "mp3",

                      profile:
                        null,

                      sample_rate:
                        "44100",

                      channels:
                        1,

                      channel_layout:
                        "mono",

                      duration:
                        "1.728000",
                    },
                  ],

                  format: {
                    format_name:
                      "mp3",

                    duration:
                      "1.728000",

                    size:
                      "28416",
                  },
                }),

              stderr:
                "",
            }),
          );

        const result =
          await probeDialogueAudio(
            {
              ffprobeExecutable,
              sourceAudioPath,
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
            "format=format_name,duration,size:stream=index,codec_type,codec_name,profile,sample_rate,channels,channel_layout,duration",
            "-of",
            "json",
            sourceAudioPath,
          ],
        );

        expect(
          result,
        ).toEqual({
          sourceAudioPath,

          formatName:
            "mp3",

          durationSeconds:
            1.728,

          audio: {
            codecName:
              "mp3",

            profile:
              null,

            sampleRateHz:
              44100,

            channels:
              1,

            channelLayout:
              "mono",
          },
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
            result.audio,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "rejects media without exactly one audio stream",
      async () => {
        const runProbe:
          DialogueAudioProbeRunner =
          vi.fn(
            async (
              executable,
              args,
            ) => ({
              executable,
              args,

              stdout:
                JSON.stringify({
                  streams:
                    [],

                  format: {
                    format_name:
                      "mp3",

                    duration:
                      "1.5",

                    size:
                      "1000",
                  },
                }),

              stderr:
                "",
            }),
          );

        await expect(
          probeDialogueAudio(
            {
              ffprobeExecutable:
                "ffprobe",

              sourceAudioPath:
                "D:/Busybookie/Production/test.audio",
            },
            {
              runProbe,
            },
          ),
        ).rejects.toThrow(
          /exactly one audio stream/i,
        );
      },
    );

    it(
      "rejects media that contains a video stream",
      async () => {
        const runProbe:
          DialogueAudioProbeRunner =
          vi.fn(
            async (
              executable,
              args,
            ) => ({
              executable,
              args,

              stdout:
                JSON.stringify({
                  streams: [
                    {
                      index:
                        0,

                      codec_type:
                        "audio",

                      codec_name:
                        "aac",

                      sample_rate:
                        "48000",

                      channels:
                        2,

                      channel_layout:
                        "stereo",
                    },

                    {
                      index:
                        1,

                      codec_type:
                        "video",

                      codec_name:
                        "h264",
                    },
                  ],

                  format: {
                    format_name:
                      "mov,mp4,m4a,3gp,3g2,mj2",

                    duration:
                      "1.5",

                    size:
                      "1000",
                  },
                }),

              stderr:
                "",
            }),
          );

        await expect(
          probeDialogueAudio(
            {
              ffprobeExecutable:
                "ffprobe",

              sourceAudioPath:
                "D:/Busybookie/Production/test.audio",
            },
            {
              runProbe,
            },
          ),
        ).rejects.toThrow(
          /audio-only|video stream/i,
        );
      },
    );

    it.each([
      "0",
      "-1",
      "NaN",
      "Infinity",
      "",
    ])(
      "rejects invalid container duration %j",
      async (
        duration,
      ) => {
        const runProbe:
          DialogueAudioProbeRunner =
          vi.fn(
            async (
              executable,
              args,
            ) => ({
              executable,
              args,

              stdout:
                JSON.stringify({
                  streams: [
                    {
                      index:
                        0,

                      codec_type:
                        "audio",

                      codec_name:
                        "mp3",

                      sample_rate:
                        "44100",

                      channels:
                        1,

                      channel_layout:
                        "mono",
                    },
                  ],

                  format: {
                    format_name:
                      "mp3",

                    duration,

                    size:
                      "1000",
                  },
                }),

              stderr:
                "",
            }),
          );

        await expect(
          probeDialogueAudio(
            {
              ffprobeExecutable:
                "ffprobe",

              sourceAudioPath:
                "D:/Busybookie/Production/test.audio",
            },
            {
              runProbe,
            },
          ),
        ).rejects.toThrow(
          /positive.*duration/i,
        );
      },
    );

    it(
      "rejects invalid audio stream metadata",
      async () => {
        const runProbe:
          DialogueAudioProbeRunner =
          vi.fn(
            async (
              executable,
              args,
            ) => ({
              executable,
              args,

              stdout:
                JSON.stringify({
                  streams: [
                    {
                      index:
                        0,

                      codec_type:
                        "audio",

                      codec_name:
                        "mp3",

                      sample_rate:
                        "0",

                      channels:
                        1,

                      channel_layout:
                        "mono",
                    },
                  ],

                  format: {
                    format_name:
                      "mp3",

                    duration:
                      "1.5",

                    size:
                      "1000",
                  },
                }),

              stderr:
                "",
            }),
          );

        await expect(
          probeDialogueAudio(
            {
              ffprobeExecutable:
                "ffprobe",

              sourceAudioPath:
                "D:/Busybookie/Production/test.audio",
            },
            {
              runProbe,
            },
          ),
        ).rejects.toThrow(
          /positive.*sample rate/i,
        );
      },
    );

    it(
      "fails closed when ffprobe execution fails",
      async () => {
        const runProbe:
          DialogueAudioProbeRunner =
          vi.fn(
            async () => {
              throw new Error(
                "ffprobe unavailable",
              );
            },
          );

        await expect(
          probeDialogueAudio(
            {
              ffprobeExecutable:
                "ffprobe",

              sourceAudioPath:
                "D:/Busybookie/Production/test.audio",
            },
            {
              runProbe,
            },
          ),
        ).rejects.toThrow(
          /dialogue audio ffprobe failed/i,
        );
      },
    );

    it(
      "fails closed on invalid ffprobe JSON",
      async () => {
        const runProbe:
          DialogueAudioProbeRunner =
          vi.fn(
            async (
              executable,
              args,
            ) => ({
              executable,
              args,

              stdout:
                "{not-json",

              stderr:
                "",
            }),
          );

        await expect(
          probeDialogueAudio(
            {
              ffprobeExecutable:
                "ffprobe",

              sourceAudioPath:
                "D:/Busybookie/Production/test.audio",
            },
            {
              runProbe,
            },
          ),
        ).rejects.toThrow(
          /invalid JSON/i,
        );
      },
    );
  },
);
