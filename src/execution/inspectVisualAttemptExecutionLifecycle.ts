import {
  createHash,
} from "node:crypto";

import {
  readFile,
} from "node:fs/promises";

import {
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
  readVisualAttemptAdmissionEvidence,
  type VisualAttemptAdmissionEvidence,
} from "./readVisualAttemptAdmission.js";

import {
  readVisualAttemptExecutionCompletionEvidence,
  type VisualAttemptExecutionCompletionEvidence,
} from "./readVisualAttemptExecutionCompletion.js";

import {
  readVisualAttemptExecutionReservationEvidence,
  type VisualAttemptExecutionReservationEvidence,
} from "./readVisualAttemptExecutionReservation.js";

import {
  readVisualAttemptExecutionSubmissionEvidence,
  type VisualAttemptExecutionSubmissionEvidence,
} from "./readVisualAttemptExecutionSubmission.js";

import {
  VisualAttemptExecutionReservationSchema,
  VisualAttemptGoogleGenAiExecutionSubmissionSchema,
  type VisualAttemptGoogleGenAiExecutionSubmission,
} from "./visualAttemptExecutionLifecycle.schema.js";

import {
  VisualReplacementAttemptNumberSchema,
} from "./visualAttemptNumber.schema.js";

/**
 * Read-only attempt-aware visual execution lifecycle inspection.
 *
 * Classifies one replacement attempt (attempt >= 2) from its immutable
 * durable admission, reservation, submission and completion evidence, and
 * verifies the exact identity and SHA-256 chain between every present level.
 * For COMPLETED it binds the canonical Google generation record by path, raw
 * byte SHA-256, strict schema, identity and canonical output path.
 *
 * It never reads, hashes or stats the output video itself, never contacts a
 * provider, never recovers or materializes anything and never writes.
 */

type GoogleGenAiProvider =
  VisualAttemptGoogleGenAiExecutionSubmission["provider"];

const GoogleGenAiProviderSchema =
  VisualAttemptGoogleGenAiExecutionSubmissionSchema
    .shape
    .provider;

export type VisualAttemptGenerationRecordEvidence =
  Readonly<{
    record: GoogleGenAiGenerationRecord;
    generationRecordPath: string;
    generationRecordSha256: string;
    outputPath: string;
  }>;

type AdmittedIdentity = {
  episodeId: string;
  sceneId: string;
  shotId: string;
  attemptNumber: number;
  admissionId: string;
  provider: GoogleGenAiProvider;
  admission: VisualAttemptAdmissionEvidence;
};

export type VisualAttemptExecutionLifecycleInspection =
  | Readonly<{
      state: "NOT_ADMITTED";
      episodeId: string;
      shotId: string;
      attemptNumber: number;
    }>
  | Readonly<
      AdmittedIdentity & {
        state: "ADMITTED_ONLY";
      }
    >
  | Readonly<
      AdmittedIdentity & {
        state: "RESERVED_ONLY";
        reservationId: string;
        reservation: VisualAttemptExecutionReservationEvidence;
      }
    >
  | Readonly<
      AdmittedIdentity & {
        state: "SUBMITTED";
        reservationId: string;
        reservation: VisualAttemptExecutionReservationEvidence;
        providerExecutionId: string;
        submission: VisualAttemptExecutionSubmissionEvidence;
      }
    >
  | Readonly<
      AdmittedIdentity & {
        state: "COMPLETED";
        reservationId: string;
        reservation: VisualAttemptExecutionReservationEvidence;
        providerExecutionId: string;
        submission: VisualAttemptExecutionSubmissionEvidence;
        completion: VisualAttemptExecutionCompletionEvidence;
        generationRecord: VisualAttemptGenerationRecordEvidence;
      }
    >;

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

function requireGoogleGenAiProvider(
  admissionEvidence: VisualAttemptAdmissionEvidence,
): GoogleGenAiProvider {
  const parsed =
    GoogleGenAiProviderSchema
      .safeParse(
        admissionEvidence.record.provider,
      );

  if (
    !parsed.success
  ) {
    throw new Error(
      `Attempt-aware visual lifecycle inspection supports only the Google GenAI provider; admission declares provider ${admissionEvidence.record.provider}: ${admissionEvidence.admissionPath}`,
    );
  }

  return parsed.data;
}

