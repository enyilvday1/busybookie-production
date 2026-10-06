import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  DialogueLifecycleClassification,
} from "../src/dialogue/classifyDialogueLifecycle.js";

import {
  createRunwayDirectSeedAudioProductionReconciler,
} from "../src/dialogue/createRunwayDirectSeedAudioProductionReconciler.js";

import type {
  DialogueCompletionInput,
} from "../src/dialogue/dialogueCompletion.schema.js";

import type {
  RunwayCredentialSource,
} from "../src/runway/runway.types.js";

import type {
  DialogueLifecycleReconciliationDependencies,
  DialogueLifecycleReconciliationInput,
  DialogueLifecycleReconciliationResult,
} from "../src/dialogue/reconcileDialogueLifecycle.js";

import type {
  ResumeRunwayReferenceAudioTaskInput,
  RunwayReferenceAudioTaskLookupClient,
  RunwayReferenceAudioTaskResumeResult,
} from "../src/dialogue/resumeRunwayReferenceAudioTask.js";

import {
  loadDialogueSeedAudioPolicy,
} from "../src/validation/loadDialogueSeedAudioPolicy.js";

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

const credentialSource:
  RunwayCredentialSource =
    Object.freeze({
      RUNWAYML_API_SECRET:
        "test-runway-secret",
    });

const providerExecutionId =
  "task-direct-seed-audio-recovery";

const submittedLifecycle =
  Object.freeze({
    state:
      "SUBMITTED",

    reservation:
      Object.freeze({
        reservationId:
          "11111111-1111-4111-8111-111111111111",

        ...identity,

        planKey,

        provider:
          "RUNWAY",
      }),

    submission:
      Object.freeze({
        schemaVersion:
          "3.0",

        ...identity,

        planKey,

        provider:
          "RUNWAY",

        providerExecutionId,

        providerEstimatedCredits:
          5,
      }),
  }) as unknown as
    DialogueLifecycleClassification;

const completedLifecycle =
  Object.freeze({
    ...submittedLifecycle,

    state:
      "COMPLETED",

    completion:
      Object.freeze({
        ...identity,

        planKey,

        provider:
          "RUNWAY",

        providerExecutionId,
      }),
  }) as unknown as
    DialogueLifecycleClassification;

const recoveredResult =
  Object.freeze({
    marker:
      "recovered-direct-seed-audio",
  }) as unknown as
    DialogueLifecycleReconciliationResult;

const durableResult =
  Object.freeze({
    marker:
      "durable-direct-seed-audio",
  }) as unknown as
    DialogueLifecycleReconciliationResult;

const scopedCompletionPath =
  `${mediaRoot}/voices/${identity.episodeId}/${identity.shotId}/${identity.dialogueLineId}/direct-seed-audio/${planKey}/${identity.dialogueLineId}.dialogue-completion.json`;

function createLookupClient():
  RunwayReferenceAudioTaskLookupClient {
  return Object.freeze({
    tasks:
      Object.freeze({
        retrieve:
          vi.fn(),
      }),
  }) as unknown as
    RunwayReferenceAudioTaskLookupClient;
}

