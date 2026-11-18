import {
  isAbsolute,
  resolve,
} from "node:path";

import {
  EpisodeManifestSchema,
  ShotSchema,
} from "../schemas/episodeManifest.schema.js";

import {
  VisualEvidenceAdoptionSha256Schema,
} from "./visualEvidenceAdoption.schema.js";

// Exactly one deterministic receipt path per (episode, shot, raw manifest,
// observation). A changed manifest or observation names a different receipt;
// nothing is ever discovered by scanning.
export function createVisualEvidenceAdoptionPath(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  manifestRawSha256:
    string,

  observationSha256:
    string,
): string {
  if (
    typeof mediaRoot !== "string" ||
    mediaRoot.length === 0 ||
    mediaRoot.trim() !== mediaRoot ||
    !isAbsolute(
      mediaRoot,
    )
  ) {
    throw new Error(
      "Visual evidence adoption media root must be an absolute path.",
    );
  }

  const validatedEpisodeId =
    EpisodeManifestSchema.shape.episodeId
      .parse(
        episodeId,
      );

  const validatedShotId =
    ShotSchema.shape.id
      .parse(
        shotId,
      );

  const validatedManifest =
    VisualEvidenceAdoptionSha256Schema
      .parse(
        manifestRawSha256,
      );

  const validatedObservation =
    VisualEvidenceAdoptionSha256Schema
      .parse(
        observationSha256,
      );

  return resolve(
    mediaRoot,
    "generated-video",
    validatedEpisodeId,
    validatedShotId,
    "evidence-adoptions",
    `${validatedManifest}_${validatedObservation}.visual-evidence-adoption.json`,
  );
}
