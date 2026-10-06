import {
  isDeepStrictEqual,
} from "node:util";

import {
  createDialogueAudioOutputPath,
} from "./dialogueAudioOutputPath.js";

import {
  createDialogueCompletionPath,
} from "./dialogueCompletionPath.js";

import type {
  DialogueCompletion,
  DialogueCompletionInput,
} from "./dialogueCompletion.schema.js";

import {
  createDialogueGenerationRecordPath,
} from "./dialogueGenerationRecordPath.js";

import type {
  DialogueGenerationRecord,
} from "./dialogueGenerationRecord.schema.js";

import type {
  DialogueSubmissionV1,
  DialogueSubmissionV2,
  DialogueSubmissionV3,
} from "./dialogueSubmission.schema.js";

import {
  inspectDialogueLifecycle,
} from "./inspectDialogueLifecycle.js";

import {
  readDialogueGenerationRecord,
} from "./readDialogueGenerationRecord.js";

import {
  inspectDialogueAudioOutput,
  recoverDialogueAudioOutput,
  type InspectedDialogueAudioOutput,
} from "./recoverDialogueAudioOutput.js";

import {
  recoverDialogueCompletion,
  type RecoverDialogueCompletionResult,
} from "./recoverDialogueCompletion.js";

import {
  recoverDialogueGenerationRecord,
  type RecoverDialogueGenerationRecordResult,
} from "./recoverDialogueGenerationRecord.js";

import type {
  ResumeRunwayElevenV3TaskInput,
} from "./resumeRunwayElevenV3Task.js";

import type {
  ResumeRunwayReferenceAudioTaskInput,
  RunwayReferenceAudioTaskResumeResult,
} from "./resumeRunwayReferenceAudioTask.js";

import type {
  RunwayElevenV3ExecutionResult,
} from "./runwayElevenV3Execution.js";

import type {
  DownloadedDialogueAudioOutput,
} from "./downloadDialogueAudioOutput.js";

export type DialogueLifecycleReconciliationInput =
  Readonly<{
    mediaRoot:
      string;

    episodeId:
      string;

    sceneId:
      string;

    shotId:
      string;

    dialogueLineId:
      string;

    runwayWaitTimeoutMs?:
      number;
  }>;

type ResumeRunwayDialogueTask =
  (
    input:
      ResumeRunwayElevenV3TaskInput,
  ) =>
    Promise<
      RunwayElevenV3ExecutionResult
    >;

type ResumeRunwayReferenceAudioDialogueTask =
  (
    input:
      ResumeRunwayReferenceAudioTaskInput,
  ) =>
    Promise<
      RunwayReferenceAudioTaskResumeResult
    >;

type RecoverDialogueOutput =
  (
    sourceUrl:
      string,

    destinationPath:
      string,
  ) =>
    Promise<
      DownloadedDialogueAudioOutput
    >;

type InspectDialogueOutput =
  (
    filePath:
      string,
  ) =>
    Promise<
      InspectedDialogueAudioOutput
    >;

export type DialogueLifecycleReconciliationDependencies =
  Readonly<{
    inspectLifecycle:
      typeof inspectDialogueLifecycle;

    resumeRunwayTask?:
      ResumeRunwayDialogueTask;

    resumeRunwayReferenceAudioTask?:
      ResumeRunwayReferenceAudioDialogueTask;

    recoverOutput?:
      RecoverDialogueOutput;

    inspectOutput?:
      InspectDialogueOutput;

    recoverGenerationRecord?:
      typeof recoverDialogueGenerationRecord;

    readGenerationRecord?:
      typeof readDialogueGenerationRecord;

    recoverCompletion?:
      typeof recoverDialogueCompletion;

    now?:
      () => string;
  }>;

export type DialogueLifecycleReconciliationResult =
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
        | RunwayElevenV3ExecutionResult
        | RunwayReferenceAudioTaskResumeResult;

      generationRecord:
        DialogueGenerationRecord;

      generationRecordPath:
        string;

      completion:
        DialogueCompletion;

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
        DialogueGenerationRecord;

      generationRecordPath:
        string;

      completion:
        DialogueCompletion;

      completionPath:
        string;
    }>;

const DEFAULT_RUNWAY_WAIT_TIMEOUT_MS =
  600_000;

