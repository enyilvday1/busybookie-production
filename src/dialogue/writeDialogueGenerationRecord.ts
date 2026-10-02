import {
  constants,
} from "node:fs";

import {
  copyFile,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
} from "node:path";

import {
  randomUUID,
} from "node:crypto";

import {
  DialogueGenerationRecordSchema,
  type DialogueGenerationRecord,
} from "./dialogueGenerationRecord.schema.js";

import {
  createDialogueGenerationRecordPath,
} from "./dialogueGenerationRecordPath.js";

function hasErrorCode(
  error:
    unknown,

  expectedCode:
    string,
): boolean {
  return (
    typeof error ===
      "object" &&
    error !==
      null &&
    "code" in
      error &&
    (
      error as {
        code?: unknown;
      }
    ).code ===
      expectedCode
  );
}

export async function writeDialogueGenerationRecord(
  mediaRoot:
    string,

  record:
    DialogueGenerationRecord,
): Promise<string> {
  const validated =
    DialogueGenerationRecordSchema.parse(
      record,
    );

  const destinationPath =
    createDialogueGenerationRecordPath(
      mediaRoot,
      validated.plan
        .episodeId,
      validated.plan
        .shotId,
      validated.plan
        .dialogueLineId,
      validated.provider,
      validated
        .providerExecutionId,
    );

  const destinationDirectory =
    dirname(
      destinationPath,
    );

  await mkdir(
    destinationDirectory,
    {
      recursive:
        true,
    },
  );

  const temporaryPath =
    `${destinationPath}.part-${process.pid}-${randomUUID()}`;

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

    try {
      await copyFile(
        temporaryPath,
        destinationPath,
        constants.COPYFILE_EXCL,
      );
    } catch (
      error:
        unknown
    ) {
      if (
        hasErrorCode(
          error,
          "EEXIST",
        )
      ) {
        throw new Error(
          `Dialogue generation record already exists: ${destinationPath}`,
        );
      }

      throw error;
    }

    return destinationPath;
  } finally {
    await rm(
      temporaryPath,
      {
        force:
          true,
      },
    );
  }
}
