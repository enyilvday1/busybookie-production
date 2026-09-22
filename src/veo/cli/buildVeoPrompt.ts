import type {
  Shot,
} from "../../schemas/episodeManifest.schema.js";

const MAX_VEO_PROMPT_CODE_UNITS =
  1000;

export function buildVeoPrompt(
  shot: Shot,
): string {
  const sections = [
    shot.visualAction,
    `Camera: ${shot.camera}`,
  ];

  const ambience =
    shot.audio.ambience
      ?.trim() ??
    "";

  if (ambience) {
    sections.push(
      `Audio: ${ambience}`,
    );
  }

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
      `Shot ${shot.id} produced an empty Veo prompt.`,
    );
  }

  if (
    prompt.length >
    MAX_VEO_PROMPT_CODE_UNITS
  ) {
    throw new Error(
      `Shot ${shot.id} Veo prompt exceeds the Busybookie local ${MAX_VEO_PROMPT_CODE_UNITS} UTF-16 code-unit limit.`,
    );
  }

  return prompt;
}
