import {
  createHash,
} from "node:crypto";

import {
  lstat,
  open,
  realpath,
} from "node:fs/promises";

import {
  dirname,
  resolve,
} from "node:path";

import type {
  GoogleGenAiGenerationRecord,
} from "../googleGenai/audit/googleGenAiGenerationRecord.schema.js";

import {
  createGoogleGenAiGenerationRecordPath,
} from "../googleGenai/audit/googleGenAiGenerationRecordPath.js";

import {
  readGoogleGenAiGenerationRecord,
} from "../googleGenai/audit/readGoogleGenAiGenerationRecord.js";

import {
  GOOGLE_GENAI_PROVIDER,
} from "../googleGenai/googleGenAi.types.js";

import {
  GOOGLE_GENAI_VIDEO_OUTPUT_INDEX,
  createGoogleGenAiVideoOutputPath,
} from "../googleGenai/output/googleGenAiVideoOutputPath.js";

import type {
  GoogleGenAiExecutionCompletion,
} from "./googleGenAiExecutionCompletion.schema.js";

import {
  inspectGoogleGenAiExecutionLifecycle,
} from "./inspectGoogleGenAiExecutionLifecycle.js";

/**
 * Read-only proof of a Google GenAI BusyBookie durable completion.
 *
 * Re-establishes identity from the durable reservation and submission on
 * every call, derives every path from canonical helpers (never from JSON
 * fields alone), and verifies the published output bytes on disk. It never
 * contacts a provider and never writes.
 */

export type GoogleGenAiDurableCompletionVerification =
  Readonly<{
    provider:
      typeof GOOGLE_GENAI_PROVIDER;

    providerExecutionId:
      string;

    reservationId:
      string;

    episodeId:
      string;

    shotId:
      string;

    completionPath:
      string;

    completion:
      GoogleGenAiExecutionCompletion;

    generationRecordPath:
      string;

    generationRecord:
      GoogleGenAiGenerationRecord;

    outputPath:
      string;

    bytes:
      number;

    sha256:
      string;
  }>;

const OUTPUT_HASH_CHUNK_BYTES =
  1024 * 1024;

const GOOGLE_GENAI_OUTPUT_CONTENT_TYPE =
  "video/mp4";

async function hashExactBytes(
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
          `Google GenAI durable output ${outputPath} ended before its recorded size.`,
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
        `Google GenAI durable output ${outputPath} could not be hashed and its file handle could not be closed.`,
      );
    }

    throw error;
  }

  await handle.close();

  return hash.digest(
    "hex",
  );
}

export async function verifyGoogleGenAiDurableCompletion(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,
): Promise<GoogleGenAiDurableCompletionVerification> {
  const inspection =
    await inspectGoogleGenAiExecutionLifecycle(
      mediaRoot,
      episodeId,
      shotId,
    );

  if (
    inspection.state !==
    "COMPLETED"
  ) {
    throw new Error(
      `Google GenAI durable completion verification requires COMPLETED lifecycle; received ${inspection.state}.`,
    );
  }

  const {
    reservation,
    submission,
    completion,
    completionPath,
  } = inspection;

  const providerExecutionId =
    submission.providerExecutionId;

  const canonicalRecordPath =
    createGoogleGenAiGenerationRecordPath(
      mediaRoot,
      reservation.episodeId,
      reservation.shotId,
      providerExecutionId,
    );

  if (
    completion.generationRecordPath !==
    canonicalRecordPath
  ) {
    throw new Error(
      `Google GenAI execution completion references a non-canonical generation record ${completion.generationRecordPath}; expected ${canonicalRecordPath}.`,
    );
  }

  const generationRecord =
    await readGoogleGenAiGenerationRecord(
      mediaRoot,
      reservation.episodeId,
      reservation.shotId,
      providerExecutionId,
    );

  if (!generationRecord) {
    throw new Error(
      `Google GenAI generation record is missing for a durable completion: ${canonicalRecordPath}`,
    );
  }

  if (
    generationRecord.reservationId !==
      reservation.reservationId ||
    generationRecord.episodeId !==
      reservation.episodeId ||
    generationRecord.shotId !==
      reservation.shotId ||
    generationRecord.provider !==
      GOOGLE_GENAI_PROVIDER ||
    generationRecord.providerExecutionId !==
      providerExecutionId
  ) {
    throw new Error(
      `Google GenAI generation record identity does not match the durable reservation and submission: ${canonicalRecordPath}`,
    );
  }

  if (
    generationRecord.outputs.length !==
    1
  ) {
    throw new Error(
      "Google GenAI generation record must contain exactly one output.",
    );
  }

  const output =
    generationRecord.outputs[0];

  if (
    output.outputIndex !==
    GOOGLE_GENAI_VIDEO_OUTPUT_INDEX
  ) {
    throw new Error(
      `Google GenAI generation record output index must be ${GOOGLE_GENAI_VIDEO_OUTPUT_INDEX}.`,
    );
  }

  if (
    output.contentType !==
    GOOGLE_GENAI_OUTPUT_CONTENT_TYPE
  ) {
    throw new Error(
      `Google GenAI generation record content type must be ${GOOGLE_GENAI_OUTPUT_CONTENT_TYPE}.`,
    );
  }

  const canonicalOutputPath =
    createGoogleGenAiVideoOutputPath(
      mediaRoot,
      reservation.episodeId,
      reservation.shotId,
      providerExecutionId,
    );

  if (
    output.destinationPath !==
    canonicalOutputPath
  ) {
    throw new Error(
      `Google GenAI generation record destination ${output.destinationPath} is not the canonical output path ${canonicalOutputPath}.`,
    );
  }

  let stats:
    Awaited<
      ReturnType<
        typeof lstat
      >
    >;

  try {
    stats =
      await lstat(
        canonicalOutputPath,
      );
  } catch (error) {
    throw new Error(
      `Google GenAI durable output does not exist: ${canonicalOutputPath}`,
      {
        cause:
          error,
      },
    );
  }

  if (!stats.isFile()) {
    throw new Error(
      `Google GenAI durable output is not a regular file: ${canonicalOutputPath}`,
    );
  }

  const shotDirectory =
    resolve(
      mediaRoot,
      "generated-video",
      reservation.episodeId,
      reservation.shotId,
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
          canonicalOutputPath,
        ),
      ),
    ]);

  if (
    realOutputDirectory !==
    realShotDirectory
  ) {
    throw new Error(
      `Google GenAI durable output must be inside the shot directory ${shotDirectory}.`,
    );
  }

  if (stats.size === 0) {
    throw new Error(
      `Google GenAI durable output is empty: ${canonicalOutputPath}`,
    );
  }

  if (
    stats.size !==
    output.bytes
  ) {
    throw new Error(
      `Google GenAI durable output is ${stats.size} bytes; generation record records ${output.bytes}.`,
    );
  }

  const sha256 =
    await hashExactBytes(
      canonicalOutputPath,
      output.bytes,
    );

  if (
    sha256 !==
    output.sha256
  ) {
    throw new Error(
      `Google GenAI durable output SHA-256 ${sha256} does not match generation record ${output.sha256}.`,
    );
  }

  return Object.freeze({
    provider:
      GOOGLE_GENAI_PROVIDER,

    providerExecutionId,

    reservationId:
      reservation.reservationId,

    episodeId:
      reservation.episodeId,

    shotId:
      reservation.shotId,

    completionPath,

    completion,

    generationRecordPath:
      canonicalRecordPath,

    generationRecord,

    outputPath:
      canonicalOutputPath,

    bytes:
      output.bytes,

    sha256,
  });
}
