import {
  readFile,
} from "node:fs/promises";

import {
  describe,
  expect,
  it,
} from "vitest";

const read =
  async (
    path: string,
  ): Promise<string> =>
    (
      await readFile(
        new URL(
          `../${path}`,
          import.meta.url,
        ),
        "utf8",
      )
    ).replace(
      /\r\n/g,
      "\n",
    );

const CONTRACTS =
  [
    {
      productionName:
        "production:execution:reconcile",

      productionCommand:
        "node dist/execution/executionReconcileProcess.js",

      developmentName:
        "execution:reconcile",

      developmentCommand:
        "tsx scripts/execution-reconcile.ts",

      script:
        "scripts/execution-reconcile.ts",

      process:
        "src/execution/executionReconcileProcess.ts",

      oldImport:
        "../src/execution/cli/runProductionExecutionReconcileCli.js",

      newImport:
        "./cli/runProductionExecutionReconcileCli.js",
    },

    {
      productionName:
        "production:execution:status",

      productionCommand:
        "node dist/execution/executionStatusProcess.js",

      developmentName:
        "execution:status",

      developmentCommand:
        "tsx scripts/execution-status.ts",

      script:
        "scripts/execution-status.ts",

      process:
        "src/execution/executionStatusProcess.ts",

      oldImport:
        "../src/execution/cli/runExecutionStatusCli.js",

      newImport:
        "./cli/runExecutionStatusCli.js",
    },

    {
      productionName:
        "production:episode:automate",

      productionCommand:
        "node dist/execution/episodeAutomationProcess.js",

      developmentName:
        "episode:automate",

      developmentCommand:
        "tsx scripts/episode-automation.ts",

      script:
        "scripts/episode-automation.ts",

      process:
        "src/execution/episodeAutomationProcess.ts",

      oldImport:
        "../src/execution/cli/runEpisodeAutomationCli.js",

      newImport:
        "./cli/runEpisodeAutomationCli.js",
    },

    {
      productionName:
        "production:episode:rough-cut",

      productionCommand:
        "node dist/composition/episodeRoughCutProcess.js",

      developmentName:
        "episode:rough-cut",

      developmentCommand:
        "tsx scripts/episode-rough-cut.ts",

      script:
        "scripts/episode-rough-cut.ts",

      process:
        "src/composition/episodeRoughCutProcess.ts",

      oldImport:
        "../src/composition/cli/runEpisodeRoughCutCli.js",

      newImport:
        "./cli/runEpisodeRoughCutCli.js",
    },

    {
      productionName:
        "production:dialogue:authorize-visual",

      productionCommand:
        "node dist/dialogue/dialogueVisualAuthorizationProcess.js",

      developmentName:
        "dialogue:authorize-visual",

      developmentCommand:
        "tsx scripts/dialogue-authorize-visual.ts",

      script:
        "scripts/dialogue-authorize-visual.ts",

      process:
        "src/dialogue/dialogueVisualAuthorizationProcess.ts",

      oldImport:
        "../src/dialogue/cli/runDialogueVisualAuthorizationCli.js",

      newImport:
        "./cli/runDialogueVisualAuthorizationCli.js",
    },

    {
      productionName:
        "production:dialogue:place",

      productionCommand:
        "node dist/dialogue/dialoguePlacementProcess.js",

      developmentName:
        "dialogue:place",

      developmentCommand:
        "tsx scripts/dialogue-place.ts",

      script:
        "scripts/dialogue-place.ts",

      process:
        "src/dialogue/dialoguePlacementProcess.ts",

      oldImport:
        "../src/dialogue/cli/runDialoguePlacementCli.js",

      newImport:
        "./cli/runDialoguePlacementCli.js",
    },
  ] as const;

describe(
  "R42S compiled canonical production commands",
  () => {
    for (
      const contract of
      CONTRACTS
    ) {
      it(
        `${contract.productionName} is the exact compiled relocation of its source wrapper`,
        async () => {
          const script =
            await read(
              contract.script,
            );

          expect(
            script.split(
              contract.oldImport,
            ).length - 1,
          ).toBe(
            1,
          );

          const expected =
            script.replace(
              contract.oldImport,
              contract.newImport,
            );

          expect(
            await read(
              contract.process,
            ),
          ).toBe(
            expected,
          );
        },
      );
    }

    it(
      "exposes exactly the locked compiled production command surface while preserving source development commands",
      async () => {
        const pkg =
          JSON.parse(
            await read(
              "package.json",
            ),
          ) as {
            scripts:
              Record<
                string,
                string
              >;

            dependencies:
              Record<
                string,
                string
              >;

            devDependencies:
              Record<
                string,
                string
              >;
          };

        expect(
          Object.entries(
            pkg.scripts,
          ).filter(
            ([name]) =>
              name.startsWith(
                "production:",
              ),
          ),
        ).toEqual(
          CONTRACTS.map(
            (contract) => [
              contract.productionName,
              contract.productionCommand,
            ],
          ),
        );

        for (
          const contract of
          CONTRACTS
        ) {
          expect(
            pkg.scripts[
              contract.developmentName
            ],
          ).toBe(
            contract.developmentCommand,
          );
        }

        expect(
          pkg.scripts.start,
        ).toBe(
          "node dist/operatorServer/operatorServerProcess.js",
        );

        expect(
          pkg.scripts[
            "operator:serve"
          ],
        ).toBe(
          "tsx scripts/operator-server.ts",
        );

        expect(
          pkg.dependencies.tsx,
        ).toBeUndefined();

        expect(
          pkg.devDependencies.tsx,
        ).toBe(
          "^4.23.15",
        );
      },
    );

    it(
      "does not create compiled production aliases for lower-level or diagnostic command surfaces",
      async () => {
        const pkg =
          JSON.parse(
            await read(
              "package.json",
            ),
          ) as {
            scripts:
              Record<
                string,
                string
              >;
          };

        for (
          const name of
          [
            "production:execution:generate",
            "production:execution:plan",
            "production:routing:report",
            "production:runway:gen45",
            "production:veo:generate",
            "production:dialogue:generate",
            "production:dialogue:reconcile",
            "production:operator:serve",
          ]
        ) {
          expect(
            pkg.scripts[name],
          ).toBeUndefined();
        }
      },
    );
  },
);
