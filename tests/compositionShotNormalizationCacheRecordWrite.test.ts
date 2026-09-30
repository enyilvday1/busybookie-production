import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import type {
  CompositionShotNormalizationCacheRecord,
} from "../src/composition/compositionShotNormalizationCacheRecord.schema.js";

import {
  createCompositionShotNormalizationCacheRecordPath,
} from "../src/composition/compositionShotNormalizationCacheRecordPath.js";

import {
  writeCompositionShotNormalizationCacheRecord,
} from "../src/composition/writeCompositionShotNormalizationCacheRecord.js";

const temporaryDirectories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-composition-normalization-record-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

function createRecord(
  outputPath:
    string,
): CompositionShotNormalizationCacheRecord {
  return {
    schemaVersion:
      "1.0",

    recordedAt:
      "2026-09-30T11:55:00.000Z",

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
        join(
          tmpdir(),
          "busybookie-provider-source.mp4",
        ),

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

      cacheKey:
        "b".repeat(
          64,
        ),

      outputPath,
    },

    artifact: {
      outputPath,

      bytes:
        123456,

      sha256:
        "c".repeat(
          64,
        ),

      contentType:
        "video/mp4",

      durationSeconds:
        5,

      durationToleranceSeconds:
        1 / 25,
    },
  };
}

afterEach(
  async () => {
    await Promise.all(
      temporaryDirectories
        .splice(
          0,
        )
        .map(
          (
            directory,
          ) =>
            rm(
              directory,
              {
                recursive:
                  true,

                force:
                  true,
              },
            ),
        ),
    );
  },
);

describe(
  "Busybookie composition shot normalization cache record writer",
  () => {
    it(
      "persists the strict durable sidecar beside the normalized MP4",
      async () => {
        const root =
          await makeTempDirectory();

        const outputPath =
          join(
            root,
            "cache",
            "composition-normalized",
            "EP90",
            "S01",
            `EP90_S01_${"b".repeat(64)}.mp4`,
          );

        const record =
          createRecord(
            outputPath,
          );

        const expectedRecordPath =
          createCompositionShotNormalizationCacheRecordPath(
            outputPath,
          );

        await expect(
          writeCompositionShotNormalizationCacheRecord(
            record,
          ),
        ).resolves.toBe(
          expectedRecordPath,
        );

        const persisted =
          JSON.parse(
            await readFile(
              expectedRecordPath,
              "utf8",
            ),
          );

        expect(
          persisted,
        ).toEqual(
          record,
        );
      },
    );

    it(
      "fails closed rather than overwriting an existing durable sidecar",
      async () => {
        const root =
          await makeTempDirectory();

        const outputPath =
          join(
            root,
            "cache",
            "composition-normalized",
            "EP90",
            "S01",
            `EP90_S01_${"b".repeat(64)}.mp4`,
          );

        const record =
          createRecord(
            outputPath,
          );

        await writeCompositionShotNormalizationCacheRecord(
          record,
        );

        await expect(
          writeCompositionShotNormalizationCacheRecord(
            record,
          ),
        ).rejects.toThrow(
          /normalization.*record.*already exists/i,
        );
      },
    );
  },
);
