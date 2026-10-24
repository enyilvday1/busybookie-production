import {
  GoogleGenAI,
} from "@google/genai";

import type {
  GoogleGenAiInteractionCreator,
} from "./submitGoogleGenAiSingleShot.js";

/**
 * Dormant production binding for the Google GenAI submission adapter.
 *
 * Constructs one SDK client per factory call from an explicitly supplied
 * API key and returns the narrow createInteraction dependency. Every paid
 * create runs with maxRetries: 0 so the SDK never re-sends it; a failed
 * create may still have been accepted by Google, so it is never retried,
 * resubmitted, or redirected to another provider. Interaction.id
 * validation stays with submitGoogleGenAiSingleShot.
 */
export function createGoogleGenAiSingleShotProductionInteractionCreator(
  apiKey:
    string,
): GoogleGenAiInteractionCreator {
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
    request,
  ) => {
    const interaction =
      await client.interactions
        .create(
          request,
          {
            maxRetries:
              0,
          },
        )
        .catch(
          (error: unknown) => {
            throw new Error(
              "Google GenAI interaction create failed; Google may still have accepted the paid interaction. Do not resubmit automatically.",
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
    });
  };
}
