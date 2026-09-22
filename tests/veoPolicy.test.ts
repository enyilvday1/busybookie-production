import {
  describe,
  expect,
  it,
} from "vitest";

import {
  assertVeoWithinBudget,
  calculateVeoExpectedCents,
} from "../src/veo/veoBudget.js";

import {
  loadVeoPolicy,
} from "../src/validation/loadVeoPolicy.js";

describe(
  "Busybookie Veo policy",
  () => {
    it(
      "loads the controlled Veo 3.1 Fast policy",
      async () => {
        const policy =
          await loadVeoPolicy();

        expect(
          policy.generation.model,
        ).toBe(
          "veo-3.1-fast-generate-preview",
        );

        expect(
          policy.generation
            .expectedOutputFps,
        ).toBe(24);
      },
    );

    it(
      "calculates expected Fast cost in integer cents",
      async () => {
        const policy =
          await loadVeoPolicy();

        expect(
          calculateVeoExpectedCents(
            4,
            policy,
          ),
        ).toBe(40);

        expect(
          calculateVeoExpectedCents(
            8,
            policy,
          ),
        ).toBe(80);
      },
    );

    it(
      "blocks unsupported durations",
      async () => {
        const policy =
          await loadVeoPolicy();

        expect(() =>
          assertVeoWithinBudget(
            5,
            policy,
          ),
        ).toThrow(
          /not allowed/,
        );
      },
    );

    it(
      "enforces the local monetary ceiling",
      async () => {
        const policy =
          await loadVeoPolicy();

        const lowerCeiling = {
          ...policy,

          generation: {
            ...policy.generation,

            maxCentsPerGeneration:
              30,
          },
        };

        expect(() =>
          assertVeoWithinBudget(
            4,
            lowerCeiling,
          ),
        ).toThrow(
          /exceeds/,
        );
      },
    );
  },
);
