import {
  readFile,
} from "node:fs/promises";

import {
  CharacterVisualIdentityApprovalV1Schema,
  type CharacterVisualIdentityApprovalV1,
} from "./characterVisualIdentityApproval.schema.js";

import {
  createCharacterVisualIdentityApprovalPath,
} from "./characterVisualIdentityApprovalPath.js";

// Strict reader: the path comes only from the canonical builder, a missing receipt is an error, and the
// stored record must name the requested character and identity version. No migration guessing.
export async function readCharacterVisualIdentityApproval(
  mediaRoot: string,
  characterId: string,
  targetIdentityVersion: number,
): Promise<CharacterVisualIdentityApprovalV1> {
  const approvalPath =
    createCharacterVisualIdentityApprovalPath(mediaRoot, characterId, targetIdentityVersion);

  let raw: string;

  try {
    raw = await readFile(approvalPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Character visual identity approval does not exist: ${approvalPath}`, { cause: error });
    }

    throw new Error(`Could not read character visual identity approval: ${approvalPath}`, { cause: error });
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Character visual identity approval contains malformed JSON: ${approvalPath}`, { cause: error });
  }

  const validated = CharacterVisualIdentityApprovalV1Schema.safeParse(parsed);

  if (!validated.success) {
    throw new Error(`Character visual identity approval is invalid: ${approvalPath}`, { cause: validated.error });
  }

  if (validated.data.characterId !== characterId) {
    throw new Error(
      `Character visual identity approval at ${approvalPath} names ${validated.data.characterId}, not ${characterId}.`,
    );
  }

  if (validated.data.targetIdentityVersion !== targetIdentityVersion) {
    throw new Error(
      `Character visual identity approval at ${approvalPath} targets identity version ${validated.data.targetIdentityVersion}, not ${targetIdentityVersion}.`,
    );
  }

  return validated.data;
}
