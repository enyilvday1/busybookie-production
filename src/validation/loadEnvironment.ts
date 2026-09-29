import "dotenv/config";

import {
  EnvironmentSchema,
  type Environment,
} from "../schemas/environment.schema.js";

export function loadEnvironment(): Environment {
  const result = EnvironmentSchema.safeParse({
    BUSYBOOKIE_MEDIA_ROOT:
      process.env.BUSYBOOKIE_MEDIA_ROOT,

    RUNWAYML_API_SECRET:
      process.env.RUNWAYML_API_SECRET || undefined,

    GEMINI_API_KEY:
      process.env.GEMINI_API_KEY || undefined,

    BUSYBOOKIE_FFMPEG_PATH:
      process.env.BUSYBOOKIE_FFMPEG_PATH || undefined,

    BUSYBOOKIE_FFPROBE_PATH:
      process.env.BUSYBOOKIE_FFPROBE_PATH || undefined,
  });

  if (!result.success) {
    throw new Error(
      `Environment validation failed:\n${result.error.message}`,
    );
  }

  return result.data;
}
