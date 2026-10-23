export const GOOGLE_GENAI_PROVIDER =
  "GOOGLE_GENAI" as const;

export type GoogleGenAiProvider =
  typeof GOOGLE_GENAI_PROVIDER;

export const GEMINI_OMNI_11_FLASH_MODEL =
  "gemini-omni-1.1-flash" as const;

export type GoogleGenAiModel =
  typeof GEMINI_OMNI_11_FLASH_MODEL;

export const GOOGLE_GENAI_NORMALIZED_CURRENCY =
  "USD" as const;

export const GOOGLE_GENAI_FIXED_POINT_UNIT =
  "MICRO_USD" as const;

export const GOOGLE_GENAI_TOKENS_PER_PRICING_UNIT =
  1_000_000 as const;

export const GOOGLE_GENAI_PRICING_SOURCE =
  "GOOGLE_GEMINI_API_OFFICIAL_PRICING_PAGE" as const;

export const GOOGLE_GENAI_MODEL_LIFECYCLE_SOURCE =
  "GOOGLE_GEMINI_API_OFFICIAL_DEPRECATIONS_PAGE" as const;

export const GOOGLE_GENAI_COST_SCOPE =
  "KNOWN_VIDEO_OUTPUT_PLUS_SEPARATE_INPUT_COMPONENT" as const;
