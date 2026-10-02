import type {
  DialogueVoicePolicy,
} from "../schemas/dialogueVoicePolicy.schema.js";

import {
  buildRunwayElevenV3Request,
} from "./buildRunwayElevenV3Request.js";

import type {
  ShotDialoguePlan,
  ShotDialoguePlanLine,
} from "./buildShotDialoguePlan.js";

import {
  createDialogueAudioOutputPath,
} from "./dialogueAudioOutputPath.js";

import type {
  DialogueGenerationRecord,
} from "./dialogueGenerationRecord.schema.js";

import type {
  DownloadedDialogueAudioOutput,
} from "./downloadDialogueAudioOutput.js";

import {
  assertDialogueWithinBudget,
} from "./dialogueVoiceBudget.js";

import type {
  RunwayElevenV3ExecutionResult,
} from "./runwayElevenV3Execution.js";

import type {
  RunwayElevenV3Request,
} from "./runwayElevenV3Request.schema.js";

export type DialogueGenerationRecoveryMetadata =
  Readonly<{
    request:
      RunwayElevenV3Request;

    locallyExpectedCredits:
      number;

    plan:
      DialogueGenerationRecord["plan"];
  }>;

export type DialogueGenerationExecutor =
  (
    request:
      RunwayElevenV3Request,

    waitTimeoutMs:
      number,

    recoveryMetadata:
      DialogueGenerationRecoveryMetadata,
  ) =>
    Promise<
      RunwayElevenV3ExecutionResult
    >;

export type DialogueOutputDownloader =
  (
    sourceUrl:
      string,

    destinationPath:
      string,
  ) =>
    Promise<
      DownloadedDialogueAudioOutput
    >;

export type DialogueGenerationRecordWriter =
  (
    mediaRoot:
      string,

    record:
      DialogueGenerationRecord,
  ) =>
    Promise<string>;

export type RunwayElevenV3DialogueTransactionInput =
  Readonly<{
    plan:
      ShotDialoguePlan;

    dialogueLineId:
      string;

    mediaRoot:
      string;

    policy:
      DialogueVoicePolicy;
  }>;

export type RunwayElevenV3DialogueTransactionDependencies =
  Readonly<{
    executeGeneration:
      DialogueGenerationExecutor;

    downloadOutput:
      DialogueOutputDownloader;

    writeGenerationRecord:
      DialogueGenerationRecordWriter;

    now?:
      () => string;
  }>;

export type RunwayElevenV3DialogueTransactionResult =
  Readonly<{
    record:
      DialogueGenerationRecord;

    recordPath:
      string;
  }>;

function requireDialogueLine(
  plan:
    ShotDialoguePlan,

  dialogueLineId:
    string,
): ShotDialoguePlanLine {
  const requestedId =
    dialogueLineId.trim();

  if (!requestedId) {
    throw new Error(
      "Dialogue transaction requires a non-empty dialogue line ID.",
    );
  }

  if (
    requestedId !==
    dialogueLineId
  ) {
    throw new Error(
      "Dialogue transaction requires the exact canonical dialogue line ID without surrounding whitespace.",
    );
  }

  const matches =
    plan.lines.filter(
      (line) =>
        line.dialogueLineId ===
        requestedId,
    );

  if (
    matches.length !==
    1
  ) {
    throw new Error(
      `Requested dialogue line ${requestedId} does not uniquely belong to the supplied canonical dialogue plan.`,
    );
  }

  const line =
    matches[0];

  if (!line) {
    throw new Error(
      `Requested dialogue line ${requestedId} does not belong to the supplied canonical dialogue plan.`,
    );
  }

  return line;
}

function createPlanSnapshot(
  plan:
    ShotDialoguePlan,

  line:
    ShotDialoguePlanLine,
): DialogueGenerationRecord["plan"] {
  const deliveryTraits: string[] = [
    ...line.voice
      .deliveryTraits,
  ];

  Object.freeze(
    deliveryTraits,
  );

  return Object.freeze({
    planKey:
      plan.planKey,

    episodeId:
      plan.episodeId,

    sceneId:
      plan.sceneId,

    shotId:
      plan.shotId,

    dialogueLineId:
      line.dialogueLineId,

    lineNumber:
      line.lineNumber,

    characterId:
      line.characterId,

    characterName:
      line.characterName,

    text:
      line.text,

    deliveryNotes:
      line.deliveryNotes,

    voice:
      Object.freeze({
        provider:
          line.voice.provider,

        voiceName:
          line.voice.voiceName,

        deliveryTraits,
      }),
  });
}

function createRecoveryRequest(
  request:
    RunwayElevenV3Request,
): RunwayElevenV3Request {
  return Object.freeze({
    ...request,

    voice:
      Object.freeze({
        ...request.voice,
      }),
  });
}

export async function runRunwayElevenV3DialogueTransaction(
  input:
    RunwayElevenV3DialogueTransactionInput,

  dependencies:
    RunwayElevenV3DialogueTransactionDependencies,
): Promise<
  RunwayElevenV3DialogueTransactionResult
> {
  const line =
    requireDialogueLine(
      input.plan,
      input.dialogueLineId,
    );

  const locallyExpectedCredits =
    assertDialogueWithinBudget(
      line.text,
      input.policy,
    );

  const request =
    buildRunwayElevenV3Request({
      line,
      policy:
        input.policy,
    });

  const planSnapshot =
    createPlanSnapshot(
      input.plan,
      line,
    );

  const recoveryMetadata:
    DialogueGenerationRecoveryMetadata =
      Object.freeze({
        request:
          createRecoveryRequest(
            request,
          ),

        locallyExpectedCredits,

        plan:
          planSnapshot,
      });

  const execution =
    await dependencies
      .executeGeneration(
        request,
        input.policy.task
          .waitTimeoutMs,
        recoveryMetadata,
      );

  const outputs:
    DialogueGenerationRecord["outputs"] =
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
      createDialogueAudioOutputPath(
        input.mediaRoot,
        input.plan.episodeId,
        input.plan.shotId,
        line.dialogueLineId,
        "RUNWAY",
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
      : new Date()
          .toISOString();

  const record:
    DialogueGenerationRecord = {
      schemaVersion:
        "1.0",

      recordedAt,

      status:
        "SUCCEEDED",

      provider:
        "RUNWAY",

      providerExecutionId:
        execution.taskId,

      providerModel:
        request.model,

      providerCreatedAt:
        execution.providerCreatedAt,

      request,

      credits: {
        locallyExpected:
          locallyExpectedCredits,

        providerEstimated:
          execution.estimatedCredits,

        providerFinal:
          execution.finalCredits,
      },

      plan:
        planSnapshot,

      outputs,
    };

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
