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

function createLookupHarness(
  operations:
    readonly GenerateVideosOperationType[],
) {
  let index =
    0;

  const getVideosOperation =
    vi.fn(
      async () => {
        const operation =
          operations[
            Math.min(
              index,
              operations.length - 1,
            )
          ];

        index +=
          1;

        if (!operation) {
          throw new Error(
            "Test lookup harness has no operation to return.",
          );
        }

        return operation;
      },
    );

  const client:
    VeoOperationLookupClient = {
      operations: {
        getVideosOperation,
      },
    };

  return {
    client,
    getVideosOperation,
  };
}

const validInput =
  Object.freeze({
    operationName:
      "operations/veo-existing-123",

    pollIntervalMs:
      10_000,

    timeoutMs:
      60_000,
  });

describe(
  "Busybookie Veo existing-operation resume fail-closed coverage",
  () => {
    it(
      "rejects a blank durable operation name before provider lookup",
      async () => {
        const harness =
          createLookupHarness([
            asOperation({
              name:
                "operations/veo-existing-123",

              done:
                true,
            }),
          ]);

        await expect(
          resumeVeoOperation(
            harness.client,
            {
              ...validInput,

              operationName:
                "   ",
            },
          ),
        ).rejects.toThrow(
          /non-empty operation name/i,
        );

        expect(
          harness.getVideosOperation,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects an invalid polling interval before provider lookup",
      async () => {
        const harness =
          createLookupHarness([
            asOperation({
              name:
                "operations/veo-existing-123",

              done:
                true,
            }),
          ]);

        await expect(
          resumeVeoOperation(
            harness.client,
            {
              ...validInput,

              pollIntervalMs:
                0,
            },
          ),
        ).rejects.toThrow(
          /polling interval.*positive safe integer/i,
        );

        expect(
          harness.getVideosOperation,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects an invalid timeout before provider lookup",
      async () => {
        const harness =
          createLookupHarness([
            asOperation({
              name:
                "operations/veo-existing-123",

              done:
                true,
            }),
          ]);

        await expect(
          resumeVeoOperation(
            harness.client,
            {
              ...validInput,

              timeoutMs:
                10_000,
            },
          ),
        ).rejects.toThrow(
          /timeout.*greater than the polling interval/i,
        );

        expect(
          harness.getVideosOperation,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when the first retrieved operation name differs from the durable operation name",
      async () => {
        const harness =
          createLookupHarness([
            asOperation({
              name:
                "operations/veo-unexpected-456",

              done:
                true,
            }),
          ]);

        await expect(
          resumeVeoOperation(
            harness.client,
            validInput,
          ),
        ).rejects.toThrow(
          /does not match durable operation name/i,
        );

        expect(
          harness.getVideosOperation,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "fails closed when a later polling result changes operation name",
      async () => {
        const harness =
          createLookupHarness([
            asOperation({
              name:
                "operations/veo-existing-123",

              done:
                false,
            }),

            asOperation({
              name:
                "operations/veo-unexpected-456",

              done:
                true,
            }),
          ]);

        await expect(
          resumeVeoOperation(
            harness.client,
            {
              ...validInput,

              sleep:
                async () => {},
            },
          ),
        ).rejects.toThrow(
          /does not match durable operation name/i,
        );

        expect(
          harness.getVideosOperation,
        ).toHaveBeenCalledTimes(
          2,
        );
      },
    );

    it(
      "fails closed when the existing provider operation completes with an error",
      async () => {
        const harness =
          createLookupHarness([
            asOperation({
              name:
                "operations/veo-existing-123",

              done:
                true,

              error: {
                code:
                  500,
              },
            }),
          ]);

        await expect(
          resumeVeoOperation(
            harness.client,
            validInput,
          ),
        ).rejects.toThrow(
          /completed with an error/i,
        );

        expect(
          harness.getVideosOperation,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "stops local resume polling after the configured timeout without creating a new operation",
      async () => {
        const pending =
          asOperation({
            name:
              "operations/veo-existing-123",

            done:
              false,
          });

        const harness =
          createLookupHarness([
            pending,
          ]);

        let now =
          0;

        await expect(
          resumeVeoOperation(
            harness.client,
            {
              ...validInput,

              timeoutMs:
                20_000,

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
          /server-side operation may still be running/i,
        );

        expect(
          harness.getVideosOperation,
        ).toHaveBeenCalledTimes(
          3,
        );
      },
    );
  },
);
