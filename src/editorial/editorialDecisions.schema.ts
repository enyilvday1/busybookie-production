import { z } from "zod";
import { EpisodeManifestSchema, ShotSchema } from "../schemas/episodeManifest.schema.js";
import type { EditorialReadonly } from "./editorialPlan.schema.js";

const safeInteger = z.number().refine((n) => Number.isSafeInteger(n) && !Object.is(n, -0), "Expected a safe integer.");
const frame = safeInteger.refine((n) => n >= 0, "Expected a non-negative frame.");
const positiveFrames = safeInteger.refine((n) => n > 0, "Expected a positive frame count.");
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const shotId = ShotSchema.shape.id;

// Binds explicit frame decisions to the exact source revision they were authored against.
export const EditorialDecisionsShotAssetSchema = z.object({
  shotId, normalizedAssetSha256: sha,
}).strict();

export const EditorialDecisionsSourceBindingSchema = z.object({
  manifestSha256: sha,
  shotAssets: z.array(EditorialDecisionsShotAssetSchema),
}).strict();

export const EditorialDecisionsClipSchema = z.object({
  shotId, sourceInFrame: frame, sourceOutFrame: frame,
}).strict();

export const EditorialDecisionsTransitionSchema = z.discriminatedUnion("type", [
  z.object({ outgoingShotId: shotId, incomingShotId: shotId, type: z.literal("CUT") }).strict(),
  z.object({
    outgoingShotId: shotId, incomingShotId: shotId, type: z.literal("CROSS_DISSOLVE"), overlapFrames: positiveFrames,
  }).strict(),
]);

export const EditorialDecisionsSchema = z.object({
  schemaVersion: z.literal("1.0"),
  decisionsType: z.literal("BUSYBOOKIE_EDITORIAL_DECISIONS"),
  episodeId: EpisodeManifestSchema.shape.episodeId,
  sourceBinding: EditorialDecisionsSourceBindingSchema,
  clips: z.array(EditorialDecisionsClipSchema),
  transitions: z.array(EditorialDecisionsTransitionSchema),
}).strict();

export type EditorialDecisions = EditorialReadonly<z.infer<typeof EditorialDecisionsSchema>>;
export type EditorialDecisionsTransition = EditorialDecisions["transitions"][number];
