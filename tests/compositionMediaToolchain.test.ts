import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  validateCompositionMediaToolchain,
  type CompositionMediaToolchainProbe,
} from "../src/composition/validateCompositionMediaToolchain.js";

describe(
  "Busybookie composition media toolchain",
  () => {
    it(
      "validates ffmpeg and ffprobe using PATH defaults",
      async () => {
        const probe:
          CompositionMediaToolchainProbe =
          vi.fn(
            async (
              executable,
              args,
            ) => ({
              executable,
              args,
              stdout:
                executable ===
                "ffmpeg"
                  ? "ffmpeg version 7.1"
                  : "ffprobe version 7.1",
              stderr: "",
            }),
          );

        const result =
          await validateCompositionMediaToolchain(
            {},
            {
              probe,
            },
          );

        expect(result).toEqual({
          ffmpegExecutable:
            "ffmpeg",

          ffprobeExecutable:
            "ffprobe",

          ffmpegVersionOutput:
            "ffmpeg version 7.1",

          ffprobeVersionOutput:
            "ffprobe version 7.1",
        });

        expect(
          probe,
        ).toHaveBeenNthCalledWith(
          1,
          "ffmpeg",
          [
            "-version",
          ],
        );

        expect(
          probe,
        ).toHaveBeenNthCalledWith(
          2,
          "ffprobe",
          [
            "-version",
          ],
        );
      },
    );

    it(
      "uses trimmed explicitly configured executable paths",
      async () => {
        const probe:
          CompositionMediaToolchainProbe =
          vi.fn(
            async (
              executable,
              args,
            ) => ({
              executable,
              args,
              stdout:
                executable
                  .toLowerCase()
                  .includes(
                    "ffprobe",
                  )
                  ? "ffprobe version 7.1"
                  : "ffmpeg version 7.1",
              stderr: "",
            }),
          );

        const result =
          await validateCompositionMediaToolchain(
            {
              BUSYBOOKIE_FFMPEG_PATH:
                "  D:/Tools/ffmpeg/bin/ffmpeg.exe  ",

              BUSYBOOKIE_FFPROBE_PATH:
                "  D:/Tools/ffmpeg/bin/ffprobe.exe  ",
            },
            {
              probe,
            },
          );

        expect(
          result.ffmpegExecutable,
        ).toBe(
          "D:/Tools/ffmpeg/bin/ffmpeg.exe",
        );

        expect(
          result.ffprobeExecutable,
        ).toBe(
          "D:/Tools/ffmpeg/bin/ffprobe.exe",
        );
      },
    );

    it(
      "fails closed when ffmpeg cannot be executed",
      async () => {
        const probe:
          CompositionMediaToolchainProbe =
          vi.fn(
            async (
              executable,
              args,
            ) => {
              if (
                executable ===
                "ffmpeg"
              ) {
                throw new Error(
                  "ENOENT",
                );
              }

              return {
                executable,
                args,
                stdout:
                  "ffprobe version 7.1",
                stderr: "",
              };
            },
          );

        await expect(
          validateCompositionMediaToolchain(
            {},
            {
              probe,
            },
          ),
        ).rejects.toThrow(
          /ffmpeg.*unavailable|ffmpeg.*failed/i,
        );

        expect(
          probe,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "fails closed when ffprobe cannot be executed",
      async () => {
        const probe:
          CompositionMediaToolchainProbe =
          vi.fn(
            async (
              executable,
              args,
            ) => {
              if (
                executable ===
                "ffprobe"
              ) {
                throw new Error(
                  "ENOENT",
                );
              }

              return {
                executable,
                args,
                stdout:
                  "ffmpeg version 7.1",
                stderr: "",
              };
            },
          );

        await expect(
          validateCompositionMediaToolchain(
            {},
            {
              probe,
            },
          ),
        ).rejects.toThrow(
          /ffprobe.*unavailable|ffprobe.*failed/i,
        );
      },
    );

    it(
      "fails closed when version output does not identify the expected executable",
      async () => {
        const probe:
          CompositionMediaToolchainProbe =
          vi.fn(
            async (
              executable,
              args,
            ) => ({
              executable,
              args,
              stdout:
                executable ===
                "ffmpeg"
                  ? "unrelated-tool version 1.0"
                  : "ffprobe version 7.1",
              stderr: "",
            }),
          );

        await expect(
          validateCompositionMediaToolchain(
            {},
            {
              probe,
            },
          ),
        ).rejects.toThrow(
          /ffmpeg.*identity|ffmpeg.*version/i,
        );

        expect(
          probe,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);
