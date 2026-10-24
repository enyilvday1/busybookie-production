import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationShotIdSchema,
} from "../../execution/executionReservation.schema.js";

import {
  deriveGoogleGenAiProviderExecutionIdDigest,
} from "../output/googleGenAiVideoOutputPath.js";

/**
 * Canonical Google GenAI generation record path. The filename carries the
 * full SHA-256 hex digest of the exact providerExecutionId; the raw
 * provider identifier never appears in the path.
 */
export function createGoogleGenAiGenerationRecordPath(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  providerExecutionId:
    string,
): string {
  if (
    typeof mediaRoot !==
      "string" ||
    !mediaRoot.trim() ||
    !isAbsolute(
      mediaRoot,
    )
  ) {
    throw new Error(
      "Google GenAI generation record media root must be an absolute path.",
    );
  }

  const validatedEpisodeId =
    ExecutionReservationEpisodeIdSchema
      .parse(
        episodeId,
      );

  const validatedShotId =
    ExecutionReservationShotIdSchema
      .parse(
        shotId,
      );

  const digest =
    deriveGoogleGenAiProviderExecutionIdDigest(
      providerExecutionId,
    );

  const outputRoot =
    resolve(
      mediaRoot,
      "generated-video",
    );

  const recordPath =
    resolve(
      outputRoot,
      validatedEpisodeId,
      validatedShotId,
      `${validatedEpisodeId}_${validatedShotId}_GOOGLE_GENAI_${digest}.google-genai-generation.json`,
    );

  const relativePath =
    relative(
      outputRoot,
      recordPath,
    );

  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(
      `..${sep}`,
    ) ||
    isAbsolute(
      relativePath,
    )
  ) {
    throw new Error(
      `Google GenAI generation record path must stay inside ${outputRoot}.`,
    );
  }

  return recordPath;
}
