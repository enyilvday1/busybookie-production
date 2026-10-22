import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  CharacterIdSchema,
} from "../schemas/characterId.schema.js";

import {
  CharacterIdentityVersionSchema,
} from "../schemas/characterVisualIdentity.schema.js";

// Step 1137C APPROVAL_PATH_PATTERN:
// references/character-identity-approvals/<CHARACTER_ID>/<CHARACTER_ID>_IV<n>.character-visual-identity-approval.json
export function createCharacterVisualIdentityApprovalRelativePath(
  characterId: string,
  targetIdentityVersion: number,
): string {
  const validatedCharacterId = CharacterIdSchema.parse(characterId);
  const validatedVersion = CharacterIdentityVersionSchema.parse(targetIdentityVersion);

  return [
    "references",
    "character-identity-approvals",
    validatedCharacterId,
    `${validatedCharacterId}_IV${validatedVersion}.character-visual-identity-approval.json`,
  ].join("/");
}

export function createCharacterVisualIdentityApprovalPath(
  mediaRoot: string,
  characterId: string,
  targetIdentityVersion: number,
): string {
  const normalizedMediaRoot = mediaRoot.trim();

  if (!normalizedMediaRoot) {
    throw new Error("Character visual identity approval media root is required.");
  }

  if (!isAbsolute(normalizedMediaRoot)) {
    throw new Error("Character visual identity approval media root must be absolute.");
  }

  const approvalsRoot = resolve(normalizedMediaRoot, "references", "character-identity-approvals");

  const approvalPath = resolve(
    normalizedMediaRoot,
    ...createCharacterVisualIdentityApprovalRelativePath(characterId, targetIdentityVersion).split("/"),
  );

  const relativePath = relative(approvalsRoot, approvalPath);

  if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === ".." || isAbsolute(relativePath)) {
    throw new Error("Character visual identity approval path escapes the approvals root.");
  }

  return approvalPath;
}
