import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  parseExecutionPlanCliArgs,
} from "../src/planning/cli/executionPlanCliArgs.js";

import {
  runExecutionPlanCli,
} from "../src/planning/cli/runExecutionPlanCli.js";

import {
  evaluateEpisodeExecutionPlan,
} from "../src/planning/evaluateEpisodeExecutionPlan.js";

import {
  formatEpisodeExecutionPlan,
} from "../src/planning/formatEpisodeExecutionPlan.js";

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

async function loadEp02Plan() {
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

  return evaluateEpisodeExecutionPlan(
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
  "Busybookie Execution Plan CLI",
  () => {
    it(
      "parses a named episode argument",
      () => {
        expect(
          parseExecutionPlanCliArgs([
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
          parseExecutionPlanCliArgs([]),
        ).toThrow(
          "--episode is required.",
        );
      },
    );

    it(
      "rejects an episode flag without a value",
      () => {
        expect(() =>
          parseExecutionPlanCliArgs([
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
          parseExecutionPlanCliArgs([
            "--unsafe-bypass",
          ]),
        ).toThrow(
          /Unknown execution plan CLI argument/,
        );
      },
    );

    it(
      "rejects positional episode arguments",
      () => {
        expect(() =>
          parseExecutionPlanCliArgs([
            "EP02",
          ]),
        ).toThrow(
          /Unknown execution plan CLI argument/,
        );
      },
    );

    it(
      "rejects paid-generation confirmation flags",
      () => {
        expect(() =>
          parseExecutionPlanCliArgs([
            "--episode",
            "EP02",
            "--confirm-paid-generation",
          ]),
        ).toThrow(
          /Unknown execution plan CLI argument/,
        );
      },
    );

    it(
      "formats plans with real newline characters",
      async () => {
        const formatted =
          formatEpisodeExecutionPlan(
            await loadEp02Plan(),
          );

        expect(formatted).toContain(
          "\n\nEpisode: EP02 - Development Pipeline Test\n",
        );

        expect(formatted).not.toContain(
          "\\\\n",
        );
      },
    );

    it(
      "formats the EP02 execution summary",
      async () => {
        const formatted =
          formatEpisodeExecutionPlan(
            await loadEp02Plan(),
          );

        expect(formatted).toContain(
          "EXECUTABLE: 0",
        );
        expect(formatted).toContain(
          "NOT_READY: 1",
        );
        expect(formatted).toContain(
          "MANUAL_REVIEW: 1",
        );
        expect(formatted).toContain(
          "CONFLICT: 0",
        );
        expect(formatted).toContain(
          "BLOCKED: 0",
        );
      },
    );

    it(
      "preserves global shot order in formatted output",
      async () => {
        const formatted =
          formatEpisodeExecutionPlan(
            await loadEp02Plan(),
          );

        expect(
          formatted.indexOf("S01"),
        ).toBeLessThan(
          formatted.indexOf("S02"),
        );
      },
    );

    it(
      "renders execution providers and blockers",
      async () => {
        const formatted =
          formatEpisodeExecutionPlan(
            await loadEp02Plan(),
          );

        expect(formatted).toContain(
          "S01  NOT_READY",
        );
        expect(formatted).toContain(
          "provider=RUNWAY",
        );
        expect(formatted).toMatch(
          /blocker: .*status is DRAFT/i,
        );

        expect(formatted).toContain(
          "S02  MANUAL_REVIEW",
        );
        expect(formatted).toContain(
          "provider=unresolved",
        );
      },
    );

    it(
      "runs the EP02 plan without paid-generation confirmation",
      async () => {
        const consoleLog =
          vi.spyOn(
            console,
            "log",
          ).mockImplementation(
            () => undefined,
          );

        await expect(
          runExecutionPlanCli([
            "--episode",
            "EP02",
          ]),
        ).resolves.toBeUndefined();

        const output =
          consoleLog.mock.calls
            .flat()
            .join("\n");

        expect(output).toContain(
          "===== Busybookie Episode Execution Plan =====",
        );

        expect(output).toContain(
          "Episode: EP02 - Development Pipeline Test",
        );

        expect(output).toContain(
          "NOT_READY: 1",
        );
      },
    );
  },
);
