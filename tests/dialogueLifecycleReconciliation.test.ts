import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createDialogueAudioOutputPath,
} from "../src/dialogue/dialogueAudioOutputPath.js";

import type {
  DialogueCompletion,
  DialogueCompletionInput,
} from "../src/dialogue/dialogueCompletion.schema.js";

import {
  createDialogueCompletionPath,
} from "../src/dialogue/dialogueCompletionPath.js";

import type {
  DialogueGenerationRecord,
} from "../src/dialogue/dialogueGenerationRecord.schema.js";

import {
  createDialogueGenerationRecordPath,
} from "../src/dialogue/dialogueGenerationRecordPath.js";

import type {
  DialogueLifecycleClassification,
} from "../src/dialogue/classifyDialogueLifecycle.js";

import type {
  DownloadedDialogueAudioOutput,
} from "../src/dialogue/downloadDialogueAudioOutput.js";

import type {
  InspectedDialogueAudioOutput,
} from "../src/dialogue/recoverDialogueAudioOutput.js";

import type {
  RecoverDialogueCompletionResult,
} from "../src/dialogue/recoverDialogueCompletion.js";

import type {
  RecoverDialogueGenerationRecordResult,
} from "../src/dialogue/recoverDialogueGenerationRecord.js";

import {
  reconcileDialogueLifecycle,
} from "../src/dialogue/reconcileDialogueLifecycle.js";

import type {
  ResumeRunwayElevenV3TaskInput,
} from "../src/dialogue/resumeRunwayElevenV3Task.js";

import type {
  RunwayElevenV3ExecutionResult,
} from "../src/dialogue/runwayElevenV3Execution.js";

import type {
  DialogueReservation,
} from "../src/dialogue/dialogueReservation.schema.js";

import type {
  DialogueSubmission,
} from "../src/dialogue/dialogueSubmission.schema.js";

const mediaRoot =
  "D:/Busybookie/Production";

const identity =
  Object.freeze({
    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    dialogueLineId:
      "EP02_SC01_S02_L01",
  });

const planKey =
  "a".repeat(
    64,
  );

const reservation:
  DialogueReservation = {
    schemaVersion:
      "1.0",

    reservationId:
      "11111111-1111-4111-8111-111111111111",

    reservedAt:
      "2026-10-01T22:00:00.000Z",

    status:
      "RESERVED",

    ...identity,

    planKey,

    provider:
      "RUNWAY",
  };

const recoveryMetadata =
  Object.freeze({
    request: {
      model:
        "eleven_v3" as const,

      promptText:
        "Look what I found!",

      voice: {
        type:
          "runway-preset" as const,

        presetId:
          "Chad" as const,
      },

      applyTextNormalization:
        "auto" as const,

      languageCode:
        "en",

      seed:
        0,

      similarityBoost:
        0.75,

      speed:
        1,

      stability:
        0.5,

      style:
        0,

      useSpeakerBoost:
        true,
    },

    locallyExpectedCredits:
      1,

    plan: {
      planKey,

      ...identity,

      lineNumber:
        1,

      characterId:
        "OLLIE" as const,

      characterName:
        "Ollie",

      text:
        "Look what I found!",

      deliveryNotes:
        "Curious, excited and gentle.",

      voice: {
        provider:
          "RUNWAY" as const,

        voiceName:
          "Chad",

        deliveryTraits: [
          "young",
          "curious",
          "warm",
          "friendly",
          "natural",
        ],
      },
    },
  });

const submission:
  DialogueSubmission = {
    schemaVersion:
      "1.0",

    submittedAt:
      "2026-10-01T22:01:00.000Z",

    status:
      "SUBMITTED",

    reservationId:
      reservation.reservationId,

    ...identity,

    planKey,

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-dialogue-123",

    providerEstimatedCredits:
      1,

    recoveryMetadata,
  };

const generationRecordPath =
  createDialogueGenerationRecordPath(
    mediaRoot,
    identity.episodeId,
    identity.shotId,
    identity.dialogueLineId,
    "RUNWAY",
    submission.providerExecutionId,
  );

const audioOutputPath =
  createDialogueAudioOutputPath(
    mediaRoot,
    identity.episodeId,
    identity.shotId,
    identity.dialogueLineId,
    "RUNWAY",
    submission.providerExecutionId,
    1,
  );

const completionPath =
  createDialogueCompletionPath(
    mediaRoot,
    identity.episodeId,
    identity.sceneId,
    identity.shotId,
    identity.dialogueLineId,
  );

const generationRecord:
  DialogueGenerationRecord = {
    schemaVersion:
      "1.0",

    recordedAt:
      "2026-10-01T22:03:00.000Z",

    status:
      "SUCCEEDED",

    provider:
      "RUNWAY",

    providerExecutionId:
      submission.providerExecutionId,

    providerModel:
      "eleven_v3",

    providerCreatedAt:
      "2026-10-01T22:02:00.000Z",

    request:
      recoveryMetadata.request,

    credits: {
      locallyExpected:
        recoveryMetadata
          .locallyExpectedCredits,

      providerEstimated:
        submission
          .providerEstimatedCredits,

      providerFinal:
        1,
    },

    plan:
      recoveryMetadata.plan,

    outputs: [
      {
        outputIndex:
          1,

        destinationPath:
          audioOutputPath,

        bytes:
          123,

        sha256:
          "b".repeat(
            64,
          ),

        contentType:
          "audio/mpeg",
      },
    ],
  };

