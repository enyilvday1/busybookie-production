import {
  GOOGLE_GENAI_TOKENS_PER_PRICING_UNIT,
} from "./googleGenAi.types.js";

/**
 * Derives the known Google GenAI video-output cost component in integer
 * MICRO_USD per second of output video.
 *
 * This is ONLY the video-output component. Input-token consumption is a
 * separate, unknown-before-submission component, so the result is never a
 * complete pre-reservation request cost and must not be used to rank or
 * switch providers.
 *
 * Fails closed if the inputs are not positive safe integers or if the
 * derivation is not an exact integer number of MICRO_USD.
 */
export function deriveGoogleGenAiVideoOutputMicroUsdPerSecond(
  videoOutputTokensPerSecond:
    number,
  videoOutputMicroUsdPerMillionTokens:
    number,
): number {
  for (
    const [
      label,
      value,
    ] of [
      [
        "videoOutputTokensPerSecond",
        videoOutputTokensPerSecond,
      ],
      [
        "videoOutputMicroUsdPerMillionTokens",
        videoOutputMicroUsdPerMillionTokens,
      ],
    ] as const
  ) {
    if (
      !Number.isSafeInteger(
        value,
      ) ||
      value <= 0
    ) {
      throw new Error(
        `Google GenAI pricing derivation requires ${label} to be a positive safe integer.`,
      );
    }
  }

  const numerator =
    videoOutputTokensPerSecond *
    videoOutputMicroUsdPerMillionTokens;

  if (
    !Number.isSafeInteger(
      numerator,
    )
  ) {
    throw new Error(
      "Google GenAI pricing derivation overflowed the safe integer range.",
    );
  }

  if (
    numerator %
      GOOGLE_GENAI_TOKENS_PER_PRICING_UNIT !==
    0
  ) {
    throw new Error(
      "Google GenAI video-output cost per second is not an exact integer number of MICRO_USD.",
    );
  }

  return (
    numerator /
    GOOGLE_GENAI_TOKENS_PER_PRICING_UNIT
  );
}
