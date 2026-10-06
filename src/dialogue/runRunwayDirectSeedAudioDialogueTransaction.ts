import {
  z,
} from "zod";

import type {
  ShotDialoguePlan,
  ShotDialoguePlanLine,
} from "./buildShotDialoguePlan.js";

type ShotDialoguePlanReferenceAudioVoice =
  Extract<
    ShotDialoguePlanLine["voice"],
    Readonly<{
      referenceAudio:
        unknown;
    }>
  >;

import {
  createDialogueAudioOutputPath,
} from "./dialogueAudioOutputPath.js";

import {
  DialogueGenerationDirectSeedAudioRequestRecordSchema,
  type DialogueGenerationRecordV3,
} from "./dialogueGenerationRecord.schema.js";

import {
  DialogueDirectSeedAudioGenerationRecoveryMetadataSchema,
} from "./dialogueSubmission.schema.js";

import type {
  DownloadedDialogueAudioOutput,
} from "./downloadDialogueAudioOutput.js";

import {
  type RunwayDirectSeedAudioExecutionResult,
  type RunwayDirectSeedAudioRequest,
} from "./runwayDirectSeedAudioExecution.js";

import {
  verifyRunwayReferenceAudioAsset,
  type VerifiedRunwayReferenceAudioAsset,
} from "./verifyRunwayReferenceAudioAsset.js";

export type DialogueDirectSeedAudioGenerationRecoveryMetadata =
  z.infer<
    typeof DialogueDirectSeedAudioGenerationRecoveryMetadataSchema
  >;

export type DialogueDirectSeedAudioGenerationExecutor =
  (
    request:
      RunwayDirectSeedAudioRequest,

    waitTimeoutMs:
      number,

    recoveryMetadata:
      DialogueDirectSeedAudioGenerationRecoveryMetadata,
  ) =>
    Promise<
      RunwayDirectSeedAudioExecutionResult
    >;

export type DialogueDirectSeedAudioReferenceVerifier =
  (
    input:
      Parameters<
        typeof verifyRunwayReferenceAudioAsset
      >[0],
  ) =>
    Promise<
      VerifiedRunwayReferenceAudioAsset
    >;

export type DialogueDirectSeedAudioReferenceUploader =
  (
    absolutePath:
      string,
  ) =>
    Promise<string>;

export type DialogueDirectSeedAudioOutputDownloader =
  (
    sourceUrl:
      string,

    destinationPath:
      string,
  ) =>
    Promise<
      DownloadedDialogueAudioOutput
    >;

export type DialogueDirectSeedAudioGenerationRecordWriter =
  (
    mediaRoot:
      string,

    record:
      DialogueGenerationRecordV3,
  ) =>
    Promise<string>;

export type RunwayDirectSeedAudioDialogueTransactionInput =
  Readonly<{
    plan:
      ShotDialoguePlan;

    dialogueLineId:
      string;

    mediaRoot:
      string;

    ffprobeExecutable:
      string;

    localCreditCeiling:
      number;

    waitTimeoutMs:
      number;
  }>;

export type RunwayDirectSeedAudioDialogueTransactionDependencies =
  Readonly<{
    verifyReferenceAudio:
      DialogueDirectSeedAudioReferenceVerifier;

    uploadReferenceAudio:
      DialogueDirectSeedAudioReferenceUploader;

    executeGeneration:
      DialogueDirectSeedAudioGenerationExecutor;

    downloadOutput:
      DialogueDirectSeedAudioOutputDownloader;

    writeGenerationRecord:
      DialogueDirectSeedAudioGenerationRecordWriter;

    now?:
      () => string;
  }>;

export type RunwayDirectSeedAudioDialogueTransactionResult =
  Readonly<{
    record:
      DialogueGenerationRecordV3;

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
      "Direct SeedAudio dialogue transaction requires a non-empty dialogue line ID.",
    );
  }

  if (
    requestedId !==
    dialogueLineId
  ) {
    throw new Error(
      "Direct SeedAudio dialogue transaction requires the exact canonical dialogue line ID without surrounding whitespace.",
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
      `Requested direct SeedAudio dialogue line ${requestedId} does not uniquely belong to the supplied canonical dialogue plan.`,
    );
  }

  const line =
    matches[0];

  if (!line) {
    throw new Error(
      `Requested direct SeedAudio dialogue line ${requestedId} does not belong to the supplied canonical dialogue plan.`,
    );
  }

  if (
    line.voice.provider !==
    "RUNWAY"
  ) {
    throw new Error(
      `Direct SeedAudio dialogue line ${requestedId} must use the RUNWAY voice provider.`,
    );
  }

  return line;
}

function requireReferenceAudioVoice(
  line:
    ShotDialoguePlanLine,
): ShotDialoguePlanReferenceAudioVoice {
  const voice =
    line.voice;

  if (
    !(
      "executionMode" in
      voice
    ) ||
    voice.executionMode !==
      "RUNWAY_REFERENCE_AUDIO" ||
    voice.selectionStatus !==
      "LOCKED" ||
    voice.provider !==
      "RUNWAY"
  ) {
    throw new Error(
      `Direct SeedAudio dialogue line ${line.dialogueLineId} must use a LOCKED RUNWAY_REFERENCE_AUDIO voice.`,
    );
  }

  return voice;
}

