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
  buildRunwayGenerationRecord,
  type BuildRunwayGenerationRecordInput,
} from "../src/runway/audit/buildRunwayGenerationRecord.js";

import {
  readRunwayGenerationRecord,
} from "../src/runway/audit/readRunwayGenerationRecord.js";

import {
  recoverRunwayGenerationRecord,
} from "../src/runway/audit/recoverRunwayGenerationRecord.js";

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
        "busybookie-runway-record-recovery-",
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
): BuildRunwayGenerationRecordInput {
  return {
    recordedAt,

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
        "Busybookie Runway generation record recovery test.",

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
  "Busybookie Runway generation record recovery",
  () => {
    it(
      "creates the canonical generation record when no durable record exists",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const input =
          createInput(
            "2026-09-25T20:10:00.000Z",
          );

        const result =
          await recoverRunwayGenerationRecord(
            mediaRoot,
            input,
          );

        const expected =
          buildRunwayGenerationRecord(
            input,
          );

        expect(
          result.record,
        ).toEqual(
          expected,
        );

        await expect(
          readRunwayGenerationRecord(
            mediaRoot,
            "EP91",
            "S01",
            "task-durable-123",
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
          buildRunwayGenerationRecord(
            createInput(
              "2026-09-25T20:10:00.000Z",
            ),
          );

        const existingPath =
          await writeRunwayGenerationRecord(
            mediaRoot,
            existing,
          );

        const result =
          await recoverRunwayGenerationRecord(
            mediaRoot,
            createInput(
              "2026-09-25T20:20:00.000Z",
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
            "2026-09-25T20:20:00.000Z",
          );

        const winner =
          buildRunwayGenerationRecord(
            createInput(
              "2026-09-25T20:10:00.000Z",
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
          recoverRunwayGenerationRecord(
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
            createRunwayGenerationRecordPath(
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
            "2026-09-25T20:20:00.000Z",
          );

        const conflictingWinner =
          buildRunwayGenerationRecord({
            ...createInput(
              "2026-09-25T20:10:00.000Z",
            ),

            credits: {
              locallyExpected:
                60,

              providerEstimated:
                60,

              providerFinal:
                54,
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
          recoverRunwayGenerationRecord(
            mediaRoot,
            input,
            {
              readGenerationRecord,
              writeGenerationRecord,
            },
          ),
        ).rejects.toThrow(
          /existing Runway generation record does not match recovered execution evidence/i,
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
            "2026-09-25T20:20:00.000Z",
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
          recoverRunwayGenerationRecord(
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

        const expectedInput =
          createInput(
            "2026-09-25T20:20:00.000Z",
          );

        const conflicting =
          buildRunwayGenerationRecord({
            ...createInput(
              "2026-09-25T20:10:00.000Z",
            ),

            credits: {
              locallyExpected:
                60,

              providerEstimated:
                60,

              providerFinal:
                54,
            },
          });

        await writeRunwayGenerationRecord(
          mediaRoot,
          conflicting,
        );

        await expect(
          recoverRunwayGenerationRecord(
            mediaRoot,
            expectedInput,
          ),
        ).rejects.toThrow(
          /existing Runway generation record does not match recovered execution evidence/i,
        );

        await expect(
          readRunwayGenerationRecord(
            mediaRoot,
            "EP91",
            "S01",
            "task-durable-123",
          ),
        ).resolves.toEqual(
          conflicting,
        );
      },
    );
  },
);
