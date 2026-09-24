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
        "Busybookie submission acceptance test",
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

function completedOperation(
  name:
    string,
): GenerateVideosOperation {
  return asOperation({
    name,

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
}

describe(
  "Busybookie Veo submission acceptance",
  () => {
    it(
      "durably handles the accepted operation name before polling",
      async () => {
        const events:
          string[] = [];

        const initial =
          asOperation({
            name:
              "operations/accepted-123",

            done:
              false,
          });

        const completed =
          completedOperation(
            "operations/accepted-123",
          );

        const onSubmissionAccepted =
          vi.fn(
            async (
              operationName:
                string,
            ) => {
              events.push(
                `accepted-start:${operationName}`,
              );

              await Promise.resolve();

              events.push(
                `accepted-end:${operationName}`,
              );
            },
          );

        const getVideosOperation =
          vi.fn(
            async () => {
              events.push(
                "poll",
              );

              return completed;
            },
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

        const result =
          await executeVeoGeneration(
            client,
            request,
            {
              pollIntervalMs:
                10_000,

              timeoutMs:
                60_000,

              onSubmissionAccepted,

              nowMs:
                () =>
                  0,

              sleep:
                async () => {
                  events.push(
                    "sleep",
                  );
                },
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
          "operations/accepted-123",
        );

        expect(
          events,
        ).toEqual([
          "accepted-start:operations/accepted-123",
          "accepted-end:operations/accepted-123",
          "sleep",
          "poll",
        ]);

        expect(
          result.operationName,
        ).toBe(
          "operations/accepted-123",
        );
      },
    );

    it(
      "does not poll when durable acceptance handling fails",
      async () => {
        const initial =
          asOperation({
            name:
              "operations/receipt-failure",

            done:
              false,
          });

        const getVideosOperation =
          vi.fn(
            async () =>
              completedOperation(
                "operations/receipt-failure",
              ),
          );

        const sleep =
          vi.fn(
            async () => {},
          );

        const onSubmissionAccepted =
          vi.fn(
            async () => {
              throw new Error(
                "simulated durable receipt failure",
              );
            },
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

        await expect(
          executeVeoGeneration(
            client,
            request,
            {
              pollIntervalMs:
                10_000,

              timeoutMs:
                60_000,

              onSubmissionAccepted,

              nowMs:
                () =>
                  0,

              sleep,
            },
          ),
        ).rejects.toThrow(
          /do not resubmit automatically/i,
        );

        expect(
          onSubmissionAccepted,
        ).toHaveBeenCalledWith(
          "operations/receipt-failure",
        );

        expect(
          sleep,
        ).not.toHaveBeenCalled();

        expect(
          getVideosOperation,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "records provider acceptance even when Veo returns an already-completed operation",
      async () => {
        const initial =
          completedOperation(
            "operations/immediate-completion",
          );

        const onSubmissionAccepted =
          vi.fn(
            async () => {},
          );

        const getVideosOperation =
          vi.fn();

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

        const result =
          await executeVeoGeneration(
            client,
            request,
            {
              pollIntervalMs:
                10_000,

              timeoutMs:
                60_000,

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
          "operations/immediate-completion",
        );

        expect(
          getVideosOperation,
        ).not.toHaveBeenCalled();

        expect(
          result.operationName,
        ).toBe(
          "operations/immediate-completion",
        );
      },
    );
  },
);