function requireRunwayWaitTimeoutMs(
  value:
    number,
): number {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value <=
      0
  ) {
    throw new Error(
      "Dialogue lifecycle reconciliation requires runwayWaitTimeoutMs to be a positive safe integer.",
    );
  }

  return value;
}

function requireDependency<T>(
  dependency:
    T | undefined,

  name:
    string,
): T {
  if (!dependency) {
    throw new Error(
      `Dialogue lifecycle reconciliation requires ${name}.`,
    );
  }

  return dependency;
}

function assertRecoveredProviderExecution(
  providerExecution:
    | RunwayElevenV3ExecutionResult
    | RunwayReferenceAudioTaskResumeResult,

  durableTaskId:
    string,

  durableEstimatedCredits:
    number,
): void {
  if (
    providerExecution.taskId !==
    durableTaskId
  ) {
    throw new Error(
      "Recovered Runway dialogue task ID does not match the durable submission task ID.",
    );
  }

  if (
    providerExecution.estimatedCredits !==
    durableEstimatedCredits
  ) {
    throw new Error(
      "Recovered Runway dialogue estimated credits do not match the durable submission.",
    );
  }

  if (
    providerExecution.outputUrls.length ===
    0
  ) {
    throw new Error(
      "Recovered Runway dialogue task contains no output URLs.",
    );
  }
}

function assertRecoveredOutputPath(
  recovered:
    DownloadedDialogueAudioOutput,

  expectedPath:
    string,
): void {
  if (
    recovered.destinationPath !==
    expectedPath
  ) {
    throw new Error(
      "Recovered dialogue audio output path does not match the canonical destination path.",
    );
  }
}

function assertGenerationRecordMatchesSubmission(
  record:
    DialogueGenerationRecord,

  submission:
    DialogueSubmissionV1,
): void {
  if (
    record.schemaVersion !==
    "1.0"
  ) {
    throw new Error(
      "Dialogue generation record schema version does not match the supported v1 dialogue reconciliation contract.",
    );
  }

  if (
    record.provider !==
      submission.provider ||
    record.providerExecutionId !==
      submission.providerExecutionId
  ) {
    throw new Error(
      "Dialogue generation record provider execution identity does not match the durable submission.",
    );
  }

  if (
    record.plan.episodeId !==
      submission.episodeId ||
    record.plan.sceneId !==
      submission.sceneId ||
    record.plan.shotId !==
      submission.shotId ||
    record.plan.dialogueLineId !==
      submission.dialogueLineId
  ) {
    throw new Error(
      "Dialogue generation record plan identity does not match the durable submission.",
    );
  }

  if (
    record.plan.planKey !==
    submission.planKey
  ) {
    throw new Error(
      "Dialogue generation record planKey does not match the durable submission.",
    );
  }

  if (
    !isDeepStrictEqual(
      record.plan,
      submission.recoveryMetadata.plan,
    )
  ) {
    throw new Error(
      "Dialogue generation record plan does not match the immutable submission recovery plan.",
    );
  }

  if (
    !isDeepStrictEqual(
      record.request,
      submission.recoveryMetadata.request,
    )
  ) {
    throw new Error(
      "Dialogue generation record request does not match the immutable submission recovery request.",
    );
  }

  if (
    record.providerModel !==
    submission.recoveryMetadata.request.model
  ) {
    throw new Error(
      "Dialogue generation record provider model does not match the durable submission request.",
    );
  }

  if (
    record.credits.locallyExpected !==
      submission.recoveryMetadata
        .locallyExpectedCredits ||
    record.credits.providerEstimated !==
      submission.providerEstimatedCredits
  ) {
    throw new Error(
      "Dialogue generation record credit evidence does not match the durable submission.",
    );
  }
}

