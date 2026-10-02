import {
  describe,
  expect,
  it,
} from "vitest";

import {
  DialogueVoicePolicySchema,
} from "../src/schemas/dialogueVoicePolicy.schema.js";

import {
  calculateDialogueExpectedCredits,
  assertDialogueWithinBudget,
} from "../src/dialogue/dialogueVoiceBudget.js";

import {
  loadDialogueVoicePolicy,
} from "../src/validation/loadDialogueVoicePolicy.js";

describe(
  "Busybookie dialogue voice policy",
  () => {
    it(
      "loads the authoritative controlled Runway Eleven v3 voice policy",
      async () => {
        const policy =
          await loadDialogueVoicePolicy();

        expect(
          policy,
        ).toEqual({
          schemaVersion:
            "1.0",

          pricingReviewedOn:
            "2026-10-01",

          generation: {
            model:
              "eleven_v3",

            charactersPerCredit:
              50,

            minimumCredits:
              1,

            maxCreditsPerLine:
              10,

            maxPromptCharacters:
              500,

            applyTextNormalization:
              "auto",

            languageCode:
              "en",

            seed:
              0,

            similarityBoost:
              0.75,

            speed:
              1,

            stability:
              0.5,

            style:
              0,

            useSpeakerBoost:
              true,
          },

          task: {
            waitTimeoutMs:
              600_000,
          },
        });
      },
    );

    it(
      "calculates conservative local Eleven v3 credits in 50-character blocks with a one-credit minimum",
      async () => {
        const policy =
          await loadDialogueVoicePolicy();

        expect(
          calculateDialogueExpectedCredits(
            "A",
            policy,
          ),
        ).toBe(1);

        expect(
          calculateDialogueExpectedCredits(
            "A".repeat(
              50,
            ),
            policy,
          ),
        ).toBe(1);

        expect(
          calculateDialogueExpectedCredits(
            "A".repeat(
              51,
            ),
            policy,
          ),
        ).toBe(2);

        expect(
          calculateDialogueExpectedCredits(
            "A".repeat(
              500,
            ),
            policy,
          ),
        ).toBe(10);
      },
    );

    it(
      "blocks a dialogue prompt above the local prompt-character ceiling",
      async () => {
        const policy =
          await loadDialogueVoicePolicy();

        expect(() =>
          assertDialogueWithinBudget(
            "A".repeat(
              501,
            ),
            policy,
          ),
        ).toThrow(
          /500.*character|character.*500/i,
        );
      },
    );

    it(
      "blocks a dialogue line whose locally expected credits exceed the configured line ceiling",
      async () => {
        const policy =
          await loadDialogueVoicePolicy();

        const restrictedPolicy = {
          ...policy,

          generation: {
            ...policy.generation,

            maxCreditsPerLine:
              1,
          },
        };

        expect(() =>
          assertDialogueWithinBudget(
            "A".repeat(
              51,
            ),
            restrictedPolicy,
          ),
        ).toThrow(
          /2.*credit.*1|1.*credit.*2/i,
        );
      },
    );

    it(
      "rejects voice controls outside the installed Eleven v3 contract",
      async () => {
        const policy =
          await loadDialogueVoicePolicy();

        expect(
          DialogueVoicePolicySchema.safeParse({
            ...policy,

            generation: {
              ...policy.generation,

              speed:
                1.21,
            },
          }).success,
        ).toBe(false);

        expect(
          DialogueVoicePolicySchema.safeParse({
            ...policy,

            generation: {
              ...policy.generation,

              similarityBoost:
                1.01,
            },
          }).success,
        ).toBe(false);

        expect(
          DialogueVoicePolicySchema.safeParse({
            ...policy,

            generation: {
              ...policy.generation,

              seed:
                4_294_967_296,
            },
          }).success,
        ).toBe(false);
      },
    );
  },
);
