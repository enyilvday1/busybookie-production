import type {
  Shot,
} from "../../schemas/episodeManifest.schema.js";

export function buildRunwayGen45Prompt(
  shot: Shot,
): string {
  const sections = [
    shot.visualAction,
    `Camera: ${shot.camera}`,
  ];

  if (
    shot.continuityNotes.length > 0
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
      `Shot ${shot.id} produced an empty Runway prompt.`,
    );
  }

  if (
    prompt.length >
    1000
  ) {
    throw new Error(
      `Shot ${shot.id} Runway prompt exceeds 1000 UTF-16 code units.`,
    );
  }

  return prompt;
}
