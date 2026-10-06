import {
  z,
} from "zod";

export const DialogueSeedAudioPolicySchema =
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
            "seed_audio",
          ),

        creditsPerSecond:
          z.number()
            .positive(),

        minimumCredits:
          z.number()
            .positive(),

        maxGenerationSeconds:
          z.number()
            .int()
            .positive()
            .max(
              120,
            ),

        maxCreditsPerGeneration:
          z.number()
            .positive(),
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
        const maximumProviderCredits =
          Math.max(
            policy.generation
              .minimumCredits,

            policy.generation
              .creditsPerSecond *
              policy.generation
                .maxGenerationSeconds,
          );

        if (
          policy.generation
            .maxCreditsPerGeneration <
          policy.generation
            .minimumCredits
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "generation",
              "maxCreditsPerGeneration",
            ],

            message:
              "SeedAudio local credit ceiling must not be lower than the configured provider minimum charge.",
          });
        }

        if (
          policy.generation
            .maxCreditsPerGeneration >
          maximumProviderCredits
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "generation",
              "maxCreditsPerGeneration",
            ],

            message:
              "SeedAudio local credit ceiling must not exceed the maximum provider charge implied by configured pricing and generation duration.",
          });
        }
      },
    );

export type DialogueSeedAudioPolicy =
  z.infer<
    typeof DialogueSeedAudioPolicySchema
  >;
