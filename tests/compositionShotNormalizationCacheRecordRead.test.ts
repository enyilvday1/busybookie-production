import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
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
  readCompositionShotNormalizationCacheRecord,
} from "../src/composition/readCompositionShotNormalizationCacheRecord.js";

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
        "busybookie-composition-normalization-record-read-",
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
      "2026-09-30T12:15:00.000Z",

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
  "Busybookie composition shot normalization cache record reader",
  () => {
    it(
      "returns null when no durable normalization cache record exists",
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

        await expect(
          readCompositionShotNormalizationCacheRecord(
            outputPath,
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "reads and validates the durable record for the exact normalized output identity",
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
          readCompositionShotNormalizationCacheRecord(
            outputPath,
          ),
        ).resolves.toEqual(
          record,
        );
      },
    );

    it(
      "fails closed when the durable normalization cache record is malformed JSON",
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

        const recordPath =
          createCompositionShotNormalizationCacheRecordPath(
            outputPath,
          );

        await mkdir(
          dirname(
            recordPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          recordPath,
          "{damaged",
          "utf8",
        );

        await expect(
          readCompositionShotNormalizationCacheRecord(
            outputPath,
          ),
        ).rejects.toThrow(
          /normalization.*record.*not valid JSON/i,
        );
      },
    );

    it(
      "fails closed when the durable record output identity differs from the requested normalized output",
      async () => {
        const root =
          await makeTempDirectory();

        const requestedOutputPath =
          join(
            root,
            "cache",
            "composition-normalized",
            "EP90",
            "S01",
            `EP90_S01_${"b".repeat(64)}.mp4`,
          );

        const conflictingOutputPath =
          join(
            root,
            "cache",
            "composition-normalized",
            "EP90",
            "S01",
            `EP90_S01_${"d".repeat(64)}.mp4`,
          );

        const conflictingRecord =
          createRecord(
            conflictingOutputPath,
          );

        const requestedRecordPath =
          createCompositionShotNormalizationCacheRecordPath(
            requestedOutputPath,
          );

        await mkdir(
          dirname(
            requestedRecordPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          requestedRecordPath,
          `${JSON.stringify(
            conflictingRecord,
            null,
            2,
          )}\n`,
          "utf8",
        );

        await expect(
          readCompositionShotNormalizationCacheRecord(
            requestedOutputPath,
          ),
        ).rejects.toThrow(
          /normalization.*record.*identity.*requested.*output/i,
        );
      },
    );
  },
);
