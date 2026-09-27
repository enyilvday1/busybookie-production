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
  VeoGenerationRecord,
} from "../src/veo/audit/veoGenerationRecord.schema.js";

import {
  readVeoGenerationRecord,
} from "../src/veo/audit/readVeoGenerationRecord.js";

import {
  createVeoGenerationRecordPathFromIdentity,
  writeVeoGenerationRecord,
} from "../src/veo/audit/writeVeoGenerationRecord.js";

const temporaryDirectories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-veo-record-read-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

function createRecord():
VeoGenerationRecord {
  return {
    schemaVersion:
      "1.0",

    recordedAt:
      "2026-09-27T20:40:00.000Z",

    provider:
      "VEO",

    model:
      "veo-3.1-fast-generate-preview",

    status:
      "SUCCEEDED",

    episodeId:
      "EP91",

    shotId:
      "S01",

    operationName:
      "models/veo-3.1-fast-generate-preview/operations/durable-veo-123",

    request: {
      durationSeconds:
        4,

      aspectRatio:
        "16:9",

      resolution:
        "720p",

      numberOfVideos:
        1,

      nativeAudioExpected:
        true,

      expectedOutputFps:
        24,

      promptText:
        "Busybookie Veo recovery audit test.",

      sourceImagePath:
        "D:/Busybookie/Production/references/EP91/S01/reference.png",

      imageMimeType:
        "image/png",
    },

    costPolicy: {
      pricingReviewedOn:
        "2026-09-27",

      centsPerSecond:
        10,

      locallyExpectedCents:
        40,
    },

    safety: {
      raiMediaFilteredCount:
        0,

      raiMediaFilteredReasons:
        [],
    },

    outputs: [
      {
        outputIndex:
          1,

        destinationPath:
          "D:/Busybookie/Production/generated-video/EP91/S01/EP91_S01_durable-veo-123_01.mp4",

        bytes:
          123,

        sha256:
          "a".repeat(
            64,
          ),

        contentType:
          "video/mp4",
      },
    ],
  };
}

afterEach(
  async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map(
          (directory) =>
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
  "Busybookie Veo generation record reader",
  () => {
    it(
      "returns null when no durable generation record exists",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          readVeoGenerationRecord(
            mediaRoot,
            "EP91",
            "S01",
            "models/veo-3.1-fast-generate-preview/operations/durable-veo-123",
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "reads and validates the durable generation record for the exact Veo operation identity",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const record =
          createRecord();

        await writeVeoGenerationRecord(
          mediaRoot,
          record,
        );

        await expect(
          readVeoGenerationRecord(
            mediaRoot,
            "EP91",
            "S01",
            record.operationName,
          ),
        ).resolves.toEqual(
          record,
        );
      },
    );

    it(
      "fails closed when the durable generation record is malformed JSON",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const record =
          createRecord();

        const recordPath =
          createVeoGenerationRecordPathFromIdentity(
            mediaRoot,
            record.episodeId,
            record.shotId,
            record.operationName,
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
          readVeoGenerationRecord(
            mediaRoot,
            record.episodeId,
            record.shotId,
            record.operationName,
          ),
        ).rejects.toThrow(
          /Veo generation record is not valid JSON/i,
        );
      },
    );

    it(
      "fails closed when the durable generation record identity differs from the requested Veo operation",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const requestedOperationName =
          "models/veo-3.1-fast-generate-preview/operations/durable-veo-123";

        const conflictingRecord = {
          ...createRecord(),

          operationName:
            "models/veo-3.1-fast-generate-preview/operations/different-veo-456",
        };

        const recordPath =
          createVeoGenerationRecordPathFromIdentity(
            mediaRoot,
            "EP91",
            "S01",
            requestedOperationName,
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
          `${JSON.stringify(
            conflictingRecord,
            null,
            2,
          )}\n`,
          "utf8",
        );

        await expect(
          readVeoGenerationRecord(
            mediaRoot,
            "EP91",
            "S01",
            requestedOperationName,
          ),
        ).rejects.toThrow(
          /Veo generation record identity does not match requested execution/i,
        );
      },
    );
  },
);
