import { z } from "zod";

import {
  CharacterIdSchema,
} from "./character.schema.js";

import {
  GenerationProviderSchema,
} from "./productionRules.schema.js";

export const EpisodeStatusSchema = z.enum([
  "DRAFT",
  "SCRIPT_APPROVED",
  "STORYBOARD_APPROVED",
  "READY_FOR_GENERATION",
  "IN_PRODUCTION",
  "ROUGH_CUT",
  "FINAL_QC",
  "COMPLETE",
]);

export const ApprovalStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

export const ShotTypeSchema = z.enum([
  "ESTABLISHING",
  "ACTION",
  "DIALOGUE",
  "REACTION",
  "CUTAWAY",
  "TRANSITION",
  "MUSICAL",
  "TITLE",
]);

export const ReferenceApprovalStatusSchema = z.enum([
  "NOT_REQUIRED",
  "PENDING",
  "APPROVED",
]);

export const ShotGenerationStatusSchema = z.enum([
  "PLANNED",
  "BLOCKED",
  "READY_FOR_APPROVAL",
  "APPROVED_FOR_GENERATION",
  "GENERATING",
  "GENERATED",
  "REVIEW_REQUIRED",
  "APPROVED",
  "REJECTED",
]);

export const DialogueLineSchema = z.object({
  characterId: CharacterIdSchema,
  text: z.string().trim().min(1),
  deliveryNotes: z.string().trim().min(1).optional(),
}).strict();

export const ShotAudioSchema = z.object({
  ambience: z.string().trim().min(1).optional(),
  sfx: z.array(z.string().trim().min(1)),
  musicIntent: z.string().trim().min(1).optional(),
}).strict();

export const ShotReferencesSchema = z.object({
  required: z.boolean(),
  assetIds: z.array(z.string().trim().min(1)),
  approvalStatus: ReferenceApprovalStatusSchema,
}).strict().superRefine((value, ctx) => {
  if (value.required && value.approvalStatus === "NOT_REQUIRED") {
    ctx.addIssue({
      code: "custom",
      path: ["approvalStatus"],
      message:
        "A required shot reference cannot have NOT_REQUIRED approval status.",
    });
  }

  if (!value.required && value.approvalStatus !== "NOT_REQUIRED") {
    ctx.addIssue({
      code: "custom",
      path: ["approvalStatus"],
      message:
        "A shot with no required reference must use NOT_REQUIRED approval status.",
    });
  }

  if (
    value.approvalStatus === "APPROVED" &&
    value.assetIds.length === 0
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["assetIds"],
      message:
        "An approved required reference must include at least one asset id.",
    });
  }
});

export const ShotGenerationSchema = z.object({
  provider: GenerationProviderSchema,
  nativeAudio: z.boolean(),
  status: ShotGenerationStatusSchema,
  notes: z.string().trim().min(1).optional(),
}).strict();

export const ShotSchema = z.object({
  id: z.string().regex(
    /^S[0-9]{2,3}[A-Z]?$/,
    "Shot id must use the form S01, S032, or S03A.",
  ),

  order: z.number().int().positive(),

  title: z.string().trim().min(1),

  type: ShotTypeSchema,

  durationSeconds: z.number().positive().max(30),

  characters: z.array(CharacterIdSchema),

  visualAction: z.string().trim().min(1),

  camera: z.string().trim().min(1),

  dialogue: z.array(DialogueLineSchema),

  audio: ShotAudioSchema,

  references: ShotReferencesSchema,

  generation: ShotGenerationSchema,

  continuityNotes: z.array(
    z.string().trim().min(1),
  ),
}).strict().superRefine((shot, ctx) => {
  const characterIds = new Set<string>();

  shot.characters.forEach((characterId, index) => {
    if (characterIds.has(characterId)) {
      ctx.addIssue({
        code: "custom",
        path: ["characters", index],
        message: `Duplicate character in shot: ${characterId}`,
      });
    }

    characterIds.add(characterId);
  });

  shot.dialogue.forEach((line, index) => {
    if (!characterIds.has(line.characterId)) {
      ctx.addIssue({
        code: "custom",
        path: ["dialogue", index, "characterId"],
        message:
          `Dialogue speaker ${line.characterId} is not present in shot ${shot.id}.`,
      });
    }
  });
});

