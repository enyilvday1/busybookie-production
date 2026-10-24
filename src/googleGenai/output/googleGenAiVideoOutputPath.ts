import {
  createHash,
} from "node:crypto";

import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

/**
 * Local output path for a materialized Google GenAI video.
 *
 * The provider-assigned Interaction.id never appears in the filesystem
 * path; the filename carries the full SHA-256 hex digest of the exact
 * providerExecutionId instead, so an arbitrary remote identifier cannot
 * influence path structure.
 */

export const GOOGLE_GENAI_VIDEO_OUTPUT_INDEX =
  1 as const;

const GOOGLE_GENAI_OUTPUT_PROVIDER_SEGMENT =
  "GOOGLE_GENAI";

const EPISODE_ID_PATTERN =
  /^EP[0-9]{2,3}$/;

const SHOT_ID_PATTERN =
  /^S[0-9]{2,3}[A-Z]?$/;

export function deriveGoogleGenAiProviderExecutionIdDigest(
  providerExecutionId:
    string,
): string {
  if (
    typeof providerExecutionId !==
      "string" ||
    !providerExecutionId.trim()
  ) {
    throw new Error(
      "Google GenAI providerExecutionId is required to derive an output path.",
    );
  }

  return createHash(
    "sha256",
  )
    .update(
      providerExecutionId,
      "utf8",
    )
    .digest(
      "hex",
    );
}

export function createGoogleGenAiVideoOutputPath(
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
      "Google GenAI media root must be an absolute path.",
    );
  }

  if (
    !EPISODE_ID_PATTERN.test(
      episodeId,
    )
  ) {
    throw new Error(
      `Invalid Google GenAI episode id: ${JSON.stringify(episodeId)}`,
    );
  }

  if (
    !SHOT_ID_PATTERN.test(
      shotId,
    )
  ) {
    throw new Error(
      `Invalid Google GenAI shot id: ${JSON.stringify(shotId)}`,
    );
  }

  const digest =
    deriveGoogleGenAiProviderExecutionIdDigest(
      providerExecutionId,
    );

  const index =
    String(
      GOOGLE_GENAI_VIDEO_OUTPUT_INDEX,
    ).padStart(
      2,
      "0",
    );

  const outputRoot =
    resolve(
      mediaRoot,
      "generated-video",
    );

  const outputPath =
    resolve(
      outputRoot,
      episodeId,
      shotId,
      `${episodeId}_${shotId}_${GOOGLE_GENAI_OUTPUT_PROVIDER_SEGMENT}_${digest}_${index}.mp4`,
    );

  const relativePath =
    relative(
      outputRoot,
      outputPath,
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
      `Google GenAI output path must stay inside ${outputRoot}.`,
    );
  }

  return outputPath;
}
