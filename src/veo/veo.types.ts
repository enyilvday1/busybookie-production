export const VEO31_FAST_MODEL =
  "veo-3.1-fast-generate-preview" as const;

export const VEO_LANDSCAPE_ASPECT_RATIO =
  "16:9" as const;

export const VEO_720P_RESOLUTION =
  "720p" as const;

export const VEO_EXPECTED_OUTPUT_FPS =
  24 as const;

export const VEO_ALLOWED_DURATIONS_SECONDS =
  [
    4,
    6,
    8,
  ] as const;

export type VeoDurationSeconds =
  typeof VEO_ALLOWED_DURATIONS_SECONDS[number];

export const VEO_IMAGE_MIME_TYPES =
  [
    "image/png",
    "image/jpeg",
    "image/webp",
  ] as const;

export type VeoImageMimeType =
  typeof VEO_IMAGE_MIME_TYPES[number];

export type VeoInlineImage =
  Readonly<{
    imageBytes: string;
    mimeType: VeoImageMimeType;
  }>;
