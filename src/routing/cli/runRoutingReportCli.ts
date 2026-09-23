import {
  evaluateEpisodeRouting,
} from "../evaluateEpisodeRouting.js";

import {
  formatEpisodeRoutingReport,
} from "../formatEpisodeRoutingReport.js";

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
  parseRoutingReportCliArgs,
} from "./routingReportCliArgs.js";

export async function runRoutingReportCli(
  args:
    readonly string[] =
      process.argv.slice(2),
): Promise<void> {
  const options =
    parseRoutingReportCliArgs(
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

  const report =
    evaluateEpisodeRouting(
      episode,
      bible,
      rules,
      policy,
    );

  console.log("");
  console.log(
    formatEpisodeRoutingReport(
      report,
    ),
  );
}
