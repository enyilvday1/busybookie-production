import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  ProductionRulesSchema,
  type ProductionRules,
} from "../schemas/productionRules.schema.js";

export const DEFAULT_PRODUCTION_RULES_PATH = resolve(
  process.cwd(),
  "config",
  "production-rules.json",
);

export async function loadProductionRules(
  filePath: string = DEFAULT_PRODUCTION_RULES_PATH,
): Promise<ProductionRules> {
  const raw = await readFile(filePath, "utf8");

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Unknown JSON parsing error";

    throw new Error(
      `Production Rules contain invalid JSON: ${filePath}. ${detail}`,
    );
  }

  const result = ProductionRulesSchema.safeParse(parsedJson);

  if (!result.success) {
    throw new Error(
      `Production Rules validation failed: ${filePath}\n${result.error.message}`,
    );
  }

  return result.data;
}
