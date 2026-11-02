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
  VisualAttemptAdmissionSchema,
  type VisualAttemptAdmission,
} from "./visualAttemptAdmission.schema.js";

import {
  createVisualAttemptAdmissionPath,
} from "./visualAttemptPaths.js";

export type CreateVisualAttemptAdmissionInput =
  Readonly<
    Omit<
      VisualAttemptAdmission,
      | "schemaVersion"
      | "admissionId"
      | "admittedAt"
      | "status"
    >
  >;

export type CreateVisualAttemptAdmissionDependencies =
  Readonly<{
    now?:
      () => string;

    createAdmissionId?:
      () => string;
  }>;

export type CreateVisualAttemptAdmissionResult =
  Readonly<{
    record:
      VisualAttemptAdmission;

    admissionPath:
      string;

    admissionSha256:
      string;
  }>;

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

export function serializeVisualAttemptAdmission(
  record:
    VisualAttemptAdmission,
): string {
  return `${JSON.stringify(
    record,
    null,
    2,
  )}\n`;
}

export function calculateVisualAttemptAdmissionSha256(
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

export async function createVisualAttemptAdmission(
  mediaRoot:
    string,

  input:
    CreateVisualAttemptAdmissionInput,

  dependencies:
    CreateVisualAttemptAdmissionDependencies =
      {},
): Promise<
  CreateVisualAttemptAdmissionResult
> {
  const now =
    dependencies.now ??
    (() =>
      new Date()
        .toISOString());

  const createAdmissionId =
    dependencies.createAdmissionId ??
    (() =>
      randomUUID());

  const record =
    VisualAttemptAdmissionSchema
      .parse({
        schemaVersion:
          "1.0",

        admissionId:
          createAdmissionId(),

        attemptNumber:
          input.attemptNumber,

        admittedAt:
          now(),

        status:
          "ADMITTED",

        episodeId:
          input.episodeId,

        sceneId:
          input.sceneId,

        shotId:
          input.shotId,

        provider:
          input.provider,

        manifestRawSha256:
          input.manifestRawSha256,

        promptIdentitySha256:
          input.promptIdentitySha256,

        referenceIdentitySha256:
          input.referenceIdentitySha256,

        previousAttemptNumber:
          input.previousAttemptNumber,

        previousAttemptQcSha256:
          input.previousAttemptQcSha256,
      });

  const admissionPath =
    createVisualAttemptAdmissionPath(
      mediaRoot,
      record.episodeId,
      record.shotId,
      record.attemptNumber,
    );

  await mkdir(
    dirname(
      admissionPath,
    ),
    {
      recursive:
        true,
    },
  );

  const serialized =
    serializeVisualAttemptAdmission(
      record,
    );

  const admissionSha256 =
    calculateVisualAttemptAdmissionSha256(
      serialized,
    );

  const temporaryPath =
    `${admissionPath}.part-${process.pid}-${randomUUID()}`;

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
        admissionPath,
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
          `Visual attempt admission already exists: ${admissionPath}`,
        );
      }

      throw error;
    }

    return Object.freeze({
      record,

      admissionPath,

      admissionSha256,
    });
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
