import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CompositionShotNormalizationCacheRecordSchema,
} from "../src/composition/compositionShotNormalizationCacheRecord.schema.js";

function createValidRecord() {
  const cacheKey =
    "a".repeat(
      64,
    );

  const sourceSha256 =
    "b".repeat(
      64,
    );

  const outputSha256 =
    "c".repeat(
      64,
    );

  const outputPath =
    `D:/Busybookie/Production/cache/composition-normalized/EP90/S01/EP90_S01_${cacheKey}.mp4`;

  return {
    schemaVersion:
      "1.0",

    recordedAt:
      "2026-09-30T10:45:00.000Z",

    status:
      "NORMALIZED",

    plan: {
      schemaVersion:
        "1.0",

      profileId:
        "busybookie-master-normalization-v1",

      episodeId:
        "EP90",

      shotId:
        "S01",

      sourceVideoPath:
        "D:/Busybookie/Production/generated-video/EP90/S01/EP90_S01_provider.mp4",

      sourceSha256,

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

      video: {
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
      },

      audio: {
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
      },

      cacheKey,

      outputPath,
    },

    artifact: {
      outputPath,

      bytes:
        123456,

      sha256:
        outputSha256,

      contentType:
        "video/mp4",

      durationSeconds:
        5,

      durationToleranceSeconds:
        1 / 25,
    },
  };
}

describe(
  "Busybookie composition shot normalization cache record schema",
  () => {
    it(
      "accepts a complete durable normalization cache record",
      () => {
        const parsed =
          CompositionShotNormalizationCacheRecordSchema.parse(
            createValidRecord(),
          );

        expect(
          parsed.schemaVersion,
        ).toBe(
          "1.0",
        );

        expect(
          parsed.status,
        ).toBe(
          "NORMALIZED",
        );

        expect(
          parsed.plan.cacheKey,
        ).toBe(
          "a".repeat(
            64,
          ),
        );

        expect(
          parsed.artifact.sha256,
        ).toBe(
          "c".repeat(
            64,
          ),
        );
      },
    );

    it(
      "fails closed when a durable artifact SHA-256 is malformed",
      () => {
        const record =
          createValidRecord();

        expect(
          () =>
            CompositionShotNormalizationCacheRecordSchema.parse({
              ...record,

              artifact: {
                ...record.artifact,

                sha256:
                  "not-a-sha256",
              },
            }),
        ).toThrow();
      },
    );

    it(
      "fails closed when unknown durable fields are present",
      () => {
        expect(
          () =>
            CompositionShotNormalizationCacheRecordSchema.parse({
              ...createValidRecord(),

              unexpected:
                true,
            }),
        ).toThrow();
      },
    );
  },
);

describe(
  "Busybookie composition shot normalization cache record integrity",
  () => {
    it(
      "fails closed when a durable plan path is relative",
      () => {
        const record =
          createValidRecord();

        expect(
          () =>
            CompositionShotNormalizationCacheRecordSchema.parse({
              ...record,

              plan: {
                ...record.plan,

                sourceVideoPath:
                  "generated-video/EP90/S01/source.mp4",
              },
            }),
        ).toThrow(
          /absolute|path/i,
        );
      },
    );

    it(
      "fails closed when a durable artifact path is relative",
      () => {
        const record =
          createValidRecord();

        expect(
          () =>
            CompositionShotNormalizationCacheRecordSchema.parse({
              ...record,

              artifact: {
                ...record.artifact,

                outputPath:
                  "cache/composition-normalized/EP90/S01/output.mp4",
              },
            }),
        ).toThrow(
          /absolute|path/i,
        );
      },
    );

    it(
      "fails closed when the durable artifact output path differs from the normalization plan output path",
      () => {
        const record =
          createValidRecord();

        expect(
          () =>
            CompositionShotNormalizationCacheRecordSchema.parse({
              ...record,

              artifact: {
                ...record.artifact,

                outputPath:
                  "D:/Busybookie/Production/cache/composition-normalized/EP90/S01/different.mp4",
              },
            }),
        ).toThrow(
          /artifact.*output.*plan|plan.*output.*artifact/i,
        );
      },
    );
  },
);