describe(
  "BusyBookie Runway direct SeedAudio production reconciler",
  () => {
    it(
      "uses the explicit plan key for scoped durable-completion inspection without preparing provider recovery",
      async () => {
        const inspectLifecycle =
          vi.fn(
            async (
              receivedMediaRoot:
                string,

              episodeId:
                string,

              sceneId:
                string,

              shotId:
                string,

              dialogueLineId:
                string,

              receivedPlanKey:
                string,
            ) => {
              expect(
                receivedMediaRoot,
              ).toBe(
                mediaRoot,
              );

              expect({
                episodeId,
                sceneId,
                shotId,
                dialogueLineId,
              }).toEqual(
                identity,
              );

              expect(
                receivedPlanKey,
              ).toBe(
                planKey,
              );

              return completedLifecycle;
            },
          );

        const loadPolicy =
          vi.fn(
            async () =>
              ({
                task: {
                  waitTimeoutMs:
                    654_321,
                },
              }) as
                Awaited<
                  ReturnType<
                    typeof loadDialogueSeedAudioPolicy
                  >
                >,
          );

        const lookupClient =
          createLookupClient();

        const createLookupClientMock =
          vi.fn(
            (
              _source:
                RunwayCredentialSource,
            ) =>
              lookupClient,
          );

        const resumeRunwayReferenceAudioTask =
          vi.fn(
            async (
              _client:
                RunwayReferenceAudioTaskLookupClient,

              _input:
                ResumeRunwayReferenceAudioTaskInput,
            ): Promise<
              RunwayReferenceAudioTaskResumeResult
            > => {
              throw new Error(
                "PROVIDER_RECOVERY_MUST_NOT_RUN_FOR_DURABLE_COMPLETION",
              );
            },
          );

        const recoverCompletion =
          vi.fn(
            async (
              _receivedMediaRoot:
                string,

              _input:
                DialogueCompletionInput,
            ) => {
              throw new Error(
                "COMPLETION_RECOVERY_MUST_NOT_RUN_FOR_DURABLE_COMPLETION",
              );
            },
          );

        const resolveCompletionPath =
          vi.fn(
            (
              _receivedMediaRoot:
                string,

              _episodeId:
                string,

              _sceneId:
                string,

              _shotId:
                string,

              _dialogueLineId:
                string,

              receivedPlanKey:
                string,
            ) => {
              expect(
                receivedPlanKey,
              ).toBe(
                planKey,
              );

              return scopedCompletionPath;
            },
          );

        const reconcileLifecycle =
          vi.fn(
            async (
              reconciliationInput:
                DialogueLifecycleReconciliationInput,

              dependencies:
                DialogueLifecycleReconciliationDependencies,
            ) => {
              expect(
                reconciliationInput,
              ).toEqual({
                mediaRoot,
                ...identity,
              });

              expect(
                await dependencies
                  .inspectLifecycle(
                    mediaRoot,
                    identity.episodeId,
                    identity.sceneId,
                    identity.shotId,
                    identity.dialogueLineId,
                  ),
              ).toBe(
                completedLifecycle,
              );

              expect(
                dependencies
                  .resolveCompletionPath,
              ).toBe(
                resolveCompletionPath,
              );

              expect(
                dependencies
                  .resumeRunwayReferenceAudioTask,
              ).toBeUndefined();

              return durableResult;
            },
          );

        const reconcile =
          createRunwayDirectSeedAudioProductionReconciler(
            credentialSource,
            {
              inspectLifecycle,
              loadPolicy,
              createLookupClient:
                createLookupClientMock,
              resumeRunwayReferenceAudioTask,
              recoverCompletion,
              resolveCompletionPath,
              reconcileLifecycle,
            },
          );

        const result =
          await reconcile({
            mediaRoot,
            ...identity,
            planKey,
          });

        expect(
          result,
        ).toBe(
          durableResult,
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          loadPolicy,
        ).not.toHaveBeenCalled();

        expect(
          createLookupClientMock,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayReferenceAudioTask,
        ).not.toHaveBeenCalled();

        expect(
          recoverCompletion,
        ).not.toHaveBeenCalled();

        expect(
          reconcileLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "recovers a submitted v3 task with the SeedAudio timeout, same-task adapter, and plan-scoped completion dependencies",
      async () => {
        const inspectLifecycle =
          vi.fn(
            async (
              _receivedMediaRoot:
                string,

              _episodeId:
                string,

              _sceneId:
                string,

              _shotId:
                string,

              _dialogueLineId:
                string,

              receivedPlanKey:
                string,
            ) => {
              expect(
                receivedPlanKey,
              ).toBe(
                planKey,
              );

              return submittedLifecycle;
            },
          );

        const seedAudioWaitTimeoutMs =
          654_321;

        const loadPolicy =
          vi.fn(
            async () =>
              ({
                task: {
                  waitTimeoutMs:
                    seedAudioWaitTimeoutMs,
                },
              }) as
                Awaited<
                  ReturnType<
                    typeof loadDialogueSeedAudioPolicy
                  >
                >,
          );

        const lookupClient =
          createLookupClient();

        const createLookupClientMock =
          vi.fn(
            (
              source:
                RunwayCredentialSource,
            ) => {
              expect(
                source,
              ).toBe(
                credentialSource,
              );

              return lookupClient;
            },
          );

        const providerExecution:
          RunwayReferenceAudioTaskResumeResult =
            Object.freeze({
              taskId:
                providerExecutionId,

              providerCreatedAt:
                "2026-10-06T18:20:00.000Z",

              estimatedCredits:
                5,

              finalCredits:
                5,

              outputUrls:
                Object.freeze([
                  "https://example.test/direct-seed-audio-output",
                ]),
            });

        const resumeRunwayReferenceAudioTask =
          vi.fn(
            async (
              client:
                RunwayReferenceAudioTaskLookupClient,

              resumeInput:
                ResumeRunwayReferenceAudioTaskInput,
            ) => {
              expect(
                client,
              ).toBe(
                lookupClient,
              );

              expect(
                resumeInput,
              ).toEqual({
                taskId:
                  providerExecutionId,

                providerEstimatedCredits:
                  5,

                waitTimeoutMs:
                  seedAudioWaitTimeoutMs,
              });

              return providerExecution;
            },
          );

        const recoverCompletion =
          vi.fn(
            async (
              _receivedMediaRoot:
                string,

              _input:
                DialogueCompletionInput,
            ) => {
              throw new Error(
                "CORE_TEST_STUB_MUST_NOT_CALL_RECOVER_COMPLETION_DIRECTLY",
              );
            },
          );

        const resolveCompletionPath =
          vi.fn(
            (
              _receivedMediaRoot:
                string,

              _episodeId:
                string,

              _sceneId:
                string,

              _shotId:
                string,

              _dialogueLineId:
                string,

              receivedPlanKey:
                string,
            ) => {
              expect(
                receivedPlanKey,
              ).toBe(
                planKey,
              );

              return scopedCompletionPath;
            },
          );

        const reconcileLifecycle =
          vi.fn(
            async (
              reconciliationInput:
                DialogueLifecycleReconciliationInput,

              dependencies:
                DialogueLifecycleReconciliationDependencies,
            ) => {
              expect(
                reconciliationInput,
              ).toEqual({
                mediaRoot,
                ...identity,

                runwayWaitTimeoutMs:
                  seedAudioWaitTimeoutMs,
              });

              expect(
                await dependencies
                  .inspectLifecycle(
                    mediaRoot,
                    identity.episodeId,
                    identity.sceneId,
                    identity.shotId,
                    identity.dialogueLineId,
                  ),
              ).toBe(
                submittedLifecycle,
              );

              expect(
                dependencies
                  .recoverCompletion,
              ).toBe(
                recoverCompletion,
              );

              expect(
                dependencies
                  .resolveCompletionPath,
              ).toBe(
                resolveCompletionPath,
              );

              const resume =
                dependencies
                  .resumeRunwayReferenceAudioTask;

              expect(
                resume,
              ).toBeDefined();

              expect(
                await resume?.({
                  taskId:
                    providerExecutionId,

                  providerEstimatedCredits:
                    5,

                  waitTimeoutMs:
                    seedAudioWaitTimeoutMs,
                }),
              ).toBe(
                providerExecution,
              );

              expect(
                dependencies
                  .resumeRunwayTask,
              ).toBeUndefined();

              return recoveredResult;
            },
          );

        const reconcile =
          createRunwayDirectSeedAudioProductionReconciler(
            credentialSource,
            {
              inspectLifecycle,
              loadPolicy,
              createLookupClient:
                createLookupClientMock,
              resumeRunwayReferenceAudioTask,
              recoverCompletion,
              resolveCompletionPath,
              reconcileLifecycle,
            },
          );

        const result =
          await reconcile({
            mediaRoot,
            ...identity,
            planKey,
          });

        expect(
          result,
        ).toBe(
          recoveredResult,
        );

        expect(
          loadPolicy,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createLookupClientMock,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          resumeRunwayReferenceAudioTask,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          reconcileLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "fails closed if the scoped production boundary is given non-v3 submission evidence",
      async () => {
        const invalidLifecycle =
          Object.freeze({
            state:
              "SUBMITTED",

            reservation:
              Object.freeze({}),

            submission:
              Object.freeze({
                schemaVersion:
                  "2.0",
              }),
          }) as unknown as
            DialogueLifecycleClassification;

        const inspectLifecycle =
          vi.fn(
            async (
              _receivedMediaRoot:
                string,

              _episodeId:
                string,

              _sceneId:
                string,

              _shotId:
                string,

              _dialogueLineId:
                string,

              _receivedPlanKey:
                string,
            ) =>
              invalidLifecycle,
          );

        const loadPolicy =
          vi.fn(
            async () =>
              ({
                task: {
                  waitTimeoutMs:
                    654_321,
                },
              }) as
                Awaited<
                  ReturnType<
                    typeof loadDialogueSeedAudioPolicy
                  >
                >,
          );

        const createLookupClientMock =
          vi.fn(
            (
              _source:
                RunwayCredentialSource,
            ) =>
              createLookupClient(),
          );

        const resumeRunwayReferenceAudioTask =
          vi.fn();

        const recoverCompletion =
          vi.fn();

        const resolveCompletionPath =
          vi.fn(
            () =>
              scopedCompletionPath,
          );

        const reconcileLifecycle =
          vi.fn();

        const reconcile =
          createRunwayDirectSeedAudioProductionReconciler(
            credentialSource,
            {
              inspectLifecycle,
              loadPolicy,
              createLookupClient:
                createLookupClientMock,
              resumeRunwayReferenceAudioTask,
              recoverCompletion,
              resolveCompletionPath,
              reconcileLifecycle,
            },
          );

        await expect(
          reconcile({
            mediaRoot,
            ...identity,
            planKey,
          }),
        ).rejects.toThrow(
          /direct SeedAudio.*v3|v3.*direct SeedAudio/i,
        );

        expect(
          loadPolicy,
        ).not.toHaveBeenCalled();

        expect(
          createLookupClientMock,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayReferenceAudioTask,
        ).not.toHaveBeenCalled();

        expect(
          reconcileLifecycle,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
