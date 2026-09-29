import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  loadEnvironment,
} from "../src/validation/loadEnvironment.js";

describe(
  "Busybookie composition environment",
  () => {
    afterEach(
      () => {
        vi.unstubAllEnvs();
      },
    );

    it(
      "loads trimmed explicit ffmpeg and ffprobe executable paths",
      () => {
        vi.stubEnv(
          "BUSYBOOKIE_MEDIA_ROOT",
          "D:/Busybookie/Production",
        );

        vi.stubEnv(
          "BUSYBOOKIE_FFMPEG_PATH",
          "  D:/Tools/ffmpeg/bin/ffmpeg.exe  ",
        );

        vi.stubEnv(
          "BUSYBOOKIE_FFPROBE_PATH",
          "  D:/Tools/ffmpeg/bin/ffprobe.exe  ",
        );

        const env =
          loadEnvironment();

        expect(
          env.BUSYBOOKIE_FFMPEG_PATH,
        ).toBe(
          "D:/Tools/ffmpeg/bin/ffmpeg.exe",
        );

        expect(
          env.BUSYBOOKIE_FFPROBE_PATH,
        ).toBe(
          "D:/Tools/ffmpeg/bin/ffprobe.exe",
        );
      },
    );

    it(
      "keeps composition executable overrides optional",
      () => {
        vi.stubEnv(
          "BUSYBOOKIE_MEDIA_ROOT",
          "D:/Busybookie/Production",
        );

        vi.stubEnv(
          "BUSYBOOKIE_FFMPEG_PATH",
          "",
        );

        vi.stubEnv(
          "BUSYBOOKIE_FFPROBE_PATH",
          "",
        );

        const env =
          loadEnvironment();

        expect(
          env.BUSYBOOKIE_FFMPEG_PATH,
        ).toBeUndefined();

        expect(
          env.BUSYBOOKIE_FFPROBE_PATH,
        ).toBeUndefined();
      },
    );
  },
);
