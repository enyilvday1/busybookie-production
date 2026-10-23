import {
  z,
} from "zod";

import {
  GEMINI_OMNI_11_FLASH_MODEL,
  GOOGLE_GENAI_COST_SCOPE,
  GOOGLE_GENAI_FIXED_POINT_UNIT,
  GOOGLE_GENAI_MODEL_LIFECYCLE_SOURCE,
  GOOGLE_GENAI_NORMALIZED_CURRENCY,
  GOOGLE_GENAI_PRICING_SOURCE,
  GOOGLE_GENAI_PROVIDER,
  GOOGLE_GENAI_TOKENS_PER_PRICING_UNIT,
} from "../googleGenai/googleGenAi.types.js";

import {
  deriveGoogleGenAiVideoOutputMicroUsdPerSecond,
} from "../googleGenai/googleGenAiPricing.js";

const PositiveSafeIntegerSchema =
  z.number()
    .int()
    .positive()
    .refine(
      Number.isSafeInteger,
      "Value must be a safe integer.",
    );

const IsoDateSchema =
  z.string()
    .regex(
      /^\d{4}-\d{2}-\d{2}$/,
      "Date must use YYYY-MM-DD.",
    );

export const GoogleGenAiPolicySchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    provider:
      z.literal(
        GOOGLE_GENAI_PROVIDER,
      ),

    model:
      z.literal(
        GEMINI_OMNI_11_FLASH_MODEL,
      ),

    pricingReviewedOn:
      IsoDateSchema,

    pricingProvenance:
      z.object({
        pricingSource:
          z.literal(
            GOOGLE_GENAI_PRICING_SOURCE,
          ),

        modelLifecycleSource:
          z.literal(
            GOOGLE_GENAI_MODEL_LIFECYCLE_SOURCE,
          ),

        verifiedOn:
          IsoDateSchema,
      })
        .strict(),

    pricing:
      z.object({
        currency:
          z.literal(
            GOOGLE_GENAI_NORMALIZED_CURRENCY,
          ),

        fixedPointUnit:
          z.literal(
            GOOGLE_GENAI_FIXED_POINT_UNIT,
          ),

        tokensPerPricingUnit:
          z.literal(
            GOOGLE_GENAI_TOKENS_PER_PRICING_UNIT,
          ),

        inputMicroUsdPerMillionTokens:
          PositiveSafeIntegerSchema,

        videoOutputMicroUsdPerMillionTokens:
          PositiveSafeIntegerSchema,

        videoOutput720pTokensPerSecond:
          PositiveSafeIntegerSchema,

        knownVideoOutput720pMicroUsdPerSecond:
          PositiveSafeIntegerSchema,
      })
        .strict(),

    costCompleteness:
      z.object({
        costScope:
          z.literal(
            GOOGLE_GENAI_COST_SCOPE,
          ),

        preReservationTotalCostExactlyKnown:
          z.literal(false),

        inputTokenComponentIncludedInKnownCost:
          z.literal(false),
      })
        .strict(),
  })
    .strict()
    .superRefine(
      (
        policy,
        context,
      ) => {
        if (
          policy.pricingProvenance
            .verifiedOn !==
          policy.pricingReviewedOn
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "pricingProvenance",
              "verifiedOn",
            ],
            message:
              "Google GenAI pricing provenance verification date must equal pricingReviewedOn.",
          });
        }

        let derived:
          number;

        try {
          derived =
            deriveGoogleGenAiVideoOutputMicroUsdPerSecond(
              policy.pricing
                .videoOutput720pTokensPerSecond,
              policy.pricing
                .videoOutputMicroUsdPerMillionTokens,
            );
        } catch (error) {
          context.addIssue({
            code: "custom",
            path: [
              "pricing",
              "knownVideoOutput720pMicroUsdPerSecond",
            ],
            message:
              error instanceof Error
                ? error.message
                : "Google GenAI video-output pricing derivation failed.",
          });

          return;
        }

        if (
          derived !==
          policy.pricing
            .knownVideoOutput720pMicroUsdPerSecond
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "pricing",
              "knownVideoOutput720pMicroUsdPerSecond",
            ],
            message:
              `Google GenAI known 720p video-output component must equal the derived ${derived} MICRO_USD per second.`,
          });
        }
      },
    );

export type GoogleGenAiPolicy =
  z.infer<
    typeof GoogleGenAiPolicySchema
  >;