function assertReferenceAudioGenerationRecordMatchesSubmission(
  record:
    DialogueGenerationRecord,

  submission:
    DialogueSubmissionV2,
): void {
  if (
    record.schemaVersion !==
    "2.0"
  ) {
    throw new Error(
      "Dialogue generation record schema version does not match the supported v2 reference-audio dialogue reconciliation contract.",
    );
  }

  if (
    record.provider !==
      submission.provider ||
    record.providerExecutionId !==
      submission.providerExecutionId
  ) {
    throw new Error(
      "Dialogue reference-audio generation record provider execution identity does not match the durable submission.",
    );
  }

  if (
    record.plan.episodeId !==
      submission.episodeId ||
    record.plan.sceneId !==
      submission.sceneId ||
    record.plan.shotId !==
      submission.shotId ||
    record.plan.dialogueLineId !==
      submission.dialogueLineId
  ) {
    throw new Error(
      "Dialogue reference-audio generation record plan identity does not match the durable submission.",
    );
  }

  if (
    record.plan.planKey !==
    submission.planKey
  ) {
    throw new Error(
      "Dialogue reference-audio generation record planKey does not match the durable submission.",
    );
  }

  if (
    !isDeepStrictEqual(
      record.plan,
      submission.recoveryMetadata.plan,
    )
  ) {
    throw new Error(
      "Dialogue reference-audio generation record plan does not match the immutable submission recovery plan.",
    );
  }

  if (
    !isDeepStrictEqual(
      record.request,
      submission.recoveryMetadata.request,
    )
  ) {
    throw new Error(
      "Dialogue reference-audio generation record request does not match the immutable submission recovery request.",
    );
  }

  if (
    !isDeepStrictEqual(
      record.routing,
      submission.routing,
    )
  ) {
    throw new Error(
      "Dialogue reference-audio generation record routing evidence does not match the durable submission.",
    );
  }

  if (
    record.providerModel !==
    submission.routing.model
  ) {
    throw new Error(
      "Dialogue reference-audio generation record provider model does not match the accepted router model.",
    );
  }

  if (
    record.credits.locallyExpected !==
      submission.recoveryMetadata
        .locallyExpectedCredits ||
    record.credits.providerEstimated !==
      submission.providerEstimatedCredits
  ) {
    throw new Error(
      "Dialogue reference-audio generation record credit evidence does not match the durable submission.",
    );
  }
}

function assertDirectSeedAudioGenerationRecordMatchesSubmission(
  record:
    DialogueGenerationRecord,

  submission:
    DialogueSubmissionV3,
): void {
  if (
    record.schemaVersion !==
    "3.0"
  ) {
    throw new Error(
      "Dialogue generation record schema version does not match the supported v3 direct SeedAudio reconciliation contract.",
    );
  }

  if (
    record.provider !==
      submission.provider ||
    record.providerExecutionId !==
      submission.providerExecutionId
  ) {
    throw new Error(
      "Dialogue direct SeedAudio generation record provider execution identity does not match the durable submission.",
    );
  }

  if (
    record.plan.episodeId !==
      submission.episodeId ||
    record.plan.sceneId !==
      submission.sceneId ||
    record.plan.shotId !==
      submission.shotId ||
    record.plan.dialogueLineId !==
      submission.dialogueLineId
  ) {
    throw new Error(
      "Dialogue direct SeedAudio generation record plan identity does not match the durable submission.",
    );
  }

  if (
    record.plan.planKey !==
    submission.planKey
  ) {
    throw new Error(
      "Dialogue direct SeedAudio generation record planKey does not match the durable submission.",
    );
  }

  if (
    !isDeepStrictEqual(
      record.plan,
      submission.recoveryMetadata.plan,
    )
  ) {
    throw new Error(
      "Dialogue direct SeedAudio generation record plan does not match the immutable submission recovery plan.",
    );
  }

  if (
    !isDeepStrictEqual(
      record.request,
      submission.recoveryMetadata.request,
    )
  ) {
    throw new Error(
      "Dialogue direct SeedAudio generation record request does not match the immutable submission recovery request.",
    );
  }

  if (
    record.providerModel !==
    submission.recoveryMetadata
      .request
      .model
  ) {
    throw new Error(
      "Dialogue direct SeedAudio generation record provider model does not match the durable submission request.",
    );
  }

  if (
    record.credits.localCeiling !==
      submission.recoveryMetadata
        .localCreditCeiling ||
    record.credits.providerEstimated !==
      submission.providerEstimatedCredits
  ) {
    throw new Error(
      "Dialogue direct SeedAudio generation record credit evidence does not match the durable submission.",
    );
  }
}