const completion:
  DialogueCompletion = {
    schemaVersion:
      "1.0",

    completedAt:
      "2026-10-01T22:04:00.000Z",

    status:
      "COMPLETED",

    reservationId:
      reservation.reservationId,

    ...identity,

    planKey,

    provider:
      "RUNWAY",

    providerExecutionId:
      submission.providerExecutionId,

    generationRecordPath,
  };

type ReconciliationDependencies =
  Readonly<{
    inspectLifecycle:
      (
        mediaRoot:
          string,

        episodeId:
          string,

        sceneId:
          string,

        shotId:
          string,

        dialogueLineId:
          string,
      ) =>
        Promise<
          DialogueLifecycleClassification
        >;

    resumeRunwayTask?:
      (
        input:
          ResumeRunwayElevenV3TaskInput,
      ) =>
        Promise<
          RunwayElevenV3ExecutionResult
        >;

    recoverOutput?:
      (
        sourceUrl:
          string,

        destinationPath:
          string,
      ) =>
        Promise<
          DownloadedDialogueAudioOutput
        >;

    inspectOutput?:
      (
        filePath:
          string,
      ) =>
        Promise<
          InspectedDialogueAudioOutput
        >;

    recoverGenerationRecord?:
      (
        mediaRoot:
          string,

        input:
          DialogueGenerationRecord,
      ) =>
        Promise<
          RecoverDialogueGenerationRecordResult
        >;

    readGenerationRecord?:
      (
        mediaRoot:
          string,

        episodeId:
          string,

        shotId:
          string,

        dialogueLineId:
          string,

        provider:
          "RUNWAY",

        providerExecutionId:
          string,
      ) =>
        Promise<
          DialogueGenerationRecord | null
        >;

    recoverCompletion?:
      (
        mediaRoot:
          string,

        input:
          DialogueCompletionInput,
      ) =>
        Promise<
          RecoverDialogueCompletionResult
        >;

    now?:
      () => string;
  }>;

function createSubmittedDependencies() {
  const providerExecution:
    RunwayElevenV3ExecutionResult = {
      taskId:
        submission.providerExecutionId,

      providerCreatedAt:
        "2026-10-01T22:02:00.000Z",

      estimatedCredits:
        submission
          .providerEstimatedCredits,

      finalCredits:
        1,

      outputUrls: [
        "https://example.test/dialogue-output",
      ],
    };

  const inspectLifecycle =
    vi.fn(
      async () =>
        ({
          state:
            "SUBMITTED",

          reservation,

          submission,
        }) satisfies
          DialogueLifecycleClassification,
    );

  const resumeRunwayTask =
    vi.fn(
      async (
        _input:
          ResumeRunwayElevenV3TaskInput,
      ) =>
        providerExecution,
    );

  const recoveredOutput:
    DownloadedDialogueAudioOutput = {
      destinationPath:
        audioOutputPath,

      bytes:
        123,

      sha256:
        "b".repeat(
          64,
        ),

      contentType:
        "audio/mpeg",
    };

  const recoverOutput =
    vi.fn(
      async (
        _sourceUrl:
          string,

        _destinationPath:
          string,
      ) =>
        recoveredOutput,
    );

  const recoverGenerationRecord =
    vi.fn(
      async (
        _mediaRoot:
          string,

        input:
          DialogueGenerationRecord,
      ) =>
        ({
          record:
            input,

          recordPath:
            generationRecordPath,
        }) satisfies
          RecoverDialogueGenerationRecordResult,
    );

  const recoveredCompletion:
    RecoverDialogueCompletionResult = {
      record:
        completion,

      completionPath,
    };

  const recoverCompletion =
    vi.fn(
      async (
        _mediaRoot:
          string,

        _input:
          DialogueCompletionInput,
      ) =>
        recoveredCompletion,
    );

  const dependencies = {
    inspectLifecycle,
    resumeRunwayTask,
    recoverOutput,
    recoverGenerationRecord,
    recoverCompletion,

    now:
      () =>
        "2026-10-01T22:03:00.000Z",
  } satisfies
    ReconciliationDependencies;

  return {
    dependencies,
    inspectLifecycle,
    resumeRunwayTask,
    recoverOutput,
    recoverGenerationRecord,
    recoverCompletion,
    providerExecution,
    recoveredOutput,
    recoveredCompletion,
  };
}

