import { z } from "zod";

import {
  EpisodeManifestSchema,
  ShotSchema,
} from "../schemas/episodeManifest.schema.js";

import {
  bindingDigest,
  canonicalBindingJson,
  type BoundEpisodePreflight,
  type ObservationBinding,
  type ShotPreflight,
  type Target,
} from "./boundEpisodeProduction.types.js";

import {
  buildBoundEpisodePreflight,
} from "./buildBoundEpisodePreflight.js";

import {
  createVisualEvidenceAdoption,
} from "./createVisualEvidenceAdoption.js";

import {
  readEpisodeRuntimeIdentity,
} from "./episodeInputBinding.js";

import {
  readVisualEvidenceAdoptionEvidence,
} from "./readVisualEvidenceAdoption.js";

import {
  VisualEvidenceAdoptionSha256Schema,
  type VisualEvidenceAdoption,
} from "./visualEvidenceAdoption.schema.js";

// The application boundary for durable HUMAN_OPERATOR adoption of one VERIFIED
// COMPLETED visual output. It is evidence-only: it reads the production
// runtime identity and a fresh local preflight, writes exactly one create-once
// receipt, and calls no provider, transaction runner, reservation, guard or
// plan executor. Scene and order come from the canonical episode, never from
// the caller.

export type VisualEvidenceAdoptionRefusal =
  | "PREFLIGHT_UNAVAILABLE"
  | "SHOT_NOT_FOUND"
  | "SHOT_NOT_COMPLETED"
  | "COMPLETION_NOT_VERIFIED"
  | "DURABLE_PROVIDER_MISSING"
  | "EVIDENCE_NOT_UNATTESTED"
  | "MANIFEST_MISMATCH"
  | "OBSERVATION_MISMATCH"
  | "POST_ADOPTION_STATE_UNRESOLVED";

export class VisualEvidenceAdoptionError extends Error {
  readonly code:
    VisualEvidenceAdoptionRefusal;

  // True only after the immutable receipt was published.
  readonly receiptWritten:
    boolean;

  constructor(
    code:
      VisualEvidenceAdoptionRefusal,

    receiptWritten = false,
  ) {
    super(
      receiptWritten
        ? `Visual evidence adoption receipt was written, but post-adoption verification failed (${code}).`
        : `Visual evidence adoption refused (${code}); no receipt was written.`,
    );

    this.name =
      "VisualEvidenceAdoptionError";

    this.code =
      code;

    this.receiptWritten =
      receiptWritten;
  }
}

// Operator authority is exactly the episode, shot and both expected digests.
// The environment fields are the process context, not review authority.
const AdoptCompletedVisualEvidenceInputSchema =
  z.object({
    episodeId:
      EpisodeManifestSchema.shape.episodeId,

    shotId:
      ShotSchema.shape.id,

    expectedManifestRawSha256:
      VisualEvidenceAdoptionSha256Schema,

    expectedObservationSha256:
      VisualEvidenceAdoptionSha256Schema,

    repositoryRoot:
      z.string()
        .min(1),

    mediaRoot:
      z.string()
        .min(1),

    ffprobeExecutable:
      z.string()
        .min(1)
        .optional(),
  })
    .strict();

export type AdoptCompletedVisualEvidenceInput =
  z.input<
    typeof AdoptCompletedVisualEvidenceInputSchema
  >;

export type AdoptCompletedVisualEvidenceDependencies =
  Readonly<{
    readRuntimeIdentity:
      typeof readEpisodeRuntimeIdentity;

    buildPreflight:
      typeof buildBoundEpisodePreflight;

    createAdoption:
      typeof createVisualEvidenceAdoption;

    readAdoption:
      typeof readVisualEvidenceAdoptionEvidence;

    now?:
      () => string;

    createAdoptionId?:
      () => string;
  }>;

const productionDependencies:
  AdoptCompletedVisualEvidenceDependencies =
    Object.freeze({
      readRuntimeIdentity:
        readEpisodeRuntimeIdentity,

      buildPreflight:
        buildBoundEpisodePreflight,

      createAdoption:
        createVisualEvidenceAdoption,

      readAdoption:
        readVisualEvidenceAdoptionEvidence,
    });

