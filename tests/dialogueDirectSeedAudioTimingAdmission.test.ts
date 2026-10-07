import {
  createDialogueDirectSeedAudioCompletionPath,
} from "../src/dialogue/dialogueDirectSeedAudioLifecyclePaths.js";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  DialogueLifecycleReconciliationDependencies,
  DialogueLifecycleReconciliationResult,
} from "../src/dialogue/reconcileDialogueLifecycle.js";

import {
  verifyCompletedDialogueDirectSeedAudioLineForTiming,
} from "../src/dialogue/verifyCompletedDialogueDirectSeedAudioLineForTiming.js";

const MEDIA_ROOT =
  "D:/Busybookie/Production";

const PLAN_KEY =
  "3f94f116370e8b91036ce01d1122ccafcdd3d7ba84379f9a4b36db7113356a57";

const TASK_ID =
  "1c2664f3-2375-4bbc-8681-85b914d26883";

function createCompletedLifecycle() {
  return Object.freeze({
    state:
      "COMPLETED" as const,

    reservation:
      Object.freeze({
        schemaVersion:
          "1.0",

        reservationId:
          "reservation-direct-seed-audio-1",

        episodeId:
          "EP02",

        sceneId:
          "SC01",

        shotId:
          "S02",

        dialogueLineId:
          "EP02_SC01_S02_L01",

        planKey:
          PLAN_KEY,

        provider:
          "RUNWAY",
      }),

    submission:
      Object.freeze({
        schemaVersion:
          "3.0",

        status:
          "SUBMITTED" as const,

        reservationId:
          "reservation-direct-seed-audio-1",

        episodeId:
          "EP02",

        sceneId:
          "SC01",

        shotId:
          "S02",

        dialogueLineId:
          "EP02_SC01_S02_L01",

        planKey:
          PLAN_KEY,

        provider:
          "RUNWAY",

        providerExecutionId:
          TASK_ID,
      }),

    completion:
      Object.freeze({
        schemaVersion:
          "1.0",

        status:
          "COMPLETED" as const,

        reservationId:
          "reservation-direct-seed-audio-1",

        episodeId:
          "EP02",

        sceneId:
          "SC01",

        shotId:
          "S02",

        dialogueLineId:
          "EP02_SC01_S02_L01",

        planKey:
          PLAN_KEY,

        provider:
          "RUNWAY",

        providerExecutionId:
          TASK_ID,

        generationRecordPath:
          `${MEDIA_ROOT}/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01_RUNWAY_${TASK_ID}.dialogue-generation.json`,
      }),
  });
}

function createDurableVerification():
  DialogueLifecycleReconciliationResult {
  return Object.freeze({
    lifecycleState:
      "COMPLETED" as const,

    reconciliationMode:
      "DURABLE_COMPLETION" as const,

    provider:
      "RUNWAY" as const,

    providerExecutionId:
      TASK_ID,

    generationRecordPath:
      `${MEDIA_ROOT}/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01_RUNWAY_${TASK_ID}.dialogue-generation.json`,

    generationRecord:
      Object.freeze({
        schemaVersion:
          "3.0",

        status:
          "SUCCEEDED" as const,

        provider:
          "RUNWAY" as const,

        providerExecutionId:
          TASK_ID,

        plan:
          Object.freeze({
            schemaVersion:
              "2.0",

            episodeId:
              "EP02",

            sceneId:
              "SC01",

            shotId:
              "S02",

            dialogueLineId:
              "EP02_SC01_S02_L01",

            lineNumber:
              1,

            planKey:
              PLAN_KEY,
          }),

        outputs:
          Object.freeze([
            Object.freeze({
              outputIndex:
                1,

              destinationPath:
                `${MEDIA_ROOT}/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01_RUNWAY_${TASK_ID}_01.audio`,

              bytes:
                58_976,

              sha256:
                "e7207b0b6287c92551e10b21c9101b00edfc9a54246a104327d59047c324098a",

              contentType:
                "audio/mpeg",
            }),
          ]),
      }) as never,

    completion:
      createCompletedLifecycle()
        .completion as never,

    completionPath:
      `${MEDIA_ROOT}/voices/EP02/S02/EP02_SC01_S02_L01/direct-seed-audio/${PLAN_KEY}/EP02_SC01_S02_L01.dialogue-completion.json`,
  });
}

