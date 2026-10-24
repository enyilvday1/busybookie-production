import {
  createHash,
  randomUUID,
} from "node:crypto";

import {
  link,
  lstat,
  mkdir,
  open,
  unlink,
} from "node:fs/promises";

import {
  basename,
  dirname,
  join,
} from "node:path";

import {
  GOOGLE_GENAI_PROVIDER,
} from "../../googleGenai/googleGenAi.types.js";

import {
  classifyGoogleGenAiInteractionStatus,
  normalizeGoogleGenAiProviderExecutionId,
} from "../../googleGenai/googleGenAiInteractionContract.js";

import {
  GOOGLE_GENAI_VIDEO_OUTPUT_INDEX,
  createGoogleGenAiVideoOutputPath,
} from "../../googleGenai/output/googleGenAiVideoOutputPath.js";

import {
  readExecutionSubmission,
} from "../readExecutionSubmission.js";

/**
 * Dormant Google GenAI single-shot output materialization.
 *
 * Reads the durable execution submission, retrieves exactly that Google
 * Interaction once, accepts only a completed interaction carrying a single
 * video/mp4 output, bounds and validates the bytes, and publishes them to
 * the Google output path without ever replacing an existing file. The
 * final file is published with an exclusive hard link from a fully written
 * and fsynced temporary file; there is no rename, copy, or direct-write
 * path. It never creates, resubmits, retries, completes, reconciles, or
 * mutates the reservation or submission.
 */

export const GOOGLE_GENAI_OUTPUT_VIDEO_MIME_TYPE =
  "video/mp4" as const;

export type GoogleGenAiRetrievedOutputInteraction =
  Readonly<{
    id:
      unknown;

    status:
      unknown;

    outputVideo:
      unknown;
  }>;

export type GoogleGenAiOutputRetriever =
  (
    providerExecutionId:
      string,
  ) =>
    Promise<
      GoogleGenAiRetrievedOutputInteraction
    >;

export type GoogleGenAiOutputUriDownloadRequest =
  Readonly<{
    uri:
      string;

    maxOutputBytes:
      number;
  }>;

export type GoogleGenAiOutputUriDownloader =
  (
    request:
      GoogleGenAiOutputUriDownloadRequest,
  ) =>
    Promise<Uint8Array>;

export type GoogleGenAiOutputFileHandle =
  Readonly<{
    writeFile:
      (
        data:
          Uint8Array,
      ) =>
        Promise<void>;

    sync:
      () =>
        Promise<void>;

    close:
      () =>
        Promise<void>;

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
  }>;

export type GoogleGenAiOutputFileSystem =
  Readonly<{
    mkdir:
      (
        path:
          string,
        options:
          Readonly<{
            recursive:
              true;
          }>,
      ) =>
        Promise<unknown>;

    open:
      (
        path:
          string,
        flags:
          "wx" | "r",
      ) =>
        Promise<GoogleGenAiOutputFileHandle>;

    link:
      (
        existingPath:
          string,
        newPath:
          string,
      ) =>
        Promise<void>;

    unlink:
      (
        path:
          string,
      ) =>
        Promise<void>;

    lstat:
      (
        path:
          string,
      ) =>
        Promise<
          Readonly<{
            size:
              number;

            isFile:
              () => boolean;
          }>
        >;
  }>;

export type GoogleGenAiSingleShotOutputMaterializationInput =
  Readonly<{
    mediaRoot:
      string;

    episodeId:
      string;

    shotId:
      string;

    maxOutputBytes:
      number;
  }>;

export type GoogleGenAiSingleShotOutputMaterializationDependencies =
  Readonly<{
    retrieveOutput:
      GoogleGenAiOutputRetriever;

    downloadUri:
      GoogleGenAiOutputUriDownloader;

    fileSystem?:
      GoogleGenAiOutputFileSystem;
  }>;

export type GoogleGenAiOutputSourceKind =
  | "INLINE_DATA"
  | "URI";

export type GoogleGenAiSingleShotOutputMaterializationResult =
  Readonly<{
    provider:
      typeof GOOGLE_GENAI_PROVIDER;

    providerExecutionId:
      string;

    outputIndex:
      typeof GOOGLE_GENAI_VIDEO_OUTPUT_INDEX;

    outputPath:
      string;

    mimeType:
      typeof GOOGLE_GENAI_OUTPUT_VIDEO_MIME_TYPE;

    byteCount:
      number;

    sha256:
      string;

    sourceKind:
      GoogleGenAiOutputSourceKind;

    alreadyPresent:
      boolean;
  }>;