export type AdoptCompletedVisualEvidenceResult =
  Readonly<{
    receipt:
      VisualEvidenceAdoption;

    adoptionPath:
      string;

    adoptionSha256:
      string;

    target:
      Target;

    postAdoptionPreflight:
      BoundEpisodePreflight;
  }>;

function manifestRawSha256Of(
  preflight:
    BoundEpisodePreflight,
): string | null {
  const manifests =
    preflight.binding?.fileBindings.filter(
      (file) =>
        file.role ===
        "MANIFEST",
    ) ?? [];

  const manifest =
    manifests.length ===
    1
      ? manifests[0]!
      : null;

  return manifest?.exists === true &&
    typeof manifest.rawSha256 ===
      "string"
    ? manifest.rawSha256
    : null;
}

function exactlyOne<T>(
  rows:
    readonly T[],
): T | null {
  return rows.length ===
    1
    ? rows[0]!
    : null;
}

function shotRow(
  preflight:
    BoundEpisodePreflight,

  shotId:
    string,
): ShotPreflight | null {
  return exactlyOne(
    preflight.shots.filter(
      (row) =>
        row.shotId ===
        shotId,
    ),
  );
}

function observationOf(
  preflight:
    BoundEpisodePreflight,

  shotId:
    string,
): ObservationBinding | null {
  return exactlyOne(
    preflight.observations.filter(
      (row) =>
        row.target.shotId ===
        shotId,
    ),
  );
}

