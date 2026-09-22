import type {
  RunwayPolicy,
} from "../../schemas/runwayPolicy.schema.js";

import {
  RunwayGenerationRecordSchema,
  type RunwayGenerationRecord,
} from "../audit/runwayGenerationRecord.schema.js";

import type {
  ResolvedRunwayImageAsset,
} from "../assets/resolveRunwayImageAsset.js";

import {
  buildGen45Request,
} from "../gen45/buildGen45Request.js";

import type {
  Gen45Request,
} from "../gen45/gen45Request.schema.js";

import {
  createRunwayVideoOutputPath,
} from "../output/runwayOutputPath.js";

import type {
  DownloadedRunwayOutput,
} from "../output/downloadRunwayOutput.js";

import {
  assertGen45WithinBudget,
} from "../runwayBudget.js";

import type {
  RunwayGen45ExecutionResult,
} from "./runwayGen45Execution.js";

export type RunwayImageResolver =
  (
    filePath: string,
  ) => Promise<ResolvedRunwayImageAsset>;

export type RunwayGenerationExecutor =
  (
    request: Gen45Request,
    waitTimeoutMs: number,
  ) => Promise<RunwayGen45ExecutionResult>;

export type RunwayOutputDownloader =
  (
    sourceUrl: string,
    destinationPath: string,
  ) => Promise<DownloadedRunwayOutput>;

export type RunwayGenerationRecordWriter =
  (
    mediaRoot: string,
    record: RunwayGenerationRecord,
  ) => Promise<string>;

export type RunwayGen45TransactionInput =
  Readonly<{
    episodeId: string;
    shotId: string;

    sourceImagePath:
      string;

    promptText:
      string;

    durationSeconds:
      number;

    mediaRoot:
      string;

    policy:
      RunwayPolicy;
  }>;

export type RunwayGen45TransactionDependencies =
  Readonly<{
    resolveImageAsset:
      RunwayImageResolver;

    executeGeneration:
      RunwayGenerationExecutor;

    downloadOutput:
      RunwayOutputDownloader;

    writeGenerationRecord:
      RunwayGenerationRecordWriter;

    now?: () => string;
  }>;

export type RunwayGen45TransactionResult =
  Readonly<{
    record:
      RunwayGenerationRecord;

    recordPath:
      string;
  }>;

export async function runRunwayGen45Transaction(
  input:
    RunwayGen45TransactionInput,

  dependencies:
    RunwayGen45TransactionDependencies,
): Promise<RunwayGen45TransactionResult> {
  const locallyExpectedCredits =
    assertGen45WithinBudget(
      input.durationSeconds,
      input.policy,
    );

  const resolvedAsset =
    await dependencies
      .resolveImageAsset(
        input.sourceImagePath,
      );

  const request =
    buildGen45Request({
      promptImage:
        resolvedAsset.uri,

      promptText:
        input.promptText,

      durationSeconds:
        input.durationSeconds,
    });

  const execution =
    await dependencies
      .executeGeneration(
        request,
        input.policy.task.waitTimeoutMs,
      );

  const outputs:
    RunwayGenerationRecord["outputs"] =
      [];

  for (
    const [
      zeroBasedIndex,
      outputUrl,
    ]
    of execution.outputUrls.entries()
  ) {
    const outputIndex =
      zeroBasedIndex + 1;

    const destinationPath =
      createRunwayVideoOutputPath(
        input.mediaRoot,
        input.episodeId,
        input.shotId,
        execution.taskId,
        outputIndex,
      );

    const downloaded =
      await dependencies
        .downloadOutput(
          outputUrl,
          destinationPath,
        );

    outputs.push({
      outputIndex,
      destinationPath:
        downloaded.destinationPath,
      bytes:
        downloaded.bytes,
      sha256:
        downloaded.sha256,
      contentType:
        downloaded.contentType,
    });
  }

  const recordedAt =
    dependencies.now
      ? dependencies.now()
      : new Date().toISOString();

  const record =
    RunwayGenerationRecordSchema.parse({
      schemaVersion:
        "1.0",

      recordedAt,

      provider:
        "RUNWAY",

      model:
        "gen4.5",

      status:
        "SUCCEEDED",

      episodeId:
        input.episodeId,

      shotId:
        input.shotId,

      taskId:
        execution.taskId,

      request: {
        durationSeconds:
          request.duration,

        ratio:
          request.ratio,

        outputFormat:
          request.outputFormat,

        promptText:
          request.promptText,

        sourceImagePath:
          resolvedAsset.sourcePath,

        assetStrategy:
          resolvedAsset.strategy,
      },

      credits: {
        locallyExpected:
          locallyExpectedCredits,

        providerEstimated:
          execution.estimatedCredits,

        providerFinal:
          execution.finalCredits,
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
