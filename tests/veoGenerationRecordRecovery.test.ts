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
  vi,
} from "vitest";

import {
  buildVeoGenerationRecord,
  type BuildVeoGenerationRecordInput,
} from "../src/veo/audit/buildVeoGenerationRecord.js";

import {
  readVeoGenerationRecord,
} from "../src/veo/audit/readVeoGenerationRecord.js";

import {
  recoverVeoGenerationRecord,
} from "../src/veo/audit/recoverVeoGenerationRecord.js";

import {
  createVeoGenerationRecordPath,
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
        "busybookie-veo-record-recovery-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

function createInput(
  recordedAt:
    string,
): BuildVeoGenerationRecordInput {
  return {
    recordedAt,

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
        "Busybookie Veo generation record recovery test.",

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
  "Busybookie Veo generation record recovery",
  () => {
    it(
      "creates the canonical generation record when no durable record exists",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const input =
          createInput(
            "2026-09-27T20:40:00.000Z",
          );

        const result =
          await recoverVeoGenerationRecord(
            mediaRoot,
            input,
          );

        const expected =
          buildVeoGenerationRecord(
            input,
          );

        expect(
          result.record,
        ).toEqual(
          expected,
        );

        await expect(
          readVeoGenerationRecord(
            mediaRoot,
            "EP91",
            "S01",
            input.operationName,
          ),
        ).resolves.toEqual(
          expected,
        );
      },
    );

    it(
      "reuses a substantively identical existing generation record while preserving its historical recordedAt",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const existing =
          buildVeoGenerationRecord(
            createInput(
              "2026-09-27T20:40:00.000Z",
            ),
          );

        const existingPath =
          await writeVeoGenerationRecord(
            mediaRoot,
            existing,
          );

        const result =
          await recoverVeoGenerationRecord(
            mediaRoot,
            createInput(
              "2026-09-27T20:50:00.000Z",
            ),
          );

        expect(
          result,
        ).toEqual({
          record:
            existing,

          recordPath:
            existingPath,
        });
      },
    );

    it(
      "reuses a matching concurrent winner when the create-once write loses the race",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const input =
          createInput(
            "2026-09-27T20:50:00.000Z",
          );

        const winner =
          buildVeoGenerationRecord(
            createInput(
              "2026-09-27T20:40:00.000Z",
            ),
          );

        const readGenerationRecord =
          vi.fn()
            .mockResolvedValueOnce(
              null,
            )
            .mockResolvedValueOnce(
              winner,
            );

        const writeGenerationRecord =
          vi.fn(
            async () => {
              throw new Error(
                "simulated create-once race",
              );
            },
          );

        await expect(
          recoverVeoGenerationRecord(
            mediaRoot,
            input,
            {
              readGenerationRecord,
              writeGenerationRecord,
            },
          ),
        ).resolves.toEqual({
          record:
            winner,

          recordPath:
            createVeoGenerationRecordPath(
              mediaRoot,
              winner,
            ),
        });

        expect(
          readGenerationRecord,
        ).toHaveBeenCalledTimes(
          2,
        );

        expect(
          writeGenerationRecord,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "fails closed when a conflicting concurrent winner appears after the create-once write loses the race",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const input =
          createInput(
            "2026-09-27T20:50:00.000Z",
          );

        const conflictingWinner =
          buildVeoGenerationRecord({
            ...createInput(
              "2026-09-27T20:40:00.000Z",
            ),

            safety: {
              raiMediaFilteredCount:
                1,

              raiMediaFilteredReasons:
                [
                  "different durable evidence",
                ],
            },
          });

        const readGenerationRecord =
          vi.fn()
            .mockResolvedValueOnce(
              null,
            )
            .mockResolvedValueOnce(
              conflictingWinner,
            );

        const writeGenerationRecord =
          vi.fn(
            async () => {
              throw new Error(
                "simulated create-once race",
              );
            },
          );

        await expect(
          recoverVeoGenerationRecord(
            mediaRoot,
            input,
            {
              readGenerationRecord,
              writeGenerationRecord,
            },
          ),
        ).rejects.toThrow(
          /existing Veo generation record does not match recovered execution evidence/i,
        );

        expect(
          readGenerationRecord,
        ).toHaveBeenCalledTimes(
          2,
        );

        expect(
          writeGenerationRecord,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "preserves the original write failure when no concurrent durable winner exists",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const input =
          createInput(
            "2026-09-27T20:50:00.000Z",
          );

        const originalError =
          new Error(
            "simulated write failure",
          );

        const readGenerationRecord =
          vi.fn()
            .mockResolvedValue(
              null,
            );

        const writeGenerationRecord =
          vi.fn(
            async () => {
              throw originalError;
            },
          );

        await expect(
          recoverVeoGenerationRecord(
            mediaRoot,
            input,
            {
              readGenerationRecord,
              writeGenerationRecord,
            },
          ),
        ).rejects.toBe(
          originalError,
        );

        expect(
          readGenerationRecord,
        ).toHaveBeenCalledTimes(
          2,
        );

        expect(
          writeGenerationRecord,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "fails closed when an existing generation record conflicts with recovered execution evidence",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const conflicting =
          buildVeoGenerationRecord({
            ...createInput(
              "2026-09-27T20:40:00.000Z",
            ),

            costPolicy: {
              pricingReviewedOn:
                "2026-09-27",

              centsPerSecond:
                10,

              locallyExpectedCents:
                41,
            },
          });

        await writeVeoGenerationRecord(
          mediaRoot,
          conflicting,
        );

        await expect(
          recoverVeoGenerationRecord(
            mediaRoot,
            createInput(
              "2026-09-27T20:50:00.000Z",
            ),
          ),
        ).rejects.toThrow(
          /existing Veo generation record does not match recovered execution evidence/i,
        );
      },
    );
  },
);