export async function adoptCompletedVisualEvidence(
  input:
    AdoptCompletedVisualEvidenceInput,

  dependencies:
    AdoptCompletedVisualEvidenceDependencies =
      productionDependencies,
): Promise<AdoptCompletedVisualEvidenceResult> {
  // Strict: a caller sceneId, order, provider or anything else is rejected
  // before any read.
  const validated =
    AdoptCompletedVisualEvidenceInputSchema
      .parse(
        input,
      );

  const runtimeIdentity =
    await dependencies.readRuntimeIdentity(
      validated.repositoryRoot,
      validated.mediaRoot,
      validated.ffprobeExecutable,
    );

  // Exactly the production preflight inputs; never a caller-supplied
  // transient evidence adoption.
  const preflightInput =
    Object.freeze({
      episodeId:
        validated.episodeId,

      mediaRoot:
        validated.mediaRoot,

      runtimeIdentity,

      ...(validated.ffprobeExecutable
        ? {
            ffprobeExecutable:
              validated.ffprobeExecutable,
          }
        : {}),
    });

  const before =
    await dependencies.buildPreflight(
      preflightInput,
    );

  // A load-level failure (target null) or any failure on this shot leaves the
  // evidence unestablished.
  if (
    before.binding ===
      null ||
    before.inventory.fatalReasons.some(
      (issue) =>
        issue.target ===
          null ||
        issue.target.shotId ===
          validated.shotId,
    )
  ) {
    throw new VisualEvidenceAdoptionError(
      "PREFLIGHT_UNAVAILABLE",
    );
  }

  const row =
    shotRow(
      before,
      validated.shotId,
    );

  const observation =
    observationOf(
      before,
      validated.shotId,
    );

  if (
    row ===
      null ||
    observation ===
      null
  ) {
    throw new VisualEvidenceAdoptionError(
      "SHOT_NOT_FOUND",
    );
  }

  if (
    row.lifecycle.lifecycle !==
      "COMPLETED" ||
    observation.lifecycle !==
      "COMPLETED"
  ) {
    throw new VisualEvidenceAdoptionError(
      "SHOT_NOT_COMPLETED",
    );
  }

  // A failed local verification leaves lifecycle COMPLETED with an ERROR
  // disposition; it is reported as unverified, never adopted.
  if (
    row.completionVerification !==
    "VERIFIED"
  ) {
    throw new VisualEvidenceAdoptionError(
      "COMPLETION_NOT_VERIFIED",
    );
  }

  if (
    row.disposition !==
    "COMPLETED"
  ) {
    throw new VisualEvidenceAdoptionError(
      "SHOT_NOT_COMPLETED",
    );
  }

  if (
    row.durableProvider ===
      null ||
    observation.durableProvider ===
      null
  ) {
    throw new VisualEvidenceAdoptionError(
      "DURABLE_PROVIDER_MISSING",
    );
  }

  if (
    row.intentAlignment !==
    "UNATTESTED_EXISTING_EVIDENCE"
  ) {
    throw new VisualEvidenceAdoptionError(
      "EVIDENCE_NOT_UNATTESTED",
    );
  }

  const manifestRawSha256 =
    manifestRawSha256Of(
      before,
    );

  if (
    manifestRawSha256 ===
      null ||
    manifestRawSha256 !==
      validated.expectedManifestRawSha256
  ) {
    throw new VisualEvidenceAdoptionError(
      "MANIFEST_MISMATCH",
    );
  }

  const observationSha256 =
    bindingDigest(
      observation,
    );

  if (
    observationSha256 !==
      validated.expectedObservationSha256 ||
    bindingDigest(
      row.lifecycle,
    ) !==
      observationSha256
  ) {
    throw new VisualEvidenceAdoptionError(
      "OBSERVATION_MISMATCH",
    );
  }

  // Scene and order are the canonical episode's, never the caller's.
  const target: Target =
    Object.freeze({
      episodeId:
        validated.episodeId,

      sceneId:
        row.sceneId,

      shotId:
        row.shotId,

      order:
        row.order,
    });

  if (
    canonicalBindingJson(
      observation.target,
    ) !==
    canonicalBindingJson(
      target,
    )
  ) {
    throw new VisualEvidenceAdoptionError(
      "OBSERVATION_MISMATCH",
    );
  }

  const written =
    await dependencies.createAdoption(
      validated.mediaRoot,
      {
        target,
        manifestRawSha256,
        observationSha256,
      },
      {
        ...(dependencies.now
          ? {
              now:
                dependencies.now,
            }
          : {}),

        ...(dependencies.createAdoptionId
          ? {
              createAdoptionId:
                dependencies.createAdoptionId,
            }
          : {}),
      },
    );

  const post =
    (
      code:
        VisualEvidenceAdoptionRefusal = "POST_ADOPTION_STATE_UNRESOLVED",
    ): VisualEvidenceAdoptionError =>
      new VisualEvidenceAdoptionError(
        code,
        true,
      );

  const readBack =
    await dependencies.readAdoption(
      validated.mediaRoot,
      {
        episodeId:
          target.episodeId,

        shotId:
          target.shotId,

        manifestRawSha256,

        observationSha256,
      },
    );

  if (
    readBack ===
      null ||
    readBack.adoptionPath !==
      written.adoptionPath ||
    readBack.adoptionSha256 !==
      written.adoptionSha256 ||
    canonicalBindingJson(
      readBack.record,
    ) !==
      canonicalBindingJson(
        written.record,
      )
  ) {
    throw post();
  }

  // A fresh preflight with no transient adoption must discover the receipt
  // on its own and bind its exact bytes.
  const after =
    await dependencies.buildPreflight(
      preflightInput,
    );

  const afterRow =
    shotRow(
      after,
      target.shotId,
    );

  const afterObservation =
    observationOf(
      after,
      target.shotId,
    );

  const boundReceipts =
    after.binding?.fileBindings.filter(
      (file) =>
        file.role ===
        `EVIDENCE_ADOPTION:${target.shotId}`,
    ) ?? [];

  const boundReceipt =
    exactlyOne(
      boundReceipts,
    );

  if (
    afterRow ===
      null ||
    afterObservation ===
      null ||
    afterRow.lifecycle.lifecycle !==
      "COMPLETED" ||
    afterRow.disposition !==
      "COMPLETED" ||
    afterRow.completionVerification !==
      "VERIFIED" ||
    afterRow.intentAlignment !==
      "REVIEWED" ||
    manifestRawSha256Of(
      after,
    ) !==
      manifestRawSha256 ||
    bindingDigest(
      afterObservation,
    ) !==
      observationSha256 ||
    boundReceipt ===
      null ||
    !boundReceipt.exists ||
    boundReceipt.canonicalPath !==
      written.adoptionPath ||
    boundReceipt.rawSha256 !==
      written.adoptionSha256
  ) {
    throw post();
  }

  return Object.freeze({
    receipt:
      readBack.record,

    adoptionPath:
      written.adoptionPath,

    adoptionSha256:
      written.adoptionSha256,

    target,

    postAdoptionPreflight:
      after,
  });
}
