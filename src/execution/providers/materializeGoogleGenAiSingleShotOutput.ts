import {
  createHash,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  lstat,
  mkdir,
  open,
  unlink,
} from "node:fs/promises";
import { attemptHardLink } from "../../filesystem/hardLink.js";

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

import type {
  GoogleGenAiDownloadedFile,
  GoogleGenAiOutputChunkSink,
  GoogleGenAiOutputUriDownloader as GoogleGenAiStreamingOutputUriDownloader,
  GoogleGenAiPrepareOutputUri,
  GoogleGenAiRecoveryContext,
  GoogleGenAiSecureOutputTransportPolicy,
  GoogleGenAiVerifiedFileMetadata,
} from "../../googleGenai/transport/googleGenAiSecureOutputTransport.types.js";

import {
  GoogleGenAiSecureOutputTransportError,
} from "../../googleGenai/transport/googleGenAiSecureOutputTransportError.js";

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
 * and fsynced temporary file. Only where the volume cannot hard-link (EISDIR,
 * as exFAT reports on Windows) and the final is proven absent, the verified
 * bytes are copied through an exclusively created ("wx") final handle and the
 * final is fully revalidated before publication succeeds; there is no rename
 * or overwrite path. It never creates, resubmits, completes, reconciles, or
 * mutates the reservation or submission.
 *
 * A URI output is never buffered whole. Each attempt prepares fresh
 * verified metadata through the injected prepareUri, then streams the
 * injected downloader's chunks through a materializer-owned positional
 * writer that independently counts, hashes, and keeps only the MP4 prefix.
 * This module is the sole Files download retry owner: at most
 * policy.recovery.maxFilesDownloadAttemptsPerReconciliation attempts, a
 * retry only after a typed transient failure and complete owned-temp
 * cleanup, separated by the published abortable retry delay. It has no
 * network, credential, or SDK authority of its own.
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

/** The streaming downloader contract, re-exported for existing type-import sites. */
export type GoogleGenAiOutputUriDownloader =
  GoogleGenAiStreamingOutputUriDownloader;

export type GoogleGenAiOutputFileHandle =
  Readonly<{
    write:
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
            bytesWritten:
              number;
          }>
        >;

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

/**
 * prepareUri, downloadUri, policy, and context are URI-only. Historical
 * inline-only calls may omit them; a URI output requires all four at
 * runtime before any URI work, with no whole-buffer fallback.
 */
