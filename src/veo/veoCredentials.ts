export type GeminiCredentialEnvironment =
  Readonly<{
    GEMINI_API_KEY?:
      string;
  }>;

export function requireGeminiApiKey(
  env:
    GeminiCredentialEnvironment,
): string {
  const apiKey =
    env.GEMINI_API_KEY
      ?.trim();

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured.",
    );
  }

  return apiKey;
}
