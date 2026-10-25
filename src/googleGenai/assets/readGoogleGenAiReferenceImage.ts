import {
  constants as fsConstants,
} from "node:fs";

import {
  lstat,
  open,
  realpath,
} from "node:fs/promises";

import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

/**
 * Google-specific secure reference-image reader.
 *
 * Threat model: TRUSTED_OPERATOR_CONTROLLED_MEDIA_ROOT_NO_HOSTILE_CONCURRENT_
 * NAMESPACE_MUTATOR. This is strong defence in depth for the operator-only
 * media root; it does NOT claim to defeat a hostile same-privilege process
 * that keeps toggling junctions between separate path operations. Node
 * exposes no handle-to-path primitive on win32, so binding is re-proven by
 * repeated path checks against the open handle's identity instead.
 *
 * Order (fail closed at every step, all before any provider create):
 *  A/B initial canonical reference root = realpath(<mediaRoot>/references)
 *  C/D candidate: lexical containment, realpath, segment-aware containment
 *      in the initial root
 *  E   lstat every path component (canonical path from the initial root and
 *      lexical path from the configured root): no link/junction anywhere,
 *      directories in between, a regular file at the end
 *  F   capture the path-side identity (dev, ino) and require nlink == 1
 *  G   open the validated CANONICAL path read-only (O_NOFOLLOW where defined)
 *  H-L FileHandle.stat: regular file, 0 < size <= maxBytes, nlink == 1,
 *      identity equal to the pre-open path identity
 *  M-S post-open revalidation: root still canonicalises to the initial root,
 *      component walks still link-free, candidate still canonicalises to the
 *      same path inside the initial root, path identity equals the handle
 *  T-V bounded read with growth / shrink / size-change detection
 *  W   magic bytes must agree with the extension-derived MIME
 *  X   post-read revalidation (as M-S) before any byte leaves the reader
 * The caller base64-encodes only the returned, fully validated bytes.
 *
 * The shared referenceImagePath.ts helper (Runway/Veo) is not changed;
 * the Google adapter still applies it first as a lexical guard.
 */

export const GOOGLE_GENAI_REFERENCE_IMAGE_MIME_TYPES =
  Object.freeze([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/heic",
    "image/heif",
    "image/gif",
    "image/bmp",
    "image/tiff",
  ] as const);

export type GoogleGenAiReferenceImageMimeType =
  typeof GOOGLE_GENAI_REFERENCE_IMAGE_MIME_TYPES[number];

export const GOOGLE_GENAI_REFERENCE_IMAGE_REJECTION_CODES =
  Object.freeze([
    "INVALID_LIMIT",
    "UNREADABLE",
    "PATH_ESCAPE",
    "ROOT_CHANGED",
    "PATH_CHANGED",
    "LINK_NOT_ALLOWED",
    "NOT_REGULAR_FILE",
    "HARD_LINK_NOT_ALLOWED",
    "FILE_IDENTITY_CHANGED",
    "EMPTY",
    "TOO_LARGE",
    "READ_INCONSISTENT",
    "UNSUPPORTED_SIGNATURE",
    "SIGNATURE_MIME_MISMATCH",
  ] as const);

export type GoogleGenAiReferenceImageRejectionCode =
  typeof GOOGLE_GENAI_REFERENCE_IMAGE_REJECTION_CODES[number];

export class GoogleGenAiReferenceImageRejectedError extends Error {
  readonly code:
    GoogleGenAiReferenceImageRejectionCode;

  constructor(
    code:
      GoogleGenAiReferenceImageRejectionCode,
    message:
      string,
    options?:
      ErrorOptions,
  ) {
    super(
      `Google GenAI reference image rejected (${code}): ${message}`,
      options,
    );

    this.name =
      "GoogleGenAiReferenceImageRejectedError";

    this.code =
      code;
  }
}

export type GoogleGenAiReferenceImageStats =
  Readonly<{
    isFile:
      () =>
        boolean;

    isSymbolicLink:
      () =>
        boolean;

    isDirectory:
      () =>
        boolean;

    size:
      bigint;

    dev:
      bigint;

    ino:
      bigint;

    nlink:
      bigint;
  }>;

export type GoogleGenAiReferenceImageFileHandle =
  Readonly<{
    stat:
      () =>
        Promise<GoogleGenAiReferenceImageStats>;

    read:
      (
        buffer:
          Uint8Array,
        offset:
          number,
        length:
          number,
        position:
          number,
      ) =>
        Promise<
          Readonly<{
            bytesRead:
              number;
          }>
        >;

    close:
      () =>
        Promise<void>;
  }>;

