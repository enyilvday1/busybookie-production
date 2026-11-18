import { createHash } from "node:crypto";

import { z } from "zod";

import {
  EpisodeManifestSchema,
  SceneSchema,
  ShotSchema,
} from "../schemas/episodeManifest.schema.js";

// Durable HUMAN_OPERATOR review of one VERIFIED COMPLETED visual output.
// The receipt is evidence only: it binds an exact target, the exact raw
// episode manifest and the exact current observation digest, and carries no
// provider identity, credential, task URL, response or free text.

export const VISUAL_EVIDENCE_ADOPTION_MAX_BYTES =
  64 * 1024;

export const VisualEvidenceAdoptionSha256Schema =
  z.string()
    .regex(
      /^[a-f0-9]{64}$/,
      "Expected a lowercase SHA-256 digest.",
    );

export const VisualEvidenceAdoptionTargetSchema =
  z.object({
    episodeId:
      EpisodeManifestSchema.shape.episodeId,

    sceneId:
      SceneSchema.shape.id,

    shotId:
      ShotSchema.shape.id,

    order:
      ShotSchema.shape.order,
  })
    .strict();

export const VisualEvidenceAdoptionInputSchema =
  z.object({
    target:
      VisualEvidenceAdoptionTargetSchema,

    manifestRawSha256:
      VisualEvidenceAdoptionSha256Schema,

    observationSha256:
      VisualEvidenceAdoptionSha256Schema,
  })
    .strict();

export const VisualEvidenceAdoptionSchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    recordType:
      z.literal(
        "VISUAL_EVIDENCE_ADOPTION",
      ),

    adoptionId:
      z.string()
        .uuid(),

    adoptedAt:
      z.string()
        .datetime(),

    status:
      z.literal(
        "ADOPTED",
      ),

    target:
      VisualEvidenceAdoptionTargetSchema,

    manifestRawSha256:
      VisualEvidenceAdoptionSha256Schema,

    observationSha256:
      VisualEvidenceAdoptionSha256Schema,

    reviewScope:
      z.literal(
        "VISUAL_OUTPUT",
      ),

    authorizationSource:
      z.literal(
        "HUMAN_OPERATOR",
      ),

    activationEffect:
      z.literal(
        "NONE_EVIDENCE_ONLY",
      ),
  })
    .strict();

export type VisualEvidenceAdoptionTarget =
  z.infer<
    typeof VisualEvidenceAdoptionTargetSchema
  >;

export type VisualEvidenceAdoptionInput =
  z.infer<
    typeof VisualEvidenceAdoptionInputSchema
  >;

export type VisualEvidenceAdoption =
  z.infer<
    typeof VisualEvidenceAdoptionSchema
  >;

// The exact path identity of one receipt.
export type VisualEvidenceAdoptionIdentity =
  Readonly<{
    episodeId:
      string;

    shotId:
      string;

    manifestRawSha256:
      string;

    observationSha256:
      string;
  }>;

// The single canonical byte encoding shared by writer, reader and preflight.
export function serializeVisualEvidenceAdoption(
  record:
    VisualEvidenceAdoption,
): string {
  return `${JSON.stringify(
    VisualEvidenceAdoptionSchema.parse(
      record,
    ),
    null,
    2,
  )}\n`;
}

export function calculateVisualEvidenceAdoptionSha256(
  bytes:
    string | Uint8Array,
): string {
  return createHash(
    "sha256",
  )
    .update(
      bytes,
    )
    .digest(
      "hex",
    );
}
