import {
  z,
} from "zod";

export const GEN45_MODEL =
  "gen4.5" as const;

export const GEN45_LANDSCAPE_RATIO =
  "1280:720" as const;

export const GEN45_OUTPUT_FORMAT =
  "mp4" as const;

export const Gen45RequestSchema =
  z.object({
    model:
      z.literal(
        GEN45_MODEL,
      ),

    promptImage:
      z.string()
        .trim()
        .min(1),

    promptText:
      z.string()
        .trim()
        .min(1)
        .refine(
          (value) =>
            value.length <=
            1000,
          {
            message:
              "Gen-4.5 promptText must not exceed 1000 UTF-16 code units.",
          },
        ),

    ratio:
      z.literal(
        GEN45_LANDSCAPE_RATIO,
      ),

    duration:
      z.number()
        .int()
        .min(2)
        .max(10),

    outputFormat:
      z.literal(
        GEN45_OUTPUT_FORMAT,
      ),
  })
    .strict();

export type Gen45Request =
  z.infer<
    typeof Gen45RequestSchema
  >;
