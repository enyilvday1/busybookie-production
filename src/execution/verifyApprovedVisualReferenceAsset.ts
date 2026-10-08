import {
  createHash,
} from "node:crypto";

import {
  readFile,
  realpath as fsRealpath,
  stat,
} from "node:fs/promises";

import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  VisualReferenceAssetRegistrySchema,
  type VisualReferenceAsset,
  type VisualReferenceAssetRegistry,
} from "./visualReferenceAsset.schema.js";

export type VerifiedVisualReferenceAsset =
  Readonly<
    VisualReferenceAsset & {
      absolutePath:
        string;
    }
  >;

export type VisualReferenceAssetRealpath =
  (
    path:
      string,
  ) => Promise<string>;

export type VerifyApprovedVisualReferenceAssetInput =
  Readonly<{
    mediaRoot:
      string;

    sourceImagePath:
      string;

    approvedAssetIds:
      readonly string[];

    registry:
      VisualReferenceAssetRegistry;
  }>;

export type VerifyApprovedVisualReferenceAssetDependencies =
  Readonly<{
    realpath?:
      VisualReferenceAssetRealpath;
  }>;

function isPathInsideRoot(
  rootPath:
    string,

  candidatePath:
    string,
): boolean {
  const relativePath =
    relative(
      rootPath,
      candidatePath,
    );

  return (
    relativePath !==
      ".." &&
    !relativePath.startsWith(
      `..${sep}`,
    ) &&
    !isAbsolute(
      relativePath,
    )
  );
}

function isPathStrictlyInsideRoot(
  rootPath:
    string,

  candidatePath:
    string,
): boolean {
  return (
    resolve(
      rootPath,
    ) !==
      resolve(
        candidatePath,
      ) &&
    isPathInsideRoot(
      rootPath,
      candidatePath,
    )
  );
}

async function resolvePhysicalPath(
  path:
    string,

  label:
    string,

  resolveRealpath:
    VisualReferenceAssetRealpath,
): Promise<string> {
  try {
    return await resolveRealpath(
      path,
    );
  } catch (error) {
    throw new Error(
      `Visual reference ${label} could not be resolved: ${path}`,
      {
        cause:
          error,
      },
    );
  }
}

function detectImageContentType(
  bytes:
    Buffer,
): VisualReferenceAsset[
  "contentType"
] {
  const isPng =
    bytes.length >=
      8 &&
    bytes
      .subarray(
        0,
        8,
      )
      .equals(
        Buffer.from([
          0x89,
          0x50,
          0x4e,
          0x47,
          0x0d,
          0x0a,
          0x1a,
          0x0a,
        ]),
      );

  if (isPng) {
    return "image/png";
  }

  const isJpeg =
    bytes.length >=
      3 &&
    bytes[0] ===
      0xff &&
    bytes[1] ===
      0xd8 &&
    bytes[2] ===
      0xff;

  if (isJpeg) {
    return "image/jpeg";
  }

  const isWebp =
    bytes.length >=
      12 &&
    bytes
      .subarray(
        0,
        4,
      )
      .toString(
        "ascii",
      ) ===
      "RIFF" &&
    bytes
      .subarray(
        8,
        12,
      )
      .toString(
        "ascii",
      ) ===
      "WEBP";

  if (isWebp) {
    return "image/webp";
  }

  throw new Error(
    "Visual reference content type could not be verified as PNG, JPEG, or WebP.",
  );
}

async function inspectVisualReferenceFile(
  filePath:
    string,

  expectedBytes:
    number,
): Promise<
  Readonly<{
    bytes:
      number;

    sha256:
      string;

    contentType:
      VisualReferenceAsset[
        "contentType"
      ];
  }>
> {
  const beforeReadMetadata =
    await stat(
      filePath,
    );

  if (
    !beforeReadMetadata
      .isFile()
  ) {
    throw new Error(
      `Visual reference source is not a regular file: ${filePath}`,
    );
  }

  if (
    beforeReadMetadata.size !==
    expectedBytes
  ) {
    throw new Error(
      `Visual reference byte-count mismatch for ${filePath}: expected ${expectedBytes}, received ${beforeReadMetadata.size}.`,
    );
  }

  const bytes =
    await readFile(
      filePath,
    );

  if (
    bytes.length !==
    expectedBytes
  ) {
    throw new Error(
      `Visual reference byte-count changed while reading ${filePath}: expected ${expectedBytes}, received ${bytes.length}.`,
    );
  }

  const contentType =
    detectImageContentType(
      bytes,
    );

  const sha256 =
    createHash(
      "sha256",
    )
      .update(
        bytes,
      )
      .digest(
        "hex",
      );

  const afterReadMetadata =
    await stat(
      filePath,
    );

  if (
    !afterReadMetadata
      .isFile() ||
    afterReadMetadata.size !==
      expectedBytes
  ) {
    throw new Error(
      `Visual reference file changed while it was being inspected: ${filePath}`,
    );
  }

  return Object.freeze({
    bytes:
      bytes.length,

    sha256,

    contentType,
  });
}

