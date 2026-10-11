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
  createDialogueVisualAuthorization,
} from "../../execution/createDialogueVisualAuthorization.js";

import {
  parseDialogueVisualAuthorizationCliArgs,
} from "./dialogueVisualAuthorizationCliArgs.js";

export type RunDialogueVisualAuthorizationCliDependencies =
  Readonly<{
    loadEnvironment:
      typeof loadEnvironment;

    loadProductionRules:
      typeof loadProductionRules;

    loadCharacterBible:
      typeof loadCharacterBible;

    loadEpisodeManifest:
      typeof loadEpisodeManifest;

    validateMediaRoot:
      typeof validateMediaRoot;

    validateEpisodeProduction:
      typeof validateEpisodeProduction;

    createAuthorization:
      typeof createDialogueVisualAuthorization;
  }>;

const defaultDependencies:
  RunDialogueVisualAuthorizationCliDependencies =
    Object.freeze({
      loadEnvironment,

      loadProductionRules,

      loadCharacterBible,

      loadEpisodeManifest,

      validateMediaRoot,

      validateEpisodeProduction,

      createAuthorization:
        createDialogueVisualAuthorization,
    });

export async function runDialogueVisualAuthorizationCli(
  args:
    readonly string[] =
      process.argv.slice(
        2,
      ),

  dependencies:
    RunDialogueVisualAuthorizationCliDependencies =
      defaultDependencies,
): Promise<void> {
  const options =
    parseDialogueVisualAuthorizationCliArgs(
      args,
    );

  if (
    !options
      .confirmAuthorization
  ) {
    throw new Error(
      "Dialogue visual authorization requires --confirm-authorization. No authorization was written.",
    );
  }

  const env =
    dependencies
      .loadEnvironment();

  const [
    rules,
    bible,
    episode,
  ] =
    await Promise.all([
      dependencies
        .loadProductionRules(),

      dependencies
        .loadCharacterBible(),

      dependencies
        .loadEpisodeManifest(
          options.episodeId,
        ),
    ]);

  if (
    episode.episodeId !==
    options.episodeId
  ) {
    throw new Error(
      "Loaded episode identity does not match --episode.",
    );
  }

  const mediaRoot =
    await dependencies
      .validateMediaRoot(
        env,
        rules,
      );

  dependencies
    .validateEpisodeProduction(
      episode,
      bible,
      rules,
    );

  const matchingShots =
    episode.scenes
      .flatMap(
        (
          scene,
        ) =>
          scene.shots
            .filter(
              (
                candidate,
              ) =>
                candidate.id ===
                options.shotId,
            )
            .map(
              (
                shot,
              ) =>
                Object.freeze({
                  scene,
                  shot,
                }),
            ),
      );

  if (
    matchingShots.length ===
    0
  ) {
    throw new Error(
      `Dialogue visual authorization could not find shot ${options.shotId} in episode ${episode.episodeId}.`,
    );
  }

  if (
    matchingShots.length >
    1
  ) {
    throw new Error(
      `Dialogue visual authorization found multiple shots named ${options.shotId} in episode ${episode.episodeId}; authorization requires an unambiguous shot identity.`,
    );
  }

  const match =
    matchingShots[0]!;

  if (
    match.shot.dialogue.length ===
    0
  ) {
    throw new Error(
      `Dialogue visual authorization requires a dialogue shot; ${episode.episodeId}/${match.scene.id}/${match.shot.id} contains no dialogue.`,
    );
  }

  const result =
    await dependencies
      .createAuthorization(
        mediaRoot,
        {
          episodeId:
            episode.episodeId,

          shotId:
            match.shot.id,

          purpose:
            "DIALOGUE_VISUAL_GENERATION",

          provider:
            options.provider,

          nativeAudioDisposition:
            "DISCARD_AFTER_VISUAL_GENERATION",

          dialogueAuthority:
            "EXTERNAL_VERIFIED_DIALOGUE",

          authorizationSource:
            "HUMAN_OPERATOR",
        },
      );

  console.log("");

  console.log(
    "===== BusyBookie Dialogue Visual Authorization =====",
  );

  console.log(
    `Episode: ${episode.episodeId}`,
  );

  console.log(
    `Scene: ${match.scene.id}`,
  );

  console.log(
    `Shot: ${match.shot.id}`,
  );

  console.log(
    `Provider: ${options.provider}`,
  );

  console.log(
    `Authorization ID: ${result.record.authorizationId}`,
  );

  console.log(
    `Authorization path: ${result.authorizationPath}`,
  );
}
