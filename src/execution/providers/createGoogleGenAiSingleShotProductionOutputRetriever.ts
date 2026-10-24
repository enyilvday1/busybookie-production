import {
  GoogleGenAI,
} from "@google/genai";

import type {
  GoogleGenAiOutputRetriever,
} from "./materializeGoogleGenAiSingleShotOutput.js";

/**
 * Dormant production binding for Google GenAI same-ID output retrieval.
 *
 * Constructs one SDK client per factory call from an explicitly supplied
 * API key and returns the narrow retrieveOutput dependency. Every lookup
 * is a single non-streaming get of the durable Interaction.id with
 * maxRetries: 0 that returns the raw id, status, and output_video.
 * Validation and file materialization stay with
 * materializeGoogleGenAiSingleShotOutput; no output is downloaded here.
 */
export function createGoogleGenAiSingleShotProductionOutputRetriever(
  apiKey:
    string,
): GoogleGenAiOutputRetriever {
  const normalizedApiKey =
    typeof apiKey ===
      "string"
      ? apiKey.trim()
      : "";

  if (!normalizedApiKey) {
    throw new Error(
      "Google GenAI API key is required.",
    );
  }

  const client =
    new GoogleGenAI({
      apiKey:
        normalizedApiKey,
    });

  return async (
    providerExecutionId,
  ) => {
    if (
      typeof providerExecutionId !==
        "string" ||
      !providerExecutionId.trim()
    ) {
      throw new Error(
        "Google GenAI same-ID output retrieval requires a non-empty providerExecutionId.",
      );
    }

    const interaction =
      await client.interactions
        .get(
          providerExecutionId,
          {
            stream:
              false,

            include_input:
              false,
          },
          {
            maxRetries:
              0,
          },
        )
        .catch(
          (error: unknown) => {
            throw new Error(
              `Google GenAI same-ID output retrieval failed for ${providerExecutionId}. Busybookie must not create or resubmit a replacement interaction automatically.`,
              {
                cause:
                  error,
              },
            );
          },
        );

    return Object.freeze({
      id:
        interaction.id,

      status:
        interaction.status,

      outputVideo:
        interaction.output_video,
    });
  };
}
