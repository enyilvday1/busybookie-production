import {
  readFile,
} from "node:fs/promises";

import {
  describe,
  expect,
  it,
} from "vitest";

describe(
  "Busybookie execution reconciliation command",
  () => {
    it(
      "exposes the production reconciliation CLI through npm",
      async () => {
        const packageJson =
          JSON.parse(
            await readFile(
              new URL(
                "../package.json",
                import.meta.url,
              ),
              "utf8",
            ),
          ) as {
            scripts?: Record<
              string,
              string
            >;
          };

        expect(
          packageJson
            .scripts
            ?.["execution:reconcile"],
        ).toBe(
          "tsx scripts/execution-reconcile.ts",
        );

        const wrapperSource =
          await readFile(
            new URL(
              "../scripts/execution-reconcile.ts",
              import.meta.url,
            ),
            "utf8",
          );

        expect(
          wrapperSource,
        ).toContain(
          "runProductionExecutionReconcileCli",
        );

        expect(
          wrapperSource,
        ).toContain(
          "Execution reconciliation failed:",
        );

        expect(
          wrapperSource,
        ).not.toMatch(
          /models\.generateVideos|imageToVideo\.create|executeVeoGeneration|executeRunwayGen45/,
        );
      },
    );
  },
);