describe(
  "Busybookie dialogue lifecycle reconciliation",
  () => {
    it(
      "recovers a durable submitted Runway dialogue task without creating a new provider task",
      async () => {
        const harness =
          createSubmittedDependencies();

        const result =
          await reconcileDialogueLifecycle(
            {
              mediaRoot,

              ...identity,

              runwayWaitTimeoutMs:
                600_000,
            },
            harness.dependencies,
          );

        expect(
          harness.inspectLifecycle,
        ).toHaveBeenCalledWith(
          mediaRoot,
          identity.episodeId,
          identity.sceneId,
          identity.shotId,
          identity.dialogueLineId,
        );

        expect(
          harness.resumeRunwayTask,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.resumeRunwayTask,
        ).toHaveBeenCalledWith({
          taskId:
            submission
              .providerExecutionId,

          providerEstimatedCredits:
            submission
              .providerEstimatedCredits,

          waitTimeoutMs:
            600_000,
        });

        expect(
          harness.recoverOutput,
        ).toHaveBeenCalledWith(
          "https://example.test/dialogue-output",
          audioOutputPath,
        );

        expect(
          harness.recoverGenerationRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        const recoveredRecord =
          harness
            .recoverGenerationRecord
            .mock
            .calls[0]?.[1];

        expect(
          recoveredRecord,
        ).toEqual(
          generationRecord,
        );

        expect(
          harness.recoverCompletion,
        ).toHaveBeenCalledWith(
          mediaRoot,
          {
            reservationId:
              reservation
                .reservationId,

            ...identity,

            planKey,

            provider:
              "RUNWAY",

            providerExecutionId:
              submission
                .providerExecutionId,

            generationRecordPath,
          },
        );

        expect(
          result,
        ).toEqual({
          lifecycleState:
            "COMPLETED",

          reconciliationMode:
            "RECOVERED_SUBMISSION",

          provider:
            "RUNWAY",

          providerExecutionId:
            submission
              .providerExecutionId,

          providerExecution:
            harness
              .providerExecution,

          generationRecord,

          generationRecordPath,

          completion,

          completionPath,
        });
      },
    );

    it(
      "verifies an already-completed durable lifecycle without contacting Runway",
      async () => {
        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "COMPLETED",

                reservation,

                submission,

                completion,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const resumeRunwayTask =
          vi.fn();

        const recoverOutput =
          vi.fn();

        const recoverGenerationRecord =
          vi.fn();

        const recoverCompletion =
          vi.fn();

        const readGenerationRecord =
          vi.fn(
            async () =>
              generationRecord,
          );

        const inspectOutput =
          vi.fn(
            async () =>
              ({
                bytes:
                  123,

                sha256:
                  "b".repeat(
                    64,
                  ),
              }) satisfies
                InspectedDialogueAudioOutput,
          );

        const dependencies = {
          inspectLifecycle,
          resumeRunwayTask,
          recoverOutput,
          recoverGenerationRecord,
          recoverCompletion,
          readGenerationRecord,
          inspectOutput,
        } satisfies
          ReconciliationDependencies;

        const result =
          await reconcileDialogueLifecycle(
            {
              mediaRoot,

              ...identity,
            },
            dependencies,
          );

        expect(
          readGenerationRecord,
        ).toHaveBeenCalledWith(
          mediaRoot,
          identity.episodeId,
          identity.shotId,
          identity.dialogueLineId,
          "RUNWAY",
          submission.providerExecutionId,
        );

        expect(
          inspectOutput,
        ).toHaveBeenCalledWith(
          audioOutputPath,
        );

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          recoverOutput,
        ).not.toHaveBeenCalled();

        expect(
          recoverGenerationRecord,
        ).not.toHaveBeenCalled();

        expect(
          recoverCompletion,
        ).not.toHaveBeenCalled();

        expect(
          result,
        ).toEqual({
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

          completionPath,
        });
      },
    );

    it(
      "fails closed if the resumed task ID differs from the durable submission",
      async () => {
        const harness =
          createSubmittedDependencies();

        harness
          .resumeRunwayTask
          .mockResolvedValue({
            ...harness
              .providerExecution,

            taskId:
              "task-dialogue-different",
          });

        await expect(
          reconcileDialogueLifecycle(
            {
              mediaRoot,

              ...identity,

              runwayWaitTimeoutMs:
                600_000,
            },
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /task ID.*durable submission|durable submission.*task ID/i,
        );

        expect(
          harness.recoverOutput,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      {
        state:
          "NOTHING" as const,
      },

      {
        state:
          "RESERVED_ONLY" as const,

        reservation,
      },
    ])(
      "rejects lifecycle state $state because there is no durable submitted provider task to reconcile",
      async (
        lifecycle,
      ) => {
        const inspectLifecycle =
          vi.fn(
            async () =>
              lifecycle as
                DialogueLifecycleClassification,
          );

        await expect(
          reconcileDialogueLifecycle(
            {
              mediaRoot,

              ...identity,

              runwayWaitTimeoutMs:
                600_000,
            },
            {
              inspectLifecycle,
            },
          ),
        ).rejects.toThrow(
          /SUBMITTED|COMPLETED/i,
        );
      },
    );
  },
);
