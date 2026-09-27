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
  RunwayGenerationRecord,
} from "../src/runway/audit/runwayGenerationRecord.schema.js";

import {
  readRunwayGenerationRecord,
} from "../src/runway/audit/readRunwayGenerationRecord.js";

import {
  createRunwayGenerationRecordPath,
  writeRunwayGenerationRecord,
} from "../src/runway/audit/writeRunwayGenerationRecord.js";

const temporaryDirectories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-runway-record-read-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

function createRecord():
RunwayGenerationRecord {
  return {
    schemaVersion:
      "1.0",

    recordedAt:
      "2026-09-25T20:10:00.000Z",

    provider:
      "RUNWAY",

    model:
      "gen4.5",

    status:
      "SUCCEEDED",

    episodeId:
      "EP91",

    shotId:
      "S01",

    taskId:
      "task-durable-123",

    request: {
      durationSeconds:
        5,

      ratio:
        "1280:720",

      outputFormat:
        "mp4",

      promptText:
        "Busybookie Runway recovery audit test.",

      sourceImagePath:
        "D:/Busybookie/Production/references/EP91/S01/reference.png",

      assetStrategy:
        "DATA_URI",
    },

    credits: {
      locallyExpected:
        60,

      providerEstimated:
        60,

      providerFinal:
        55,
    },

    outputs: [
      {
        outputIndex:
          1,

        destinationPath:
          "D:/Busybookie/Production/generated-video/EP91/S01/EP91_S01_task-durable-123_01.mp4",

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
  "Busybookie Runway generation record reader",
  () => {
    it(
      "returns null when no durable generation record exists",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          readRunwayGenerationRecord(
            mediaRoot,
            "EP91",
            "S01",
            "task-durable-123",
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "reads and validates the durable generation record for the exact Runway task identity",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const record =
          createRecord();

        await writeRunwayGenerationRecord(
          mediaRoot,
          record,
        );

        await expect(
          readRunwayGenerationRecord(
            mediaRoot,
            "EP91",
            "S01",
            "task-durable-123",
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
          createRunwayGenerationRecordPath(
            mediaRoot,
            record,
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
          readRunwayGenerationRecord(
            mediaRoot,
            "EP91",
            "S01",
            "task-durable-123",
          ),
        ).rejects.toThrow(
          /Runway generation record is not valid JSON/i,
        );
      },
    );
  },
);
