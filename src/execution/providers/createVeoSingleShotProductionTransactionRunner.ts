import type {
  GoogleGenAI,
} from "@google/genai";

import {
  prepareVeoImageAsset,
} from "../../veo/assets/prepareVeoImageAsset.js";

import {
  writeVeoGenerationRecord,
} from "../../veo/audit/writeVeoGenerationRecord.js";

import {
  runVeoImageToVideoTransaction,
} from "../../veo/execution/runVeoImageToVideoTransaction.js";

import {
  executeVeoGeneration,
} from "../../veo/execution/veoExecution.js";

import {
  persistVeoGeneratedVideo,
} from "../../veo/output/persistVeoGeneratedVideo.js";

import type {
  VeoSingleShotTransactionRunner,
} from "./executeVeoSingleShot.js";

export type VeoSingleShotProductionTransactionRunnerDependencies =
  Readonly<{
    runTransaction:
      typeof runVeoImageToVideoTransaction;

    prepareImageAsset:
      typeof prepareVeoImageAsset;

    executeGeneration:
      typeof executeVeoGeneration;

    persistGeneratedVideo:
      typeof persistVeoGeneratedVideo;

    writeGenerationRecord:
      typeof writeVeoGenerationRecord;
  }>;

const defaultDependencies:
  VeoSingleShotProductionTransactionRunnerDependencies =
  Object.freeze({
    runTransaction:
      runVeoImageToVideoTransaction,

    prepareImageAsset:
      prepareVeoImageAsset,

    executeGeneration:
      executeVeoGeneration,

    persistGeneratedVideo:
      persistVeoGeneratedVideo,

    writeGenerationRecord:
      writeVeoGenerationRecord,
  });

export function createVeoSingleShotProductionTransactionRunner(
  client:
    GoogleGenAI,

  dependencies:
    VeoSingleShotProductionTransactionRunnerDependencies =
      defaultDependencies,
): VeoSingleShotTransactionRunner {
  return async (
    input,
    onSubmissionAccepted,
  ) =>
    dependencies
      .runTransaction(
        input,
        {
          prepareImageAsset:
            (
              filePath,
              maxBytes,
            ) =>
              dependencies
                .prepareImageAsset(
                  filePath,
                  maxBytes,
                ),

          executeGeneration:
            (
              request,
              executionOptions,
            ) =>
              dependencies
                .executeGeneration(
                  client,
                  {
                    model:
                      request.model,

                    source: {
                      prompt:
                        request.source
                          .prompt,

                      ...(
                        request.source.image
                          ? {
                              image:
                                request.source
                                  .image,
                            }
                          : {}
                      ),
                    },

                    config:
                      request.config,
                  },
                  {
                    ...executionOptions,

                    onSubmissionAccepted,
                  },
                ),

          persistGeneratedVideo:
            (
              generatedVideo,
              destinationPath,
              maxBytes,
            ) =>
              dependencies
                .persistGeneratedVideo(
                  generatedVideo,
                  destinationPath,
                  (downloadParameters) =>
                    client.files
                      .download(
                        downloadParameters,
                      ),
                  maxBytes,
                ),

          writeGenerationRecord:
            dependencies
              .writeGenerationRecord,
        },
      );
}
