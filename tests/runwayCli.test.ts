import {
  describe,
  expect,
  it,
} from "vitest";

import {
  assertRunwayGen45ShotReady,
  findEpisodeShot,
} from "../src/runway/cli/assertRunwayGen45ShotReady.js";

import {
  buildRunwayGen45Prompt,
} from "../src/runway/cli/buildRunwayGen45Prompt.js";

import {
  parseRunwayGen45CliArgs,
} from "../src/runway/cli/runwayGen45CliArgs.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

describe(
  "Busybookie Runway CLI",
  () => {
    it(
      "defaults to dry-run mode",
      () => {
        const options =
          parseRunwayGen45CliArgs([
            "--episode",
            "EP90",

            "--shot",
            "S01",

            "--image",
            "D:/Busybookie/Production/references/littleleaf-valley/reference.png",
          ]);

        expect(
          options.confirmPaidGeneration,
        ).toBe(false);
      },
    );

    it(
      "requires explicit paid-generation confirmation",
      () => {
        const options =
          parseRunwayGen45CliArgs([
            "--episode",
            "EP90",

            "--shot",
            "S01",

            "--image",
            "D:/Busybookie/Production/references/littleleaf-valley/reference.png",

            "--confirm-paid-generation",
          ]);

        expect(
          options.confirmPaidGeneration,
        ).toBe(true);
      },
    );

    it(
      "recognizes the approved EP90 Runway shot",
      async () => {
        const episode =
          await loadEpisodeManifest(
            "EP90",
          );

        const shot =
          findEpisodeShot(
            episode,
            "S01",
          );

        expect(() =>
          assertRunwayGen45ShotReady(
            episode,
            shot,
          ),
        ).not.toThrow();

        expect(
          shot.generation.status,
        ).toBe(
          "APPROVED_FOR_GENERATION",
        );
      },
    );

    it(
      "builds a valid connectivity-test prompt",
      async () => {
        const episode =
          await loadEpisodeManifest(
            "EP90",
          );

        const shot =
          findEpisodeShot(
            episode,
            "S01",
          );

        const prompt =
          buildRunwayGen45Prompt(
            shot,
          );

        expect(
          prompt.length,
        ).toBeGreaterThan(
          0,
        );

        expect(
          prompt.length,
        ).toBeLessThanOrEqual(
          1000,
        );

        expect(
          prompt,
        ).toContain(
          "Littleleaf Valley",
        );
      },
    );
  },
);
