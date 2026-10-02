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
  "Busybookie dialogue generation operator wiring",
  () => {
    it(
      "exposes dialogue generation through the canonical npm script",
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
            "dialogue:generate":
              "tsx scripts/dialogue-generate.ts",
          },
        });
      },
    );

    it(
      "uses a thin script wrapper around runDialogueGenerationCli",
      async () => {
        const scriptPath =
          resolve(
            process.cwd(),
            "scripts",
            "dialogue-generate.ts",
          );

        const source =
          await readFile(
            scriptPath,
            "utf8",
          );

        expect(
          source,
        ).toContain(
          "runDialogueGenerationCli",
        );

        expect(
          source,
        ).toContain(
          "Dialogue generation failed:",
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
      },
    );
  },
);
