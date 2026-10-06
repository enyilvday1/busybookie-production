import {
  readFile,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";

import {
  DialogueSeedAudioPolicySchema,
  type DialogueSeedAudioPolicy,
} from "../schemas/dialogueSeedAudioPolicy.schema.js";

export const DEFAULT_DIALOGUE_SEED_AUDIO_POLICY_PATH =
  resolve(
    process.cwd(),
    "config",
    "dialogue-seed-audio-policy.json",
  );

export async function loadDialogueSeedAudioPolicy(
  filePath:
    string =
      DEFAULT_DIALOGUE_SEED_AUDIO_POLICY_PATH,
): Promise<
  DialogueSeedAudioPolicy
> {
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
      `Dialogue SeedAudio policy contains invalid JSON: ${filePath}. ${detail}`,
    );
  }

  const result =
    DialogueSeedAudioPolicySchema
      .safeParse(
        parsedJson,
      );

  if (
    !result.success
  ) {
    throw new Error(
      `Dialogue SeedAudio policy validation failed: ${filePath}\n${result.error.message}`,
    );
  }

  return result.data;
}
