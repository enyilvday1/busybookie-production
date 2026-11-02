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
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
} from "node:path";

import {
  VisualAttemptQcInputSchema,
  VisualAttemptQcSchema,
  type VisualAttemptQc,
  type VisualAttemptQcInput,
} from "./visualAttemptQc.schema.js";

import {
  createVisualAttemptQcPath,
} from "./visualAttemptPaths.js";

export type VisualAttemptQcWriteDependencies =
  Readonly<{
    now?:
      () => string;

    createQcId?:
      () => string;
  }>;

export type CreateVisualAttemptQcResult =
  Readonly<{
    record:
      VisualAttemptQc;

    qcPath:
      string;

    qcSha256:
      string;
  }>;

export function serializeVisualAttemptQc(
  record:
    VisualAttemptQc,
): string {
  return `${JSON.stringify(
    record,
    null,
    2,
  )}\n`;
}

export function calculateVisualAttemptQcSha256(
  bytes:
    string | Uint8Array,
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

export async function createVisualAttemptQc(
  mediaRoot:
    string,

  input:
    VisualAttemptQcInput,

  dependencies:
    VisualAttemptQcWriteDependencies = {},
): Promise<CreateVisualAttemptQcResult> {
  const validatedInput =
    VisualAttemptQcInputSchema
      .parse(
        input,
      );

  const now =
    dependencies.now ??
    (() =>
      new Date().toISOString());

  const createQcId =
    dependencies.createQcId ??
    randomUUID;

  const record =
    VisualAttemptQcSchema
      .parse({
        ...validatedInput,

        schemaVersion:
          "1.0",

        qcId:
          createQcId(),

        recordedAt:
          now(),

        status:
          "RECORDED",

        reviewer:
          "HUMAN_OPERATOR",
      });

  const qcPath =
    createVisualAttemptQcPath(
      mediaRoot,
      record.episodeId,
      record.shotId,
      record.attemptNumber,
    );

  await mkdir(
    dirname(
      qcPath,
    ),
    {
      recursive:
        true,
    },
  );

  const serialized =
    serializeVisualAttemptQc(
      record,
    );

  const qcSha256 =
    calculateVisualAttemptQcSha256(
      serialized,
    );

  const temporaryPath =
    `${qcPath}.part-${process.pid}-${randomUUID()}`;

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
        qcPath,
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
          `Visual attempt QC already exists: ${qcPath}`,
        );
      }

      throw error;
    }

    return Object.freeze({
      record,

      qcPath,

      qcSha256,
    });
  } finally {
    if (
      temporaryCreated
    ) {
      try {
        await unlink(
          temporaryPath,
        );
      } catch {
        // Preserve the original result or failure.
      }
    }
  }
}
