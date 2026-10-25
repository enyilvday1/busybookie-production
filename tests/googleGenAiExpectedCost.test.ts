import {
  readFile,
} from "node:fs/promises";

import {
  join,
} from "node:path";

import {
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  computeGoogleGenAiExpectedCost,
  GoogleGenAiExpectedCostRejectedError,
  type GoogleGenAiExpectedCostPolicy,
  type GoogleGenAiExpectedCostRejectionCode,
} from "../src/googleGenai/googleGenAiExpectedCost.js";

import type {
  GoogleGenAiPolicy,
} from "../src/schemas/googleGenAiPolicy.schema.js";

import {
  loadGoogleGenAiActivationPolicy,
} from "../src/validation/loadGoogleGenAiActivationPolicy.js";

import {
  loadGoogleGenAiPolicy,
} from "../src/validation/loadGoogleGenAiPolicy.js";

let pricing:
  GoogleGenAiPolicy["pricing"];

let cost:
  GoogleGenAiExpectedCostPolicy;

beforeAll(
  async () => {
    pricing =
      (
        await loadGoogleGenAiPolicy()
      ).pricing;

    cost =
      (
        await loadGoogleGenAiActivationPolicy()
      ).cost;
  },
);

function expectRejection(
  run:
    () => unknown,
  code:
    GoogleGenAiExpectedCostRejectionCode,
): void {
  let caught:
    unknown;

  try {
    run();
  } catch (error) {
    caught =
      error;
  }

  expect(
    caught,
  ).toBeInstanceOf(
    GoogleGenAiExpectedCostRejectedError,
  );

  expect(
    (
      caught as GoogleGenAiExpectedCostRejectedError
    ).code,
  ).toBe(
    code,
  );
}

describe(
  "Busybookie Google GenAI expected-cost preflight (B4U6)",
  () => {
    it(
      "derives the 720p cost from verified pricing, 10 s and the 0.50 USD reserve",
      () => {
        const result =
          computeGoogleGenAiExpectedCost({
            resolution:
              "720p",

            pricing,

            cost,
          });

        expect(
          result,
        ).toStrictEqual({
          resolution:
            "720p",

          videoOutputMicroUsdPerSecond:
            pricing.knownVideoOutput720pMicroUsdPerSecond,

          durationSeconds:
            10,

          videoOutputMicroUsd:
            10 *
              pricing.knownVideoOutput720pMicroUsdPerSecond,

          inputReserveMicroUsd:
            500000,

          expectedMicroUsd:
            10 *
              pricing.knownVideoOutput720pMicroUsdPerSecond +
              500000,

          maxExpectedCostMicroUsd:
            2000000,
        });

        // Current verified evidence: 101,360 microUSD/s at 720p.
        expect(
          result.expectedMicroUsd,
        ).toBe(
          1513600,
        );

        expect(
          result.expectedMicroUsd /
            1_000_000,
        ).toBe(
          1.5136,
        );

        expect(
          result.expectedMicroUsd,
        ).toBeLessThanOrEqual(
          result.maxExpectedCostMicroUsd,
        );

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "includes the input reserve in the expected cost",
      () => {
        const lowerReserve =
          computeGoogleGenAiExpectedCost({
            resolution:
              "720p",

            pricing,

            cost: {
              ...cost,

              inputReserveMicroUsd:
                400000,
            },
          });

        expect(
          lowerReserve.expectedMicroUsd,
        ).toBe(
          1513600 -
            100000,
        );
      },
    );

    it.each([
      "360p",
      "1080p",
      "4k",
    ])(
      "rejects %s because no authoritative local price exists",
      (resolution) => {
        expectRejection(
          () =>
            computeGoogleGenAiExpectedCost({
              resolution,
              pricing,
              cost,
            }),
          "PRICING_UNAVAILABLE",
        );
      },
    );

    it.each([
      "720P",
      "8k",
      "",
      720,
      null,
      undefined,
      {},
    ])(
      "rejects the unknown resolution %j",
      (resolution) => {
        expectRejection(
          () =>
            computeGoogleGenAiExpectedCost({
              resolution,
              pricing,
              cost,
            }),
          "RESOLUTION_UNSUPPORTED",
        );
      },
    );

    it(
      "accepts a cost exactly equal to the cap and rejects one MICRO_USD above it",
      () => {
        const atCap =
          computeGoogleGenAiExpectedCost({
            resolution:
              "720p",

            pricing,

            cost: {
              ...cost,

              maxExpectedCostMicroUsd:
                1513600,
            },
          });

        expect(
          atCap.expectedMicroUsd,
        ).toBe(
          atCap.maxExpectedCostMicroUsd,
        );

        expectRejection(
          () =>
            computeGoogleGenAiExpectedCost({
              resolution:
                "720p",

              pricing,

              cost: {
                ...cost,

                maxExpectedCostMicroUsd:
                  1513599,
              },
            }),
          "COST_EXCEEDS_CAP",
        );
      },
    );

    it(
      "rejects a 720p cost above the 2.00 USD cap",
      () => {
        expectRejection(
          () =>
            computeGoogleGenAiExpectedCost({
              resolution:
                "720p",

              pricing: {
                knownVideoOutput720pMicroUsdPerSecond:
                  150001,
              },

              cost,
            }),
          "COST_EXCEEDS_CAP",
        );
      },
    );

    it.each([
      ["NaN rate", { rate: Number.NaN }],
      ["infinite rate", { rate: Number.POSITIVE_INFINITY }],
      ["fractional rate", { rate: 101360.5 }],
      ["zero rate", { rate: 0 }],
      ["negative rate", { rate: -101360 }],
      ["overflowing rate", { rate: Number.MAX_SAFE_INTEGER }],
      ["zero duration", { duration: 0 }],
      ["NaN reserve", { reserve: Number.NaN }],
      ["zero cap", { cap: 0 }],
    ])(
      "fails closed on a calculation failure (%s)",
      (
        _label,
        broken: {
          rate?: number;
          duration?: number;
          reserve?: number;
          cap?: number;
        },
      ) => {
        expectRejection(
          () =>
            computeGoogleGenAiExpectedCost({
              resolution:
                "720p",

              pricing: {
                knownVideoOutput720pMicroUsdPerSecond:
                  broken.rate ??
                  pricing.knownVideoOutput720pMicroUsdPerSecond,
              },

              cost: {
                maxExpectedCostMicroUsd:
                  broken.cap ??
                  cost.maxExpectedCostMicroUsd,

                inputReserveMicroUsd:
                  broken.reserve ??
                  cost.inputReserveMicroUsd,

                costAdmissionDurationSeconds:
                  broken.duration ??
                  cost.costAdmissionDurationSeconds,
              },
            }),
          "CALCULATION_FAILED",
        );
      },
    );

    it(
      "keeps the preflight pure: no rate table literal, no I/O, no pricing-schema coupling",
      async () => {
        const source =
          await readFile(
            join(
              process.cwd(),
              "src/googleGenai/googleGenAiExpectedCost.ts",
            ),
            "utf8",
          );

        expect(
          source,
        ).not.toMatch(
          /101360|17500000|5792|node:|process\.env|fetch\s*\(|googleGenAiPolicy\.schema|Math\.round|toFixed|parseFloat/,
        );
      },
    );
  },
);
