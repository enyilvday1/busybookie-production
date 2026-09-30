import {
  randomUUID,
} from "node:crypto";

import {
  constants,
} from "node:fs";

import {
  copyFile,
  mkdir,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
} from "node:path";

import {
  CompositionShotNormalizationCacheRecordSchema,
  type CompositionShotNormalizationCacheRecord,
} from "./compositionShotNormalizationCacheRecord.schema.js";

import {
  createCompositionShotNormalizationCacheRecordPath,
} from "./compositionShotNormalizationCacheRecordPath.js";

export async function writeCompositionShotNormalizationCacheRecord(
  record:
    CompositionShotNormalizationCacheRecord,
): Promise<string> {
  const validated =
    CompositionShotNormalizationCacheRecordSchema.parse(
      record,
    );

  const destinationPath =
    createCompositionShotNormalizationCacheRecordPath(
      validated.plan.outputPath,
    );

  await mkdir(
    dirname(
      destinationPath,
    ),
    {
      recursive:
        true,
    },
  );

  const temporaryPath =
    `${destinationPath}.part-${process.pid}-${randomUUID()}`;

  let temporaryCreated =
    false;

  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(
        validated,
        null,
        2,
      )}\n`,
      {
        encoding:
          "utf8",

        flag:
          "wx",
      },
    );

    temporaryCreated =
      true;

    try {
      await copyFile(
        temporaryPath,
        destinationPath,
        constants.COPYFILE_EXCL,
      );
    } catch (
      error
    ) {
      const code =
        (
          error as
            NodeJS.ErrnoException
        ).code;

      if (
        code ===
        "EEXIST"
      ) {
        throw new Error(
          `Composition normalization cache record already exists: ${destinationPath}`,
        );
      }

      throw error;
    }

    return destinationPath;
  } finally {
    if (
      temporaryCreated
    ) {
      try {
        await unlink(
          temporaryPath,
        );
      } catch {
        /*
         * Preserve the primary persistence result or
         * failure, matching existing durable-record
         * persistence semantics.
         */
      }
    }
  }
}
