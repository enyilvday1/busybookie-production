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

export const DIALOGUE_MAX_AUDIO_OUTPUT_BYTES =
  25_000_000;

export type DialogueAudioFetch =
  (
    input:
      string,

    init?:
      RequestInit,
  ) =>
    Promise<Response>;

export type DownloadedDialogueAudioOutput =
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

async function* readResponseBody(
  body:
    ReadableStream<Uint8Array>,
): AsyncGenerator<
  Uint8Array,
  void,
  undefined
> {
  const reader =
    body.getReader();

  let completed =
    false;

  try {
    while (true) {
      const result =
        await reader.read();

      if (
        result.done
      ) {
        completed =
          true;

        return;
      }

      yield result.value;
    }
  } finally {
    if (!completed) {
      try {
        await reader.cancel();
      } catch {
        // Best-effort transport cleanup.
      }
    }

    reader.releaseLock();
  }
}

function assertHttpsUrl(
  value:
    string,
): void {
  let parsed:
    URL;

  try {
    parsed =
      new URL(
        value,
      );
  } catch {
    throw new Error(
      "Dialogue audio output download URL is invalid.",
    );
  }

  if (
    parsed.protocol !==
    "https:"
  ) {
    throw new Error(
      "Dialogue audio output download URL must use HTTPS.",
    );
  }
}

export async function downloadDialogueAudioOutput(
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
  assertHttpsUrl(
    sourceUrl,
  );

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

  await mkdir(
    dirname(
      destinationPath,
    ),
    {
      recursive:
        true,
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
          redirect:
            "follow",
        },
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `Dialogue audio output download failed with HTTP ${response.status}.`,
      );
    }

    if (
      response.url
    ) {
      assertHttpsUrl(
        response.url,
      );
    }

    const contentLength =
      response.headers.get(
        "content-length",
      );

    if (
      contentLength
    ) {
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
          `Dialogue audio output exceeds the ${maxBytes}-byte download limit.`,
        );
      }
    }

    if (
      !response.body
    ) {
      throw new Error(
        "Dialogue audio output response contained no body.",
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
                `Dialogue audio output exceeded the ${maxBytes}-byte download limit while streaming.`,
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
        Readable.from(
          readResponseBody(
            response.body,
          ),
          {
            objectMode:
              false,
          },
        );

    const destination =
      createWriteStream(
        temporaryPath,
        {
          flags:
            "wx",
        },
      );

    temporaryCreated =
      true;

    await pipeline(
      source,
      meter,
      destination,
    );

    if (
      downloadedBytes <=
      0
    ) {
      throw new Error(
        "Dialogue audio output contained no data.",
      );
    }

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
    if (
      temporaryCreated
    ) {
      try {
        await unlink(
          temporaryPath,
        );
      } catch {
        /*
         * Preserve the primary download,
         * validation, or promotion error.
         */
      }
    }
  }
}
