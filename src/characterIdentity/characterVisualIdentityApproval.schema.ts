import { z } from "zod";

import {
  collectUnresolvedApprovalWording,
} from "./characterVisualIdentityApprovalAmbiguity.js";

import {
  CHARACTER_APPROVAL_SOURCE_FIELDS,
} from "./characterVisualIdentityApprovalSource.js";

import {
  CharacterIdSchema,
} from "../schemas/characterId.schema.js";

import {
  addReferenceBindingIssues,
  CHARACTER_VISUAL_REFERENCE_ROLES,
  CharacterIdentityTextSchema,
  CharacterIdentityVersionSchema,
  CharacterVisualReferenceAssetIdSchema,
  CharacterVisualReferenceRoleSchema,
  compareCharacterVisualReferenceRoles,
  type CharacterVisualReferenceRole,
} from "../schemas/characterVisualIdentity.schema.js";

import {
  VisualReferenceAssetSchema,
} from "../execution/visualReferenceAsset.schema.js";

// E9 Step 1137D1: CharacterVisualIdentityApprovalV1 is immutable historical evidence of one human
// approval decision made before activation (Step 1137C). It is not a second CharacterBible and never
// active identity authority: CharacterBible + the visual-reference registry stay authoritative.

const SHA256 = /^[0-9a-f]{64}$/;

const MACHINE_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

export const CharacterApprovalSha256Schema =
  z.string().regex(SHA256, "Approval digests must be lowercase 64-character hexadecimal SHA-256.");

export const CharacterApprovalMachineCodeSchema =
  z.string().regex(MACHINE_CODE, "Approval machine codes must use uppercase letters, numbers and single underscores.");

// Step 1137C ASSET_ID_COMPATIBILITY_RULE: <character-id-lower>-<role-kebab>-reference-v<n>.
const CHARACTER_REFERENCE_ASSET_ID =
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-(?:master-identity|front|three-quarter|profile)-reference-v[1-9][0-9]*$/;

export const CharacterReferenceAssetIdSchema =
  CharacterVisualReferenceAssetIdSchema.regex(
    CHARACTER_REFERENCE_ASSET_ID,
    "Character reference assetId must be <character-id-lower>-<role-kebab>-reference-v<n>.",
  );

export function characterReferenceAssetIdPrefix(
  characterId: string,
  role: CharacterVisualReferenceRole,
): string {
  const kebab = (value: string) => value.toLowerCase().replaceAll("_", "-");

  return `${kebab(characterId)}-${kebab(role)}-reference-v`;
}

export function characterReferenceAssetIdMatches(
  assetId: string,
  characterId: string,
  role: CharacterVisualReferenceRole,
): boolean {
  const prefix = characterReferenceAssetIdPrefix(characterId, role);

  return assetId.startsWith(prefix) && /^[1-9][0-9]*$/.test(assetId.slice(prefix.length));
}

// Step 1137C MASTER_REFERENCE_ACCEPTANCE_RULES AR01..AR15, keyed "<code>_<name>" exactly as frozen.
export const CHARACTER_REFERENCE_ACCEPTANCE_RULES = [
  "AR01_SINGLE_CHARACTER_ONLY",
  "AR02_FACE_CLEARLY_VISIBLE",
  "AR03_FULL_BODY_PROPORTIONS_VISIBLE",
  "AR04_SPECIES_UNAMBIGUOUS",
  "AR05_IDENTITY_COLOURS_MATCH_BIBLE",
  "AR06_IDENTITY_FEATURES_MATCH_BIBLE",
  "AR07_NO_CONTRADICTORY_VARIANTS",
  "AR08_DEFAULT_STATE_MATCHES_DECISIONS",
  "AR09_EXCLUDED_ITEMS_ABSENT",
  "AR10_NO_TEMPORARY_STATE",
  "AR11_NO_UNRESOLVED_ALTERNATIVES",
  "AR12_IMAGE_QUALITY_SUFFICIENT",
  "AR13_NO_WATERMARK_OR_BRANDING",
  "AR14_PLAIN_NON_DISTRACTING_BACKGROUND",
  "AR15_RIGHTS_CLEARED_FOR_PRODUCTION",
] as const;

export type CharacterReferenceAcceptanceRule = (typeof CHARACTER_REFERENCE_ACCEPTANCE_RULES)[number];

function acceptanceObject<T extends z.ZodType>(value: T) {
  return z.object(
    Object.fromEntries(CHARACTER_REFERENCE_ACCEPTANCE_RULES.map((rule) => [rule, value])) as Record<
      CharacterReferenceAcceptanceRule,
      T
    >,
  ).strict();
}

export const CharacterReferenceAcceptanceAttestationsSchema = acceptanceObject(z.literal(true));

