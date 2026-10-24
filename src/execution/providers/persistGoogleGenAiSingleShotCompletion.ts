import {
  createHash,
  randomUUID,
} from "node:crypto";

import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
} from "node:fs/promises";

import {
  basename,
  dirname,
  join,
  resolve,
} from "node:path";

import {
  isDeepStrictEqual,
} from "node:util";

import {
  GOOGLE_GENAI_GENERATION_OUTPUT_CONTENT_TYPE,
  GOOGLE_GENAI_GENERATION_RECORD_SCHEMA_VERSION,
  GoogleGenAiGenerationRecordSchema,
  type GoogleGenAiGenerationRecord,
} from "../../googleGenai/audit/googleGenAiGenerationRecord.schema.js";

import {
  createGoogleGenAiGenerationRecordPath,
} from "../../googleGenai/audit/googleGenAiGenerationRecordPath.js";

import {
  readGoogleGenAiGenerationRecord,
} from "../../googleGenai/audit/readGoogleGenAiGenerationRecord.js";

import {
  GOOGLE_GENAI_PROVIDER,
} from "../../googleGenai/googleGenAi.types.js";

import {
  GOOGLE_GENAI_VIDEO_OUTPUT_INDEX,
  createGoogleGenAiVideoOutputPath,
} from "../../googleGenai/output/googleGenAiVideoOutputPath.js";

import {
  createExecutionCompletionPath,
} from "../executionCompletionPath.js";

import {
  GOOGLE_GENAI_EXECUTION_COMPLETION_SCHEMA_VERSION,
  GoogleGenAiExecutionCompletionSchema,
  type GoogleGenAiExecutionCompletion,
} from "../googleGenAiExecutionCompletion.schema.js";

import {
  readExecutionReservation,
} from "../readExecutionReservation.js";

import {
  readExecutionSubmission,
} from "../readExecutionSubmission.js";

import {
  readGoogleGenAiExecutionCompletion,
} from "../readGoogleGenAiExecutionCompletion.js";

import type {
  GoogleGenAiSingleShotOutputMaterializationResult,
} from "./materializeGoogleGenAiSingleShotOutput.js";

/**
 * Dormant Google GenAI single-shot completion persistence.
 *
 * Local persistence only: reads the durable reservation and submission 1.4
 * as the identity authority, re-verifies the already-materialized output on
 * disk, then publishes the Google generation record followed by the Google
 * 1.1 execution completion. Both JSON records are published with an
 * exclusive hard link from a fully written and fsynced temporary file and
 * are never replaced. An existing completion is only ever verified; this
 * adapter never creates evidence underneath it. No provider call, retry,
 * resubmission, routing, or reconciliation happens here.
 */

export type GoogleGenAiCompletionFileHandle =
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
  }>;

export type GoogleGenAiCompletionFileSystem =
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
          "wx",
      ) =>
        Promise<GoogleGenAiCompletionFileHandle>;

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
  }>;

export type GoogleGenAiSingleShotCompletionPersistenceInput =
  Readonly<{
    mediaRoot:
      string;

    episodeId:
      string;

    shotId:
      string;

    materializedOutput:
      GoogleGenAiSingleShotOutputMaterializationResult;
  }>;

export type GoogleGenAiSingleShotCompletionPersistenceDependencies =
  Readonly<{
    now?:
      () => string;

    fileSystem?:
      GoogleGenAiCompletionFileSystem;
  }>;

export type GoogleGenAiSingleShotCompletionPersistenceResult =
  Readonly<{
    provider:
      typeof GOOGLE_GENAI_PROVIDER;

    providerExecutionId:
      string;

    generationRecordPath:
      string;

    generationRecord:
      GoogleGenAiGenerationRecord;

    generationRecordAlreadyPresent:
      boolean;

    completionPath:
      string;

    completion:
      GoogleGenAiExecutionCompletion;

    completionAlreadyPresent:
      boolean;
  }>;

type VerifiedOutputEvidence =
  Readonly<{
    destinationPath:
      string;

    bytes:
      number;

    sha256:
      string;
  }>;

type ExpectedGenerationIdentity =
  Omit<
    GoogleGenAiGenerationRecord,
    "recordedAt"
  >;

type ExpectedCompletionIdentity =
  Omit<
    GoogleGenAiExecutionCompletion,
    "completedAt"
  >;

const NODE_COMPLETION_FILE_SYSTEM:
  GoogleGenAiCompletionFileSystem =
  Object.freeze({
    mkdir,
    open,
    link,
    unlink,
  });

