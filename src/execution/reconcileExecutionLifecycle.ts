import {
  isDeepStrictEqual,
} from "node:util";

import {
  inspectExecutionLifecycle,
} from "./inspectExecutionLifecycle.js";

import {
  recoverExecutionCompletion,
} from "./recoverExecutionCompletion.js";

import {
  createExecutionCompletionPath,
} from "./executionCompletionPath.js";

import type {
  ExecutionCompletion,
} from "./executionCompletion.schema.js";

import {
  recoverRunwayGenerationRecord,
} from "../runway/audit/recoverRunwayGenerationRecord.js";

import {
  readRunwayGenerationRecord,
} from "../runway/audit/readRunwayGenerationRecord.js";

import {
  createRunwayGenerationRecordPathFromIdentity,
} from "../runway/audit/writeRunwayGenerationRecord.js";

import type {
  RunwayGenerationRecord,
} from "../runway/audit/runwayGenerationRecord.schema.js";

import {
  createRunwayVideoOutputPath,
} from "../runway/output/runwayOutputPath.js";

import {
  inspectRunwayOutput,
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

    inspectRunwayOutput?:
      typeof inspectRunwayOutput;

    recoverRunwayGenerationRecord?:
      typeof recoverRunwayGenerationRecord;

    readRunwayGenerationRecord?:
      typeof readRunwayGenerationRecord;

    recoverExecutionCompletion?:
      typeof recoverExecutionCompletion;

    now?:
      () => string;
  }>;

export type ExecutionLifecycleReconciliationResult =
  | Readonly<{
      lifecycleState:
        "COMPLETED";

      reconciliationMode:
        "RECOVERED_SUBMISSION";

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
    }>
  | Readonly<{
      lifecycleState:
        "COMPLETED";

      reconciliationMode:
        "DURABLE_COMPLETION";

      provider:
        "RUNWAY";

      providerExecutionId:
        string;

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
    lifecycle.state ===
    "COMPLETED"
  ) {
    const submission =
      lifecycle.submission;

    const completion =
      lifecycle.completion;

    if (
      submission.provider !==
      "RUNWAY"
    ) {
      throw new Error(
        `Execution lifecycle reconciliation for completed provider ${submission.provider} is not implemented in this milestone.`,
      );
    }

    if (
      submission.schemaVersion !==
      "1.2"
    ) {
      throw new Error(
        `Completed Runway submission schema ${submission.schemaVersion} cannot be automatically reconciled because durable recovery metadata is unavailable.`,
      );
    }

    const generationRecordPath =
      createRunwayGenerationRecordPathFromIdentity(
        input.mediaRoot,
        submission.episodeId,
        submission.shotId,
        submission.providerExecutionId,
      );

    if (
      completion.generationRecordPath !==
      generationRecordPath
    ) {
      throw new Error(
        "Execution completion generation record path does not match the canonical durable Runway generation record path.",
      );
    }

    const readGenerationRecord =
      dependencies
        .readRunwayGenerationRecord ??
      readRunwayGenerationRecord;

    const generationRecord =
      await readGenerationRecord(
        input.mediaRoot,
        submission.episodeId,
        submission.shotId,
        submission.providerExecutionId,
      );

    if (!generationRecord) {
      throw new Error(
        "Execution completion references a missing durable Runway generation record.",
      );
    }

    const generationIdentityMatchesSubmission =
      generationRecord.episodeId ===
        submission.episodeId &&
      generationRecord.shotId ===
        submission.shotId &&
      generationRecord.taskId ===
        submission.providerExecutionId;

    if (
      !generationIdentityMatchesSubmission
    ) {
      throw new Error(
        "Durable Runway generation record identity does not match completed submission identity.",
      );
    }

    const generationEvidenceMatchesSubmission =
      isDeepStrictEqual(
        generationRecord.request,
        submission
          .recoveryMetadata
          .request,
      ) &&
      generationRecord
        .credits
        .locallyExpected ===
        submission
          .recoveryMetadata
          .locallyExpectedCredits &&
      generationRecord
        .credits
        .providerEstimated ===
        submission
          .providerEstimatedCredits;

    if (
      !generationEvidenceMatchesSubmission
    ) {
      throw new Error(
        "Durable Runway generation record does not match durable submission recovery metadata.",
      );
    }

    const inspectLocalRunwayOutput =
      dependencies
        .inspectRunwayOutput ??
      inspectRunwayOutput;

    for (
      const output
      of generationRecord.outputs
    ) {
      const canonicalOutputPath =
        createRunwayVideoOutputPath(
          input.mediaRoot,
          generationRecord.episodeId,
          generationRecord.shotId,
          generationRecord.taskId,
          output.outputIndex,
        );

      if (
        output.destinationPath !==
        canonicalOutputPath
      ) {
        throw new Error(
          "Durable Runway generation record output path does not match canonical output path.",
        );
      }

      const inspectedOutput =
        await inspectLocalRunwayOutput(
          output.destinationPath,
        );

      if (
        inspectedOutput.bytes !==
          output.bytes ||
        inspectedOutput.sha256 !==
          output.sha256
      ) {
        throw new Error(
          "Durable Runway local output does not match generation record evidence.",
        );
      }
    }

    return Object.freeze({
      lifecycleState:
        "COMPLETED",

      reconciliationMode:
        "DURABLE_COMPLETION",

      provider:
        "RUNWAY",

      providerExecutionId:
        submission
          .providerExecutionId,

      generationRecord,

      generationRecordPath,

      completion,

      completionPath:
        createExecutionCompletionPath(
          input.mediaRoot,
          completion.episodeId,
          completion.shotId,
        ),
    });
  }

  if (
    lifecycle.state !==
    "SUBMITTED"
  ) {
    throw new Error(
      `Execution lifecycle reconciliation currently requires SUBMITTED or COMPLETED state; received ${lifecycle.state}.`,
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

    reconciliationMode:
      "RECOVERED_SUBMISSION",

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