export const CHARACTER_DEFAULT_STATE_DISPOSITIONS = [
  "DEFAULT_STATE_ITEM",
  "EXCLUDED_SHOT_OR_STORY_STATE",
  "PRESENTATION_GUIDANCE_NOT_STATE",
] as const;

export const CharacterDefaultStateDispositionSchema = z.enum(CHARACTER_DEFAULT_STATE_DISPOSITIONS);

export const CharacterDefaultStateResolutionAttributeSchema = z.enum(["COLOUR", "FORM"]);

export const CharacterApprovalSourceFieldSchema = z.enum(CHARACTER_APPROVAL_SOURCE_FIELDS);

const SourceIndexSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const CharacterDefaultStateResolutionSchema =
  z.object({
    attribute: CharacterDefaultStateResolutionAttributeSchema,
    valueCode: CharacterApprovalMachineCodeSchema,
  }).strict();

export const CharacterDefaultStateDecisionSchema =
  z.object({
    itemKey: CharacterApprovalMachineCodeSchema,

    source: z.object({
      field: CharacterApprovalSourceFieldSchema,
      index: SourceIndexSchema,
      sourceTextSha256: CharacterApprovalSha256Schema,
    }).strict(),

    disposition: CharacterDefaultStateDispositionSchema,

    resolutions: z.array(CharacterDefaultStateResolutionSchema).max(2),

    approvedDescription: CharacterIdentityTextSchema.max(400).optional(),
  }).strict();

export const CharacterVisualIdentityApprovalBindingSchema =
  z.object({
    role: CharacterVisualReferenceRoleSchema,
    assetId: CharacterReferenceAssetIdSchema,
    // Snapshot of the live registry entry reviewed: provenance only, never byte or path authority.
    registryEntry: VisualReferenceAssetSchema,
  }).strict();

// Free text gets the stricter "/" rule; every other persisted string still gets the word rules.
export const CHARACTER_APPROVAL_FREE_TEXT_KEYS: ReadonlySet<string> =
  new Set(["approvedDescription", "operatorNotes"]);

// Keys whose values this schema fixes to a closed enum or literal; the schema itself is their guard.
export const CHARACTER_APPROVAL_CLOSED_VALUE_KEYS: ReadonlySet<string> =
  new Set([
    "schemaVersion", "recordType", "status", "authorizationSource", "workflowStep", "activationEffect",
    "role", "field", "disposition", "attribute", "contentType",
  ]);

type DecisionShape = Readonly<{
  itemKey: string;
  source: Readonly<{ field: string; index: number }>;
  disposition: (typeof CHARACTER_DEFAULT_STATE_DISPOSITIONS)[number];
  resolutions?: readonly Readonly<{ attribute: string }>[] | undefined;
  approvedDescription?: string | undefined;
}>;

function addDecisionIssues(decisions: readonly DecisionShape[], ctx: z.RefinementCtx): void {
  const itemKeys = new Set<string>();
  const locations = new Set<string>();

  decisions.forEach((decision, index) => {
    const location = `${decision.source.field}[${decision.source.index}]`;

    if (itemKeys.has(decision.itemKey)) {
      ctx.addIssue({ code: "custom", path: ["defaultStateDecisions", index, "itemKey"], message: `Duplicate itemKey: ${decision.itemKey}` });
    }

    if (locations.has(location)) {
      ctx.addIssue({ code: "custom", path: ["defaultStateDecisions", index, "source"], message: `Duplicate decision for source ${location}` });
    }

    itemKeys.add(decision.itemKey);
    locations.add(location);

    const resolutions = decision.resolutions ?? [];

    if (new Set(resolutions.map((resolution) => resolution.attribute)).size !== resolutions.length) {
      ctx.addIssue({ code: "custom", path: ["defaultStateDecisions", index, "resolutions"], message: "Duplicate resolution attribute." });
    }

    if (decision.disposition === "DEFAULT_STATE_ITEM") {
      if (decision.approvedDescription === undefined) {
        ctx.addIssue({ code: "custom", path: ["defaultStateDecisions", index, "approvedDescription"], message: "DEFAULT_STATE_ITEM requires an approvedDescription." });
      }
    } else {
      if (decision.approvedDescription !== undefined) {
        ctx.addIssue({ code: "custom", path: ["defaultStateDecisions", index, "approvedDescription"], message: `${decision.disposition} must not carry an approvedDescription.` });
      }

      if (resolutions.length > 0) {
        ctx.addIssue({ code: "custom", path: ["defaultStateDecisions", index, "resolutions"], message: `${decision.disposition} must not carry resolutions.` });
      }
    }
  });
}

