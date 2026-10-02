import {
  readFile,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

describe(
  "Busybookie dialogue reconciliation operator wiring",
  () => {
    it(
      "exposes dialogue reconciliation through the canonical npm script",
      async () => {
        const packageJsonPath =
          resolve(
            process.cwd(),
            "package.json",
          );

        const raw =
          await readFile(
            packageJsonPath,
            "utf8",
          );

        const packageJson:
          unknown =
            JSON.parse(
              raw,
            );

        expect(
          packageJson,
        ).toMatchObject({
          scripts: {
            "dialogue:reconcile":
              "tsx scripts/dialogue-reconcile.ts",
          },
        });
      },
    );

    it(
      "uses a thin recovery-only script wrapper around runDialogueReconcileCli",
      async () => {
        const scriptPath =
          resolve(
            process.cwd(),
            "scripts",
            "dialogue-reconcile.ts",
          );

        const source =
          await readFile(
            scriptPath,
            "utf8",
          );

        expect(
          source,
        ).toContain(
          "runDialogueReconcileCli",
        );

        expect(
          source,
        ).toContain(
          "Dialogue reconciliation failed:",
        );

        expect(
          source,
        ).toContain(
          "process.exitCode = 1",
        );

        expect(
          source,
        ).not.toContain(
          "RUNWAYML_API_SECRET",
        );

        expect(
          source,
        ).not.toContain(
          "createRunwayClient",
        );

        expect(
          source,
        ).not.toContain(
          "textToSpeech",
        );

        expect(
          source,
        ).not.toContain(
          "confirm-paid-generation",
        );
      },
    );
  },
);
