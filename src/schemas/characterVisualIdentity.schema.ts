import { z } from "zod";

import {
  CharacterIdSchema,
} from "./characterId.schema.js";

// E9 Step 1136: CharacterVisualIdentityV1 answers "what does approved asset X mean for
// character Y?". It is provider-neutral and language-independent: roles are machine codes,
// and trait text is opaque authoring wording with no assumed language.
//
// Asset bytes (paths, byte counts, SHA-256, content type) stay owned by the visual-reference
// asset registry and verifyApprovedVisualReferenceAsset; bindings carry only the assetId.

export const CHARACTER_VISUAL_REFERENCE_ROLES = [
  "MASTER_IDENTITY",
  "FRONT",
  "THREE_QUARTER",
  "PROFILE",
] as const;

export const CharacterVisualReferenceRoleSchema =
  z.enum(
    CHARACTER_VISUAL_REFERENCE_ROLES,
  );

// Stricter than the registry's own assetId rule: no whitespace, separators, drive prefixes
// or URL syntax, so a path or provider URL can never stand in for an asset identity.
export const CharacterVisualReferenceAssetIdSchema =
  z.string()
    .max(128)
    .regex(
      /^(?![A-Za-z]:)[A-Za-z0-9][A-Za-z0-9_-]*(?:[.:][A-Za-z0-9_-]+)*$/,
      "Visual reference assetId must be a registry identifier, not a path or URL.",
    );