function assertCanonicalGenerationOutputs(
  mediaRoot:
    string,

  record:
    DialogueGenerationRecord,
): void {
  record.outputs.forEach(
    (
      output,
      arrayIndex,
    ) => {
      const expectedOutputIndex =
        arrayIndex +
        1;

      if (
        output.outputIndex !==
        expectedOutputIndex
      ) {
        throw new Error(
          "Dialogue generation record outputs must use contiguous canonical output indexes.",
        );
      }

      const canonicalPath =
        createDialogueAudioOutputPath(
          mediaRoot,
          record.plan.episodeId,
          record.plan.shotId,
          record.plan.dialogueLineId,
          record.provider,
          record.providerExecutionId,
          output.outputIndex,
        );

      if (
        output.destinationPath !==
        canonicalPath
      ) {
        throw new Error(
          "Dialogue generation record output path does not match the canonical audio output path.",
        );
      }
    },
  );
}

async function verifyDurableOutputs(
  record:
    DialogueGenerationRecord,

  inspectOutput:
    InspectDialogueOutput,
): Promise<void> {
  for (
    const output
    of record.outputs
  ) {
    const inspected =
      await inspectOutput(
        output.destinationPath,
      );

    if (
      inspected.bytes !==
        output.bytes ||
      inspected.sha256 !==
        output.sha256
    ) {
      throw new Error(
        `Durable dialogue audio output integrity does not match its generation record: ${output.destinationPath}`,
      );
    }
  }
}

function assertRecoveredGenerationRecord(
  expected:
    DialogueGenerationRecord,

  recovered:
    RecoverDialogueGenerationRecordResult,

  canonicalRecordPath:
    string,
): void {
  if (
    recovered.recordPath !==
    canonicalRecordPath
  ) {
    throw new Error(
      "Recovered dialogue generation record path does not match the canonical path.",
    );
  }

  if (
    !isDeepStrictEqual(
      {
        ...recovered.record,

        recordedAt:
          expected.recordedAt,
      },
      expected,
    )
  ) {
    throw new Error(
      "Recovered dialogue generation record does not match the resumed provider execution evidence.",
    );
  }
}

function assertRecoveredCompletion(
  recovered:
    RecoverDialogueCompletionResult,

  expected:
    DialogueCompletionInput,

  canonicalCompletionPath:
    string,
): void {
  if (
    recovered.completionPath !==
    canonicalCompletionPath
  ) {
    throw new Error(
      "Recovered dialogue completion path does not match the canonical path.",
    );
  }

  const actual =
    recovered.record;

  if (
    actual.reservationId !==
      expected.reservationId ||
    actual.episodeId !==
      expected.episodeId ||
    actual.sceneId !==
      expected.sceneId ||
    actual.shotId !==
      expected.shotId ||
    actual.dialogueLineId !==
      expected.dialogueLineId ||
    actual.planKey !==
      expected.planKey ||
    actual.provider !==
      expected.provider ||
    actual.providerExecutionId !==
      expected.providerExecutionId ||
    actual.generationRecordPath !==
      expected.generationRecordPath
  ) {
    throw new Error(
      "Recovered dialogue completion does not match the durable lifecycle evidence.",
    );
  }
}

export async function reconcileDialogueLifecycle(
  input:
    DialogueLifecycleReconciliationInput,

  dependencies:
    DialogueLifecycleReconciliationDependencies,
): Promise<
  DialogueLifecycleReconciliationResult
