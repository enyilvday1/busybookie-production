import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createVeoSingleShotProductionExecutor,
  type VeoSingleShotProductionExecutorDependencies,
} from "../src/execution/providers/createVeoSingleShotProductionExecutor.js";

import type {
  SingleShotProviderExecutionInput,
  SingleShotProviderExecutionResult,
} from "../src/execution/singleShotExecution.types.js";

describe(
  "Busybookie Veo production executor",
  () => {
    it(
      "lazily composes the Veo adapter without requiring another provider",
      async () => {
        const apiKey =
          "test-gemini-api-key";

        const input =
          Object.freeze({
            marker:
              "mock-provider-input",
          }) as unknown as
            SingleShotProviderExecutionInput;

        const expectedResult =
          Object.freeze({
            providerExecutionId:
              "operations/veo-production-1",

            recordPath:
              "D:/Busybookie/Production/generated-video/EP91/S01/mock.veo-generation.json",
          }) satisfies
            SingleShotProviderExecutionResult;

        const policy =
          Object.freeze({
            marker:
              "mock-veo-policy",
          }) as unknown as Awaited<
            ReturnType<
              VeoSingleShotProductionExecutorDependencies[
                "loadPolicy"
              ]
            >
          >;

        const client =
          Object.freeze({
            marker:
              "mock-veo-client",
          }) as unknown as ReturnType<
            VeoSingleShotProductionExecutorDependencies[
              "createClient"
            ]
          >;

        const runTransaction =
          vi.fn() as unknown as ReturnType<
            VeoSingleShotProductionExecutorDependencies[
              "createTransactionRunner"
            ]
          >;

        const loadPolicy =
          vi.fn<
            VeoSingleShotProductionExecutorDependencies[
              "loadPolicy"
            ]
          >(
            async () =>
              policy,
          );

        const createClient =
          vi.fn<
            VeoSingleShotProductionExecutorDependencies[
              "createClient"
            ]
          >(
            (
              receivedApiKey,
            ) => {
              expect(
                receivedApiKey,
              ).toBe(
                apiKey,
              );

              return client;
            },
          );

        const createTransactionRunner =
          vi.fn<
            VeoSingleShotProductionExecutorDependencies[
              "createTransactionRunner"
            ]
          >(
            (
              receivedClient,
            ) => {
              expect(
                receivedClient,
              ).toBe(
                client,
              );

              return runTransaction;
            },
          );

        const buildPrompt =
          vi.fn<
            VeoSingleShotProductionExecutorDependencies[
              "buildPrompt"
            ]
          >(
            () =>
              "Mock Veo prompt.",
          );

        const executeAdapter =
          vi.fn<
            VeoSingleShotProductionExecutorDependencies[
              "executeAdapter"
            ]
          >(
            async (
              receivedInput,
              adapterDependencies,
            ) => {
              expect(
                receivedInput,
              ).toBe(
                input,
              );

              expect(
                adapterDependencies
                  .policy,
              ).toBe(
                policy,
              );

              expect(
                adapterDependencies
                  .buildPrompt,
              ).toBe(
                buildPrompt,
              );

              expect(
                adapterDependencies
                  .runTransaction,
              ).toBe(
                runTransaction,
              );

              return expectedResult;
            },
          );

        const dependencies = {
          loadPolicy,
          createClient,
          createTransactionRunner,
          buildPrompt,
          executeAdapter,
        } satisfies
          VeoSingleShotProductionExecutorDependencies;

        const executor =
          createVeoSingleShotProductionExecutor(
            apiKey,
            dependencies,
          );

        expect(
          loadPolicy,
        ).not.toHaveBeenCalled();

        expect(
          createClient,
        ).not.toHaveBeenCalled();

        expect(
          createTransactionRunner,
        ).not.toHaveBeenCalled();

        expect(
          executeAdapter,
        ).not.toHaveBeenCalled();

        const result =
          await executor(
            input,
          );

        expect(
          loadPolicy,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createClient,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createTransactionRunner,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          executeAdapter,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result,
        ).toBe(
          expectedResult,
        );
      },
    );
  },
);
