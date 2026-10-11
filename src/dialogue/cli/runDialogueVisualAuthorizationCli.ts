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
  loadProviderRoutingPolicy,
} from "../../validation/loadProviderRoutingPolicy.js";

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
  evaluateShotExecutionReadiness,
} from "../../planning/evaluateShotExecutionReadiness.js";

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

    loadProviderRoutingPolicy:
      typeof loadProviderRoutingPolicy;

    validateMediaRoot:
      typeof validateMediaRoot;

    validateEpisodeProduction:
      typeof validateEpisodeProduction;

    evaluateShotExecutionReadiness:
      typeof evaluateShotExecutionReadiness;

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

      loadProviderRoutingPolicy,

      validateMediaRoot,

      validateEpisodeProduction,

      evaluateShotExecutionReadiness,

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
    policy,
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

      dependencies
        .loadProviderRoutingPolicy(),
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

  // Authorization is create-once, so admit only a provider that execution
  // would accept: the manifest provider, executable under the same readiness
  // policy executeSingleShot applies to a durable authorization.
  if (
    options.provider !==
    match.shot.generation.provider
  ) {
    throw new Error(
      `Dialogue visual authorization requested provider ${options.provider} does not match canonical provider ${match.shot.generation.provider} for ${episode.episodeId}/${match.scene.id}/${match.shot.id}. No authorization was written.`,
    );
  }

  const readiness =
    dependencies
      .evaluateShotExecutionReadiness(
        episode,
        match.shot,
        bible,
        rules,
        policy,
        {
          provider:
            options.provider,

          source:
            "DURABLE_DIALOGUE_VISUAL_AUTHORIZATION",
        },
      );

  if (
    readiness.disposition !==
      "EXECUTABLE" ||
    readiness.executionProvider !==
      options.provider
  ) {
    const blockerDetail =
      readiness.blockers.length >
      0
        ? ` Blockers: ${readiness.blockers.join(" | ")}`
        : "";

    throw new Error(
      `Dialogue visual authorization blocked: ${episode.episodeId}/${match.scene.id}/${match.shot.id} with provider ${options.provider} is not executable under current production policy (readiness ${readiness.disposition}).${blockerDetail} No authorization was written.`,
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
