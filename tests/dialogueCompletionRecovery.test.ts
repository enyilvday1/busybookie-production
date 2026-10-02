import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  CreateDialogueCompletionResult,
} from "../src/dialogue/createDialogueCompletion.js";

import type {
  DialogueCompletion,
  DialogueCompletionInput,
} from "../src/dialogue/dialogueCompletion.schema.js";

import {
  recoverDialogueCompletion,
} from "../src/dialogue/recoverDialogueCompletion.js";

const generationRecordPath =
  "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01_RUNWAY_task-dialogue-123.dialogue-generation.json";

const completionPath =
  "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01.dialogue-completion.json";

const input:
  DialogueCompletionInput = {
    reservationId:
      "11111111-1111-4111-8111-111111111111",

    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    dialogueLineId:
      "EP02_SC01_S02_L01",

    planKey:
      "a".repeat(
        64,
      ),

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-dialogue-123",

    generationRecordPath,
  };

function createCompletionRecord(
  overrides:
    Partial<
      DialogueCompletion
    > = {},
): DialogueCompletion {
  return {
    schemaVersion:
      "1.0",

    completedAt:
      "2026-10-01T22:20:00.000Z",

    status:
      "COMPLETED",

    ...input,

    ...overrides,
  };
}

function createCompletionResult(
  record:
    DialogueCompletion,
): CreateDialogueCompletionResult {
  return {
    record,
    completionPath,
  };
}

describe(
  "Busybookie dialogue completion recovery",
  () => {
    it(
      "creates completion when no durable completion exists",
      async () => {
        const created =
          createCompletionResult(
            createCompletionRecord(),
          );

        const readCompletion =
          vi.fn()
            .mockResolvedValue(
              null,
            );

        const createCompletion =
          vi.fn()
            .mockResolvedValue(
              created,
            );

        const result =
          await recoverDialogueCompletion(
            "D:/Busybookie/Production",
            input,
            {
              readCompletion,
              createCompletion,
            },
          );

        expect(
          result,
        ).toEqual(
          created,
        );

        expect(
          readCompletion,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createCompletion,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createCompletion,
        ).toHaveBeenCalledWith(
          "D:/Busybookie/Production",
          input,
        );
      },
    );

    it(
      "reuses an exact existing completion and preserves its historical completedAt",
      async () => {
        const existing =
          createCompletionRecord({
            completedAt:
              "2026-10-01T22:10:00.000Z",
          });

        const readCompletion =
          vi.fn()
            .mockResolvedValue(
              existing,
            );

        const createCompletion =
          vi.fn();

        const result =
          await recoverDialogueCompletion(
            "D:/Busybookie/Production",
            input,
            {
              readCompletion,
              createCompletion,
            },
          );

        expect(
          result.record,
        ).toEqual(
          existing,
        );

        expect(
          result.record.completedAt,
        ).toBe(
          "2026-10-01T22:10:00.000Z",
        );

        expect(
          result.completionPath.replaceAll(
            "\\",
            "/",
          ),
        ).toBe(
          completionPath,
        );

        expect(
          createCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when an existing completion conflicts with recovered execution evidence",
      async () => {
        const conflicting =
          createCompletionRecord({
            providerExecutionId:
              "task-dialogue-conflict",
          });

        const readCompletion =
          vi.fn()
            .mockResolvedValue(
              conflicting,
            );

        const createCompletion =
          vi.fn();

        await expect(
          recoverDialogueCompletion(
            "D:/Busybookie/Production",
            input,
            {
              readCompletion,
              createCompletion,
            },
          ),
        ).rejects.toThrow(
          /existing dialogue completion does not match recovered dialogue evidence/i,
        );

        expect(
          createCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "adopts an exact concurrent winner when create-once loses the race",
      async () => {
        const concurrentWinner =
          createCompletionRecord({
            completedAt:
              "2026-10-01T22:11:00.000Z",
          });

        const readCompletion =
          vi.fn()
            .mockResolvedValueOnce(
              null,
            )
            .mockResolvedValueOnce(
              concurrentWinner,
            );

        const createError =
          new Error(
            "Dialogue completion already exists.",
          );

        const createCompletion =
          vi.fn()
            .mockRejectedValue(
              createError,
            );

        const result =
          await recoverDialogueCompletion(
            "D:/Busybookie/Production",
            input,
            {
              readCompletion,
              createCompletion,
            },
          );

        expect(
          result.record,
        ).toEqual(
          concurrentWinner,
        );

        expect(
          result.completionPath.replaceAll(
            "\\",
            "/",
          ),
        ).toBe(
          completionPath,
        );

        expect(
          readCompletion,
        ).toHaveBeenCalledTimes(
          2,
        );
      },
    );

    it(
      "fails closed when the concurrent winner conflicts with recovered evidence",
      async () => {
        const concurrentWinner =
          createCompletionRecord({
            planKey:
              "b".repeat(
                64,
              ),
          });

        const readCompletion =
          vi.fn()
            .mockResolvedValueOnce(
              null,
            )
            .mockResolvedValueOnce(
              concurrentWinner,
            );

        const createCompletion =
          vi.fn()
            .mockRejectedValue(
              new Error(
                "Dialogue completion already exists.",
              ),
            );

        await expect(
          recoverDialogueCompletion(
            "D:/Busybookie/Production",
            input,
            {
              readCompletion,
              createCompletion,
            },
          ),
        ).rejects.toThrow(
          /existing dialogue completion does not match recovered dialogue evidence/i,
        );
      },
    );

    it(
      "preserves the original create failure when no concurrent winner exists",
      async () => {
        const createError =
          new Error(
            "mock dialogue completion persistence failure",
          );

        const readCompletion =
          vi.fn()
            .mockResolvedValueOnce(
              null,
            )
            .mockResolvedValueOnce(
              null,
            );

        const createCompletion =
          vi.fn()
            .mockRejectedValue(
              createError,
            );

        await expect(
          recoverDialogueCompletion(
            "D:/Busybookie/Production",
            input,
            {
              readCompletion,
              createCompletion,
            },
          ),
        ).rejects.toBe(
          createError,
        );

        expect(
          readCompletion,
        ).toHaveBeenCalledTimes(
          2,
        );
      },
    );
  },
);
