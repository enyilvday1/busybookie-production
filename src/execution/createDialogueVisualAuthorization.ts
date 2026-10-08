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
  DialogueVisualAuthorizationInputSchema,
  DialogueVisualAuthorizationSchema,
  type DialogueVisualAuthorization,
  type DialogueVisualAuthorizationInput,
} from "./dialogueVisualAuthorization.schema.js";

import {
  createDialogueVisualAuthorizationPath,
} from "./dialogueVisualAuthorizationPath.js";

export type DialogueVisualAuthorizationDependencies =
  Readonly<{
    now?: () => string;
    createAuthorizationId?: () => string;
  }>;

export type CreateDialogueVisualAuthorizationResult =
  Readonly<{
    record:
      DialogueVisualAuthorization;

    authorizationPath:
      string;
  }>;

export async function createDialogueVisualAuthorization(
  mediaRoot: string,
  input:
    DialogueVisualAuthorizationInput,
  dependencies:
    DialogueVisualAuthorizationDependencies = {},
): Promise<
  CreateDialogueVisualAuthorizationResult
> {
  const validatedInput =
    DialogueVisualAuthorizationInputSchema
      .parse(
        input,
      );

  const now =
    dependencies.now ??
    (() =>
      new Date()
        .toISOString());

  const createAuthorizationId =
    dependencies.createAuthorizationId ??
    randomUUID;

  const record =
    DialogueVisualAuthorizationSchema
      .parse({
        schemaVersion:
          "1.0",

        authorizationId:
          createAuthorizationId(),

        authorizedAt:
          now(),

        status:
          "AUTHORIZED",

        episodeId:
          validatedInput.episodeId,

        shotId:
          validatedInput.shotId,

        purpose:
          validatedInput.purpose,

        provider:
          validatedInput.provider,

        nativeAudioDisposition:
          validatedInput
            .nativeAudioDisposition,

        dialogueAuthority:
          validatedInput
            .dialogueAuthority,

        authorizationSource:
          validatedInput
            .authorizationSource,
      });

  const authorizationPath =
    createDialogueVisualAuthorizationPath(
      mediaRoot,
      record.episodeId,
      record.shotId,
    );

  await mkdir(
    dirname(
      authorizationPath,
    ),
    {
      recursive:
        true,
    },
  );

  const temporaryPath =
    `${authorizationPath}.part-${process.pid}-${randomUUID()}`;

  let temporaryCreated =
    false;

  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(
        record,
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
        authorizationPath,
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
          `Dialogue visual authorization already exists: ${authorizationPath}`,
        );
      }

      throw error;
    }

    return {
      record,
      authorizationPath,
    };
  } finally {
    if (temporaryCreated) {
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
