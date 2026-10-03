import { z } from "zod";

export const CharacterIdSchema = z.string().regex(
  /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/,
  "Character id must use uppercase letters, numbers, and single underscores only.",
);

export const CharacterGenderSchema = z.enum([
  "BOY",
  "GIRL",
]);

export const CharacterPronounsSchema = z.object({
  subject: z.string().trim().min(1),
  object: z.string().trim().min(1),
  possessiveAdjective: z.string().trim().min(1),
  possessivePronoun: z.string().trim().min(1),
  reflexive: z.string().trim().min(1),
}).strict();

export const VoiceProviderSchema = z.enum([
  "RUNWAY",
]);

const ReferenceAudioAssetIdSchema =
  z.string()
    .regex(
      /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/,
      "Reference audio asset id must use uppercase letters, numbers, and single underscores only.",
    );

const ReferenceAudioRelativePathSchema =
  z.string()
    .trim()
    .min(1)
    .refine(
      (value) => {
        if (
          value.startsWith("/") ||
          /^[A-Za-z]:[\\/]/.test(
            value,
          ) ||
          value.includes("\\")
        ) {
          return false;
        }

        const segments =
          value.split("/");

        return segments.every(
          (segment) =>
            segment.length >
              0 &&
            segment !==
              "." &&
            segment !==
              "..",
        );
      },
      {
        message:
          "Reference audio path must be a canonical media-root-relative path using forward slashes with no traversal segments.",
      },
    );

const ReferenceAudioSha256Schema =
  z.string()
    .regex(
      /^[a-f0-9]{64}$/,
      "Reference audio sha256 must be a lowercase 64-character hexadecimal digest.",
    );

const ReferenceAudioContentTypeSchema =
  z.string()
    .trim()
    .regex(
      /^audio\/[A-Za-z0-9][A-Za-z0-9.+-]*$/,
      "Reference audio contentType must be an audio media type.",
    );

export const RunwayReferenceAudioAssetSchema =
  z.object({
    assetId:
      ReferenceAudioAssetIdSchema,

    mediaRootRelativePath:
      ReferenceAudioRelativePathSchema,

    bytes:
      z.number()
        .int()
        .positive()
        .refine(
          Number.isSafeInteger,
          "Reference audio bytes must be a positive safe integer.",
        ),

    sha256:
      ReferenceAudioSha256Schema,

    contentType:
      ReferenceAudioContentTypeSchema,

    durationSeconds:
      z.number()
        .positive(),

    codecName:
      z.string()
        .trim()
        .min(1),

    sampleRateHz:
      z.number()
        .int()
        .positive(),

    channels:
      z.number()
        .int()
        .positive(),
  })
    .strict();

export const LockedCharacterVoiceSchema = z.object({
  selectionStatus: z.literal("LOCKED"),
  provider: VoiceProviderSchema,
  voiceName: z.string().trim().min(1),
  deliveryTraits: z.array(z.string().trim().min(1)).min(1),
}).strict();

export const LockedReferenceAudioCharacterVoiceSchema =
  z.object({
    selectionStatus:
      z.literal(
        "LOCKED",
      ),

    provider:
      z.literal(
        "RUNWAY",
      ),

    voiceName:
      z.string()
        .trim()
        .min(1),

    deliveryTraits:
      z.array(
        z.string()
          .trim()
          .min(1),
      )
        .min(1),

    executionMode:
      z.literal(
        "RUNWAY_REFERENCE_AUDIO",
      ),

    referenceAudio:
      RunwayReferenceAudioAssetSchema,
  })
    .strict();

export const PendingCharacterVoiceSchema = z.object({
  selectionStatus: z.literal("PENDING"),
  provider: VoiceProviderSchema,
  voiceName: z.null(),
  deliveryTraits: z.array(z.string().trim().min(1)).min(1),
}).strict();

export const CharacterVoiceSchema =
  z.union([
    LockedReferenceAudioCharacterVoiceSchema,
    LockedCharacterVoiceSchema,
    PendingCharacterVoiceSchema,
  ]);

export const CharacterAppearanceSchema = z.object({
  body: z.string().trim().min(1),
  face: z.string().trim().min(1),
  eyes: z.string().trim().min(1),
  outfit: z.array(z.string().trim().min(1)).min(1),
  accessories: z.array(z.string().trim().min(1)),
  distinguishingFeatures: z.array(
    z.string().trim().min(1),
  ).min(1),
}).strict();

export const CharacterContinuitySchema = z.object({
  mustPreserve: z.array(z.string().trim().min(1)).min(1),
  mustNotChange: z.array(z.string().trim().min(1)).min(1),
}).strict();

export const CharacterSchema = z.object({
  id: CharacterIdSchema,
  name: z.string().trim().min(1),
  species: z.string().trim().min(1),

  gender: CharacterGenderSchema,
  pronouns: CharacterPronounsSchema,

  presentation: z.string().trim().min(1),
  role: z.string().trim().min(1),

  personalityTraits: z.array(
    z.string().trim().min(1),
  ).min(1),

  appearance: CharacterAppearanceSchema,
  continuity: CharacterContinuitySchema,
  voice: CharacterVoiceSchema,

  promptAnchor: z.string().trim().min(1),
}).strict();

export const CharacterBibleSchema = z.object({
  schemaVersion: z.literal("1.0"),
  characters: z.array(CharacterSchema).min(1),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  const names = new Set<string>();

  value.characters.forEach((character, index) => {
    if (ids.has(character.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["characters", index, "id"],
        message: `Duplicate character id: ${character.id}`,
      });
    }

    const normalizedName = character.name.toLowerCase();

    if (names.has(normalizedName)) {
      ctx.addIssue({
        code: "custom",
        path: ["characters", index, "name"],
        message: `Duplicate character name: ${character.name}`,
      });
    }

    ids.add(character.id);
    names.add(normalizedName);
  });
});

export type CharacterId = z.infer<typeof CharacterIdSchema>;
export type CharacterGender = z.infer<typeof CharacterGenderSchema>;
export type Character = z.infer<typeof CharacterSchema>;
export type CharacterBible = z.infer<typeof CharacterBibleSchema>;
export type CharacterVoice = z.infer<typeof CharacterVoiceSchema>;
export type LockedReferenceAudioCharacterVoice =
  z.infer<
    typeof LockedReferenceAudioCharacterVoiceSchema
  >;
export type RunwayReferenceAudioAsset =
  z.infer<
    typeof RunwayReferenceAudioAssetSchema
  >;
