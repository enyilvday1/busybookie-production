import {
  createHash,
} from "node:crypto";

import {
  lstat,
  open,
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
  inspectVisualAttemptExecutionLifecycle,
  type VisualAttemptExecutionLifecycleInspection,
} from "./inspectVisualAttemptExecutionLifecycle.js";

/**
 * Read-only durable completion verification for one replacement visual
 * attempt (attempt >= 2).
 *
 * Output bytes are touched only after the Slice-2D attempt-aware inspector
 * has established a canonical COMPLETED lifecycle; every path and expected
 * byte count/SHA-256 comes from that fresh inspection. The output is opened
 * read-only, bound to its pre-open filesystem identity, hashed in bounded
 * chunks over exactly the durable byte count, and the lifecycle is inspected
 * again afterwards so lineage drift during verification fails closed.
 *
 * It never contacts a provider, never recovers or materializes anything and
 * never writes.
 */

type CompletedVisualAttemptExecutionLifecycleInspection =
  Extract<
    VisualAttemptExecutionLifecycleInspection,
    {
      state: "COMPLETED";
    }
  >;

type DurableVisualAttemptOutput =
  CompletedVisualAttemptExecutionLifecycleInspection["generationRecord"]["record"]["outputs"][number];

export type VisualAttemptDurableCompletionVerification =
  Readonly<{
    episodeId: string;
    sceneId: string;
    shotId: string;
    attemptNumber: number;
    admissionId: string;
    reservationId: string;
    provider: CompletedVisualAttemptExecutionLifecycleInspection["provider"];
    providerExecutionId: string;
    admissionSha256: string;
    reservationSha256: string;
    submissionSha256: string;
    completionSha256: string;
    completionPath: string;
    generationRecordPath: string;
    generationRecordSha256: string;
    outputPath: string;
    bytes: number;
    sha256: string;
    contentType: DurableVisualAttemptOutput["contentType"];
    lifecycle: CompletedVisualAttemptExecutionLifecycleInspection;
  }>;

type OutputFileIdentity =
  Readonly<{
    dev: bigint;
    ino: bigint;
    size: bigint;
  }>;

const OUTPUT_HASH_CHUNK_BYTES =
  1024 * 1024;

const DURABLE_OUTPUT_CONTENT_TYPE =
  "video/mp4";

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
        `Attempt-aware durable output does not exist: ${outputPath}`,
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
      `Attempt-aware durable output parent does not resolve to the shot directory ${shotDirectory}: ${outputPath}`,
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
      `Attempt-aware durable output must resolve directly inside the shot directory ${realShotDirectory}; resolved ${realOutputPath}.`,
    );
  }
}

async function hashExactDurableBytes(
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
        `Attempt-aware durable output opened as a non-regular file: ${outputPath}`,
      );
    }

    if (
      opened.dev !== expectedIdentity.dev ||
      opened.ino !== expectedIdentity.ino ||
      opened.size !== expectedIdentity.size
    ) {
      throw new Error(
        `Attempt-aware durable output was replaced between lstat and open: ${outputPath}`,
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
          `Attempt-aware durable output ${outputPath} ended before its recorded size.`,
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
        `Attempt-aware durable output changed size while being hashed: ${outputPath}`,
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
        `Attempt-aware durable output ${outputPath} could not be verified and its file handle could not be closed.`,
      );
    }

    throw error;
  }

  await handle.close();

  return hash.digest(
    "hex",
  );
}

async function requireStableLineage(
  mediaRoot: string,
  episodeId: string,
  shotId: string,
  attemptNumber: number,
  lifecycle: CompletedVisualAttemptExecutionLifecycleInspection,
): Promise<void> {
  const attemptLabel =
    `${lifecycle.episodeId}/${lifecycle.shotId}/a${lifecycle.attemptNumber}`;

  let reinspection:
    VisualAttemptExecutionLifecycleInspection;

  try {
    reinspection =
      await inspectVisualAttemptExecutionLifecycle(
        mediaRoot,
        episodeId,
        shotId,
        attemptNumber,
      );
  } catch (
    error
  ) {
    throw new Error(
      `Attempt-aware durable lineage changed during verification for ${attemptLabel}; reinspection failed.`,
      {
        cause: error,
      },
    );
  }

  if (
    reinspection.state !== "COMPLETED" ||
    !isDeepStrictEqual(
      reinspection,
      lifecycle,
    )
  ) {
    throw new Error(
      `Attempt-aware durable lineage changed during verification for ${attemptLabel}; reinspection reported ${reinspection.state}.`,
    );
  }
}

