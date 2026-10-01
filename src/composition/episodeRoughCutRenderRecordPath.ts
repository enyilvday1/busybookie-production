import {
  isAbsolute,
} from "node:path";

const WINDOWS_ABSOLUTE_PATH_PATTERN =
  /^[A-Za-z]:[\\/]/;

const ROUGH_CUT_VIDEO_SUFFIX =
  ".mp4" as const;

const ROUGH_CUT_RECORD_SUFFIX =
  ".composition-rough-cut.json" as const;

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

export function createEpisodeRoughCutRenderRecordPath(
  roughCutOutputPath:
    string,
): string {
  const outputPath =
    roughCutOutputPath.trim();

  if (
    outputPath.length ===
      0 ||
    !isPortableAbsolutePath(
      outputPath,
    )
  ) {
    throw new Error(
      "Episode rough-cut render record requires an absolute rough-cut MP4 output path.",
    );
  }

  if (
    !outputPath.endsWith(
      ROUGH_CUT_VIDEO_SUFFIX,
    )
  ) {
    throw new Error(
      "Episode rough-cut render record requires a rough-cut MP4 output path.",
    );
  }

  return (
    outputPath.slice(
      0,
      -ROUGH_CUT_VIDEO_SUFFIX.length,
    ) +
    ROUGH_CUT_RECORD_SUFFIX
  );
}