type ExpectedContent =
  Readonly<{
    byteCount:
      number;

    sha256:
      string;
  }>;

const NODE_OUTPUT_FILE_SYSTEM:
  GoogleGenAiOutputFileSystem =
  Object.freeze({
    mkdir,
    open,
    link,
    unlink,
    lstat,
  });

const FORBIDDEN_CALLER_OVERRIDE_FIELDS =
  Object.freeze([
    "providerExecutionId",
    "interactionId",
    "provider",
  ]);

const STRICT_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const EXISTING_FILE_HASH_CHUNK_BYTES =
  1024 * 1024;

const MINIMUM_FTYP_BOX_BYTES =
  16;

function errorCode(
  error:
    unknown,
): unknown {
  return error !== null &&
    typeof error === "object" &&
    "code" in error
    ? error.code
    : undefined;
}

function requireMaxOutputBytes(
  maxOutputBytes:
    unknown,
): number {
  if (
    typeof maxOutputBytes !==
      "number" ||
    !Number.isSafeInteger(
      maxOutputBytes,
    ) ||
    maxOutputBytes <= 0
  ) {
    throw new Error(
      "Google GenAI output materialization requires maxOutputBytes as a positive safe integer.",
    );
  }

  return maxOutputBytes;
}

function requireRecord(
  value:
    unknown,
  label:
    string,
): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      `${label} must be an object.`,
    );
  }

  return Object.fromEntries(
    Object.entries(
      value,
    ),
  );
}

function readOptionalSource(
  outputVideo:
    Readonly<Record<string, unknown>>,
  field:
    "data" | "uri",
): string | undefined {
  const value =
    outputVideo[field];

  if (
    value === undefined ||
    value === null
  ) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(
      `Google GenAI output_video.${field} must be a string.`,
    );
  }

  if (!value.trim()) {
    throw new Error(
      `Google GenAI output_video.${field} must not be blank.`,
    );
  }

  return value;
}

function decodeStrictBase64(
  data:
    string,
  maxOutputBytes:
    number,
): Buffer {
  if (
    data.length % 4 !== 0 ||
    !STRICT_BASE64_PATTERN.test(
      data,
    )
  ) {
    throw new Error(
      "Google GenAI output_video.data must be strict standard Base64 without whitespace.",
    );
  }

  const padding =
    data.endsWith("==")
      ? 2
      : data.endsWith("=")
        ? 1
        : 0;

  const expectedByteCount =
    (data.length / 4) * 3 -
    padding;

  if (expectedByteCount <= 0) {
    throw new Error(
      "Google GenAI output video must not be empty.",
    );
  }

  if (
    expectedByteCount >
    maxOutputBytes
  ) {
    throw new Error(
      `Google GenAI inline output video would decode to ${expectedByteCount} bytes, exceeding maxOutputBytes ${maxOutputBytes}.`,
    );
  }

  const decoded =
    Buffer.from(
      data,
      "base64",
    );

  if (
    decoded.toString(
      "base64",
    ) !== data
  ) {
    throw new Error(
      "Google GenAI output_video.data is not canonical Base64.",
    );
  }

  return decoded;
}

function requireDownloadableUri(
  uri:
    string,
): void {
  let parsed:
    URL;

  try {
    parsed =
      new URL(
        uri,
      );
  } catch (error) {
    throw new Error(
      "Google GenAI output_video.uri is not a valid URL.",
      {
        cause:
          error,
      },
    );
  }

  if (
    parsed.protocol !==
    "https:"
  ) {
    throw new Error(
      `Google GenAI output_video.uri must use https; received ${JSON.stringify(parsed.protocol)}.`,
    );
  }

  if (!parsed.hostname) {
    throw new Error(
      "Google GenAI output_video.uri must include a hostname.",
    );
  }

  if (
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      "Google GenAI output_video.uri must not contain user credentials.",
    );
  }

  // URL parsing normalizes input (for example "https:///x" becomes
  // "https://x/"); require canonical form so the downloader receives
  // exactly the URI that was validated.
  if (parsed.href !== uri) {
    throw new Error(
      "Google GenAI output_video.uri must be a canonical absolute https URL.",
    );
  }
}

