import {
  readFile,
} from "node:fs/promises";

import {
  calculateVisualAttemptAdmissionSha256,
  serializeVisualAttemptAdmission,
} from "./createVisualAttemptAdmission.js";

import {
  createVisualAttemptAdmissionPath,
} from "./visualAttemptPaths.js";

import {
  VisualAttemptAdmissionSchema,
  type VisualAttemptAdmission,
} from "./visualAttemptAdmission.schema.js";

export type VisualAttemptAdmissionEvidence =
  Readonly<{
    record:
      VisualAttemptAdmission;

    admissionPath:
      string;

    admissionSha256:
      string;
  }>;

function nodeErrorCode(
  error:
    unknown,
): string | null {
  if (
    typeof error !==
      "object" ||
    error ===
      null ||
    !(
      "code" in
      error
    )
  ) {
    return null;
  }

  const code =
    (
      error as {
        code?:
          unknown;
      }
    ).code;

  return typeof code ===
    "string"
    ? code
    : null;
}

async function readVisualAttemptAdmissionEvidenceInternal(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): Promise<
  VisualAttemptAdmissionEvidence | null
> {
  const admissionPath =
    createVisualAttemptAdmissionPath(
      mediaRoot,
      episodeId,
      shotId,
      attemptNumber,
    );

  let raw:
    string;

  try {
    raw =
      await readFile(
        admissionPath,
        "utf8",
      );
  } catch (
    error
  ) {
    if (
      nodeErrorCode(
        error,
      ) ===
        "ENOENT"
    ) {
      return null;
    }

    throw error;
  }

  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        raw,
      );
  } catch (
    error
  ) {
    throw new Error(
      `Visual attempt admission is not valid JSON: ${admissionPath}`,
    );
  }

  const record =
    VisualAttemptAdmissionSchema
      .parse(
        parsed,
      );

  if (
    record.episodeId !==
      episodeId ||
    record.shotId !==
      shotId ||
    record.attemptNumber !==
      attemptNumber
  ) {
    throw new Error(
      `Visual attempt admission identity does not match its canonical path: ${admissionPath}`,
    );
  }

  const canonical =
    serializeVisualAttemptAdmission(
      record,
    );

  if (
    raw !==
      canonical
  ) {
    throw new Error(
      `Visual attempt admission bytes are not canonical: ${admissionPath}`,
    );
  }

  return Object.freeze({
    record,

    admissionPath,

    admissionSha256:
      calculateVisualAttemptAdmissionSha256(
        raw,
      ),
  });
}

export async function readVisualAttemptAdmission(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): Promise<
  VisualAttemptAdmission | null
> {
  const evidence =
    await readVisualAttemptAdmissionEvidenceInternal(
      mediaRoot,
      episodeId,
      shotId,
      attemptNumber,
    );

  return evidence
    ?.record ??
    null;
}

export async function readVisualAttemptAdmissionEvidence(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  attemptNumber:
    number,
): Promise<
  VisualAttemptAdmissionEvidence | null
> {
  return readVisualAttemptAdmissionEvidenceInternal(
    mediaRoot,
    episodeId,
    shotId,
    attemptNumber,
  );
}
