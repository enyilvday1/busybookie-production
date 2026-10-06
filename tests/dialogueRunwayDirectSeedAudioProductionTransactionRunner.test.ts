import type RunwayML from "@runwayml/sdk";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createRunwayDirectSeedAudioProductionTransactionRunner,
  type RunwayDirectSeedAudioProductionTransactionRunnerDependencies,
} from "../src/dialogue/createRunwayDirectSeedAudioProductionTransactionRunner.js";

import type {
  DialogueDirectSeedAudioSubmissionAcceptedHandler,
} from "../src/dialogue/executeDialogueDirectSeedAudioLine.js";

import {
  runRunwayDirectSeedAudioDialogueTransaction,
  type DialogueDirectSeedAudioGenerationRecoveryMetadata,
  type DialogueDirectSeedAudioOutputDownloader,
  type DialogueDirectSeedAudioGenerationRecordWriter,
  type DialogueDirectSeedAudioReferenceVerifier,
  type RunwayDirectSeedAudioDialogueTransactionDependencies,
  type RunwayDirectSeedAudioDialogueTransactionInput,
  type RunwayDirectSeedAudioDialogueTransactionResult,
} from "../src/dialogue/runRunwayDirectSeedAudioDialogueTransaction.js";

import {
  executeRunwayDirectSeedAudio,
  type RunwayDirectSeedAudioExecutionOptions,
  type RunwayDirectSeedAudioExecutionResult,
  type RunwayDirectSeedAudioRequest,
} from "../src/dialogue/runwayDirectSeedAudioExecution.js";

import {
  uploadRunwayEphemeralAsset,
} from "../src/runway/assets/uploadRunwayEphemeralAsset.js";

