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

import type {
  VeoGenerationRecord,
} from "../src/veo/audit/veoGenerationRecord.schema.js";

import {
  writeVeoGenerationRecord,
} from "../src/veo/audit/writeVeoGenerationRecord.js";

const directories:
  string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
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
});

describe(
  "Busybookie Veo generation audit",
  () => {
    it(
      "refuses to overwrite an existing Veo generation record",
      async () => {
        const mediaRoot =
          await mkdtemp(
            join(
              tmpdir(),
              "busybookie-veo-audit-",
            ),
          );

        directories.push(
          mediaRoot,
        );

        const record:
          VeoGenerationRecord = {
            schemaVersion:
              "1.0",

            recordedAt:
              "2026-09-22T19:00:00.000Z",

            provider:
              "VEO",

            model:
              "veo-3.1-fast-generate-preview",

            status:
              "SUCCEEDED",

            episodeId:
              "EP90",

            shotId:
              "S01",

            operationName:
              "operations/test-123",

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
                "Test prompt.",

              sourceImagePath:
                "D:/reference.png",

              imageMimeType:
                "image/png",
            },

            costPolicy: {
              pricingReviewedOn:
                "2026-09-22",

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

        await writeVeoGenerationRecord(
          mediaRoot,
          record,
        );

        await expect(
          writeVeoGenerationRecord(
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