> {
  const lifecycle =
    await dependencies
      .inspectLifecycle(
        input.mediaRoot,
        input.episodeId,
        input.sceneId,
        input.shotId,
        input.dialogueLineId,
      );

  if (
    lifecycle.state ===
      "NOTHING" ||
    lifecycle.state ===
      "RESERVED_ONLY"
  ) {
    throw new Error(
      `Dialogue lifecycle reconciliation requires a SUBMITTED or COMPLETED lifecycle; found ${lifecycle.state}.`,
    );
  }

  if (
    lifecycle.submission.schemaVersion ===
    "2.0" ||
    lifecycle.submission.schemaVersion ===
    "3.0"
  ) {
    if (
      lifecycle.state ===
        "COMPLETED"
    ) {
      const canonicalGenerationRecordPath =
        createDialogueGenerationRecordPath(
          input.mediaRoot,
          lifecycle.submission
            .episodeId,
          lifecycle.submission
            .shotId,
          lifecycle.submission
            .dialogueLineId,
          lifecycle.submission
            .provider,
          lifecycle.submission
            .providerExecutionId,
        );

      const canonicalCompletionPath =
        createDialogueCompletionPath(
          input.mediaRoot,
          lifecycle.submission
            .episodeId,
          lifecycle.submission
            .sceneId,
          lifecycle.submission
            .shotId,
          lifecycle.submission
            .dialogueLineId,
        );

      if (
        lifecycle.completion
          .generationRecordPath !==
        canonicalGenerationRecordPath
      ) {
        throw new Error(
          "Durable dialogue completion generation record path does not match the canonical path.",
        );
      }

      const readGenerationRecord =
        dependencies
          .readGenerationRecord ??
        readDialogueGenerationRecord;

      const inspectOutput =
        dependencies
          .inspectOutput ??
        inspectDialogueAudioOutput;

      const generationRecord =
        await readGenerationRecord(
          input.mediaRoot,
          lifecycle.submission
            .episodeId,
          lifecycle.submission
            .shotId,
          lifecycle.submission
            .dialogueLineId,
          lifecycle.submission
            .provider,
          lifecycle.submission
            .providerExecutionId,
        );

      if (
        !generationRecord
      ) {
        throw new Error(
          "Durable dialogue completion points to a missing generation record.",
        );
      }

      if (
        lifecycle.submission.schemaVersion ===
        "2.0"
      ) {
        assertReferenceAudioGenerationRecordMatchesSubmission(
          generationRecord,
          lifecycle.submission,
        );
      } else {
        assertDirectSeedAudioGenerationRecordMatchesSubmission(
          generationRecord,
          lifecycle.submission,
        );
      }

      assertCanonicalGenerationOutputs(
        input.mediaRoot,
        generationRecord,
      );

      await verifyDurableOutputs(
        generationRecord,
        inspectOutput,
      );

      return Object.freeze({
        lifecycleState:
          "COMPLETED",

        reconciliationMode:
          "DURABLE_COMPLETION",

        provider:
          "RUNWAY",

        providerExecutionId:
          lifecycle.submission
            .providerExecutionId,

        generationRecord,

        generationRecordPath:
          canonicalGenerationRecordPath,

        completion:
          lifecycle.completion,

        completionPath:
          canonicalCompletionPath,
      });
    }

    const resumeRunwayReferenceAudioTask =
      requireDependency(
        dependencies
          .resumeRunwayReferenceAudioTask,
        "resumeRunwayReferenceAudioTask for a durable SUBMITTED Runway reference-audio dialogue task",
      );

    const recoverOutput =
      dependencies
        .recoverOutput ??
      recoverDialogueAudioOutput;

    const recoverGenerationRecord =
      dependencies
        .recoverGenerationRecord ??
      recoverDialogueGenerationRecord;

    const recoverCompletion =
      dependencies
        .recoverCompletion ??
      recoverDialogueCompletion;

    const now =
      dependencies.now ??
      (() =>
        new Date()
          .toISOString());

    const waitTimeoutMs =
      requireRunwayWaitTimeoutMs(
        input.runwayWaitTimeoutMs ??
          DEFAULT_RUNWAY_WAIT_TIMEOUT_MS,
      );

    const providerExecution =
      await resumeRunwayReferenceAudioTask({
        taskId:
          lifecycle.submission
            .providerExecutionId,

        providerEstimatedCredits:
          lifecycle.submission
            .providerEstimatedCredits,

        waitTimeoutMs,
      });

    assertRecoveredProviderExecution(
      providerExecution,
      lifecycle.submission
        .providerExecutionId,
      lifecycle.submission
        .providerEstimatedCredits,
    );

    const recoveredOutputs:
      DialogueGenerationRecord[
        "outputs"
      ] =
        [];

    for (
      let index =
        0;
      index <
        providerExecution
          .outputUrls
          .length;
      index +=
        1
    ) {
      const outputIndex =
        index +
        1;

      const destinationPath =
        createDialogueAudioOutputPath(
          input.mediaRoot,
          lifecycle.submission
            .episodeId,
          lifecycle.submission
            .shotId,
          lifecycle.submission
            .dialogueLineId,
          lifecycle.submission
            .provider,
          lifecycle.submission
            .providerExecutionId,
          outputIndex,
        );

      const recovered =
        await recoverOutput(
          providerExecution
            .outputUrls[index]!,
          destinationPath,
        );

      assertRecoveredOutputPath(
        recovered,
        destinationPath,
      );

      recoveredOutputs.push(
        Object.freeze({
          outputIndex,

          destinationPath,

          bytes:
            recovered.bytes,

          sha256:
            recovered.sha256,

          contentType:
            recovered.contentType,
        }),
      );
    }

    const expectedGenerationRecord:
      DialogueGenerationRecord =
        lifecycle.submission
          .schemaVersion ===
        "2.0"
          ? {
              schemaVersion:
                "2.0",

              recordedAt:
                now(),

              status:
                "SUCCEEDED",

              provider:
                lifecycle.submission
                  .provider,

              providerExecutionId:
                lifecycle.submission
                  .providerExecutionId,

              providerModel:
                lifecycle.submission
                  .routing
                  .model,

              providerCreatedAt:
                providerExecution
                  .providerCreatedAt,

              request:
                lifecycle.submission
                  .recoveryMetadata
                  .request,

              routing:
                lifecycle.submission
                  .routing,

              credits: {
                locallyExpected:
                  lifecycle.submission
                    .recoveryMetadata
                    .locallyExpectedCredits,

                providerEstimated:
                  lifecycle.submission
                    .providerEstimatedCredits,

                providerFinal:
                  providerExecution
                    .finalCredits,
              },

              plan:
                lifecycle.submission
                  .recoveryMetadata
                  .plan,

              outputs:
                recoveredOutputs,
            }
          : {
              schemaVersion:
                "3.0",

              recordedAt:
                now(),

              status:
                "SUCCEEDED",

              provider:
                lifecycle.submission
                  .provider,

              providerExecutionId:
                lifecycle.submission
                  .providerExecutionId,

              providerModel:
                lifecycle.submission
                  .recoveryMetadata
                  .request
                  .model,

              providerCreatedAt:
                providerExecution
                  .providerCreatedAt,

              request:
                lifecycle.submission
                  .recoveryMetadata
                  .request,

              credits: {
                localCeiling:
                  lifecycle.submission
                    .recoveryMetadata
                    .localCreditCeiling,

                providerEstimated:
                  lifecycle.submission
                    .providerEstimatedCredits,

                providerFinal:
                  providerExecution
                    .finalCredits,
              },

              plan:
                lifecycle.submission
                  .recoveryMetadata
                  .plan,

              outputs:
                recoveredOutputs,
            };

    assertCanonicalGenerationOutputs(
      input.mediaRoot,
      expectedGenerationRecord,
    );

    const canonicalGenerationRecordPath =
      createDialogueGenerationRecordPath(
        input.mediaRoot,
        lifecycle.submission
          .episodeId,
        lifecycle.submission
          .shotId,
        lifecycle.submission
          .dialogueLineId,
        lifecycle.submission
          .provider,
        lifecycle.submission
          .providerExecutionId,
      );

    const recoveredGenerationRecord =
      await recoverGenerationRecord(
        input.mediaRoot,
        expectedGenerationRecord,
      );

    assertRecoveredGenerationRecord(
      expectedGenerationRecord,
      recoveredGenerationRecord,
      canonicalGenerationRecordPath,
    );

    const canonicalCompletionPath =
      createDialogueCompletionPath(
        input.mediaRoot,
        lifecycle.submission
          .episodeId,
        lifecycle.submission
          .sceneId,
        lifecycle.submission
          .shotId,
        lifecycle.submission
          .dialogueLineId,
      );

    const completionInput:
      DialogueCompletionInput = {
        reservationId:
          lifecycle.reservation
            .reservationId,

        episodeId:
          lifecycle.submission
            .episodeId,

        sceneId:
          lifecycle.submission
            .sceneId,

        shotId:
          lifecycle.submission
            .shotId,

        dialogueLineId:
          lifecycle.submission
            .dialogueLineId,

        planKey:
          lifecycle.submission
            .planKey,

        provider:
          lifecycle.submission
            .provider,

        providerExecutionId:
          lifecycle.submission
            .providerExecutionId,

        generationRecordPath:
          recoveredGenerationRecord
            .recordPath,
      };

    const recoveredCompletion =
      await recoverCompletion(
        input.mediaRoot,
        completionInput,
      );

    assertRecoveredCompletion(
      recoveredCompletion,
      completionInput,
      canonicalCompletionPath,
    );

    return Object.freeze({
      lifecycleState:
        "COMPLETED",

      reconciliationMode:
        "RECOVERED_SUBMISSION",

      provider:
        "RUNWAY",

      providerExecutionId:
        lifecycle.submission
          .providerExecutionId,

      providerExecution,

      generationRecord:
        recoveredGenerationRecord
          .record,

      generationRecordPath:
        recoveredGenerationRecord
          .recordPath,

      completion:
        recoveredCompletion
          .record,

      completionPath:
        recoveredCompletion
          .completionPath,
    });
  }

  const canonicalGenerationRecordPath =
    createDialogueGenerationRecordPath(
      input.mediaRoot,
      lifecycle.submission.episodeId,
      lifecycle.submission.shotId,
      lifecycle.submission.dialogueLineId,
      lifecycle.submission.provider,
      lifecycle.submission.providerExecutionId,
    );

  const canonicalCompletionPath =
    createDialogueCompletionPath(
      input.mediaRoot,
      lifecycle.submission.episodeId,
      lifecycle.submission.sceneId,
      lifecycle.submission.shotId,
      lifecycle.submission.dialogueLineId,
    );

  if (
    lifecycle.state ===
    "COMPLETED"
  ) {
    if (
      lifecycle.completion
        .generationRecordPath !==
      canonicalGenerationRecordPath
    ) {
      throw new Error(
        "Durable dialogue completion generation record path does not match the canonical path.",
      );
    }

    const readGenerationRecord =
      dependencies
        .readGenerationRecord ??
      readDialogueGenerationRecord;

    const inspectOutput =
      dependencies
        .inspectOutput ??
      inspectDialogueAudioOutput;

    const generationRecord =
      await readGenerationRecord(
        input.mediaRoot,
        lifecycle.submission.episodeId,
        lifecycle.submission.shotId,
        lifecycle.submission.dialogueLineId,
        lifecycle.submission.provider,
        lifecycle.submission.providerExecutionId,
      );

    if (!generationRecord) {
      throw new Error(
        "Durable dialogue completion points to a missing generation record.",
      );
    }

    assertGenerationRecordMatchesSubmission(
      generationRecord,
      lifecycle.submission,
    );

    assertCanonicalGenerationOutputs(
      input.mediaRoot,
      generationRecord,
    );

    await verifyDurableOutputs(
      generationRecord,
      inspectOutput,
    );

    return Object.freeze({
      lifecycleState:
        "COMPLETED",

      reconciliationMode:
        "DURABLE_COMPLETION",

      provider:
        "RUNWAY",

      providerExecutionId:
        lifecycle.submission
          .providerExecutionId,

      generationRecord,

      generationRecordPath:
        canonicalGenerationRecordPath,

      completion:
        lifecycle.completion,

      completionPath:
        canonicalCompletionPath,
    });
  }

  const resumeRunwayTask =
    requireDependency(
      dependencies
        .resumeRunwayTask,
      "resumeRunwayTask for a durable SUBMITTED Runway dialogue task",
    );

  const recoverOutput =
    dependencies
      .recoverOutput ??
    recoverDialogueAudioOutput;

  const recoverGenerationRecord =
    dependencies
      .recoverGenerationRecord ??
    recoverDialogueGenerationRecord;

  const recoverCompletion =
    dependencies
      .recoverCompletion ??
    recoverDialogueCompletion;

  const now =
    dependencies.now ??
    (() =>
      new Date()
        .toISOString());

  const waitTimeoutMs =
    requireRunwayWaitTimeoutMs(
      input.runwayWaitTimeoutMs ??
        DEFAULT_RUNWAY_WAIT_TIMEOUT_MS,
    );

  const providerExecution =
    await resumeRunwayTask({
      taskId:
        lifecycle.submission
          .providerExecutionId,

      providerEstimatedCredits:
        lifecycle.submission
          .providerEstimatedCredits,

      waitTimeoutMs,
    });

  assertRecoveredProviderExecution(
    providerExecution,
    lifecycle.submission
      .providerExecutionId,
    lifecycle.submission
      .providerEstimatedCredits,
  );

  const recoveredOutputs:
    DialogueGenerationRecord[
      "outputs"
    ] =
      [];

  for (
    let index =
      0;
    index <
      providerExecution
        .outputUrls
        .length;
    index +=
      1
  ) {
    const outputIndex =
      index +
      1;

    const destinationPath =
      createDialogueAudioOutputPath(
        input.mediaRoot,
        lifecycle.submission
          .episodeId,
        lifecycle.submission
          .shotId,
        lifecycle.submission
          .dialogueLineId,
        lifecycle.submission
          .provider,
        lifecycle.submission
          .providerExecutionId,
        outputIndex,
      );

    const recovered =
      await recoverOutput(
        providerExecution
          .outputUrls[index]!,
        destinationPath,
      );

    assertRecoveredOutputPath(
      recovered,
      destinationPath,
    );

    recoveredOutputs.push(
      Object.freeze({
        outputIndex,

        destinationPath,

        bytes:
          recovered.bytes,

        sha256:
          recovered.sha256,

        contentType:
          recovered.contentType,
      }),
    );
  }

  const expectedGenerationRecord:
    DialogueGenerationRecord = {
      schemaVersion:
        "1.0",

      recordedAt:
        now(),

      status:
        "SUCCEEDED",

      provider:
        lifecycle.submission
          .provider,

      providerExecutionId:
        lifecycle.submission
          .providerExecutionId,

      providerModel:
        lifecycle.submission
          .recoveryMetadata
          .request
          .model,

      providerCreatedAt:
        providerExecution
          .providerCreatedAt,

      request:
        lifecycle.submission
          .recoveryMetadata
          .request,

      credits: {
        locallyExpected:
          lifecycle.submission
            .recoveryMetadata
            .locallyExpectedCredits,

        providerEstimated:
          lifecycle.submission
            .providerEstimatedCredits,

        providerFinal:
          providerExecution
            .finalCredits,
      },

      plan:
        lifecycle.submission
          .recoveryMetadata
          .plan,

      outputs:
        recoveredOutputs,
    };

  assertGenerationRecordMatchesSubmission(
    expectedGenerationRecord,
    lifecycle.submission,
  );

  assertCanonicalGenerationOutputs(
    input.mediaRoot,
    expectedGenerationRecord,
  );

  const recoveredGenerationRecord =
    await recoverGenerationRecord(
      input.mediaRoot,
      expectedGenerationRecord,
    );

  assertRecoveredGenerationRecord(
    expectedGenerationRecord,
    recoveredGenerationRecord,
    canonicalGenerationRecordPath,
  );

  const completionInput:
    DialogueCompletionInput = {
      reservationId:
        lifecycle.reservation
          .reservationId,

      episodeId:
        lifecycle.submission
          .episodeId,

      sceneId:
        lifecycle.submission
          .sceneId,

      shotId:
        lifecycle.submission
          .shotId,

      dialogueLineId:
        lifecycle.submission
          .dialogueLineId,

      planKey:
        lifecycle.submission
          .planKey,

      provider:
        lifecycle.submission
          .provider,

      providerExecutionId:
        lifecycle.submission
          .providerExecutionId,

      generationRecordPath:
        recoveredGenerationRecord
          .recordPath,
    };

  const recoveredCompletion =
    await recoverCompletion(
      input.mediaRoot,
      completionInput,
    );

  assertRecoveredCompletion(
    recoveredCompletion,
    completionInput,
    canonicalCompletionPath,
  );

  return Object.freeze({
    lifecycleState:
      "COMPLETED",

    reconciliationMode:
      "RECOVERED_SUBMISSION",

    provider:
      "RUNWAY",

    providerExecutionId:
      lifecycle.submission
        .providerExecutionId,

    providerExecution,

    generationRecord:
      recoveredGenerationRecord
        .record,

    generationRecordPath:
      recoveredGenerationRecord
        .recordPath,

    completion:
      recoveredCompletion
        .record,

    completionPath:
      recoveredCompletion
        .completionPath,
  });
}
