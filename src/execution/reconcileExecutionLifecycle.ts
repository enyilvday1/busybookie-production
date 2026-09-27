import {
  inspectExecutionLifecycle,
} from "./inspectExecutionLifecycle.js";

import {
  recoverExecutionCompletion,
} from "./recoverExecutionCompletion.js";

import type {
  ExecutionCompletion,
} from "./executionCompletion.schema.js";

import {
  recoverRunwayGenerationRecord,
} from "../runway/audit/recoverRunwayGenerationRecord.js";

import type {
  RunwayGenerationRecord,
} from "../runway/audit/runwayGenerationRecord.schema.js";

import {
  createRunwayVideoOutputPath,
} from "../runway/output/runwayOutputPath.js";

import {
  recoverRunwayOutput,
} from "../runway/output/recoverRunwayOutput.js";

import type {
  ResumeRunwayGen45TaskInput,
} from "../runway/execution/resumeRunwayGen45Task.js";

import type {
  RunwayGen45ExecutionResult,
} from "../runway/execution/runwayGen45Execution.js";

export type ExecutionLifecycleReconciliationInput =
  Readonly<{
    mediaRoot:
      string;

    episodeId:
      string;

    shotId:
      string;

    runwayWaitTimeoutMs:
      number;
  }>;

export type ExecutionLifecycleReconciliationDependencies =
  Readonly<{
    inspectLifecycle:
      typeof inspectExecutionLifecycle;

    resumeRunwayTask:
      (
        input:
          ResumeRunwayGen45TaskInput,
      ) =>
        Promise<
          RunwayGen45ExecutionResult
        >;

    recoverRunwayOutput?:
      typeof recoverRunwayOutput;

    recoverRunwayGenerationRecord?:
      typeof recoverRunwayGenerationRecord;

    recoverExecutionCompletion?:
      typeof recoverExecutionCompletion;

    now?:
      () => string;
  }>;

export type ExecutionLifecycleReconciliationResult =
  Readonly<{
    lifecycleState:
      "COMPLETED";

    provider:
      "RUNWAY";

    providerExecutionId:
      string;

    providerExecution:
      RunwayGen45ExecutionResult;

    generationRecord:
      RunwayGenerationRecord;

    generationRecordPath:
      string;

    completion:
      ExecutionCompletion;

    completionPath:
      string;
  }>;

export async function reconcileExecutionLifecycle(
  input:
    ExecutionLifecycleReconciliationInput,

  dependencies:
    ExecutionLifecycleReconciliationDependencies,
): Promise<ExecutionLifecycleReconciliationResult> {
  const lifecycle =
    await dependencies
      .inspectLifecycle(
        input.mediaRoot,
        input.episodeId,
        input.shotId,
      );

  if (
    lifecycle.state !==
    "SUBMITTED"
  ) {
    throw new Error(
      `Execution lifecycle reconciliation currently requires SUBMITTED state; received ${lifecycle.state}.`,
    );
  }

  const submission =
    lifecycle.submission;

  if (
    submission.provider !==
    "RUNWAY"
  ) {
    throw new Error(
      `Execution lifecycle reconciliation for provider ${submission.provider} is not implemented in this milestone.`,
    );
  }

  if (
    submission.schemaVersion ===
    "1.0"
  ) {
    throw new Error(
      "Legacy Runway 1.0 submissions require manual reconciliation.",
    );
  }

  if (
    submission.schemaVersion ===
    "1.1"
  ) {
    throw new Error(
      "Runway 1.1 submissions require manual reconciliation because durable recovery metadata is unavailable.",
    );
  }

  const providerExecution =
    await dependencies
      .resumeRunwayTask({
        taskId:
          submission
            .providerExecutionId,

        providerEstimatedCredits:
          submission
            .providerEstimatedCredits,

        waitTimeoutMs:
          input
            .runwayWaitTimeoutMs,
      });

  if (
    providerExecution.taskId !==
    submission.providerExecutionId
  ) {
    throw new Error(
      `Runway reconciliation returned task ID ${providerExecution.taskId} but durable submission records ${submission.providerExecutionId}.`,
    );
  }

  const recoverOutput =
    dependencies
      .recoverRunwayOutput ??
    recoverRunwayOutput;

  const outputs:
    RunwayGenerationRecord["outputs"] =
    [];

  for (
    const [
      zeroBasedIndex,
      outputUrl,
    ]
    of providerExecution
      .outputUrls
      .entries()
  ) {
    const outputIndex =
      zeroBasedIndex + 1;

    const destinationPath =
      createRunwayVideoOutputPath(
        input.mediaRoot,
        submission.episodeId,
        submission.shotId,
        submission.providerExecutionId,
        outputIndex,
      );

    const recovered =
      await recoverOutput(
        outputUrl,
        destinationPath,
      );

    outputs.push({
      outputIndex,

      destinationPath:
        recovered.destinationPath,

      bytes:
        recovered.bytes,

      sha256:
        recovered.sha256,

      contentType:
        recovered.contentType,
    });
  }

  const recordedAt =
    dependencies.now
      ? dependencies.now()
      : new Date().toISOString();

  const recoverGenerationRecord =
    dependencies
      .recoverRunwayGenerationRecord ??
    recoverRunwayGenerationRecord;

  const generationRecovery =
    await recoverGenerationRecord(
      input.mediaRoot,
      {
        recordedAt,

        episodeId:
          submission.episodeId,

        shotId:
          submission.shotId,

        taskId:
          submission
            .providerExecutionId,

        request:
          submission
            .recoveryMetadata
            .request,

        credits: {
          locallyExpected:
            submission
              .recoveryMetadata
              .locallyExpectedCredits,

          providerEstimated:
            submission
              .providerEstimatedCredits,

          providerFinal:
            providerExecution
              .finalCredits,
        },

        outputs,
      },
    );

  const recoverCompletion =
    dependencies
      .recoverExecutionCompletion ??
    recoverExecutionCompletion;

  const completionRecovery =
    await recoverCompletion(
      input.mediaRoot,
      {
        reservationId:
          lifecycle
            .reservation
            .reservationId,

        episodeId:
          submission.episodeId,

        shotId:
          submission.shotId,

        provider:
          submission.provider,

        providerExecutionId:
          submission
            .providerExecutionId,

        generationRecordPath:
          generationRecovery
            .recordPath,
      },
    );

  return Object.freeze({
    lifecycleState:
      "COMPLETED",

    provider:
      "RUNWAY",

    providerExecutionId:
      submission
        .providerExecutionId,

    providerExecution,

    generationRecord:
      generationRecovery.record,

    generationRecordPath:
      generationRecovery.recordPath,

    completion:
      completionRecovery.record,

    completionPath:
      completionRecovery
        .completionPath,
  });
}
