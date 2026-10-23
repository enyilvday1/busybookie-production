import { z } from "zod";

import {
  CharacterGenderSchema,
  CharacterIdSchema,
  CharacterPronounsSchema,
  CharacterVoiceSchema,
} from "./character.schema.js";

// E9 Step 1137E (decision D-2): frozen CharacterBible v1 contract (schemaVersion "1.0"), exactly as it stood before
// activation. It exists only for the D1 approval-creation path (Step 1137D), whose source decisions point at
// appearance.outfit / appearance.accessories and whose sourceCharacterBible digest is computed over a parsed v1
// document. Production runtime loads CharacterBible v2 (character.schema.ts) and never reads v1. Historical v1
// documents never carried visualIdentity, so the frozen contract does not accept it.

export const HistoricalCharacterAppearanceV1Schema = z.object({
  body: z.string().trim().min(1),
  face: z.string().trim().min(1),
  eyes: z.string().trim().min(1),
  outfit: z.array(z.string().trim().min(1)).min(1),
  accessories: z.array(z.string().trim().min(1)),
  distinguishingFeatures: z.array(
    z.string().trim().min(1),
  ).min(1),
}).strict();

// Deprecated with CharacterBible v1 (MIGRATE_AND_DEPRECATE): its identity entries now live in visualIdentity and its
// item entries in defaultContinuityState. Retained only so historical v1 documents keep parsing.
export const HistoricalCharacterContinuityV1Schema = z.object({
  mustPreserve: z.array(z.string().trim().min(1)).min(1),
  mustNotChange: z.array(z.string().trim().min(1)).min(1),
}).strict();

export const HistoricalCharacterV1Schema = z.object({
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

  appearance: HistoricalCharacterAppearanceV1Schema,
  continuity: HistoricalCharacterContinuityV1Schema,
  voice: CharacterVoiceSchema,

  promptAnchor: z.string().trim().min(1),
}).strict();

export const HistoricalCharacterBibleV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  characters: z.array(HistoricalCharacterV1Schema).min(1),
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

export type HistoricalCharacterV1 = z.infer<typeof HistoricalCharacterV1Schema>;
export type HistoricalCharacterBibleV1 = z.infer<typeof HistoricalCharacterBibleV1Schema>;

// D1 creation refuses anything that is not a v1 document, with an explicit message, before parsing.
export function assertHistoricalCharacterBibleV1Input(input: unknown): void {
  const schemaVersion = (input as { schemaVersion?: unknown } | null)?.schemaVersion;

  if (schemaVersion !== "1.0") {
    throw new Error(
      `The Step 1137D (IV1) character approval creation contract supports CharacterBible v1 only (schemaVersion "1.0"); received schemaVersion ${JSON.stringify(schemaVersion)}. Approving a later identity version requires a later identity-version approval contract.`,
    );
  }
}