export const CharacterVisualIdentityApprovalV1Schema =
  z.object({
    schemaVersion: z.literal("1.0"),
    recordType: z.literal("CHARACTER_VISUAL_IDENTITY_APPROVAL"),
    approvalId: z.string().uuid(),
    approvedAt: z.string().datetime(),
    status: z.literal("APPROVED"),
    characterId: CharacterIdSchema,
    targetIdentityVersion: CharacterIdentityVersionSchema,

    sourceCharacterBible: z.object({
      schemaVersion: z.literal("1.0"),
      canonicalSha256: CharacterApprovalSha256Schema,
    }).strict(),

    referenceBindings: z.array(CharacterVisualIdentityApprovalBindingSchema)
      .min(1)
      .max(CHARACTER_VISUAL_REFERENCE_ROLES.length),

    defaultStateDecisions: z.array(CharacterDefaultStateDecisionSchema).min(1).max(64),
    acceptanceAttestations: CharacterReferenceAcceptanceAttestationsSchema,
    authorizationSource: z.literal("HUMAN_OPERATOR"),
    workflowStep: z.literal("E9_STEP_1137D"),
    operatorNotes: CharacterIdentityTextSchema.optional(),
    activationEffect: z.literal("NONE_EVIDENCE_ONLY"),
  })
    .strict()
    .superRefine((approval, ctx) => {
      // Exactly one MASTER_IDENTITY, one asset per role and one role per asset.
      addReferenceBindingIssues(approval.referenceBindings, true, ctx, ["referenceBindings"]);

      approval.referenceBindings.forEach((binding, index) => {
        const previous = approval.referenceBindings[index - 1];

        if (previous && compareCharacterVisualReferenceRoles(previous.role, binding.role) >= 0) {
          ctx.addIssue({ code: "custom", path: ["referenceBindings", index, "role"], message: "Approval reference bindings must be in canonical role order." });
        }

        if (binding.registryEntry.assetId !== binding.assetId) {
          ctx.addIssue({ code: "custom", path: ["referenceBindings", index, "registryEntry", "assetId"], message: "Registry entry snapshot assetId must equal the binding assetId." });
        }

        if (!characterReferenceAssetIdMatches(binding.assetId, approval.characterId, binding.role)) {
          ctx.addIssue({
            code: "custom",
            path: ["referenceBindings", index, "assetId"],
            message: `Asset ${binding.assetId} does not name ${approval.characterId} ${binding.role}.`,
          });
        }
      });

      addDecisionIssues(approval.defaultStateDecisions, ctx);

      // PREACT_14: no unresolved alternative or conditional wording anywhere in the persisted receipt.
      for (const { path, finding } of collectUnresolvedApprovalWording(
        approval,
        CHARACTER_APPROVAL_FREE_TEXT_KEYS,
        CHARACTER_APPROVAL_CLOSED_VALUE_KEYS,
      )) {
        ctx.addIssue({ code: "custom", path, message: `Approval receipt contains unresolved wording: ${finding}.` });
      }
    });

export type CharacterVisualIdentityApprovalV1 = z.infer<typeof CharacterVisualIdentityApprovalV1Schema>;

export type CharacterDefaultStateDecision = z.infer<typeof CharacterDefaultStateDecisionSchema>;

// Operator request for approve-identity: operational input only, never persisted verbatim. It carries
// coordinates and human resolutions; every trusted value (digests, registry snapshots, approvalId,
// approvedAt, constants) is derived by the creator, so strict parsing rejects any attempt to supply one.
export const CharacterVisualIdentityApprovalRequestV1Schema =
  z.object({
    referenceBindings: z.array(
      z.object({
        role: CharacterVisualReferenceRoleSchema,
        assetId: CharacterReferenceAssetIdSchema,
      }).strict(),
    ).min(1).max(CHARACTER_VISUAL_REFERENCE_ROLES.length),

    defaultStateDecisions: z.array(
      z.object({
        itemKey: CharacterApprovalMachineCodeSchema,
        source: z.object({
          field: CharacterApprovalSourceFieldSchema,
          index: SourceIndexSchema,
        }).strict(),
        disposition: CharacterDefaultStateDispositionSchema,
        // Human input is matched case-insensitively; the creator stores the canonical uppercase code.
        resolutions: z.array(
          z.object({
            attribute: CharacterDefaultStateResolutionAttributeSchema,
            valueCode: z.string().regex(/^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*$/),
          }).strict(),
        ).max(2).optional(),
        approvedDescription: CharacterIdentityTextSchema.max(400).optional(),
      }).strict(),
    ).min(1).max(64),

    acceptanceAttestations: acceptanceObject(z.boolean()),
    operatorNotes: CharacterIdentityTextSchema.optional(),
  }).strict();

export type CharacterVisualIdentityApprovalRequestV1 = z.infer<typeof CharacterVisualIdentityApprovalRequestV1Schema>;
