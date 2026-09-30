import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createCompositionShotNormalizationCacheRecordPath,
} from "../src/composition/compositionShotNormalizationCacheRecordPath.js";

describe(
  "Busybookie composition shot normalization cache record path",
  () => {
    it(
      "derives the durable sidecar path directly from the canonical Windows normalized MP4 path",
      () => {
        const cacheKey =
          "a".repeat(
            64,
          );

        const outputPath =
          `D:/Busybookie/Production/cache/composition-normalized/EP90/S01/EP90_S01_${cacheKey}.mp4`;

        expect(
          createCompositionShotNormalizationCacheRecordPath(
            outputPath,
          ),
        ).toBe(
          `D:/Busybookie/Production/cache/composition-normalized/EP90/S01/EP90_S01_${cacheKey}.composition-normalization.json`,
        );
      },
    );

    it(
      "derives the durable sidecar path directly from a canonical POSIX normalized MP4 path",
      () => {
        const cacheKey =
          "b".repeat(
            64,
          );

        const outputPath =
          `/tmp/busybookie/cache/composition-normalized/EP91/S01/EP91_S01_${cacheKey}.mp4`;

        expect(
          createCompositionShotNormalizationCacheRecordPath(
            outputPath,
          ),
        ).toBe(
          `/tmp/busybookie/cache/composition-normalized/EP91/S01/EP91_S01_${cacheKey}.composition-normalization.json`,
        );
      },
    );

    it(
      "fails closed when the supplied normalized output path is not the canonical MP4 artifact path",
      () => {
        expect(
          () =>
            createCompositionShotNormalizationCacheRecordPath(
              "D:/Busybookie/Production/cache/composition-normalized/EP90/S01/not-an-mp4.mov",
            ),
        ).toThrow(
          /normalization.*mp4/i,
        );
      },
    );
  },
);
