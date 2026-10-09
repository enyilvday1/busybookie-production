import {
  mkdtemp,
  rm,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  expect,
  it,
  vi,
} from "vitest";

const fixture = vi.hoisted(
  () => ({
    mediaRoot: ""
  })
);

vi.mock(
  "../src/validation/loadEnvironment.js",
  () => ({
    loadEnvironment: () => ({
      BUSYBOOKIE_MEDIA_ROOT: fixture.mediaRoot
    }),
  })
);

vi.mock(
  "../src/validation/validateMediaRoot.js",
  () => ({
    validateMediaRoot: async () => fixture.mediaRoot,
  })
);

vi.mock(
  "../src/execution/createProductionSingleShotExecutionDependencies.js",
  {
    spy: true
  }
);

vi.mock(
  "../src/execution/executeSingleShot.js",
  {
    spy: true
  }
);

import {
  createProductionSingleShotExecutionDependencies,
} from "../src/execution/createProductionSingleShotExecutionDependencies.js";

import {
  executeSingleShot,
} from "../src/execution/executeSingleShot.js";

import {
  runSingleShotExecutionCli,
} from "../src/execution/cli/runSingleShotExecutionCli.js";

it(
  "the default production runner calls the real composition and secured executor without an injected CLI dependency object",
  async () => {
    fixture.mediaRoot = await mkdtemp(
      join(
        tmpdir(),
        "busybookie-cli-default-wiring-"
      )
    );

    try {
      // No confirmation: the real executor must stop before registry access,
      // provider preparation or any durable lifecycle writes.
      await expect(
        runSingleShotExecutionCli([
          "--episode",
          "EP90",
          "--shot",
          "S01",
          "--image",
          "references/source.png",
        ])
      ).rejects.toThrow(
        /Paid-generation confirmation/
      );

      expect(
        createProductionSingleShotExecutionDependencies
      ).toHaveBeenCalledExactlyOnceWith({});

      const composed = vi.mocked(
        createProductionSingleShotExecutionDependencies
      ).mock.results[0]!.value;

      expect(
        executeSingleShot
      ).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          shotId: "S01",
          mediaRoot: fixture.mediaRoot,
          sourceImagePath: "references/source.png",
          confirmPaidGeneration: false,
        }),
        composed
      );
    } finally {
      await rm(
        fixture.mediaRoot,
        {
          recursive: true,
          force: true
        }
      );
    }
  }
);