export async function verifyVisualAttemptDurableCompletion(
  mediaRoot: string,
  episodeId: string,
  shotId: string,
  attemptNumber: number,
): Promise<VisualAttemptDurableCompletionVerification> {
  const lifecycle =
    await inspectVisualAttemptExecutionLifecycle(
      mediaRoot,
      episodeId,
      shotId,
      attemptNumber,
    );

  if (
    lifecycle.state !== "COMPLETED"
  ) {
    throw new Error(
      `Attempt-aware durable completion verification requires COMPLETED lifecycle; received ${lifecycle.state}.`,
    );
  }

  const {
    generationRecord,
  } = lifecycle;

  const outputPath =
    generationRecord.outputPath;

  if (
    generationRecord.record.outputs.length !== 1
  ) {
    throw new Error(
      `Attempt-aware durable completion must bind exactly one output: ${generationRecord.generationRecordPath}`,
    );
  }

  const output =
    generationRecord.record.outputs[0];

  if (
    output === undefined ||
    output.destinationPath !== outputPath
  ) {
    throw new Error(
      `Attempt-aware durable output destination does not match the inspected canonical output path ${outputPath}.`,
    );
  }

  if (
    output.contentType !== DURABLE_OUTPUT_CONTENT_TYPE
  ) {
    throw new Error(
      `Attempt-aware durable output content type must be ${DURABLE_OUTPUT_CONTENT_TYPE}: ${outputPath}`,
    );
  }

  const shotDirectory =
    resolve(
      mediaRoot,
      "generated-video",
      lifecycle.episodeId,
      lifecycle.shotId,
    );

  if (
    dirname(
      outputPath,
    ) !== shotDirectory
  ) {
    throw new Error(
      `Attempt-aware durable output must be located directly inside the canonical shot directory ${shotDirectory}: ${outputPath}`,
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
      `Attempt-aware durable output is not a regular file: ${outputPath}`,
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
      `Attempt-aware durable output is empty: ${outputPath}`,
    );
  }

  if (
    entry.size !== BigInt(output.bytes)
  ) {
    throw new Error(
      `Attempt-aware durable output is ${entry.size} bytes; generation record records ${output.bytes}: ${outputPath}`,
    );
  }

  const sha256 =
    await hashExactDurableBytes(
      outputPath,
      {
        dev: entry.dev,
        ino: entry.ino,
        size: entry.size,
      },
      output.bytes,
    );

  if (
    sha256 !== output.sha256
  ) {
    throw new Error(
      `Attempt-aware durable output SHA-256 ${sha256} does not match generation record ${output.sha256}: ${outputPath}`,
    );
  }

  await requireStableLineage(
    mediaRoot,
    episodeId,
    shotId,
    attemptNumber,
    lifecycle,
  );

  return Object.freeze({
    episodeId: lifecycle.episodeId,
    sceneId: lifecycle.sceneId,
    shotId: lifecycle.shotId,
    attemptNumber: lifecycle.attemptNumber,
    admissionId: lifecycle.admissionId,
    reservationId: lifecycle.reservationId,
    provider: lifecycle.provider,
    providerExecutionId: lifecycle.providerExecutionId,
    admissionSha256: lifecycle.admission.admissionSha256,
    reservationSha256: lifecycle.reservation.reservationSha256,
    submissionSha256: lifecycle.submission.submissionSha256,
    completionSha256: lifecycle.completion.completionSha256,
    completionPath: lifecycle.completion.completionPath,
    generationRecordPath: generationRecord.generationRecordPath,
    generationRecordSha256: generationRecord.generationRecordSha256,
    outputPath,
    bytes: output.bytes,
    sha256,
    contentType: output.contentType,
    lifecycle,
  });
}
