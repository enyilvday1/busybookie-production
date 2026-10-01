import {
  readFile,
} from "node:fs/promises";

import {
  EpisodeRoughCutRenderRecordSchema,
  type EpisodeRoughCutRenderRecord,
} from "./episodeRoughCutRenderRecord.schema.js";

import {
  createEpisodeRoughCutRenderRecordPath,
} from "./episodeRoughCutRenderRecordPath.js";

export async function readEpisodeRoughCutRenderRecord(
  roughCutOutputPath:
    string,
): Promise<
  EpisodeRoughCutRenderRecord | null
> {
  const requestedOutputPath =
    roughCutOutputPath.trim();

  const recordPath =
    createEpisodeRoughCutRenderRecordPath(
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
      `Episode rough-cut render record is not valid JSON: ${recordPath}`,
      {
        cause:
          error,
      },
    );
  }

  const record =
    EpisodeRoughCutRenderRecordSchema.parse(
      parsed,
    );

  if (
    record.plan.outputPath !==
      requestedOutputPath ||
    record.artifact.outputPath !==
      requestedOutputPath
  ) {
    throw new Error(
      `Episode rough-cut render record identity does not match requested output: ${requestedOutputPath}`,
    );
  }

  return record;
}
