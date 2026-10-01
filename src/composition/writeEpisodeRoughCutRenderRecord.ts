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
  EpisodeRoughCutRenderRecordSchema,
  type EpisodeRoughCutRenderRecord,
} from "./episodeRoughCutRenderRecord.schema.js";

import {
  createEpisodeRoughCutRenderRecordPath,
} from "./episodeRoughCutRenderRecordPath.js";

export async function writeEpisodeRoughCutRenderRecord(
  record:
    EpisodeRoughCutRenderRecord,
): Promise<string> {
  const validated =
    EpisodeRoughCutRenderRecordSchema.parse(
      record,
    );

  const destinationPath =
    createEpisodeRoughCutRenderRecordPath(
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
          `Episode rough-cut render record already exists: ${destinationPath}`,
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
         * failure, matching the existing durable-record
         * persistence semantics.
         */
      }
    }
  }
}
