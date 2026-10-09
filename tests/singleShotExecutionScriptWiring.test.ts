import {
  readFile,
} from "node:fs/promises";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock(
  "../src/execution/cli/runSingleShotExecutionCli.js",
  () => ({
    runSingleShotExecutionCli: vi.fn(
      async () => undefined
    ),
  })
);
import {
  runSingleShotExecutionCli,
} from "../src/execution/cli/runSingleShotExecutionCli.js";

afterEach(
  () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.resetModules();
  }
);

describe(
  "secured single-shot operator wiring",
  () => {
    it(
      "exposes a separate command and preserves legacy provider commands",
      async () => {
        const pkg = JSON.parse(
          await readFile(
            "package.json",
            "utf8"
          )
        );

        expect(
          pkg.scripts
        ).toMatchObject({
          "execution:generate": "tsx scripts/execution-generate.ts",
          "runway:gen45": "tsx scripts/runway-gen45.ts",
          "veo:generate": "tsx scripts/veo.ts",
        });

        await import(
          "../scripts/execution-generate.js"
        );

        expect(
          runSingleShotExecutionCli
        ).toHaveBeenCalledExactlyOnceWith();
      }
    );

    it(
      "reports errors and a nonzero exit status from the thin wrapper",
      async () => {
        const previous = process.exitCode;

        const log = vi.spyOn(
          console,
          "error"
        ).mockImplementation(
          () => undefined
        );
        vi.mocked(
          runSingleShotExecutionCli
        ).mockRejectedValueOnce(
          new Error(
            "Admission blocked"
          )
        );

        try {
          await import(
            "../scripts/execution-generate.js"
          );

          expect(
            process.exitCode
          ).toBe(
            1
          );

          expect(
            log
          ).toHaveBeenCalledWith(
            "Single-shot execution failed: Admission blocked"
          );
        } finally {
          process.exitCode = previous;
        }
      }
    );

    it(
      "defaults to production composition and secured execution without raw provider dispatch",
      async () => {
        const runner = await readFile(
          "src/execution/cli/runSingleShotExecutionCli.ts",
          "utf8"
        );

        const wrapper = await readFile(
          "scripts/execution-generate.ts",
          "utf8"
        );

        expect(
          runner
        ).toContain(
          "createDependencies: createProductionSingleShotExecutionDependencies"
        );

        expect(
          runner
        ).toContain(
          "dependencies.executeSingleShot("
        );
        for (
          const forbidden of [
            "createExecutionReservation",
            "runRunwayGen45Transaction",
            "runVeoImageToVideoTransaction",
            "createRunwayClient",
            "createVeoClient",
            "executeRunway",
            "executeVeo",
            "createDialogueVisualAuthorization"
          ]
        ) {
          expect(
            runner + wrapper
          ).not.toContain(
            forbidden
          );
        }
      }
    );
  }
);
