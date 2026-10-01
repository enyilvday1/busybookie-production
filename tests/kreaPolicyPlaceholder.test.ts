import {
  describe,
  expect,
  it,
} from "vitest";

import {
  KreaPolicySchema,
} from "../src/schemas/kreaPolicy.schema.js";

import {
  loadKreaPolicy,
} from "../src/validation/loadKreaPolicy.js";

describe(
  "Busybookie Krea policy placeholder",
  () => {
    it(
      "loads an explicit non-executable Krea integration declaration",
      async () => {
        const policy =
          await loadKreaPolicy();

        expect(policy).toEqual({
          schemaVersion:
            "1.0",

          provider:
            "KREA",

          integration: {
            status:
              "PLACEHOLDER",

            productionExecutionEnabled:
              false,

            automaticRoutingEnabled:
              false,

            paidCallsEnabled:
              false,
          },

          externalApiContract: {
            status:
              "UNDEFINED",

            credentialRequirementDefined:
              false,

            requestContractDefined:
              false,

            responseContractDefined:
              false,
          },
        });
      },
    );

    it(
      "rejects enabling Krea production execution while it remains a placeholder",
      () => {
        const result =
          KreaPolicySchema.safeParse({
            schemaVersion:
              "1.0",

            provider:
              "KREA",

            integration: {
              status:
                "PLACEHOLDER",

              productionExecutionEnabled:
                true,

              automaticRoutingEnabled:
                false,

              paidCallsEnabled:
                false,
            },

            externalApiContract: {
              status:
                "UNDEFINED",

              credentialRequirementDefined:
                false,

              requestContractDefined:
                false,

              responseContractDefined:
                false,
            },
          });

        expect(
          result.success,
        ).toBe(false);
      },
    );

    it(
      "rejects claiming a Krea request contract exists",
      () => {
        const result =
          KreaPolicySchema.safeParse({
            schemaVersion:
              "1.0",

            provider:
              "KREA",

            integration: {
              status:
                "PLACEHOLDER",

              productionExecutionEnabled:
                false,

              automaticRoutingEnabled:
                false,

              paidCallsEnabled:
                false,
            },

            externalApiContract: {
              status:
                "UNDEFINED",

              credentialRequirementDefined:
                false,

              requestContractDefined:
                true,

              responseContractDefined:
                false,
            },
          });

        expect(
          result.success,
        ).toBe(false);
      },
    );

    it(
      "rejects claiming a Krea response contract exists",
      () => {
        const result =
          KreaPolicySchema.safeParse({
            schemaVersion:
              "1.0",

            provider:
              "KREA",

            integration: {
              status:
                "PLACEHOLDER",

              productionExecutionEnabled:
                false,

              automaticRoutingEnabled:
                false,

              paidCallsEnabled:
                false,
            },

            externalApiContract: {
              status:
                "UNDEFINED",

              credentialRequirementDefined:
                false,

              requestContractDefined:
                false,

              responseContractDefined:
                true,
            },
          });

        expect(
          result.success,
        ).toBe(false);
      },
    );
  },
);
