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
  resolveAndValidateMediaRootPath,
} from "../../validation/validateMediaRoot.js";

import {
  resolveDurableEpisodeProductionState,
} from "../resolveDurableEpisodeProductionState.js";

import {
  parseExecutionStatusCliArgs,
} from "./executionStatusCliArgs.js";

export type RunExecutionStatusCliDependencies =
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

    writeStdout:
      (text: string) => void;
  }>;

const defaultDependencies:
  RunExecutionStatusCliDependencies =
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

      writeStdout:
        (text: string) => {
          process.stdout.write(
            text,
          );
        },
    });

export async function runExecutionStatusCli(
  args:
    readonly string[] =
      process.argv.slice(
        2,
      ),

  dependencies:
    RunExecutionStatusCliDependencies =
      defaultDependencies,
): Promise<void> {
  const options =
    parseExecutionStatusCliArgs(
      args,
    );

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
    dependencies
      .resolveMediaRoot(
        env,
        rules,
      );

  const ffprobeExecutable =
    env.BUSYBOOKIE_FFPROBE_PATH
      ?.trim() ||
    "ffprobe";

  const report =
    await dependencies
      .resolveEpisodeProductionState({
        episode,
        bible,
        rules,
        policy,
        mediaRoot,
        ffprobeExecutable,
      });

  // Written once, only after the complete evaluation succeeded.
  dependencies
    .writeStdout(
      `${JSON.stringify(
        report,
        null,
        2,
      )}\n`,
    );
}
