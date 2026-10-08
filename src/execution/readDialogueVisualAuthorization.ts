import {
  readFile,
} from "node:fs/promises";

import {
  DialogueVisualAuthorizationSchema,
  type DialogueVisualAuthorization,
} from "./dialogueVisualAuthorization.schema.js";

import {
  createDialogueVisualAuthorizationPath,
} from "./dialogueVisualAuthorizationPath.js";

export async function readDialogueVisualAuthorization(
  mediaRoot: string,
  episodeId: string,
  shotId: string,
): Promise<
  DialogueVisualAuthorization | null
> {
  const authorizationPath =
    createDialogueVisualAuthorizationPath(
      mediaRoot,
      episodeId,
      shotId,
    );

  let raw:
    string;

  try {
    raw =
      await readFile(
        authorizationPath,
        "utf8",
      );
  } catch (error) {
    const code =
      (
        error as
          NodeJS.ErrnoException
      ).code;

    if (
      code ===
      "ENOENT"
    ) {
      return null;
    }

    throw new Error(
      `Could not read dialogue visual authorization: ${authorizationPath}`,
      {
        cause:
          error,
      },
    );
  }

  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        raw,
      );
  } catch (error) {
    throw new Error(
      `Dialogue visual authorization contains malformed JSON: ${authorizationPath}`,
      {
        cause:
          error,
      },
    );
  }

  const validated =
    DialogueVisualAuthorizationSchema
      .safeParse(
        parsed,
      );

  if (!validated.success) {
    throw new Error(
      `Dialogue visual authorization is invalid: ${authorizationPath}`,
      {
        cause:
          validated.error,
      },
    );
  }

  return validated.data;
}
