import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  RunExecutionReconcileCliDependencies,
} from "../src/execution/cli/runExecutionReconcileCli.js";

import {
  runProductionExecutionReconcileCli,
  type RunProductionExecutionReconcileCliDependencies,
} from "../src/execution/cli/runProductionExecutionReconcileCli.js";

describe(
  "Busybookie production execution reconciliation CLI",
  () => {
    it(
      "composes production dependencies and forwards the exact CLI arguments",
      async () => {
        const args = [
          "--episode",
          "EP91",
          "--shot",
          "S04",
        ] as const;

        const reconcileDependencies =
          Object.freeze({
            marker:
              "production-reconcile-dependencies",
          }) as unknown as
            RunExecutionReconcileCliDependencies;

        const createDependencies =
          vi.fn<
            RunProductionExecutionReconcileCliDependencies[
              "createDependencies"
            ]
          >(
            () =>
              reconcileDependencies,
          );

        const runCli =
          vi.fn<
            RunProductionExecutionReconcileCliDependencies[
              "runCli"
            ]
          >(
            async (
              receivedArgs,
              receivedDependencies,
            ) => {
              expect(
                receivedArgs,
              ).toBe(
                args,
              );

              expect(
                receivedDependencies,
              ).toBe(
                reconcileDependencies,
              );
            },
          );

        await runProductionExecutionReconcileCli(
          args,
          {
            createDependencies,
            runCli,
          },
        );

        expect(
          createDependencies,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          runCli,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createDependencies
            .mock
            .invocationCallOrder[0],
        ).toBeLessThan(
          runCli
            .mock
            .invocationCallOrder[0]!,
        );
      },
    );
  },
);
