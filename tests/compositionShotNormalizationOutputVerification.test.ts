import {
  describe,
  expect,
  it,
} from "vitest";

import {
  verifyCompositionShotNormalizationOutput,
} from "../src/composition/verifyCompositionShotNormalizationOutput.js";

import type {
  CompositionShotNormalizationPlan,
} from "../src/composition/buildCompositionShotNormalizationPlan.js";

import type {
  CompositionSourceMediaMetadata,
} from "../src/composition/probeCompositionSourceMedia.js";

function createPlan():
  CompositionShotNormalizationPlan {
  return Object.freeze({
    schemaVersion:
      "1.0",

    profileId:
      "busybookie-master-normalization-v1",

    episodeId:
      "EP90",

    shotId:
      "S01",

    sourceVideoPath:
      "D:/Busybookie/Production/generated-video/EP90/S01/source.mp4",

    sourceSha256:
      "a".repeat(
        64,
      ),

    sourceDurationSeconds:
      5.041667,

    targetDurationSeconds:
      5,

    durationToleranceSeconds:
      1 / 24,

    durationMode:
      "MANIFEST_LOCKED",

    nativeAudio:
      false,

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
          "SYNTHETIC_SILENCE",

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
      "b".repeat(
        64,
      ),

    outputPath:
      "D:/Busybookie/Production/cache/composition-normalized/EP90/S01/output.mp4",
  });
}

function createValidOutput():
  CompositionSourceMediaMetadata {
  return Object.freeze({
    sourceVideoPath:
      "D:/Busybookie/Production/cache/composition-normalized/EP90/S01/output.mp4.part-test",

    formatName:
      "mov,mp4,m4a,3gp,3g2,mj2",

    durationSeconds:
      5,

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

        pixelFormat:
          "yuv420p",

        frameRate:
          25,
      }),

    audio:
      Object.freeze({
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
      }),
  });
}

describe(
  "Busybookie composition shot normalization output verification",
  () => {
    it(
      "accepts an output that exactly satisfies the normalization master contract",
      () => {
        const result =
          verifyCompositionShotNormalizationOutput({
            plan:
              createPlan(),

            outputMedia:
              createValidOutput(),
          });

        expect(
          result,
        ).toEqual({
          outputPath:
            "D:/Busybookie/Production/cache/composition-normalized/EP90/S01/output.mp4.part-test",

          durationSeconds:
            5,

          durationToleranceSeconds:
            1 / 25,
        });

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "accepts a one-normalized-frame duration difference",
      () => {
        const outputMedia =
          Object.freeze({
            ...createValidOutput(),

            durationSeconds:
              5.04,
          }) satisfies
            CompositionSourceMediaMetadata;

        expect(
          () =>
            verifyCompositionShotNormalizationOutput({
              plan:
                createPlan(),

              outputMedia,
            }),
        ).not.toThrow();
      },
    );

    it(
      "fails closed when normalized output duration differs by more than one normalized frame",
      () => {
        const outputMedia =
          Object.freeze({
            ...createValidOutput(),

            durationSeconds:
              5.05,
          }) satisfies
            CompositionSourceMediaMetadata;

        expect(
          () =>
            verifyCompositionShotNormalizationOutput({
              plan:
                createPlan(),

              outputMedia,
            }),
        ).toThrow(
          /duration.*more than one normalized frame/i,
        );
      },
    );

    it(
      "fails closed when the normalized frame rate is wrong",
      () => {
        const valid =
          createValidOutput();

        const outputMedia =
          Object.freeze({
            ...valid,

            video:
              Object.freeze({
                ...valid.video,

                frameRate:
                  24,
              }),
          }) satisfies
            CompositionSourceMediaMetadata;

        expect(
          () =>
            verifyCompositionShotNormalizationOutput({
              plan:
                createPlan(),

              outputMedia,
            }),
        ).toThrow(
          /frame rate/i,
        );
      },
    );

    it(
      "fails closed when normalized audio is absent",
      () => {
        const outputMedia =
          Object.freeze({
            ...createValidOutput(),

            audio:
              null,
          }) satisfies
            CompositionSourceMediaMetadata;

        expect(
          () =>
            verifyCompositionShotNormalizationOutput({
              plan:
                createPlan(),

              outputMedia,
            }),
        ).toThrow(
          /audio/i,
        );
      },
    );

    it(
      "fails closed when normalized video geometry is wrong",
      () => {
        const valid =
          createValidOutput();

        const outputMedia =
          Object.freeze({
            ...valid,

            video:
              Object.freeze({
                ...valid.video,

                width:
                  1280,
              }),
          }) satisfies
            CompositionSourceMediaMetadata;

        expect(
          () =>
            verifyCompositionShotNormalizationOutput({
              plan:
                createPlan(),

              outputMedia,
            }),
        ).toThrow(
          /dimensions|geometry|width/i,
        );
      },
    );

    it(
      "fails closed when normalized audio does not satisfy the AAC stereo 48 kHz contract",
      () => {
        const valid =
          createValidOutput();

        const outputMedia =
          Object.freeze({
            ...valid,

            audio:
              Object.freeze({
                codecName:
                  "aac",

                profile:
                  "LC",

                sampleRateHz:
                  44100,

                channels:
                  2,

                channelLayout:
                  "stereo",
              }),
          }) satisfies
            CompositionSourceMediaMetadata;

        expect(
          () =>
            verifyCompositionShotNormalizationOutput({
              plan:
                createPlan(),

              outputMedia,
            }),
        ).toThrow(
          /sample rate|audio/i,
        );
      },
    );
  },
);

describe(
  "Busybookie normalization profile integrity",
  () => {
    it(
      "fails closed when the v1 profile plan does not contain the fixed master geometry",
      () => {
        const validPlan =
          createPlan();

        const plan =
          Object.freeze({
            ...validPlan,

            video:
              Object.freeze({
                ...validPlan.video,

                width:
                  1280,
              }),
          }) satisfies
            CompositionShotNormalizationPlan;

        const validOutput =
          createValidOutput();

        const outputMedia =
          Object.freeze({
            ...validOutput,

            video:
              Object.freeze({
                ...validOutput.video,

                width:
                  1280,
              }),
          }) satisfies
            CompositionSourceMediaMetadata;

        expect(
          () =>
            verifyCompositionShotNormalizationOutput({
              plan,
              outputMedia,
            }),
        ).toThrow(
          /1920x1080|master profile|profile.*geometry/i,
        );
      },
    );
  },
);
