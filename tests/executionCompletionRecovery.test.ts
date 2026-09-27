import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  ExecutionCompletion,
  ExecutionCompletionInput,
} from "../src/execution/executionCompletion.schema.js";

import {
  createExecutionCompletionPath,
} from "../src/execution/executionCompletionPath.js";

import {
  recoverExecutionCompletion,
} from "../src/execution/recoverExecutionCompletion.js";

const mediaRoot =
  "D:/Busybookie/Production";

const generationRecordPath =
  "D:/Busybookie/Production/generated-video/EP91/S01/EP91_S01_task-durable-123.runway-generation.json";

const input:
  ExecutionCompletionInput =
  Object.freeze({
    reservationId:
      "11111111-1111-4111-8111-111111111111",

    episodeId:
      "EP91",

    shotId:
      "S01",

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-durable-123",

    generationRecordPath,
  });

function createCompletionRecord(
  completedAt:
    string,
): ExecutionCompletion {
  return Object.freeze({
    schemaVersion:
      "1.0",

    completedAt,

    status:
      "COMPLETED",

    reservationId:
      input.reservationId,

    episodeId:
      input.episodeId,

    shotId:
      input.shotId,

    provider:
      input.provider,

    providerExecutionId:
      input.providerExecutionId,

    generationRecordPath:
      input.generationRecordPath,
  });
}

describe(
  "Busybookie execution completion recovery",
  () => {
    it(
      "creates the completion when no durable completion exists",
      async () => {
        const record =
          createCompletionRecord(
            "2026-09-25T20:40:00.000Z",
          );

        const completionPath =
          createExecutionCompletionPath(
            mediaRoot,
            input.episodeId,
            input.shotId,
          );

        const readCompletion =
          vi.fn(
            async () =>
              null,
          );

        const createCompletion =
          vi.fn(
            async () =>
              Object.freeze({
                record,
                completionPath,
              }),
          );

        await expect(
          recoverExecutionCompletion(
            mediaRoot,
            input,
            {
              readCompletion,
              createCompletion,
            },
          ),
        ).resolves.toEqual({
          record,
          completionPath,
        });

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
          mediaRoot,
          input,
        );
      },
    );

    it(
      "reuses an exact existing completion while preserving its historical completedAt",
      async () => {
        const existing =
          createCompletionRecord(
            "2026-09-25T20:35:00.000Z",
          );

        const completionPath =
          createExecutionCompletionPath(
            mediaRoot,
            input.episodeId,
            input.shotId,
          );

        const readCompletion =
          vi.fn(
            async () =>
              existing,
          );

        const createCompletion =
          vi.fn();

        await expect(
          recoverExecutionCompletion(
            mediaRoot,
            input,
            {
              readCompletion,
              createCompletion,
            },
          ),
        ).resolves.toEqual({
          record:
            existing,

          completionPath,
        });

        expect(
          createCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when an existing completion conflicts with recovered execution evidence",
      async () => {
        const conflicting =
          Object.freeze({
            ...createCompletionRecord(
              "2026-09-25T20:35:00.000Z",
            ),

            generationRecordPath:
              "D:/Busybookie/Production/generated-video/EP91/S01/conflicting.runway-generation.json",
          });

        const readCompletion =
          vi.fn(
            async () =>
              conflicting,
          );

        const createCompletion =
          vi.fn();

        await expect(
          recoverExecutionCompletion(
            mediaRoot,
            input,
            {
              readCompletion,
              createCompletion,
            },
          ),
        ).rejects.toThrow(
          /existing execution completion does not match recovered execution evidence/i,
        );

        expect(
          createCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "reuses a matching concurrent winner when the create-once completion write loses the race",
      async () => {
        const winner =
          createCompletionRecord(
            "2026-09-25T20:35:00.000Z",
          );

        const readCompletion =
          vi.fn()
            .mockResolvedValueOnce(
              null,
            )
            .mockResolvedValueOnce(
              winner,
            );

        const createCompletion =
          vi.fn(
            async () => {
              throw new Error(
                "simulated completion create race",
              );
            },
          );

        await expect(
          recoverExecutionCompletion(
            mediaRoot,
            input,
            {
              readCompletion,
              createCompletion,
            },
          ),
        ).resolves.toEqual({
          record:
            winner,

          completionPath:
            createExecutionCompletionPath(
              mediaRoot,
              input.episodeId,
              input.shotId,
            ),
        });

        expect(
          readCompletion,
        ).toHaveBeenCalledTimes(
          2,
        );

        expect(
          createCompletion,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "fails closed when a conflicting concurrent completion winner appears",
      async () => {
        const conflictingWinner =
          Object.freeze({
            ...createCompletionRecord(
              "2026-09-25T20:35:00.000Z",
            ),

            providerExecutionId:
              "task-other-999",
          });

        const readCompletion =
          vi.fn()
            .mockResolvedValueOnce(
              null,
            )
            .mockResolvedValueOnce(
              conflictingWinner,
            );

        const createCompletion =
          vi.fn(
            async () => {
              throw new Error(
                "simulated completion create race",
              );
            },
          );

        await expect(
          recoverExecutionCompletion(
            mediaRoot,
            input,
            {
              readCompletion,
              createCompletion,
            },
          ),
        ).rejects.toThrow(
          /existing execution completion does not match recovered execution evidence/i,
        );

        expect(
          readCompletion,
        ).toHaveBeenCalledTimes(
          2,
        );

        expect(
          createCompletion,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "preserves the original completion create failure when no concurrent durable winner exists",
      async () => {
        const originalError =
          new Error(
            "simulated completion write failure",
          );

        const readCompletion =
          vi.fn()
            .mockResolvedValue(
              null,
            );

        const createCompletion =
          vi.fn(
            async () => {
              throw originalError;
            },
          );

        await expect(
          recoverExecutionCompletion(
            mediaRoot,
            input,
            {
              readCompletion,
              createCompletion,
            },
          ),
        ).rejects.toBe(
          originalError,
        );

        expect(
          readCompletion,
        ).toHaveBeenCalledTimes(
          2,
        );

        expect(
          createCompletion,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);
