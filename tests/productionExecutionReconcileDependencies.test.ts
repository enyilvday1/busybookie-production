import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createProductionExecutionReconcileDependencies,
  type ProductionExecutionReconcileCompositionDependencies,
} from "../src/execution/createProductionExecutionReconcileDependencies.js";

describe(
  "Busybookie production execution reconciliation dependencies",
  () => {
    it(
      "composes the exact reconciliation capabilities without invoking them",
      () => {
        const makeMock =
          <
            K extends
              keyof ProductionExecutionReconcileCompositionDependencies,
          >(
            key:
              K,
          ) =>
            vi.fn(
              () => {
                throw new Error(
                  `${String(
                    key,
                  )} must not run during reconciliation dependency composition.`,
                );
              },
            ) as unknown as
              ProductionExecutionReconcileCompositionDependencies[K];

        const compositionDependencies = {
          loadEnvironment:
            makeMock(
              "loadEnvironment",
            ),

          loadProductionRules:
            makeMock(
              "loadProductionRules",
            ),

          resolveMediaRoot:
            makeMock(
              "resolveMediaRoot",
            ),

          inspectLifecycle:
            makeMock(
              "inspectLifecycle",
            ),

          reconcileLifecycle:
            makeMock(
              "reconcileLifecycle",
            ),

          loadRunwayPolicy:
            makeMock(
              "loadRunwayPolicy",
            ),

          createRunwayTaskLookupClient:
            makeMock(
              "createRunwayTaskLookupClient",
            ),

          resumeRunwayTask:
            makeMock(
              "resumeRunwayTask",
            ),

          loadVeoPolicy:
            makeMock(
              "loadVeoPolicy",
            ),

          createVeoOperationLookupClient:
            makeMock(
              "createVeoOperationLookupClient",
            ),

          createVeoFileDownloadClient:
            makeMock(
              "createVeoFileDownloadClient",
            ),

          resumeVeoOperation:
            makeMock(
              "resumeVeoOperation",
            ),

          recoverVeoOutput:
            makeMock(
              "recoverVeoOutput",
            ),
        } satisfies
          ProductionExecutionReconcileCompositionDependencies;

        const result =
          createProductionExecutionReconcileDependencies(
            compositionDependencies,
          );

        expect(
          Object.keys(
            result,
          ),
        ).toEqual([
          "loadEnvironment",
          "loadProductionRules",
          "resolveMediaRoot",
          "inspectLifecycle",
          "reconcileLifecycle",
          "loadRunwayPolicy",
          "createRunwayTaskLookupClient",
          "resumeRunwayTask",
          "loadVeoPolicy",
          "createVeoOperationLookupClient",
          "createVeoFileDownloadClient",
          "resumeVeoOperation",
          "recoverVeoOutput",
        ]);

        for (
          const key
          of Object.keys(
            compositionDependencies,
          ) as Array<
            keyof ProductionExecutionReconcileCompositionDependencies
          >
        ) {
          expect(
            result[key],
          ).toBe(
            compositionDependencies[
              key
            ],
          );

          expect(
            compositionDependencies[
              key
            ],
          ).not.toHaveBeenCalled();
        }

        expect(
          "createExecutionReservation" in
            result,
        ).toBe(
          false,
        );

        expect(
          "createExecutionSubmission" in
            result,
        ).toBe(
          false,
        );

        expect(
          "executeVeoGeneration" in
            result,
        ).toBe(
          false,
        );

        expect(
          "executeRunwayGen45" in
            result,
        ).toBe(
          false,
        );
      },
    );
  },
);