function verifyReservationChain(
  admissionEvidence: VisualAttemptAdmissionEvidence,
  reservationEvidence: VisualAttemptExecutionReservationEvidence,
): void {
  const admission =
    admissionEvidence.record;

  const reservation =
    reservationEvidence.record;

  if (
    reservation.episodeId !== admission.episodeId ||
    reservation.sceneId !== admission.sceneId ||
    reservation.shotId !== admission.shotId ||
    reservation.attemptNumber !== admission.attemptNumber
  ) {
    throw new Error(
      `Attempt-aware reservation identity does not match the durable admission: ${reservationEvidence.reservationPath}`,
    );
  }

  if (
    reservation.admissionId !== admission.admissionId ||
    reservation.admissionSha256 !== admissionEvidence.admissionSha256
  ) {
    throw new Error(
      `Attempt-aware reservation is not bound to the exact durable admission ID and SHA-256: ${reservationEvidence.reservationPath}`,
    );
  }

  if (
    reservation.provider !== admission.provider
  ) {
    throw new Error(
      `Attempt-aware reservation provider ${reservation.provider} does not match admission provider ${admission.provider}: ${reservationEvidence.reservationPath}`,
    );
  }
}

function verifySubmissionChain(
  admissionEvidence: VisualAttemptAdmissionEvidence,
  reservationEvidence: VisualAttemptExecutionReservationEvidence,
  submissionEvidence: VisualAttemptExecutionSubmissionEvidence,
): void {
  const admission =
    admissionEvidence.record;

  const reservation =
    reservationEvidence.record;

  const submission =
    submissionEvidence.record;

  if (
    submission.episodeId !== admission.episodeId ||
    submission.sceneId !== admission.sceneId ||
    submission.shotId !== admission.shotId ||
    submission.attemptNumber !== admission.attemptNumber
  ) {
    throw new Error(
      `Attempt-aware submission identity does not match the durable admission: ${submissionEvidence.submissionPath}`,
    );
  }

  if (
    submission.admissionId !== admission.admissionId ||
    submission.admissionSha256 !== admissionEvidence.admissionSha256
  ) {
    throw new Error(
      `Attempt-aware submission is not bound to the exact durable admission ID and SHA-256: ${submissionEvidence.submissionPath}`,
    );
  }

  if (
    submission.reservationId !== reservation.reservationId ||
    submission.reservationSha256 !== reservationEvidence.reservationSha256
  ) {
    throw new Error(
      `Attempt-aware submission is not bound to the exact durable reservation ID and SHA-256: ${submissionEvidence.submissionPath}`,
    );
  }

  if (
    submission.provider !== admission.provider ||
    submission.provider !== reservation.provider
  ) {
    throw new Error(
      `Attempt-aware submission provider ${submission.provider} does not match the durable provider chain: ${submissionEvidence.submissionPath}`,
    );
  }
}

function verifyCompletionChain(
  admissionEvidence: VisualAttemptAdmissionEvidence,
  reservationEvidence: VisualAttemptExecutionReservationEvidence,
  submissionEvidence: VisualAttemptExecutionSubmissionEvidence,
  completionEvidence: VisualAttemptExecutionCompletionEvidence,
): void {
  const admission =
    admissionEvidence.record;

  const reservation =
    reservationEvidence.record;

  const submission =
    submissionEvidence.record;

  const completion =
    completionEvidence.record;

  if (
    completion.episodeId !== admission.episodeId ||
    completion.sceneId !== admission.sceneId ||
    completion.shotId !== admission.shotId ||
    completion.attemptNumber !== admission.attemptNumber
  ) {
    throw new Error(
      `Attempt-aware completion identity does not match the durable admission: ${completionEvidence.completionPath}`,
    );
  }

  if (
    completion.admissionId !== admission.admissionId ||
    completion.admissionSha256 !== admissionEvidence.admissionSha256
  ) {
    throw new Error(
      `Attempt-aware completion is not bound to the exact durable admission ID and SHA-256: ${completionEvidence.completionPath}`,
    );
  }

  if (
    completion.reservationId !== reservation.reservationId ||
    completion.reservationSha256 !== reservationEvidence.reservationSha256
  ) {
    throw new Error(
      `Attempt-aware completion is not bound to the exact durable reservation ID and SHA-256: ${completionEvidence.completionPath}`,
    );
  }

  if (
    completion.submissionSha256 !== submissionEvidence.submissionSha256
  ) {
    throw new Error(
      `Attempt-aware completion is not bound to the exact durable submission SHA-256: ${completionEvidence.completionPath}`,
    );
  }

  if (
    completion.provider !== admission.provider ||
    completion.provider !== reservation.provider ||
    completion.provider !== submission.provider
  ) {
    throw new Error(
      `Attempt-aware completion provider ${completion.provider} does not match the durable provider chain: ${completionEvidence.completionPath}`,
    );
  }

  if (
    completion.providerExecutionId !== submission.providerExecutionId
  ) {
    throw new Error(
      `Attempt-aware completion providerExecutionId does not match the durable submission: ${completionEvidence.completionPath}`,
    );
  }
}

