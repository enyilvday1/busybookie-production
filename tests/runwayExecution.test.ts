import {
  describe,
  expect,
  it,
} from "vitest";

import {
  normalizeRunwayGen45Result,
} from "../src/runway/execution/runwayGen45Execution.js";

describe(
  "Busybookie Runway execution normalization",
  () => {
    it(
      "normalizes a successful Runway generation",
      () => {
        const result =
          normalizeRunwayGen45Result(
            {
              id:
                "task-123",
              estimatedCost: {
                credits:
                  60,
              },
            },
            {
              id:
                "task-123",
              status:
                "SUCCEEDED",
              cost: {
                credits:
                  60,
              },
              output: [
                "https://example.runway.test/output.mp4",
              ],
            },
          );

        expect(
          result,
        ).toEqual({
          taskId:
            "task-123",

          estimatedCredits:
            60,

          finalCredits:
            60,

          outputUrls: [
            "https://example.runway.test/output.mp4",
          ],
        });
      },
    );

    it(
      "rejects a non-HTTPS output URL",
      () => {
        expect(() =>
          normalizeRunwayGen45Result(
            {
              id:
                "task-123",
              estimatedCost: {
                credits:
                  60,
              },
            },
            {
              id:
                "task-123",
              status:
                "SUCCEEDED",
              cost: {
                credits:
                  60,
              },
              output: [
                "http://example.test/output.mp4",
              ],
            },
          ),
        ).toThrow(
          /must use HTTPS/,
        );
      },
    );
  },
);
