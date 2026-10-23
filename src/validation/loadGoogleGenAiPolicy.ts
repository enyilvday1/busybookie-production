import {
  readFile,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";

import {
  GoogleGenAiPolicySchema,
  type GoogleGenAiPolicy,
} from "../schemas/googleGenAiPolicy.schema.js";

export const DEFAULT_GOOGLE_GENAI_POLICY_PATH =
  resolve(
    process.cwd(),
    "config",
    "google-genai-policy.json",
  );

export async function loadGoogleGenAiPolicy(
  filePath:
    string =
      DEFAULT_GOOGLE_GENAI_POLICY_PATH,
): Promise<GoogleGenAiPolicy> {
  let raw:
    string;

  try {
    raw =
      await readFile(
        filePath,
        "utf8",
      );
  } catch (error) {
    throw new Error(
      `Google GenAI policy could not be read: ${filePath}`,
      {
        cause: error,
      },
    );
  }

  let parsedJson:
    unknown;

  try {
    parsedJson =
      JSON.parse(raw);
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Unknown JSON parsing error";

    throw new Error(
      `Google GenAI policy contains invalid JSON: ${filePath}. ${detail}`,
    );
  }

  const result =
    GoogleGenAiPolicySchema.safeParse(
      parsedJson,
    );

  if (!result.success) {
    throw new Error(
      `Google GenAI policy validation failed: ${filePath}\n${result.error.message}`,
    );
  }

  return result.data;
}