describe(
  "BusyBookie direct SeedAudio completed-line timing admission",
  () => {
    it(
      "uses the exact plan-scoped direct SeedAudio lifecycle and admits only durable completion evidence",
      async () => {
        const inspectLifecycle =
          vi.fn(
            async (
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
            ) => {
              expect(
                mediaRoot,
              ).toBe(
                MEDIA_ROOT,
              );

              expect(
                episodeId,
              ).toBe(
                "EP02",
              );

              expect(
                sceneId,
              ).toBe(
                "SC01",
              );

              expect(
                shotId,
              ).toBe(
                "S02",
              );

              expect(
                dialogueLineId,
              ).toBe(
                "EP02_SC01_S02_L01",
              );

              expect(
                planKey,
              ).toBe(
                PLAN_KEY,
              );

              return createCompletedLifecycle();
            },
          );

        const verified =
          createDurableVerification();

        const verifyLifecycle =
          vi.fn(
            async (
              input:
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
                }>,

              dependencies:
                DialogueLifecycleReconciliationDependencies,
            ):
            Promise<
              DialogueLifecycleReconciliationResult
            > => {
              expect(
                input,
              ).toEqual({
                mediaRoot:
                  MEDIA_ROOT,

                episodeId:
                  "EP02",

                sceneId:
                  "SC01",

                shotId:
                  "S02",

                dialogueLineId:
                  "EP02_SC01_S02_L01",
              });

              expect(
                dependencies
                  .inspectLifecycle,
              ).toEqual(
                expect.any(
                  Function,
                ),
              );

              expect(dependencies.resolveCompletionPath).toBe(
                createDialogueDirectSeedAudioCompletionPath,
              );

              return verified;
            },
          );

        const result =
          await verifyCompletedDialogueDirectSeedAudioLineForTiming(
            {
              mediaRoot:
                MEDIA_ROOT,

              episodeId:
                "EP02",

              sceneId:
                "SC01",

              shotId:
                "S02",

              dialogueLineId:
                "EP02_SC01_S02_L01",

              planKey:
                PLAN_KEY,
            },
            {
              resolveCompletionPath:
                createDialogueDirectSeedAudioCompletionPath,

              inspectLifecycle:
                inspectLifecycle as never,

              verifyLifecycle:
                verifyLifecycle as never,
            },
          );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledWith(
          MEDIA_ROOT,
          "EP02",
          "SC01",
          "S02",
          "EP02_SC01_S02_L01",
          PLAN_KEY,
        );

        expect(
          verifyLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result.lifecycleState,
        ).toBe(
          "COMPLETED",
        );

        expect(
          result.reconciliationMode,
        ).toBe(
          "DURABLE_COMPLETION",
        );

        expect(
          result.providerExecutionId,
        ).toBe(
          TASK_ID,
        );

        expect(
          result.output.destinationPath,
        ).toContain(
          TASK_ID,
        );
      },
    );

    it(
      "rejects a non-COMPLETED direct SeedAudio lifecycle before reconciliation",
      async () => {
        const lifecycle =
          Object.freeze({
            state:
              "SUBMITTED" as const,

            reservation:
              createCompletedLifecycle()
                .reservation,

            submission:
              createCompletedLifecycle()
                .submission,
          });

        const inspectLifecycle =
          vi.fn(
            async () =>
              lifecycle,
          );

        const verifyLifecycle =
          vi.fn();

        await expect(
          verifyCompletedDialogueDirectSeedAudioLineForTiming(
            {
              mediaRoot:
                MEDIA_ROOT,

              episodeId:
                "EP02",

              sceneId:
                "SC01",

              shotId:
                "S02",

              dialogueLineId:
                "EP02_SC01_S02_L01",

              planKey:
                PLAN_KEY,
            },
            {
              resolveCompletionPath:
                createDialogueDirectSeedAudioCompletionPath,

              inspectLifecycle:
                inspectLifecycle as never,

              verifyLifecycle:
                verifyLifecycle as never,
            },
          ),
        ).rejects.toThrow(
          /requires COMPLETED lifecycle/i,
        );

        expect(
          verifyLifecycle,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects non-v3 direct SeedAudio lifecycle evidence",
      async () => {
        const completed =
          createCompletedLifecycle();

        const lifecycle =
          Object.freeze({
            ...completed,

            submission:
              Object.freeze({
                ...completed.submission,

                schemaVersion:
                  "2.0",
              }),
          });

        const verifyLifecycle =
          vi.fn();

        await expect(
          verifyCompletedDialogueDirectSeedAudioLineForTiming(
            {
              mediaRoot:
                MEDIA_ROOT,

              episodeId:
                "EP02",

              sceneId:
                "SC01",

              shotId:
                "S02",

              dialogueLineId:
                "EP02_SC01_S02_L01",

              planKey:
                PLAN_KEY,
            },
            {
              resolveCompletionPath:
                createDialogueDirectSeedAudioCompletionPath,

              inspectLifecycle:
                vi.fn(
                  async () =>
                    lifecycle,
                ) as never,

              verifyLifecycle:
                verifyLifecycle as never,
            },
          ),
        ).rejects.toThrow(
          /requires durable v3 lifecycle evidence/i,
        );

        expect(
          verifyLifecycle,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects lifecycle evidence whose planKey differs from the requested canonical plan",
      async () => {
        const completed =
          createCompletedLifecycle();

        const lifecycle =
          Object.freeze({
            ...completed,

            submission:
              Object.freeze({
                ...completed.submission,

                planKey:
                  "b".repeat(
                    64,
                  ),
              }),
          });

        const verifyLifecycle =
          vi.fn();

        await expect(
          verifyCompletedDialogueDirectSeedAudioLineForTiming(
            {
              mediaRoot:
                MEDIA_ROOT,

              episodeId:
                "EP02",

              sceneId:
                "SC01",

              shotId:
                "S02",

              dialogueLineId:
                "EP02_SC01_S02_L01",

              planKey:
                PLAN_KEY,
            },
            {
              resolveCompletionPath:
                createDialogueDirectSeedAudioCompletionPath,

              inspectLifecycle:
                vi.fn(
                  async () =>
                    lifecycle,
                ) as never,

              verifyLifecycle:
                verifyLifecycle as never,
            },
          ),
        ).rejects.toThrow(
          /lifecycle planKey does not match/i,
        );

        expect(
          verifyLifecycle,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects reconciliation evidence that is not DURABLE_COMPLETION",
      async () => {
        const recovered =
          Object.freeze({
            ...createDurableVerification(),

            reconciliationMode:
              "RECOVERED_SUBMISSION" as const,
          });

        await expect(
          verifyCompletedDialogueDirectSeedAudioLineForTiming(
            {
              mediaRoot:
                MEDIA_ROOT,

              episodeId:
                "EP02",

              sceneId:
                "SC01",

              shotId:
                "S02",

              dialogueLineId:
                "EP02_SC01_S02_L01",

              planKey:
                PLAN_KEY,
            },
            {
              resolveCompletionPath:
                createDialogueDirectSeedAudioCompletionPath,

              inspectLifecycle:
                vi.fn(
                  async () =>
                    createCompletedLifecycle(),
                ) as never,

              verifyLifecycle:
                vi.fn(
                  async () =>
                    recovered,
                ) as never,
            },
          ),
        ).rejects.toThrow(
          /requires DURABLE_COMPLETION verification/i,
        );
      },
    );

    it(
      "rejects durable generation evidence whose planKey differs from the requested canonical plan",
      async () => {
        const verified =
          createDurableVerification();

        const mismatched =
          Object.freeze({
            ...verified,

            generationRecord:
              Object.freeze({
                ...verified
                  .generationRecord,

                plan:
                  Object.freeze({
                    ...verified
                      .generationRecord
                      .plan,

                    planKey:
                      "c".repeat(
                        64,
                      ),
                  }),
              }),
          });

        await expect(
          verifyCompletedDialogueDirectSeedAudioLineForTiming(
            {
              mediaRoot:
                MEDIA_ROOT,

              episodeId:
                "EP02",

              sceneId:
                "SC01",

              shotId:
                "S02",

              dialogueLineId:
                "EP02_SC01_S02_L01",

              planKey:
                PLAN_KEY,
            },
            {
              resolveCompletionPath:
                createDialogueDirectSeedAudioCompletionPath,

              inspectLifecycle:
                vi.fn(
                  async () =>
                    createCompletedLifecycle(),
                ) as never,

              verifyLifecycle:
                vi.fn(
                  async () =>
                    mismatched,
                ) as never,
            },
          ),
        ).rejects.toThrow(
          /generation evidence planKey does not match/i,
        );
      },
    );

    it(
      "rejects durable completion evidence unless exactly one audio output exists",
      async () => {
        const verified =
          createDurableVerification();

        const noOutputs =
          Object.freeze({
            ...verified,

            generationRecord:
              Object.freeze({
                ...verified
                  .generationRecord,

                outputs:
                  Object.freeze([]),
              }),
          });

        await expect(
          verifyCompletedDialogueDirectSeedAudioLineForTiming(
            {
              mediaRoot:
                MEDIA_ROOT,

              episodeId:
                "EP02",

              sceneId:
                "SC01",

              shotId:
                "S02",

              dialogueLineId:
                "EP02_SC01_S02_L01",

              planKey:
                PLAN_KEY,
            },
            {
              resolveCompletionPath:
                createDialogueDirectSeedAudioCompletionPath,

              inspectLifecycle:
                vi.fn(
                  async () =>
                    createCompletedLifecycle(),
                ) as never,

              verifyLifecycle:
                vi.fn(
                  async () =>
                    noOutputs,
                ) as never,
            },
          ),
        ).rejects.toThrow(
          /requires exactly one verified audio output/i,
        );
      },
    );
  },
);
