import {
  readFile,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";

import {
  DialogueVoicePolicySchema,
  type DialogueVoicePolicy,
} from "../schemas/dialogueVoicePolicy.schema.js";

export const DEFAULT_DIALOGUE_VOICE_POLICY_PATH =
  resolve(
    process.cwd(),
    "config",
    "dialogue-voice-policy.json",
  );

export async function loadDialogueVoicePolicy(
  filePath:
    string =
      DEFAULT_DIALOGUE_VOICE_POLICY_PATH,
): Promise<DialogueVoicePolicy> {
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
      `Dialogue voice policy contains invalid JSON: ${filePath}. ${detail}`,
    );
  }

  const result =
    DialogueVoicePolicySchema
      .safeParse(
        parsedJson,
      );

  if (
    !result.success
  ) {
    throw new Error(
      `Dialogue voice policy validation failed: ${filePath}\n${result.error.message}`,
    );
  }

  return result.data;
}
