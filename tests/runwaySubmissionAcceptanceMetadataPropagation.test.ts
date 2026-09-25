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
      "Busybookie acceptance metadata propagation test",
  } as Gen45Request;
}

describe(
  "Busybookie Runway submission acceptance metadata propagation",
  () => {
    it(
      "passes the accepted task ID and provider estimated credits before polling",
      async () => {
        const events:
          string[] = [];

        const created:
          RunwayCreatedGeneration = {
            id:
              "task-acceptance-metadata-1",

            estimatedCost: {
              credits:
                60,
            },
          };

        const succeeded:
          RunwaySucceededGeneration = {
            id:
              created.id,

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
            async (
              acceptance:
                Readonly<{
                  taskId: string;

                  providerEstimatedCredits:
                    number;
                }>,
            ) => {
              events.push(
                "accepted:" +
                  acceptance.taskId +
                  ":" +
                  acceptance.providerEstimatedCredits,
              );
            },
          );

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
        ).toHaveBeenCalledWith({
          taskId:
            "task-acceptance-metadata-1",

          providerEstimatedCredits:
            60,
        });

        expect(
          events,
        ).toEqual([
          "accepted:task-acceptance-metadata-1:60",
          "poll",
        ]);
      },
    );
  },
);
