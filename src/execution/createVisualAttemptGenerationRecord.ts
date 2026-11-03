import {
  createHash,
} from "node:crypto";

import {
  lstat,
  open,
  readFile,
  realpath,
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
} from "../googleGenai/audit/googleGenAiGenerationRecord.schema.js";

import {
  createGoogleGenAiGenerationRecordPath,
} from "../googleGenai/audit/googleGenAiGenerationRecordPath.js";

import {
  GOOGLE_GENAI_VIDEO_OUTPUT_INDEX,
  createGoogleGenAiVideoOutputPath,
} from "../googleGenai/output/googleGenAiVideoOutputPath.js";

import {
  inspectVisualAttemptExecutionLifecycle,
  type VisualAttemptExecutionLifecycleInspection,
} from "./inspectVisualAttemptExecutionLifecycle.js";

import {
  publishVisualAttemptExecutionRecordCreateOnce,
  serializeVisualAttemptExecutionRecord,
} from "./visualAttemptExecutionRecordPersistence.js";

/**
 * Dormant create-once Google generation-record persistence for one
 * replacement visual attempt (attempt >= 2).
 *
 * The Slice-2D attempt-aware inspector is the only identity authority: the
 * lifecycle must be exactly SUBMITTED, caller-supplied expectations are
 * cross-checks only, and the providerExecutionId comes from the durable
 * submission. Canonical output bytes must already exist; they are opened
 * read-only, bound to their pre-open filesystem identity and hashed in bounded
 * chunks over exactly the declared byte count. The generation record is
 * published once and never overwritten; an existing record is accepted only
 * when it is canonical and binds the identical identity and output. The
 * lifecycle is inspected again afterwards so lineage drift fails closed.
 *
 * It never contacts a provider, never creates output bytes and never writes
 * anything except the one canonical generation record.
 */

type SubmittedVisualAttemptExecutionLifecycleInspection =
  Extract<
    VisualAttemptExecutionLifecycleInspection,
    {
      state: "SUBMITTED";
    }
  >;

export type CreateVisualAttemptGenerationRecordInput =
  Readonly<{
    episodeId: string;
    sceneId: string;
    shotId: string;
    attemptNumber: number;

    expectedAdmissionId: string;
    expectedAdmissionSha256: string;

    expectedReservationId: string;
    expectedReservationSha256: string;

    expectedSubmissionSha256: string;

    expectedProviderExecutionId: string;

    output: Readonly<{
      outputPath: string;
      bytes: number;
      sha256: string;
    }>;
  }>;

export type CreateVisualAttemptGenerationRecordDependencies =
  Readonly<{
    now?: () => string;
  }>;

export type CreateVisualAttemptGenerationRecordResult =
  Readonly<{
    record: Readonly<GoogleGenAiGenerationRecord>;
    generationRecordPath: string;
    generationRecordSha256: string;
    outputPath: string;
    alreadyPresent: boolean;
  }>;

type OutputFileIdentity =
  Readonly<{
    dev: bigint;
    ino: bigint;
    size: bigint;
  }>;

const OUTPUT_HASH_CHUNK_BYTES =
  1024 * 1024;

const SHA256_PATTERN =
  /^[a-f0-9]{64}$/;

const FORBIDDEN_INPUT_AUTHORITY_FIELDS = [
  "reservationId",
  "providerExecutionId",
  "provider",
  "interactionId",
  "generationRecordPath",
  "generationRecordSha256",
  "destinationPath",
  "outputPath",
  "outputs",
  "recordedAt",
  "admissionId",
  "admissionSha256",
  "reservationSha256",
  "submissionSha256",
] as const;

const FORBIDDEN_OUTPUT_AUTHORITY_FIELDS = [
  "destinationPath",
  "outputIndex",
  "contentType",
  "providerExecutionId",
  "generationRecordPath",
] as const;

function nodeErrorCode(
  error: unknown,
): string | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error)
  ) {
    return null;
  }

  const code =
    (
      error as {
        code?: unknown;
      }
    ).code;

  return typeof code === "string"
    ? code
    : null;
}

function sha256(
  bytes: Buffer,
): string {
  return createHash(
    "sha256",
  )
    .update(
      bytes,
    )
    .digest(
      "hex",
    );
}

