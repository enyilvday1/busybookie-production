import type RunwayML from "@runwayml/sdk";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  executeRunwayDirectSeedAudio,
} from "../src/dialogue/runwayDirectSeedAudioExecution.js";

function createRequest() {
  return {
    model:
      "seed_audio",

    promptText:
      "Look what I found!",

    outputFormat:
      "mp3",

    sampleRate:
      44_100,

    voice: {
      type:
        "reference-audio",

      audioUri:
        "runway://uploads/ollie-reference-v1",
    },
  } as const;
}

function createSucceededGeneration(
  taskId:
    string =
      "task-seed-audio-123",
) {
  return {
    id:
      taskId,

    createdAt:
      "2026-10-05T20:45:00.000Z",

    status:
      "SUCCEEDED" as const,

    cost: {
      credits:
        1.75,
    },

    output: [
      "https://example.test/ollie-seed-audio.mp3",
    ],
  };
}

describe(
  "BusyBookie Runway direct SeedAudio dialogue execution",
  () => {
    it(
      "submits once with retries disabled, durably records fractional-cost acceptance before polling, and returns normalized provenance",
      async () => {
        const events:
          string[] = [];

        const created = {
          id:
            "task-seed-audio-123",

          estimatedCost: {
            credits:
              2.5,
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
          await executeRunwayDirectSeedAudio(
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
            "task-seed-audio-123",

          providerEstimatedCredits:
            2.5,
        });

        expect(
          events,
        ).toEqual([
          "accepted:task-seed-audio-123:2.5",
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
            "task-seed-audio-123",

          providerCreatedAt:
            "2026-10-05T20:45:00.000Z",

          estimatedCredits:
            2.5,

          finalCredits:
            1.75,

          outputUrls: [
            "https://example.test/ollie-seed-audio.mp3",
          ],
        });
      },
    );

    it(
      "does not poll when durable acceptance handling fails",
      async () => {
        const created = {
          id:
            "task-seed-audio-receipt-failure",

          estimatedCost: {
            credits:
              2.5,
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
          executeRunwayDirectSeedAudio(
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
        const created = {
          id:
            "   ",

          estimatedCost: {
            credits:
              2.5,
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
          executeRunwayDirectSeedAudio(
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

    it.each([
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ])(
      "rejects invalid estimated provider credits %s before durable acceptance or polling",
      async (
        providerEstimatedCredits,
      ) => {
        const created = {
          id:
            "task-seed-audio-invalid-estimate",

          estimatedCost: {
            credits:
              providerEstimatedCredits,
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
          executeRunwayDirectSeedAudio(
            client,
            createRequest(),
            {
              waitTimeoutMs:
                600_000,

              onSubmissionAccepted,
            },
          ),
        ).rejects.toThrow(
          /estimated.*credits/i,
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
        const created = {
          id:
            "task-seed-audio-123",

          estimatedCost: {
            credits:
              2.5,
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
                    createSucceededGeneration(
                      "task-seed-audio-different",
                    ),
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
          executeRunwayDirectSeedAudio(
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
          /task id.*match|task id mismatch/i,
        );
      },
    );

    it(
      "rejects a succeeded task with no output URLs",
      async () => {
        const created = {
          id:
            "task-seed-audio-123",

          estimatedCost: {
            credits:
              2.5,
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
                  async () => ({
                    ...createSucceededGeneration(
                      created.id,
                    ),

                    output:
                      [],
                  }),
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
          executeRunwayDirectSeedAudio(
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
        const created = {
          id:
            "task-seed-audio-123",

          estimatedCost: {
            credits:
              2.5,
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
                  async () => ({
                    ...createSucceededGeneration(
                      created.id,
                    ),

                    output: [
                      "http://example.test/ollie-seed-audio.mp3",
                    ],
                  }),
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
          executeRunwayDirectSeedAudio(
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
  },
);
