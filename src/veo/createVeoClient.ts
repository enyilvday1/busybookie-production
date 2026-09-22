import {
  GoogleGenAI,
} from "@google/genai";

export function createVeoClient(
  apiKey:
    string,
): GoogleGenAI {
  const normalized =
    apiKey.trim();

  if (!normalized) {
    throw new Error(
      "Gemini API key cannot be empty.",
    );
  }

  return new GoogleGenAI({
    apiKey:
      normalized,
  });
}
