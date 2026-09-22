import {
  resolve,
} from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  Environment,
} from "../src/schemas/environment.schema.js";

import {
  REQUIRED_MEDIA_DIRECTORIES,
  resolveAndValidateMediaRootPath,
} from "../src/validation/validateMediaRoot.js";

import {
  loadProductionRules,
} from "../src/validation/loadProductionRules.js";

describe("Busybookie Media Root", () => {
  it("defines the required media directories", () => {
    expect(
      REQUIRED_MEDIA_DIRECTORIES,
    ).toEqual([
      "episodes",
      "references",
      "generated-images",
      "generated-video",
      "voices",
      "sfx",
      "ambience",
      "music",
      "davinci",
      "cache",
      "proxies",
      "exports",
    ]);
  });

  it("rejects a relative media-root path", async () => {
    const rules =
      await loadProductionRules();

    const env: Environment = {
      BUSYBOOKIE_MEDIA_ROOT:
        "relative/media",
    };

    expect(() =>
      resolveAndValidateMediaRootPath(
        env,
        rules,
      ),
    ).toThrow(
      /must be an absolute path/,
    );
  });

  it("rejects the repository system drive when external storage is required", async () => {
    const rules =
      await loadProductionRules();

    const env: Environment = {
      BUSYBOOKIE_MEDIA_ROOT:
        resolve(
          process.cwd(),
          "media",
        ),
    };

    expect(() =>
      resolveAndValidateMediaRootPath(
        env,
        rules,
      ),
    ).toThrow(
      /external\/non-system drive/,
    );
  });
});
