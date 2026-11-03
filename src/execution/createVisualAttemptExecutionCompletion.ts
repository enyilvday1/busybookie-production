import {
  createHash,
} from "node:crypto";

import {
  lstat,
  readFile,
  realpath,
} from "node:fs/promises";

import {
  dirname,
  resolve,
} from "node:path";

import {
  GoogleGenAiGenerationRecordSchema,
} from "../googleGenai/audit/googleGenAiGenerationRecord.schema.js";

import {
  createGoogleGenAiGenerationRecordPath,
} from "../googleGenai/audit/googleGenAiGenerationRecordPath.js";

import {
  createGoogleGenAiVideoOutputPath,
} from "../googleGenai/output/googleGenAiVideoOutputPath.js";

import {
  readVisualAttemptAdmissionEvidence,
} from "./readVisualAttemptAdmission.js";

import {
  readVisualAttemptExecutionReservationEvidence,
} from "./readVisualAttemptExecutionReservation.js";

import {
  readVisualAttemptExecutionSubmissionEvidence,
} from "./readVisualAttemptExecutionSubmission.js";

import {
  VisualAttemptGoogleGenAiExecutionCompletionSchema,
  type VisualAttemptGoogleGenAiExecutionCompletion,
} from "./visualAttemptExecutionLifecycle.schema.js";

import {
  createVisualAttemptExecutionCompletionPath,
} from "./visualAttemptExecutionPaths.js";

import {
  calculateVisualAttemptExecutionRecordSha256,
  publishVisualAttemptExecutionRecordCreateOnce,
  serializeVisualAttemptExecutionRecord,
} from "./visualAttemptExecutionRecordPersistence.js";

export type CreateVisualAttemptExecutionCompletionInput =
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
  }>;

export type CreateVisualAttemptExecutionCompletionDependencies =
  Readonly<{
    now?: () => string;
  }>;

export type CreateVisualAttemptExecutionCompletionResult =
  Readonly<{
    record: VisualAttemptGoogleGenAiExecutionCompletion;
    completionPath: string;
    completionSha256: string;
    generationRecordPath: string;
    generationRecordSha256: string;
  }>;

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
  bytes: string | Buffer,
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

async function readRequiredGenerationRecordRaw(
  generationRecordPath: string,
): Promise<string> {
  try {
    return await readFile(
      generationRecordPath,
      "utf8",
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
        `Google generation record required for attempt completion is missing: ${generationRecordPath}`,
      );
    }

    throw error;
  }
}

async function verifyCanonicalOutputEvidence(
  mediaRoot: string,
  episodeId: string,
  shotId: string,
  providerExecutionId: string,
  destinationPath: string,
  expectedBytes: number,
  expectedSha256: string,
): Promise<void> {
  const canonicalOutputPath =
    createGoogleGenAiVideoOutputPath(
      mediaRoot,
      episodeId,
      shotId,
      providerExecutionId,
    );

  if (
    destinationPath !== canonicalOutputPath
  ) {
    throw new Error(
      `Google generation output destination is not the canonical output path: ${destinationPath}`,
    );
  }

  let outputStat:
    Awaited<
      ReturnType<
        typeof lstat
      >
    >;

  try {
    outputStat =
      await lstat(
        canonicalOutputPath,
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
        `Google generation output required for attempt completion is missing: ${canonicalOutputPath}`,
      );
    }

    throw error;
  }

  if (
    outputStat.isSymbolicLink() ||
    !outputStat.isFile()
  ) {
    throw new Error(
      `Google generation output must be a regular non-symlink file: ${canonicalOutputPath}`,
    );
  }

  const selectedShotDirectory =
    resolve(
      mediaRoot,
      "generated-video",
      episodeId,
      shotId,
    );

  const [
    realOutputParent,
    realSelectedShotDirectory,
  ] =
    await Promise.all([
      realpath(
        dirname(
          canonicalOutputPath,
        ),
      ),
      realpath(
        selectedShotDirectory,
      ),
    ]);

  if (
    realOutputParent !== realSelectedShotDirectory
  ) {
    throw new Error(
      `Google generation output resolves outside the selected shot directory: ${canonicalOutputPath}`,
    );
  }

  const outputBytes =
    await readFile(
      canonicalOutputPath,
    );

  if (
    outputBytes.byteLength <= 0
  ) {
    throw new Error(
      `Google generation output is empty: ${canonicalOutputPath}`,
    );
  }

  if (
    outputStat.size !== outputBytes.byteLength
  ) {
    throw new Error(
      `Google generation output changed while it was being verified: ${canonicalOutputPath}`,
    );
  }

  if (
    outputBytes.byteLength !== expectedBytes
  ) {
    throw new Error(
      `Google generation output byte count ${outputBytes.byteLength} does not match generation record ${expectedBytes}: ${canonicalOutputPath}`,
    );
  }

  const actualSha256 =
    sha256(
      outputBytes,
    );

  if (
    actualSha256 !== expectedSha256
  ) {
    throw new Error(
      `Google generation output SHA-256 ${actualSha256} does not match generation record ${expectedSha256}: ${canonicalOutputPath}`,
    );
  }
}