function requireBoundedBytes(
  bytes:
    Uint8Array,
  maxOutputBytes:
    number,
): Buffer {
  if (
    !(bytes instanceof Uint8Array)
  ) {
    throw new Error(
      "Google GenAI output video bytes must be a Uint8Array.",
    );
  }

  if (bytes.byteLength === 0) {
    throw new Error(
      "Google GenAI output video must not be empty.",
    );
  }

  if (
    bytes.byteLength >
    maxOutputBytes
  ) {
    throw new Error(
      `Google GenAI output video is ${bytes.byteLength} bytes, exceeding maxOutputBytes ${maxOutputBytes}.`,
    );
  }

  return Buffer.from(
    bytes,
  );
}

function requireMp4Signature(
  bytes:
    Buffer,
): void {
  if (
    bytes.byteLength <
    MINIMUM_FTYP_BOX_BYTES
  ) {
    throw new Error(
      "Google GenAI output video is too short to be an MP4 file.",
    );
  }

  if (
    bytes.toString(
      "latin1",
      4,
      8,
    ) !== "ftyp"
  ) {
    throw new Error(
      "Google GenAI output video does not begin with an ISO BMFF ftyp box.",
    );
  }

  const boxSize =
    bytes.readUInt32BE(
      0,
    );

  if (
    boxSize <
      MINIMUM_FTYP_BOX_BYTES ||
    boxSize >
      bytes.byteLength ||
    (boxSize -
      MINIMUM_FTYP_BOX_BYTES) %
      4 !==
      0
  ) {
    throw new Error(
      `Google GenAI output video has a structurally invalid ftyp box size ${boxSize}.`,
    );
  }
}

async function closeAfterFailure(
  handle:
    GoogleGenAiOutputFileHandle,
  failure:
    unknown,
): Promise<never> {
  try {
    await handle.close();
  } catch (closeError) {
    throw new AggregateError(
      [
        failure,
        closeError,
      ],
      "Google GenAI output file operation failed and the file handle could not be closed.",
    );
  }

  throw failure;
}

async function hashExistingFile(
  fileSystem:
    GoogleGenAiOutputFileSystem,
  path:
    string,
  byteCount:
    number,
): Promise<string> {
  const handle =
    await fileSystem.open(
      path,
      "r",
    );

  const hash =
    createHash(
      "sha256",
    );

  const chunk =
    new Uint8Array(
      Math.min(
        EXISTING_FILE_HASH_CHUNK_BYTES,
        byteCount,
      ),
    );

  let position =
    0;

  try {
    while (position < byteCount) {
      const {
        bytesRead,
      } =
        await handle.read(
          chunk,
          0,
          Math.min(
            chunk.byteLength,
            byteCount -
              position,
          ),
          position,
        );

      if (bytesRead === 0) {
        throw new Error(
          `Google GenAI existing output file ${path} ended before its reported size.`,
        );
      }

      hash.update(
        chunk.subarray(
          0,
          bytesRead,
        ),
      );

      position +=
        bytesRead;
    }
  } catch (error) {
    return closeAfterFailure(
      handle,
      error,
    );
  }

  await handle.close();

  return hash.digest(
    "hex",
  );
}

/**
 * Returns true when the final path already holds exactly the expected
 * content, false when it does not exist, and throws on any mismatch.
 */
async function finalHoldsExpectedContent(
  fileSystem:
    GoogleGenAiOutputFileSystem,
  finalPath:
    string,
  expected:
    ExpectedContent,
): Promise<boolean> {
  let stats:
    Awaited<
      ReturnType<
        GoogleGenAiOutputFileSystem["lstat"]
      >
    >;

  try {
    stats =
      await fileSystem.lstat(
        finalPath,
      );
  } catch (error) {
    if (
      errorCode(
        error,
      ) ===
      "ENOENT"
    ) {
      return false;
    }

    throw error;
  }

  if (!stats.isFile()) {
    throw new Error(
      `Google GenAI output path ${finalPath} exists but is not a regular file. Refusing to replace it.`,
    );
  }

  if (
    stats.size !==
    expected.byteCount
  ) {
    throw new Error(
      `Google GenAI output file ${finalPath} already exists with ${stats.size} bytes; expected ${expected.byteCount}. Refusing to replace it.`,
    );
  }

  const existingSha256 =
    await hashExistingFile(
      fileSystem,
      finalPath,
      expected.byteCount,
    );

  if (
    existingSha256 !==
    expected.sha256
  ) {
    throw new Error(
      `Google GenAI output file ${finalPath} already exists with SHA-256 ${existingSha256}; expected ${expected.sha256}. Refusing to replace it.`,
    );
  }

  return true;
}

