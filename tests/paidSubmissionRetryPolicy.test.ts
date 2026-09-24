import type RunwayML from "@runwayml/sdk";

import type {
  GenerateVideosOperation,
  GenerateVideosParameters,
} from "@google/genai";

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

import {
  executeVeoGeneration,
  type VeoExecutionClient,
} from "../src/veo/execution/veoExecution.js";

function asVeoOperation(
  value:
    Partial<GenerateVideosOperation>,
): GenerateVideosOperation {
  return value as
    GenerateVideosOperation;
}

describe(
  "Busybookie paid submission retry policy",
  () => {
    it(
      "disables automatic retries only for the Runway paid generation submission",
      async () => {
        const request = {
          model:
            "gen4.5",

          promptImage:
            "runway://busybookie-test",

          ratio:
            "1280:720",

          duration:
            5,

          promptText:
            "Busybookie retry-policy test",
        } as Gen45Request;

        const created:
          RunwayCreatedGeneration = {
            id:
              "task-retry-policy",

            estimatedCost: {
              credits:
                60,
            },
          };

        const succeeded:
          RunwaySucceededGeneration = {
            id:
              "task-retry-policy",

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
            async () =>
              succeeded,
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

        await executeRunwayGen45(
          client,
          request,
          600_000,
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
          waitForTaskOutput,
        ).toHaveBeenCalledWith({
          timeout:
            600_000,
        });
      },
    );

    it(
      "disables automatic retries only for the Veo paid generation submission",
      async () => {
        const request:
          GenerateVideosParameters = {
            model:
              "veo-3.1-fast-generate-preview",

            source: {
              prompt:
                "Busybookie retry-policy test",
            },

            config: {
              durationSeconds:
                4,

              aspectRatio:
                "16:9",

              resolution:
                "720p",

              numberOfVideos:
                1,
            },
          };

        const originalRequest =
          structuredClone(
            request,
          );

        const initial =
          asVeoOperation({
            name:
              "operations/retry-policy",

            done:
              false,
          });

        const completed =
          asVeoOperation({
            name:
              "operations/retry-policy",

            done:
              true,

            response: {
              generatedVideos: [
                {
                  video: {
                    uri:
                      "https://example.test/busybookie.mp4",

                    mimeType:
                      "video/mp4",
                  },
                },
              ],
            },
          });

        const generateVideos =
          vi.fn(
            async () =>
              initial,
          );

        const getVideosOperation =
          vi.fn(
            async () =>
              completed,
          );

        const client:
          VeoExecutionClient = {
            models: {
              generateVideos,
            },

            operations: {
              getVideosOperation,
            },
          };

        await executeVeoGeneration(
          client,
          request,
          {
            pollIntervalMs:
              10_000,

            timeoutMs:
              60_000,

            sleep:
              async () => {},
          },
        );

        expect(
          generateVideos,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          generateVideos,
        ).toHaveBeenCalledWith({
          ...request,

          config: {
            ...request.config,

            httpOptions: {
              retryOptions: {
                attempts:
                  1,
              },
            },
          },
        });

        expect(
          request,
        ).toEqual(
          originalRequest,
        );

        expect(
          getVideosOperation,
        ).toHaveBeenCalledWith({
          operation:
            initial,
        });
      },
    );
  },
);
