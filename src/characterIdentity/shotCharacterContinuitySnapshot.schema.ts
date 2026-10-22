import { z } from "zod";

import {
  canonicalCharacterIdentityJson,
  characterIdentitySha256,
  freezeCharacterIdentity,
} from "./canonicalCharacterIdentityJson.js";

import {
  CharacterIdSchema,
} from "../schemas/characterId.schema.js";

import {
  addReferenceBindingIssues,
  CHARACTER_VISUAL_REFERENCE_ROLES,
  CharacterIdentityTextSchema,
  CharacterIdentityVersionSchema,
  CharacterVisualReferenceBindingV1Schema,
  compareCharacterVisualReferenceRoles,
  createUniqueIdentityTextListSchema,
} from "../schemas/characterVisualIdentity.schema.js";

// E9 Step 1136: the immutable, provider-neutral character identity state for one shot.
// It is not an episode manifest: no camera, audio, editorial, provider or model data.
// Immutable identity and mutable shot continuity state are kept in separate sub-objects.

const SnapshotImmutableIdentityV1Schema =
  z.object({
    species:
      CharacterIdentityTextSchema,

    invariantTraits:
      createUniqueIdentityTextListSchema(
        1,
      ),

    prohibitedVariations:
      createUniqueIdentityTextListSchema(
        1,
      ),

    referenceBindings:
      z.array(
        CharacterVisualReferenceBindingV1Schema,
      )
        .min(1)
        .max(
          CHARACTER_VISUAL_REFERENCE_ROLES.length,
        ),
  })
    .strict()
    .superRefine(
      (
        identity,
        ctx,
      ) => {
        addReferenceBindingIssues(
          identity.referenceBindings,
          true,
          ctx,
          [
            "referenceBindings",
          ],
        );

        identity.referenceBindings.forEach(
          (
            binding,
            index,
          ) => {
            const previous =
              identity.referenceBindings[
                index - 1
              ];

            if (
              previous &&
              compareCharacterVisualReferenceRoles(
                previous.role,
                binding.role,
              ) >= 0
            ) {
              ctx.addIssue({
                code:
                  "custom",

                path: [
                  "referenceBindings",
                  index,
                  "role",
                ],

                message:
                  "Snapshot reference bindings must be in canonical role order.",
              });
            }
          },
        );
      },
    );

// v1 has one state source: the CharacterBible default appearance. Shot overrides and
// state inherited from a previous shot are future members of this discriminated union.
const SnapshotContinuityStateV1Schema =
  z.discriminatedUnion(
    "source",
    [
      z.object({
        source:
          z.literal(
            "CHARACTER_BIBLE_DEFAULT",
          ),

        outfit:
          createUniqueIdentityTextListSchema(
            1,
          ),

        accessories:
          createUniqueIdentityTextListSchema(
            0,
          ),
      })
        .strict(),
    ],
  );

const SnapshotCharacterV1Schema =
  z.object({
    characterId:
      CharacterIdSchema,

    identityVersion:
      CharacterIdentityVersionSchema,

    promptAnchor:
      CharacterIdentityTextSchema,

    immutableIdentity:
      SnapshotImmutableIdentityV1Schema,

    continuityState:
      SnapshotContinuityStateV1Schema,
  })
    .strict();

export const ShotCharacterContinuitySnapshotV1Schema =
  z.object({
    recordType:
      z.literal(
        "BUSYBOOKIE_SHOT_CHARACTER_CONTINUITY_SNAPSHOT",
      ),

    recordVersion:
      z.literal(
        "1",
      ),

    episodeId:
      z.string()
        .regex(
          /^EP[0-9]{2,3}$/,
        ),

    sceneId:
      z.string()
        .regex(
          /^SC[0-9]{2,3}$/,
        ),

    shotId:
      z.string()
        .regex(
          /^S[0-9]{2,3}[A-Z]?$/,
        ),

    // Verbatim shot.continuityNotes; the manifest permits repeats, so no uniqueness rule.
    shotContinuityNotes:
      z.array(
        CharacterIdentityTextSchema,
      )
        .max(256),

    characters:
      z.array(
        SnapshotCharacterV1Schema,
      )
        .max(64),
  })
    .strict()
    .superRefine(
      (
        snapshot,
        ctx,
      ) => {
        // Strictly ascending code-unit order: rejects duplicates and non-canonical order.
        snapshot.characters.forEach(
          (
            character,
            index,
          ) => {
            const previous =
              snapshot.characters[
                index - 1
              ];

            if (
              previous &&
              previous.characterId >=
                character.characterId
            ) {
              ctx.addIssue({
                code:
                  "custom",

                path: [
                  "characters",
                  index,
                  "characterId",
                ],

                message:
                  previous.characterId ===
                    character.characterId
                    ? `Duplicate snapshot character: ${character.characterId}`
                    : "Snapshot characters must be in ascending characterId order.",
              });
            }
          },
        );
      },
    );

export type ShotCharacterContinuitySnapshotV1 =
  z.infer<
    typeof ShotCharacterContinuitySnapshotV1Schema
  >;

export type ShotCharacterContinuitySnapshotCharacterV1 =
  ShotCharacterContinuitySnapshotV1["characters"][number];

export function parseShotCharacterContinuitySnapshotV1(
  input:
    unknown,
): ShotCharacterContinuitySnapshotV1 {
  const parsed =
    ShotCharacterContinuitySnapshotV1Schema
      .safeParse(
        input,
      );

  if (!parsed.success) {
    throw new Error(
      `Shot character continuity snapshot is invalid: ${parsed.error.message}`,
    );
  }

  return freezeCharacterIdentity(
    parsed.data,
  );
}

// The digest is never part of the hashed payload; callers keep them side by side.
export function hashShotCharacterContinuitySnapshotV1(
  input:
    unknown,
): string {
  return characterIdentitySha256(
    canonicalCharacterIdentityJson(
      parseShotCharacterContinuitySnapshotV1(
        input,
      ),
    ),
  );
}
