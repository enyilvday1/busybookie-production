import { z } from "zod";

export const EnvironmentSchema = z.object({
  BUSYBOOKIE_MEDIA_ROOT: z
    .string()
    .trim()
    .min(1),

  RUNWAYML_API_SECRET: z
    .string()
    .trim()
    .optional(),

  GEMINI_API_KEY: z
    .string()
    .trim()
    .optional(),
}).strict();

export type Environment = z.infer<
  typeof EnvironmentSchema
>;
