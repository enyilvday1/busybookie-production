import {
  describe,
  expect,
  it,
} from "vitest";

import {
  loadRunwayPolicy,
} from "../src/validation/loadRunwayPolicy.js";

import {
  assertGen45WithinBudget,
  calculateGen45Credits,
} from "../src/runway/runwayBudget.js";

describe(
  "Busybookie Runway policy",
  () => {
    it(
      "loads the authoritative Runway policy",
      async () => {
        const policy =
          await loadRunwayPolicy();

        expect(
          policy.schemaVersion,
        ).toBe("1.0");

        expect(
          policy.gen45.creditsPerSecond,
        ).toBe(12);

        expect(
          policy.gen45.maxCreditsPerGeneration,
        ).toBe(60);

        expect(
          policy.gen45.maxDurationSeconds,
        ).toBe(5);

        expect(
          policy.task.waitTimeoutMs,
        ).toBe(600_000);
      },
    );

    it(
      "calculates a five-second Gen-4.5 generation as 60 local-policy credits",
      async () => {
        const policy =
          await loadRunwayPolicy();

        expect(
          calculateGen45Credits(
            5,
            policy,
          ),
        ).toBe(60);

        expect(
          assertGen45WithinBudget(
            5,
            policy,
          ),
        ).toBe(60);
      },
    );

    it(
      "blocks a generation above the local duration limit",
      async () => {
        const policy =
          await loadRunwayPolicy();

        expect(() =>
          assertGen45WithinBudget(
            6,
            policy,
          ),
        ).toThrow(
          /exceeds the local 5s/,
        );
      },
    );

    it(
      "blocks a generation above the local credit limit",
      async () => {
        const policy =
          await loadRunwayPolicy();

        const restrictedPolicy =
          structuredClone(
            policy,
          );

        restrictedPolicy.gen45.maxCreditsPerGeneration =
          48;

        expect(() =>
          assertGen45WithinBudget(
            5,
            restrictedPolicy,
          ),
        ).toThrow(
          /exceeding the 48-credit limit/,
        );
      },
    );
  },
);