export type GoogleGenAiReferenceImageFileSystem =
  Readonly<{
    realpath:
      (
        path:
          string,
      ) =>
        Promise<string>;

    lstat:
      (
        path:
          string,
      ) =>
        Promise<GoogleGenAiReferenceImageStats>;

    open:
      (
        path:
          string,
        flags:
          number,
      ) =>
        Promise<GoogleGenAiReferenceImageFileHandle>;
  }>;

export const NODE_GOOGLE_GENAI_REFERENCE_IMAGE_FILE_SYSTEM:
  GoogleGenAiReferenceImageFileSystem =
  Object.freeze({
    realpath:
      (path) =>
        realpath(
          path,
        ),

    lstat:
      (path) =>
        lstat(
          path,
          {
            bigint:
              true,
          },
        ),

    open:
      async (
        path,
        flags,
      ) => {
        const handle =
          await open(
            path,
            flags,
          );

        return Object.freeze({
          stat:
            () =>
              handle.stat({
                bigint:
                  true,
              }),

          read:
            (
              buffer,
              offset,
              length,
              position,
            ) =>
              handle.read(
                buffer,
                offset,
                length,
                position,
              ),

          close:
            () =>
              handle.close(),
        });
      },
  });

const OPEN_FLAGS =
  fsConstants.O_RDONLY |
  (
    fsConstants.O_NOFOLLOW ??
    0
  );

export type GoogleGenAiReferenceImageReadInput =
  Readonly<{
    mediaRoot:
      string;

    sourceImagePath:
      string;

    expectedMimeType:
      GoogleGenAiReferenceImageMimeType;

    maxBytes:
      number;

    fileSystem?:
      GoogleGenAiReferenceImageFileSystem;
  }>;

export type GoogleGenAiReferenceImage =
  Readonly<{
    canonicalPath:
      string;

    mimeType:
      GoogleGenAiReferenceImageMimeType;

    byteLength:
      number;

    bytes:
      Buffer;
  }>;

function startsWithBytes(
  bytes:
    Uint8Array,
  signature:
    readonly number[],
  offset =
    0,
): boolean {
  if (
    bytes.length <
    offset + signature.length
  ) {
    return false;
  }

  return signature.every(
    (value, index) =>
      bytes[offset + index] ===
      value,
  );
}

function ascii(
  bytes:
    Uint8Array,
  start:
    number,
  end:
    number,
): string {
  return Buffer.from(
    bytes.subarray(
      start,
      end,
    ),
  ).toString(
    "latin1",
  );
}

const HEIC_BRANDS =
  new Set([
    "heic",
    "heix",
    "hevc",
    "hevx",
    "heim",
    "heis",
  ]);

const HEIF_BRANDS =
  new Set([
    "mif1",
    "msf1",
    "heif",
  ]);

function detectHeifFamily(
  bytes:
    Uint8Array,
): GoogleGenAiReferenceImageMimeType[] {
  if (
    bytes.length < 16 ||
    ascii(
      bytes,
      4,
      8,
    ) !==
      "ftyp"
  ) {
    return [];
  }

  const boxSize =
    Buffer.from(
      bytes.subarray(
        0,
        4,
      ),
    ).readUInt32BE(
      0,
    );

  if (
    boxSize < 16 ||
    boxSize > bytes.length ||
    boxSize % 4 !== 0
  ) {
    return [];
  }

  const brands =
    [
      ascii(
        bytes,
        8,
        12,
      ),
    ];

  for (
    let offset = 16;
    offset + 4 <= boxSize;
    offset += 4
  ) {
    brands.push(
      ascii(
        bytes,
        offset,
        offset + 4,
      ),
    );
  }

  const detected:
    GoogleGenAiReferenceImageMimeType[] = [];

  if (
    brands.some(
      (brand) =>
        HEIC_BRANDS.has(
          brand,
        ),
    )
  ) {
    detected.push(
      "image/heic",
    );
  }

  if (
    brands.some(
      (brand) =>
        HEIF_BRANDS.has(
          brand,
        ),
    )
  ) {
    detected.push(
      "image/heif",
    );
  }

  return detected;
}

/**
 * Returns every supported MIME type whose signature the bytes carry.
 * An empty result means the bytes are not a supported image.
 */
