import type RunwayML from "@runwayml/sdk";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  executeRunwayElevenV3,
  type RunwayElevenV3CreatedGeneration,
  type RunwayElevenV3SucceededGeneration,
} from "../src/dialogue/runwayElevenV3Execution.js";

import type {
  RunwayElevenV3Request,
} from "../src/dialogue/runwayElevenV3Request.schema.js";

function createRequest():
RunwayElevenV3Request {
  return {
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
  };
}

function createSucceededGeneration(
  taskId:
    string =
      "task-dialogue-123",
):
RunwayElevenV3SucceededGeneration {
  return {
    id:
      taskId,

    createdAt:
      "2026-10-01T15:00:00.000Z",

    status:
      "SUCCEEDED",

    cost: {
      credits:
        1,
    },

    output: [
      "https://example.test/dialogue-output",
    ],
  };
}

describe(
  "Busybookie Runway Eleven v3 dialogue execution",
  () => {
    it(
      "submits once with retries disabled, durably records acceptance before polling, and returns normalized provenance",
      async () => {
        const events:
          string[] = [];

        const created:
          RunwayElevenV3CreatedGeneration = {
            id:
              "task-dialogue-123",

            estimatedCost: {
              credits:
                1,
            },
          };

        const succeeded =
          createSucceededGeneration(
            created.id,
          );

        const waitForTaskOutput =
          vi.fn(
            async () => {
              events.push(
                "poll",
              );

              return succeeded;
            },
          );

        const task =
          Object.assign(
            Promise.resolve(
              created,
            ),
            {
              waitForTaskOutput,
            },
          );

        const create =
          vi.fn(
            () =>
              task,
          );

        const client = {
          textToSpeech: {
            create,
          },
        } as unknown as
          RunwayML;

        const onSubmissionAccepted =
          vi.fn(
            async (
              acceptance:
                Readonly<{
                  taskId:
                    string;

                  providerEstimatedCredits:
                    number;
                }>,
            ) => {
              events.push(
                `accepted:${acceptance.taskId}:${acceptance.providerEstimatedCredits}`,
              );
            },
          );

        const request =
          createRequest();

        const result =
          await executeRunwayElevenV3(
            client,
            request,
            {
              waitTimeoutMs:
                600_000,

              onSubmissionAccepted,
            },
          );

        expect(
          create,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          create,
        ).toHaveBeenCalledWith(
          request,
          {
            maxRetries:
              0,
          },
        );

        expect(
          onSubmissionAccepted,
        ).toHaveBeenCalledWith({
          taskId:
            "task-dialogue-123",

          providerEstimatedCredits:
            1,
        });

        expect(
          events,
        ).toEqual([
          "accepted:task-dialogue-123:1",
          "poll",
        ]);

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
            "task-dialogue-123",

          providerCreatedAt:
            "2026-10-01T15:00:00.000Z",

          estimatedCredits:
            1,

          finalCredits:
            1,

          outputUrls: [
            "https://example.test/dialogue-output",
          ],
        });
      },
    );

    it(
      "does not poll when durable acceptance handling fails",
      async () => {
        const created:
          RunwayElevenV3CreatedGeneration = {
            id:
              "task-dialogue-receipt-failure",

            estimatedCost: {
              credits:
                1,
            },
          };

        const waitForTaskOutput =
          vi.fn(
            async () =>
              createSucceededGeneration(
                created.id,
              ),
          );

        const task =
          Object.assign(
            Promise.resolve(
              created,
            ),
            {
              waitForTaskOutput,
            },
          );

        const client = {
          textToSpeech: {
            create:
              vi.fn(
                () =>
                  task,
              ),
          },
        } as unknown as
          RunwayML;

        await expect(
          executeRunwayElevenV3(
            client,
            createRequest(),
            {
              waitTimeoutMs:
                600_000,

              onSubmissionAccepted:
                async () => {
                  throw new Error(
                    "simulated durable receipt failure",
                  );
                },
            },
          ),
        ).rejects.toThrow(
          /do not resubmit automatically/i,
        );

        expect(
          waitForTaskOutput,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects an empty accepted task ID before acceptance handling or polling",
      async () => {
        const created:
          RunwayElevenV3CreatedGeneration = {
            id:
              "   ",

            estimatedCost: {
              credits:
                1,
            },
          };

        const waitForTaskOutput =
          vi.fn(
            async () =>
              createSucceededGeneration(
                "   ",
              ),
          );

        const task =
          Object.assign(
            Promise.resolve(
              created,
            ),
            {
              waitForTaskOutput,
            },
          );

        const client = {
          textToSpeech: {
            create:
              vi.fn(
                () =>
                  task,
              ),
          },
        } as unknown as
          RunwayML;

        const onSubmissionAccepted =
          vi.fn(
            async () => {},
          );

        await expect(
          executeRunwayElevenV3(
            client,
            createRequest(),
            {
              waitTimeoutMs:
                600_000,

              onSubmissionAccepted,
            },
          ),
        ).rejects.toThrow(
          /task id/i,
        );

        expect(
          onSubmissionAccepted,
        ).not.toHaveBeenCalled();

        expect(
          waitForTaskOutput,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when the completed task ID differs from the accepted task ID",
      async () => {
        const created:
          RunwayElevenV3CreatedGeneration = {
            id:
              "task-dialogue-123",

            estimatedCost: {
              credits:
                1,
            },
          };

        const waitForTaskOutput =
          vi.fn(
            async () =>
              createSucceededGeneration(
                "task-dialogue-different",
              ),
          );

        const task =
          Object.assign(
            Promise.resolve(
              created,
            ),
            {
              waitForTaskOutput,
            },
          );

        const client = {
          textToSpeech: {
            create:
              vi.fn(
                () =>
                  task,
              ),
          },
        } as unknown as
          RunwayML;

        await expect(
          executeRunwayElevenV3(
            client,
            createRequest(),
            {
              waitTimeoutMs:
                600_000,

              onSubmissionAccepted:
                async () => {},
            },
          ),
        ).rejects.toThrow(
          /task id mismatch/i,
        );
      },
    );

    it(
      "rejects a succeeded task with no output URLs",
      async () => {
        const created:
          RunwayElevenV3CreatedGeneration = {
            id:
              "task-dialogue-123",

            estimatedCost: {
              credits:
                1,
            },
          };

        const succeeded = {
          ...createSucceededGeneration(
            created.id,
          ),

          output:
            [],
        };

        const task =
          Object.assign(
            Promise.resolve(
              created,
            ),
            {
              waitForTaskOutput:
                vi.fn(
                  async () =>
                    succeeded,
                ),
            },
          );

        const client = {
          textToSpeech: {
            create:
              vi.fn(
                () =>
                  task,
              ),
          },
        } as unknown as
          RunwayML;

        await expect(
          executeRunwayElevenV3(
            client,
            createRequest(),
            {
              waitTimeoutMs:
                600_000,

              onSubmissionAccepted:
                async () => {},
            },
          ),
        ).rejects.toThrow(
          /no output urls/i,
        );
      },
    );

    it(
      "rejects a non-HTTPS output URL",
      async () => {
        const created:
          RunwayElevenV3CreatedGeneration = {
            id:
              "task-dialogue-123",

            estimatedCost: {
              credits:
                1,
            },
          };

        const succeeded = {
          ...createSucceededGeneration(
            created.id,
          ),

          output: [
            "http://example.test/dialogue-output",
          ],
        };

        const task =
          Object.assign(
            Promise.resolve(
              created,
            ),
            {
              waitForTaskOutput:
                vi.fn(
                  async () =>
                    succeeded,
                ),
            },
          );

        const client = {
          textToSpeech: {
            create:
              vi.fn(
                () =>
                  task,
              ),
          },
        } as unknown as
          RunwayML;

        await expect(
          executeRunwayElevenV3(
            client,
            createRequest(),
            {
              waitTimeoutMs:
                600_000,

              onSubmissionAccepted:
                async () => {},
            },
          ),
        ).rejects.toThrow(
          /HTTPS/i,
        );
      },
    );

    it(
      "rejects an invalid provider creation timestamp",
      async () => {
        const created:
          RunwayElevenV3CreatedGeneration = {
            id:
              "task-dialogue-123",

            estimatedCost: {
              credits:
                1,
            },
          };

        const succeeded = {
          ...createSucceededGeneration(
            created.id,
          ),

          createdAt:
            "not-a-timestamp",
        };

        const task =
          Object.assign(
            Promise.resolve(
              created,
            ),
            {
              waitForTaskOutput:
                vi.fn(
                  async () =>
                    succeeded,
                ),
            },
          );

        const client = {
          textToSpeech: {
            create:
              vi.fn(
                () =>
                  task,
              ),
          },
        } as unknown as
          RunwayML;

        await expect(
          executeRunwayElevenV3(
            client,
            createRequest(),
            {
              waitTimeoutMs:
                600_000,

              onSubmissionAccepted:
                async () => {},
            },
          ),
        ).rejects.toThrow(
          /createdAt|timestamp/i,
        );
      },
    );
  },
);

describe(
  "Busybookie Runway Eleven v3 dialogue execution credit integrity",
  () => {
    it.each([
      [
        -1,
        "negative",
      ],
      [
        1.5,
        "fractional",
      ],
      [
        Number.NaN,
        "NaN",
      ],
      [
        Number.POSITIVE_INFINITY,
        "infinite",
      ],
    ])(
      "rejects %s provider estimated credits before durable acceptance or polling",
      async (
        invalidCredits,
      ) => {
        const created:
          RunwayElevenV3CreatedGeneration = {
            id:
              "task-dialogue-invalid-estimated",

            estimatedCost: {
              credits:
                invalidCredits,
            },
          };

        const waitForTaskOutput =
          vi.fn(
            async () =>
              createSucceededGeneration(
                created.id,
              ),
          );

        const task =
          Object.assign(
            Promise.resolve(
              created,
            ),
            {
              waitForTaskOutput,
            },
          );

        const client = {
          textToSpeech: {
            create:
              vi.fn(
                () =>
                  task,
              ),
          },
        } as unknown as
          RunwayML;

        const onSubmissionAccepted =
          vi.fn(
            async () => {},
          );

        await expect(
          executeRunwayElevenV3(
            client,
            createRequest(),
            {
              waitTimeoutMs:
                600_000,

              onSubmissionAccepted,
            },
          ),
        ).rejects.toThrow(
          /estimated.*credits|credits.*estimated|nonnegative.*integer/i,
        );

        expect(
          onSubmissionAccepted,
        ).not.toHaveBeenCalled();

        expect(
          waitForTaskOutput,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      [
        -1,
        "negative",
      ],
      [
        1.5,
        "fractional",
      ],
      [
        Number.NaN,
        "NaN",
      ],
      [
        Number.POSITIVE_INFINITY,
        "infinite",
      ],
    ])(
      "rejects %s provider final credits after completion",
      async (
        invalidCredits,
      ) => {
        const created:
          RunwayElevenV3CreatedGeneration = {
            id:
              "task-dialogue-invalid-final",

            estimatedCost: {
              credits:
                1,
            },
          };

        const succeeded = {
          ...createSucceededGeneration(
            created.id,
          ),

          cost: {
            credits:
              invalidCredits,
          },
        };

        const task =
          Object.assign(
            Promise.resolve(
              created,
            ),
            {
              waitForTaskOutput:
                vi.fn(
                  async () =>
                    succeeded,
                ),
            },
          );

        const client = {
          textToSpeech: {
            create:
              vi.fn(
                () =>
                  task,
              ),
          },
        } as unknown as
          RunwayML;

        await expect(
          executeRunwayElevenV3(
            client,
            createRequest(),
            {
              waitTimeoutMs:
                600_000,

              onSubmissionAccepted:
                async () => {},
            },
          ),
        ).rejects.toThrow(
          /final.*credits|credits.*final|nonnegative.*integer/i,
        );
      },
    );
  },
);
