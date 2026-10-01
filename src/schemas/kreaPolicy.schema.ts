import {
  z,
} from "zod";

export const KreaPolicySchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    provider:
      z.literal(
        "KREA",
      ),

    integration:
      z.object({
        status:
          z.literal(
            "PLACEHOLDER",
          ),

        productionExecutionEnabled:
          z.literal(false),

        automaticRoutingEnabled:
          z.literal(false),

        paidCallsEnabled:
          z.literal(false),
      })
        .strict(),

    externalApiContract:
      z.object({
        status:
          z.literal(
            "UNDEFINED",
          ),

        credentialRequirementDefined:
          z.literal(false),

        requestContractDefined:
          z.literal(false),

        responseContractDefined:
          z.literal(false),
      })
        .strict(),
  })
    .strict();

export type KreaPolicy =
  z.infer<
    typeof KreaPolicySchema
  >;
