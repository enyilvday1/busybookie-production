import {
  createHash,
  randomUUID,
} from "node:crypto";

import {
  createReadStream,
} from "node:fs";

import {
  lstat,
  unlink,
} from "node:fs/promises";

import {
  isAbsolute,
} from "node:path";

import {
  downloadRunwayOutput,
  RUNWAY_MAX_OUTPUT_BYTES,
  type DownloadedRunwayOutput,
  type RunwayFetch,
} from "./downloadRunwayOutput.js";

type InspectedRunwayOutput =
  Readonly<{
    bytes:
      number;

    sha256:
      string;
  }>;

function validateRecoveryArguments(
  destinationPath:
    string,

  maxBytes:
    number,
): void {
  if (
    !isAbsolute(
      destinationPath,
    )
  ) {
    throw new Error(
      "Runway output destination must be an absolute path.",
    );
  }

  if (
    !Number.isSafeInteger(
      maxBytes,
    ) ||
    maxBytes <= 0
  ) {
    throw new Error(
      "Runway maximum output size must be a positive safe integer.",
    );
  }
}

async function inspectAndHashExistingRunwayOutput(
  filePath:
    string,

  maxBytes:
    number,
): Promise<InspectedRunwayOutput> {
  const metadata =
    await lstat(
      filePath,
    );

  if (
    !metadata.isFile()
  ) {
    throw new Error(
      `Existing Runway output is not a regular file: ${filePath}`,
    );
  }

  if (
    metadata.size <= 0
  ) {
    throw new Error(
      `Existing Runway output is empty: ${filePath}`,
    );
  }

  if (
    metadata.size >
    maxBytes
  ) {
    throw new Error(
      `Existing Runway output exceeds the ${maxBytes}-byte local limit: ${filePath}`,
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
        `Existing Runway output exceeded the ${maxBytes}-byte local limit while hashing: ${filePath}`,
      );
    }

    hash.update(
      buffer,
    );
  }

  if (
    bytes <= 0
  ) {
    throw new Error(
      `Existing Runway output contained no data: ${filePath}`,
    );
  }

  if (
    bytes !==
    metadata.size
  ) {
    throw new Error(
      `Existing Runway output changed while being inspected: ${filePath}`,
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

async function destinationExists(
  destinationPath:
    string,
): Promise<boolean> {
  try {
    await lstat(
      destinationPath,
    );

    return true;
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
      return false;
    }

    throw error;
  }
}

async function verifyAndReuseExistingOutput(
  sourceUrl:
    string,

  destinationPath:
    string,

  fetchImpl:
    RunwayFetch,

  maxBytes:
    number,
): Promise<DownloadedRunwayOutput> {
  const existing =
    await inspectAndHashExistingRunwayOutput(
      destinationPath,
      maxBytes,
    );

  const verificationPath =
    `${destinationPath}.verify-${process.pid}-${randomUUID()}`;

  let primaryError:
    unknown =
      null;

  try {
    const providerCopy =
      await downloadRunwayOutput(
        sourceUrl,
        verificationPath,
        fetchImpl,
        maxBytes,
      );

    if (
      providerCopy.bytes !==
        existing.bytes ||
      providerCopy.sha256 !==
        existing.sha256
    ) {
      throw new Error(
        `Existing Runway output does not match the provider output: ${destinationPath}`,
      );
    }

    const afterVerification =
      await inspectAndHashExistingRunwayOutput(
        destinationPath,
        maxBytes,
      );

    if (
      afterVerification.bytes !==
        existing.bytes ||
      afterVerification.sha256 !==
        existing.sha256
    ) {
      throw new Error(
        `Existing Runway output changed during provider verification: ${destinationPath}`,
      );
    }

    return Object.freeze({
      destinationPath,

      bytes:
        afterVerification.bytes,

      sha256:
        afterVerification.sha256,

      contentType:
        providerCopy
          .contentType,
    });
  } catch (error) {
    primaryError =
      error;

    throw error;
  } finally {
    try {
      await unlink(
        verificationPath,
      );
    } catch (error) {
      const code =
        (
          error as
            NodeJS.ErrnoException
        ).code;

      if (
        code !==
          "ENOENT" &&
        primaryError ===
          null
      ) {
        throw error;
      }
    }
  }
}

export async function recoverRunwayOutput(
  sourceUrl:
    string,

  destinationPath:
    string,

  fetchImpl:
    RunwayFetch = fetch,

  maxBytes:
    number =
      RUNWAY_MAX_OUTPUT_BYTES,
): Promise<DownloadedRunwayOutput> {
  validateRecoveryArguments(
    destinationPath,
    maxBytes,
  );

  if (
    await destinationExists(
      destinationPath,
    )
  ) {
    return verifyAndReuseExistingOutput(
      sourceUrl,
      destinationPath,
      fetchImpl,
      maxBytes,
    );
  }

  try {
    return await downloadRunwayOutput(
      sourceUrl,
      destinationPath,
      fetchImpl,
      maxBytes,
    );
  } catch (error) {
    const code =
      (
        error as
          NodeJS.ErrnoException
      ).code;

    if (
      code !==
      "EEXIST"
    ) {
      throw error;
    }
  }

  return verifyAndReuseExistingOutput(
    sourceUrl,
    destinationPath,
    fetchImpl,
    maxBytes,
  );
}
