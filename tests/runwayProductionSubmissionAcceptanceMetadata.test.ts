import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createRunwaySingleShotProductionTransactionRunner,
  type RunwaySingleShotProductionTransactionRunnerDependencies,
} from "../src/execution/providers/createRunwaySingleShotProductionTransactionRunner.js";

describe(
  "Busybookie Runway production submission acceptance metadata",
  () => {
    it(
      "translates Runway acceptance metadata into the generic provider acceptance contract",
      async () => {
        const client =
          Object.freeze({
            marker:
              "mock-runway-client",
          }) as unknown as
            Parameters<
              typeof createRunwaySingleShotProductionTransactionRunner
            >[0];

        const onSubmissionAccepted =
          vi.fn(
            async (
              _acceptance:
                unknown,
            ) =>
              undefined,
          );

        const executeGeneration =
          vi.fn<
            RunwaySingleShotProductionTransactionRunnerDependencies[
              "executeGeneration"
            ]
          >(
            async (
              receivedClient,
              _request,
              options,
            ) => {
              expect(
                receivedClient,
              ).toBe(
                client,
              );

              await options
                .onSubmissionAccepted({
                  taskId:
                    "runway-production-task-metadata-1",

                  providerEstimatedCredits:
                    60,
                });

              return {
                taskId:
                  "runway-production-task-metadata-1",

                estimatedCredits:
                  60,

                finalCredits:
                  60,

                outputUrls: [
                  "https://example.test/mock.mp4",
                ],
              };
            },
          );

        const runTransaction =
          vi.fn<
            RunwaySingleShotProductionTransactionRunnerDependencies[
              "runTransaction"
            ]
          >(
            async (
              _input,
              transactionDependencies,
            ) => {
              const request =
                {} as Parameters<
                  typeof transactionDependencies.executeGeneration
                >[0];

              const execution =
                await transactionDependencies
                  .executeGeneration(
                    request,
                    30_000,
                  );

              return {
                record: {
                  taskId:
                    execution.taskId,
                },

                recordPath:
                  "C:/mock/runway-record.json",
              } as Awaited<
                ReturnType<
                  RunwaySingleShotProductionTransactionRunnerDependencies[
                    "runTransaction"
                  ]
                >
              >;
            },
          );

        const dependencies = {
          runTransaction,

          resolveImageAsset:
            vi.fn(),

          uploadEphemeralAsset:
            vi.fn(),

          executeGeneration,

          downloadOutput:
            vi.fn(),

          writeGenerationRecord:
            vi.fn(),
        } as unknown as
          RunwaySingleShotProductionTransactionRunnerDependencies;

        const runner =
          createRunwaySingleShotProductionTransactionRunner(
            client,
            dependencies,
          );

        const transactionInput =
          {} as Parameters<
            typeof runner
          >[0];

        const result =
          await runner(
            transactionInput,
            onSubmissionAccepted,
          );

        expect(
          onSubmissionAccepted,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          onSubmissionAccepted,
        ).toHaveBeenCalledWith({
          provider:
            "RUNWAY",

          providerExecutionId:
            "runway-production-task-metadata-1",

          providerEstimatedCredits:
            60,
        });

        expect(
          result.record.taskId,
        ).toBe(
          "runway-production-task-metadata-1",
        );
      },
    );
  },
);
