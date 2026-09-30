import {
  readFile,
} from "node:fs/promises";

import {
  CompositionShotNormalizationCacheRecordSchema,
  type CompositionShotNormalizationCacheRecord,
} from "./compositionShotNormalizationCacheRecord.schema.js";

import {
  createCompositionShotNormalizationCacheRecordPath,
} from "./compositionShotNormalizationCacheRecordPath.js";

export async function readCompositionShotNormalizationCacheRecord(
  normalizedOutputPath:
    string,
): Promise<
  CompositionShotNormalizationCacheRecord | null
> {
  const requestedOutputPath =
    normalizedOutputPath.trim();

  const recordPath =
    createCompositionShotNormalizationCacheRecordPath(
      requestedOutputPath,
    );

  let raw:
    string;

  try {
    raw =
      await readFile(
        recordPath,
        "utf8",
      );
  } catch (
    error
  ) {
    const code =
      (
        error as
          NodeJS.ErrnoException
      ).code;

    if (
      code ===
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
      `Composition normalization cache record is not valid JSON: ${recordPath}`,
      {
        cause:
          error,
      },
    );
  }

  const record =
    CompositionShotNormalizationCacheRecordSchema.parse(
      parsed,
    );

  if (
    record.plan.outputPath !==
      requestedOutputPath ||
    record.artifact.outputPath !==
      requestedOutputPath
  ) {
    throw new Error(
      `Composition normalization cache record identity does not match requested normalized output: ${requestedOutputPath}`,
    );
  }

  return record;
}