export function detectGoogleGenAiReferenceImageMimeTypes(
  bytes:
    Uint8Array,
): readonly GoogleGenAiReferenceImageMimeType[] {
  if (
    startsWithBytes(
      bytes,
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    )
  ) {
    return ["image/png"];
  }

  if (
    startsWithBytes(
      bytes,
      [0xff, 0xd8, 0xff],
    )
  ) {
    return ["image/jpeg"];
  }

  if (
    bytes.length >= 12 &&
    ascii(
      bytes,
      0,
      4,
    ) ===
      "RIFF" &&
    ascii(
      bytes,
      8,
      12,
    ) ===
      "WEBP"
  ) {
    return ["image/webp"];
  }

  if (
    bytes.length >= 6 &&
    (
      ascii(
        bytes,
        0,
        6,
      ) ===
        "GIF87a" ||
      ascii(
        bytes,
        0,
        6,
      ) ===
        "GIF89a"
    )
  ) {
    return ["image/gif"];
  }

  if (
    bytes.length >= 26 &&
    startsWithBytes(
      bytes,
      [0x42, 0x4d],
    )
  ) {
    return ["image/bmp"];
  }

  if (
    startsWithBytes(
      bytes,
      [0x49, 0x49, 0x2a, 0x00],
    ) ||
    startsWithBytes(
      bytes,
      [0x4d, 0x4d, 0x00, 0x2a],
    )
  ) {
    return ["image/tiff"];
  }

  return detectHeifFamily(
    bytes,
  );
}

function isInside(
  root:
    string,
  candidate:
    string,
): boolean {
  const relativePath =
    relative(
      root,
      candidate,
    );

  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(
      `..${sep}`,
    ) &&
    !isAbsolute(
      relativePath,
    )
  );
}

async function readExactly(
  handle:
    GoogleGenAiReferenceImageFileHandle,
  size:
    number,
): Promise<Buffer> {
  const bytes =
    Buffer.alloc(
      size,
    );

  let filled =
    0;

  while (filled < size) {
    const {
      bytesRead,
    } =
      await handle.read(
        bytes,
        filled,
        size - filled,
        filled,
      );

    if (
      !Number.isSafeInteger(
        bytesRead,
      ) ||
      bytesRead <= 0 ||
      bytesRead > size - filled
    ) {
      throw new GoogleGenAiReferenceImageRejectedError(
        "READ_INCONSISTENT",
        `file ended or misreported after ${filled} of ${size} validated bytes.`,
      );
    }

    filled +=
      bytesRead;
  }

  const probe =
    Buffer.alloc(
      1,
    );

  const {
    bytesRead: extra,
  } =
    await handle.read(
      probe,
      0,
      1,
      size,
    );

  if (extra !== 0) {
    throw new GoogleGenAiReferenceImageRejectedError(
      "READ_INCONSISTENT",
      `file grew beyond its validated size of ${size} bytes during the read.`,
    );
  }

  return bytes;
}

type ValidatedPathState =
  Readonly<{
    canonicalRoot:
      string;

    canonicalPath:
      string;

    fileStats:
      GoogleGenAiReferenceImageStats;
  }>;

async function canonicalise(
  fileSystem:
    GoogleGenAiReferenceImageFileSystem,
  path:
    string,
  stage:
    string,
): Promise<string> {
  try {
    return await fileSystem.realpath(
      path,
    );
  } catch (error) {
    throw new GoogleGenAiReferenceImageRejectedError(
      "UNREADABLE",
      `the reference root or image path could not be resolved (${stage}).`,
      {
        cause:
          error,
      },
    );
  }
}

/**
 * lstat every component strictly below `base` down to `target`: none may be
 * a symbolic link / junction, every intermediate one must be a directory,
 * and the final one must be a regular file whose link count is exactly 1.
 * Returns the final component's stats (the path-side identity).
 */
async function walkComponents(
  fileSystem:
    GoogleGenAiReferenceImageFileSystem,
  base:
    string,
  target:
    string,
  stage:
    string,
): Promise<GoogleGenAiReferenceImageStats> {
  const segments =
    relative(
      base,
      target,
    )
      .split(
        sep,
      );

  let current =
    base;

  let finalStats:
    GoogleGenAiReferenceImageStats | undefined;

  for (
    const [
      index,
      segment,
    ] of segments.entries()
  ) {
    current =
      join(
        current,
        segment,
      );

    let stats:
      GoogleGenAiReferenceImageStats;

    try {
      stats =
        await fileSystem.lstat(
          current,
        );
    } catch (error) {
      throw new GoogleGenAiReferenceImageRejectedError(
        "UNREADABLE",
        `a reference path component could not be inspected (${stage}).`,
        {
          cause:
            error,
        },
      );
    }

    if (
      stats.isSymbolicLink()
    ) {
      throw new GoogleGenAiReferenceImageRejectedError(
        "LINK_NOT_ALLOWED",
        `a reference path component is a symbolic or reparse link (${stage}).`,
      );
    }

    const isFinal =
      index ===
      segments.length - 1;

    if (
      isFinal
        ? !stats.isFile()
        : !stats.isDirectory()
    ) {
      throw new GoogleGenAiReferenceImageRejectedError(
        "NOT_REGULAR_FILE",
        isFinal
          ? `the image path is not a regular file (${stage}).`
          : `a reference path component is not a directory (${stage}).`,
      );
    }

    if (isFinal) {
      finalStats =
        stats;
    }
  }

  if (finalStats === undefined) {
    throw new GoogleGenAiReferenceImageRejectedError(
      "PATH_ESCAPE",
      `the image path does not name a file below the references root (${stage}).`,
    );
  }

  requireSingleLink(
    finalStats,
    stage,
  );

  return finalStats;
}