async function readRequiredGenerationRecordBytes(
  generationRecordPath: string,
): Promise<Buffer> {
  try {
    return await readFile(
      generationRecordPath,
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
        `Google generation record required by a completed attempt-aware lifecycle is missing: ${generationRecordPath}`,
      );
    }

    throw error;
  }
}

async function inspectCompletedGenerationRecord(
  mediaRoot: string,
  admissionEvidence: VisualAttemptAdmissionEvidence,
  reservationEvidence: VisualAttemptExecutionReservationEvidence,
  submissionEvidence: VisualAttemptExecutionSubmissionEvidence,
  completionEvidence: VisualAttemptExecutionCompletionEvidence,
): Promise<VisualAttemptGenerationRecordEvidence> {
  const admission =
    admissionEvidence.record;

  const submission =
    submissionEvidence.record;

  const completion =
    completionEvidence.record;

  const generationRecordPath =
    createGoogleGenAiGenerationRecordPath(
      mediaRoot,
      admission.episodeId,
      admission.shotId,
      submission.providerExecutionId,
    );

  if (
    completion.generationRecordPath !== generationRecordPath
  ) {
    throw new Error(
      `Attempt-aware completion generationRecordPath is not the canonical Google generation record path: ${completionEvidence.completionPath}`,
    );
  }

  const generationRecordBytes =
    await readRequiredGenerationRecordBytes(
      generationRecordPath,
    );

  const generationRecordSha256 =
    sha256(
      generationRecordBytes,
    );

  if (
    generationRecordSha256 !== completion.generationRecordSha256
  ) {
    throw new Error(
      `Google generation record SHA-256 ${generationRecordSha256} does not match attempt-aware completion ${completion.generationRecordSha256}: ${generationRecordPath}`,
    );
  }

  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        generationRecordBytes.toString(
          "utf8",
        ),
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

  const record =
    GoogleGenAiGenerationRecordSchema
      .parse(
        parsed,
      );

  if (
    record.reservationId !== reservationEvidence.record.reservationId ||
    record.episodeId !== admission.episodeId ||
    record.shotId !== admission.shotId ||
    record.provider !== admission.provider ||
    record.providerExecutionId !== submission.providerExecutionId
  ) {
    throw new Error(
      `Google generation record identity does not match the verified attempt-aware execution chain: ${generationRecordPath}`,
    );
  }

  if (
    record.outputs.length !== 1
  ) {
    throw new Error(
      `Google generation record must contain exactly one output: ${generationRecordPath}`,
    );
  }

  const output =
    record.outputs[0];

  if (
    output.outputIndex !== GOOGLE_GENAI_VIDEO_OUTPUT_INDEX
  ) {
    throw new Error(
      `Google generation record output index ${output.outputIndex} is not the canonical output index ${GOOGLE_GENAI_VIDEO_OUTPUT_INDEX}: ${generationRecordPath}`,
    );
  }

  const outputPath =
    createGoogleGenAiVideoOutputPath(
      mediaRoot,
      admission.episodeId,
      admission.shotId,
      submission.providerExecutionId,
    );

  if (
    output.destinationPath !== outputPath
  ) {
    throw new Error(
      `Google generation record output destination is not the canonical output path: ${output.destinationPath}`,
    );
  }

  return Object.freeze({
    record,
    generationRecordPath,
    generationRecordSha256,
    outputPath,
  });
}

