import {
  createHash,
  randomUUID,
} from "node:crypto";

import {
  constants,
} from "node:fs";

import {
  copyFile,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
} from "node:path";

function nodeErrorCode(
  error:
    unknown,
): string | null {
  if (
    typeof error !==
      "object" ||
    error ===
      null ||
    !(
      "code" in
      error
    )
  ) {
    return null;
  }

  const code =
    (
      error as {
        code?:
          unknown;
      }
    ).code;

  return typeof code ===
    "string"
    ? code
    : null;
}

export function serializeVisualAttemptExecutionRecord(
  record:
    unknown,
): string {
  const serialized =
    JSON.stringify(
      record,
      null,
      2,
    );

  if (
    serialized ===
      undefined
  ) {
    throw new Error(
      "Visual attempt execution record is not JSON-serializable.",
    );
  }

  return `${serialized}\n`;
}

export function calculateVisualAttemptExecutionRecordSha256(
  bytes:
    string | Buffer,
): string {
  return createHash(
    "sha256",
  )
    .update(
      bytes,
    )
    .digest(
      "hex",
    );
}

export async function publishVisualAttemptExecutionRecordCreateOnce(
  recordPath:
    string,

  serialized:
    string,
): Promise<void> {
  await mkdir(
    dirname(
      recordPath,
    ),
    {
      recursive:
        true,
    },
  );

  const temporaryPath =
    `${recordPath}.part-${process.pid}-${randomUUID()}`;

  let temporaryCreated =
    false;

  try {
    await writeFile(
      temporaryPath,
      serialized,
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
        recordPath,
        constants.COPYFILE_EXCL,
      );
    } catch (
      error
    ) {
      if (
        nodeErrorCode(
          error,
        ) ===
          "EEXIST"
      ) {
        throw new Error(
          `Visual attempt execution record already exists: ${recordPath}`,
        );
      }

      throw error;
    }
  } finally {
    if (
      temporaryCreated
    ) {
      await unlink(
        temporaryPath,
      ).catch(
        () =>
          undefined,
      );
    }
  }
}

export async function readVisualAttemptExecutionRecordTextOrNull(
  recordPath:
    string,
): Promise<
  string | null
> {
  try {
    return await readFile(
      recordPath,
      "utf8",
    );
  } catch (
    error
  ) {
    if (
      nodeErrorCode(
        error,
      ) ===
        "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}
