import {
  describe,
  expect,
  it,
} from "vitest";

import {
  VisualAttemptExecutionReservationSchema,
  VisualAttemptGoogleGenAiExecutionCompletionSchema,
  VisualAttemptGoogleGenAiExecutionSubmissionSchema,
} from "../src/execution/visualAttemptExecutionLifecycle.schema.js";

const admissionSha256 =
  "a".repeat(
    64,
  );

const reservationSha256 =
  "b".repeat(
    64,
  );

const submissionSha256 =
  "c".repeat(
    64,
  );

const generationRecordSha256 =
  "d".repeat(
    64,
  );

const scope = {
  episodeId:
    "EP93",

  sceneId:
    "SC01",

  shotId:
    "S01",

  attemptNumber:
    2,

  admissionId:
    "f71c8cf1-a82d-4410-954f-6af17cc3ce22",

  admissionSha256,
} as const;

const reservation = {
  schemaVersion:
    "1.0",

  reservationId:
    "a83c34e2-fe66-47e1-9166-dd25e947003a",

  reservedAt:
    "2026-11-02T22:40:00.000Z",

  status:
    "RESERVED",

  ...scope,

  provider:
    "GOOGLE_GENAI",
} as const;

const policySnapshot = {
  schemaVersion:
    "1.0",

  provider:
    "GOOGLE_GENAI",

  model:
    "gemini-omni-1.1-flash",

  pricingReviewedOn:
    "2026-10-23",

  pricingProvenance: {
    pricingSource:
      "GOOGLE_GEMINI_API_OFFICIAL_PRICING_PAGE",

    modelLifecycleSource:
      "GOOGLE_GEMINI_API_OFFICIAL_DEPRECATIONS_PAGE",

    verifiedOn:
      "2026-10-23",
  },

  pricing: {
    currency:
      "USD",

    fixedPointUnit:
      "MICRO_USD",

    tokensPerPricingUnit:
      1000000,

    inputMicroUsdPerMillionTokens:
      1500000,

    videoOutputMicroUsdPerMillionTokens:
      17500000,

    videoOutput720pTokensPerSecond:
      5792,

    knownVideoOutput720pMicroUsdPerSecond:
      101360,
  },

  costCompleteness: {
    costScope:
      "KNOWN_VIDEO_OUTPUT_PLUS_SEPARATE_INPUT_COMPONENT",

    preReservationTotalCostExactlyKnown:
      false,

    inputTokenComponentIncludedInKnownCost:
      false,
  },
} as const;

const recoveryMetadata = {
  request: {
    model:
      "gemini-omni-1.1-flash",

    background:
      true,

    store:
      true,

    stream:
      false,

    promptText:
      "Animate the approved Littleleaf Valley reference.",

    sourceImagePath:
      "D:\\Busybookie\\Production\\references\\littleleaf-valley\\littleleaf_valley_storybook_village.png",
  },

  policySnapshot,
} as const;

const submission = {
  schemaVersion:
    "1.0",

  submittedAt:
    "2026-11-02T22:41:00.000Z",

  status:
    "SUBMITTED",

  reservationId:
    reservation.reservationId,

  reservationSha256,

  ...scope,

  provider:
    "GOOGLE_GENAI",

  providerExecutionId:
    "interaction-test-2",

  recoveryMetadata,
} as const;

const completion = {
  schemaVersion:
    "1.0",

  completedAt:
    "2026-11-02T22:42:00.000Z",

  status:
    "COMPLETED",

  reservationId:
    reservation.reservationId,

  reservationSha256,

  submissionSha256,

  ...scope,

  provider:
    "GOOGLE_GENAI",

  providerExecutionId:
    submission.providerExecutionId,

  generationRecordPath:
    "D:\\Busybookie\\Production\\generated-video\\EP93\\S01\\EP93_S01_GOOGLE_GENAI_test.google-genai-generation.json",

  generationRecordSha256,
} as const;

describe(
  "visual attempt execution lifecycle schemas",
  () => {
    it(
      "accepts the frozen attempt-aware reservation record shape",
      () => {
        expect(
          VisualAttemptExecutionReservationSchema
            .parse(
              reservation,
            ),
        ).toEqual(
          reservation,
        );
      },
    );

    it(
      "rejects attempt 1 and unknown reservation fields",
      () => {
        expect(
          () =>
            VisualAttemptExecutionReservationSchema
              .parse({
                ...reservation,

                attemptNumber:
                  1,
              }),
        ).toThrow(
          "Replacement visual attempt number must be at least 2",
        );

        expect(
          () =>
            VisualAttemptExecutionReservationSchema
              .parse({
                ...reservation,

                unexpected:
                  true,
              }),
        ).toThrow();
      },
    );

    it(
      "accepts Google submission recovery metadata with the existing 1.4 semantics",
      () => {
        expect(
          VisualAttemptGoogleGenAiExecutionSubmissionSchema
            .parse(
              submission,
            ),
        ).toEqual(
          submission,
        );
      },
    );

    it(
      "rejects a separate interactionId or a non-Google submission provider",
      () => {
        expect(
          () =>
            VisualAttemptGoogleGenAiExecutionSubmissionSchema
              .parse({
                ...submission,

                interactionId:
                  "forbidden-separate-id",
              }),
        ).toThrow();

        expect(
          () =>
            VisualAttemptGoogleGenAiExecutionSubmissionSchema
              .parse({
                ...submission,

                provider:
                  "VEO",
              }),
        ).toThrow();
      },
    );

    it(
      "rejects Google recovery request drift",
      () => {
        expect(
          () =>
            VisualAttemptGoogleGenAiExecutionSubmissionSchema
              .parse({
                ...submission,

                recoveryMetadata: {
                  ...recoveryMetadata,

                  request: {
                    ...recoveryMetadata.request,

                    stream:
                      true,
                  },
                },
              }),
        ).toThrow();
      },
    );

    it(
      "accepts the frozen attempt-aware Google completion record shape",
      () => {
        expect(
          VisualAttemptGoogleGenAiExecutionCompletionSchema
            .parse(
              completion,
            ),
        ).toEqual(
          completion,
        );
      },
    );

    it(
      "rejects malformed exact-byte lineage hashes",
      () => {
        expect(
          () =>
            VisualAttemptGoogleGenAiExecutionCompletionSchema
              .parse({
                ...completion,

                submissionSha256:
                  "not-a-sha256",
              }),
        ).toThrow();

        expect(
          () =>
            VisualAttemptGoogleGenAiExecutionCompletionSchema
              .parse({
                ...completion,

                generationRecordSha256:
                  "ABCDEF",
              }),
        ).toThrow();
      },
    );

    it(
      "keeps physical output evidence out of the completion record",
      () => {
        expect(
          () =>
            VisualAttemptGoogleGenAiExecutionCompletionSchema
              .parse({
                ...completion,

                outputPath:
                  "forbidden.mp4",
              }),
        ).toThrow();
      },
    );
  },
);
