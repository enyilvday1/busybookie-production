import {
  isAbsolute,
} from "node:path";

const WINDOWS_ABSOLUTE_PATH_PATTERN =
  /^[A-Za-z]:[\\/]/;

const NORMALIZED_VIDEO_SUFFIX =
  ".mp4" as const;

const NORMALIZATION_RECORD_SUFFIX =
  ".composition-normalization.json" as const;

function isPortableAbsolutePath(
  value:
    string,
): boolean {
  return (
    isAbsolute(
      value,
    ) ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(
      value,
    )
  );
}

export function createCompositionShotNormalizationCacheRecordPath(
  normalizedOutputPath:
    string,
): string {
  const outputPath =
    normalizedOutputPath.trim();

  if (
    outputPath.length ===
      0 ||
    !isPortableAbsolutePath(
      outputPath,
    )
  ) {
    throw new Error(
      "Composition normalization cache record requires an absolute normalized MP4 output path.",
    );
  }

  if (
    !outputPath.endsWith(
      NORMALIZED_VIDEO_SUFFIX,
    )
  ) {
    throw new Error(
      "Composition normalization cache record requires a normalized MP4 output path.",
    );
  }

  return (
    outputPath.slice(
      0,
      -NORMALIZED_VIDEO_SUFFIX.length,
    ) +
    NORMALIZATION_RECORD_SUFFIX
  );
}
