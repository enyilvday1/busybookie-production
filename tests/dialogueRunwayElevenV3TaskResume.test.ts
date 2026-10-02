import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  resumeRunwayElevenV3Task,
  type RunwayElevenV3TaskLookupClient,
} from "../src/dialogue/resumeRunwayElevenV3Task.js";

type MockTaskOptions =
  Readonly<{
    retrievedTaskId?:
      string;

    succeededTaskId?:
      string;

    finalCredits?:
      number;

    providerCreatedAt?:
      string;
  }>;

function createLookupHarness(
  options:
    MockTaskOptions = {},
) {
  const retrievedTaskId =
    options.retrievedTaskId ??
    "task-dialogue-existing-123";

  const succeededTaskId =
    options.succeededTaskId ??
    retrievedTaskId;

  const waitForTaskOutput =
    vi.fn(
      async () => ({
        id:
          succeededTaskId,

        createdAt:
          options.providerCreatedAt ??
          "2026-10-01T15:00:00.000Z",

        status:
          "SUCCEEDED" as const,

        cost: {
          credits:
            options.finalCredits ??
            1,
        },

        output: [
          "https://example.test/resumed-dialogue-output",
        ],
      }),
    );

  const retrievedTask =
    Object.assign(
      Promise.resolve({
        id:
          retrievedTaskId,

        createdAt:
          "2026-10-01T15:00:00.000Z",

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
    RunwayElevenV3TaskLookupClient;

  return {
    client,
    retrieve,
    waitForTaskOutput,
  };
}

const validInput =
  Object.freeze({
    taskId:
      "task-dialogue-existing-123",

    providerEstimatedCredits:
      1,

    waitTimeoutMs:
      600_000,
  });

describe(
  "Busybookie Runway Eleven v3 existing-task resume",
  () => {
    it(
      "retrieves and waits for the durable existing dialogue task without any paid-submission capability",
      async () => {
        const harness =
          createLookupHarness();

        const result =
          await resumeRunwayElevenV3Task(
            harness.client,
            validInput,
          );

        expect(
          harness.retrieve,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.retrieve,
        ).toHaveBeenCalledWith(
          "task-dialogue-existing-123",
          {
            maxRetries:
              0,
          },
        );

        expect(
          harness.waitForTaskOutput,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.waitForTaskOutput,
        ).toHaveBeenCalledWith({
          timeout:
            600_000,
        });

        expect(
          result,
        ).toEqual({
          taskId:
            "task-dialogue-existing-123",

          providerCreatedAt:
            "2026-10-01T15:00:00.000Z",

          estimatedCredits:
            1,

          finalCredits:
            1,

          outputUrls: [
            "https://example.test/resumed-dialogue-output",
          ],
        });
      },
    );

    it(
      "fails closed before waiting when the retrieved task ID differs from the durable task ID",
      async () => {
        const harness =
          createLookupHarness({
            retrievedTaskId:
              "task-dialogue-unexpected-456",
          });

        await expect(
          resumeRunwayElevenV3Task(
            harness.client,
            validInput,
          ),
        ).rejects.toThrow(
          /does not match durable task ID/i,
        );

        expect(
          harness.retrieve,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.waitForTaskOutput,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a blank durable task ID before provider lookup",
      async () => {
        const harness =
          createLookupHarness();

        await expect(
          resumeRunwayElevenV3Task(
            harness.client,
            {
              ...validInput,

              taskId:
                "   ",
            },
          ),
        ).rejects.toThrow(
          /non-empty task ID/i,
        );

        expect(
          harness.retrieve,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ])(
      "rejects invalid durable estimated credits %s before provider lookup",
      async (
        invalidCredits,
      ) => {
        const harness =
          createLookupHarness();

        await expect(
          resumeRunwayElevenV3Task(
            harness.client,
            {
              ...validInput,

              providerEstimatedCredits:
                invalidCredits,
            },
          ),
        ).rejects.toThrow(
          /providerEstimatedCredits.*nonnegative safe integer/i,
        );

        expect(
          harness.retrieve,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ])(
      "rejects invalid wait timeout %s before provider lookup",
      async (
        invalidTimeout,
      ) => {
        const harness =
          createLookupHarness();

        await expect(
          resumeRunwayElevenV3Task(
            harness.client,
            {
              ...validInput,

              waitTimeoutMs:
                invalidTimeout,
            },
          ),
        ).rejects.toThrow(
          /wait timeout.*positive safe integer/i,
        );

        expect(
          harness.retrieve,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when the terminal succeeded task ID differs from the durable task ID",
      async () => {
        const harness =
          createLookupHarness({
            succeededTaskId:
              "task-dialogue-terminal-mismatch-789",
          });

        await expect(
          resumeRunwayElevenV3Task(
            harness.client,
            validInput,
          ),
        ).rejects.toThrow(
          /task id mismatch/i,
        );

        expect(
          harness.retrieve,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.waitForTaskOutput,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "rejects invalid terminal provider credits through shared normalization",
      async () => {
        const harness =
          createLookupHarness({
            finalCredits:
              -1,
          });

        await expect(
          resumeRunwayElevenV3Task(
            harness.client,
            validInput,
          ),
        ).rejects.toThrow(
          /final credits.*nonnegative safe integer/i,
        );
      },
    );

    it(
      "rejects an invalid terminal provider creation timestamp through shared normalization",
      async () => {
        const harness =
          createLookupHarness({
            providerCreatedAt:
              "not-a-timestamp",
          });

        await expect(
          resumeRunwayElevenV3Task(
            harness.client,
            validInput,
          ),
        ).rejects.toThrow(
          /createdAt|timestamp/i,
        );
      },
    );
  },
);