export async function createVisualAttemptExecutionCompletion(
  mediaRoot: string,
  input: CreateVisualAttemptExecutionCompletionInput,
  dependencies: CreateVisualAttemptExecutionCompletionDependencies = {},
): Promise<CreateVisualAttemptExecutionCompletionResult> {
  const now =
    dependencies.now ??
    (() =>
      new Date()
        .toISOString());

  const admissionEvidence =
    await readVisualAttemptAdmissionEvidence(
      mediaRoot,
      input.episodeId,
      input.shotId,
      input.attemptNumber,
    );

  if (
    admissionEvidence === null
  ) {
    throw new Error(
      "Attempt-aware completion requires an existing durable visual-attempt admission.",
    );
  }

  const admission =
    admissionEvidence.record;

  if (
    admission.episodeId !== input.episodeId ||
    admission.sceneId !== input.sceneId ||
    admission.shotId !== input.shotId ||
    admission.attemptNumber !== input.attemptNumber
  ) {
    throw new Error(
      "Attempt-aware completion admission identity does not match the requested attempt.",
    );
  }

  if (
    admission.admissionId !== input.expectedAdmissionId
  ) {
    throw new Error(
      "Attempt-aware completion admission ID does not match expected durable admission.",
    );
  }

  if (
    admissionEvidence.admissionSha256 !== input.expectedAdmissionSha256
  ) {
    throw new Error(
      "Attempt-aware completion admission SHA-256 does not match expected durable admission.",
    );
  }

  const reservationEvidence =
    await readVisualAttemptExecutionReservationEvidence(
      mediaRoot,
      input.episodeId,
      input.shotId,
      input.attemptNumber,
    );

  if (
    reservationEvidence === null
  ) {
    throw new Error(
      "Attempt-aware completion requires an existing durable attempt-aware reservation.",
    );
  }

  const reservation =
    reservationEvidence.record;

  if (
    reservation.episodeId !== input.episodeId ||
    reservation.sceneId !== input.sceneId ||
    reservation.shotId !== input.shotId ||
    reservation.attemptNumber !== input.attemptNumber
  ) {
    throw new Error(
      "Attempt-aware completion reservation identity does not match the requested attempt.",
    );
  }

  if (
    reservation.admissionId !== admission.admissionId ||
    reservation.admissionSha256 !== admissionEvidence.admissionSha256
  ) {
    throw new Error(
      "Attempt-aware completion reservation is not bound to the verified durable admission.",
    );
  }

  if (
    reservation.reservationId !== input.expectedReservationId
  ) {
    throw new Error(
      "Attempt-aware completion reservation ID does not match expected durable reservation.",
    );
  }

  if (
    reservationEvidence.reservationSha256 !== input.expectedReservationSha256
  ) {
    throw new Error(
      "Attempt-aware completion reservation SHA-256 does not match expected durable reservation.",
    );
  }

  const provider =
    VisualAttemptGoogleGenAiExecutionCompletionSchema
      .shape
      .provider
      .parse(
        reservation.provider,
      );

  if (
    admission.provider !== provider
  ) {
    throw new Error(
      "Attempt-aware completion admission and reservation providers do not match.",
    );
  }

  const submissionEvidence =
    await readVisualAttemptExecutionSubmissionEvidence(
      mediaRoot,
      input.episodeId,
      input.shotId,
      input.attemptNumber,
    );

  if (
    submissionEvidence === null
  ) {
    throw new Error(
      "Attempt-aware completion requires an existing durable attempt-aware submission.",
    );
  }

  const submission =
    submissionEvidence.record;

  if (
    submission.episodeId !== input.episodeId ||
    submission.sceneId !== input.sceneId ||
    submission.shotId !== input.shotId ||
    submission.attemptNumber !== input.attemptNumber
  ) {
    throw new Error(
      "Attempt-aware completion submission identity does not match the requested attempt.",
    );
  }

  if (
    submission.reservationId !== reservation.reservationId ||
    submission.reservationSha256 !== reservationEvidence.reservationSha256
  ) {
    throw new Error(
      "Attempt-aware completion submission is not bound to the verified durable reservation.",
    );
  }

  if (
    submission.admissionId !== admission.admissionId ||
    submission.admissionSha256 !== admissionEvidence.admissionSha256
  ) {
    throw new Error(
      "Attempt-aware completion submission is not bound to the verified durable admission.",
    );
  }

  if (
    submission.provider !== provider
  ) {
    throw new Error(
      "Attempt-aware completion submission provider does not match the durable provider chain.",
    );
  }

  if (
    submissionEvidence.submissionSha256 !== input.expectedSubmissionSha256
  ) {
    throw new Error(
      "Attempt-aware completion submission SHA-256 does not match expected durable submission.",
    );
  }

  const providerExecutionId =
    VisualAttemptGoogleGenAiExecutionCompletionSchema
      .shape
      .providerExecutionId
      .parse(
        submission.providerExecutionId,
      );

  const generationRecordPath =
    createGoogleGenAiGenerationRecordPath(
      mediaRoot,
      input.episodeId,
      input.shotId,
      providerExecutionId,
    );

  const generationRecordRaw =
    await readRequiredGenerationRecordRaw(
      generationRecordPath,
    );

  let generationRecordParsed:
    unknown;

  try {
    generationRecordParsed =
      JSON.parse(
        generationRecordRaw,
      );
  } catch (
    error
  ) {
    throw new Error(
      `Google generation record is not valid JSON: ${generationRecordPath}`,
      {
        cause: error,
      },
    );
  }

  const generationRecord =
    GoogleGenAiGenerationRecordSchema
      .parse(
        generationRecordParsed,
      );

  if (
    generationRecord.reservationId !== reservation.reservationId ||
    generationRecord.episodeId !== input.episodeId ||
    generationRecord.shotId !== input.shotId ||
    generationRecord.provider !== provider ||
    generationRecord.providerExecutionId !== providerExecutionId
  ) {
    throw new Error(
      "Google generation record identity does not match the verified attempt-aware execution chain.",
    );
  }

  const output =
    generationRecord.outputs[0];

  await verifyCanonicalOutputEvidence(
    mediaRoot,
    input.episodeId,
    input.shotId,
    providerExecutionId,
    output.destinationPath,
    output.bytes,
    output.sha256,
  );

  const generationRecordSha256 =
    sha256(
      generationRecordRaw,
    );

  const record =
    VisualAttemptGoogleGenAiExecutionCompletionSchema
      .parse({
        schemaVersion: "1.0",
        completedAt: now(),
        status: "COMPLETED",
        reservationId: reservation.reservationId,
        reservationSha256: reservationEvidence.reservationSha256,
        submissionSha256: submissionEvidence.submissionSha256,
        episodeId: admission.episodeId,
        sceneId: admission.sceneId,
        shotId: admission.shotId,
        attemptNumber: admission.attemptNumber,
        admissionId: admission.admissionId,
        admissionSha256: admissionEvidence.admissionSha256,
        provider,
        providerExecutionId,
        generationRecordPath,
        generationRecordSha256,
      });

  const completionPath =
    createVisualAttemptExecutionCompletionPath(
      mediaRoot,
      record.episodeId,
      record.shotId,
      record.attemptNumber,
    );

  const serialized =
    serializeVisualAttemptExecutionRecord(
      record,
    );

  const completionSha256 =
    calculateVisualAttemptExecutionRecordSha256(
      serialized,
    );

  await publishVisualAttemptExecutionRecordCreateOnce(
    completionPath,
    serialized,
  );

  return Object.freeze({
    record,
    completionPath,
    completionSha256,
    generationRecordPath,
    generationRecordSha256,
  });
}
