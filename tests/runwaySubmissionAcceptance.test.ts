import type RunwayML from "@runwayml/sdk";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  executeRunwayGen45,
  type RunwayCreatedGeneration,
  type RunwaySucceededGeneration,
} from "../src/runway/execution/runwayGen45Execution.js";

import type {
  Gen45Request,
} from "../src/runway/gen45/gen45Request.schema.js";

function createRequest():
Gen45Request {
  return {
    model:
      "gen4.5",

    promptImage:
      "runway://busybookie-test",

    ratio:
      "1280:720",

    duration:
      5,

    promptText:
      "Busybookie submission acceptance test",
  } as Gen45Request;
}

function createSucceededGeneration(
  id:
    string,
): RunwaySucceededGeneration {
  return {
    id,

    status:
      "SUCCEEDED",

    cost: {
      credits:
        60,
    },

    output: [
      "https://example.test/busybookie.mp4",
    ],
  };
}

describe(
  "Busybookie Runway submission acceptance",
  () => {
    it(
      "durably handles the accepted task ID before polling",
      async () => {
        const events:
          string[] = [];

        const created:
          RunwayCreatedGeneration = {
            id:
              "task-accepted-123",

            estimatedCost: {
              credits:
                60,
            },
          };

        const succeeded =
          createSucceededGeneration(
            created.id,
          );

        const onSubmissionAccepted =
          vi.fn(
            async (
              taskId:
                string,
            ) => {
              events.push(
                `accepted-start:${taskId}`,
              );

              await Promise.resolve();

              events.push(
                `accepted-end:${taskId}`,
              );
            },
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
          imageToVideo: {
            create,
          },
        } as unknown as
          RunwayML;

        const result =
          await executeRunwayGen45(
            client,
            createRequest(),
            {
              waitTimeoutMs:
                600_000,

              onSubmissionAccepted,
            },
          );

        expect(
          onSubmissionAccepted,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          onSubmissionAccepted,
        ).toHaveBeenCalledWith(
          "task-accepted-123",
        );

        expect(
          events,
        ).toEqual([
          "accepted-start:task-accepted-123",
          "accepted-end:task-accepted-123",
          "poll",
        ]);

        expect(
          result.taskId,
        ).toBe(
          "task-accepted-123",
        );
      },
    );

    it(
      "does not poll when durable acceptance handling fails",
      async () => {
        const created:
          RunwayCreatedGeneration = {
            id:
              "task-receipt-failure",

            estimatedCost: {
              credits:
                60,
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
          imageToVideo: {
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
            async () => {
              throw new Error(
                "simulated durable receipt failure",
              );
            },
          );

        await expect(
          executeRunwayGen45(
            client,
            createRequest(),
            {
              waitTimeoutMs:
                600_000,

              onSubmissionAccepted,
            },
          ),
        ).rejects.toThrow(
          /do not resubmit automatically/i,
        );

        expect(
          onSubmissionAccepted,
        ).toHaveBeenCalledWith(
          "task-receipt-failure",
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
          RunwayCreatedGeneration = {
            id:
              "   ",

            estimatedCost: {
              credits:
                60,
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
          imageToVideo: {
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
          executeRunwayGen45(
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
  },
);
