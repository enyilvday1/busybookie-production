import type {
  Shot,
} from "../../schemas/episodeManifest.schema.js";

/**
 * Google-owned single-shot prompt builder for the operator-only runner.
 *
 * Pure and deterministic: the prompt is the shot's visual action, then its
 * camera direction, then its continuity notes. Audio and dialogue never
 * enter the prompt, and a shot that needs them is refused rather than
 * silently reduced to its visuals. The limit is a BusyBookie operational
 * limit (the same local convention as Runway and Veo), not a Google one.
 */

export const GOOGLE_GENAI_PROMPT_MAX_CODE_UNITS =
  1000;

export function buildGoogleGenAiSingleShotPrompt(
  shot:
    Shot,
): string {
  if (
    shot.generation.nativeAudio
  ) {
    throw new Error(
      `Shot ${shot.id} requests native audio; the Google operator runner is visual-only.`,
    );
  }

  if (
    shot.dialogue.length >
    0
  ) {
    throw new Error(
      `Shot ${shot.id} contains dialogue; the Google operator runner is visual-only.`,
    );
  }

  const sections = [
    shot.visualAction,
    `Camera: ${shot.camera}`,
  ];

  if (
    shot.continuityNotes.length >
    0
  ) {
    sections.push(
      `Continuity: ${shot.continuityNotes.join(" ")}`,
    );
  }

  const prompt =
    sections
      .join(" ")
      .replace(
        /\s+/g,
        " ",
      )
      .trim();

  if (!prompt) {
    throw new Error(
      `Shot ${shot.id} produced an empty Google GenAI prompt.`,
    );
  }

  if (
    prompt.length >
    GOOGLE_GENAI_PROMPT_MAX_CODE_UNITS
  ) {
    throw new Error(
      `Shot ${shot.id} Google GenAI prompt exceeds the Busybookie local ${GOOGLE_GENAI_PROMPT_MAX_CODE_UNITS} UTF-16 code-unit limit.`,
    );
  }

  return prompt;
}
