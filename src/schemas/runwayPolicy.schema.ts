import { z } from "zod";

export const RunwayPolicySchema = z.object({
  schemaVersion: z.literal("1.0"),

  pricingReviewedOn: z.string().regex(
    /^\d{4}-\d{2}-\d{2}$/,
    "pricingReviewedOn must use YYYY-MM-DD.",
  ),

  gen45: z.object({
    creditsPerSecond: z.number().int().positive(),

    maxCreditsPerGeneration:
      z.number().int().positive(),

    maxDurationSeconds:
      z.number().int().min(2).max(10),
  }).strict(),

  task: z.object({
    waitTimeoutMs:
      z.number()
        .int()
        .min(1_000)
        .max(900_000),
  }).strict(),
}).strict().superRefine((policy, ctx) => {
  const minimumGenerationCredits =
    policy.gen45.creditsPerSecond * 2;

  if (
    policy.gen45.maxCreditsPerGeneration <
    minimumGenerationCredits
  ) {
    ctx.addIssue({
      code: "custom",
      path: [
        "gen45",
        "maxCreditsPerGeneration",
      ],
      message:
        "Runway credit limit is too low to permit the minimum two-second Gen-4.5 generation.",
    });
  }
});

export type RunwayPolicy = z.infer<
  typeof RunwayPolicySchema
>;