function requireNoCallerAuthority(
  input: CreateVisualAttemptGenerationRecordInput,
): void {
  if (
    typeof input !== "object" ||
    input === null
  ) {
    throw new Error(
      "Attempt-aware generation-record persistence requires an input object.",
    );
  }

  for (
    const field of FORBIDDEN_INPUT_AUTHORITY_FIELDS
  ) {
    if (
      Object.hasOwn(
        input,
        field,
      )
    ) {
      throw new Error(
        `Attempt-aware generation-record persistence refuses caller-owned authority field ${field}; identity comes only from the durable attempt-aware lifecycle.`,
      );
    }
  }

  const output: unknown =
    input.output;

  if (
    typeof output !== "object" ||
    output === null
  ) {
    throw new Error(
      "Attempt-aware generation-record persistence requires output evidence.",
    );
  }

  for (
    const field of FORBIDDEN_OUTPUT_AUTHORITY_FIELDS
  ) {
    if (
      Object.hasOwn(
        output,
        field,
      )
    ) {
      throw new Error(
        `Attempt-aware generation-record persistence refuses caller-owned output authority field ${field}.`,
      );
    }
  }
}

function requireSubmittedLifecycle(
  lifecycle: VisualAttemptExecutionLifecycleInspection,
): SubmittedVisualAttemptExecutionLifecycleInspection {
  if (
    lifecycle.state !== "SUBMITTED"
  ) {
    throw new Error(
      `Attempt-aware generation-record persistence requires SUBMITTED lifecycle; received ${lifecycle.state}.`,
    );
  }

  return lifecycle;
}

function requireExpectedChain(
  lifecycle: SubmittedVisualAttemptExecutionLifecycleInspection,
  input: CreateVisualAttemptGenerationRecordInput,
): void {
  if (
    lifecycle.episodeId !== input.episodeId ||
    lifecycle.shotId !== input.shotId ||
    lifecycle.attemptNumber !== input.attemptNumber
  ) {
    throw new Error(
      "Attempt-aware generation-record persistence lifecycle identity does not match the requested attempt.",
    );
  }

  if (
    lifecycle.sceneId !== input.sceneId
  ) {
    throw new Error(
      "Attempt-aware generation-record persistence sceneId does not match the durable admission.",
    );
  }

  if (
    lifecycle.admissionId !== input.expectedAdmissionId
  ) {
    throw new Error(
      "Attempt-aware generation-record persistence admission ID does not match expected durable admission.",
    );
  }

  if (
    lifecycle.admission.admissionSha256 !== input.expectedAdmissionSha256
  ) {
    throw new Error(
      "Attempt-aware generation-record persistence admission SHA-256 does not match expected durable admission.",
    );
  }

  if (
    lifecycle.reservationId !== input.expectedReservationId
  ) {
    throw new Error(
      "Attempt-aware generation-record persistence reservation ID does not match expected durable reservation.",
    );
  }

  if (
    lifecycle.reservation.reservationSha256 !== input.expectedReservationSha256
  ) {
    throw new Error(
      "Attempt-aware generation-record persistence reservation SHA-256 does not match expected durable reservation.",
    );
  }

  if (
    lifecycle.submission.submissionSha256 !== input.expectedSubmissionSha256
  ) {
    throw new Error(
      "Attempt-aware generation-record persistence submission SHA-256 does not match expected durable submission.",
    );
  }

  if (
    lifecycle.providerExecutionId !== lifecycle.submission.record.providerExecutionId
  ) {
    throw new Error(
      "Attempt-aware generation-record persistence lifecycle providerExecutionId does not match the durable submission.",
    );
  }

  if (
    lifecycle.submission.record.providerExecutionId !== input.expectedProviderExecutionId
  ) {
    throw new Error(
      "Attempt-aware generation-record persistence providerExecutionId does not match expected durable submission.",
    );
  }
}

function requireOutputEvidenceShape(
  output: CreateVisualAttemptGenerationRecordInput["output"],
  canonicalOutputPath: string,
): void {
  if (
    typeof output.bytes !== "number" ||
    !Number.isSafeInteger(
      output.bytes,
    ) ||
    output.bytes <= 0
  ) {
    throw new Error(
      `Attempt-aware generation-record output bytes must be a positive safe integer: ${String(output.bytes)}`,
    );
  }

  if (
    typeof output.sha256 !== "string" ||
    !SHA256_PATTERN.test(
      output.sha256,
    )
  ) {
    throw new Error(
      "Attempt-aware generation-record output sha256 must be a lowercase 64-character hexadecimal digest.",
    );
  }

  if (
    output.outputPath !== canonicalOutputPath
  ) {
    throw new Error(
      `Attempt-aware generation-record output path is not the canonical output path ${canonicalOutputPath}: ${String(output.outputPath)}`,
    );
  }
}