const FORBIDDEN_CALLER_IDENTITY_FIELDS =
  Object.freeze([
    "providerExecutionId",
    "interactionId",
    "provider",
    "reservationId",
  ]);

const SHA256_PATTERN =
  /^[a-f0-9]{64}$/;

const OUTPUT_HASH_CHUNK_BYTES =
  1024 * 1024;

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

function requireMaterializedEvidence(
  materializedOutput:
    GoogleGenAiSingleShotOutputMaterializationResult,

  providerExecutionId:
    string,

  canonicalOutputPath:
    string,
): void {
  if (
    materializedOutput.provider !==
    GOOGLE_GENAI_PROVIDER
  ) {
    throw new Error(
      `Google GenAI completion persistence requires ${GOOGLE_GENAI_PROVIDER} materialized output; received ${String(materializedOutput.provider)}.`,
    );
  }

  if (
    materializedOutput.providerExecutionId !==
    providerExecutionId
  ) {
    throw new Error(
      "Google GenAI materialized output providerExecutionId does not match the durable submission.",
    );
  }

  if (
    materializedOutput.outputIndex !==
    GOOGLE_GENAI_VIDEO_OUTPUT_INDEX
  ) {
    throw new Error(
      `Google GenAI materialized output index must be ${GOOGLE_GENAI_VIDEO_OUTPUT_INDEX}; received ${String(materializedOutput.outputIndex)}.`,
    );
  }

  if (
    materializedOutput.outputPath !==
    canonicalOutputPath
  ) {
    throw new Error(
      `Google GenAI materialized output path does not match the canonical output path ${canonicalOutputPath}.`,
    );
  }

  if (
    materializedOutput.mimeType !==
    GOOGLE_GENAI_GENERATION_OUTPUT_CONTENT_TYPE
  ) {
    throw new Error(
      `Google GenAI materialized output MIME type must be ${GOOGLE_GENAI_GENERATION_OUTPUT_CONTENT_TYPE}.`,
    );
  }

  if (
    typeof materializedOutput.byteCount !==
      "number" ||
    !Number.isSafeInteger(
      materializedOutput.byteCount,
    ) ||
    materializedOutput.byteCount <= 0
  ) {
    throw new Error(
      "Google GenAI materialized output byteCount must be a positive safe integer.",
    );
  }

  if (
    typeof materializedOutput.sha256 !==
      "string" ||
    !SHA256_PATTERN.test(
      materializedOutput.sha256,
    )
  ) {
    throw new Error(
      "Google GenAI materialized output sha256 must be a lowercase 64-character hexadecimal digest.",
    );
  }
}

