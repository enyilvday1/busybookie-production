import {
  GenerateVideosOperation,
  type GenerateVideosOperation as GenerateVideosOperationType,
} from "@google/genai";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  resumeVeoOperation,
  type VeoOperationLookupClient,
} from "../src/veo/execution/resumeVeoOperation.js";

function asOperation(
  value:
    Partial<GenerateVideosOperationType>,
): GenerateVideosOperationType {
  return Object.assign(
    new GenerateVideosOperation(),
    value,
  );
}

describe(
  "Busybookie Veo existing-operation resume",
  () => {
    it(
      "retrieves the durable existing operation without any paid-submission capability",
      async () => {
        const completed =
          asOperation({
            name:
              "operations/veo-existing-123",

            done:
              true,

            response: {
              generatedVideos: [
                {
                  video: {
                    uri:
                      "https://example.test/resumed-veo.mp4",

                    mimeType:
                      "video/mp4",
                  },
                },
              ],
            },
          });

        const getVideosOperation =
          vi.fn(
            async (
              parameters:
                Parameters<
                  VeoOperationLookupClient["operations"]["getVideosOperation"]
                >[0],
            ) => {
              expect(
                parameters
                  .operation,
              ).toBeInstanceOf(
                GenerateVideosOperation,
              );

              expect(
                parameters
                  .operation
                  .name,
              ).toBe(
                "operations/veo-existing-123",
              );

              return completed;
            },
          );

        const client:
          VeoOperationLookupClient = {
            operations: {
              getVideosOperation,
            },
          };

        const result =
          await resumeVeoOperation(
            client,
            {
              operationName:
                "operations/veo-existing-123",

              pollIntervalMs:
                10_000,

              timeoutMs:
                60_000,
            },
          );

        expect(
          getVideosOperation,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result.operationName,
        ).toBe(
          "operations/veo-existing-123",
        );

        expect(
          result.generatedVideos,
        ).toHaveLength(
          1,
        );
      },
    );
  },
);
