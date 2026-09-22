import {
  readFile,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";

import {
  RunwayPolicySchema,
  type RunwayPolicy,
} from "../schemas/runwayPolicy.schema.js";

export const DEFAULT_RUNWAY_POLICY_PATH =
  resolve(
    process.cwd(),
    "config",
    "runway-policy.json",
  );

export async function loadRunwayPolicy(
  filePath:
    string =
      DEFAULT_RUNWAY_POLICY_PATH,
): Promise<RunwayPolicy> {
  const raw =
    await readFile(
      filePath,
      "utf8",
    );

  let parsedJson: unknown;

  try {
    parsedJson =
      JSON.parse(raw);
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Unknown JSON parsing error";

    throw new Error(
      `Runway policy contains invalid JSON: ${filePath}. ${detail}`,
    );
  }

  const result =
    RunwayPolicySchema.safeParse(
      parsedJson,
    );

  if (!result.success) {
    throw new Error(
      `Runway policy validation failed: ${filePath}\n${result.error.message}`,
    );
  }

  return result.data;
}