async function lstatRequiredOutput(
  outputPath: string,
) {
  try {
    return await lstat(
      outputPath,
      {
        bigint: true,
      },
    );
  } catch (
    error
  ) {
    if (
      nodeErrorCode(
        error,
      ) === "ENOENT"
    ) {
      throw new Error(
        `Attempt-aware generation-record output does not exist: ${outputPath}`,
        {
          cause: error,
        },
      );
    }

    throw error;
  }
}

async function requireConfinedOutput(
  shotDirectory: string,
  outputPath: string,
): Promise<void> {
  const [
    realShotDirectory,
    realOutputDirectory,
    realOutputPath,
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
      realpath(
        outputPath,
      ),
    ]);

  if (
    realOutputDirectory !== realShotDirectory
  ) {
    throw new Error(
      `Attempt-aware generation-record output parent does not resolve to the shot directory ${shotDirectory}: ${outputPath}`,
    );
  }

  const expectedRealOutputPath =
    join(
      realShotDirectory,
      basename(
        outputPath,
      ),
    );

  if (
    realOutputPath !== expectedRealOutputPath
  ) {
    throw new Error(
      `Attempt-aware generation-record output must resolve directly inside the shot directory ${realShotDirectory}; resolved ${realOutputPath}.`,
    );
  }
}

