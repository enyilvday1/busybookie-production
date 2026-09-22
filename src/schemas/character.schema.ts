import { z } from "zod";

export const CharacterIdSchema = z.enum([
  "OLLIE",
  "KACEY",
  "MONT",
]);

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

export const LockedCharacterVoiceSchema = z.object({
  selectionStatus: z.literal("LOCKED"),
  provider: VoiceProviderSchema,
  voiceName: z.string().trim().min(1),
  deliveryTraits: z.array(z.string().trim().min(1)).min(1),
}).strict();

export const PendingCharacterVoiceSchema = z.object({
  selectionStatus: z.literal("PENDING"),
  provider: VoiceProviderSchema,
  voiceName: z.null(),
  deliveryTraits: z.array(z.string().trim().min(1)).min(1),
}).strict();

export const CharacterVoiceSchema = z.discriminatedUnion(
  "selectionStatus",
  [
    LockedCharacterVoiceSchema,
    PendingCharacterVoiceSchema,
  ],
);

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
