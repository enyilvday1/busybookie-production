import {
  readFile,
  stat,
} from "node:fs/promises";

import {
  extname,
  isAbsolute,
  resolve,
} from "node:path";

export const RUNWAY_MAX_IMAGE_DATA_URI_BYTES =
  5_000_000;

const IMAGE_MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
} as const;

type SupportedImageExtension =
  keyof typeof IMAGE_MIME_TYPES;

export type RunwayImageAssetStrategy =
  | "DATA_URI"
  | "EPHEMERAL_UPLOAD";

export type ClassifiedRunwayImageAsset =
  Readonly<{
    sourcePath: string;
    extension: SupportedImageExtension;
    mimeType: string;
    sourceBytes: number;
    estimatedDataUriBytes: number;
    strategy: RunwayImageAssetStrategy;
  }>;

export type PreparedRunwayImageAsset =
  | Readonly<{
      strategy: "DATA_URI";
      sourcePath: string;
      uri: string;
    }>
  | Readonly<{
      strategy: "EPHEMERAL_UPLOAD";
      sourcePath: string;
    }>;

function requireSupportedExtension(
  filePath: string,
): SupportedImageExtension {
  const extension =
    extname(filePath).toLowerCase();

  if (
    !Object.prototype.hasOwnProperty.call(
      IMAGE_MIME_TYPES,
      extension,
    )
  ) {
    throw new Error(
      `Unsupported Runway image type: ${extension || "(no extension)"}. ` +
      "Supported types: .png, .jpg, .jpeg, .webp.",
    );
  }

  return extension as SupportedImageExtension;
}

export function estimateBase64Length(
  sourceBytes: number,
): number {
  if (
    !Number.isSafeInteger(sourceBytes) ||
    sourceBytes < 0
  ) {
    throw new Error(
      "Source byte length must be a non-negative safe integer.",
    );
  }

  return (
    4 *
    Math.ceil(
      sourceBytes / 3,
    )
  );
}

export async function classifyRunwayImageAsset(
  filePath: string,
): Promise<ClassifiedRunwayImageAsset> {
  if (!isAbsolute(filePath)) {
    throw new Error(
      "Runway image asset path must be absolute.",
    );
  }

  const sourcePath =
    resolve(filePath);

  const extension =
    requireSupportedExtension(
      sourcePath,
    );

  const metadata =
    await stat(sourcePath);

  if (!metadata.isFile()) {
    throw new Error(
      `Runway image asset is not a file: ${sourcePath}`,
    );
  }

  if (metadata.size === 0) {
    throw new Error(
      `Runway image asset is empty: ${sourcePath}`,
    );
  }

  const mimeType =
    IMAGE_MIME_TYPES[extension];

  const prefix =
    `data:${mimeType};base64,`;

  const estimatedDataUriBytes =
    Buffer.byteLength(
      prefix,
      "utf8",
    ) +
    estimateBase64Length(
      metadata.size,
    );

  const strategy:
    RunwayImageAssetStrategy =
      estimatedDataUriBytes <=
      RUNWAY_MAX_IMAGE_DATA_URI_BYTES
        ? "DATA_URI"
        : "EPHEMERAL_UPLOAD";

  return Object.freeze({
    sourcePath,
    extension,
    mimeType,
    sourceBytes: metadata.size,
    estimatedDataUriBytes,
    strategy,
  });
}

export async function prepareRunwayImageAsset(
  filePath: string,
): Promise<PreparedRunwayImageAsset> {
  const asset =
    await classifyRunwayImageAsset(
      filePath,
    );

  if (
    asset.strategy ===
    "EPHEMERAL_UPLOAD"
  ) {
    return Object.freeze({
      strategy:
        "EPHEMERAL_UPLOAD",
      sourcePath:
        asset.sourcePath,
    });
  }

  const bytes =
    await readFile(
      asset.sourcePath,
    );

  const uri =
    `data:${asset.mimeType};base64,` +
    bytes.toString("base64");

  if (
    Buffer.byteLength(
      uri,
      "utf8",
    ) >
    RUNWAY_MAX_IMAGE_DATA_URI_BYTES
  ) {
    throw new Error(
      "Runway data URI exceeded the configured 5 MB safety limit after encoding.",
    );
  }

  return Object.freeze({
    strategy: "DATA_URI",
    sourcePath:
      asset.sourcePath,
    uri,
  });
}
