import {
  readFile,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";

import {
  GoogleGenAiActivationPolicySchema,
  type GoogleGenAiActivationPolicy,
} from "../schemas/googleGenAiActivationPolicy.schema.js";

export const DEFAULT_GOOGLE_GENAI_ACTIVATION_POLICY_PATH =
  resolve(
    process.cwd(),
    "config",
    "google-genai-activation-policy.json",
  );

export type LoadedGoogleGenAiActivationPolicy =
  Readonly<{
    [Section in keyof GoogleGenAiActivationPolicy]:
      GoogleGenAiActivationPolicy[Section] extends object
        ? Readonly<GoogleGenAiActivationPolicy[Section]>
        : GoogleGenAiActivationPolicy[Section];
  }>;

function freezeSections(
  policy:
    GoogleGenAiActivationPolicy,
): LoadedGoogleGenAiActivationPolicy {
  return Object.freeze({
    ...policy,

    admission:
      Object.freeze({
        ...policy.admission,
      }),

    cost:
      Object.freeze({
        ...policy.cost,
      }),

    limits:
      Object.freeze({
        ...policy.limits,
      }),

    timeouts:
      Object.freeze({
        ...policy.timeouts,
      }),

    recovery:
      Object.freeze({
        ...policy.recovery,
      }),
  });
}

/**
 * Reads, parses and strictly validates the operational Google GenAI
 * activation policy. Any read, JSON or schema failure throws; there is
 * no default, no environment override, and no permissive fallback.
 */
export async function loadGoogleGenAiActivationPolicy(
  filePath:
    string =
      DEFAULT_GOOGLE_GENAI_ACTIVATION_POLICY_PATH,
): Promise<LoadedGoogleGenAiActivationPolicy> {
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
      `Google GenAI activation policy could not be read: ${filePath}`,
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
      `Google GenAI activation policy contains invalid JSON: ${filePath}. ${detail}`,
    );
  }

  const result =
    GoogleGenAiActivationPolicySchema.safeParse(
      parsedJson,
    );

  if (!result.success) {
    throw new Error(
      `Google GenAI activation policy validation failed: ${filePath}\n${result.error.message}`,
    );
  }

  return freezeSections(
    result.data,
  );
}
