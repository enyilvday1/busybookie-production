import {
  EnvironmentSchema,
} from "../schemas/environment.schema.js";

// Least-privilege environment for durable visual evidence adoption. A human
// evidence review has no provider authority, so this reads exactly two
// process environment properties and nothing else: no .env file is loaded,
// and provider credential variables are never read, copied, validated,
// cleared or logged. The field rules are the canonical environment schema's.
const VisualEvidenceAdoptionEnvironmentSchema =
  EnvironmentSchema.pick({
    BUSYBOOKIE_MEDIA_ROOT:
      true,

    BUSYBOOKIE_FFPROBE_PATH:
      true,
  });

export type VisualEvidenceAdoptionEnvironment =
  Readonly<{
    BUSYBOOKIE_MEDIA_ROOT:
      string;

    BUSYBOOKIE_FFPROBE_PATH?:
      string;
  }>;

export type VisualEvidenceAdoptionEnvironmentSource =
  Readonly<Record<string, string | undefined>>;

export function loadVisualEvidenceAdoptionEnvironment(
  source:
    VisualEvidenceAdoptionEnvironmentSource =
      process.env,
): VisualEvidenceAdoptionEnvironment {
  // Exactly these two property reads; the source is never enumerated.
  const mediaRoot =
    source.BUSYBOOKIE_MEDIA_ROOT;

  const ffprobePath =
    source.BUSYBOOKIE_FFPROBE_PATH;

  const result =
    VisualEvidenceAdoptionEnvironmentSchema
      .safeParse({
        BUSYBOOKIE_MEDIA_ROOT:
          mediaRoot,

        // Existing runtime convention: an empty value means "not configured".
        BUSYBOOKIE_FFPROBE_PATH:
          ffprobePath ||
          undefined,
      });

  if (!result.success) {
    // Fixed text: never echo a supplied value.
    throw new Error(
      "Visual evidence adoption requires BUSYBOOKIE_MEDIA_ROOT in the process environment (BUSYBOOKIE_FFPROBE_PATH is optional).",
    );
  }

  return Object.freeze({
    BUSYBOOKIE_MEDIA_ROOT:
      result.data.BUSYBOOKIE_MEDIA_ROOT,

    ...(result.data.BUSYBOOKIE_FFPROBE_PATH
      ? {
          BUSYBOOKIE_FFPROBE_PATH:
            result.data.BUSYBOOKIE_FFPROBE_PATH,
        }
      : {}),
  });
}