describe(
  "BusyBookie direct SeedAudio production transaction runner",
  () => {
    it(
      "binds the Runway client and attaches immutable recovery metadata at the durable acceptance boundary",
      async () => {
        const client =
          {} as RunwayML;

        const input =
          Object.freeze({}) as
            RunwayDirectSeedAudioDialogueTransactionInput;

        const recoveryMetadata =
          Object.freeze({
            marker:
              "immutable-recovery-metadata",
          }) as unknown as
            DialogueDirectSeedAudioGenerationRecoveryMetadata;

        const request:
          RunwayDirectSeedAudioRequest = {
            model:
              "seed_audio",

            promptText:
              "Look what I found!",

            voice: {
              type:
                "reference-audio",

              audioUri:
                "runway://ephemeral/ollie-reference-v1",
            },
          };

        const executionResult =
          Object.freeze({
            taskId:
              "task-seed-audio-production-runner",

            providerCreatedAt:
              "2026-10-06T14:30:00.000Z",

            estimatedCredits:
              5.25,

            finalCredits:
              4.75,

            outputUrls:
              Object.freeze([
                "https://example.test/ollie-seed-audio.mp3",
              ]),
          }) satisfies
            RunwayDirectSeedAudioExecutionResult;

        const transactionResult =
          Object.freeze({
            record:
              Object.freeze({}) as
                RunwayDirectSeedAudioDialogueTransactionResult["record"],

            recordPath:
              "D:/Busybookie/Production/generated-dialogue/record.json",
          }) satisfies
            RunwayDirectSeedAudioDialogueTransactionResult;

        const verifyReferenceAudio:
          DialogueDirectSeedAudioReferenceVerifier =
            vi.fn(
              async () => {
                throw new Error(
                  "Verifier should be passed through but not invoked by this runner wiring test.",
                );
              },
            );

        const downloadOutput:
          DialogueDirectSeedAudioOutputDownloader =
            vi.fn(
              async () => {
                throw new Error(
                  "Downloader should be passed through but not invoked by this runner wiring test.",
                );
              },
            );

        const writeGenerationRecord:
          DialogueDirectSeedAudioGenerationRecordWriter =
            vi.fn(
              async () => {
                throw new Error(
                  "Writer should be passed through but not invoked by this runner wiring test.",
                );
              },
            );

        const uploadReferenceAudio =
          vi.fn(
            async (
              receivedClient:
                RunwayML,

              absolutePath:
                string,
            ) => {
              expect(
                receivedClient,
              ).toBe(
                client,
              );

              expect(
                absolutePath,
              ).toBe(
                "D:/Busybookie/Production/references/voices/OLLIE/ollie-reference-v1.mp3",
              );

              return "runway://ephemeral/ollie-reference-v1";
            },
          );

        const executeGeneration =
          vi.fn(
            async (
              receivedClient:
                RunwayML,

              receivedRequest:
                RunwayDirectSeedAudioRequest,

              options:
                RunwayDirectSeedAudioExecutionOptions,
            ) => {
              expect(
                receivedClient,
              ).toBe(
                client,
              );

              expect(
                receivedRequest,
              ).toBe(
                request,
              );

              expect(
                options
                  .waitTimeoutMs,
              ).toBe(
                600_000,
              );

              await options
                .onSubmissionAccepted({
                  taskId:
                    "task-seed-audio-production-runner",

                  providerEstimatedCredits:
                    5.25,
                });

              return executionResult;
            },
          );

        const onSubmissionAccepted:
          DialogueDirectSeedAudioSubmissionAcceptedHandler =
            vi.fn(
              async () =>
                undefined,
            );

        const runTransaction =
          vi.fn(
            async (
              receivedInput:
                RunwayDirectSeedAudioDialogueTransactionInput,

              transactionDependencies:
                RunwayDirectSeedAudioDialogueTransactionDependencies,
            ) => {
              expect(
                receivedInput,
              ).toBe(
                input,
              );

              expect(
                transactionDependencies
                  .verifyReferenceAudio,
              ).toBe(
                verifyReferenceAudio,
              );

              expect(
                transactionDependencies
                  .downloadOutput,
              ).toEqual(
                expect.any(
                  Function,
                ),
              );

              await expect(
                transactionDependencies
                  .downloadOutput(
                    "https://example.test/output.mp3",
                    "D:/Busybookie/Production/generated-dialogue/output.audio",
                  ),
              ).rejects.toThrow(
                /Downloader should be passed through but not invoked by this runner wiring test/i,
              );

              expect(
                downloadOutput,
              ).toHaveBeenCalledTimes(
                1,
              );

              expect(
                downloadOutput,
              ).toHaveBeenCalledWith(
                "https://example.test/output.mp3",
                "D:/Busybookie/Production/generated-dialogue/output.audio",
              );

              expect(
                transactionDependencies
                  .writeGenerationRecord,
              ).toBe(
                writeGenerationRecord,
              );

              await expect(
                transactionDependencies
                  .uploadReferenceAudio(
                    "D:/Busybookie/Production/references/voices/OLLIE/ollie-reference-v1.mp3",
                  ),
              ).resolves.toBe(
                "runway://ephemeral/ollie-reference-v1",
              );

              await expect(
                transactionDependencies
                  .executeGeneration(
                    request,
                    600_000,
                    recoveryMetadata,
                  ),
              ).resolves.toBe(
                executionResult,
              );

              return transactionResult;
            },
          );

        const dependencies = {
          runTransaction,
          verifyReferenceAudio,
          uploadReferenceAudio,
          executeGeneration,
          downloadOutput,
          writeGenerationRecord,
        } satisfies
          RunwayDirectSeedAudioProductionTransactionRunnerDependencies;

        const runner =
          createRunwayDirectSeedAudioProductionTransactionRunner(
            client,
            dependencies,
          );

        await expect(
          runner(
            input,
            onSubmissionAccepted,
          ),
        ).resolves.toBe(
          transactionResult,
        );

        expect(
          uploadReferenceAudio,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          executeGeneration,
        ).toHaveBeenCalledTimes(
          1,
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
            "task-seed-audio-production-runner",

          providerEstimatedCredits:
            5.25,

          recoveryMetadata,
        });
      },
    );

    it(
      "propagates durable acceptance failure without masking or replacing recovery metadata",
      async () => {
        const client =
          {} as RunwayML;

        const input =
          Object.freeze({}) as
            RunwayDirectSeedAudioDialogueTransactionInput;

        const request:
          RunwayDirectSeedAudioRequest = {
            model:
              "seed_audio",

            promptText:
              "Look what I found!",

            voice: {
              type:
                "reference-audio",

              audioUri:
                "runway://ephemeral/ollie-reference-v1",
            },
          };

        const recoveryMetadata =
          Object.freeze({
            marker:
              "accepted-recovery-evidence",
          }) as unknown as
            DialogueDirectSeedAudioGenerationRecoveryMetadata;

        const durableFailure =
          new Error(
            "durable v3 submission persistence failed",
          );

        const onSubmissionAccepted:
          DialogueDirectSeedAudioSubmissionAcceptedHandler =
            vi.fn(
              async (
                acceptance,
              ) => {
                expect(
                  acceptance,
                ).toEqual({
                  taskId:
                    "task-seed-audio-acceptance-failure",

                  providerEstimatedCredits:
                    2.5,

                  recoveryMetadata,
                });

                throw durableFailure;
              },
            );

        const executeGeneration =
          vi.fn(
            async (
              receivedClient:
                RunwayML,

              receivedRequest:
                RunwayDirectSeedAudioRequest,

              options:
                RunwayDirectSeedAudioExecutionOptions,
            ): Promise<
              RunwayDirectSeedAudioExecutionResult
            > => {
              expect(
                receivedClient,
              ).toBe(
                client,
              );

              expect(
                receivedRequest,
              ).toBe(
                request,
              );

              await options
                .onSubmissionAccepted({
                  taskId:
                    "task-seed-audio-acceptance-failure",

                  providerEstimatedCredits:
                    2.5,
                });

              throw new Error(
                "unreachable after durable acceptance failure",
              );
            },
          );

        const runTransaction =
          vi.fn(
            async (
              _receivedInput:
                RunwayDirectSeedAudioDialogueTransactionInput,

              transactionDependencies:
                RunwayDirectSeedAudioDialogueTransactionDependencies,
            ) =>
              transactionDependencies
                .executeGeneration(
                  request,
                  600_000,
                  recoveryMetadata,
                ),
          );

        const dependencies = {
          runTransaction,

          verifyReferenceAudio:
            vi.fn(),

          uploadReferenceAudio:
            vi.fn(),

          executeGeneration,

          downloadOutput:
            vi.fn(),

          writeGenerationRecord:
            vi.fn(),
        } as unknown as
          RunwayDirectSeedAudioProductionTransactionRunnerDependencies;

        const runner =
          createRunwayDirectSeedAudioProductionTransactionRunner(
            client,
            dependencies,
          );

        await expect(
          runner(
            input,
            onSubmissionAccepted,
          ),
        ).rejects.toBe(
          durableFailure,
        );

        expect(
          onSubmissionAccepted,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          executeGeneration,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "does not substitute the historical Eleven transaction or executor",
      () => {
        expect(
          runRunwayDirectSeedAudioDialogueTransaction,
        ).not.toBeUndefined();

        expect(
          executeRunwayDirectSeedAudio,
        ).not.toBeUndefined();

        expect(
          uploadRunwayEphemeralAsset,
        ).not.toBeUndefined();
      },
    );
  },
);
