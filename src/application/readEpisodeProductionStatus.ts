import {
  resolveDurableEpisodeProductionState,
  type DurableEpisodeProductionState,
} from "../execution/resolveDurableEpisodeProductionState.js";

import type {
  EpisodeManifest,
} from "../schemas/episodeManifest.schema.js";

import {
  loadCharacterBible,
} from "../validation/loadCharacterBible.js";

import {
  loadEnvironment,
} from "../validation/loadEnvironment.js";

import {
  loadEpisodeManifest,
} from "../validation/loadEpisodeManifest.js";

import {
  loadProductionRules,
} from "../validation/loadProductionRules.js";

import {
  loadProviderRoutingPolicy,
} from "../validation/loadProviderRoutingPolicy.js";

import {
  resolveAndValidateMediaRootPath,
} from "../validation/validateMediaRoot.js";

// D1 read-only C4 service. It composes the same loaders and read-only
// preflight as runExecutionStatusCli and returns the durable state unchanged.
// It is transport-agnostic: no request, token, host or principal input.

export type EpisodeProductionStatus =
  Readonly<{
    episode: EpisodeManifest;
    state: DurableEpisodeProductionState;
  }>;

export type ReadEpisodeProductionStatusDependencies =
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

    // Read-only path validation; validateMediaRoot would create directories
    // and write a probe file.
    resolveMediaRoot:
      typeof resolveAndValidateMediaRootPath;

    resolveEpisodeProductionState:
      typeof resolveDurableEpisodeProductionState;
  }>;

const defaultDependencies:
  ReadEpisodeProductionStatusDependencies =
    Object.freeze({
      loadEnvironment,
      loadProductionRules,
      loadCharacterBible,
      loadEpisodeManifest,
      loadProviderRoutingPolicy,

      resolveMediaRoot:
        resolveAndValidateMediaRootPath,

      resolveEpisodeProductionState:
        resolveDurableEpisodeProductionState,
    });

export async function readEpisodeProductionStatus(
  episodeId:
    string,

  dependencies:
    ReadEpisodeProductionStatusDependencies =
      defaultDependencies,
): Promise<EpisodeProductionStatus> {
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
          episodeId,
        ),

      dependencies
        .loadProviderRoutingPolicy(),
    ]);

  if (
    episode.episodeId !==
    episodeId
  ) {
    throw new Error(
      "Loaded episode identity does not match the requested episode.",
    );
  }

  const mediaRoot =
    dependencies
      .resolveMediaRoot(
        env,
        rules,
      );

  const ffprobeExecutable =
    env.BUSYBOOKIE_FFPROBE_PATH
      ?.trim() ||
    "ffprobe";

  const state =
    await dependencies
      .resolveEpisodeProductionState({
        episode,
        bible,
        rules,
        policy,
        mediaRoot,
        ffprobeExecutable,
      });

  return Object.freeze({
    episode,
    state,
  });
}
