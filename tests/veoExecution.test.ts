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
  executeVeoGeneration,
  type VeoExecutionClient,
} from "../src/veo/execution/veoExecution.js";

function asOperation(
  value:
    Partial<GenerateVideosOperation>,
): GenerateVideosOperation {
  return value as
    GenerateVideosOperation;
}

const request:
  GenerateVideosParameters = {
    model:
      "veo-3.1-fast-generate-preview",

    source: {
      prompt:
        "Busybookie test",
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

describe(
  "Busybookie Veo execution",
  () => {
    it(
      "normalizes an immediately successful operation",
      async () => {
        const operation =
          asOperation({
            name:
              "operations/test-1",

            done:
              true,

            response: {
              generatedVideos: [
                {
                  video: {
                    uri:
                      "https://example.test/video.mp4",

                    mimeType:
                      "video/mp4",
                  },
                },
              ],
            },
          });

        const client:
          VeoExecutionClient = {
            models: {
              generateVideos:
                vi.fn(
                  async () =>
                    operation,
                ),
            },

            operations: {
              getVideosOperation:
                vi.fn(),
            },
          };

        const result =
          await executeVeoGeneration(
            client,
            request,
            {
              pollIntervalMs:
                10_000,

              timeoutMs:
                60_000,

              onSubmissionAccepted:
                async () => {},
            },
          );

        expect(
          result.operationName,
        ).toBe(
          "operations/test-1",
        );

        expect(
          result.generatedVideos,
        ).toHaveLength(
          1,
        );

        expect(
          client.operations
            .getVideosOperation,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "polls an incomplete operation until it succeeds",
      async () => {
        const initial =
          asOperation({
            name:
              "operations/test-2",

            done:
              false,
          });

        const completed =
          asOperation({
            name:
              "operations/test-2",

            done:
              true,

            response: {
              generatedVideos: [
                {
                  video: {
                    videoBytes:
                      "AQID",

                    mimeType:
                      "video/mp4",
                  },
                },
              ],
            },
          });

        const getVideosOperation =
          vi.fn(
            async () =>
              completed,
          );

        const client:
          VeoExecutionClient = {
            models: {
              generateVideos:
                vi.fn(
                  async () =>
                    initial,
                ),
            },

            operations: {
              getVideosOperation,
            },
          };

        let now =
          0;

        await executeVeoGeneration(
          client,
          request,
          {
            pollIntervalMs:
              10_000,

            timeoutMs:
              60_000,

            onSubmissionAccepted:
              async () => {},

            nowMs:
              () =>
                now,

            sleep:
              async (
                milliseconds,
              ) => {
                now +=
                  milliseconds;
              },
          },
        );

        expect(
          getVideosOperation,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "fails closed when the service operation reports an error",
      async () => {
        const failed =
          asOperation({
            name:
              "operations/test-3",

            done:
              true,

            error: {
              code:
                500,
            },
          });

        const client:
          VeoExecutionClient = {
            models: {
              generateVideos:
                vi.fn(
                  async () =>
                    failed,
                ),
            },

            operations: {
              getVideosOperation:
                vi.fn(),
            },
          };

        await expect(
          executeVeoGeneration(
            client,
            request,
            {
              pollIntervalMs:
                10_000,

              timeoutMs:
                60_000,

              onSubmissionAccepted:
                async () => {},
            },
          ),
        ).rejects.toThrow(
          /completed with an error/,
        );
      },
    );

    it(
      "stops local polling after the configured timeout",
      async () => {
        const pending =
          asOperation({
            name:
              "operations/test-4",

            done:
              false,
          });

        const getVideosOperation =
          vi.fn(
            async () =>
              pending,
          );

        const client:
          VeoExecutionClient = {
            models: {
              generateVideos:
                vi.fn(
                  async () =>
                    pending,
                ),
            },

            operations: {
              getVideosOperation,
            },
          };

        let now =
          0;

        await expect(
          executeVeoGeneration(
            client,
            request,
            {
              pollIntervalMs:
                10_000,

              timeoutMs:
                20_000,

              onSubmissionAccepted:
                async () => {},

              nowMs:
                () =>
                  now,

              sleep:
                async (
                  milliseconds,
                ) => {
                  now +=
                    milliseconds;
                },
            },
          ),
        ).rejects.toThrow(
          /server-side operation may still be running/,
        );

        expect(
          getVideosOperation,
        ).toHaveBeenCalledTimes(
          2,
        );
      },
    );
  },
);
