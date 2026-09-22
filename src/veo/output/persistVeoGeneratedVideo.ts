import type {
  DownloadFileParameters,
  GeneratedVideo,
} from "@google/genai";

import {
  createHash,
  randomUUID,
} from "node:crypto";

import {
  constants,
  createReadStream,
} from "node:fs";

import {
  copyFile,
  mkdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
  isAbsolute,
} from "node:path";

export const VEO_MAX_OUTPUT_BYTES =
  500_000_000;

export type VeoSdkFileDownloader =
  (
    params:
      DownloadFileParameters,
  ) =>
    Promise<void>;

export type PersistedVeoOutput =
  Readonly<{
    destinationPath:
      string;

    bytes:
      number;

    sha256:
      string;

    contentType:
      string | null;
  }>;

async function inspectAndHashFile(
  filePath:
    string,

  maxBytes:
    number,
): Promise<
  Readonly<{
    bytes:
      number;

    sha256:
      string;
  }>
> {
  const metadata =
    await stat(
      filePath,
    );

  if (
    !metadata.isFile()
  ) {
    throw new Error(
      "Veo output did not produce a regular file.",
    );
  }

  if (
    metadata.size <= 0
  ) {
    throw new Error(
      "Veo output file is empty.",
    );
  }

  if (
    metadata.size >
    maxBytes
  ) {
    throw new Error(
      `Veo output exceeds the ${maxBytes}-byte local limit.`,
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
        `Veo output exceeded the ${maxBytes}-byte local limit while hashing.`,
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
      "Veo output file contained no data.",
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

export async function persistVeoGeneratedVideo(
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
  if (
    !isAbsolute(
      destinationPath,
    )
  ) {
    throw new Error(
      "Veo output destination must be absolute.",
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

  const video =
    generatedVideo.video;

  if (!video) {
    throw new Error(
      "Veo generated output contains no video payload.",
    );
  }

  if (
    video.mimeType &&
    video.mimeType !==
      "video/mp4"
  ) {
    throw new Error(
      `Unsupported Veo output MIME type: ${video.mimeType}`,
    );
  }

  if (
    !video.uri &&
    !video.videoBytes
  ) {
    throw new Error(
      "Veo generated video contains neither URI nor video bytes.",
    );
  }

  await mkdir(
    dirname(
      destinationPath,
    ),
    {
      recursive: true,
    },
  );

  const temporaryPath =
    `${destinationPath}.part-${process.pid}-${randomUUID()}`;

  let temporaryCreated =
    false;

  try {
    if (
      video.videoBytes
    ) {
      const decoded =
        Buffer.from(
          video.videoBytes,
          "base64",
        );

      if (
        decoded.length <= 0
      ) {
        throw new Error(
          "Veo returned empty base64 video data.",
        );
      }

      if (
        decoded.length >
        maxBytes
      ) {
        throw new Error(
          `Veo output exceeds the ${maxBytes}-byte local limit.`,
        );
      }

      await writeFile(
        temporaryPath,
        decoded,
        {
          flag:
            "wx",
        },
      );

      temporaryCreated =
        true;
    } else {
      await downloadFile({
        file:
          generatedVideo,

        downloadPath:
          temporaryPath,
      });

      temporaryCreated =
        true;
    }

    const inspected =
      await inspectAndHashFile(
        temporaryPath,
        maxBytes,
      );

    try {
      await copyFile(
        temporaryPath,
        destinationPath,
        constants.COPYFILE_EXCL,
      );
    } catch (error) {
      const code =
        (
          error as
            NodeJS.ErrnoException
        ).code;

      if (
        code ===
        "EEXIST"
      ) {
        throw new Error(
          `Veo output already exists: ${destinationPath}`,
        );
      }

      throw error;
    }

    await unlink(
      temporaryPath,
    );

    temporaryCreated =
      false;

    return Object.freeze({
      destinationPath,

      bytes:
        inspected.bytes,

      sha256:
        inspected.sha256,

      contentType:
        video.mimeType ??
        null,
    });
  } finally {
    if (
      temporaryCreated
    ) {
      try {
        await unlink(
          temporaryPath,
        );
      } catch {
        // Preserve the original failure.
      }
    }
  }
}
