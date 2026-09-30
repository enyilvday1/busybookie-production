import {
  createHash,
} from "node:crypto";

import {
  createReadStream,
} from "node:fs";

import {
  stat,
} from "node:fs/promises";

export type InspectedCompositionNormalizationFile =
  Readonly<{
    bytes:
      number;

    sha256:
      string;
  }>;

export async function inspectCompositionNormalizationFile(
  filePath:
    string,

  maxBytes:
    number,
): Promise<InspectedCompositionNormalizationFile> {
  if (
    !Number.isSafeInteger(
      maxBytes,
    ) ||
    maxBytes <=
      0
  ) {
    throw new Error(
      "Composition normalization file maximum byte limit must be a positive safe integer.",
    );
  }

  const metadata =
    await stat(
      filePath,
    );

  if (
    !metadata.isFile()
  ) {
    throw new Error(
      `Composition normalization path is not a file: ${filePath}`,
    );
  }

  if (
    metadata.size <=
      0
  ) {
    throw new Error(
      `Composition normalization file contained no data: ${filePath}`,
    );
  }

  if (
    metadata.size >
      maxBytes
  ) {
    throw new Error(
      `Composition normalization file exceeds the ${maxBytes}-byte local limit: ${filePath}`,
    );
  }

  const hash =
    createHash(
      "sha256",
    );

  let bytes =
    0;

  const stream =
    createReadStream(
      filePath,
    );

  for await (
    const chunk
    of stream
  ) {
    const buffer =
      Buffer.isBuffer(
        chunk,
      )
        ? chunk
        : Buffer.from(
            chunk,
          );

    bytes +=
      buffer.length;

    if (
      bytes >
        maxBytes
    ) {
      throw new Error(
        `Composition normalization file exceeded the ${maxBytes}-byte local limit while hashing: ${filePath}`,
      );
    }

    hash.update(
      buffer,
    );
  }

  if (
    bytes <=
      0
  ) {
    throw new Error(
      `Composition normalization file contained no data: ${filePath}`,
    );
  }

  if (
    bytes !==
      metadata.size
  ) {
    throw new Error(
      `Composition normalization file changed while it was being inspected: ${filePath}`,
    );
  }

  return Object.freeze({
    bytes,

    sha256:
      hash.digest(
        "hex",
      ),
  });
}
