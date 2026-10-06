import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  CreateDialogueDirectSeedAudioCompletionResult,
} from "../src/dialogue/createDialogueDirectSeedAudioCompletion.js";

import type {
  DialogueCompletion,
  DialogueCompletionInput,
} from "../src/dialogue/dialogueCompletion.schema.js";

import {
  recoverDialogueDirectSeedAudioCompletion,
} from "../src/dialogue/recoverDialogueDirectSeedAudioCompletion.js";

const PLAN_KEY =
  "a".repeat(
    64,
  );

const GENERATION_RECORD_PATH =
  "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01_RUNWAY_task-seed-audio-recovery-1.dialogue-generation.json";

const COMPLETION_PATH =
  `D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/direct-seed-audio/${PLAN_KEY}/EP02_SC01_S02_L01.dialogue-completion.json`;

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
      PLAN_KEY,

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-seed-audio-recovery-1",

    generationRecordPath:
      GENERATION_RECORD_PATH,
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
      "2026-10-06T18:00:00.000Z",

    status:
      "COMPLETED",

    ...input,

    ...overrides,
  };
}

function createCompletionResult(
  record:
    DialogueCompletion,
): CreateDialogueDirectSeedAudioCompletionResult {
  return {
    record,
    completionPath:
      COMPLETION_PATH,
  };
}

describe(
  "BusyBookie direct SeedAudio plan-scoped completion recovery",
  () => {
    it(
      "creates completion when no plan-scoped durable completion exists",
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
          await recoverDialogueDirectSeedAudioCompletion(
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
          readCompletion,
        ).toHaveBeenCalledWith(
          "D:/Busybookie/Production",
          "EP02",
          "SC01",
          "S02",
          "EP02_SC01_S02_L01",
          PLAN_KEY,
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
      "reuses an exact existing plan-scoped completion and preserves historical completedAt",
      async () => {
        const existing =
          createCompletionRecord({
            completedAt:
              "2026-10-06T17:55:00.000Z",
          });

        const readCompletion =
          vi.fn()
            .mockResolvedValue(
              existing,
            );

        const createCompletion =
          vi.fn();

        const result =
          await recoverDialogueDirectSeedAudioCompletion(
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
          "2026-10-06T17:55:00.000Z",
        );

        expect(
          result.completionPath.replaceAll(
            "\\",
            "/",
          ),
        ).toBe(
          COMPLETION_PATH,
        );

        expect(
          createCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when an existing plan-scoped completion conflicts with recovered execution evidence",
      async () => {
        const conflicting =
          createCompletionRecord({
            providerExecutionId:
              "task-seed-audio-conflict",
          });

        const readCompletion =
          vi.fn()
            .mockResolvedValue(
              conflicting,
            );

        const createCompletion =
          vi.fn();

        await expect(
          recoverDialogueDirectSeedAudioCompletion(
            "D:/Busybookie/Production",
            input,
            {
              readCompletion,
              createCompletion,
            },
          ),
        ).rejects.toThrow(
          /existing direct SeedAudio completion does not match recovered dialogue evidence/i,
        );

        expect(
          createCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "adopts an exact concurrent winner when plan-scoped create-once loses the race",
      async () => {
        const concurrentWinner =
          createCompletionRecord({
            completedAt:
              "2026-10-06T17:56:00.000Z",
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
            "Dialogue direct SeedAudio completion already exists.",
          );

        const createCompletion =
          vi.fn()
            .mockRejectedValue(
              createError,
            );

        const result =
          await recoverDialogueDirectSeedAudioCompletion(
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
          COMPLETION_PATH,
        );

        expect(
          readCompletion,
        ).toHaveBeenCalledTimes(
          2,
        );
      },
    );

    it(
      "fails closed when the concurrent plan-scoped winner conflicts with recovered evidence",
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
                "Dialogue direct SeedAudio completion already exists.",
              ),
            );

        await expect(
          recoverDialogueDirectSeedAudioCompletion(
            "D:/Busybookie/Production",
            input,
            {
              readCompletion,
              createCompletion,
            },
          ),
        ).rejects.toThrow(
          /existing direct SeedAudio completion does not match recovered dialogue evidence/i,
        );
      },
    );

    it(
      "preserves the original create failure when no concurrent plan-scoped winner exists",
      async () => {
        const createError =
          new Error(
            "mock direct SeedAudio completion persistence failure",
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
          recoverDialogueDirectSeedAudioCompletion(
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
