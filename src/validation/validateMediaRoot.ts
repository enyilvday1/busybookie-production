import { randomUUID } from "node:crypto";
import {
  constants,
} from "node:fs";
import {
  access,
  mkdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  isAbsolute,
  parse,
  resolve,
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

export function resolveAndValidateMediaRootPath(
  env: Environment,
  rules: ProductionRules,
): string {
  const configuredMediaRoot =
    env.BUSYBOOKIE_MEDIA_ROOT.trim();

  if (!isAbsolute(configuredMediaRoot)) {
    throw new Error(
      "BUSYBOOKIE_MEDIA_ROOT must be an absolute path.",
    );
  }

  const mediaRoot = resolve(
    configuredMediaRoot,
  );

  const mediaRootDrive =
    parse(mediaRoot).root;

  const repositoryDrive =
    parse(process.cwd()).root;

  if (
    rules.storage.requireExternalMediaRoot &&
    mediaRootDrive.toLowerCase() ===
      repositoryDrive.toLowerCase()
  ) {
    throw new Error(
      `Media root must be on an external/non-system drive. ` +
      `Repository drive: ${repositoryDrive}; ` +
      `media drive: ${mediaRootDrive}`,
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
