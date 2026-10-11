import type {
  CharacterBible,
} from "../schemas/character.schema.js";

import type {
  EpisodeManifest,
  Shot,
} from "../schemas/episodeManifest.schema.js";

import type {
  ProviderRoutingPolicy,
} from "../schemas/providerRoutingPolicy.schema.js";

import type {
  ProductionRules,
} from "../schemas/productionRules.schema.js";

import type {
  ShotExecutionReadiness,
} from "../planning/executionReadiness.types.js";

import {
  evaluateShotExecutionReadiness,
} from "../planning/evaluateShotExecutionReadiness.js";

import {
  DialogueVisualAuthorizationSchema,
} from "./dialogueVisualAuthorization.schema.js";

import type {
  DialogueVisualAuthorizationReader,
} from "./singleShotExecution.types.js";

export type ResolveDurableShotExecutionReadinessInput =
  Readonly<{
    episode: EpisodeManifest;
    shot: Shot;
    bible: CharacterBible;
    rules: ProductionRules;
    policy: ProviderRoutingPolicy;
    mediaRoot: string;
  }>;

// No default reader: a missing reader must fail closed rather than fall back
// to the filesystem.
export type ResolveDurableShotExecutionReadinessDependencies =
  Readonly<{
    readDialogueVisualAuthorization?:
      DialogueVisualAuthorizationReader | undefined;
  }>;

export async function resolveDurableShotExecutionReadiness(
  input:
    ResolveDurableShotExecutionReadinessInput,

  dependencies:
    ResolveDurableShotExecutionReadinessDependencies,
): Promise<ShotExecutionReadiness> {
  let readiness =
    evaluateShotExecutionReadiness(
      input.episode,
      input.shot,
      input.bible,
      input.rules,
      input.policy,
    );

  if (
    readiness.disposition ===
      "MANUAL_REVIEW" &&
    readiness.routing.disposition ===
      "MANUAL_REVIEW"
  ) {
    const authorizationReader =
      dependencies
        .readDialogueVisualAuthorization;

    if (!authorizationReader) {
      throw new Error(
        "readDialogueVisualAuthorization dependency is required to resolve dialogue visual MANUAL_REVIEW.",
      );
    }

    const rawAuthorization =
      await authorizationReader(
        input.mediaRoot,
        input.episode
          .episodeId,
        input.shot.id,
      );

    if (rawAuthorization) {
      // Re-parse injected evidence before trusting its identity.
      const authorization =
        DialogueVisualAuthorizationSchema
          .parse(
            rawAuthorization,
          );

      if (
        authorization.episodeId !==
        input.episode.episodeId
      ) {
        throw new Error(
          `Dialogue visual authorization episode ${authorization.episodeId} does not match execution episode ${input.episode.episodeId}.`,
        );
      }

      if (
        authorization.shotId !==
        input.shot.id
      ) {
        throw new Error(
          `Dialogue visual authorization shot ${authorization.shotId} does not match execution shot ${input.shot.id}.`,
        );
      }

      if (
        authorization.provider !==
        input.shot.generation.provider
      ) {
        throw new Error(
          `Dialogue visual authorization provider ${authorization.provider} does not match manifest generation provider ${input.shot.generation.provider} for ${input.episode.episodeId}/${input.shot.id}.`,
        );
      }

      readiness =
        evaluateShotExecutionReadiness(
          input.episode,
          input.shot,
          input.bible,
          input.rules,
          input.policy,
          {
            provider:
              authorization.provider,

            source:
              "DURABLE_DIALOGUE_VISUAL_AUTHORIZATION",
          },
        );
    }
  }

  return readiness;
}
