import {
  describe,
  expect,
  it,
} from "vitest";

import {
  DialogueSeedAudioPolicySchema,
} from "../src/schemas/dialogueSeedAudioPolicy.schema.js";

import {
  loadDialogueSeedAudioPolicy,
} from "../src/validation/loadDialogueSeedAudioPolicy.js";

describe(
  "BusyBookie dialogue SeedAudio policy",
  () => {
    it(
      "loads the authoritative direct SeedAudio policy with current documented pricing provenance",
      async () => {
        const policy =
          await loadDialogueSeedAudioPolicy();

        expect(
          policy,
        ).toEqual({
          schemaVersion:
            "1.0",

          pricingReviewedOn:
            "2026-10-06",

          generation: {
            model:
              "seed_audio",

            creditsPerSecond:
              0.25,

            minimumCredits:
              5,

            maxGenerationSeconds:
              120,

            maxCreditsPerGeneration:
              30,
          },

          task: {
            waitTimeoutMs:
              600_000,
          },
        });
      },
    );

    it(
      "rejects any model other than seed_audio",
      async () => {
        const policy =
          await loadDialogueSeedAudioPolicy();

        expect(
          DialogueSeedAudioPolicySchema
            .safeParse({
              ...policy,

              generation: {
                ...policy.generation,

                model:
                  "eleven_v3",
              },
            })
            .success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects a generation-duration ceiling above the documented 120-second SeedAudio limit",
      async () => {
        const policy =
          await loadDialogueSeedAudioPolicy();

        expect(
          DialogueSeedAudioPolicySchema
            .safeParse({
              ...policy,

              generation: {
                ...policy.generation,

                maxGenerationSeconds:
                  121,
              },
            })
            .success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects a configured local credit ceiling above the documented maximum charge implied by the policy pricing",
      async () => {
        const policy =
          await loadDialogueSeedAudioPolicy();

        expect(
          DialogueSeedAudioPolicySchema
            .safeParse({
              ...policy,

              generation: {
                ...policy.generation,

                maxCreditsPerGeneration:
                  30.25,
              },
            })
            .success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects a local credit ceiling below the provider minimum charge",
      async () => {
        const policy =
          await loadDialogueSeedAudioPolicy();

        expect(
          DialogueSeedAudioPolicySchema
            .safeParse({
              ...policy,

              generation: {
                ...policy.generation,

                maxCreditsPerGeneration:
                  4.75,
              },
            })
            .success,
        ).toBe(
          false,
        );
      },
    );
  },
);
