import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  ProviderRoutingPolicySchema,
  type ProviderRoutingPolicy,
} from "../schemas/providerRoutingPolicy.schema.js";

export const DEFAULT_PROVIDER_ROUTING_POLICY_PATH = resolve(
  process.cwd(),
  "config",
  "provider-routing-policy.json",
);

export async function loadProviderRoutingPolicy(
  filePath: string = DEFAULT_PROVIDER_ROUTING_POLICY_PATH,
): Promise<ProviderRoutingPolicy> {
  const raw = await readFile(
    filePath,
    "utf8",
  );

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Unknown JSON parsing error";

    throw new Error(
      `Provider routing policy contains invalid JSON: ${filePath}. ${detail}`,
    );
  }

  const result =
    ProviderRoutingPolicySchema.safeParse(
      parsedJson,
    );

  if (!result.success) {
    throw new Error(
      `Provider routing policy validation failed: ${filePath}\n${result.error.message}`,
    );
  }

  return result.data;
}
