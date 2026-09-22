import {
  mkdtemp,
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

import {
  type RunwayGenerationRecord,
} from "../src/runway/audit/runwayGenerationRecord.schema.js";

import {
  writeRunwayGenerationRecord,
} from "../src/runway/audit/writeRunwayGenerationRecord.js";

const temporaryDirectories:
  string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(
        (directory) =>
          rm(
            directory,
            {
              recursive: true,
              force: true,
            },
          ),
      ),
  );
});

describe(
  "Busybookie Runway generation audit",
  () => {
    it(
      "refuses to overwrite an existing generation record",
      async () => {
        const mediaRoot =
          await mkdtemp(
            join(
              tmpdir(),
              "busybookie-audit-",
            ),
          );

        temporaryDirectories.push(
          mediaRoot,
        );

        const record:
          RunwayGenerationRecord = {
            schemaVersion:
              "1.0",

            recordedAt:
              "2026-09-22T16:30:00.000Z",

            provider:
              "RUNWAY",

            model:
              "gen4.5",

            status:
              "SUCCEEDED",

            episodeId:
              "EP02",

            shotId:
              "S01",

            taskId:
              "task-123",

            request: {
              durationSeconds:
                5,

              ratio:
                "1280:720",

              outputFormat:
                "mp4",

              promptText:
                "Test prompt.",

              sourceImagePath:
                "D:/reference.png",

              assetStrategy:
                "DATA_URI",
            },

            credits: {
              locallyExpected:
                60,

              providerEstimated:
                60,

              providerFinal:
                60,
            },

            outputs: [
              {
                outputIndex:
                  1,

                destinationPath:
                  "D:/output.mp4",

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

        await writeRunwayGenerationRecord(
          mediaRoot,
          record,
        );

        await expect(
          writeRunwayGenerationRecord(
            mediaRoot,
            record,
          ),
        ).rejects.toThrow(
          /already exists/,
        );
      },
    );
  },
);
