import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createRunwayDialogueProductionTransactionRunner,
} from "../src/dialogue/createRunwayDialogueProductionTransactionRunner.js";

import {
  executeRunwayElevenV3,
} from "../src/dialogue/runwayElevenV3Execution.js";

import {
  runRunwayElevenV3DialogueTransaction,
  type DialogueGenerationRecoveryMetadata,
  type DialogueGenerationRecordWriter,
  type DialogueOutputDownloader,
} from "../src/dialogue/runRunwayElevenV3Transaction.js";

type RunwayDialogueProductionTransactionRunnerDependencies =
  Readonly<{
    runTransaction:
      typeof runRunwayElevenV3DialogueTransaction;

    executeGeneration:
      typeof executeRunwayElevenV3;

    downloadOutput:
      DialogueOutputDownloader;

    writeGenerationRecord:
      DialogueGenerationRecordWriter;
  }>;

describe(
  "Busybookie Runway dialogue production transaction runner",
  () => {
    it(
      "injects the Runway client and forwards immutable recovery metadata through accepted-task persistence",
      async () => {
        const client =
          Object.freeze({
            marker:
              "mock-runway-dialogue-client",
          }) as unknown as Parameters<
            typeof createRunwayDialogueProductionTransactionRunner
          >[0];

        const recoveryMetadata:
          DialogueGenerationRecoveryMetadata =
            Object.freeze({
              request:
                Object.freeze({
                  model:
                    "eleven_v3",

                  promptText:
                    "Look what I found!",

                  voice:
                    Object.freeze({
                      type:
                        "runway-preset",

                      presetId:
                        "Chad",
                    }),

                  applyTextNormalization:
                    "auto",

                  languageCode:
                    "en",

                  seed:
                    0,

                  similarityBoost:
                    0.75,

                  speed:
                    1,

                  stability:
                    0.5,

                  style:
                    0,

                  useSpeakerBoost:
                    true,
                }),

              locallyExpectedCredits:
                1,

              plan:
                Object.freeze({
                  planKey:
                    "a".repeat(
                      64,
                    ),

                  episodeId:
                    "EP02",

                  sceneId:
                    "SC01",

                  shotId:
                    "S02",

                  dialogueLineId:
                    "EP02_SC01_S02_L01",

                  lineNumber:
                    1,

                  characterId:
                    "OLLIE",

                  characterName:
                    "Ollie",

                  text:
                    "Look what I found!",

                  deliveryNotes:
                    "Curious, excited and gentle.",

                  voice:
                    Object.freeze({
                      provider:
                        "RUNWAY",

                      voiceName:
                        "Chad",

                      deliveryTraits: [
                        "young",
                        "curious",
                        "warm",
                        "friendly",
                        "natural",
                      ],
                    }),
                }),
            });

        const onSubmissionAccepted =
          vi.fn(
            async () =>
              undefined,
          );

        const executeGeneration =
          vi.fn<
            RunwayDialogueProductionTransactionRunnerDependencies[
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

              expect(
                options.waitTimeoutMs,
              ).toBe(
                600_000,
              );

              await options
                .onSubmissionAccepted({
                  taskId:
                    "task-dialogue-production-1",

                  providerEstimatedCredits:
                    1,
                });

              return {
                taskId:
                  "task-dialogue-production-1",

                providerCreatedAt:
                  "2026-10-01T22:40:00.000Z",

                estimatedCredits:
                  1,

                finalCredits:
                  1,

                outputUrls: [
                  "https://example.test/dialogue.audio",
                ],
              };
            },
          );

        const downloadOutput =
          vi.fn<
            RunwayDialogueProductionTransactionRunnerDependencies[
              "downloadOutput"
            ]
          >(
            async (
              _sourceUrl,
              destinationPath,
            ) => ({
              destinationPath,

              bytes:
                123,

              sha256:
                "b".repeat(
                  64,
                ),

              contentType:
                "audio/mpeg",
            }),
          );

        const writeGenerationRecord =
          vi.fn<
            RunwayDialogueProductionTransactionRunnerDependencies[
              "writeGenerationRecord"
            ]
          >(
            async () =>
              "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01_RUNWAY_task-dialogue-production-1.dialogue-generation.json",
          );

        const runTransaction =
          vi.fn<
            RunwayDialogueProductionTransactionRunnerDependencies[
              "runTransaction"
            ]
          >(
            async (
              _input,
              transactionDependencies,
            ) => {
              const request =
                recoveryMetadata
                  .request;

              const execution =
                await transactionDependencies
                  .executeGeneration(
                    request,
                    600_000,
                    recoveryMetadata,
                  );

              const downloaded =
                await transactionDependencies
                  .downloadOutput(
                    execution.outputUrls[0]!,
                    "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/mock.audio",
                  );

              expect(
                downloaded.bytes,
              ).toBe(
                123,
              );

              const recordPath =
                await transactionDependencies
                  .writeGenerationRecord(
                    "D:/Busybookie/Production",
                    {} as Parameters<
                      typeof transactionDependencies.writeGenerationRecord
                    >[1],
                  );

              return {
                record: {
                  schemaVersion:
                    "1.0",

                  recordedAt:
                    "2026-10-01T22:41:00.000Z",

                  status:
                    "SUCCEEDED",

                  provider:
                    "RUNWAY",

                  providerExecutionId:
                    execution.taskId,

                  providerModel:
                    "eleven_v3",

                  providerCreatedAt:
                    execution.providerCreatedAt,

                  request,

                  credits: {
                    locallyExpected:
                      1,

                    providerEstimated:
                      execution.estimatedCredits,

                    providerFinal:
                      execution.finalCredits,
                  },

                  plan:
                    recoveryMetadata.plan,

                  outputs: [
                    {
                      outputIndex:
                        1,

                      destinationPath:
                        downloaded.destinationPath,

                      bytes:
                        downloaded.bytes,

                      sha256:
                        downloaded.sha256,

                      contentType:
                        downloaded.contentType,
                    },
                  ],
                },

                recordPath,
              };
            },
          );

        const dependencies = {
          runTransaction,
          executeGeneration,
          downloadOutput,
          writeGenerationRecord,
        } satisfies
          RunwayDialogueProductionTransactionRunnerDependencies;

        const runner =
          createRunwayDialogueProductionTransactionRunner(
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
          taskId:
            "task-dialogue-production-1",

          providerEstimatedCredits:
            1,

          recoveryMetadata,
        });

        expect(
          executeGeneration,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          downloadOutput,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          writeGenerationRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result.record
            .providerExecutionId,
        ).toBe(
          "task-dialogue-production-1",
        );
      },
    );
  },
);