async function hashOutputFile(
  outputPath:
    string,

  byteCount:
    number,
): Promise<string> {
  const handle =
    await open(
      outputPath,
      "r",
    );

  const hash =
    createHash(
      "sha256",
    );

  const chunk =
    new Uint8Array(
      Math.min(
        OUTPUT_HASH_CHUNK_BYTES,
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
          `Google GenAI output ${outputPath} ended before its verified size.`,
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
    try {
      await handle.close();
    } catch (closeError) {
      throw new AggregateError(
        [
          error,
          closeError,
        ],
        `Google GenAI output ${outputPath} could not be hashed and its file handle could not be closed.`,
      );
    }

    throw error;
  }

  await handle.close();

  return hash.digest(
    "hex",
  );
}

async function verifyLocalOutput(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  materializedOutput:
    GoogleGenAiSingleShotOutputMaterializationResult,
): Promise<VerifiedOutputEvidence> {
  const outputPath =
    materializedOutput.outputPath;

  let stats:
    Awaited<
      ReturnType<
        typeof lstat
      >
    >;

  try {
    stats =
      await lstat(
        outputPath,
      );
  } catch (error) {
    throw new Error(
      `Google GenAI materialized output does not exist: ${outputPath}`,
      {
        cause:
          error,
      },
    );
  }

  if (!stats.isFile()) {
    throw new Error(
      `Google GenAI materialized output is not a regular file: ${outputPath}`,
    );
  }

  const shotDirectory =
    resolve(
      mediaRoot,
      "generated-video",
      episodeId,
      shotId,
    );

  const [
    realShotDirectory,
    realOutputDirectory,
  ] =
    await Promise.all([
      realpath(
        shotDirectory,
      ),

      realpath(
        dirname(
          outputPath,
        ),
      ),
    ]);

  if (
    realOutputDirectory !==
    realShotDirectory
  ) {
    throw new Error(
      `Google GenAI materialized output must be inside the shot directory ${shotDirectory}.`,
    );
  }

  if (stats.size === 0) {
    throw new Error(
      `Google GenAI materialized output is empty: ${outputPath}`,
    );
  }

  if (
    stats.size !==
    materializedOutput.byteCount
  ) {
    throw new Error(
      `Google GenAI materialized output is ${stats.size} bytes; evidence records ${materializedOutput.byteCount}.`,
    );
  }

  const sha256 =
    await hashOutputFile(
      outputPath,
      materializedOutput.byteCount,
    );

  if (
    sha256 !==
    materializedOutput.sha256
  ) {
    throw new Error(
      `Google GenAI materialized output SHA-256 ${sha256} does not match evidence ${materializedOutput.sha256}.`,
    );
  }

  return Object.freeze({
    destinationPath:
      outputPath,

    bytes:
      materializedOutput.byteCount,

    sha256,
  });
}

function generationIdentity(
  record:
    GoogleGenAiGenerationRecord,
): ExpectedGenerationIdentity {
  const {
    recordedAt: _recordedAt,
    ...identity
  } = record;

  return identity;
}

function completionIdentity(
  completion:
    GoogleGenAiExecutionCompletion,
): ExpectedCompletionIdentity {
  const {
    completedAt: _completedAt,
    ...identity
  } = completion;

  return identity;
}

function requireMatchingGenerationRecord(
  existing:
    GoogleGenAiGenerationRecord,

  expected:
    ExpectedGenerationIdentity,

  recordPath:
    string,
): void {
  if (
    !isDeepStrictEqual(
      generationIdentity(
        existing,
      ),
      expected,
    )
  ) {
    throw new Error(
      `Existing Google GenAI generation record does not match the verified output evidence: ${recordPath}`,
    );
  }
}

function requireMatchingCompletion(
  existing:
    GoogleGenAiExecutionCompletion,

  expected:
    ExpectedCompletionIdentity,

  completionPath:
    string,
): void {
  if (
    existing.generationRecordPath !==
    expected.generationRecordPath
  ) {
    throw new Error(
      `Existing Google GenAI execution completion references a non-canonical generation record ${existing.generationRecordPath}; expected ${expected.generationRecordPath}.`,
    );
  }

  if (
    !isDeepStrictEqual(
      completionIdentity(
        existing,
      ),
      expected,
    )
  ) {
    throw new Error(
      `Existing Google GenAI execution completion does not match durable execution evidence: ${completionPath}`,
    );
  }
}

/**
 * Publishes the serialized record at finalPath with an exclusive hard link.
 * Returns "PUBLISHED" when this invocation created finalPath and "EXISTS"
 * when another writer already owns it. Never replaces an existing file.
 */
async function publishJsonRecordExclusively(
  fileSystem:
    GoogleGenAiCompletionFileSystem,

  finalPath:
    string,

  serialized:
    string,
): Promise<"PUBLISHED" | "EXISTS"> {
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

  const temporaryPath =
    join(
      directory,
      `.${basename(finalPath)}.${randomUUID()}.part`,
    );

  let temporaryCreated =
    false;

  let outcome:
    "PUBLISHED" | "EXISTS" =
      "PUBLISHED";

  let failed =
    false;

  let failure:
    unknown;

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
        Buffer.from(
          serialized,
          "utf8",
        ),
      );

      await handle.sync();
    } catch (error) {
      try {
        await handle.close();
      } catch (closeError) {
        throw new AggregateError(
          [
            error,
            closeError,
          ],
          `Google GenAI record ${finalPath} could not be written and its temporary file handle could not be closed.`,
        );
      }

      throw error;
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
          `Google GenAI record hard-link publication to ${finalPath} failed. No rename, copy, or direct-write fallback is permitted.`,
          {
            cause:
              error,
          },
        );
      }

      outcome =
        "EXISTS";
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
          `Google GenAI record publication to ${finalPath} failed and temporary file ${temporaryPath} could not be removed.`,
        );
      }

      throw new Error(
        `Google GenAI record publication to ${finalPath} finished, but temporary file ${temporaryPath} could not be removed.`,
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

  return outcome;
}

function serializeRecord(
  record:
    GoogleGenAiGenerationRecord | GoogleGenAiExecutionCompletion,
): string {
  return `${JSON.stringify(
    record,
    null,
    2,
  )}\n`;
}

