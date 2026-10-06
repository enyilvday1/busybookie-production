import {
  uploadRunwayEphemeralAsset,
} from "../runway/assets/uploadRunwayEphemeralAsset.js";

import {
  downloadDialogueAudioOutput,
} from "./downloadDialogueAudioOutput.js";

import type {
  DialogueDirectSeedAudioLineTransactionRunner,
} from "./executeDialogueDirectSeedAudioLine.js";

import {
  runRunwayDirectSeedAudioDialogueTransaction,
  type DialogueDirectSeedAudioGenerationRecordWriter,
  type DialogueDirectSeedAudioOutputDownloader,
  type DialogueDirectSeedAudioReferenceVerifier,
} from "./runRunwayDirectSeedAudioDialogueTransaction.js";

import {
  executeRunwayDirectSeedAudio,
} from "./runwayDirectSeedAudioExecution.js";

import {
  verifyRunwayReferenceAudioAsset,
} from "./verifyRunwayReferenceAudioAsset.js";

import {
  writeDialogueGenerationRecord,
} from "./writeDialogueGenerationRecord.js";

type RunwayClient =
  Parameters<
    typeof executeRunwayDirectSeedAudio
  >[0];

export type RunwayDirectSeedAudioProductionTransactionRunnerDependencies =
  Readonly<{
    runTransaction:
      typeof runRunwayDirectSeedAudioDialogueTransaction;

    verifyReferenceAudio:
      DialogueDirectSeedAudioReferenceVerifier;

    uploadReferenceAudio:
      typeof uploadRunwayEphemeralAsset;

    executeGeneration:
      typeof executeRunwayDirectSeedAudio;

    downloadOutput:
      DialogueDirectSeedAudioOutputDownloader;

    writeGenerationRecord:
      DialogueDirectSeedAudioGenerationRecordWriter;
  }>;

const defaultDependencies:
  RunwayDirectSeedAudioProductionTransactionRunnerDependencies =
    Object.freeze({
      runTransaction:
        runRunwayDirectSeedAudioDialogueTransaction,

      verifyReferenceAudio:
        verifyRunwayReferenceAudioAsset,

      uploadReferenceAudio:
        uploadRunwayEphemeralAsset,

      executeGeneration:
        executeRunwayDirectSeedAudio,

      downloadOutput:
        downloadDialogueAudioOutput,

      writeGenerationRecord:
        writeDialogueGenerationRecord,
    });

export function createRunwayDirectSeedAudioProductionTransactionRunner(
  client:
    RunwayClient,

  dependencies:
    RunwayDirectSeedAudioProductionTransactionRunnerDependencies =
      defaultDependencies,
): DialogueDirectSeedAudioLineTransactionRunner {
  return async (
    input,
    onSubmissionAccepted,
  ) =>
    dependencies
      .runTransaction(
        input,
        {
          verifyReferenceAudio:
            dependencies
              .verifyReferenceAudio,

          uploadReferenceAudio:
            (
              absolutePath,
            ) =>
              dependencies
                .uploadReferenceAudio(
                  client,
                  absolutePath,
                ),

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
