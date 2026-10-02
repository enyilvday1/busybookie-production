import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  DialogueCompositionShotNormalizationPlan,
} from "../src/composition/buildDialogueCompositionShotNormalizationPlan.js";

import type {
  CompositionSourceMediaMetadata,
} from "../src/composition/probeCompositionSourceMedia.js";

import {
  verifyDialogueCompositionShotNormalizationOutput,
} from "../src/composition/verifyDialogueCompositionShotNormalizationOutput.js";

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
      "D:/Busybookie/Production/generated-video/EP02/S02/source.mp4",

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
                "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/line1.audio",

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
      "D:/Busybookie/Production/cache/composition-normalized/EP02/S02/output.mp4",
  });
}

function createValidOutput():
CompositionSourceMediaMetadata {
  return Object.freeze({
    sourceVideoPath:
      "D:/Busybookie/Production/cache/composition-normalized/EP02/S02/output.mp4.part-test",

    formatName:
      "mov,mp4,m4a,3gp,3g2,mj2",

    durationSeconds:
      6,

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
  "Busybookie dialogue composition normalization output verification",
  () => {
    it(
      "accepts output satisfying the dialogue-v2 master contract",
      () => {
        const result =
          verifyDialogueCompositionShotNormalizationOutput({
            plan:
              createPlan(),

            outputMedia:
              createValidOutput(),
          });

        expect(
          result,
        ).toEqual({
          outputPath:
            "D:/Busybookie/Production/cache/composition-normalized/EP02/S02/output.mp4.part-test",

          durationSeconds:
            6,

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
              6.04,
          }) satisfies
            CompositionSourceMediaMetadata;

        expect(
          () =>
            verifyDialogueCompositionShotNormalizationOutput({
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
              6.05,
          }) satisfies
            CompositionSourceMediaMetadata;

        expect(
          () =>
            verifyDialogueCompositionShotNormalizationOutput({
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
            verifyDialogueCompositionShotNormalizationOutput({
              plan:
                createPlan(),

              outputMedia,
            }),
        ).toThrow(
          /audio stream/i,
        );
      },
    );

    it(
      "fails closed when normalized audio is not AAC stereo 48 kHz",
      () => {
        const valid =
          createValidOutput();

        const outputMedia =
          Object.freeze({
            ...valid,

            audio:
              Object.freeze({
                ...valid.audio!,

                sampleRateHz:
                  44100,
              }),
          }) satisfies
            CompositionSourceMediaMetadata;

        expect(
          () =>
            verifyDialogueCompositionShotNormalizationOutput({
              plan:
                createPlan(),

              outputMedia,
            }),
        ).toThrow(
          /sample rate|audio/i,
        );
      },
    );

    it(
      "fails closed when the dialogue-v2 plan enables native-audio mixing",
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
            verifyDialogueCompositionShotNormalizationOutput({
              plan:
                unsafePlan,

              outputMedia:
                createValidOutput(),
            }),
        ).toThrow(
          /mixNativeAudio|native.*mix|mix.*native/i,
        );
      },
    );
  },
);
