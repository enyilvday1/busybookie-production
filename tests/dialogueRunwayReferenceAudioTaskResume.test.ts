import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  resumeRunwayReferenceAudioTask,
  type RunwayReferenceAudioTaskLookupClient,
} from "../src/dialogue/resumeRunwayReferenceAudioTask.js";

const DEFAULT_TASK_ID =
  "task-reference-audio-123";

function createLookupHarness(
  options:
    Readonly<{
      retrievedTaskId?: string;
      terminalResult?: unknown;
    }> = {},
) {
  const terminalResult =
    options.terminalResult ??
    {
      id:
        DEFAULT_TASK_ID,

      createdAt:
        "2026-10-05T13:00:00.000Z",

      status:
        "SUCCEEDED" as const,

      cost: {
        credits:
          1.75,
      },

      output: [
        "https://example.test/reference-audio-output.mp3",
      ],
    };

  const waitForTaskOutput =
    vi.fn(
      async () =>
        terminalResult,
    );

  const retrievedTask =
    Object.assign(
      Promise.resolve({
        id:
          options.retrievedTaskId ??
          DEFAULT_TASK_ID,
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

  const client =
    {
      tasks: {
        retrieve,
      },
    } as unknown as
      RunwayReferenceAudioTaskLookupClient;

  return {
    client,
    retrieve,
    waitForTaskOutput,
  };
}

function defaultInput() {
  return {
    taskId:
      DEFAULT_TASK_ID,

    providerEstimatedCredits:
      2.5,

    waitTimeoutMs:
      600_000,
  };
}

describe(
  "Busybookie Runway reference-audio task recovery",
  () => {
    it(
      "recovers the already-submitted durable task using lookup only and preserves fractional provider credits",
      async () => {
        const {
          client,
          retrieve,
          waitForTaskOutput,
        } =
          createLookupHarness();

        const result =
          await resumeRunwayReferenceAudioTask(
            client,
            defaultInput(),
          );

        expect(
          retrieve,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          retrieve,
        ).toHaveBeenCalledWith(
          DEFAULT_TASK_ID,
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
            DEFAULT_TASK_ID,

          providerCreatedAt:
            "2026-10-05T13:00:00.000Z",

          estimatedCredits:
            2.5,

          finalCredits:
            1.75,

          outputUrls: [
            "https://example.test/reference-audio-output.mp3",
          ],
        });
      },
    );

    it(
      "rejects an empty durable task ID before provider lookup",
      async () => {
        const {
          client,
          retrieve,
        } =
          createLookupHarness();

        await expect(
          resumeRunwayReferenceAudioTask(
            client,
            {
              ...defaultInput(),

              taskId:
                "   ",
            },
          ),
        ).rejects.toThrow(
          "Runway reference-audio durable task ID must be non-empty.",
        );

        expect(
          retrieve,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ])(
      "rejects invalid estimated provider credits %s before provider lookup",
      async (
        providerEstimatedCredits,
      ) => {
        const {
          client,
          retrieve,
        } =
          createLookupHarness();

        await expect(
          resumeRunwayReferenceAudioTask(
            client,
            {
              ...defaultInput(),

              providerEstimatedCredits,
            },
          ),
        ).rejects.toThrow(
          "Runway reference-audio provider estimated credits must be finite and nonnegative.",
        );

        expect(
          retrieve,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      0,
      -1,
      1.5,
      Number.POSITIVE_INFINITY,
    ])(
      "rejects invalid wait timeout %s before provider lookup",
      async (
        waitTimeoutMs,
      ) => {
        const {
          client,
          retrieve,
        } =
          createLookupHarness();

        await expect(
          resumeRunwayReferenceAudioTask(
            client,
            {
              ...defaultInput(),

              waitTimeoutMs,
            },
          ),
        ).rejects.toThrow(
          "Runway reference-audio resume wait timeout must be a positive safe integer.",
        );

        expect(
          retrieve,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a retrieved task ID that differs from the durable task ID",
      async () => {
        const {
          client,
          waitForTaskOutput,
        } =
          createLookupHarness({
            retrievedTaskId:
              "task-reference-audio-other",
          });

        await expect(
          resumeRunwayReferenceAudioTask(
            client,
            defaultInput(),
          ),
        ).rejects.toThrow(
          "Runway reference-audio retrieved task ID task-reference-audio-other does not match durable task ID task-reference-audio-123.",
        );

        expect(
          waitForTaskOutput,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects non-SUCCEEDED terminal evidence",
      async () => {
        const {
          client,
        } =
          createLookupHarness({
            terminalResult: {
              id:
                DEFAULT_TASK_ID,

              status:
                "FAILED",
            },
          });

        await expect(
          resumeRunwayReferenceAudioTask(
            client,
            defaultInput(),
          ),
        ).rejects.toThrow(
          "Runway reference-audio recovery did not return SUCCEEDED terminal evidence.",
        );
      },
    );

    it(
      "rejects a completed task ID that differs from the durable task ID",
      async () => {
        const {
          client,
        } =
          createLookupHarness({
            terminalResult: {
              id:
                "task-reference-audio-other",

              createdAt:
                "2026-10-05T13:00:00.000Z",

              status:
                "SUCCEEDED",

              cost: {
                credits:
                  1.75,
              },

              output: [
                "https://example.test/reference-audio-output.mp3",
              ],
            },
          });

        await expect(
          resumeRunwayReferenceAudioTask(
            client,
            defaultInput(),
          ),
        ).rejects.toThrow(
          "Runway reference-audio completed task ID task-reference-audio-other does not match durable task ID task-reference-audio-123.",
        );
      },
    );

    it(
      "rejects an invalid provider createdAt timestamp",
      async () => {
        const {
          client,
        } =
          createLookupHarness({
            terminalResult: {
              id:
                DEFAULT_TASK_ID,

              createdAt:
                "not-a-timestamp",

              status:
                "SUCCEEDED",

              cost: {
                credits:
                  1.75,
              },

              output: [
                "https://example.test/reference-audio-output.mp3",
              ],
            },
          });

        await expect(
          resumeRunwayReferenceAudioTask(
            client,
            defaultInput(),
          ),
        ).rejects.toThrow(
          "Runway reference-audio returned an invalid createdAt timestamp",
        );
      },
    );

    it.each([
      -0.01,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ])(
      "rejects invalid final provider credits %s",
      async (
        finalCredits,
      ) => {
        const {
          client,
        } =
          createLookupHarness({
            terminalResult: {
              id:
                DEFAULT_TASK_ID,

              createdAt:
                "2026-10-05T13:00:00.000Z",

              status:
                "SUCCEEDED",

              cost: {
                credits:
                  finalCredits,
              },

              output: [
                "https://example.test/reference-audio-output.mp3",
              ],
            },
          });

        await expect(
          resumeRunwayReferenceAudioTask(
            client,
            defaultInput(),
          ),
        ).rejects.toThrow(
          "Runway reference-audio provider final credits must be finite and nonnegative.",
        );
      },
    );

    it(
      "rejects successful terminal evidence with no output URLs",
      async () => {
        const {
          client,
        } =
          createLookupHarness({
            terminalResult: {
              id:
                DEFAULT_TASK_ID,

              createdAt:
                "2026-10-05T13:00:00.000Z",

              status:
                "SUCCEEDED",

              cost: {
                credits:
                  1.75,
              },

              output: [],
            },
          });

        await expect(
          resumeRunwayReferenceAudioTask(
            client,
            defaultInput(),
          ),
        ).rejects.toThrow(
          "Runway reference-audio generation succeeded but returned no output URLs.",
        );
      },
    );

    it(
      "rejects a malformed output URL",
      async () => {
        const {
          client,
        } =
          createLookupHarness({
            terminalResult: {
              id:
                DEFAULT_TASK_ID,

              createdAt:
                "2026-10-05T13:00:00.000Z",

              status:
                "SUCCEEDED",

              cost: {
                credits:
                  1.75,
              },

              output: [
                "not-a-url",
              ],
            },
          });

        await expect(
          resumeRunwayReferenceAudioTask(
            client,
            defaultInput(),
          ),
        ).rejects.toThrow(
          "Runway reference-audio returned an invalid output URL.",
        );
      },
    );

    it(
      "rejects a non-HTTPS output URL",
      async () => {
        const {
          client,
        } =
          createLookupHarness({
            terminalResult: {
              id:
                DEFAULT_TASK_ID,

              createdAt:
                "2026-10-05T13:00:00.000Z",

              status:
                "SUCCEEDED",

              cost: {
                credits:
                  1.75,
              },

              output: [
                "http://example.test/reference-audio-output.mp3",
              ],
            },
          });

        await expect(
          resumeRunwayReferenceAudioTask(
            client,
            defaultInput(),
          ),
        ).rejects.toThrow(
          "Runway reference-audio output URL must use HTTPS.",
        );
      },
    );
  },
);