function freezeGenerationRecord(
  record:
    GoogleGenAiGenerationRecord,
): GoogleGenAiGenerationRecord {
  Object.freeze(
    record.outputs[0],
  );

  Object.freeze(
    record.outputs,
  );

  return Object.freeze(
    record,
  );
}

export async function persistGoogleGenAiSingleShotCompletion(
  input:
    GoogleGenAiSingleShotCompletionPersistenceInput,

  dependencies:
    GoogleGenAiSingleShotCompletionPersistenceDependencies =
      {},
): Promise<
  GoogleGenAiSingleShotCompletionPersistenceResult
> {
  for (
    const field of FORBIDDEN_CALLER_IDENTITY_FIELDS
  ) {
    if (
      Object.hasOwn(
        input,
        field,
      )
    ) {
      throw new Error(
        `Google GenAI completion persistence does not accept a caller-supplied ${field}; durable records are authoritative.`,
      );
    }
  }

  const reservation =
    await readExecutionReservation(
      input.mediaRoot,
      input.episodeId,
      input.shotId,
    );

  if (!reservation) {
    throw new Error(
      `Google GenAI completion persistence requires a durable reservation for ${input.episodeId}/${input.shotId}.`,
    );
  }

  if (
    reservation.provider !==
    GOOGLE_GENAI_PROVIDER
  ) {
    throw new Error(
      `Google GenAI completion persistence requires a ${GOOGLE_GENAI_PROVIDER} reservation; received ${reservation.provider}.`,
    );
  }

  if (
    reservation.episodeId !==
      input.episodeId ||
    reservation.shotId !==
      input.shotId
  ) {
    throw new Error(
      "Google GenAI completion persistence identity does not match the durable reservation.",
    );
  }

  const submission =
    await readExecutionSubmission(
      input.mediaRoot,
      input.episodeId,
      input.shotId,
    );

  if (!submission) {
    throw new Error(
      `Google GenAI completion persistence requires a durable submission for ${input.episodeId}/${input.shotId}.`,
    );
  }

  if (
    submission.provider !==
    GOOGLE_GENAI_PROVIDER
  ) {
    throw new Error(
      `Google GenAI completion persistence requires a ${GOOGLE_GENAI_PROVIDER} submission; received ${submission.provider}.`,
    );
  }

  if (
    submission.reservationId !==
      reservation.reservationId ||
    submission.episodeId !==
      reservation.episodeId ||
    submission.shotId !==
      reservation.shotId
  ) {
    throw new Error(
      "Google GenAI submission identity does not match the durable reservation.",
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

  const canonicalOutputPath =
    createGoogleGenAiVideoOutputPath(
      input.mediaRoot,
      reservation.episodeId,
      reservation.shotId,
      providerExecutionId,
    );

  requireMaterializedEvidence(
    input.materializedOutput,
    providerExecutionId,
    canonicalOutputPath,
  );

  const verified =
    await verifyLocalOutput(
      input.mediaRoot,
      reservation.episodeId,
      reservation.shotId,
      input.materializedOutput,
    );

  const generationRecordPath =
    createGoogleGenAiGenerationRecordPath(
      input.mediaRoot,
      reservation.episodeId,
      reservation.shotId,
      providerExecutionId,
    );

  const completionPath =
    createExecutionCompletionPath(
      input.mediaRoot,
      reservation.episodeId,
      reservation.shotId,
    );

  const expectedGeneration:
    ExpectedGenerationIdentity = {
      schemaVersion:
        GOOGLE_GENAI_GENERATION_RECORD_SCHEMA_VERSION,

      reservationId:
        reservation.reservationId,

      provider:
        GOOGLE_GENAI_PROVIDER,

      episodeId:
        reservation.episodeId,

      shotId:
        reservation.shotId,

      providerExecutionId,

      outputs: [
        {
          outputIndex:
            GOOGLE_GENAI_VIDEO_OUTPUT_INDEX,

          destinationPath:
            verified.destinationPath,

          bytes:
            verified.bytes,

          sha256:
            verified.sha256,

          contentType:
            GOOGLE_GENAI_GENERATION_OUTPUT_CONTENT_TYPE,
        },
      ],
    };

  const expectedCompletion:
    ExpectedCompletionIdentity = {
      schemaVersion:
        GOOGLE_GENAI_EXECUTION_COMPLETION_SCHEMA_VERSION,

      status:
        "COMPLETED",

      reservationId:
        reservation.reservationId,

      episodeId:
        reservation.episodeId,

      shotId:
        reservation.shotId,

      provider:
        GOOGLE_GENAI_PROVIDER,

      providerExecutionId,

      generationRecordPath,
    };

  const readGenerationRecord =
    () =>
      readGoogleGenAiGenerationRecord(
        input.mediaRoot,
        reservation.episodeId,
        reservation.shotId,
        providerExecutionId,
      );

  const readCompletion =
    () =>
      readGoogleGenAiExecutionCompletion(
        input.mediaRoot,
        reservation.episodeId,
        reservation.shotId,
      );

  // CASE A: an existing completion is only ever verified. No generation
  // record is created underneath it.
  const preexistingCompletion =
    await readCompletion();

  if (preexistingCompletion) {
    requireMatchingCompletion(
      preexistingCompletion,
      expectedCompletion,
      completionPath,
    );

    const referencedRecord =
      await readGenerationRecord();

    if (!referencedRecord) {
      throw new Error(
        `Google GenAI execution completion exists but its generation record is missing: ${generationRecordPath}. Refusing to recreate evidence underneath an existing completion.`,
      );
    }

    requireMatchingGenerationRecord(
      referencedRecord,
      expectedGeneration,
      generationRecordPath,
    );

    return Object.freeze({
      provider:
        GOOGLE_GENAI_PROVIDER,

      providerExecutionId,

      generationRecordPath,

      generationRecord:
        freezeGenerationRecord(
          referencedRecord,
        ),

      generationRecordAlreadyPresent:
        true,

      completionPath,

      completion:
        Object.freeze(
          preexistingCompletion,
        ),

      completionAlreadyPresent:
        true,
    });
  }

  // CASE B: generation record first, then completion.
  const now =
    dependencies.now ??
    (() =>
      new Date()
        .toISOString());

  const fileSystem =
    dependencies.fileSystem ??
    NODE_COMPLETION_FILE_SYSTEM;

  let generationRecord:
    GoogleGenAiGenerationRecord;

  let generationRecordAlreadyPresent:
    boolean;

  const existingRecord =
    await readGenerationRecord();

  if (existingRecord) {
    requireMatchingGenerationRecord(
      existingRecord,
      expectedGeneration,
      generationRecordPath,
    );

    generationRecord =
      existingRecord;

    generationRecordAlreadyPresent =
      true;
  } else {
    const candidate =
      GoogleGenAiGenerationRecordSchema
        .parse({
          ...expectedGeneration,

          recordedAt:
            now(),
        });

    const outcome =
      await publishJsonRecordExclusively(
        fileSystem,
        generationRecordPath,
        serializeRecord(
          candidate,
        ),
      );

    if (outcome === "PUBLISHED") {
      generationRecord =
        candidate;

      generationRecordAlreadyPresent =
        false;
    } else {
      const winner =
        await readGenerationRecord();

      if (!winner) {
        throw new Error(
          `Google GenAI generation record publication reported EEXIST but no record is present: ${generationRecordPath}`,
        );
      }

      requireMatchingGenerationRecord(
        winner,
        expectedGeneration,
        generationRecordPath,
      );

      generationRecord =
        winner;

      generationRecordAlreadyPresent =
        true;
    }
  }

  const completionCandidate =
    GoogleGenAiExecutionCompletionSchema
      .parse({
        ...expectedCompletion,

        completedAt:
          now(),
      });

  let completion:
    GoogleGenAiExecutionCompletion;

  let completionAlreadyPresent:
    boolean;

  const completionOutcome =
    await publishJsonRecordExclusively(
      fileSystem,
      completionPath,
      serializeRecord(
        completionCandidate,
      ),
    );

  if (completionOutcome === "PUBLISHED") {
    completion =
      completionCandidate;

    completionAlreadyPresent =
      false;
  } else {
    const winner =
      await readCompletion();

    if (!winner) {
      throw new Error(
        `Google GenAI execution completion publication reported EEXIST but no completion is present: ${completionPath}`,
      );
    }

    requireMatchingCompletion(
      winner,
      expectedCompletion,
      completionPath,
    );

    completion =
      winner;

    completionAlreadyPresent =
      true;
  }

  return Object.freeze({
    provider:
      GOOGLE_GENAI_PROVIDER,

    providerExecutionId,

    generationRecordPath,

    generationRecord:
      freezeGenerationRecord(
        generationRecord,
      ),

    generationRecordAlreadyPresent,

    completionPath,

    completion:
      Object.freeze(
        completion,
      ),

    completionAlreadyPresent,
  });
}
