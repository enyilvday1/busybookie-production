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
  DIALOGUE_MAX_AUDIO_OUTPUT_BYTES,
  downloadDialogueAudioOutput,
  type DialogueAudioFetch,
  type DownloadedDialogueAudioOutput,
} from "./downloadDialogueAudioOutput.js";

export type InspectedDialogueAudioOutput =
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
      "Dialogue audio output destination must be an absolute path.",
    );
  }

  if (
    !Number.isSafeInteger(
      maxBytes,
    ) ||
    maxBytes <=
      0
  ) {
    throw new Error(
      "Dialogue maximum audio output size must be a positive safe integer.",
    );
  }
}

async function inspectAndHashExistingDialogueAudioOutput(
  filePath:
    string,

  maxBytes:
    number,
): Promise<
  InspectedDialogueAudioOutput
> {
  const metadata =
    await lstat(
      filePath,
    );

  if (
    !metadata.isFile()
  ) {
    throw new Error(
      `Existing dialogue audio output is not a regular file: ${filePath}`,
    );
  }

  if (
    metadata.size <=
    0
  ) {
    throw new Error(
      `Existing dialogue audio output is empty: ${filePath}`,
    );
  }

  if (
    metadata.size >
    maxBytes
  ) {
    throw new Error(
      `Existing dialogue audio output exceeds the ${maxBytes}-byte local limit: ${filePath}`,
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
        `Existing dialogue audio output exceeded the ${maxBytes}-byte local limit while hashing: ${filePath}`,
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
      `Existing dialogue audio output contained no data: ${filePath}`,
    );
  }

  if (
    bytes !==
    metadata.size
  ) {
    throw new Error(
      `Existing dialogue audio output changed while being inspected: ${filePath}`,
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

export async function inspectDialogueAudioOutput(
  filePath:
    string,

  maxBytes:
    number =
      DIALOGUE_MAX_AUDIO_OUTPUT_BYTES,
): Promise<
  InspectedDialogueAudioOutput
> {
  validateRecoveryArguments(
    filePath,
    maxBytes,
  );

  return inspectAndHashExistingDialogueAudioOutput(
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
  } catch (
    error
  ) {
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
    DialogueAudioFetch,

  maxBytes:
    number,
): Promise<
  DownloadedDialogueAudioOutput
> {
  const existing =
    await inspectAndHashExistingDialogueAudioOutput(
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
      await downloadDialogueAudioOutput(
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
        `Existing dialogue audio output does not match the provider output: ${destinationPath}`,
      );
    }

    const afterVerification =
      await inspectAndHashExistingDialogueAudioOutput(
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
        `Existing dialogue audio output changed during provider verification: ${destinationPath}`,
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
  } catch (
    error
  ) {
    primaryError =
      error;

    throw error;
  } finally {
    try {
      await unlink(
        verificationPath,
      );
    } catch (
      error
    ) {
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

export async function recoverDialogueAudioOutput(
  sourceUrl:
    string,

  destinationPath:
    string,

  fetchImpl:
    DialogueAudioFetch =
      fetch,

  maxBytes:
    number =
      DIALOGUE_MAX_AUDIO_OUTPUT_BYTES,
): Promise<
  DownloadedDialogueAudioOutput
> {
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
    return await downloadDialogueAudioOutput(
      sourceUrl,
      destinationPath,
      fetchImpl,
      maxBytes,
    );
  } catch (
    error
  ) {
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

  /*
   * Another writer won the exclusive promotion race.
   * Never adopt its artifact blindly. Verify it against
   * a fresh provider copy before treating it as durable.
   */
  return verifyAndReuseExistingOutput(
    sourceUrl,
    destinationPath,
    fetchImpl,
    maxBytes,
  );
}
