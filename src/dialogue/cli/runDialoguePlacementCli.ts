import {
  loadCharacterBible,
} from "../../validation/loadCharacterBible.js";
import {
  loadEnvironment,
} from "../../validation/loadEnvironment.js";
import {
  loadEpisodeManifest,
} from "../../validation/loadEpisodeManifest.js";
import {
  loadProductionRules,
} from "../../validation/loadProductionRules.js";
import {
  validateEpisodeProduction,
} from "../../validation/validateEpisodeProduction.js";
import {
  validateMediaRoot,
} from "../../validation/validateMediaRoot.js";
import {
  buildShotDialoguePlan,
} from "../buildShotDialoguePlan.js";
import {
  verifyShotDialogueAudioTiming,
} from "../verifyShotDialogueAudioTiming.js";
import {
  createDialoguePlacementDecision,
} from "../createDialoguePlacementDecision.js";
import {
  parseDialoguePlacementCliArgs,
} from "./dialoguePlacementCliArgs.js";

export type RunDialoguePlacementCliDependencies = Readonly<{
  loadEnvironment: typeof loadEnvironment;
  loadProductionRules: typeof loadProductionRules;
  loadCharacterBible: typeof loadCharacterBible;
  loadEpisodeManifest: typeof loadEpisodeManifest;
  validateMediaRoot: typeof validateMediaRoot;
  validateEpisodeProduction: typeof validateEpisodeProduction;
  buildShotDialoguePlan: typeof buildShotDialoguePlan;
  verifyShotDialogueAudioTiming: typeof verifyShotDialogueAudioTiming;
  createDecision: typeof createDialoguePlacementDecision;
}>;

const defaultDependencies: RunDialoguePlacementCliDependencies = Object.freeze({
  loadEnvironment,
  loadProductionRules,
  loadCharacterBible,
  loadEpisodeManifest,
  validateMediaRoot,
  validateEpisodeProduction,
  buildShotDialoguePlan,
  verifyShotDialogueAudioTiming,
  createDecision: createDialoguePlacementDecision,
});

export async function runDialoguePlacementCli(
  args: readonly string[] = process.argv.slice(2),
  dependencies: RunDialoguePlacementCliDependencies = defaultDependencies,
): Promise<void> {
  const options = parseDialoguePlacementCliArgs(args);
  if (!options.confirmPlacement) {
    throw new Error(
      "Dialogue placement requires --confirm-placement. No decision was written.",
    );
  }

  const env = dependencies.loadEnvironment();
  const [rules, bible, episode] = await Promise.all([
    dependencies.loadProductionRules(),
    dependencies.loadCharacterBible(),
    dependencies.loadEpisodeManifest(options.episodeId),
  ]);

  if (episode.episodeId !== options.episodeId) {
    throw new Error("Loaded episode identity does not match --episode.");
  }

  const mediaRoot = await dependencies.validateMediaRoot(env, rules);
  dependencies.validateEpisodeProduction(episode, bible, rules);

  const scene = episode.scenes.find(
    (candidate) => candidate.id === options.sceneId,
  );
  if (!scene) {
    throw new Error(
      `Dialogue placement could not find scene ${options.sceneId} in episode ${episode.episodeId}.`,
    );
  }

  const shot = scene.shots.find(
    (candidate) => candidate.id === options.shotId,
  );
  if (!shot) {
    throw new Error(
      `Dialogue placement could not find shot ${options.shotId} in scene ${scene.id}.`,
    );
  }

  const plan = dependencies.buildShotDialoguePlan({
    episodeId: episode.episodeId,
    sceneId: scene.id,
    shot,
    bible,
  });
  if (plan.lines.length === 0) {
    throw new Error("Dialogue placement requires at least one canonical dialogue line.");
  }

  const ffprobeExecutable = env.BUSYBOOKIE_FFPROBE_PATH?.trim() || "ffprobe";
  const timing = await dependencies.verifyShotDialogueAudioTiming({
    mediaRoot,
    ffprobeExecutable,
    plan,
  });

  // Keep revision authority in the durable creator's default dependencies.
  const result = await dependencies.createDecision(mediaRoot, {
    dialoguePlan: plan,
    timing,
    placements: options.placements,
  });

  console.log("");
  console.log("===== BusyBookie Dialogue Placement Decision =====");
  console.log(`Episode: ${episode.episodeId}`);
  console.log(`Scene: ${scene.id}`);
  console.log(`Shot: ${shot.id}`);
  console.log(`Dialogue plan key: ${plan.planKey}`);
  console.log(`Revision: ${result.record.revision}`);
  console.log(`Placement count: ${result.record.placements.length}`);
  console.log(`Decision path: ${result.decisionPath}`);
}
