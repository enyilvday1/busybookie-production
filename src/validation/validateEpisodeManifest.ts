import { loadCharacterBible } from "./loadCharacterBible.js";
import { loadEpisodeManifest } from "./loadEpisodeManifest.js";
import { loadProductionRules } from "./loadProductionRules.js";
import { validateEpisodeProduction } from "./validateEpisodeProduction.js";

async function main(): Promise<void> {
  const episodeId =
    process.argv[2]?.trim();

  if (!episodeId) {
    throw new Error(
      "Episode id required. Example: npm run validate:episode -- EP02",
    );
  }

  const [
    episode,
    bible,
    rules,
  ] = await Promise.all([
    loadEpisodeManifest(episodeId),
    loadCharacterBible(),
    loadProductionRules(),
  ]);

  validateEpisodeProduction(
    episode,
    bible,
    rules,
  );

  const shotCount =
    episode.scenes.reduce(
      (total, scene) =>
        total + scene.shots.length,
      0,
    );

  console.log(
    `Episode manifest valid: ${episode.episodeId}`,
  );

  console.log(
    `Title: ${episode.title}`,
  );

  console.log(
    `Status: ${episode.status}`,
  );

  console.log(
    `Scenes: ${episode.scenes.length}`,
  );

  console.log(
    `Shots: ${shotCount}`,
  );

  console.log(
    `Target duration: ${episode.targetDurationSeconds}s`,
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown episode validation error";

  console.error(message);
  process.exitCode = 1;
});
