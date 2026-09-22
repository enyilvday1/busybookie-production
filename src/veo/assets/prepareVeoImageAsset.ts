import {
  readFile,
  stat,
} from "node:fs/promises";

import {
  extname,
  isAbsolute,
  resolve,
} from "node:path";

import type {
  VeoImageMimeType,
  VeoInlineImage,
} from "../veo.types.js";

export type PreparedVeoImageAsset =
  Readonly<{
    sourcePath:
      string;

    sourceBytes:
      number;

    image:
      VeoInlineImage;
  }>;

function resolveMimeType(
  filePath:
    string,
): VeoImageMimeType {
  const extension =
    extname(
      filePath,
    )
      .toLowerCase();

  switch (extension) {
    case ".png":
      return "image/png";

    case ".jpg":
    case ".jpeg":
      return "image/jpeg";

    case ".webp":
      return "image/webp";

    default:
      throw new Error(
        `Unsupported Veo image extension: ${extension || "(none)"}.`,
      );
  }
}

export async function prepareVeoImageAsset(
  filePath:
    string,

  maxBytes:
    number,
): Promise<PreparedVeoImageAsset> {
  if (
    !isAbsolute(
      filePath,
    )
  ) {
    throw new Error(
      "Veo image path must be absolute.",
    );
  }

  if (
    !Number.isSafeInteger(
      maxBytes,
    ) ||
    maxBytes <= 0
  ) {
    throw new Error(
      "Veo maximum image size must be a positive safe integer.",
    );
  }

  const sourcePath =
    resolve(
      filePath,
    );

  const metadata =
    await stat(
      sourcePath,
    );

  if (
    !metadata.isFile()
  ) {
    throw new Error(
      `Veo image path is not a file: ${sourcePath}`,
    );
  }

  if (
    metadata.size <= 0
  ) {
    throw new Error(
      "Veo image file must not be empty.",
    );
  }

  if (
    metadata.size >
    maxBytes
  ) {
    throw new Error(
      `Veo image exceeds the local ${maxBytes}-byte source limit.`,
    );
  }

  const mimeType =
    resolveMimeType(
      sourcePath,
    );

  const bytes =
    await readFile(
      sourcePath,
    );

  if (
    bytes.length >
    maxBytes
  ) {
    throw new Error(
      `Veo image exceeded the local ${maxBytes}-byte source limit while reading.`,
    );
  }

  const image =
    Object.freeze({
      imageBytes:
        bytes.toString(
          "base64",
        ),

      mimeType,
    });

  return Object.freeze({
    sourcePath,
    sourceBytes:
      bytes.length,
    image,
  });
}
