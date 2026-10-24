import {
  GoogleGenAI,
} from "@google/genai";

import type {
  GoogleGenAiInteractionGetter,
} from "./recoverGoogleGenAiSingleShot.js";

/**
 * Dormant production binding for Google GenAI same-ID recovery.
 *
 * Constructs one SDK client per factory call from an explicitly supplied
 * API key and returns the narrow getInteraction dependency. Every lookup
 * is a single non-streaming get of the durable Interaction.id with
 * maxRetries: 0. A failed lookup never leads to a replacement create,
 * resubmission, or provider switch. Status classification stays with
 * recoverGoogleGenAiSingleShot.
 */
export function createGoogleGenAiSingleShotProductionInteractionGetter(
  apiKey:
    string,
): GoogleGenAiInteractionGetter {
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
        "Google GenAI same-ID recovery requires a non-empty providerExecutionId.",
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
              `Google GenAI same-ID interaction recovery failed for ${providerExecutionId}. Busybookie must not create or resubmit a replacement interaction automatically.`,
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
    });
  };
}
