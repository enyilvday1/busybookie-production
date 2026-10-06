import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createDialogueAudioOutputPath,
} from "../src/dialogue/dialogueAudioOutputPath.js";

import {
  createDialogueGenerationRecordPath,
} from "../src/dialogue/dialogueGenerationRecordPath.js";

import type {
  DialogueCompletion,
  DialogueCompletionInput,
} from "../src/dialogue/dialogueCompletion.schema.js";

import type {
  DialogueGenerationRecord,
} from "../src/dialogue/dialogueGenerationRecord.schema.js";

import type {
  DialogueLifecycleClassification,
} from "../src/dialogue/classifyDialogueLifecycle.js";

import type {
  DialogueReservation,
} from "../src/dialogue/dialogueReservation.schema.js";

import type {
  DialogueSubmissionV1,
} from "../src/dialogue/dialogueSubmission.schema.js";

import {
  reconcileDialogueLifecycle,
  type DialogueLifecycleReconciliationDependencies,
} from "../src/dialogue/reconcileDialogueLifecycle.js";

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

const providerExecutionId =
  "task-completion-path-resolver-test";

const request =
  Object.freeze({
    model:
      "eleven_v3",

    promptText:
      "Look what I found!",
  });

const plan =
  Object.freeze({
    ...identity,

    planKey,

    text:
      "Look what I found!",
  });

const recoveryMetadata =
  Object.freeze({
    plan,

    request,

    locallyExpectedCredits:
      1,
  });

const reservation =
  Object.freeze({
    schemaVersion:
      "1.0",

    reservationId:
      "11111111-1111-4111-8111-111111111111",

    reservedAt:
      "2026-10-06T18:00:00.000Z",

    status:
      "RESERVED",

    ...identity,

    planKey,

    provider:
      "RUNWAY",
  }) as unknown as
    DialogueReservation;

const submission =
  Object.freeze({
    schemaVersion:
      "1.0",

    reservationId:
      reservation.reservationId,

    submittedAt:
      "2026-10-06T18:01:00.000Z",

    status:
      "SUBMITTED",

    ...identity,

    planKey,

    provider:
      "RUNWAY",

    providerExecutionId,

    providerEstimatedCredits:
      1,

    recoveryMetadata,
  }) as unknown as
    DialogueSubmissionV1;

const generationRecordPath =
  createDialogueGenerationRecordPath(
    mediaRoot,
    identity.episodeId,
    identity.shotId,
    identity.dialogueLineId,
    "RUNWAY",
    providerExecutionId,
  );

const outputPath =
  createDialogueAudioOutputPath(
    mediaRoot,
    identity.episodeId,
    identity.shotId,
    identity.dialogueLineId,
    "RUNWAY",
    providerExecutionId,
    1,
  );

const generationRecord =
  Object.freeze({
    schemaVersion:
      "1.0",

    recordedAt:
      "2026-10-06T18:02:00.000Z",

    status:
      "SUCCEEDED",

    provider:
      "RUNWAY",

    providerExecutionId,

    providerModel:
      "eleven_v3",

    providerCreatedAt:
      "2026-10-06T18:01:30.000Z",

    request,

    credits:
      Object.freeze({
        locallyExpected:
          1,

        providerEstimated:
          1,

        providerFinal:
          1,
      }),

    plan,

    outputs:
      Object.freeze([
        Object.freeze({
          outputIndex:
            1,

          destinationPath:
            outputPath,

          bytes:
            123,

          sha256:
            "b".repeat(
              64,
            ),

          contentType:
            "audio/mpeg",
        }),
      ]),
  }) as unknown as
    DialogueGenerationRecord;

const completion =
  Object.freeze({
    schemaVersion:
      "1.0",

    completedAt:
      "2026-10-06T18:03:00.000Z",

    status:
      "COMPLETED",

    reservationId:
      reservation.reservationId,

    ...identity,

    planKey,

    provider:
      "RUNWAY",

    providerExecutionId,

    generationRecordPath,
  }) as
    DialogueCompletion;

const customCompletionPath =
  `${mediaRoot}/voices/${identity.episodeId}/${identity.shotId}/${identity.dialogueLineId}/custom/${planKey}/${identity.dialogueLineId}.dialogue-completion.json`;

