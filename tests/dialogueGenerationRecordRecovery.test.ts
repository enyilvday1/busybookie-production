import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  DialogueGenerationRecord,
} from "../src/dialogue/dialogueGenerationRecord.schema.js";

import {
  recoverDialogueGenerationRecord,
} from "../src/dialogue/recoverDialogueGenerationRecord.js";

const mediaRoot =
  "D:/Busybookie/Production";

const recordPath =
  "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01_RUNWAY_task-dialogue-123.dialogue-generation.json";

function createRecord(
  overrides:
    Partial<
      DialogueGenerationRecord
    > = {},
): DialogueGenerationRecord {
  return {
    schemaVersion:
      "1.0",

    recordedAt:
      "2026-10-01T22:50:00.000Z",

    status:
      "SUCCEEDED",

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-dialogue-123",

    providerModel:
      "eleven_v3",

    providerCreatedAt:
      "2026-10-01T22:49:00.000Z",

    request: {
      model:
        "eleven_v3",

      promptText:
        "Look what I found!",

      voice: {
        type:
          "runway-preset",

        presetId:
          "Chad",
      },

      applyTextNormalization:
        "auto",

      languageCode:
        "en",

      seed:
        0,

      similarityBoost:
        0.75,

      speed:
        1,

      stability:
        0.5,

      style:
        0,

      useSpeakerBoost:
        true,
    },

    credits: {
      locallyExpected:
        1,

      providerEstimated:
        1,

      providerFinal:
        1,
    },

    plan: {
      planKey:
        "a".repeat(
          64,
        ),

      episodeId:
        "EP02",

      sceneId:
        "SC01",

      shotId:
        "S02",

      dialogueLineId:
        "EP02_SC01_S02_L01",

      lineNumber:
        1,

      characterId:
        "OLLIE",

      characterName:
        "Ollie",

      text:
        "Look what I found!",

      deliveryNotes:
        "Curious, excited and gentle.",

      voice: {
        provider:
          "RUNWAY",

        voiceName:
          "Chad",

        deliveryTraits: [
          "young",
          "curious",
          "warm",
          "friendly",
          "natural",
        ],
      },
    },

    outputs: [
      {
        outputIndex:
          1,

        destinationPath:
          "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01_RUNWAY_task-dialogue-123_01.audio",

        bytes:
          123,

        sha256:
          "b".repeat(
            64,
          ),

        contentType:
          "audio/mpeg",
      },
    ],

    ...overrides,
  };
}

describe(
  "Busybookie dialogue generation-record recovery",
  () => {
    it(
      "writes the recovered record when none exists",
      async () => {
        const expected =
          createRecord();

        const readGenerationRecord =
          vi.fn()
            .mockResolvedValue(
              null,
            );

        const writeGenerationRecord =
          vi.fn()
            .mockResolvedValue(
              recordPath,
            );

        const result =
          await recoverDialogueGenerationRecord(
            mediaRoot,
            expected,
            {
              readGenerationRecord,
              writeGenerationRecord,
            },
          );

        expect(
          writeGenerationRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          writeGenerationRecord,
        ).toHaveBeenCalledWith(
          mediaRoot,
          expected,
        );

        expect(
          result,
        ).toEqual({
          record:
            expected,

          recordPath,
        });
      },
    );

    it(
      "reuses exact durable evidence while preserving historical recordedAt",
      async () => {
        const expected =
          createRecord();

        const existing =
          createRecord({
            recordedAt:
              "2026-10-01T22:45:00.000Z",
          });

        const readGenerationRecord =
          vi.fn()
            .mockResolvedValue(
              existing,
            );

        const writeGenerationRecord =
          vi.fn();

        const result =
          await recoverDialogueGenerationRecord(
            mediaRoot,
            expected,
            {
              readGenerationRecord,
              writeGenerationRecord,
            },
          );

        expect(
          result.record,
        ).toEqual(
          existing,
        );

        expect(
          result.record.recordedAt,
        ).toBe(
          "2026-10-01T22:45:00.000Z",
        );

        expect(
          result.recordPath
            .replaceAll(
              "\\",
              "/",
            ),
        ).toBe(
          recordPath,
        );

        expect(
          writeGenerationRecord,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when existing durable generation evidence conflicts",
      async () => {
        const expected =
          createRecord();

        const conflicting =
          createRecord({
            credits: {
              locallyExpected:
                1,

              providerEstimated:
                1,

              providerFinal:
                2,
            },
          });

        const readGenerationRecord =
          vi.fn()
            .mockResolvedValue(
              conflicting,
            );

        const writeGenerationRecord =
          vi.fn();

        await expect(
          recoverDialogueGenerationRecord(
            mediaRoot,
            expected,
            {
              readGenerationRecord,
              writeGenerationRecord,
            },
          ),
        ).rejects.toThrow(
          /existing dialogue generation record does not match recovered execution evidence/i,
        );

        expect(
          writeGenerationRecord,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "adopts an exact concurrent winner when the exclusive write loses the race",
      async () => {
        const expected =
          createRecord();

        const concurrentWinner =
          createRecord({
            recordedAt:
              "2026-10-01T22:46:00.000Z",
          });

        const readGenerationRecord =
          vi.fn()
            .mockResolvedValueOnce(
              null,
            )
            .mockResolvedValueOnce(
              concurrentWinner,
            );

        const writeGenerationRecord =
          vi.fn()
            .mockRejectedValue(
              new Error(
                "Dialogue generation record already exists.",
              ),
            );

        const result =
          await recoverDialogueGenerationRecord(
            mediaRoot,
            expected,
            {
              readGenerationRecord,
              writeGenerationRecord,
            },
          );

        expect(
          result.record,
        ).toEqual(
          concurrentWinner,
        );

        expect(
          result.recordPath
            .replaceAll(
              "\\",
              "/",
            ),
        ).toBe(
          recordPath,
        );

        expect(
          readGenerationRecord,
        ).toHaveBeenCalledTimes(
          2,
        );
      },
    );

    it(
      "fails closed when a concurrent winner conflicts with recovered evidence",
      async () => {
        const expected =
          createRecord();

        const conflictingWinner =
          createRecord({
            providerExecutionId:
              "task-dialogue-conflict",
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
          vi.fn()
            .mockRejectedValue(
              new Error(
                "Dialogue generation record already exists.",
              ),
            );

        await expect(
          recoverDialogueGenerationRecord(
            mediaRoot,
            expected,
            {
              readGenerationRecord,
              writeGenerationRecord,
            },
          ),
        ).rejects.toThrow(
          /existing dialogue generation record does not match recovered execution evidence/i,
        );
      },
    );

    it(
      "preserves the original write failure when no concurrent winner exists",
      async () => {
        const expected =
          createRecord();

        const writeError =
          new Error(
            "mock generation-record write failure",
          );

        const readGenerationRecord =
          vi.fn()
            .mockResolvedValueOnce(
              null,
            )
            .mockResolvedValueOnce(
              null,
            );

        const writeGenerationRecord =
          vi.fn()
            .mockRejectedValue(
              writeError,
            );

        await expect(
          recoverDialogueGenerationRecord(
            mediaRoot,
            expected,
            {
              readGenerationRecord,
              writeGenerationRecord,
            },
          ),
        ).rejects.toBe(
          writeError,
        );

        expect(
          readGenerationRecord,
        ).toHaveBeenCalledTimes(
          2,
        );
      },
    );
  },
);