export type GoogleGenAiSingleShotOutputMaterializationDependencies =
  Readonly<{
    retrieveOutput:
      GoogleGenAiOutputRetriever;

    prepareUri?:
      GoogleGenAiPrepareOutputUri;

    downloadUri?:
      GoogleGenAiOutputUriDownloader;

    policy?:
      GoogleGenAiSecureOutputTransportPolicy;

    context?:
      GoogleGenAiRecoveryContext;

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
    link: async (existingPath, newPath) => {
      const result = await attemptHardLink(existingPath, newPath);
      if (result.status === "FAILED") throw result.error;
    },
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

// Messages are static and the parse cause is discarded: a provider-returned
// URI may carry secret-bearing content that must not escape through an Error.
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
  } catch {
    throw new Error(
      "Google GenAI output_video.uri is not a valid URL.",
    );
  }

  if (
    parsed.protocol !==
    "https:"
  ) {
    throw new Error(
      "Google GenAI output_video.uri must use https.",
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

function transportFailure(
  code:
    GoogleGenAiSecureOutputTransportError["code"],
): GoogleGenAiSecureOutputTransportError {
  return new GoogleGenAiSecureOutputTransportError(
    code,
  );
}

function isPositiveSafeInteger(
  value:
    unknown,
): value is number {
  return typeof value ===
    "number" &&
    Number.isSafeInteger(
      value,
    ) &&
    value > 0;
}

function parentFailure(
  signal:
    AbortSignal,
): GoogleGenAiSecureOutputTransportError {
  return transportFailure(
    signal.reason instanceof
      GoogleGenAiSecureOutputTransportError &&
      signal.reason.code ===
        "RECONCILIATION_TIMEOUT"
      ? "RECONCILIATION_TIMEOUT"
      : "OPERATION_ABORTED",
  );
}

type UriMaterializationAuthority =
  Readonly<{
    prepareUri:
      GoogleGenAiPrepareOutputUri;

    downloadUri:
      GoogleGenAiOutputUriDownloader;

    context:
      GoogleGenAiRecoveryContext;

    maxOutputBytes:
      number;

    maxAttempts:
      number;

    retryDelayMs:
      number;

    nextAttemptMs:
      number;
  }>;

/**
 * Requires every URI-only dependency before any URI work. The effective
 * byte bound is min(input, policy): a caller may narrow, never widen.
 */
function requireUriAuthority(
  dependencies:
    GoogleGenAiSingleShotOutputMaterializationDependencies,
  inputMaxOutputBytes:
    number,
): UriMaterializationAuthority {
  const {
    prepareUri,
    downloadUri,
    policy,
    context,
  } =
    dependencies;

  if (
    typeof prepareUri !==
      "function" ||
    typeof downloadUri !==
      "function" ||
    policy === null ||
    typeof policy !==
      "object" ||
    policy.limits === null ||
    typeof policy.limits !==
      "object" ||
    policy.timeouts === null ||
    typeof policy.timeouts !==
      "object" ||
    policy.recovery === null ||
    typeof policy.recovery !==
      "object" ||
    context === null ||
    typeof context !==
      "object" ||
    !(context.signal instanceof
      AbortSignal) ||
    typeof context.remainingMs !==
      "function"
  ) {
    throw transportFailure(
      "SECURE_TRANSPORT_CONFIGURATION_INVALID",
    );
  }

  const policyMaxOutputBytes =
    policy.limits.maxOutputBytes;

  const metadataTimeoutMs =
    policy.timeouts.filesMetadataTimeoutMs;

  const downloadTimeoutMs =
    policy.timeouts.filesDownloadTimeoutMs;

  const maxAttempts =
    policy.recovery
      .maxFilesDownloadAttemptsPerReconciliation;

  const retryDelayMs =
    policy.recovery.filesDownloadRetryDelayMs;

  if (
    ![
      policyMaxOutputBytes,
      metadataTimeoutMs,
      downloadTimeoutMs,
      maxAttempts,
      retryDelayMs,
    ].every(
      isPositiveSafeInteger,
    )
  ) {
    throw transportFailure(
      "SECURE_TRANSPORT_CONFIGURATION_INVALID",
    );
  }

  return Object.freeze({
    prepareUri,
    downloadUri,
    context,

    maxOutputBytes:
      Math.min(
        inputMaxOutputBytes,
        policyMaxOutputBytes,
      ),

    maxAttempts,
    retryDelayMs,

    // A next attempt is one metadata request followed by one download,
    // each admitted only with its full published timeout.
    nextAttemptMs:
      metadataTimeoutMs +
      downloadTimeoutMs,
  });
}

function remainingBudgetMs(
  context:
    GoogleGenAiRecoveryContext,
): number {
  let remaining:
    number;

  try {
    remaining =
      context.remainingMs();
  } catch {
    throw transportFailure(
      "SECURE_TRANSPORT_CONFIGURATION_INVALID",
    );
  }

  if (
    typeof remaining !==
      "number" ||
    !Number.isFinite(
      remaining,
    ) ||
    Math.abs(
      remaining,
    ) >
      Number.MAX_SAFE_INTEGER
  ) {
    throw transportFailure(
      "SECURE_TRANSPORT_CONFIGURATION_INVALID",
    );
  }

  return remaining;
}

function requireActive(
  context:
    GoogleGenAiRecoveryContext,
): void {
  if (context.signal.aborted) {
    throw parentFailure(
      context.signal,
    );
  }
}

/**
 * Admission to a new irreversible step (sync, hard-link publication).
 * Timer delivery is not authority: the shared context's current remaining
 * budget/horizon is sampled as well, so an elapsed deadline whose callback
 * has not yet run still refuses the step. A step already in progress is
 * never force-cancelled.
 */
function requireAuthority(
  context:
    GoogleGenAiRecoveryContext,
): void {
  requireActive(
    context,
  );

  const remaining =
    remainingBudgetMs(
      context,
    );

  requireActive(
    context,
  );

  if (remaining <= 0) {
    throw transportFailure(
      "RECOVERY_BUDGET_EXHAUSTED",
    );
  }
}

const CLOSED_TRANSPORT_ERROR_FIELDS =
  Object.freeze([
    "code",
    "attempt",
    "httpStatus",
    "retryable",
  ] as const);

/**
 * Reads the closed semantic fields only as own data properties, the shape
 * the trusted constructor produces (absent attempt/httpStatus are still own
 * properties holding undefined). Inherited, missing or accessor fields are
 * never read and make the value unclassifiable.
 */
function ownClosedTransportFields(
  error:
    object,
): Readonly<Record<typeof CLOSED_TRANSPORT_ERROR_FIELDS[number], unknown>> | undefined {
  const fields:
    Partial<Record<typeof CLOSED_TRANSPORT_ERROR_FIELDS[number], unknown>> = {};

  for (
    const field of CLOSED_TRANSPORT_ERROR_FIELDS
  ) {
    const descriptor =
      Reflect.getOwnPropertyDescriptor(
        error,
        field,
      );

    if (
      descriptor === undefined ||
      !("value" in descriptor)
    ) {
      return undefined;
    }

    fields[field] =
      descriptor.value;
  }

  return fields as Readonly<Record<typeof CLOSED_TRANSPORT_ERROR_FIELDS[number], unknown>>;
}

/**
 * Normalizes a dependency failure into a FRESH trusted error. `instanceof`
 * is only a structural signal: the original closed fields are validated
 * before any normalization. The trusted constructor is the validator — the
 * candidate is rebuilt from its ORIGINAL code/attempt/httpStatus and must
 * round-trip exactly, including its supplied retryable flag. Any field the
 * constructor would drop or reinterpret (malformed status, invalid attempt,
 * unknown code) or a contradictory retryable flag fails closed to the
 * existing nonretryable SECURE_TRANSPORT_CONFIGURATION_INVALID, so invalid
 * input can never be normalized into a valid (possibly retryable) failure.
 * Nothing else (stack, message, cause, custom properties) is ever read.
 */
function sanitizeUriFailure(
  error:
    unknown,
): GoogleGenAiSecureOutputTransportError {
  const invalid =
    (): GoogleGenAiSecureOutputTransportError =>
      transportFailure(
        "SECURE_TRANSPORT_CONFIGURATION_INVALID",
      );

  try {
    if (
      !(error instanceof
        GoogleGenAiSecureOutputTransportError)
    ) {
      return invalid();
    }

    const fields =
      ownClosedTransportFields(
        error,
      );

    if (fields === undefined) {
      return invalid();
    }

    const {
      code,
      attempt,
      httpStatus,
      retryable,
    } =
      fields;

    if (
      typeof code !==
        "string" ||
      typeof retryable !==
        "boolean" ||
      (attempt !== undefined &&
        typeof attempt !==
          "number") ||
      (httpStatus !== undefined &&
        typeof httpStatus !==
          "number")
    ) {
      return invalid();
    }

    const rebuilt =
      new GoogleGenAiSecureOutputTransportError(
        code as GoogleGenAiSecureOutputTransportError["code"],
        {
          ...(attempt === undefined
            ? {}
            : {
                attempt,
              }),

          ...(httpStatus === undefined
            ? {}
            : {
                httpStatus,
              }),
        },
      );

    // Validate-before-normalize: every original field must survive the
    // trusted constructor unchanged (Object.is also rejects NaN).
    if (
      rebuilt.code !==
        code ||
      !Object.is(
        rebuilt.attempt,
        attempt,
      ) ||
      !Object.is(
        rebuilt.httpStatus,
        httpStatus,
      ) ||
      rebuilt.retryable !==
        retryable
    ) {
      return invalid();
    }

    return rebuilt;
  } catch {
    // A hostile trap or descriptor read is never retained as a cause.
    return invalid();
  }
}

/** Abortable published retry delay; the timer never outlives the wait. */
function waitForRetry(
  delayMs:
    number,
  signal:
    AbortSignal,
): Promise<void> {
  return new Promise(
    (
      resolve,
      reject,
    ) => {
      if (signal.aborted) {
        reject(
          parentFailure(
            signal,
          ),
        );

        return;
      }

      const onAbort =
        (): void => {
          clearTimeout(
            timer,
          );

          reject(
            parentFailure(
              signal,
            ),
          );
        };

      const timer =
        setTimeout(
          () => {
            signal.removeEventListener(
              "abort",
              onAbort,
            );

            resolve();
          },
          delayMs,
        );

      signal.addEventListener(
        "abort",
        onAbort,
        {
          once:
            true,
        },
      );
    },
  );
}

function isTransientTransportFailure(
  error:
    unknown,
): boolean {
  return error instanceof
    GoogleGenAiSecureOutputTransportError &&
    error.retryable;
}

/** Identical structural rules as requireMp4Signature, over a retained prefix only. */
function mp4PrefixIsValid(
  prefix:
    Uint8Array,
  byteCount:
    number,
): boolean {
  if (
    byteCount <
      MINIMUM_FTYP_BOX_BYTES ||
    prefix.byteLength <
      MINIMUM_FTYP_BOX_BYTES
  ) {
    return false;
  }

  const view =
    Buffer.from(
      prefix.buffer,
      prefix.byteOffset,
      MINIMUM_FTYP_BOX_BYTES,
    );

  if (
    view.toString(
      "latin1",
      4,
      8,
    ) !== "ftyp"
  ) {
    return false;
  }

  const boxSize =
    view.readUInt32BE(
      0,
    );

  return boxSize >=
      MINIMUM_FTYP_BOX_BYTES &&
    boxSize <=
      byteCount &&
    (boxSize -
      MINIMUM_FTYP_BOX_BYTES) %
      4 ===
      0;
}

function digestEquals(
  actual:
    Buffer,
  expectedHex:
    string,
): boolean {
  if (
    !/^[0-9a-f]{64}$/.test(
      expectedHex,
    )
  ) {
    return false;
  }

  const expected =
    Buffer.from(
      expectedHex,
      "hex",
    );

  return actual.byteLength ===
      expected.byteLength &&
    timingSafeEqual(
      actual,
      expected,
    );
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

    const outcome =
      await publishVerifiedTemporaryFileNoOverwrite(
        fileSystem,
        temporaryPath,
        finalPath,
        expected,
        {
          link:
            () =>
              fileSystem.link(
                temporaryPath,
                finalPath,
              ),

          // The inline path has no recovery context to admit steps against.
          checkpoint:
            () => undefined,

          existingFinalHoldsExpected:
            finalHoldsExpectedContent,

          rejectLinkFailure:
            (error) =>
              new Error(
                `Google GenAI output hard-link publication to ${finalPath} failed. No rename, copy, or direct-write fallback is permitted.`,
                {
                  cause:
                    error,
                },
              ),

          rejectMissingAfterCollision:
            (error) =>
              new Error(
                `Google GenAI output hard-link publication to ${finalPath} reported EEXIST but no final file is present.`,
                {
                  cause:
                    error,
                },
              ),

          rejectCopyFailure:
            (cause, ownedFinalCleanupFailed) => {
              const failure =
                new Error(
                  `Google GenAI output exclusive-copy publication to ${finalPath} failed.`,
                  {
                    cause,
                  },
                );

              return ownedFinalCleanupFailed
                ? new AggregateError(
                    [
                      failure,
                    ],
                    `Google GenAI output exclusive-copy publication to ${finalPath} failed and its partial final could not be removed.`,
                  )
                : failure;
            },
        },
      );

    alreadyPresent =
      outcome ===
      "ALREADY_PRESENT";
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

/**
 * URI-path existing-final inspection: false when absent; true only for a
 * regular file with the expected size, incremental SHA-256 and a valid
 * bounded MP4 prefix. Any other existing entry is a conflict and is never
 * replaced. Never loads the file whole.
 */
async function uriFinalHoldsExpectedContent(
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

    throw transportFailure(
      "OUTPUT_PUBLICATION_FAILED",
    );
  }

  if (
    !stats.isFile() ||
    stats.size !==
      expected.byteCount
  ) {
    throw transportFailure(
      "OUTPUT_PUBLICATION_CONFLICT",
    );
  }

  let handle:
    GoogleGenAiOutputFileHandle;

  try {
    handle =
      await fileSystem.open(
        finalPath,
        "r",
      );
  } catch {
    throw transportFailure(
      "OUTPUT_PUBLICATION_FAILED",
    );
  }

  const hash =
    createHash(
      "sha256",
    );

  const prefix =
    new Uint8Array(
      MINIMUM_FTYP_BOX_BYTES,
    );

  const chunk =
    new Uint8Array(
      Math.min(
        EXISTING_FILE_HASH_CHUNK_BYTES,
        expected.byteCount,
      ),
    );

  let position =
    0;

  let failure:
    GoogleGenAiSecureOutputTransportError | undefined;

  try {
    while (position < expected.byteCount) {
      let bytesRead:
        number;

      try {
        ({
          bytesRead,
        } =
          await handle.read(
            chunk,
            0,
            Math.min(
              chunk.byteLength,
              expected.byteCount -
                position,
            ),
            position,
          ));
      } catch {
        throw transportFailure(
          "OUTPUT_PUBLICATION_FAILED",
        );
      }

      // The file changed beneath the lstat: it is not the expected content.
      if (
        !Number.isSafeInteger(
          bytesRead,
        ) ||
        bytesRead <= 0 ||
        bytesRead >
          expected.byteCount -
            position
      ) {
        throw transportFailure(
          "OUTPUT_PUBLICATION_CONFLICT",
        );
      }

      const read =
        chunk.subarray(
          0,
          bytesRead,
        );

      if (position < MINIMUM_FTYP_BOX_BYTES) {
        prefix.set(
          read.subarray(
            0,
            MINIMUM_FTYP_BOX_BYTES -
              position,
          ),
          position,
        );
      }

      hash.update(
        read,
      );

      position +=
        bytesRead;
    }
  } catch (error) {
    failure =
      error instanceof
        GoogleGenAiSecureOutputTransportError
        ? error
        : transportFailure(
            "OUTPUT_PUBLICATION_FAILED",
          );
  }

  try {
    await handle.close();
  } catch {
    failure ??=
      transportFailure(
        "OUTPUT_PUBLICATION_FAILED",
      );
  }

  if (failure) {
    throw failure;
  }

  if (
    !digestEquals(
      hash.digest(),
      expected.sha256,
    ) ||
    !mp4PrefixIsValid(
      prefix,
      expected.byteCount,
    )
  ) {
    throw transportFailure(
      "OUTPUT_PUBLICATION_CONFLICT",
    );
  }

  return true;
}

type VerifiedPublicationOutcome =
  | "LINKED"
  | "ALREADY_PRESENT"
  | "COPIED";

/** Site-specific policy for the shared no-overwrite publication helper. */
type VerifiedPublicationPolicy =
  Readonly<{
    // The site's own exclusive hard-link publication of its temp to its final.
    link:
      () =>
        Promise<void>;

    // Admission to an irreversible step (exclusive create, copy chunk, sync).
    checkpoint:
      () => void;

    // The site's existing-final contract: false only when absent, true only
    // for the exact expected content, throws on any other existing entry.
    existingFinalHoldsExpected:
      (
        fileSystem:
          GoogleGenAiOutputFileSystem,
        finalPath:
          string,
        expected:
          ExpectedContent,
      ) =>
        Promise<boolean>;

    rejectLinkFailure:
      (
        error:
          unknown,
      ) => Error;

    rejectMissingAfterCollision:
      (
        error:
          unknown,
      ) => Error;

    rejectCopyFailure:
      (
        cause:
          unknown,
        ownedFinalCleanupFailed:
          boolean,
      ) => Error;
  }>;

/**
 * Publishes an owned, fully written, synced and validated temporary file to
 * finalPath without ever replacing an existing entry. The exclusive hard
 * link is always attempted first. Only EISDIR, which exFAT on Windows
 * reports for every link attempt (including onto an existing destination),
 * admits the exclusive-copy fallback, and only after the temporary file is
 * proven to be the expected regular file and the final is proven absent.
 */
async function publishVerifiedTemporaryFileNoOverwrite(
  fileSystem:
    GoogleGenAiOutputFileSystem,
  temporaryPath:
    string,
  finalPath:
    string,
  expected:
    ExpectedContent,
  policy:
    VerifiedPublicationPolicy,
): Promise<VerifiedPublicationOutcome> {
  let linkError:
    unknown;

  try {
    await policy.link();

    return "LINKED";
  } catch (error) {
    linkError =
      error;
  }

  const code =
    errorCode(
      linkError,
    );

  if (code === "EEXIST") {
    if (
      !(await policy.existingFinalHoldsExpected(
        fileSystem,
        finalPath,
        expected,
      ))
    ) {
      throw policy.rejectMissingAfterCollision(
        linkError,
      );
    }

    return "ALREADY_PRESENT";
  }

  if (code !== "EISDIR") {
    throw policy.rejectLinkFailure(
      linkError,
    );
  }

  // EISDIR alone proves neither "unsupported" nor "absent".
  let sourceStats:
    Awaited<
      ReturnType<
        GoogleGenAiOutputFileSystem["lstat"]
      >
    >;

  try {
    sourceStats =
      await fileSystem.lstat(
        temporaryPath,
      );
  } catch {
    throw policy.rejectLinkFailure(
      linkError,
    );
  }

  if (
    !sourceStats.isFile() ||
    sourceStats.size !==
      expected.byteCount
  ) {
    throw policy.rejectLinkFailure(
      linkError,
    );
  }

  if (
    await policy.existingFinalHoldsExpected(
      fileSystem,
      finalPath,
      expected,
    )
  ) {
    return "ALREADY_PRESENT";
  }

  policy.checkpoint();

  let destination:
    GoogleGenAiOutputFileHandle;

  try {
    destination =
      await fileSystem.open(
        finalPath,
        "wx",
      );
  } catch (error) {
    // Another entry appeared after inspection: never write, re-run the contract once.
    if (
      errorCode(
        error,
      ) ===
        "EEXIST" &&
      (await policy.existingFinalHoldsExpected(
        fileSystem,
        finalPath,
        expected,
      ))
    ) {
      return "ALREADY_PRESENT";
    }

    throw policy.rejectCopyFailure(
      error,
      false,
    );
  }

  // Ownership of finalPath begins only after the successful exclusive open.
  let destinationOpen =
    true;

  let source:
    GoogleGenAiOutputFileHandle | undefined;

  let failure:
    unknown;

  try {
    source =
      await fileSystem.open(
        temporaryPath,
        "r",
      );

    const hash =
      createHash(
        "sha256",
      );

    const prefix =
      new Uint8Array(
        MINIMUM_FTYP_BOX_BYTES,
      );

    const chunk =
      new Uint8Array(
        Math.min(
          EXISTING_FILE_HASH_CHUNK_BYTES,
          expected.byteCount,
        ),
      );

    let position =
      0;

    while (position < expected.byteCount) {
      policy.checkpoint();

      const {
        bytesRead,
      } =
        await source.read(
          chunk,
          0,
          Math.min(
            chunk.byteLength,
            expected.byteCount -
              position,
          ),
          position,
        );

      if (
        !Number.isSafeInteger(
          bytesRead,
        ) ||
        bytesRead <= 0 ||
        bytesRead >
          expected.byteCount -
            position
      ) {
        throw new Error(
          "Google GenAI verified temporary output changed during exclusive-copy publication.",
        );
      }

      const data =
        chunk.subarray(
          0,
          bytesRead,
        );

      let offset =
        0;

      // Bytes reach the final only through the exclusively acquired handle.
      while (offset < bytesRead) {
        const result:
          unknown =
          await destination.write(
            data,
            offset,
            bytesRead -
              offset,
            position +
              offset,
          );

        const bytesWritten =
          result !== null &&
          typeof result ===
            "object" &&
          "bytesWritten" in result
            ? result.bytesWritten
            : undefined;

        if (
          typeof bytesWritten !==
            "number" ||
          !Number.isSafeInteger(
            bytesWritten,
          ) ||
          bytesWritten <= 0 ||
          bytesWritten >
            bytesRead -
              offset
        ) {
          throw new Error(
            "Google GenAI exclusive-copy publication wrote an invalid byte count.",
          );
        }

        offset +=
          bytesWritten;
      }

      if (position < MINIMUM_FTYP_BOX_BYTES) {
        prefix.set(
          data.subarray(
            0,
            MINIMUM_FTYP_BOX_BYTES -
              position,
          ),
          position,
        );
      }

      hash.update(
        data,
      );

      position +=
        bytesRead;
    }

    if (
      position !==
        expected.byteCount ||
      !digestEquals(
        hash.digest(),
        expected.sha256,
      ) ||
      !mp4PrefixIsValid(
        prefix,
        position,
      )
    ) {
      throw new Error(
        "Google GenAI exclusive-copy publication bytes do not match the verified output.",
      );
    }

    policy.checkpoint();

    await destination.sync();

    destinationOpen =
      false;

    await destination.close();

    const openSource =
      source;

    source =
      undefined;

    await openSource.close();

    // Independent read-only revalidation of the final itself.
    let finalVerified =
      false;

    try {
      finalVerified =
        await uriFinalHoldsExpectedContent(
          fileSystem,
          finalPath,
          expected,
        );
    } catch {
      finalVerified =
        false;
    }

    if (!finalVerified) {
      throw new Error(
        "Google GenAI exclusive-copy publication final failed revalidation.",
      );
    }

    return "COPIED";
  } catch (error) {
    failure =
      error;
  }

  // Reached only on failure: the final was created by this invocation and
  // was never verified, so it is the sole permitted cleanup target.
  let ownedFinalCleanupFailed =
    false;

  if (destinationOpen) {
    try {
      await destination.close();
    } catch {
      ownedFinalCleanupFailed =
        true;
    }
  }

  if (source !== undefined) {
    try {
      await source.close();
    } catch {
      ownedFinalCleanupFailed =
        true;
    }
  }

  try {
    await fileSystem.unlink(
      finalPath,
    );
  } catch {
    ownedFinalCleanupFailed =
      true;
  }

  throw policy.rejectCopyFailure(
    failure,
    ownedFinalCleanupFailed,
  );
}

type ContentBinding =
  Readonly<{
    name:
      string;

    byteCount:
      number;

    sha256:
      string;
  }>;

/**
 * Locally revalidates prepared metadata and binds the first validated
 * name/size/SHA for this invocation; a later attempt must match exactly.
 */
function requirePreparedMetadata(
  metadata:
    GoogleGenAiVerifiedFileMetadata,
  uri:
    string,
  maxOutputBytes:
    number,
  binding:
    ContentBinding | undefined,
): ContentBinding {
  if (
    metadata === null ||
    typeof metadata !==
      "object" ||
    metadata.resource === null ||
    typeof metadata.resource !==
      "object" ||
    typeof metadata.resource.name !==
      "string" ||
    metadata.mimeType !==
      GOOGLE_GENAI_OUTPUT_VIDEO_MIME_TYPE ||
    !isPositiveSafeInteger(
      metadata.byteCount,
    ) ||
    typeof metadata.sha256 !==
      "string" ||
    !/^[0-9a-f]{64}$/.test(
      metadata.sha256,
    )
  ) {
    throw transportFailure(
      "FILES_METADATA_INVALID",
    );
  }

  if (
    metadata.resource.downloadUri !==
    uri
  ) {
    throw transportFailure(
      "FILE_IDENTITY_MISMATCH",
    );
  }

  if (
    metadata.byteCount >
    maxOutputBytes
  ) {
    throw transportFailure(
      "FILE_TOO_LARGE",
    );
  }

  if (
    binding !== undefined &&
    (binding.name !==
      metadata.resource.name ||
      binding.byteCount !==
        metadata.byteCount ||
      binding.sha256 !==
        metadata.sha256)
  ) {
    throw transportFailure(
      "FILE_IDENTITY_MISMATCH",
    );
  }

  return binding ??
    Object.freeze({
      name:
        metadata.resource.name,

      byteCount:
        metadata.byteCount,

      sha256:
        metadata.sha256,
    });
}

type UriAttemptOutcome =
  | Readonly<{
      kind:
        "PUBLISHED";

      alreadyPresent:
        boolean;
    }>
  | Readonly<{
      kind:
        "RETRYABLE";

      failure:
        GoogleGenAiSecureOutputTransportError;
    }>;

/**
 * One download attempt into a fresh exclusively created temp. Ownership
 * begins only after a successful "wx" open. Every exit closes the handle
 * and unlinks the owned temp; a transient downloader failure is reported
 * as retryable only after that cleanup settled successfully.
 */
async function streamUriOutputAttempt(
  fileSystem:
    GoogleGenAiOutputFileSystem,
  finalPath:
    string,
  metadata:
    GoogleGenAiVerifiedFileMetadata,
  authority:
    UriMaterializationAuthority,
): Promise<UriAttemptOutcome> {
  const {
    context,
  } =
    authority;

  const expected:
    ExpectedContent =
    Object.freeze({
      byteCount:
        metadata.byteCount,

      sha256:
        metadata.sha256,
    });

  const temporaryPath =
    join(
      dirname(
        finalPath,
      ),
      `.${basename(finalPath)}.${randomUUID()}.part`,
    );

  let handle:
    GoogleGenAiOutputFileHandle;

  try {
    handle =
      await fileSystem.open(
        temporaryPath,
        "wx",
      );
  } catch {
    // A failed open proves no ownership; the path is never unlinked.
    throw transportFailure(
      "TEMP_WRITE_FAILED",
    );
  }

  let handleOpen =
    true;

  let position =
    0;

  let byteCount =
    0;

  const hash =
    createHash(
      "sha256",
    );

  const prefix =
    new Uint8Array(
      MINIMUM_FTYP_BOX_BYTES,
    );

  let sinkFailure:
    GoogleGenAiSecureOutputTransportError | undefined;

  let sinkClosed =
    false;

  let activeWrite:
    Promise<void> | undefined;

  async function persistChunk(
    chunk:
      Uint8Array,
  ): Promise<void> {
    const prospective =
      byteCount +
      chunk.byteLength;

    if (
      prospective >
      authority.maxOutputBytes
    ) {
      throw transportFailure(
        "DOWNLOAD_TOO_LARGE",
      );
    }

    if (
      prospective >
      expected.byteCount
    ) {
      throw transportFailure(
        "DOWNLOAD_SIZE_MISMATCH",
      );
    }

    let offset =
      0;

    while (offset < chunk.byteLength) {
      const length =
        chunk.byteLength -
        offset;

      let result:
        unknown;

      try {
        result =
          await handle.write(
            chunk,
            offset,
            length,
            position,
          );
      } catch {
        throw transportFailure(
          "TEMP_WRITE_FAILED",
        );
      }

      const bytesWritten =
        result !== null &&
        typeof result ===
          "object" &&
        "bytesWritten" in result
          ? result.bytesWritten
          : undefined;

      if (
        typeof bytesWritten !==
          "number" ||
        !Number.isSafeInteger(
          bytesWritten,
        ) ||
        bytesWritten <= 0 ||
        bytesWritten >
          length
      ) {
        throw transportFailure(
          "TEMP_WRITE_FAILED",
        );
      }

      offset +=
        bytesWritten;

      position +=
        bytesWritten;
    }

    // Evidence advances only for a fully persisted chunk.
    if (byteCount < MINIMUM_FTYP_BOX_BYTES) {
      prefix.set(
        chunk.subarray(
          0,
          MINIMUM_FTYP_BOX_BYTES -
            byteCount,
        ),
        byteCount,
      );
    }

    hash.update(
      chunk,
    );

    byteCount =
      prospective;
  }

  const sink:
    GoogleGenAiOutputChunkSink =
    Object.freeze({
      writeChunk:
        async (
          chunk:
            Uint8Array,
        ): Promise<void> => {
          if (
            sinkFailure !==
            undefined
          ) {
            throw sinkFailure;
          }

          if (
            sinkClosed ||
            activeWrite !==
              undefined ||
            !(chunk instanceof
              Uint8Array)
          ) {
            sinkFailure =
              transportFailure(
                "TEMP_WRITE_FAILED",
              );

            throw sinkFailure;
          }

          if (context.signal.aborted) {
            sinkFailure =
              parentFailure(
                context.signal,
              );

            throw sinkFailure;
          }

          if (chunk.byteLength === 0) {
            return;
          }

          const write =
            persistChunk(
              chunk,
            );

          activeWrite =
            write.then(
              () => undefined,
              () => undefined,
            );

          try {
            await write;
          } catch (error) {
            sinkFailure =
              error instanceof
                GoogleGenAiSecureOutputTransportError
                ? error
                : transportFailure(
                    "TEMP_WRITE_FAILED",
                  );

            throw sinkFailure;
          } finally {
            activeWrite =
              undefined;
          }
        },
    });

  let primary:
    GoogleGenAiSecureOutputTransportError | undefined;

  let failed =
    false;

  let retryable:
    GoogleGenAiSecureOutputTransportError | undefined;

  let published =
    false;

  let alreadyPresent =
    false;

  let ownedFinalCleanupFailures =
    0;

  try {
    let downloaded:
      GoogleGenAiDownloadedFile;

    try {
      downloaded =
        await authority.downloadUri(
          metadata,
          sink,
          context,
        );
    } catch (error) {
      const sanitized =
        sanitizeUriFailure(
          error,
        );

      if (
        sinkFailure === undefined &&
        isTransientTransportFailure(
          sanitized,
        )
      ) {
        retryable =
          sanitized;
      }

      throw sanitized;
    } finally {
      sinkClosed =
        true;

      // No old writer may continue into cleanup or a next attempt.
      await activeWrite;
    }

    if (
      downloaded === null ||
      typeof downloaded !==
        "object" ||
      downloaded.mimeType !==
        GOOGLE_GENAI_OUTPUT_VIDEO_MIME_TYPE
    ) {
      throw transportFailure(
        "DOWNLOAD_CONTENT_TYPE_INVALID",
      );
    }

    if (
      byteCount !==
        expected.byteCount ||
      downloaded.byteCount !==
        expected.byteCount
    ) {
      throw transportFailure(
        "DOWNLOAD_SIZE_MISMATCH",
      );
    }

    const localDigest =
      hash.digest();

    if (
      typeof downloaded.sha256 !==
        "string" ||
      !digestEquals(
        localDigest,
        expected.sha256,
      ) ||
      !digestEquals(
        localDigest,
        downloaded.sha256,
      )
    ) {
      throw transportFailure(
        "DOWNLOAD_HASH_MISMATCH",
      );
    }

    if (
      !mp4PrefixIsValid(
        prefix,
        byteCount,
      )
    ) {
      throw transportFailure(
        "DOWNLOAD_MP4_INVALID",
      );
    }

    // Expiry observable after the download admits no new sync.
    requireAuthority(
      context,
    );

    try {
      await handle.sync();
    } catch {
      throw transportFailure(
        "TEMP_WRITE_FAILED",
      );
    }

    // Expiry during sync: the owned handle is still closed and unlinked by
    // cleanup below, but nothing further is admitted.
    requireAuthority(
      context,
    );

    handleOpen =
      false;

    try {
      await handle.close();
    } catch {
      throw transportFailure(
        "TEMP_WRITE_FAILED",
      );
    }

    // Expiry during close admits no hard-link publication.
    requireAuthority(
      context,
    );

    const outcome =
      await publishVerifiedTemporaryFileNoOverwrite(
        fileSystem,
        temporaryPath,
        finalPath,
        expected,
        {
          link:
            () =>
              fileSystem.link(
                temporaryPath,
                finalPath,
              ),

          checkpoint:
            () =>
              requireAuthority(
                context,
              ),

          existingFinalHoldsExpected:
            uriFinalHoldsExpectedContent,

          rejectLinkFailure:
            () =>
              transportFailure(
                "OUTPUT_PUBLICATION_FAILED",
              ),

          rejectMissingAfterCollision:
            () =>
              transportFailure(
                "OUTPUT_PUBLICATION_FAILED",
              ),

          rejectCopyFailure:
            (cause, ownedFinalCleanupFailed) => {
              if (ownedFinalCleanupFailed) {
                ownedFinalCleanupFailures +=
                  1;
              }

              // Abort/budget keep their sanitized class; anything else is a publication failure.
              return cause instanceof
                GoogleGenAiSecureOutputTransportError
                ? cause
                : transportFailure(
                    "OUTPUT_PUBLICATION_FAILED",
                  );
            },
        },
      );

    published =
      true;

    alreadyPresent =
      outcome ===
      "ALREADY_PRESENT";
  } catch (error) {
    failed =
      true;

    // Sanitized before retention, rethrow or aggregation.
    primary =
      sanitizeUriFailure(
        error,
      );
  }

  const cleanupFailures:
    GoogleGenAiSecureOutputTransportError[] = [];

  if (handleOpen) {
    try {
      await handle.close();
    } catch {
      // Close failure still attempts the unlink and blocks any retry.
      cleanupFailures.push(
        transportFailure(
          "TEMP_CLEANUP_FAILED",
        ),
      );
    }
  }

  try {
    await fileSystem.unlink(
      temporaryPath,
    );
  } catch {
    cleanupFailures.push(
      transportFailure(
        "TEMP_CLEANUP_FAILED",
      ),
    );
  }

  // A partial final this invocation created could not be removed.
  if (ownedFinalCleanupFailures > 0) {
    cleanupFailures.push(
      transportFailure(
        "TEMP_CLEANUP_FAILED",
      ),
    );
  }

  const cleanupFailure =
    cleanupFailures[0];

  if (failed) {
    if (cleanupFailure !== undefined) {
      throw new AggregateError(
        [
          primary,
          cleanupFailure,
        ],
        "Google GenAI output download failed and its temporary file could not be cleaned up.",
      );
    }

    if (retryable !== undefined) {
      return Object.freeze({
        kind:
          "RETRYABLE",

        failure:
          retryable,
      });
    }

    throw primary;
  }

  // A published final is never removed; a cleanup failure is surfaced and
  // the invocation does not report success.
  if (cleanupFailure !== undefined) {
    throw cleanupFailure;
  }

  if (!published) {
    throw transportFailure(
      "OUTPUT_PUBLICATION_FAILED",
    );
  }

  return Object.freeze({
    kind:
      "PUBLISHED",

    alreadyPresent,
  });
}

/**
 * Sole Files download retry owner. Every attempt prepares fresh metadata
 * before any temp exists; a typed transient metadata or download failure
 * consumes an attempt. A retry is admitted only when the published delay
 * plus a full next attempt (metadata then download timeout) fits the
 * shared context budget, waits abortably, and rechecks before starting.
 */
async function materializeUriOutput(
  fileSystem:
    GoogleGenAiOutputFileSystem,
  finalPath:
    string,
  uri:
    string,
  authority:
    UriMaterializationAuthority,
): Promise<
  Readonly<{
    expected:
      ExpectedContent;

    alreadyPresent:
      boolean;
  }>
> {
  const {
    context,
  } =
    authority;

  let binding:
    ContentBinding | undefined;

  let directoryReady =
    false;

  for (
    let attempt = 1;
    ;
    attempt += 1
  ) {
    if (attempt > 1) {
      if (
        remainingBudgetMs(
          context,
        ) <
        authority.retryDelayMs +
          authority.nextAttemptMs
      ) {
        throw transportFailure(
          "RECOVERY_BUDGET_EXHAUSTED",
        );
      }

      await waitForRetry(
        authority.retryDelayMs,
        context.signal,
      );

      if (
        remainingBudgetMs(
          context,
        ) <
        authority.nextAttemptMs
      ) {
        throw transportFailure(
          "RECOVERY_BUDGET_EXHAUSTED",
        );
      }
    }

    requireActive(
      context,
    );

    let metadata:
      GoogleGenAiVerifiedFileMetadata;

    try {
      metadata =
        await authority.prepareUri(
          {
            uri,

            maxOutputBytes:
              authority.maxOutputBytes,
          },
          context,
        );
    } catch (error) {
      const sanitized =
        sanitizeUriFailure(
          error,
        );

      if (
        attempt <
          authority.maxAttempts &&
        isTransientTransportFailure(
          sanitized,
        )
      ) {
        continue;
      }

      throw sanitized;
    }

    binding =
      requirePreparedMetadata(
        metadata,
        uri,
        authority.maxOutputBytes,
        binding,
      );

    const expected:
      ExpectedContent =
      Object.freeze({
        byteCount:
          binding.byteCount,

        sha256:
          binding.sha256,
      });

    requireActive(
      context,
    );

    if (!directoryReady) {
      try {
        await fileSystem.mkdir(
          dirname(
            finalPath,
          ),
          {
            recursive:
              true,
          },
        );
      } catch {
        throw transportFailure(
          "OUTPUT_PUBLICATION_FAILED",
        );
      }

      directoryReady =
        true;
    }

    if (
      await uriFinalHoldsExpectedContent(
        fileSystem,
        finalPath,
        expected,
      )
    ) {
      return Object.freeze({
        expected,

        alreadyPresent:
          true,
      });
    }

    requireActive(
      context,
    );

    const outcome =
      await streamUriOutputAttempt(
        fileSystem,
        finalPath,
        metadata,
        authority,
      );

    if (
      outcome.kind ===
      "PUBLISHED"
    ) {
      return Object.freeze({
        expected,

        alreadyPresent:
          outcome.alreadyPresent,
      });
    }

    if (
      attempt >=
      authority.maxAttempts
    ) {
      throw outcome.failure;
    }
  }
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

  if (
    data === undefined &&
    uri !== undefined
  ) {
    // Every URI-only dependency is required before any URI work; there is
    // no whole-buffer or inline fallback.
    const authority =
      requireUriAuthority(
        dependencies,
        maxOutputBytes,
      );

    requireDownloadableUri(
      uri,
    );

    const streamed =
      await materializeUriOutput(
        dependencies.fileSystem ??
          NODE_OUTPUT_FILE_SYSTEM,
        outputPath,
        uri,
        authority,
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
        streamed.expected.byteCount,

      sha256:
        streamed.expected.sha256,

      sourceKind:
        "URI",

      alreadyPresent:
        streamed.alreadyPresent,
    });
  }

  if (data === undefined) {
    throw new Error(
      "Google GenAI output_video must provide exactly one of data or uri.",
    );
  }

  // Historical injected inline output only; production replay never
  // yields inline data and a URI is never converted to inline.
  const bytes =
    requireBoundedBytes(
      decodeStrictBase64(
        data,
        maxOutputBytes,
      ),
      maxOutputBytes,
    );

  const sourceKind:
    GoogleGenAiOutputSourceKind =
    "INLINE_DATA";

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
