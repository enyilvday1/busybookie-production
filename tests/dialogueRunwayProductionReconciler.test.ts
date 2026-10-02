import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createRunwayDialogueProductionReconciler,
  type RunwayDialogueProductionReconcilerDependencies,
} from "../src/dialogue/createRunwayDialogueProductionReconciler.js";

import type {
  DialogueLifecycleClassification,
} from "../src/dialogue/classifyDialogueLifecycle.js";

import type {
  DialogueLifecycleReconciliationResult,
} from "../src/dialogue/reconcileDialogueLifecycle.js";

import type {
  DialogueVoicePolicy,
} from "../src/schemas/dialogueVoicePolicy.schema.js";

import type {
  RunwayCredentialSource,
} from "../src/runway/runway.types.js";

const credentialSource:
  RunwayCredentialSource = {
    RUNWAYML_API_SECRET:
      "test-runway-secret",
  };

const input =
  Object.freeze({
    mediaRoot:
      "D:/Busybookie/Production",

    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    dialogueLineId:
      "EP02_SC01_S02_L01",
  });

const policy =
  Object.freeze({
    schemaVersion:
      "1.0" as const,

    pricingReviewedOn:
      "2026-10-01",

    generation: {
      model:
        "eleven_v3" as const,

      charactersPerCredit:
        50,

      minimumCredits:
        1,

      maxCreditsPerLine:
        10,

      maxPromptCharacters:
        500,

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

    task: {
      waitTimeoutMs:
        600_000,
    },
  }) satisfies
    DialogueVoicePolicy;

const durableResult =
  Object.freeze({
    lifecycleState:
      "COMPLETED",

    reconciliationMode:
      "DURABLE_COMPLETION",

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-dialogue-123",

    generationRecord:
      {},

    generationRecordPath:
      "D:/Busybookie/Production/example.dialogue-generation.json",

    completion:
      {},

    completionPath:
      "D:/Busybookie/Production/example.dialogue-completion.json",
  }) as unknown as
    DialogueLifecycleReconciliationResult;

const recoveredResult =
  Object.freeze({
    lifecycleState:
      "COMPLETED",

    reconciliationMode:
      "RECOVERED_SUBMISSION",

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-dialogue-123",

    providerExecution:
      {},

    generationRecord:
      {},

    generationRecordPath:
      "D:/Busybookie/Production/example.dialogue-generation.json",

    completion:
      {},

    completionPath:
      "D:/Busybookie/Production/example.dialogue-completion.json",
  }) as unknown as
    DialogueLifecycleReconciliationResult;

describe(
  "Busybookie Runway dialogue production reconciler",
  () => {
    it(
      "keeps COMPLETED dialogue reconciliation entirely local and does not prepare Runway recovery capability",
      async () => {
        const completedLifecycle =
          {
            state:
              "COMPLETED",
          } as unknown as
            DialogueLifecycleClassification;

        const inspectLifecycle =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "inspectLifecycle"
            ]
          >(
            async () =>
              completedLifecycle,
          );

        const loadPolicy =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "loadPolicy"
            ]
          >(
            async () =>
              policy,
          );

        const createLookupClient =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "createLookupClient"
            ]
          >();

        const resumeRunwayTask =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "resumeRunwayTask"
            ]
          >();

        const reconcileLifecycle =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "reconcileLifecycle"
            ]
          >(
            async (
              reconciliationInput,
              dependencies,
            ) => {
              expect(
                reconciliationInput,
              ).toEqual(
                input,
              );

              expect(
                await dependencies
                  .inspectLifecycle(
                    input.mediaRoot,
                    input.episodeId,
                    input.sceneId,
                    input.shotId,
                    input.dialogueLineId,
                  ),
              ).toBe(
                completedLifecycle,
              );

              expect(
                dependencies
                  .resumeRunwayTask,
              ).toBeUndefined();

              return durableResult;
            },
          );

        const reconcile =
          createRunwayDialogueProductionReconciler(
            credentialSource,
            {
              inspectLifecycle,
              loadPolicy,
              createLookupClient,
              resumeRunwayTask,
              reconcileLifecycle,
            },
          );

        const result =
          await reconcile(
            input,
          );

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
          createLookupClient,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          reconcileLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "for SUBMITTED dialogue loads recovery policy and binds the lookup-only Runway client to same-task resume",
      async () => {
        const submittedLifecycle =
          {
            state:
              "SUBMITTED",
          } as unknown as
            DialogueLifecycleClassification;

        const inspectLifecycle =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "inspectLifecycle"
            ]
          >(
            async () =>
              submittedLifecycle,
          );

        const loadPolicy =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "loadPolicy"
            ]
          >(
            async () =>
              policy,
          );

        const lookupClient =
          Object.freeze({
            tasks:
              Object.freeze({
                retrieve:
                  vi.fn(),
              }),
          });

        const createLookupClient =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "createLookupClient"
            ]
          >(
            () =>
              lookupClient as
                ReturnType<
                  RunwayDialogueProductionReconcilerDependencies[
                    "createLookupClient"
                  ]
                >,
          );

        const providerExecution =
          Object.freeze({
            taskId:
              "task-dialogue-123",

            providerCreatedAt:
              "2026-10-01T22:02:00.000Z",

            estimatedCredits:
              1,

            finalCredits:
              1,

            outputUrls: [
              "https://example.test/dialogue-output",
            ],
          });

        const resumeRunwayTask =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "resumeRunwayTask"
            ]
          >(
            async (
              client,
              resumeInput,
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
                  "task-dialogue-123",

                providerEstimatedCredits:
                  1,

                waitTimeoutMs:
                  600_000,
              });

              return providerExecution;
            },
          );

        const reconcileLifecycle =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "reconcileLifecycle"
            ]
          >(
            async (
              reconciliationInput,
              dependencies,
            ) => {
              expect(
                reconciliationInput,
              ).toEqual({
                ...input,

                runwayWaitTimeoutMs:
                  policy.task
                    .waitTimeoutMs,
              });

              expect(
                await dependencies
                  .inspectLifecycle(
                    input.mediaRoot,
                    input.episodeId,
                    input.sceneId,
                    input.shotId,
                    input.dialogueLineId,
                  ),
              ).toBe(
                submittedLifecycle,
              );

              const resume =
                dependencies
                  .resumeRunwayTask;

              expect(
                resume,
              ).toBeDefined();

              expect(
                await resume?.({
                  taskId:
                    "task-dialogue-123",

                  providerEstimatedCredits:
                    1,

                  waitTimeoutMs:
                    600_000,
                }),
              ).toBe(
                providerExecution,
              );

              return recoveredResult;
            },
          );

        const reconcile =
          createRunwayDialogueProductionReconciler(
            credentialSource,
            {
              inspectLifecycle,
              loadPolicy,
              createLookupClient,
              resumeRunwayTask,
              reconcileLifecycle,
            },
          );

        const result =
          await reconcile(
            input,
          );

        expect(
          result,
        ).toBe(
          recoveredResult,
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          loadPolicy,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createLookupClient,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createLookupClient,
        ).toHaveBeenCalledWith(
          credentialSource,
        );

        expect(
          resumeRunwayTask,
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

    it.each([
      "NOTHING",
      "RESERVED_ONLY",
    ] as const)(
      "does not prepare Runway recovery capability for lifecycle state %s",
      async (
        state,
      ) => {
        const lifecycle =
          {
            state,
          } as unknown as
            DialogueLifecycleClassification;

        const inspectLifecycle =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "inspectLifecycle"
            ]
          >(
            async () =>
              lifecycle,
          );

        const loadPolicy =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "loadPolicy"
            ]
          >(
            async () =>
              policy,
          );

        const createLookupClient =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "createLookupClient"
            ]
          >();

        const resumeRunwayTask =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "resumeRunwayTask"
            ]
          >();

        const reconcileLifecycle =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "reconcileLifecycle"
            ]
          >(
            async (
              _reconciliationInput,
              dependencies,
            ) => {
              expect(
                await dependencies
                  .inspectLifecycle(
                    input.mediaRoot,
                    input.episodeId,
                    input.sceneId,
                    input.shotId,
                    input.dialogueLineId,
                  ),
              ).toBe(
                lifecycle,
              );

              throw new Error(
                `Dialogue lifecycle reconciliation requires a SUBMITTED or COMPLETED lifecycle; found ${state}.`,
              );
            },
          );

        const reconcile =
          createRunwayDialogueProductionReconciler(
            credentialSource,
            {
              inspectLifecycle,
              loadPolicy,
              createLookupClient,
              resumeRunwayTask,
              reconcileLifecycle,
            },
          );

        await expect(
          reconcile(
            input,
          ),
        ).rejects.toThrow(
          /SUBMITTED|COMPLETED/i,
        );

        expect(
          loadPolicy,
        ).not.toHaveBeenCalled();

        expect(
          createLookupClient,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
