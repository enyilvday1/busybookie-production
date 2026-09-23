import {
  loadCharacterBible,
} from "../../validation/loadCharacterBible.js";

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
  evaluateEpisodeExecutionPlan,
} from "../evaluateEpisodeExecutionPlan.js";

import {
  formatEpisodeExecutionPlan,
} from "../formatEpisodeExecutionPlan.js";

import {
  parseExecutionPlanCliArgs,
} from "./executionPlanCliArgs.js";

export async function runExecutionPlanCli(
  args:
    readonly string[] =
      process.argv.slice(2),
): Promise<void> {
  const options =
    parseExecutionPlanCliArgs(
      args,
    );

  const [
    episode,
    bible,
    rules,
    policy,
  ] = await Promise.all([
    loadEpisodeManifest(
      options.episodeId,
    ),
    loadCharacterBible(),
    loadProductionRules(),
    loadProviderRoutingPolicy(),
  ]);

  const plan =
    evaluateEpisodeExecutionPlan(
      episode,
      bible,
      rules,
      policy,
    );

  console.log("");
  console.log(
    formatEpisodeExecutionPlan(
      plan,
    ),
  );
}
