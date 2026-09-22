import type {
  GeneratedVideo,
} from "@google/genai";

import type {
  VeoPolicy,
} from "../../schemas/veoPolicy.schema.js";

import {
  VeoGenerationRecordSchema,
  type VeoGenerationRecord,
} from "../audit/veoGenerationRecord.schema.js";

import type {
  PreparedVeoImageAsset,
} from "../assets/prepareVeoImageAsset.js";

import type {
  VeoExecutionResult,
} from "./veoExecution.js";

import {
  buildVeoGenerateRequest,
} from "../generation/buildVeoGenerateRequest.js";

import {
  createVeoVideoOutputPath,
} from "../output/veoOutputPath.js";

import {
  VEO_MAX_OUTPUT_BYTES,
  type PersistedVeoOutput,
} from "../output/persistVeoGeneratedVideo.js";

import {
  assertVeoWithinBudget,
} from "../veoBudget.js";

export type VeoImagePreparer =
  (
    filePath:
      string,

    maxBytes:
      number,
  ) =>
    Promise<
      PreparedVeoImageAsset
    >;

export type VeoGenerationExecutor =
  (
    request:
      ReturnType<
        typeof buildVeoGenerateRequest
      >,

    options:
      Readonly<{
        pollIntervalMs:
          number;

        timeoutMs:
          number;
      }>,
  ) =>
    Promise<
      VeoExecutionResult
    >;

export type VeoOutputPersister =
  (
    generatedVideo:
      GeneratedVideo,

    destinationPath:
      string,

    maxBytes:
      number,
  ) =>
    Promise<
      PersistedVeoOutput
    >;

export type VeoGenerationRecordWriter =
  (
    mediaRoot:
      string,

    record:
      VeoGenerationRecord,
  ) =>
    Promise<string>;

export type VeoImageToVideoTransactionInput =
  Readonly<{
    episodeId:
      string;

    shotId:
      string;

    sourceImagePath:
      string;

    promptText:
      string;

    durationSeconds:
      number;

    mediaRoot:
      string;

    policy:
      VeoPolicy;
  }>;

export type VeoImageToVideoTransactionDependencies =
  Readonly<{
    prepareImageAsset:
      VeoImagePreparer;

    executeGeneration:
      VeoGenerationExecutor;

    persistGeneratedVideo:
      VeoOutputPersister;

    writeGenerationRecord:
      VeoGenerationRecordWriter;

    now?:
      () => string;
  }>;

export type VeoImageToVideoTransactionResult =
  Readonly<{
    record:
      VeoGenerationRecord;

    recordPath:
      string;
  }>;

export async function runVeoImageToVideoTransaction(
  input:
    VeoImageToVideoTransactionInput,

  dependencies:
    VeoImageToVideoTransactionDependencies,
): Promise<VeoImageToVideoTransactionResult> {
  const locallyExpectedCents =
    assertVeoWithinBudget(
      input.durationSeconds,
      input.policy,
    );

  const preparedImage =
    await dependencies
      .prepareImageAsset(
        input.sourceImagePath,
        input.policy
          .generation
          .maxImageBytes,
      );

  const request =
    buildVeoGenerateRequest(
      {
        promptText:
          input.promptText,

        durationSeconds:
          input.durationSeconds,

        image:
          preparedImage.image,
      },
      input.policy,
    );

  const execution =
    await dependencies
      .executeGeneration(
        request,
        {
          pollIntervalMs:
            input.policy
              .operation
              .pollIntervalMs,

          timeoutMs:
            input.policy
              .operation
              .timeoutMs,
        },
      );

  if (
    execution
      .generatedVideos
      .length !==
    input.policy
      .generation
      .numberOfVideos
  ) {
    throw new Error(
      `Veo returned ${execution.generatedVideos.length} generated videos but local policy expected ${input.policy.generation.numberOfVideos}.`,
    );
  }

  const outputs:
    VeoGenerationRecord["outputs"] =
      [];

  for (
    const [
      zeroBasedIndex,
      generatedVideo,
    ]
    of execution
      .generatedVideos
      .entries()
  ) {
    const outputIndex =
      zeroBasedIndex + 1;

    const destinationPath =
      createVeoVideoOutputPath(
        input.mediaRoot,
        input.episodeId,
        input.shotId,
        execution.operationName,
        outputIndex,
      );

    const persisted =
      await dependencies
        .persistGeneratedVideo(
          generatedVideo,
          destinationPath,
          VEO_MAX_OUTPUT_BYTES,
        );

    outputs.push({
      outputIndex,

      destinationPath:
        persisted
          .destinationPath,

      bytes:
        persisted.bytes,

      sha256:
        persisted.sha256,

      contentType:
        persisted.contentType,
    });
  }

  const recordedAt =
    dependencies.now
      ? dependencies.now()
      : new Date()
          .toISOString();

  const record =
    VeoGenerationRecordSchema
      .parse({
        schemaVersion:
          "1.0",

        recordedAt,

        provider:
          "VEO",

        model:
          request.model,

        status:
          "SUCCEEDED",

        episodeId:
          input.episodeId,

        shotId:
          input.shotId,

        operationName:
          execution
            .operationName,

        request: {
          durationSeconds:
            request
              .config
              .durationSeconds,

          aspectRatio:
            request
              .config
              .aspectRatio,

          resolution:
            request
              .config
              .resolution,

          numberOfVideos:
            request
              .config
              .numberOfVideos,

          generateAudio:
            request
              .config
              .generateAudio,

          expectedOutputFps:
            input.policy
              .generation
              .expectedOutputFps,

          promptText:
            request.prompt,

          sourceImagePath:
            preparedImage
              .sourcePath,

          imageMimeType:
            preparedImage
              .image
              .mimeType,
        },

        costPolicy: {
          pricingReviewedOn:
            input.policy
              .pricingReviewedOn,

          centsPerSecond:
            input.policy
              .generation
              .centsPerSecond,

          locallyExpectedCents,
        },

        safety: {
          raiMediaFilteredCount:
            execution
              .raiMediaFilteredCount,

          raiMediaFilteredReasons:
            [
              ...execution
                .raiMediaFilteredReasons,
            ],
        },

        outputs,
      });

  const recordPath =
    await dependencies
      .writeGenerationRecord(
        input.mediaRoot,
        record,
      );

  return Object.freeze({
    record,
    recordPath,
  });
}