function requireLocalCreditCeiling(
  value:
    number,
): number {
  if (
    !Number.isFinite(
      value,
    ) ||
    value <
      0
  ) {
    throw new Error(
      "Direct SeedAudio local credit ceiling must be finite and nonnegative.",
    );
  }

  return value;
}

function requireWaitTimeoutMs(
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
      "Direct SeedAudio transaction wait timeout must be a positive safe integer.",
    );
  }

  return value;
}

function createPlanSnapshot(
  plan:
    ShotDialoguePlan,

  line:
    ShotDialoguePlanLine,

  voice:
    ShotDialoguePlanReferenceAudioVoice,
): DialogueGenerationRecordV3["plan"] {
  const deliveryTraits:
    string[] = [
      ...voice
        .deliveryTraits,
    ];

  Object.freeze(
    deliveryTraits,
  );

  const referenceAudio =
    Object.freeze({
      assetId:
        voice.referenceAudio
          .assetId,

      mediaRootRelativePath:
        voice.referenceAudio
          .mediaRootRelativePath,

      bytes:
        voice.referenceAudio
          .bytes,

      sha256:
        voice.referenceAudio
          .sha256,

      contentType:
        voice.referenceAudio
          .contentType,

      durationSeconds:
        voice.referenceAudio
          .durationSeconds,

      codecName:
        voice.referenceAudio
          .codecName,

      sampleRateHz:
        voice.referenceAudio
          .sampleRateHz,

      channels:
        voice.referenceAudio
          .channels,
    });

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
        selectionStatus:
          "LOCKED",

        provider:
          "RUNWAY",

        voiceName:
          voice.voiceName,

        deliveryTraits,

        executionMode:
          "RUNWAY_REFERENCE_AUDIO",

        referenceAudio,
      }),
  });
}

export async function runRunwayDirectSeedAudioDialogueTransaction(
  input:
    RunwayDirectSeedAudioDialogueTransactionInput,

  dependencies:
    RunwayDirectSeedAudioDialogueTransactionDependencies,
): Promise<
  RunwayDirectSeedAudioDialogueTransactionResult
> {
  const line =
    requireDialogueLine(
      input.plan,
      input.dialogueLineId,
    );

  const voice =
    requireReferenceAudioVoice(
      line,
    );

  const localCreditCeiling =
    requireLocalCreditCeiling(
      input.localCreditCeiling,
    );

  const waitTimeoutMs =
    requireWaitTimeoutMs(
      input.waitTimeoutMs,
    );

  /*
   * The immutable local reference must be fully verified before
   * any provider upload or paid generation can occur.
   */
  const verifiedReferenceAudio =
    await dependencies
      .verifyReferenceAudio({
        mediaRoot:
          input.mediaRoot,

        referenceAudio:
          voice.referenceAudio,

        ffprobeExecutable:
          input.ffprobeExecutable,
      });

  /*
   * Upload only the physical path returned by the verifier.
   * Never upload the caller-supplied logical path directly.
   */
  const uploadedAudioUri =
    await dependencies
      .uploadReferenceAudio(
        verifiedReferenceAudio
          .absolutePath,
      );

  /*
   * Parsing here makes the runway:// reference URI and the direct
   * SeedAudio request contract a fail-closed boundary before the
   * paid execution adapter is invoked.
   */
  const request =
    DialogueGenerationDirectSeedAudioRequestRecordSchema
      .parse({
        model:
          "seed_audio",

        promptText:
          line.text,

        voice: {
          type:
            "reference-audio",

          audioUri:
            uploadedAudioUri,
        },
      });

  const planSnapshot =
    createPlanSnapshot(
      input.plan,
      line,
      voice,
    );

  const recoveryMetadata =
    DialogueDirectSeedAudioGenerationRecoveryMetadataSchema
      .parse({
        request,

        localCreditCeiling,

        plan:
          planSnapshot,
      });

  /*
   * The execution adapter is responsible for the critical provider
   * acceptance boundary:
   *
   * create task
   * -> validate task ID / provider estimate
   * -> durable submission callback
   * -> only then poll the accepted task
   *
   * This transaction supplies immutable recovery metadata so that
   * the production runner can persist exactly what was submitted.
   */
  const execution =
    await dependencies
      .executeGeneration(
        request,
        waitTimeoutMs,
        recoveryMetadata,
      );

  const outputs:
    DialogueGenerationRecordV3["outputs"] =
      [];

  for (
    const [
      zeroBasedIndex,
      outputUrl,
    ]
    of execution.outputUrls.entries()
  ) {
    const outputIndex =
      zeroBasedIndex +
      1;

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
    DialogueGenerationRecordV3 = {
      schemaVersion:
        "3.0",

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
        localCeiling:
          localCreditCeiling,

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
