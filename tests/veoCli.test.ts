import {
  describe,
  expect,
  it,
} from "vitest";

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
  validateEpisodeProduction,
} from "../src/validation/validateEpisodeProduction.js";

import {
  assertVeoShotReady,
  findVeoEpisodeShot,
} from "../src/veo/cli/assertVeoShotReady.js";

import {
  buildVeoPrompt,
} from "../src/veo/cli/buildVeoPrompt.js";

import {
  parseVeoCliArgs,
} from "../src/veo/cli/veoCliArgs.js";

describe(
  "Busybookie Veo CLI",
  () => {
    it(
      "defaults to dry-run mode",
      () => {
        const options =
          parseVeoCliArgs([
            "--episode",
            "EP91",
            "--shot",
            "S01",
            "--image",
            "D:/reference.png",
          ]);

        expect(
          options.confirmPaidGeneration,
        ).toBe(false);
      },
    );

    it(
      "requires an explicit paid-generation confirmation flag",
      () => {
        const options =
          parseVeoCliArgs([
            "--episode",
            "EP91",
            "--shot",
            "S01",
            "--image",
            "D:/reference.png",
            "--confirm-paid-generation",
          ]);

        expect(
          options.confirmPaidGeneration,
        ).toBe(true);
      },
    );

    it(
      "rejects unknown CLI arguments",
      () => {
        expect(() =>
          parseVeoCliArgs([
            "--episode",
            "EP91",
            "--shot",
            "S01",
            "--image",
            "D:/reference.png",
            "--unsafe-bypass",
          ]),
        ).toThrow(
          /Unknown Veo CLI argument/,
        );
      },
    );

    it(
      "passes complete production validation for EP91",
      async () => {
        const [
          episode,
          bible,
          rules,
        ] =
          await Promise.all([
            loadEpisodeManifest(
              "EP91",
            ),
            loadCharacterBible(),
            loadProductionRules(),
          ]);

        expect(() =>
          validateEpisodeProduction(
            episode,
            bible,
            rules,
          ),
        ).not.toThrow();
      },
    );

    it(
      "accepts the approved EP91 Veo shot",
      async () => {
        const episode =
          await loadEpisodeManifest(
            "EP91",
          );

        const shot =
          findVeoEpisodeShot(
            episode,
            "S01",
          );

        expect(() =>
          assertVeoShotReady(
            episode,
            shot,
          ),
        ).not.toThrow();
      },
    );

    it(
      "rejects a non-Veo provider",
      async () => {
        const episode =
          await loadEpisodeManifest(
            "EP91",
          );

        const shot =
          findVeoEpisodeShot(
            episode,
            "S01",
          );

        const blockedShot = {
          ...shot,

          generation: {
            ...shot.generation,
            provider:
              "RUNWAY" as const,
          },
        };

        expect(() =>
          assertVeoShotReady(
            episode,
            blockedShot,
          ),
        ).toThrow(
          /provider is RUNWAY/,
        );
      },
    );

    it(
      "blocks dialogue in the connectivity CLI",
      async () => {
        const episode =
          await loadEpisodeManifest(
            "EP91",
          );

        const shot =
          findVeoEpisodeShot(
            episode,
            "S01",
          );

        const blockedShot = {
          ...shot,

          dialogue: [
            {
              characterId:
                "OLLIE" as const,

              text:
                "Hello!",
            },
          ],
        };

        expect(() =>
          assertVeoShotReady(
            episode,
            blockedShot,
          ),
        ).toThrow(
          /contains dialogue/,
        );
      },
    );

    it(
      "builds a controlled visual, camera, audio and continuity prompt",
      async () => {
        const episode =
          await loadEpisodeManifest(
            "EP91",
          );

        const shot =
          findVeoEpisodeShot(
            episode,
            "S01",
          );

        const prompt =
          buildVeoPrompt(
            shot,
          );

        expect(
          prompt,
        ).toContain(
          shot.visualAction,
        );

        expect(
          prompt,
        ).toContain(
          "Camera:",
        );

        expect(
          prompt,
        ).toContain(
          "Audio:",
        );

        expect(
          prompt,
        ).toContain(
          "Continuity:",
        );

        expect(
          prompt.length,
        ).toBeLessThanOrEqual(
          1000,
        );
      },
    );

    it(
      "rejects prompts above the Busybookie local ceiling",
      async () => {
        const episode =
          await loadEpisodeManifest(
            "EP91",
          );

        const shot =
          findVeoEpisodeShot(
            episode,
            "S01",
          );

        const oversizedShot = {
          ...shot,

          visualAction:
            "x".repeat(
              1100,
            ),
        };

        expect(() =>
          buildVeoPrompt(
            oversizedShot,
          ),
        ).toThrow(
          /local 1000 UTF-16/,
        );
      },
    );
  },
);
