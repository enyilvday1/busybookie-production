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
  RunwayGenerationRecordSchema,
  type RunwayGenerationRecord,
} from "./runwayGenerationRecord.schema.js";

function sanitizeTaskId(
  taskId: string,
): string {
  const result =
    taskId
      .trim()
      .replace(
        /[^A-Za-z0-9_-]+/g,
        "_",
      )
      .slice(
        0,
        80,
      );

  if (!result) {
    throw new Error(
      "Runway task id cannot produce an empty audit filename.",
    );
  }

  return result;
}

export function createRunwayGenerationRecordPath(
  mediaRoot: string,
  record: RunwayGenerationRecord,
): string {
  const safeTaskId =
    sanitizeTaskId(
      record.taskId,
    );

  return resolve(
    mediaRoot,
    "generated-video",
    record.episodeId,
    record.shotId,
    `${record.episodeId}_${record.shotId}_${safeTaskId}.runway-generation.json`,
  );
}

export async function writeRunwayGenerationRecord(
  mediaRoot: string,
  record: RunwayGenerationRecord,
): Promise<string> {
  const validated =
    RunwayGenerationRecordSchema.parse(
      record,
    );

  const destinationPath =
    createRunwayGenerationRecordPath(
      mediaRoot,
      validated,
    );

  await mkdir(
    dirname(
      destinationPath,
    ),
    {
      recursive: true,
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
        encoding: "utf8",
        flag: "wx",
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
          `Runway generation record already exists: ${destinationPath}`,
        );
      }

      throw error;
    }

    return destinationPath;
  } finally {
    if (temporaryCreated) {
      try {
        await unlink(
          temporaryPath,
        );
      } catch {
        // Preserve any original error.
      }
    }
  }
}
