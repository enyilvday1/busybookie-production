import {
  downloadDialogueAudioOutput,
} from "./downloadDialogueAudioOutput.js";

import type {
  DialogueLineTransactionRunner,
} from "./executeDialogueLine.js";

import {
  runRunwayElevenV3DialogueTransaction,
  type DialogueGenerationRecordWriter,
  type DialogueOutputDownloader,
} from "./runRunwayElevenV3Transaction.js";

import {
  executeRunwayElevenV3,
} from "./runwayElevenV3Execution.js";

import {
  writeDialogueGenerationRecord,
} from "./writeDialogueGenerationRecord.js";

type RunwayClient =
  Parameters<
    typeof executeRunwayElevenV3
  >[0];

export type RunwayDialogueProductionTransactionRunnerDependencies =
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

const defaultDependencies:
  RunwayDialogueProductionTransactionRunnerDependencies =
    Object.freeze({
      runTransaction:
        runRunwayElevenV3DialogueTransaction,

      executeGeneration:
        executeRunwayElevenV3,

      downloadOutput:
        downloadDialogueAudioOutput,

      writeGenerationRecord:
        writeDialogueGenerationRecord,
    });

export function createRunwayDialogueProductionTransactionRunner(
  client:
    RunwayClient,

  dependencies:
    RunwayDialogueProductionTransactionRunnerDependencies =
      defaultDependencies,
): DialogueLineTransactionRunner {
  return async (
    input,
    onSubmissionAccepted,
  ) =>
    dependencies
      .runTransaction(
        input,
        {
          executeGeneration:
            (
              request,
              waitTimeoutMs,
              recoveryMetadata,
            ) =>
              dependencies
                .executeGeneration(
                  client,
                  request,
                  {
                    waitTimeoutMs,

                    onSubmissionAccepted:
                      async (
                        acceptance,
                      ) =>
                        onSubmissionAccepted({
                          taskId:
                            acceptance.taskId,

                          providerEstimatedCredits:
                            acceptance
                              .providerEstimatedCredits,

                          recoveryMetadata,
                        }),
                  },
                ),

          downloadOutput:
            (
              sourceUrl,
              destinationPath,
            ) =>
              dependencies
                .downloadOutput(
                  sourceUrl,
                  destinationPath,
                ),

          writeGenerationRecord:
            dependencies
              .writeGenerationRecord,
        },
      );
}
