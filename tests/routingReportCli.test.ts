import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  runRoutingReportCli,
} from "../src/routing/cli/runRoutingReportCli.js";

import {
  parseRoutingReportCliArgs,
} from "../src/routing/cli/routingReportCliArgs.js";

import {
  evaluateEpisodeRouting,
} from "../src/routing/evaluateEpisodeRouting.js";

import {
  formatEpisodeRoutingReport,
} from "../src/routing/formatEpisodeRoutingReport.js";

import {
  loadCharacterBible,
} from "../src/validation/loadCharacterBible.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

import {
  loadProductionRules,
} from "../src/validation/loadProductionRules.js";

import {
  loadProviderRoutingPolicy,
} from "../src/validation/loadProviderRoutingPolicy.js";

async function loadEp02Report() {
  const [
    episode,
    bible,
    rules,
    policy,
  ] = await Promise.all([
    loadEpisodeManifest("EP02"),
    loadCharacterBible(),
    loadProductionRules(),
    loadProviderRoutingPolicy(),
  ]);

  return evaluateEpisodeRouting(
    episode,
    bible,
    rules,
    policy,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe(
  "Busybookie Routing Report CLI",
  () => {
    it(
      "parses a named episode argument",
      () => {
        expect(
          parseRoutingReportCliArgs([
            "--episode",
            "EP02",
          ]),
        ).toEqual({
          episodeId: "EP02",
        });
      },
    );

    it(
      "rejects a missing episode argument",
      () => {
        expect(() =>
          parseRoutingReportCliArgs([]),
        ).toThrow(
          "--episode is required.",
        );
      },
    );

    it(
      "rejects an episode flag without a value",
      () => {
        expect(() =>
          parseRoutingReportCliArgs([
            "--episode",
          ]),
        ).toThrow(
          "--episode requires a value.",
        );
      },
    );

    it(
      "rejects unknown CLI arguments",
      () => {
        expect(() =>
          parseRoutingReportCliArgs([
            "--unsafe-bypass",
          ]),
        ).toThrow(
          /Unknown routing report CLI argument/,
        );
      },
    );

    it(
      "rejects positional episode arguments",
      () => {
        expect(() =>
          parseRoutingReportCliArgs([
            "EP02",
          ]),
        ).toThrow(
          /Unknown routing report CLI argument/,
        );
      },
    );

    it(
      "formats reports with real newline characters",
      async () => {
        const report =
          await loadEp02Report();

        const formatted =
          formatEpisodeRoutingReport(
            report,
          );

        expect(formatted).toContain(
          "\n\nEpisode: EP02 - Development Pipeline Test\n",
        );

        expect(formatted).not.toContain(
          "\\n",
        );
      },
    );

    it(
      "formats the EP02 routing summary",
      async () => {
        const formatted =
          formatEpisodeRoutingReport(
            await loadEp02Report(),
          );

        expect(formatted).toContain(
          "ROUTABLE: 1",
        );

        expect(formatted).toContain(
          "BLOCKED: 0",
        );

        expect(formatted).toContain(
          "MANUAL_REVIEW: 1",
        );

        expect(formatted).toContain(
          "CONFLICT: 0",
        );
      },
    );

    it(
      "preserves global shot order in formatted output",
      async () => {
        const formatted =
          formatEpisodeRoutingReport(
            await loadEp02Report(),
          );

        expect(
          formatted.indexOf("S01"),
        ).toBeLessThan(
          formatted.indexOf("S02"),
        );
      },
    );

    it(
      "renders unresolved recommendation for manual review",
      async () => {
        const formatted =
          formatEpisodeRoutingReport(
            await loadEp02Report(),
          );

        expect(formatted).toContain(
          "S02  MANUAL_REVIEW  current=VEO  recommended=unresolved",
        );
      },
    );

    it(
      "runs the EP02 report without paid-generation confirmation",
      async () => {
        const consoleLog =
          vi.spyOn(
            console,
            "log",
          ).mockImplementation(
            () => undefined,
          );

        await expect(
          runRoutingReportCli([
            "--episode",
            "EP02",
          ]),
        ).resolves.toBeUndefined();

        const output =
          consoleLog.mock.calls
            .flat()
            .join("\\n");

        expect(output).toContain(
          "===== Busybookie Episode Routing Report =====",
        );

        expect(output).toContain(
          "Episode: EP02 - Development Pipeline Test",
        );
      },
    );
  },
);
