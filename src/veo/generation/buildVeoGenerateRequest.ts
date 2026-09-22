import type {
  GenerateVideosParameters,
} from "@google/genai";

import type {
  VeoPolicy,
} from "../../schemas/veoPolicy.schema.js";

import type {
  VeoInlineImage,
} from "../veo.types.js";

import {
  VeoGenerateRequestSchema,
  type VeoGenerateRequest,
} from "./veoRequest.schema.js";

export type BuildVeoGenerateRequestInput =
  Readonly<{
    promptText:
      string;

    durationSeconds:
      number;

    image?:
      VeoInlineImage;
  }>;

export function buildVeoGenerateRequest(
  input:
    BuildVeoGenerateRequestInput,

  policy:
    VeoPolicy,
): VeoGenerateRequest {
  const candidate = {
    model:
      policy.generation.model,

    source: {
      prompt:
        input.promptText,

      ...(
        input.image
          ? {
              image:
                input.image,
            }
          : {}
      ),
    },

    config: {
      numberOfVideos:
        policy.generation
          .numberOfVideos,

      durationSeconds:
        input.durationSeconds,

      aspectRatio:
        policy.generation
          .aspectRatio,

      resolution:
        policy.generation
          .resolution,
    },
  } satisfies GenerateVideosParameters;

  return VeoGenerateRequestSchema
    .parse(
      candidate,
    );
}
