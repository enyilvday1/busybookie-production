import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  EpisodeManifestSchema,
  type EpisodeManifest,
} from "../schemas/episodeManifest.schema.js";

export function defaultEpisodeManifestPath(
  episodeId: string,
): string {
  return resolve(
    process.cwd(),
    "episodes",
    episodeId,
    "episode.json",
  );
}

export async function loadEpisodeManifest(
  episodeId: string,
  filePath: string = defaultEpisodeManifestPath(episodeId),
): Promise<EpisodeManifest> {
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
      `Episode manifest contains invalid JSON: ${filePath}. ${detail}`,
    );
  }

  const result =
    EpisodeManifestSchema.safeParse(parsedJson);

  if (!result.success) {
    throw new Error(
      `Episode manifest validation failed: ${filePath}\n${result.error.message}`,
    );
  }

  if (result.data.episodeId !== episodeId) {
    throw new Error(
      `Episode manifest id mismatch. Requested ${episodeId}, found ${result.data.episodeId}.`,
    );
  }

  return result.data;
}
