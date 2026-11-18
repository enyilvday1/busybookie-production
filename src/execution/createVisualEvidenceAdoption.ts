import {
  randomUUID,
} from "node:crypto";

import {
  constants,
} from "node:fs";

import {
  copyFile,
  mkdir,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
} from "node:path";

import {
  canonicalBindingJson,
} from "./boundEpisodeProduction.types.js";

import {
  requireLinkSafeContainedPath,
} from "./episodeInputBinding.js";

import {
  readVisualEvidenceAdoptionEvidence,
} from "./readVisualEvidenceAdoption.js";

import {
  VisualEvidenceAdoptionInputSchema,
  VisualEvidenceAdoptionSchema,
  calculateVisualEvidenceAdoptionSha256,
  serializeVisualEvidenceAdoption,
  type VisualEvidenceAdoption,
  type VisualEvidenceAdoptionInput,
} from "./visualEvidenceAdoption.schema.js";

import {
  createVisualEvidenceAdoptionPath,
} from "./visualEvidenceAdoptionPath.js";

export type VisualEvidenceAdoptionWriteDependencies =
  Readonly<{
    now?:
      () => string;

    createAdoptionId?:
      () => string;
  }>;

export type CreateVisualEvidenceAdoptionResult =
  Readonly<{
    record:
      VisualEvidenceAdoption;

    adoptionPath:
      string;

    adoptionSha256:
      string;
  }>;

export class VisualEvidenceAdoptionExistsError extends Error {
  readonly adoptionPath:
    string;

  constructor(
    adoptionPath:
      string,
  ) {
    super(
      `Visual evidence adoption already exists and is never replaced: ${adoptionPath}`,
    );

    this.name =
      "VisualEvidenceAdoptionExistsError";

    this.adoptionPath =
      adoptionPath;
  }
}

// Create-once publication: exclusive temporary file, exclusive copy to the
// canonical path, temporary cleanup, then a strict read-back that must be
// exactly the record and bytes written. An existing receipt is never touched.
export async function createVisualEvidenceAdoption(
  mediaRoot:
    string,

  input:
    VisualEvidenceAdoptionInput,

  dependencies:
    VisualEvidenceAdoptionWriteDependencies = {},
): Promise<CreateVisualEvidenceAdoptionResult> {
  const validatedInput =
    VisualEvidenceAdoptionInputSchema
      .parse(
        input,
      );

  const now =
    dependencies.now ??
    (() =>
      new Date().toISOString());

  const createAdoptionId =
    dependencies.createAdoptionId ??
    randomUUID;

  const record =
    VisualEvidenceAdoptionSchema
      .parse({
        schemaVersion:
          "1.0",

        recordType:
          "VISUAL_EVIDENCE_ADOPTION",

        adoptionId:
          createAdoptionId(),

        adoptedAt:
          now(),

        status:
          "ADOPTED",

        target:
          validatedInput.target,

        manifestRawSha256:
          validatedInput.manifestRawSha256,

        observationSha256:
          validatedInput.observationSha256,

        reviewScope:
          "VISUAL_OUTPUT",

        authorizationSource:
          "HUMAN_OPERATOR",

        activationEffect:
          "NONE_EVIDENCE_ONLY",
      });

  const identity =
    Object.freeze({
      episodeId:
        record.target.episodeId,

      shotId:
        record.target.shotId,

      manifestRawSha256:
        record.manifestRawSha256,

      observationSha256:
        record.observationSha256,
    });

  const adoptionPath =
    createVisualEvidenceAdoptionPath(
      mediaRoot,
      identity.episodeId,
      identity.shotId,
      identity.manifestRawSha256,
      identity.observationSha256,
    );

  // No link or alias may redirect the receipt outside the media root.
  await requireLinkSafeContainedPath(
    mediaRoot,
    adoptionPath,
    true,
  );

  await mkdir(
    dirname(
      adoptionPath,
    ),
    {
      recursive:
        true,
    },
  );

  await requireLinkSafeContainedPath(
    mediaRoot,
    adoptionPath,
    true,
  );

  const serialized =
    serializeVisualEvidenceAdoption(
      record,
    );

  const adoptionSha256 =
    calculateVisualEvidenceAdoptionSha256(
      serialized,
    );

  const temporaryPath =
    `${adoptionPath}.part-${process.pid}-${randomUUID()}`;

  let temporaryCreated =
    false;

  try {
    await writeFile(
      temporaryPath,
      serialized,
      {
        encoding:
          "utf8",

        flag:
          "wx",
      },
    );

    temporaryCreated =
      true;

    try {
      await copyFile(
        temporaryPath,
        adoptionPath,
        constants.COPYFILE_EXCL,
      );
    } catch (error) {
      if (
        (
          error as
            NodeJS.ErrnoException
        ).code ===
        "EEXIST"
      ) {
        throw new VisualEvidenceAdoptionExistsError(
          adoptionPath,
        );
      }

      throw error;
    }
  } finally {
    if (
      temporaryCreated
    ) {
      try {
        await unlink(
          temporaryPath,
        );
      } catch {
        // Preserve the original result or failure.
      }
    }
  }

  const readBack =
    await readVisualEvidenceAdoptionEvidence(
      mediaRoot,
      identity,
    );

  if (
    readBack === null ||
    readBack.adoptionPath !==
      adoptionPath ||
    readBack.adoptionSha256 !==
      adoptionSha256 ||
    canonicalBindingJson(
      readBack.record,
    ) !==
      canonicalBindingJson(
        record,
      )
  ) {
    throw new Error(
      `Visual evidence adoption read-back does not match the published record: ${adoptionPath}`,
    );
  }

  return Object.freeze({
    record:
      readBack.record,

    adoptionPath,

    adoptionSha256,
  });
}
