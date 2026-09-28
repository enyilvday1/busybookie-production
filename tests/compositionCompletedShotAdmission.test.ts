import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  ExecutionLifecycleClassification,
} from "../src/execution/classifyExecutionLifecycle.js";

import {
  type ExecutionLifecycleReconciliationDependencies,
  type ExecutionLifecycleReconciliationResult,
} from "../src/execution/reconcileExecutionLifecycle.js";

import {
  verifyCompletedShotForComposition,
  type VerifyCompletedShotForCompositionDependencies,
} from "../src/composition/verifyCompletedShotForComposition.js";

describe(
  "Busybookie composition completed-shot admission",
  () => {
    it(
      "admits only an already-COMPLETED shot and verifies it with the cached lifecycle only",
      async () => {
        const lifecycle =
          Object.freeze({
            state:
              "COMPLETED",
          }) as unknown as
            ExecutionLifecycleClassification;

        const verified =
          Object.freeze({
            lifecycleState:
              "COMPLETED",

            reconciliationMode:
              "DURABLE_COMPLETION",
          }) as unknown as
            ExecutionLifecycleReconciliationResult;

        const inspectLifecycle =
          vi.fn(
            async () =>
              lifecycle,
          );

        const verifyLifecycle =
          vi.fn(
            async (
              input,
              dependencies:
                ExecutionLifecycleReconciliationDependencies,
            ) => {
              expect(
                input,
              ).toEqual({
                mediaRoot:
                  "D:/Busybookie/Production",

                episodeId:
                  "EP91",

                shotId:
                  "S01",
              });

              expect(
                Object.keys(
                  dependencies,
                ),
              ).toEqual([
                "inspectLifecycle",
              ]);

              const cached =
                await dependencies
                  .inspectLifecycle(
                    "ignored-root",
                    "EP999",
                    "S999",
                  );

              expect(
                cached,
              ).toBe(
                lifecycle,
              );

              return verified;
            },
          );

        const dependencies:
          VerifyCompletedShotForCompositionDependencies =
          {
            inspectLifecycle,

            verifyLifecycle:
              verifyLifecycle as unknown as
                VerifyCompletedShotForCompositionDependencies[
                  "verifyLifecycle"
                ],
          };

        const result =
          await verifyCompletedShotForComposition(
            {
              mediaRoot:
                "D:/Busybookie/Production",

              episodeId:
                "EP91",

              shotId:
                "S01",
            },
            dependencies,
          );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledWith(
          "D:/Busybookie/Production",
          "EP91",
          "S01",
        );

        expect(
          verifyLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result,
        ).toBe(
          verified,
        );
      },
    );

    it(
      "fails closed before verification when the shot is not COMPLETED",
      async () => {
        const lifecycle =
          Object.freeze({
            state:
              "SUBMITTED",
          }) as unknown as
            ExecutionLifecycleClassification;

        const inspectLifecycle =
          vi.fn(
            async () =>
              lifecycle,
          );

        const verifyLifecycle =
          vi.fn(
            async () => {
              throw new Error(
                "Non-completed composition admission must never reach verification.",
              );
            },
          );

        const dependencies:
          VerifyCompletedShotForCompositionDependencies =
          {
            inspectLifecycle,

            verifyLifecycle:
              verifyLifecycle as unknown as
                VerifyCompletedShotForCompositionDependencies[
                  "verifyLifecycle"
                ],
          };

        await expect(
          verifyCompletedShotForComposition(
            {
              mediaRoot:
                "D:/Busybookie/Production",

              episodeId:
                "EP91",

              shotId:
                "S02",
            },
            dependencies,
          ),
        ).rejects.toThrow(
          /requires COMPLETED lifecycle.*SUBMITTED/i,
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          verifyLifecycle,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
