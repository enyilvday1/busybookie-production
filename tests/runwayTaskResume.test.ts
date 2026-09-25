import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  resumeRunwayGen45Task,
  type RunwayTaskLookupClient,
} from "../src/runway/execution/resumeRunwayGen45Task.js";

describe(
  "Busybookie Runway existing-task resume",
  () => {
    it(
      "retrieves and waits for the durable existing task without any paid-submission capability",
      async () => {
        const waitForTaskOutput =
          vi.fn(
            async () => ({
              id:
                "task-existing-123",

              createdAt:
                "2026-09-25T20:00:00.000Z",

              status:
                "SUCCEEDED" as const,

              cost: {
                credits:
                  55,
              },

              output: [
                "https://example.test/resumed-runway.mp4",
              ],
            }),
          );

        const retrievedTask =
          Object.assign(
            Promise.resolve({
              id:
                "task-existing-123",

              createdAt:
                "2026-09-25T20:00:00.000Z",

              status:
                "RUNNING" as const,

              estimatedCost: {
                credits:
                  999,
              },

              progress:
                0.5,
            }),
            {
              waitForTaskOutput,
            },
          );

        const retrieve =
          vi.fn(
            () =>
              retrievedTask,
          );

        const client = {
          tasks: {
            retrieve,
          },
        } as unknown as
          RunwayTaskLookupClient;

        const result =
          await resumeRunwayGen45Task(
            client,
            {
              taskId:
                "task-existing-123",

              providerEstimatedCredits:
                60,

              waitTimeoutMs:
                600_000,
            },
          );

        expect(
          retrieve,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          retrieve,
        ).toHaveBeenCalledWith(
          "task-existing-123",
          {
            maxRetries:
              0,
          },
        );

        expect(
          waitForTaskOutput,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          waitForTaskOutput,
        ).toHaveBeenCalledWith({
          timeout:
            600_000,
        });

        expect(
          result,
        ).toEqual({
          taskId:
            "task-existing-123",

          estimatedCredits:
            60,

          finalCredits:
            55,

          outputUrls: [
            "https://example.test/resumed-runway.mp4",
          ],
        });
      },
    );
  },
);
