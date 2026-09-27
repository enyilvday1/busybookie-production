import {
  describe,
  expect,
  it,
} from "vitest";

import {
  ExecutionSubmissionInputSchema,
} from "../src/execution/executionSubmission.schema.js";

describe(
  "Busybookie Runway execution submission recovery metadata",
  () => {
    it(
      "accepts the durable metadata required to reconstruct a Runway generation record after submission",
      () => {
        const input = {
          reservationId:
            "11111111-1111-4111-8111-111111111111",

          episodeId:
            "EP91",

          shotId:
            "S01",

          provider:
            "RUNWAY",

          providerExecutionId:
            "task-runway-recovery-123",

          providerEstimatedCredits:
            60,

          recoveryMetadata: {
            request: {
              durationSeconds:
                5,

              ratio:
                "1280:720",

              outputFormat:
                "mp4",

              promptText:
                "Ollie walks gently through Littleleaf Valley. Camera: slow tracking shot.",

              sourceImagePath:
                "D:/Busybookie/Production/references/EP91/S01/reference.png",

              assetStrategy:
                "DATA_URI",
            },

            locallyExpectedCredits:
              60,
          },
        } as const;

        expect(
          ExecutionSubmissionInputSchema.parse(
            input,
          ),
        ).toEqual(
          input,
        );
      },
    );
  },
);