function isCanonicalIdentityText(
  value:
    string,
): boolean {
  return (
    value ===
      value.trim() &&
    !/\p{Cc}/u.test(
      value,
    ) &&
    // URL schemes, drive-absolute, UNC and root-absolute paths are never identity.
    !/[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(
      value,
    ) &&
    !/[A-Za-z]:[\\/]/.test(
      value,
    ) &&
    !value.includes(
      "\\\\",
    ) &&
    !value.startsWith(
      "/",
    )
  );
}

export const CharacterIdentityTextSchema =
  z.string()
    .min(1)
    .max(4000)
    .refine(
      isCanonicalIdentityText,
      {
        message:
          "Identity text must be trimmed, free of control characters, and must not contain URLs or absolute paths.",
      },
    );

function identityTextKey(
  value:
    string,
): string {
  return value
    .normalize(
      "NFC",
    )
    .toLowerCase();
}

export function createUniqueIdentityTextListSchema(
  minimum:
    number,
) {
  return z.array(
    CharacterIdentityTextSchema,
  )
    .min(minimum)
    .max(64)
    .superRefine(
      (
        values,
        ctx,
      ) => {
        const seen =
          new Set<string>();

        values.forEach(
          (
            value,
            index,
          ) => {
            const key =
              identityTextKey(
                value,
              );

            if (
              seen.has(
                key,
              )
            ) {
              ctx.addIssue({
                code:
                  "custom",

                path: [
                  index,
                ],

                message:
                  `Duplicate identity text: ${value}`,
              });
            }

            seen.add(
              key,
            );
          },
        );
      },
    );
}

export const CharacterIdentityVersionSchema =
  z.number()
    .int()
    .min(1)
    .max(
      Number.MAX_SAFE_INTEGER,
    );

export const CharacterVisualReferenceBindingV1Schema =
  z.object({
    role:
      CharacterVisualReferenceRoleSchema,

    assetId:
      CharacterVisualReferenceAssetIdSchema,
  })
    .strict();

// Shared by the identity and the snapshot: one asset per role and one role per asset,
// otherwise reference selection would be ambiguous.
export function addReferenceBindingIssues(
  bindings:
    readonly z.infer<
      typeof CharacterVisualReferenceBindingV1Schema
    >[],
  requireMasterIdentity:
    boolean,
  ctx:
    z.RefinementCtx,
  basePath:
    readonly PropertyKey[],
): void {
  const roles =
    new Set<string>();

  const assetIds =
    new Set<string>();

  bindings.forEach(
    (
      binding,
      index,
    ) => {
      if (
        roles.has(
          binding.role,
        )
      ) {
        ctx.addIssue({
          code:
            "custom",

          path: [
            ...basePath,
            index,
            "role",
          ],

          message:
            `Duplicate visual reference role: ${binding.role}`,
        });
      }

      if (
        assetIds.has(
          binding.assetId,
        )
      ) {
        ctx.addIssue({
          code:
            "custom",

          path: [
            ...basePath,
            index,
            "assetId",
          ],

          message:
            `Duplicate visual reference asset: ${binding.assetId}`,
        });
      }

      roles.add(
        binding.role,
      );

      assetIds.add(
        binding.assetId,
      );
    },
  );

  if (
    requireMasterIdentity &&
    !roles.has(
      "MASTER_IDENTITY",
    )
  ) {
    ctx.addIssue({
      code:
        "custom",

      path: [
        ...basePath,
      ],

      message:
        "A locked visual identity requires exactly one MASTER_IDENTITY reference binding.",
    });
  }
}

// E9 Step 1137E: machine codes and the structured state/trait contracts of CharacterBible v2.
export const CharacterMachineCodeSchema =
  z.string()
    .regex(
      /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/,
      "Character machine codes must use uppercase letters, numbers and single underscores.",
    );

const CharacterSha256Schema =
  z.string()
    .regex(
      /^[0-9a-f]{64}$/,
      "Character evidence digests must be lowercase 64-character hexadecimal SHA-256.",
    );

export const CharacterStateResolutionSchema =
  z.object({
    attribute:
      z.enum([
        "COLOUR",
        "FORM",
      ]),

    valueCode:
      CharacterMachineCodeSchema,
  })
    .strict();

function addUniqueKeyIssues(
  values:
    readonly string[],
  label:
    string,
  ctx:
    z.RefinementCtx,
): void {
  const seen =
    new Set<string>();

  values.forEach(
    (
      value,
      index,
    ) => {
      if (
        seen.has(
          value,
        )
      ) {
        ctx.addIssue({
          code:
            "custom",

          path: [
            index,
          ],

          message:
            `Duplicate ${label}: ${value}`,
        });
      }

      seen.add(
        value,
      );
    },
  );
}

// Default continuity state: removable items a character wears or carries by default. Never identity.
export const CharacterDefaultContinuityStateSchema =
  z.object({
    items:
      z.array(
        z.object({
          itemKey:
            CharacterMachineCodeSchema,

          description:
            CharacterIdentityTextSchema,

          resolutions:
            z.array(
              CharacterStateResolutionSchema,
            )
              .max(2),
        })
          .strict(),
      )
        .max(64)
        .superRefine(
          (
            items,
            ctx,
          ) =>
            addUniqueKeyIssues(
              items.map(
                (item) =>
                  item.itemKey,
              ),
              "default state itemKey",
              ctx,
            ),
        ),
  })
    .strict();

// Conditional items that may appear only when explicit shot or story state requires them.
export const CharacterShotOrStoryStateItemsSchema =
  z.array(
    z.object({
      itemKey:
        CharacterMachineCodeSchema,

      description:
        CharacterIdentityTextSchema,

      classification:
        z.literal(
          "SHOT_OR_STORY_STATE",
        ),
    })
      .strict(),
  )
    .max(64)
    .superRefine(
      (
        items,
        ctx,
      ) =>
        addUniqueKeyIssues(
          items.map(
            (item) =>
              item.itemKey,
          ),
          "shot or story state itemKey",
          ctx,
        ),
    );

// Presentation guidance: styling direction only; never a state item and never identity.
export const CharacterPresentationGuidanceSchema =
  z.array(
    z.object({
      guidanceKey:
        CharacterMachineCodeSchema,

      text:
        CharacterIdentityTextSchema,
    })
      .strict(),
  )
    .max(64)
    .superRefine(
      (
        items,
        ctx,
      ) =>
        addUniqueKeyIssues(
          items.map(
            (item) =>
              item.guidanceKey,
          ),
          "presentation guidanceKey",
          ctx,
        ),
    );

// Structured stable visual trait decisions. HUMAN_APPROVED_VISUAL_IDENTITY_DECISION entries made during the IV1
// onboarding exist in their receipts only as free text; legacyIv1ReceiptNoteCorroboration names the exact phrase of
// the pinned receipt's operatorNotes that corroborates them (FREE_TEXT_ONLY_SUPPLEMENTAL_DECISION_PATH =
// LEGACY_IV1_MIGRATION_EXCEPTION). CHARACTER_BIBLE_SOURCE entries quote the exact identity prose they come from.
export const CharacterApprovedTraitDecisionSchema =
  z.discriminatedUnion(
    "provenance",
    [
      z.object({
        traitKey:
          CharacterMachineCodeSchema,

        valueCode:
          CharacterMachineCodeSchema,

        description:
          CharacterIdentityTextSchema,

        provenance:
          z.literal(
            "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION",
          ),

        legacyIv1ReceiptNoteCorroboration:
          CharacterIdentityTextSchema,
      })
        .strict(),

      z.object({
        traitKey:
          CharacterMachineCodeSchema,

        valueCode:
          CharacterMachineCodeSchema,

        description:
          CharacterIdentityTextSchema,

        provenance:
          z.literal(
            "CHARACTER_BIBLE_SOURCE",
          ),

        characterBibleSourceText:
          CharacterIdentityTextSchema,
      })
        .strict(),
    ],
  );

const ApprovedTraitDecisionListSchema =
  z.array(
    CharacterApprovedTraitDecisionSchema,
  )
    .max(64)
    .superRefine(
      (
        decisions,
        ctx,
      ) =>
        addUniqueKeyIssues(
          decisions.map(
            (decision) =>
              decision.traitKey,
          ),
          "approved trait traitKey",
          ctx,
        ),
    );

// Minimal evidence link from an active identity to its immutable approval receipt. The receipt path is derived
// from characterId + identityVersion; receiptSha256 pins the exact receipt bytes.
export const CharacterVisualIdentityApprovalLinkSchema =
  z.object({
    approvalId:
      z.string()
        .uuid(),

    receiptSha256:
      CharacterSha256Schema,
  })
    .strict();

const LockedCharacterVisualIdentityV1Schema =
  z.object({
    schemaVersion:
      z.literal(
        "2.0",
      ),

    status:
      z.literal(
        "LOCKED",
      ),

    characterId:
      CharacterIdSchema,

    identityVersion:
      CharacterIdentityVersionSchema,

    referenceBindings:
      z.array(
        CharacterVisualReferenceBindingV1Schema,
      )
        .min(1)
        .max(
          CHARACTER_VISUAL_REFERENCE_ROLES.length,
        ),

    invariantTraits:
      createUniqueIdentityTextListSchema(
        1,
      ),

    prohibitedVariations:
      createUniqueIdentityTextListSchema(
        1,
      ),

    approvedTraitDecisions:
      ApprovedTraitDecisionListSchema,

    approval:
      CharacterVisualIdentityApprovalLinkSchema,
  })
    .strict();

// PENDING records work in progress; it can never produce a shot continuity snapshot and carries no approval link.
const PendingCharacterVisualIdentityV1Schema =
  z.object({
    schemaVersion:
      z.literal(
        "2.0",
      ),

    status:
      z.literal(
        "PENDING",
      ),

    characterId:
      CharacterIdSchema,

    identityVersion:
      CharacterIdentityVersionSchema,

    referenceBindings:
      z.array(
        CharacterVisualReferenceBindingV1Schema,
      )
        .max(
          CHARACTER_VISUAL_REFERENCE_ROLES.length,
        ),

    invariantTraits:
      createUniqueIdentityTextListSchema(
        0,
      ),

    prohibitedVariations:
      createUniqueIdentityTextListSchema(
        0,
      ),

    approvedTraitDecisions:
      ApprovedTraitDecisionListSchema,
  })
    .strict();

export const CharacterVisualIdentityV1Schema =
  z.discriminatedUnion(
    "status",
    [
      LockedCharacterVisualIdentityV1Schema,
      PendingCharacterVisualIdentityV1Schema,
    ],
  )
    .superRefine(
      (
        identity,
        ctx,
      ) => {
        addReferenceBindingIssues(
          identity.referenceBindings,
          identity.status ===
            "LOCKED",
          ctx,
          [
            "referenceBindings",
          ],
        );
      },
    );

export type CharacterVisualReferenceRole =
  z.infer<
    typeof CharacterVisualReferenceRoleSchema
  >;

export type CharacterVisualReferenceBindingV1 =
  z.infer<
    typeof CharacterVisualReferenceBindingV1Schema
  >;

export type CharacterVisualIdentityV1 =
  z.infer<
    typeof CharacterVisualIdentityV1Schema
  >;

export type CharacterApprovedTraitDecision =
  z.infer<
    typeof CharacterApprovedTraitDecisionSchema
  >;

export type CharacterDefaultContinuityState =
  z.infer<
    typeof CharacterDefaultContinuityStateSchema
  >;

export type LockedCharacterVisualIdentityV1 =
  Extract<
    CharacterVisualIdentityV1,
    { status: "LOCKED" }
  >;

export function compareCharacterVisualReferenceRoles(
  left:
    CharacterVisualReferenceRole,
  right:
    CharacterVisualReferenceRole,
): number {
  return (
    CHARACTER_VISUAL_REFERENCE_ROLES.indexOf(
      left,
    ) -
    CHARACTER_VISUAL_REFERENCE_ROLES.indexOf(
      right,
    )
  );
}