export async function inspectVisualAttemptExecutionLifecycle(
  mediaRoot: string,
  episodeId: string,
  shotId: string,
  attemptNumber: number,
): Promise<VisualAttemptExecutionLifecycleInspection> {
  const parsedAttemptNumber =
    VisualReplacementAttemptNumberSchema
      .safeParse(
        attemptNumber,
      );

  if (
    !parsedAttemptNumber.success
  ) {
    throw new Error(
      `Attempt-aware visual lifecycle inspection requires a replacement attempt number of at least 2; attempt 1 belongs to the immutable legacy lifecycle. Received: ${String(attemptNumber)}`,
      {
        cause: parsedAttemptNumber.error,
      },
    );
  }

  const validatedAttemptNumber =
    parsedAttemptNumber.data;

  const validatedEpisodeId =
    VisualAttemptExecutionReservationSchema
      .shape
      .episodeId
      .parse(
        episodeId,
      );

  const validatedShotId =
    VisualAttemptExecutionReservationSchema
      .shape
      .shotId
      .parse(
        shotId,
      );

  const admissionEvidence =
    await readVisualAttemptAdmissionEvidence(
      mediaRoot,
      validatedEpisodeId,
      validatedShotId,
      validatedAttemptNumber,
    );

  const reservationEvidence =
    await readVisualAttemptExecutionReservationEvidence(
      mediaRoot,
      validatedEpisodeId,
      validatedShotId,
      validatedAttemptNumber,
    );

  const submissionEvidence =
    await readVisualAttemptExecutionSubmissionEvidence(
      mediaRoot,
      validatedEpisodeId,
      validatedShotId,
      validatedAttemptNumber,
    );

  const completionEvidence =
    await readVisualAttemptExecutionCompletionEvidence(
      mediaRoot,
      validatedEpisodeId,
      validatedShotId,
      validatedAttemptNumber,
    );

  const attemptLabel =
    `${validatedEpisodeId}/${validatedShotId}/a${validatedAttemptNumber}`;

  if (
    admissionEvidence === null
  ) {
    if (
      reservationEvidence !== null
    ) {
      throw new Error(
        `Attempt-aware reservation exists without a durable admission for ${attemptLabel}.`,
      );
    }

    if (
      submissionEvidence !== null
    ) {
      throw new Error(
        `Attempt-aware submission exists without a durable admission for ${attemptLabel}.`,
      );
    }

    if (
      completionEvidence !== null
    ) {
      throw new Error(
        `Attempt-aware completion exists without a durable admission for ${attemptLabel}.`,
      );
    }

    return Object.freeze({
      state: "NOT_ADMITTED",
      episodeId: validatedEpisodeId,
      shotId: validatedShotId,
      attemptNumber: validatedAttemptNumber,
    });
  }

  const provider =
    requireGoogleGenAiProvider(
      admissionEvidence,
    );

  const admission =
    admissionEvidence.record;

  const admittedIdentity = {
    episodeId: admission.episodeId,
    sceneId: admission.sceneId,
    shotId: admission.shotId,
    attemptNumber: admission.attemptNumber,
    admissionId: admission.admissionId,
    provider,
    admission: admissionEvidence,
  } as const;

  if (
    reservationEvidence === null
  ) {
    if (
      submissionEvidence !== null
    ) {
      throw new Error(
        `Attempt-aware submission exists without a durable reservation for ${attemptLabel}.`,
      );
    }

    if (
      completionEvidence !== null
    ) {
      throw new Error(
        `Attempt-aware completion exists without a durable reservation for ${attemptLabel}.`,
      );
    }

    return Object.freeze({
      state: "ADMITTED_ONLY",
      ...admittedIdentity,
    });
  }

  verifyReservationChain(
    admissionEvidence,
    reservationEvidence,
  );

  if (
    submissionEvidence === null
  ) {
    if (
      completionEvidence !== null
    ) {
      throw new Error(
        `Attempt-aware completion exists without a durable submission for ${attemptLabel}.`,
      );
    }

    return Object.freeze({
      state: "RESERVED_ONLY",
      ...admittedIdentity,
      reservationId: reservationEvidence.record.reservationId,
      reservation: reservationEvidence,
    });
  }

  verifySubmissionChain(
    admissionEvidence,
    reservationEvidence,
    submissionEvidence,
  );

  if (
    completionEvidence === null
  ) {
    return Object.freeze({
      state: "SUBMITTED",
      ...admittedIdentity,
      reservationId: reservationEvidence.record.reservationId,
      reservation: reservationEvidence,
      providerExecutionId: submissionEvidence.record.providerExecutionId,
      submission: submissionEvidence,
    });
  }

  verifyCompletionChain(
    admissionEvidence,
    reservationEvidence,
    submissionEvidence,
    completionEvidence,
  );

  const generationRecord =
    await inspectCompletedGenerationRecord(
      mediaRoot,
      admissionEvidence,
      reservationEvidence,
      submissionEvidence,
      completionEvidence,
    );

  return Object.freeze({
    state: "COMPLETED",
    ...admittedIdentity,
    reservationId: reservationEvidence.record.reservationId,
    reservation: reservationEvidence,
    providerExecutionId: submissionEvidence.record.providerExecutionId,
    submission: submissionEvidence,
    completion: completionEvidence,
    generationRecord,
  });
}
