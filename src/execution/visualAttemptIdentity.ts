import {
  rawSha256,
} from "./boundEpisodeProduction.types.js";

/**
 * Hashes the exact effective provider prompt.
 *
 * This function deliberately performs no trimming, normalization,
 * canonicalization or provider-specific transformation.
 *
 * The caller must supply the exact prompt string that the selected provider
 * contract regards as effective after any provider-specific normalization.
 */
export function calculateVisualAttemptPromptIdentitySha256(
  effectivePromptText:
    string,
): string {
  if (
    effectivePromptText.length ===
      0
  ) {
    throw new Error(
      "Effective visual attempt prompt text is required.",
    );
  }

  return rawSha256(
    effectivePromptText,
  );
}

/**
 * Hashes the exact raw bytes of the approved visual reference.
 */
export function calculateVisualAttemptReferenceIdentitySha256(
  referenceBytes:
    Uint8Array,
): string {
  return rawSha256(
    referenceBytes,
  );
}

/**
 * Hashes the exact raw bytes of the bound episode manifest.
 */
export function calculateVisualAttemptManifestRawSha256(
  manifestBytes:
    Uint8Array,
): string {
  return rawSha256(
    manifestBytes,
  );
}
