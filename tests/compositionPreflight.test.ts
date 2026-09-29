import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  Environment,
} from "../src/schemas/environment.schema.js";

import type {
  ProductionRules,
} from "../src/schemas/productionRules.schema.js";

import type {
  CompositionMediaToolchain,
} from "../src/composition/validateCompositionMediaToolchain.js";

import {
  runCompositionPreflight,
} from "../src/composition/runCompositionPreflight.js";

const environment: Environment = {
  BUSYBOOKIE_MEDIA_ROOT:
    "D:/Busybookie/Production",

  BUSYBOOKIE_FFMPEG_PATH:
    "D:/Tools/ffmpeg/bin/ffmpeg.exe",

  BUSYBOOKIE_FFPROBE_PATH:
    "D:/Tools/ffmpeg/bin/ffprobe.exe",
};

const productionRules: ProductionRules = {
  schemaVersion:
    "1.0",

  brand: {
    brandName:
      "Busybookie",

    showName:
      "Busybookie",

    setting:
      "production",

    tagline:
      "production",
  },

  postProduction: {
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
  },

  storage: {
    mediaRootEnvVar:
      "BUSYBOOKIE_MEDIA_ROOT",

    requireExternalMediaRoot:
      true,
  },

  approvals: {
    requireScriptApproval:
      true,

    requireStoryboardApproval:
      true,

    requireReferenceApproval:
      true,

    requireRoughCutApproval:
      true,

    requireFinalQcApproval:
      true,
  },

  generation: {
    allowUnapprovedGeneration:
      false,

    maxAutomaticRetries:
      0,

    supportedProviders: [
      "RUNWAY",
      "VEO",
      "MANUAL",
    ],
  },
};

const mediaToolchain:
  CompositionMediaToolchain =
  Object.freeze({
    ffmpegExecutable:
      "D:/Tools/ffmpeg/bin/ffmpeg.exe",

    ffprobeExecutable:
      "D:/Tools/ffmpeg/bin/ffprobe.exe",

    ffmpegVersionOutput:
      "ffmpeg version 9.0.2",

    ffprobeVersionOutput:
      "ffprobe version 9.0.2",
  });

describe(
  "Busybookie composition preflight",
  () => {
    it(
      "loads production inputs and returns verified composition dependencies",
      async () => {
        const loadEnvironment =
          vi.fn(
            () =>
              environment,
          );

        const loadProductionRules =
          vi.fn(
            async () =>
              productionRules,
          );

        const resolveMediaRoot =
          vi.fn(
            () =>
              "D:\\Busybookie\\Production",
          );

        const validateMediaToolchain =
          vi.fn(
            async () =>
              mediaToolchain,
          );

        const result =
          await runCompositionPreflight({
            loadEnvironment,
            loadProductionRules,
            resolveMediaRoot,
            validateMediaToolchain,
          });

        expect(
          loadEnvironment,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          loadProductionRules,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          resolveMediaRoot,
        ).toHaveBeenCalledWith(
          environment,
          productionRules,
        );

        expect(
          validateMediaToolchain,
        ).toHaveBeenCalledWith(
          environment,
        );

        expect(result).toEqual({
          mediaRoot:
            "D:\\Busybookie\\Production",

          rules:
            productionRules,

          mediaToolchain,
        });

        expect(
          Object.isFrozen(result),
        ).toBe(
          true,
        );
      },
    );

    it(
      "fails before probing the media toolchain when media-root resolution fails",
      async () => {
        const loadEnvironment =
          vi.fn(
            () =>
              environment,
          );

        const loadProductionRules =
          vi.fn(
            async () =>
              productionRules,
          );

        const resolveMediaRoot =
          vi.fn(
            () => {
              throw new Error(
                "invalid media root",
              );
            },
          );

        const validateMediaToolchain =
          vi.fn(
            async () =>
              mediaToolchain,
          );

        await expect(
          runCompositionPreflight({
            loadEnvironment,
            loadProductionRules,
            resolveMediaRoot,
            validateMediaToolchain,
          }),
        ).rejects.toThrow(
          "invalid media root",
        );

        expect(
          validateMediaToolchain,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