export async function verifyApprovedVisualReferenceAsset(
  input:
    VerifyApprovedVisualReferenceAssetInput,

  dependencies:
    VerifyApprovedVisualReferenceAssetDependencies =
      {},
): Promise<VerifiedVisualReferenceAsset> {
  const normalizedMediaRoot =
    input.mediaRoot.trim();

  if (
    !normalizedMediaRoot
  ) {
    throw new Error(
      "Busybookie media root is required for visual-reference verification.",
    );
  }

  if (
    !isAbsolute(
      normalizedMediaRoot,
    )
  ) {
    throw new Error(
      "Busybookie media root must be absolute for visual-reference verification.",
    );
  }

  const normalizedSourceImagePath =
    input.sourceImagePath.trim();

  if (
    !normalizedSourceImagePath
  ) {
    throw new Error(
      "Visual reference source image path is required.",
    );
  }

  if (
    !isAbsolute(
      normalizedSourceImagePath,
    )
  ) {
    throw new Error(
      "Visual reference source image path must be absolute.",
    );
  }

  if (
    input.approvedAssetIds
      .length ===
    0
  ) {
    throw new Error(
      "Visual reference verification requires at least one approved asset id.",
    );
  }

  const registry =
    VisualReferenceAssetRegistrySchema
      .parse(
        input.registry,
      );

  const registryByAssetId =
    new Map(
      registry.assets.map(
        (asset) => [
          asset.assetId,
          asset,
        ] as const,
      ),
    );

  const approvedAssetIds =
    input.approvedAssetIds
      .map(
        (assetId) =>
          assetId.trim(),
      );

  if (
    approvedAssetIds.some(
      (assetId) =>
        !assetId,
    )
  ) {
    throw new Error(
      "Approved visual reference asset ids must not be empty.",
    );
  }

  if (
    new Set(
      approvedAssetIds,
    ).size !==
    approvedAssetIds.length
  ) {
    throw new Error(
      "Approved visual reference asset ids must not contain duplicates.",
    );
  }

  const approvedAssets =
    approvedAssetIds.map(
      (assetId) => {
        const asset =
          registryByAssetId.get(
            assetId,
          );

        if (!asset) {
          throw new Error(
            `Approved visual reference asset id is not registered: ${assetId}.`,
          );
        }

        return asset;
      },
    );

  const absoluteMediaRoot =
    resolve(
      normalizedMediaRoot,
    );

  const trustedReferenceRoot =
    resolve(
      absoluteMediaRoot,
      "references",
    );

  const absoluteSourceImagePath =
    resolve(
      normalizedSourceImagePath,
    );

  if (
    !isPathStrictlyInsideRoot(
      trustedReferenceRoot,
      absoluteSourceImagePath,
    )
  ) {
    throw new Error(
      `Visual reference source path must be strictly inside ${trustedReferenceRoot}.`,
    );
  }

  const matchingAssets =
    approvedAssets.filter(
      (asset) => {
        const registeredPath =
          resolve(
            absoluteMediaRoot,
            ...asset
              .mediaRootRelativePath
              .split(
                "/",
              ),
          );

        return (
          registeredPath ===
          absoluteSourceImagePath
        );
      },
    );

  if (
    matchingAssets.length !==
    1
  ) {
    throw new Error(
      "Visual reference source path does not match exactly one canonical registered path approved by the shot.",
    );
  }

  const selectedAsset =
    matchingAssets[0];

  if (!selectedAsset) {
    throw new Error(
      "Visual reference approved asset could not be selected.",
    );
  }

  const resolveRealpath =
    dependencies.realpath ??
    fsRealpath;

  const [
    physicalMediaRoot,
    physicalReferenceRoot,
    physicalSourceImagePath,
  ] =
    await Promise.all([
      resolvePhysicalPath(
        absoluteMediaRoot,
        "media root",
        resolveRealpath,
      ),

      resolvePhysicalPath(
        trustedReferenceRoot,
        "references root",
        resolveRealpath,
      ),

      resolvePhysicalPath(
        absoluteSourceImagePath,
        "source image",
        resolveRealpath,
      ),
    ]);

  if (
    !isPathStrictlyInsideRoot(
      physicalMediaRoot,
      physicalReferenceRoot,
    )
  ) {
    throw new Error(
      "Visual reference physical references root is outside the Busybookie media root.",
    );
  }

  if (
    !isPathStrictlyInsideRoot(
      physicalReferenceRoot,
      physicalSourceImagePath,
    )
  ) {
    throw new Error(
      "Visual reference physical source image is outside the trusted references root.",
    );
  }

  const inspected =
    await inspectVisualReferenceFile(
      physicalSourceImagePath,
      selectedAsset.bytes,
    );

  if (
    inspected.sha256 !==
    selectedAsset.sha256
  ) {
    throw new Error(
      `Visual reference SHA-256 mismatch for ${physicalSourceImagePath}.`,
    );
  }

  if (
    inspected.contentType !==
    selectedAsset.contentType
  ) {
    throw new Error(
      `Visual reference content type mismatch for ${physicalSourceImagePath}: expected ${selectedAsset.contentType}, received ${inspected.contentType}.`,
    );
  }

  return Object.freeze({
    ...selectedAsset,

    absolutePath:
      physicalSourceImagePath,
  });
}
