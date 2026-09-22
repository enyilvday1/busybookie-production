import {
  GEN45_LANDSCAPE_RATIO,
  GEN45_MODEL,
  GEN45_OUTPUT_FORMAT,
  Gen45RequestSchema,
  type Gen45Request,
} from "./gen45Request.schema.js";

export type BuildGen45RequestInput =
  Readonly<{
    promptImage: string;
    promptText: string;
    durationSeconds: number;
  }>;

export function buildGen45Request(
  input:
    BuildGen45RequestInput,
): Gen45Request {
  return Gen45RequestSchema.parse({
    model:
      GEN45_MODEL,

    promptImage:
      input.promptImage,

    promptText:
      input.promptText,

    ratio:
      GEN45_LANDSCAPE_RATIO,

    duration:
      input.durationSeconds,

    outputFormat:
      GEN45_OUTPUT_FORMAT,
  });
}