async function hashExactOutputBytes(
  outputPath: string,
  expectedIdentity: OutputFileIdentity,
  byteCount: number,
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

  try {
    const opened =
      await handle.stat({
        bigint: true,
      });

    if (
      !opened.isFile()
    ) {
      throw new Error(
        `Attempt-aware generation-record output opened as a non-regular file: ${outputPath}`,
      );
    }

    if (
      opened.dev !== expectedIdentity.dev ||
      opened.ino !== expectedIdentity.ino ||
      opened.size !== expectedIdentity.size
    ) {
      throw new Error(
        `Attempt-aware generation-record output was replaced between lstat and open: ${outputPath}`,
      );
    }

    const chunk =
      new Uint8Array(
        Math.min(
          OUTPUT_HASH_CHUNK_BYTES,
          byteCount,
        ),
      );

    let position =
      0;

    while (
      position < byteCount
    ) {
      const {
        bytesRead,
      } =
        await handle.read(
          chunk,
          0,
          Math.min(
            chunk.byteLength,
            byteCount - position,
          ),
          position,
        );

      if (
        bytesRead === 0
      ) {
        throw new Error(
          `Attempt-aware generation-record output ${outputPath} ended before its declared size.`,
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

    const after =
      await handle.stat({
        bigint: true,
      });

    if (
      after.size !== BigInt(byteCount)
    ) {
      throw new Error(
        `Attempt-aware generation-record output changed size while being hashed: ${outputPath}`,
      );
    }
  } catch (
    error
  ) {
    try {
      await handle.close();
    } catch (
      closeError
    ) {
      throw new AggregateError(
        [
          error,
          closeError,
        ],
        `Attempt-aware generation-record output ${outputPath} could not be verified and its file handle could not be closed.`,
      );
    }

    throw error;
  }

  await handle.close();

  return hash.digest(
    "hex",
  );
}

async function verifyCanonicalOutput(
  shotDirectory: string,
  outputPath: string,
  expectedBytes: number,
  expectedSha256: string,
): Promise<void> {
  if (
    dirname(
      outputPath,
    ) !== shotDirectory
  ) {
    throw new Error(
      `Attempt-aware generation-record output must be located directly inside the canonical shot directory ${shotDirectory}: ${outputPath}`,
    );
  }

  const entry =
    await lstatRequiredOutput(
      outputPath,
    );

  if (
    entry.isSymbolicLink() ||
    !entry.isFile()
  ) {
    throw new Error(
      `Attempt-aware generation-record output is not a regular file: ${outputPath}`,
    );
  }

  await requireConfinedOutput(
    shotDirectory,
    outputPath,
  );

  if (
    entry.size === 0n
  ) {
    throw new Error(
      `Attempt-aware generation-record output is empty: ${outputPath}`,
    );
  }

  if (
    entry.size !== BigInt(expectedBytes)
  ) {
    throw new Error(
      `Attempt-aware generation-record output is ${entry.size} bytes; expected ${expectedBytes}: ${outputPath}`,
    );
  }

  const actualSha256 =
    await hashExactOutputBytes(
      outputPath,
      {
        dev: entry.dev,
        ino: entry.ino,
        size: entry.size,
      },
      expectedBytes,
    );

  if (
    actualSha256 !== expectedSha256
  ) {
    throw new Error(
      `Attempt-aware generation-record output SHA-256 ${actualSha256} does not match expected ${expectedSha256}: ${outputPath}`,
    );
  }
}

function freezeGenerationRecord(
  record: GoogleGenAiGenerationRecord,
): Readonly<GoogleGenAiGenerationRecord> {
  for (
    const output of record.outputs
  ) {
    Object.freeze(
      output,
    );
  }

  Object.freeze(
    record.outputs,
  );

  return Object.freeze(
    record,
  );
}

async function readPublishedGenerationRecord(
  generationRecordPath: string,
  serialized: string,
): Promise<string> {
  const raw =
    await readFile(
      generationRecordPath,
    );

  if (
    !raw.equals(
      Buffer.from(
        serialized,
        "utf8",
      ),
    )
  ) {
    throw new Error(
      `Published Google generation record bytes are not the canonical record bytes: ${generationRecordPath}`,
    );
  }

  return sha256(
    raw,
  );
}

async function acceptExistingGenerationRecord(
  generationRecordPath: string,
  expected: GoogleGenAiGenerationRecord,
): Promise<
  Readonly<{
    record: GoogleGenAiGenerationRecord;
    generationRecordSha256: string;
  }>
> {
  const raw =
    await readFile(
      generationRecordPath,
    );

  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        raw.toString(
          "utf8",
        ),
      );
  } catch (
    error
  ) {
    throw new Error(
      `Existing Google generation record is not valid JSON and will not be overwritten: ${generationRecordPath}`,
      {
        cause: error,
      },
    );
  }

  const validated =
    GoogleGenAiGenerationRecordSchema
      .safeParse(
        parsed,
      );

  if (
    !validated.success
  ) {
    throw new Error(
      `Existing Google generation record fails its schema and will not be overwritten: ${generationRecordPath}`,
      {
        cause: validated.error,
      },
    );
  }

  const record =
    validated.data;

  if (
    !raw.equals(
      Buffer.from(
        serializeVisualAttemptExecutionRecord(
          record,
        ),
        "utf8",
      ),
    )
  ) {
    throw new Error(
      `Existing Google generation record bytes are not canonical and will not be overwritten: ${generationRecordPath}`,
    );
  }

  if (
    record.reservationId !== expected.reservationId
  ) {
    throw new Error(
      `Existing Google generation record belongs to reservation ${record.reservationId}, not the attempt-aware reservation ${expected.reservationId}: ${generationRecordPath}`,
    );
  }

  if (
    record.episodeId !== expected.episodeId ||
    record.shotId !== expected.shotId ||
    record.provider !== expected.provider ||
    record.providerExecutionId !== expected.providerExecutionId
  ) {
    throw new Error(
      `Existing Google generation record identity does not match the attempt-aware execution chain: ${generationRecordPath}`,
    );
  }

  if (
    record.outputs.length !== 1 ||
    !isDeepStrictEqual(
      record.outputs,
      expected.outputs,
    )
  ) {
    throw new Error(
      `Existing Google generation record output does not match the verified canonical output: ${generationRecordPath}`,
    );
  }

  return Object.freeze({
    record,
    generationRecordSha256:
      sha256(
        raw,
      ),
  });
}

async function requireStableLineage(
  mediaRoot: string,
  input: CreateVisualAttemptGenerationRecordInput,
  lifecycle: SubmittedVisualAttemptExecutionLifecycleInspection,
): Promise<void> {
  const attemptLabel =
    `${lifecycle.episodeId}/${lifecycle.shotId}/a${lifecycle.attemptNumber}`;

  let reinspection:
    VisualAttemptExecutionLifecycleInspection;

  try {
    reinspection =
      await inspectVisualAttemptExecutionLifecycle(
        mediaRoot,
        input.episodeId,
        input.shotId,
        input.attemptNumber,
      );
  } catch (
    error
  ) {
    throw new Error(
      `Attempt-aware lineage changed during generation-record persistence for ${attemptLabel}; reinspection failed.`,
      {
        cause: error,
      },
    );
  }

  if (
    reinspection.state !== "SUBMITTED" ||
    !isDeepStrictEqual(
      reinspection,
      lifecycle,
    )
  ) {
    throw new Error(
      `Attempt-aware lineage changed during generation-record persistence for ${attemptLabel}; reinspection reported ${reinspection.state}.`,
    );
  }
}

export async function createVisualAttemptGenerationRecord(
  mediaRoot: string,
  input: CreateVisualAttemptGenerationRecordInput,
  dependencies: CreateVisualAttemptGenerationRecordDependencies = {},
): Promise<CreateVisualAttemptGenerationRecordResult> {
  requireNoCallerAuthority(
    input,
  );

  const now =
    dependencies.now ??
    (() =>
      new Date()
        .toISOString());

  const lifecycle =
    requireSubmittedLifecycle(
      await inspectVisualAttemptExecutionLifecycle(
        mediaRoot,
        input.episodeId,
        input.shotId,
        input.attemptNumber,
      ),
    );

  requireExpectedChain(
    lifecycle,
    input,
  );

  const providerExecutionId =
    lifecycle.submission.record.providerExecutionId;

  const outputPath =
    createGoogleGenAiVideoOutputPath(
      mediaRoot,
      lifecycle.episodeId,
      lifecycle.shotId,
      providerExecutionId,
    );

  const generationRecordPath =
    createGoogleGenAiGenerationRecordPath(
      mediaRoot,
      lifecycle.episodeId,
      lifecycle.shotId,
      providerExecutionId,
    );

  requireOutputEvidenceShape(
    input.output,
    outputPath,
  );

  const shotDirectory =
    resolve(
      mediaRoot,
      "generated-video",
      lifecycle.episodeId,
      lifecycle.shotId,
    );

  await verifyCanonicalOutput(
    shotDirectory,
    outputPath,
    input.output.bytes,
    input.output.sha256,
  );

  const candidate =
    GoogleGenAiGenerationRecordSchema
      .parse({
        schemaVersion: GOOGLE_GENAI_GENERATION_RECORD_SCHEMA_VERSION,
        recordedAt: now(),
        reservationId: lifecycle.reservation.record.reservationId,
        provider: lifecycle.provider,
        episodeId: lifecycle.episodeId,
        shotId: lifecycle.shotId,
        providerExecutionId,
        outputs: [
          {
            outputIndex: GOOGLE_GENAI_VIDEO_OUTPUT_INDEX,
            destinationPath: outputPath,
            bytes: input.output.bytes,
            sha256: input.output.sha256,
            contentType: GOOGLE_GENAI_GENERATION_OUTPUT_CONTENT_TYPE,
          },
        ],
      });

  const serialized =
    serializeVisualAttemptExecutionRecord(
      candidate,
    );

  let alreadyPresent =
    false;

  try {
    await publishVisualAttemptExecutionRecordCreateOnce(
      generationRecordPath,
      serialized,
    );
  } catch (
    error
  ) {
    // The shared create-once helper reports an existing target with exactly
    // this message; every other publication failure propagates unchanged.
    if (
      !(
        error instanceof Error
      ) ||
      error.message !==
        `Visual attempt execution record already exists: ${generationRecordPath}`
    ) {
      throw error;
    }

    alreadyPresent =
      true;
  }

  let record:
    GoogleGenAiGenerationRecord;

  let generationRecordSha256:
    string;

  if (
    alreadyPresent
  ) {
    const existing =
      await acceptExistingGenerationRecord(
        generationRecordPath,
        candidate,
      );

    record =
      existing.record;

    generationRecordSha256 =
      existing.generationRecordSha256;
  } else {
    record =
      candidate;

    generationRecordSha256 =
      await readPublishedGenerationRecord(
        generationRecordPath,
        serialized,
      );
  }

  await requireStableLineage(
    mediaRoot,
    input,
    lifecycle,
  );

  return Object.freeze({
    record:
      freezeGenerationRecord(
        record,
      ),
    generationRecordPath,
    generationRecordSha256,
    outputPath,
    alreadyPresent,
  });
}