function requireSingleLink(
  stats:
    GoogleGenAiReferenceImageStats,
  stage:
    string,
): void {
  if (
    stats.nlink !==
    1n
  ) {
    throw new GoogleGenAiReferenceImageRejectedError(
      "HARD_LINK_NOT_ALLOWED",
      `the image has ${stats.nlink} hard links; exactly one is required (${stage}).`,
    );
  }
}

function sameFile(
  left:
    GoogleGenAiReferenceImageStats,
  right:
    GoogleGenAiReferenceImageStats,
): boolean {
  return (
    left.isFile() &&
    right.isFile() &&
    left.dev ===
      right.dev &&
    left.ino ===
      right.ino
  );
}

/**
 * Resolves and inspects the candidate from scratch and proves it is still
 * the contained, link-free, single-link file `expected` describes.
 */
async function resolveValidatedPath(
  fileSystem:
    GoogleGenAiReferenceImageFileSystem,
  lexicalRoot:
    string,
  candidate:
    string,
  initialRoot:
    string | undefined,
  stage:
    string,
): Promise<ValidatedPathState> {
  const canonicalRoot =
    await canonicalise(
      fileSystem,
      lexicalRoot,
      stage,
    );

  if (
    initialRoot !== undefined &&
    canonicalRoot !==
      initialRoot
  ) {
    throw new GoogleGenAiReferenceImageRejectedError(
      "ROOT_CHANGED",
      `the references root no longer canonicalises to the validated root (${stage}).`,
    );
  }

  const canonicalPath =
    await canonicalise(
      fileSystem,
      candidate,
      stage,
    );

  if (
    !isInside(
      canonicalRoot,
      canonicalPath,
    )
  ) {
    throw new GoogleGenAiReferenceImageRejectedError(
      "PATH_ESCAPE",
      `the image does not resolve inside the canonical references root (${stage}).`,
    );
  }

  const fileStats =
    await walkComponents(
      fileSystem,
      canonicalRoot,
      canonicalPath,
      stage,
    );

  const lexicalStats =
    await walkComponents(
      fileSystem,
      lexicalRoot,
      candidate,
      stage,
    );

  if (
    !sameFile(
      fileStats,
      lexicalStats,
    )
  ) {
    throw new GoogleGenAiReferenceImageRejectedError(
      "FILE_IDENTITY_CHANGED",
      `the canonical and requested image paths name different files (${stage}).`,
    );
  }

  return Object.freeze({
    canonicalRoot,
    canonicalPath,
    fileStats,
  });
}

async function revalidateBinding(
  fileSystem:
    GoogleGenAiReferenceImageFileSystem,
  lexicalRoot:
    string,
  candidate:
    string,
  validated:
    ValidatedPathState,
  handleStats:
    GoogleGenAiReferenceImageStats,
  stage:
    string,
): Promise<void> {
  const current =
    await resolveValidatedPath(
      fileSystem,
      lexicalRoot,
      candidate,
      validated.canonicalRoot,
      stage,
    );

  if (
    current.canonicalPath !==
    validated.canonicalPath
  ) {
    throw new GoogleGenAiReferenceImageRejectedError(
      "PATH_CHANGED",
      `the image path no longer canonicalises to the validated path (${stage}).`,
    );
  }

  if (
    !sameFile(
      current.fileStats,
      handleStats,
    )
  ) {
    throw new GoogleGenAiReferenceImageRejectedError(
      "FILE_IDENTITY_CHANGED",
      `the image path no longer names the opened file (${stage}).`,
    );
  }
}

