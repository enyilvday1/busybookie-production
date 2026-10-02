import {
  z,
} from "zod";

export const RUNWAY_ELEVEN_V3_MODEL =
  "eleven_v3" as const;

/*
 * Synchronized with the Runway SDK 4.20.0
 * TextToSpeechCreateParams.ElevenV3 preset union.
 *
 * This is a provider-contract allowlist, not a Character Bible
 * allowlist. Character-to-voice approval remains owned by the
 * canonical dialogue planning layer.
 */
export const RUNWAY_ELEVEN_V3_PRESET_IDS = [
  "Maya",
  "Arjun",
  "Serene",
  "Bernard",
  "Billy",
  "Mark",
  "Clint",
  "Mabel",
  "Chad",
  "Leslie",
  "Eleanor",
  "Elias",
  "Elliot",
  "Grungle",
  "Brodie",
  "Sandra",
  "Kirk",
  "Kylie",
  "Lara",
  "Lisa",
  "Malachi",
  "Marlene",
  "Martin",
  "Miriam",
  "Monster",
  "Paula",
  "Pip",
  "Rusty",
  "Ragnar",
  "Xylar",
  "Maggie",
  "Jack",
  "Katie",
  "Noah",
  "James",
  "Rina",
  "Ella",
  "Mariah",
  "Frank",
  "Claudia",
  "Niki",
  "Vincent",
  "Kendrick",
  "Myrna",
  "Tom",
  "Wanda",
  "Benjamin",
  "Kiana",
  "Rachel",
] as const;

export const RunwayElevenV3PresetIdSchema =
  z.enum(
    RUNWAY_ELEVEN_V3_PRESET_IDS,
  );

export const RunwayElevenV3RequestSchema =
  z.object({
    model:
      z.literal(
        RUNWAY_ELEVEN_V3_MODEL,
      ),

    promptText:
      z.string()
        .trim()
        .min(1)
        .refine(
          (value) =>
            value.length <=
            1_000,
          {
            message:
              "Runway Eleven v3 promptText must not exceed 1000 UTF-16 code units.",
          },
        ),

    voice:
      z.object({
        type:
          z.literal(
            "runway-preset",
          ),

        presetId:
          RunwayElevenV3PresetIdSchema,
      })
        .strict(),

    applyTextNormalization:
      z.enum([
        "auto",
        "on",
        "off",
      ]),

    languageCode:
      z.string()
        .regex(
          /^[a-z]{2}$/,
          "Runway Eleven v3 languageCode must use a two-letter lowercase ISO 639-1 code.",
        ),

    seed:
      z.number()
        .int()
        .min(
          0,
        )
        .max(
          4_294_967_295,
        ),

    similarityBoost:
      z.number()
        .min(
          0,
        )
        .max(
          1,
        ),

    speed:
      z.number()
        .min(
          0.7,
        )
        .max(
          1.2,
        ),

    stability:
      z.number()
        .min(
          0,
        )
        .max(
          1,
        ),

    style:
      z.number()
        .min(
          0,
        )
        .max(
          1,
        ),

    useSpeakerBoost:
      z.boolean(),
  })
    .strict();

export type RunwayElevenV3PresetId =
  z.infer<
    typeof RunwayElevenV3PresetIdSchema
  >;

export type RunwayElevenV3Request =
  z.infer<
    typeof RunwayElevenV3RequestSchema
  >;
