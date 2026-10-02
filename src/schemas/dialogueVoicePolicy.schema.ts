import {
  z,
} from "zod";

export const DialogueVoicePolicySchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    pricingReviewedOn:
      z.string()
        .regex(
          /^\d{4}-\d{2}-\d{2}$/,
          "pricingReviewedOn must use YYYY-MM-DD.",
        ),

    generation:
      z.object({
        model:
          z.literal(
            "eleven_v3",
          ),

        charactersPerCredit:
          z.number()
            .int()
            .positive(),

        minimumCredits:
          z.number()
            .int()
            .positive(),

        maxCreditsPerLine:
          z.number()
            .int()
            .positive(),

        maxPromptCharacters:
          z.number()
            .int()
            .positive()
            .max(
              1_000,
            ),

        applyTextNormalization:
          z.enum([
            "auto",
            "on",
            "off",
          ]),

        languageCode:
          z.string()
            .regex(
              /^[a-z]{2}$/,
              "Dialogue voice languageCode must use a two-letter lowercase ISO 639-1 code.",
            ),

        seed:
          z.number()
            .int()
            .min(
              0,
            )
            .max(
              4_294_967_295,
            ),

        similarityBoost:
          z.number()
            .min(
              0,
            )
            .max(
              1,
            ),

        speed:
          z.number()
            .min(
              0.7,
            )
            .max(
              1.2,
            ),

        stability:
          z.number()
            .min(
              0,
            )
            .max(
              1,
            ),

        style:
          z.number()
            .min(
              0,
            )
            .max(
              1,
            ),

        useSpeakerBoost:
          z.boolean(),
      })
        .strict(),

    task:
      z.object({
        waitTimeoutMs:
          z.number()
            .int()
            .min(
              1_000,
            )
            .max(
              900_000,
            ),
      })
        .strict(),
  })
    .strict()
    .superRefine(
      (
        policy,
        context,
      ) => {
        const maximumExpectedCredits =
          Math.max(
            policy.generation
              .minimumCredits,

            Math.ceil(
              policy.generation
                .maxPromptCharacters /
              policy.generation
                .charactersPerCredit,
            ),
          );

        if (
          maximumExpectedCredits >
          policy.generation
            .maxCreditsPerLine
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "generation",
              "maxCreditsPerLine",
            ],

            message:
              "Dialogue voice policy permits a prompt whose locally expected credits exceed the configured line ceiling.",
          });
        }
      },
    );

export type DialogueVoicePolicy =
  z.infer<
    typeof DialogueVoicePolicySchema
  >;