type CompletionPathResolver =
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

    planKey:
      string,
  ) =>
    string;

type DependenciesWithCompletionPathResolver =
  DialogueLifecycleReconciliationDependencies &
  Readonly<{
    resolveCompletionPath:
      CompletionPathResolver;
  }>;

describe(
  "BusyBookie dialogue reconciliation canonical completion-path resolver seam",
  () => {
    it(
      "uses an injected canonical completion-path resolver for durable completion verification",
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

        const readGenerationRecord =
          vi.fn(
            async () =>
              generationRecord,
          );

        const inspectOutput =
          vi.fn(
            async () => ({
              bytes:
                123,

              sha256:
                "b".repeat(
                  64,
                ),
            }),
          );

        const resolveCompletionPath =
          vi.fn<
            CompletionPathResolver
          >(
            () =>
              customCompletionPath,
          );

        const dependencies =
          {
            inspectLifecycle,
            readGenerationRecord,
            inspectOutput,
            resolveCompletionPath,
          } as
            DependenciesWithCompletionPathResolver;

        const result =
          await reconcileDialogueLifecycle(
            {
              mediaRoot,
              ...identity,
            },
            dependencies,
          );

        expect(
          resolveCompletionPath,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          resolveCompletionPath,
        ).toHaveBeenCalledWith(
          mediaRoot,
          identity.episodeId,
          identity.sceneId,
          identity.shotId,
          identity.dialogueLineId,
          planKey,
        );

        expect(
          result.completionPath,
        ).toBe(
          customCompletionPath,
        );
      },
    );

    it(
      "uses the same injected canonical completion-path resolver when recovering a submitted lifecycle",
      async () => {
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
            async () => ({
              taskId:
                providerExecutionId,

              providerCreatedAt:
                "2026-10-06T18:01:30.000Z",

              estimatedCredits:
                1,

              finalCredits:
                1,

              outputUrls:
                [
                  "https://example.test/dialogue-output",
                ],
            }),
          );

        const recoverOutput =
          vi.fn(
            async (
              _sourceUrl:
                string,

              destinationPath:
                string,
            ) => ({
              destinationPath,

              bytes:
                123,

              sha256:
                "b".repeat(
                  64,
                ),

              contentType:
                "audio/mpeg",
            }),
          );

        const recoverGenerationRecord =
          vi.fn(
            async (
              _mediaRoot:
                string,

              record:
                DialogueGenerationRecord,
            ) => ({
              record,

              recordPath:
                generationRecordPath,
            }),
          );

        const resolveCompletionPath =
          vi.fn<
            CompletionPathResolver
          >(
            () =>
              customCompletionPath,
          );

        const recoverCompletion =
          vi.fn(
            async (
              _mediaRoot:
                string,

              input:
                DialogueCompletionInput,
            ) => ({
              record:
                Object.freeze({
                  schemaVersion:
                    "1.0",

                  completedAt:
                    "2026-10-06T18:03:00.000Z",

                  status:
                    "COMPLETED",

                  ...input,
                }) as
                  DialogueCompletion,

              completionPath:
                customCompletionPath,
            }),
          );

        const dependencies =
          {
            inspectLifecycle,
            resumeRunwayTask,
            recoverOutput,
            recoverGenerationRecord,
            recoverCompletion,
            resolveCompletionPath,

            now:
              () =>
                "2026-10-06T18:02:00.000Z",
          } as
            DependenciesWithCompletionPathResolver;

        const result =
          await reconcileDialogueLifecycle(
            {
              mediaRoot,
              ...identity,

              runwayWaitTimeoutMs:
                600_000,
            },
            dependencies,
          );

        expect(
          resolveCompletionPath,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          resolveCompletionPath,
        ).toHaveBeenCalledWith(
          mediaRoot,
          identity.episodeId,
          identity.sceneId,
          identity.shotId,
          identity.dialogueLineId,
          planKey,
        );

        expect(
          recoverCompletion,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result.completionPath,
        ).toBe(
          customCompletionPath,
        );
      },
    );
  },
);