async function publishGoogleGenAiOutput(
  fileSystem:
    GoogleGenAiOutputFileSystem,
  finalPath:
    string,
  bytes:
    Buffer,
  expected:
    ExpectedContent,
): Promise<boolean> {
  const directory =
    dirname(
      finalPath,
    );

  await fileSystem.mkdir(
    directory,
    {
      recursive:
        true,
    },
  );

  // Optimization only; the hard link below is the exclusive publication point.
  if (
    await finalHoldsExpectedContent(
      fileSystem,
      finalPath,
      expected,
    )
  ) {
    return true;
  }

  const temporaryPath =
    join(
      directory,
      `.${basename(finalPath)}.${randomUUID()}.part`,
    );

  let temporaryCreated =
    false;

  let alreadyPresent =
    false;

  let failure:
    unknown;

  let failed =
    false;

  try {
    const handle =
      await fileSystem.open(
        temporaryPath,
        "wx",
      );

    temporaryCreated =
      true;

    try {
      await handle.writeFile(
        bytes,
      );

      await handle.sync();
    } catch (error) {
      await closeAfterFailure(
        handle,
        error,
      );
    }

    await handle.close();

    try {
      await fileSystem.link(
        temporaryPath,
        finalPath,
      );
    } catch (error) {
      if (
        errorCode(
          error,
        ) !==
        "EEXIST"
      ) {
        throw new Error(
          `Google GenAI output hard-link publication to ${finalPath} failed. No rename, copy, or direct-write fallback is permitted.`,
          {
            cause:
              error,
          },
        );
      }

      if (
        !(await finalHoldsExpectedContent(
          fileSystem,
          finalPath,
          expected,
        ))
      ) {
        throw new Error(
          `Google GenAI output hard-link publication to ${finalPath} reported EEXIST but no final file is present.`,
          {
            cause:
              error,
          },
        );
      }

      alreadyPresent =
        true;
    }
  } catch (error) {
    failed =
      true;

    failure =
      error;
  }

  if (temporaryCreated) {
    try {
      await fileSystem.unlink(
        temporaryPath,
      );
    } catch (cleanupError) {
      if (failed) {
        throw new AggregateError(
          [
            failure,
            cleanupError,
          ],
          `Google GenAI output publication failed and temporary file ${temporaryPath} could not be removed.`,
        );
      }

      throw new Error(
        `Google GenAI output was published to ${finalPath}, but temporary file ${temporaryPath} could not be removed.`,
        {
          cause:
            cleanupError,
        },
      );
    }
  }

  if (failed) {
    throw failure;
  }

  return alreadyPresent;
}

export async function materializeGoogleGenAiSingleShotOutput(
  input:
    GoogleGenAiSingleShotOutputMaterializationInput,

  dependencies:
    GoogleGenAiSingleShotOutputMaterializationDependencies,
): Promise<
  GoogleGenAiSingleShotOutputMaterializationResult
