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
  type MediaRootPathValidationDependencies,
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

    const platform =
      process.platform;

    const repositoryRoot =
      process.cwd();

    const mediaRoot =
      resolve(
        repositoryRoot,
        "media",
      );

    const env: Environment = {
      BUSYBOOKIE_MEDIA_ROOT:
        mediaRoot,
    };

    const dependencies:
      MediaRootPathValidationDependencies = {
      platform,
      cwd: () =>
        repositoryRoot,
      statDevice: () =>
        64769,
    };

    expect(() =>
      resolveAndValidateMediaRootPath(
        env,
        rules,
        dependencies,
      ),
    ).toThrow(
      /external\/non-system drive/,
    );
  });
  it("accepts a separate POSIX filesystem device when external storage is required", async () => {
    const rules =
      await loadProductionRules();

    const env: Environment = {
      BUSYBOOKIE_MEDIA_ROOT:
        "/srv/busybookie-media/data",
    };

    const dependencies:
      MediaRootPathValidationDependencies = {
      platform: "linux",
      cwd: () =>
        "/opt/busybookie/releases/current",
      statDevice: path =>
        path.startsWith("/srv/")
          ? 2048
          : 64769,
    };

    expect(
      resolveAndValidateMediaRootPath(
        env,
        rules,
        dependencies,
      ),
    ).toBe(
      "/srv/busybookie-media/data",
    );
  });

  it("rejects the same POSIX filesystem device when external storage is required", async () => {
    const rules =
      await loadProductionRules();

    const env: Environment = {
      BUSYBOOKIE_MEDIA_ROOT:
        "/srv/busybookie-media/data",
    };

    const dependencies:
      MediaRootPathValidationDependencies = {
      platform: "linux",
      cwd: () =>
        "/opt/busybookie/releases/current",
      statDevice: () =>
        64769,
    };

    expect(() =>
      resolveAndValidateMediaRootPath(
        env,
        rules,
        dependencies,
      ),
    ).toThrow(
      /external\/non-system drive/,
    );
  });

  it("fails closed when POSIX filesystem identity cannot be verified", async () => {
    const rules =
      await loadProductionRules();

    const env: Environment = {
      BUSYBOOKIE_MEDIA_ROOT:
        "/srv/busybookie-media/data",
    };

    const dependencies:
      MediaRootPathValidationDependencies = {
      platform: "linux",
      cwd: () =>
        "/opt/busybookie/releases/current",
      statDevice: () => {
        throw new Error(
          "synthetic stat failure",
        );
      },
    };

    expect(() =>
      resolveAndValidateMediaRootPath(
        env,
        rules,
        dependencies,
      ),
    ).toThrow(
      /filesystem identity could not be verified/,
    );
  });

  it("preserves Windows drive-letter separation without consulting filesystem devices", async () => {
    const rules =
      await loadProductionRules();

    const env: Environment = {
      BUSYBOOKIE_MEDIA_ROOT:
        "D:\\Busybookie\\Production",
    };

    const dependencies:
      MediaRootPathValidationDependencies = {
      platform: "win32",
      cwd: () =>
        "C:\\Projects\\busybookie-production",
      statDevice: () => {
        throw new Error(
          "Windows drive validation must not inspect filesystem devices.",
        );
      },
    };

    expect(
      resolveAndValidateMediaRootPath(
        env,
        rules,
        dependencies,
      ),
    ).toBe(
      "D:\\Busybookie\\Production",
    );
  });

});
