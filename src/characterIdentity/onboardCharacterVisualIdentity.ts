import {
  extname,
  isAbsolute,
  resolve,
} from "node:path";

import {
  CharacterReferenceAssetIdSchema,
} from "./characterVisualIdentityApproval.schema.js";

import {
  createCharacterVisualIdentityApproval,
  type CreateCharacterVisualIdentityApprovalDependencies,
  type CreateCharacterVisualIdentityApprovalResult,
} from "./createCharacterVisualIdentityApproval.js";

import {
  CharacterIdSchema,
} from "../schemas/characterId.schema.js";

import {
  appendVisualReferenceAssetRegistry,
  type AppendVisualReferenceAssetRegistryDependencies,
  type AppendVisualReferenceAssetRegistryResult,
} from "../execution/appendVisualReferenceAssetRegistry.js";

import type {
  VisualReferenceAsset,
} from "../execution/visualReferenceAsset.schema.js";

import {
  loadCharacterBible,
} from "../validation/loadCharacterBible.js";

// E9 Step 1137D1 onboarding layer. Two deliberately separate operations: registering a reference asset
// never implies human identity approval. Neither operation touches CharacterBible (guard G1).

const EXTENSION_CONTENT_TYPES: Readonly<Record<string, VisualReferenceAsset["contentType"]>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

const ASSET_ID_PARTS =
  /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)-(?:master-identity|front|three-quarter|profile)-reference-v[1-9][0-9]*$/;

// Step 1137C CHARACTER_REFERENCE_PATH_PATTERN: references/characters/<CHARACTER_ID>/<assetId>.<ext>
export function characterReferenceRelativePath(assetId: string, extension: string): string {
  const validatedAssetId = CharacterReferenceAssetIdSchema.parse(assetId);
  const characterKebab = ASSET_ID_PARTS.exec(validatedAssetId)?.[1];

  if (!characterKebab) {
    throw new Error(`Character reference assetId has no character prefix: ${assetId}`);
  }

  const characterId = CharacterIdSchema.parse(characterKebab.toUpperCase().replaceAll("-", "_"));

  if (!EXTENSION_CONTENT_TYPES[extension]) {
    throw new Error(`Character reference extension must be one of ${Object.keys(EXTENSION_CONTENT_TYPES).join(", ")}.`);
  }

  return `references/characters/${characterId}/${validatedAssetId}${extension}`;
}

export type RegisterCharacterReferenceAssetInput =
  Readonly<{
    mediaRoot: string;
    sourceFile: string;
    assetId: string;
    expectedRegistrySha256: string;
  }>;

export type RegisterCharacterReferenceAssetDependencies =
  Readonly<{
    append?: typeof appendVisualReferenceAssetRegistry;
    appendDependencies?: AppendVisualReferenceAssetRegistryDependencies;
  }>;

// Operation A: append one already-placed image (at its canonical references/characters path) to the existing
// registry. Bytes, SHA-256 and content type are derived and verified from the physical file.
export async function registerCharacterReferenceAsset(
  input: RegisterCharacterReferenceAssetInput,
  dependencies: RegisterCharacterReferenceAssetDependencies = {},
): Promise<AppendVisualReferenceAssetRegistryResult> {
  const mediaRoot = input.mediaRoot.trim();

  if (!mediaRoot || !isAbsolute(mediaRoot)) {
    throw new Error("register-reference requires an absolute --media-root.");
  }

  if (!isAbsolute(input.sourceFile)) {
    throw new Error("register-reference requires an absolute --source-file.");
  }

  const extension = extname(input.sourceFile);
  const relativePath = characterReferenceRelativePath(input.assetId, extension);
  const expectedPath = resolve(mediaRoot, ...relativePath.split("/"));

  if (resolve(input.sourceFile) !== expectedPath) {
    throw new Error(
      `Character reference ${input.assetId} must be placed at its canonical path ${relativePath} under the media root.`,
    );
  }

  return (dependencies.append ?? appendVisualReferenceAssetRegistry)(
    {
      mediaRoot,
      sourceImagePath: expectedPath,
      assetId: input.assetId,
      expectedRegistrySha256: input.expectedRegistrySha256,
      expectedContentType: EXTENSION_CONTENT_TYPES[extension]!,
    },
    dependencies.appendDependencies ?? {},
  );
}

export type ApproveCharacterVisualIdentityInput =
  Readonly<{
    mediaRoot: string;
    characterId: string;
    targetIdentityVersion: number;
    request: unknown;
    // Defaults to the canonical config/characters.json through the existing loader.
    characterBiblePath?: string;
  }>;

export type ApproveCharacterVisualIdentityDependencies =
  Readonly<{
    loadCharacterBible?: typeof loadCharacterBible;
    createApproval?: typeof createCharacterVisualIdentityApproval;
    createApprovalDependencies?: CreateCharacterVisualIdentityApprovalDependencies;
  }>;

// Operation B: create the immutable human approval receipt for already registered references.
export async function approveCharacterVisualIdentity(
  input: ApproveCharacterVisualIdentityInput,
  dependencies: ApproveCharacterVisualIdentityDependencies = {},
): Promise<CreateCharacterVisualIdentityApprovalResult> {
  const mediaRoot = input.mediaRoot.trim();

  if (!mediaRoot || !isAbsolute(mediaRoot)) {
    throw new Error("approve-identity requires an absolute --media-root.");
  }

  const load = dependencies.loadCharacterBible ?? loadCharacterBible;
  const bible = input.characterBiblePath === undefined ? await load() : await load(input.characterBiblePath);

  return (dependencies.createApproval ?? createCharacterVisualIdentityApproval)(
    mediaRoot,
    {
      bible,
      characterId: input.characterId,
      targetIdentityVersion: input.targetIdentityVersion,
      request: input.request,
    },
    dependencies.createApprovalDependencies ?? {},
  );
}