> {
  for (
    const field of FORBIDDEN_CALLER_OVERRIDE_FIELDS
  ) {
    if (
      Object.hasOwn(
        input,
        field,
      )
    ) {
      throw new Error(
        `Google GenAI output materialization does not accept a caller-supplied ${field}; the durable execution submission is authoritative.`,
      );
    }
  }

  const maxOutputBytes =
    requireMaxOutputBytes(
      input.maxOutputBytes,
    );

  const submission =
    await readExecutionSubmission(
      input.mediaRoot,
      input.episodeId,
      input.shotId,
    );

  if (!submission) {
    throw new Error(
      `Google GenAI output materialization requires a durable execution submission for ${input.episodeId}/${input.shotId}.`,
    );
  }

  if (
    submission.provider !==
    GOOGLE_GENAI_PROVIDER
  ) {
    throw new Error(
      `Google GenAI output materialization requires a ${GOOGLE_GENAI_PROVIDER} execution submission; received ${submission.provider}.`,
    );
  }

  if (
    Object.hasOwn(
      submission,
      "interactionId",
    )
  ) {
    throw new Error(
      "Google GenAI execution submission must not carry a separate interactionId.",
    );
  }

  const providerExecutionId =
    submission.providerExecutionId;

  if (!providerExecutionId.trim()) {
    throw new Error(
      "Google GenAI execution submission has an empty providerExecutionId.",
    );
  }

  const outputPath =
    createGoogleGenAiVideoOutputPath(
      input.mediaRoot,
      submission.episodeId,
      submission.shotId,
      providerExecutionId,
    );

  const interaction =
    await dependencies
      .retrieveOutput(
        providerExecutionId,
      );

  normalizeGoogleGenAiProviderExecutionId(
    interaction,
  );

  if (
    interaction.id !==
    providerExecutionId
  ) {
    throw new Error(
      `Google GenAI output retrieval returned interaction ${JSON.stringify(interaction.id)}, which does not match durable providerExecutionId ${JSON.stringify(providerExecutionId)}.`,
    );
  }

  const lifecycleClass =
    classifyGoogleGenAiInteractionStatus(
      interaction.status,
    );

  if (
    lifecycleClass !==
    "SUCCESS"
  ) {
    throw new Error(
      `Google GenAI interaction ${providerExecutionId} is ${lifecycleClass} (${JSON.stringify(interaction.status)}); output can be materialized only from a completed interaction.`,
    );
  }

  const outputVideo =
    requireRecord(
      interaction.outputVideo,
      "Google GenAI output_video",
    );

  if (
    outputVideo.type !==
    "video"
  ) {
    throw new Error(
      `Google GenAI output_video.type must be "video"; received ${JSON.stringify(outputVideo.type)}.`,
    );
  }

  if (
    outputVideo.mime_type ===
      undefined ||
    outputVideo.mime_type ===
      null
  ) {
    throw new Error(
      "Google GenAI output_video.mime_type is required.",
    );
  }

  if (
    outputVideo.mime_type !==
    GOOGLE_GENAI_OUTPUT_VIDEO_MIME_TYPE
  ) {
    throw new Error(
      `Google GenAI output_video.mime_type must be ${GOOGLE_GENAI_OUTPUT_VIDEO_MIME_TYPE}; received ${JSON.stringify(outputVideo.mime_type)}.`,
    );
  }

  const data =
    readOptionalSource(
      outputVideo,
      "data",
    );

  const uri =
    readOptionalSource(
      outputVideo,
      "uri",
    );

  if (
    data !== undefined &&
    uri !== undefined
  ) {
    throw new Error(
      "Google GenAI output_video must provide exactly one of data or uri, not both.",
    );
  }

  let bytes:
    Buffer;

  let sourceKind:
    GoogleGenAiOutputSourceKind;

  if (data !== undefined) {
    bytes =
      requireBoundedBytes(
        decodeStrictBase64(
          data,
          maxOutputBytes,
        ),
        maxOutputBytes,
      );

    sourceKind =
      "INLINE_DATA";
  } else if (uri !== undefined) {
    requireDownloadableUri(
      uri,
    );

    bytes =
      requireBoundedBytes(
        await dependencies
          .downloadUri({
            uri,
            maxOutputBytes,
          }),
        maxOutputBytes,
      );

    sourceKind =
      "URI";
  } else {
    throw new Error(
      "Google GenAI output_video must provide exactly one of data or uri.",
    );
  }

  requireMp4Signature(
    bytes,
  );

  const expected:
    ExpectedContent =
    Object.freeze({
      byteCount:
        bytes.byteLength,

      sha256:
        createHash(
          "sha256",
        )
          .update(
            bytes,
          )
          .digest(
            "hex",
          ),
    });

  const alreadyPresent =
    await publishGoogleGenAiOutput(
      dependencies.fileSystem ??
        NODE_OUTPUT_FILE_SYSTEM,
      outputPath,
      bytes,
      expected,
    );

  return Object.freeze({
    provider:
      GOOGLE_GENAI_PROVIDER,

    providerExecutionId,

    outputIndex:
      GOOGLE_GENAI_VIDEO_OUTPUT_INDEX,

    outputPath,

    mimeType:
      GOOGLE_GENAI_OUTPUT_VIDEO_MIME_TYPE,

    byteCount:
      expected.byteCount,

    sha256:
      expected.sha256,

    sourceKind,

    alreadyPresent,
  });
}
