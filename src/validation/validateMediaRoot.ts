import { randomUUID } from "node:crypto";
import {
  constants,
  statSync,
} from "node:fs";
import {
  access,
  mkdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  platform as operatingSystemPlatform,
} from "node:os";

import {
  posix,
  resolve,
  win32,
} from "node:path";

import type {
  Environment,
} from "../schemas/environment.schema.js";

import type {
  ProductionRules,
} from "../schemas/productionRules.schema.js";

export const REQUIRED_MEDIA_DIRECTORIES = [
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
] as const;

export type MediaRootPathValidationDependencies = Readonly<{
  platform: NodeJS.Platform;
  cwd: () => string;
  statDevice: (path: string) => number;
}>;

const defaultPathValidationDependencies:
  MediaRootPathValidationDependencies =
  Object.freeze({
    platform: operatingSystemPlatform(),
    cwd: () => process.cwd(),
    statDevice: (path: string) =>
      statSync(path).dev,
  });

function pathFlavor(
  platform: NodeJS.Platform,
) {
  return platform === "win32"
    ? win32
    : posix;
}

function assertExternalMediaRoot(
  mediaRoot: string,
  repositoryRoot: string,
  dependencies:
    MediaRootPathValidationDependencies,
): void {
  const flavor =
    pathFlavor(
      dependencies.platform,
    );

  if (
    dependencies.platform === "win32"
  ) {
    const mediaRootDrive =
      flavor.parse(
        mediaRoot,
      ).root;

    const repositoryDrive =
      flavor.parse(
        repositoryRoot,
      ).root;

    if (
      mediaRootDrive.toLowerCase() ===
      repositoryDrive.toLowerCase()
    ) {
      throw new Error(
        `Media root must be on an external/non-system drive. ` +
        `Repository drive: ${repositoryDrive}; ` +
        `media drive: ${mediaRootDrive}`,
      );
    }

    return;
  }

  let repositoryDevice: number;
  let mediaDevice: number;

  try {
    repositoryDevice =
      dependencies.statDevice(
        repositoryRoot,
      );

    mediaDevice =
      dependencies.statDevice(
        mediaRoot,
      );
  } catch (error) {
    throw new Error(
      "Media root filesystem identity could not be verified for external-storage enforcement.",
      {
        cause: error,
      },
    );
  }

  if (
    repositoryDevice ===
    mediaDevice
  ) {
    throw new Error(
      `Media root must be on an external/non-system drive. ` +
      `Repository device: ${repositoryDevice}; ` +
      `media device: ${mediaDevice}`,
    );
  }
}

export function resolveAndValidateMediaRootPath(
  env: Environment,
  rules: ProductionRules,
  dependencies:
    MediaRootPathValidationDependencies =
      defaultPathValidationDependencies,
): string {
  const flavor =
    pathFlavor(
      dependencies.platform,
    );

  const configuredMediaRoot =
    env.BUSYBOOKIE_MEDIA_ROOT.trim();

  if (
    !flavor.isAbsolute(
      configuredMediaRoot,
    )
  ) {
    throw new Error(
      "BUSYBOOKIE_MEDIA_ROOT must be an absolute path.",
    );
  }

  const mediaRoot =
    flavor.resolve(
      configuredMediaRoot,
    );

  if (
    rules.storage.requireExternalMediaRoot
  ) {
    const repositoryRoot =
      flavor.resolve(
        dependencies.cwd(),
      );

    assertExternalMediaRoot(
      mediaRoot,
      repositoryRoot,
      dependencies,
    );
  }

  return mediaRoot;
}

export async function validateMediaRoot(
  env: Environment,
  rules: ProductionRules,
): Promise<string> {
  const mediaRoot =
    resolveAndValidateMediaRootPath(
      env,
      rules,
    );

  try {
    await access(
      mediaRoot,
      constants.R_OK | constants.W_OK,
    );
  } catch (error) {
    throw new Error(
      `Busybookie media root is not readable and writable: ${mediaRoot}`,
      {
        cause: error,
      },
    );
  }

  for (
    const directory
    of REQUIRED_MEDIA_DIRECTORIES
  ) {
    await mkdir(
      resolve(
        mediaRoot,
        directory,
      ),
      {
        recursive: true,
      },
    );
  }

  const probePath = resolve(
    mediaRoot,
    `.busybookie-write-test-${process.pid}-${randomUUID()}`,
  );

  let probeCreated = false;

  try {
    await writeFile(
      probePath,
      "Busybookie media-root write test.\n",
      {
        encoding: "utf8",
        flag: "wx",
      },
    );

    probeCreated = true;
  } catch (error) {
    throw new Error(
      `Busybookie could not create a write-test file in media root: ${mediaRoot}`,
      {
        cause: error,
      },
    );
  } finally {
    if (probeCreated) {
      try {
        await unlink(
          probePath,
        );
      } catch (error) {
        throw new Error(
          `Busybookie created a media-root write-test file but could not remove it: ${probePath}`,
          {
            cause: error,
          },
        );
      }
    }
  }

  return mediaRoot;
}
