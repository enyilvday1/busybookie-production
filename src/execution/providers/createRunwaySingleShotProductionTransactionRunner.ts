import {
  resolveRunwayImageAsset,
} from "../../runway/assets/resolveRunwayImageAsset.js";

import {
  uploadRunwayEphemeralAsset,
} from "../../runway/assets/uploadRunwayEphemeralAsset.js";

import {
  writeRunwayGenerationRecord,
} from "../../runway/audit/writeRunwayGenerationRecord.js";

import {
  runRunwayGen45Transaction,
} from "../../runway/execution/runRunwayGen45Transaction.js";

import {
  executeRunwayGen45,
} from "../../runway/execution/runwayGen45Execution.js";

import {
  downloadRunwayOutput,
} from "../../runway/output/downloadRunwayOutput.js";

import type {
  RunwaySingleShotTransactionRunner,
} from "./executeRunwaySingleShot.js";

type RunwayClient =
  Parameters<
    typeof executeRunwayGen45
  >[0];

export type RunwaySingleShotProductionTransactionRunnerDependencies =
  Readonly<{
    runTransaction:
      typeof runRunwayGen45Transaction;

    resolveImageAsset:
      typeof resolveRunwayImageAsset;

    uploadEphemeralAsset:
      typeof uploadRunwayEphemeralAsset;

    executeGeneration:
      typeof executeRunwayGen45;

    downloadOutput:
      typeof downloadRunwayOutput;

    writeGenerationRecord:
      typeof writeRunwayGenerationRecord;
  }>;

const defaultDependencies:
  RunwaySingleShotProductionTransactionRunnerDependencies =
  Object.freeze({
    runTransaction:
      runRunwayGen45Transaction,

    resolveImageAsset:
      resolveRunwayImageAsset,

    uploadEphemeralAsset:
      uploadRunwayEphemeralAsset,

    executeGeneration:
      executeRunwayGen45,

    downloadOutput:
      downloadRunwayOutput,

    writeGenerationRecord:
      writeRunwayGenerationRecord,
  });

export function createRunwaySingleShotProductionTransactionRunner(
  client:
    RunwayClient,

  dependencies:
    RunwaySingleShotProductionTransactionRunnerDependencies =
      defaultDependencies,
): RunwaySingleShotTransactionRunner {
  return async (
    input,
    onSubmissionAccepted,
  ) =>
    dependencies
      .runTransaction(
        input,
        {
          resolveImageAsset:
            (filePath) =>
              dependencies
                .resolveImageAsset(
                  filePath,
                  (uploadPath) =>
                    dependencies
                      .uploadEphemeralAsset(
                        client,
                        uploadPath,
                      ),
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
                          provider:
                            "RUNWAY",

                          providerExecutionId:
                            acceptance.taskId,

                          providerEstimatedCredits:
                            acceptance.providerEstimatedCredits,

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
