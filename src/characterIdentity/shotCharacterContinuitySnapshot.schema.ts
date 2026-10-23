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
  CharacterDefaultContinuityStateSchema,
  CharacterIdentityTextSchema,
  CharacterIdentityVersionSchema,
  CharacterMachineCodeSchema,
  CharacterVisualIdentityApprovalLinkSchema,
  CharacterVisualReferenceBindingV1Schema,
  compareCharacterVisualReferenceRoles,
  createUniqueIdentityTextListSchema,
} from "../schemas/characterVisualIdentity.schema.js";

// E9 Step 1137E: shot character continuity snapshot recordVersion "2". The immutable, provider-neutral character
// identity state for one shot, derived only from the active CharacterBible v2 structures (visualIdentity +
// defaultContinuityState); promptAnchor and legacy appearance prose are never read. It is not an episode manifest: no
// camera, audio, editorial, provider or model data. Immutable identity and default continuity state stay separate.

const SnapshotTraitDecisionV2Schema =
  z.object({
    traitKey:
      CharacterMachineCodeSchema,

    valueCode:
      CharacterMachineCodeSchema,

    description:
      CharacterIdentityTextSchema,

    provenance:
      z.enum([
        "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION",
        "CHARACTER_BIBLE_SOURCE",
      ]),
  })
    .strict();

const SnapshotImmutableIdentityV2Schema =
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

    approvedTraitDecisions:
      z.array(
        SnapshotTraitDecisionV2Schema,
      )
        .max(64),

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

// v2 has one state source: the CharacterBible default continuity state. Shot overrides are future members.
const SnapshotContinuityStateV2Schema =
  z.discriminatedUnion(
    "source",
    [
      z.object({
        source:
          z.literal(
            "CHARACTER_BIBLE_DEFAULT",
          ),

        items:
          CharacterDefaultContinuityStateSchema.shape.items,
      })
        .strict(),
    ],
  );

const SnapshotCharacterV2Schema =
  z.object({
    characterId:
      CharacterIdSchema,

    identityVersion:
      CharacterIdentityVersionSchema,

    approval:
      CharacterVisualIdentityApprovalLinkSchema,

    immutableIdentity:
      SnapshotImmutableIdentityV2Schema,

    continuityState:
      SnapshotContinuityStateV2Schema,
  })
    .strict();

export const ShotCharacterContinuitySnapshotV2Schema =
  z.object({
    recordType:
      z.literal(
        "BUSYBOOKIE_SHOT_CHARACTER_CONTINUITY_SNAPSHOT",
      ),

    recordVersion:
      z.literal(
        "2",
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
        SnapshotCharacterV2Schema,
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

export type ShotCharacterContinuitySnapshotV2 =
  z.infer<
    typeof ShotCharacterContinuitySnapshotV2Schema
  >;

export type ShotCharacterContinuitySnapshotCharacterV2 =
  ShotCharacterContinuitySnapshotV2["characters"][number];

export function parseShotCharacterContinuitySnapshotV2(
  input:
    unknown,
): ShotCharacterContinuitySnapshotV2 {
  const parsed =
    ShotCharacterContinuitySnapshotV2Schema
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
export function hashShotCharacterContinuitySnapshotV2(
  input:
    unknown,
): string {
  return characterIdentitySha256(
    canonicalCharacterIdentityJson(
      parseShotCharacterContinuitySnapshotV2(
        input,
      ),
    ),
  );
}
