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

type MockTaskOptions =
  Readonly<{
    retrievedTaskId?: string;
    succeededTaskId?: string;
  }>;

function createLookupHarness(
  options:
    MockTaskOptions = {},
) {
  const retrievedTaskId =
    options.retrievedTaskId ??
    "task-existing-123";

  const succeededTaskId =
    options.succeededTaskId ??
    retrievedTaskId;

  const waitForTaskOutput =
    vi.fn(
      async () => ({
        id:
          succeededTaskId,

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
          retrievedTaskId,

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

  return {
    client,
    retrieve,
    waitForTaskOutput,
  };
}

const validInput =
  Object.freeze({
    taskId:
      "task-existing-123",

    providerEstimatedCredits:
      60,

    waitTimeoutMs:
      600_000,
  });

describe(
  "Busybookie Runway existing-task resume fail-closed coverage",
  () => {
    it(
      "fails closed before waiting when the retrieved task ID differs from the durable task ID",
      async () => {
        const harness =
          createLookupHarness({
            retrievedTaskId:
              "task-unexpected-456",
          });

        await expect(
          resumeRunwayGen45Task(
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
          resumeRunwayGen45Task(
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

    it(
      "rejects invalid durable estimated credits before provider lookup",
      async () => {
        const harness =
          createLookupHarness();

        await expect(
          resumeRunwayGen45Task(
            harness.client,
            {
              ...validInput,

              providerEstimatedCredits:
                -1,
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

    it(
      "rejects an invalid wait timeout before provider lookup",
      async () => {
        const harness =
          createLookupHarness();

        await expect(
          resumeRunwayGen45Task(
            harness.client,
            {
              ...validInput,

              waitTimeoutMs:
                0,
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
              "task-terminal-mismatch-789",
          });

        await expect(
          resumeRunwayGen45Task(
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
  },
);
