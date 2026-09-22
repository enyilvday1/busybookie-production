import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  CharacterBibleSchema,
  type CharacterBible,
} from "../schemas/character.schema.js";

export const DEFAULT_CHARACTER_BIBLE_PATH = resolve(
  process.cwd(),
  "config",
  "characters.json",
);

export async function loadCharacterBible(
  filePath: string = DEFAULT_CHARACTER_BIBLE_PATH,
): Promise<CharacterBible> {
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
      `Character Bible contains invalid JSON: ${filePath}. ${detail}`,
    );
  }

  const result = CharacterBibleSchema.safeParse(parsedJson);

  if (!result.success) {
    throw new Error(
      `Character Bible validation failed: ${filePath}\n${result.error.message}`,
    );
  }

  return result.data;
}
