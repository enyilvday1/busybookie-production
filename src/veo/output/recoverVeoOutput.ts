import type {
  GeneratedVideo,
} from "@google/genai";

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
  persistVeoGeneratedVideo,
  VEO_MAX_OUTPUT_BYTES,
  VeoOutputAlreadyExistsError,
  type PersistedVeoOutput,
  type VeoSdkFileDownloader,
} from "./persistVeoGeneratedVideo.js";

export type InspectedVeoOutput =
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
      "Veo output destination must be an absolute path.",
    );
  }

  if (
    !Number.isSafeInteger(
      maxBytes,
    ) ||
    maxBytes <= 0
  ) {
    throw new Error(
      "Veo maximum output size must be a positive safe integer.",
    );
  }
}

async function inspectAndHashExistingVeoOutput(
  filePath:
    string,

  maxBytes:
    number,
): Promise<InspectedVeoOutput> {
  const metadata =
    await lstat(
      filePath,
    );

  if (
    !metadata.isFile()
  ) {
    throw new Error(
      `Existing Veo output is not a regular file: ${filePath}`,
    );
  }

  if (
    metadata.size <= 0
  ) {
    throw new Error(
      `Existing Veo output is empty: ${filePath}`,
    );
  }

  if (
    metadata.size >
      maxBytes
  ) {
    throw new Error(
      `Existing Veo output exceeds the ${maxBytes}-byte local limit: ${filePath}`,
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
        `Existing Veo output exceeded the ${maxBytes}-byte local limit while hashing: ${filePath}`,
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
      `Existing Veo output contained no data: ${filePath}`,
    );
  }

  if (
    bytes !==
      metadata.size
  ) {
    throw new Error(
      `Existing Veo output changed while being inspected: ${filePath}`,
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

export async function inspectVeoOutput(
  filePath:
    string,

  maxBytes:
    number =
      VEO_MAX_OUTPUT_BYTES,
): Promise<InspectedVeoOutput> {
  validateRecoveryArguments(
    filePath,
    maxBytes,
  );

  return inspectAndHashExistingVeoOutput(
    filePath,
    maxBytes,
  );
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
  generatedVideo:
    GeneratedVideo,

  destinationPath:
    string,

  downloadFile:
    VeoSdkFileDownloader,

  maxBytes:
    number,
): Promise<PersistedVeoOutput> {
  const existing =
    await inspectAndHashExistingVeoOutput(
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
      await persistVeoGeneratedVideo(
        generatedVideo,
        verificationPath,
        downloadFile,
        maxBytes,
      );

    if (
      providerCopy.bytes !==
        existing.bytes ||
      providerCopy.sha256 !==
        existing.sha256
    ) {
      throw new Error(
        `Existing Veo output does not match the provider output: ${destinationPath}`,
      );
    }

    const afterVerification =
      await inspectAndHashExistingVeoOutput(
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
        `Existing Veo output changed during provider verification: ${destinationPath}`,
      );
    }

    return Object.freeze({
      destinationPath,

      bytes:
        afterVerification.bytes,

      sha256:
        afterVerification.sha256,

      contentType:
        providerCopy.contentType,
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

export async function recoverVeoOutput(
  generatedVideo:
    GeneratedVideo,

  destinationPath:
    string,

  downloadFile:
    VeoSdkFileDownloader,

  maxBytes:
    number =
      VEO_MAX_OUTPUT_BYTES,
): Promise<PersistedVeoOutput> {
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
      generatedVideo,
      destinationPath,
      downloadFile,
      maxBytes,
    );
  }

  try {
    return await persistVeoGeneratedVideo(
      generatedVideo,
      destinationPath,
      downloadFile,
      maxBytes,
    );
  } catch (error) {
    if (
      !(
        error instanceof
          VeoOutputAlreadyExistsError
      )
    ) {
      throw error;
    }
  }

  return verifyAndReuseExistingOutput(
    generatedVideo,
    destinationPath,
    downloadFile,
    maxBytes,
  );
}
