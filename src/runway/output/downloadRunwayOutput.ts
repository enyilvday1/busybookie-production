import {
  createHash,
  randomUUID,
} from "node:crypto";

import {
  constants,
  createWriteStream,
} from "node:fs";

import {
  copyFile,
  mkdir,
  unlink,
} from "node:fs/promises";

import {
  dirname,
  isAbsolute,
} from "node:path";

import {
  Readable,
  Transform,
} from "node:stream";

import {
  pipeline,
} from "node:stream/promises";

import type {
  ReadableStream as NodeReadableStream,
} from "node:stream/web";

export const RUNWAY_MAX_OUTPUT_BYTES =
  500_000_000;

export type RunwayFetch =
  (
    input: string,
    init?: RequestInit,
  ) => Promise<Response>;

export type DownloadedRunwayOutput =
  Readonly<{
    destinationPath: string;
    bytes: number;
    sha256: string;
    contentType: string | null;
  }>;

function assertHttpsUrl(
  value: string,
): void {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      "Runway output download URL is invalid.",
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      "Runway output download URL must use HTTPS.",
    );
  }
}

export async function downloadRunwayOutput(
  sourceUrl: string,
  destinationPath: string,
  fetchImpl: RunwayFetch = fetch,
  maxBytes:
    number =
      RUNWAY_MAX_OUTPUT_BYTES,
): Promise<DownloadedRunwayOutput> {
  assertHttpsUrl(
    sourceUrl,
  );

  if (!isAbsolute(destinationPath)) {
    throw new Error(
      "Runway output destination must be an absolute path.",
    );
  }

  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0
  ) {
    throw new Error(
      "Runway maximum output size must be a positive safe integer.",
    );
  }

  await mkdir(
    dirname(destinationPath),
    {
      recursive: true,
    },
  );

  const temporaryPath =
    `${destinationPath}.part-${process.pid}-${randomUUID()}`;

  let temporaryCreated =
    false;

  try {
    const response =
      await fetchImpl(
        sourceUrl,
        {
          redirect: "follow",
        },
      );

    if (!response.ok) {
      throw new Error(
        `Runway output download failed with HTTP ${response.status}.`,
      );
    }

    if (response.url) {
      assertHttpsUrl(
        response.url,
      );
    }

    const contentLength =
      response.headers.get(
        "content-length",
      );

    if (contentLength) {
      const declaredBytes =
        Number(
          contentLength,
        );

      if (
        Number.isFinite(
          declaredBytes,
        ) &&
        declaredBytes >
          maxBytes
      ) {
        throw new Error(
          `Runway output exceeds the ${maxBytes}-byte download limit.`,
        );
      }
    }

    if (!response.body) {
      throw new Error(
        "Runway output response contained no body.",
      );
    }

    const hash =
      createHash(
        "sha256",
      );

    let downloadedBytes =
      0;

    const meter =
      new Transform({
        transform(
          chunk:
            Buffer,
          _encoding,
          callback,
        ) {
          downloadedBytes +=
            chunk.length;

          if (
            downloadedBytes >
            maxBytes
          ) {
            callback(
              new Error(
                `Runway output exceeded the ${maxBytes}-byte download limit while streaming.`,
              ),
            );

            return;
          }

          hash.update(
            chunk,
          );

          callback(
            null,
            chunk,
          );
        },
      });

    const source =
      Readable.fromWeb(
        response.body as unknown as
          NodeReadableStream<Uint8Array>,
      );

    const destination =
      createWriteStream(
        temporaryPath,
        {
          flags: "wx",
        },
      );

    temporaryCreated =
      true;

    await pipeline(
      source,
      meter,
      destination,
    );

    await copyFile(
      temporaryPath,
      destinationPath,
      constants.COPYFILE_EXCL,
    );

    await unlink(
      temporaryPath,
    );

    temporaryCreated =
      false;

    return Object.freeze({
      destinationPath,
      bytes:
        downloadedBytes,
      sha256:
        hash.digest(
          "hex",
        ),
      contentType:
        response.headers.get(
          "content-type",
        ),
    });
  } finally {
    if (temporaryCreated) {
      try {
        await unlink(
          temporaryPath,
        );
      } catch {
        // Preserve the original error.
      }
    }
  }
}
