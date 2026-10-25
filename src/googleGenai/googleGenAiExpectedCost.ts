import {
  GOOGLE_GENAI_VIDEO_RESOLUTIONS,
  type GoogleGenAiVideoResolution,
} from "./googleGenAiActivationLimits.js";

/**
 * Pure, fail-closed Google GenAI expected-cost preflight.
 *
 * expectedMicroUsd =
 *   costAdmissionDurationSeconds x videoOutputMicroUsdPerSecond[resolution]
 *   + inputReserveMicroUsd
 *
 * All arithmetic is integer MICRO_USD. Only resolutions with an
 * authoritative local price are admissible; today that is 720p alone,
 * taken from the verified Google GenAI pricing policy. No rate is
 * guessed, scaled, or inferred for any other resolution.
 */

export const GOOGLE_GENAI_EXPECTED_COST_REJECTION_CODES =
  Object.freeze([
    "RESOLUTION_UNSUPPORTED",
    "PRICING_UNAVAILABLE",
    "CALCULATION_FAILED",
    "COST_EXCEEDS_CAP",
  ] as const);

export type GoogleGenAiExpectedCostRejectionCode =
  typeof GOOGLE_GENAI_EXPECTED_COST_REJECTION_CODES[number];

export class GoogleGenAiExpectedCostRejectedError extends Error {
  readonly code:
    GoogleGenAiExpectedCostRejectionCode;

  constructor(
    code:
      GoogleGenAiExpectedCostRejectionCode,
    message:
      string,
  ) {
    super(
      `Google GenAI expected-cost preflight rejected the submission (${code}): ${message}`,
    );

    this.name =
      "GoogleGenAiExpectedCostRejectedError";

    this.code =
      code;
  }
}

export type GoogleGenAiVerifiedVideoPricing =
  Readonly<{
    knownVideoOutput720pMicroUsdPerSecond:
      number;
  }>;

export type GoogleGenAiExpectedCostPolicy =
  Readonly<{
    maxExpectedCostMicroUsd:
      number;

    inputReserveMicroUsd:
      number;

    costAdmissionDurationSeconds:
      number;
  }>;

export type GoogleGenAiExpectedCostInput =
  Readonly<{
    resolution:
      unknown;

    pricing:
      GoogleGenAiVerifiedVideoPricing;

    cost:
      GoogleGenAiExpectedCostPolicy;
  }>;

export type GoogleGenAiExpectedCost =
  Readonly<{
    resolution:
      GoogleGenAiVideoResolution;

    videoOutputMicroUsdPerSecond:
      number;

    durationSeconds:
      number;

    videoOutputMicroUsd:
      number;

    inputReserveMicroUsd:
      number;

    expectedMicroUsd:
      number;

    maxExpectedCostMicroUsd:
      number;
  }>;

function requireResolution(
  resolution:
    unknown,
): GoogleGenAiVideoResolution {
  const match =
    GOOGLE_GENAI_VIDEO_RESOLUTIONS.find(
      (candidate) =>
        candidate ===
        resolution,
    );

  if (match === undefined) {
    throw new GoogleGenAiExpectedCostRejectedError(
      "RESOLUTION_UNSUPPORTED",
      `resolution ${JSON.stringify(resolution)} is not a supported Google GenAI video resolution.`,
    );
  }

  return match;
}

function verifiedRatePerSecond(
  resolution:
    GoogleGenAiVideoResolution,
  pricing:
    GoogleGenAiVerifiedVideoPricing,
): number | undefined {
  switch (resolution) {
    case "720p":
      return pricing.knownVideoOutput720pMicroUsdPerSecond;

    case "360p":
    case "1080p":
    case "4k":
      return undefined;
  }
}

function requirePositiveSafeInteger(
  label:
    string,
  value:
    number,
): number {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value <= 0
  ) {
    throw new GoogleGenAiExpectedCostRejectedError(
      "CALCULATION_FAILED",
      `${label} must be a positive safe integer.`,
    );
  }

  return value;
}

function requireSafeInteger(
  label:
    string,
  value:
    number,
): number {
  if (
    !Number.isSafeInteger(
      value,
    )
  ) {
    throw new GoogleGenAiExpectedCostRejectedError(
      "CALCULATION_FAILED",
      `${label} overflowed the safe integer range.`,
    );
  }

  return value;
}

export function computeGoogleGenAiExpectedCost(
  input:
    GoogleGenAiExpectedCostInput,
): GoogleGenAiExpectedCost {
  const resolution =
    requireResolution(
      input.resolution,
    );

  const rate =
    verifiedRatePerSecond(
      resolution,
      input.pricing,
    );

  if (rate === undefined) {
    throw new GoogleGenAiExpectedCostRejectedError(
      "PRICING_UNAVAILABLE",
      `no authoritative local price exists for ${resolution}.`,
    );
  }

  const videoOutputMicroUsdPerSecond =
    requirePositiveSafeInteger(
      "videoOutputMicroUsdPerSecond",
      rate,
    );

  const durationSeconds =
    requirePositiveSafeInteger(
      "costAdmissionDurationSeconds",
      input.cost.costAdmissionDurationSeconds,
    );

  const inputReserveMicroUsd =
    requirePositiveSafeInteger(
      "inputReserveMicroUsd",
      input.cost.inputReserveMicroUsd,
    );

  const maxExpectedCostMicroUsd =
    requirePositiveSafeInteger(
      "maxExpectedCostMicroUsd",
      input.cost.maxExpectedCostMicroUsd,
    );

  const videoOutputMicroUsd =
    requireSafeInteger(
      "videoOutputMicroUsd",
      durationSeconds *
        videoOutputMicroUsdPerSecond,
    );

  const expectedMicroUsd =
    requireSafeInteger(
      "expectedMicroUsd",
      videoOutputMicroUsd +
        inputReserveMicroUsd,
    );

  if (
    expectedMicroUsd >
    maxExpectedCostMicroUsd
  ) {
    throw new GoogleGenAiExpectedCostRejectedError(
      "COST_EXCEEDS_CAP",
      `expected ${expectedMicroUsd} MICRO_USD exceeds the ${maxExpectedCostMicroUsd} MICRO_USD cap.`,
    );
  }

  return Object.freeze({
    resolution,
    videoOutputMicroUsdPerSecond,
    durationSeconds,
    videoOutputMicroUsd,
    inputReserveMicroUsd,
    expectedMicroUsd,
    maxExpectedCostMicroUsd,
  });
}
