import {
  readFile,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";

import {
  KreaPolicySchema,
  type KreaPolicy,
} from "../schemas/kreaPolicy.schema.js";

export const DEFAULT_KREA_POLICY_PATH =
  resolve(
    process.cwd(),
    "config",
    "krea-policy.json",
  );

export async function loadKreaPolicy(
  filePath:
    string =
      DEFAULT_KREA_POLICY_PATH,
): Promise<KreaPolicy> {
  const raw =
    await readFile(
      filePath,
      "utf8",
    );

  let parsedJson:
    unknown;

  try {
    parsedJson =
      JSON.parse(
        raw,
      );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Unknown JSON parsing error";

    throw new Error(
      `Krea policy contains invalid JSON: ${filePath}. ${detail}`,
    );
  }

  const result =
    KreaPolicySchema.safeParse(
      parsedJson,
    );

  if (!result.success) {
    throw new Error(
      `Krea policy validation failed: ${filePath}\n${result.error.message}`,
    );
  }

  return result.data;
}