export const SceneSchema = z.object({
  id: z.string().regex(
    /^SC[0-9]{2,3}$/,
    "Scene id must use the form SC01.",
  ),

  title: z.string().trim().min(1),

  summary: z.string().trim().min(1),

  shots: z.array(ShotSchema).min(1),
}).strict().superRefine((scene, ctx) => {
  const ids = new Set<string>();

  scene.shots.forEach((shot, index) => {
    if (ids.has(shot.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["shots", index, "id"],
        message:
          `Duplicate shot id within scene ${scene.id}: ${shot.id}`,
      });
    }

    ids.add(shot.id);
  });
});

export const EpisodeApprovalsSchema = z.object({
  script: ApprovalStatusSchema,
  storyboard: ApprovalStatusSchema,
  references: ApprovalStatusSchema,
  roughCut: ApprovalStatusSchema,
  finalQc: ApprovalStatusSchema,
}).strict();

export const EpisodeAudienceSchema = z.object({
  description: z.string().trim().min(1),
  minAgeYears: z.number().int().min(0).max(12),
  maxAgeYears: z.number().int().min(0).max(12),
}).strict().superRefine((value, ctx) => {
  if (value.minAgeYears > value.maxAgeYears) {
    ctx.addIssue({
      code: "custom",
      path: ["maxAgeYears"],
      message:
        "Audience maximum age cannot be lower than minimum age.",
    });
  }
});

export const EpisodeManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),

  episodeId: z.string().regex(
    /^EP[0-9]{2,3}$/,
    "Episode id must use the form EP01.",
  ),

  title: z.string().trim().min(1),

  slug: z.string().regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must contain lowercase letters, numbers, and hyphens only.",
  ),

  status: EpisodeStatusSchema,

  audience: EpisodeAudienceSchema,

  learningGoals: z.array(
    z.string().trim().min(1),
  ).min(1),

  emotionalTheme: z.string().trim().min(1),

  targetDurationSeconds: z.number().int().positive().max(1800),

  approvals: EpisodeApprovalsSchema,

  scenes: z.array(SceneSchema).min(1),
}).strict().superRefine((episode, ctx) => {
  const sceneIds = new Set<string>();
  const shotIds = new Set<string>();
  const shotOrders = new Set<number>();

  const allOrders: number[] = [];

  episode.scenes.forEach((scene, sceneIndex) => {
    if (sceneIds.has(scene.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["scenes", sceneIndex, "id"],
        message: `Duplicate scene id: ${scene.id}`,
      });
    }

    sceneIds.add(scene.id);

    scene.shots.forEach((shot, shotIndex) => {
      if (shotIds.has(shot.id)) {
        ctx.addIssue({
          code: "custom",
          path: [
            "scenes",
            sceneIndex,
            "shots",
            shotIndex,
            "id",
          ],
          message: `Duplicate shot id: ${shot.id}`,
        });
      }

      if (shotOrders.has(shot.order)) {
        ctx.addIssue({
          code: "custom",
          path: [
            "scenes",
            sceneIndex,
            "shots",
            shotIndex,
            "order",
          ],
          message:
            `Duplicate global shot order: ${shot.order}`,
        });
      }

      shotIds.add(shot.id);
      shotOrders.add(shot.order);
      allOrders.push(shot.order);
    });
  });

  const sortedOrders = [...allOrders].sort(
    (a, b) => a - b,
  );

  sortedOrders.forEach((order, index) => {
    const expected = index + 1;

    if (order !== expected) {
      ctx.addIssue({
        code: "custom",
        path: ["scenes"],
        message:
          `Shot order must be continuous from 1. Expected ${expected}, found ${order}.`,
      });
    }
  });
});

export type EpisodeManifest = z.infer<
  typeof EpisodeManifestSchema
>;

export type EpisodeStatus = z.infer<
  typeof EpisodeStatusSchema
>;

export type Shot = z.infer<
  typeof ShotSchema
>;

export type ShotGenerationStatus = z.infer<
  typeof ShotGenerationStatusSchema
>;
