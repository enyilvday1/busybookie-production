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
  resolve,
} from "node:path";

import {
  sanitizeVeoOperationId,
} from "../output/veoOutputPath.js";

import {
  VeoGenerationRecordSchema,
  type VeoGenerationRecord,
} from "./veoGenerationRecord.schema.js";

export function createVeoGenerationRecordPath(
  mediaRoot:
    string,

  record:
    VeoGenerationRecord,
): string {
  const operationId =
    sanitizeVeoOperationId(
      record.operationName,
    );

  return resolve(
    mediaRoot,
    "generated-video",
    record.episodeId,
    record.shotId,
    `${record.episodeId}_${record.shotId}_${operationId}.veo-generation.json`,
  );
}

export async function writeVeoGenerationRecord(
  mediaRoot:
    string,

  record:
    VeoGenerationRecord,
): Promise<string> {
  const validated =
    VeoGenerationRecordSchema
      .parse(
        record,
      );

  const destinationPath =
    createVeoGenerationRecordPath(
      mediaRoot,
      validated,
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
    } catch (error) {
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
          `Veo generation record already exists: ${destinationPath}`,
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
        // Preserve the original failure.
      }
    }
  }
}
