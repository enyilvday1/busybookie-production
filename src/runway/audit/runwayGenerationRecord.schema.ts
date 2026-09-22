import {
  z,
} from "zod";

export const RunwayAssetStrategySchema =
  z.enum([
    "DATA_URI",
    "EPHEMERAL_UPLOAD",
  ]);

export const RunwayGenerationOutputRecordSchema =
  z.object({
    outputIndex:
      z.number()
        .int()
        .positive(),

    destinationPath:
      z.string()
        .trim()
        .min(1),

    bytes:
      z.number()
        .int()
        .nonnegative(),

    sha256:
      z.string()
        .regex(
          /^[a-f0-9]{64}$/,
          "sha256 must be a lowercase 64-character hexadecimal digest.",
        ),

    contentType:
      z.string()
        .trim()
        .min(1)
        .nullable(),
  })
    .strict();

export const RunwayGenerationRecordSchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    recordedAt:
      z.string()
        .datetime(),

    provider:
      z.literal(
        "RUNWAY",
      ),

    model:
      z.literal(
        "gen4.5",
      ),

    status:
      z.literal(
        "SUCCEEDED",
      ),

    episodeId:
      z.string()
        .regex(
          /^EP[0-9]{2,3}$/,
        ),

    shotId:
      z.string()
        .regex(
          /^S[0-9]{2,3}[A-Z]?$/,
        ),

    taskId:
      z.string()
        .trim()
        .min(1),

    request:
      z.object({
        durationSeconds:
          z.number()
            .int()
            .min(2)
            .max(10),

        ratio:
          z.literal(
            "1280:720",
          ),

        outputFormat:
          z.literal(
            "mp4",
          ),

        promptText:
          z.string()
            .trim()
            .min(1)
            .max(1000),

        sourceImagePath:
          z.string()
            .trim()
            .min(1),

        assetStrategy:
          RunwayAssetStrategySchema,
      })
        .strict(),

    credits:
      z.object({
        locallyExpected:
          z.number()
            .int()
            .nonnegative(),

        providerEstimated:
          z.number()
            .int()
            .nonnegative(),

        providerFinal:
          z.number()
            .int()
            .nonnegative(),
      })
        .strict(),

    outputs:
      z.array(
        RunwayGenerationOutputRecordSchema,
      )
        .min(1),
  })
    .strict();

export type RunwayGenerationRecord =
  z.infer<
    typeof RunwayGenerationRecordSchema
  >;