export async function readGoogleGenAiReferenceImage(
  input:
    GoogleGenAiReferenceImageReadInput,
): Promise<GoogleGenAiReferenceImage> {
  const fileSystem =
    input.fileSystem ??
    NODE_GOOGLE_GENAI_REFERENCE_IMAGE_FILE_SYSTEM;

  const maxBytes =
    input.maxBytes;

  if (
    !Number.isSafeInteger(
      maxBytes,
    ) ||
    maxBytes <= 0
  ) {
    throw new GoogleGenAiReferenceImageRejectedError(
      "INVALID_LIMIT",
      "the maximum reference-image size must be a positive safe integer.",
    );
  }

  if (
    !GOOGLE_GENAI_REFERENCE_IMAGE_MIME_TYPES.includes(
      input.expectedMimeType,
    )
  ) {
    throw new GoogleGenAiReferenceImageRejectedError(
      "SIGNATURE_MIME_MISMATCH",
      `expected MIME type ${JSON.stringify(input.expectedMimeType)} is not supported.`,
    );
  }

  const lexicalRoot =
    resolve(
      input.mediaRoot.trim(),
      "references",
    );

  const candidate =
    resolve(
      input.sourceImagePath.trim(),
    );

  if (
    !isInside(
      lexicalRoot,
      candidate,
    )
  ) {
    throw new GoogleGenAiReferenceImageRejectedError(
      "PATH_ESCAPE",
      "the image path is not below the configured references root.",
    );
  }

  // A-F: initial canonical root, containment, component walks, identity.
  const validated =
    await resolveValidatedPath(
      fileSystem,
      lexicalRoot,
      candidate,
      undefined,
      "pre-open",
    );

  // G: open exactly the validated canonical path.
  const handle =
    await fileSystem.open(
      validated.canonicalPath,
      OPEN_FLAGS,
    );

  try {
    // H-L: the open handle itself.
    const openStats =
      await handle.stat();

    if (
      !openStats.isFile()
    ) {
      throw new GoogleGenAiReferenceImageRejectedError(
        "NOT_REGULAR_FILE",
        "the opened image is not a regular file.",
      );
    }

    if (
      openStats.size <=
      0n
    ) {
      throw new GoogleGenAiReferenceImageRejectedError(
        "EMPTY",
        "the image file is empty.",
      );
    }

    if (
      openStats.size >
      BigInt(
        maxBytes,
      )
    ) {
      throw new GoogleGenAiReferenceImageRejectedError(
        "TOO_LARGE",
        `the image is ${openStats.size} bytes, above the ${maxBytes}-byte limit.`,
      );
    }

    requireSingleLink(
      openStats,
      "open handle",
    );

    if (
      !sameFile(
        openStats,
        validated.fileStats,
      )
    ) {
      throw new GoogleGenAiReferenceImageRejectedError(
        "FILE_IDENTITY_CHANGED",
        "the opened file is not the file that was validated.",
      );
    }

    // M-S: the path must still name the opened file inside the same root.
    await revalidateBinding(
      fileSystem,
      lexicalRoot,
      candidate,
      validated,
      openStats,
      "post-open",
    );

    // T-V: bounded read.
    const size =
      Number(
        openStats.size,
      );

    const bytes =
      await readExactly(
        handle,
        size,
      );

    const finalStats =
      await handle.stat();

    if (
      finalStats.size !==
        openStats.size ||
      !sameFile(
        finalStats,
        openStats,
      )
    ) {
      throw new GoogleGenAiReferenceImageRejectedError(
        "READ_INCONSISTENT",
        "the image size or identity changed during the read.",
      );
    }

    // W: content type.
    const detected =
      detectGoogleGenAiReferenceImageMimeTypes(
        bytes,
      );

    if (
      detected.length === 0
    ) {
      throw new GoogleGenAiReferenceImageRejectedError(
        "UNSUPPORTED_SIGNATURE",
        "the file content is not a supported image format.",
      );
    }

    if (
      !detected.includes(
        input.expectedMimeType,
      )
    ) {
      throw new GoogleGenAiReferenceImageRejectedError(
        "SIGNATURE_MIME_MISMATCH",
        `the file content (${detected.join(", ")}) does not match ${input.expectedMimeType}.`,
      );
    }

    // X: bytes stay inside the reader until the binding is proven again.
    await revalidateBinding(
      fileSystem,
      lexicalRoot,
      candidate,
      validated,
      finalStats,
      "post-read",
    );

    return Object.freeze({
      canonicalPath:
        validated.canonicalPath,

      mimeType:
        input.expectedMimeType,

      byteLength:
        size,

      bytes,
    });
  } finally {
    await handle.close();
  }
}
