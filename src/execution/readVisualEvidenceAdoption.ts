import {
  readBoundFile,
} from "./episodeInputBinding.js";

import {
  VISUAL_EVIDENCE_ADOPTION_MAX_BYTES,
  VisualEvidenceAdoptionSchema,
  calculateVisualEvidenceAdoptionSha256,
  serializeVisualEvidenceAdoption,
  type VisualEvidenceAdoption,
  type VisualEvidenceAdoptionIdentity,
} from "./visualEvidenceAdoption.schema.js";

import {
  createVisualEvidenceAdoptionPath,
} from "./visualEvidenceAdoptionPath.js";

export type ReadVisualEvidenceAdoptionEvidence =
  Readonly<{
    record:
      VisualEvidenceAdoption;

    adoptionPath:
      string;

    adoptionSha256:
      string;
  }>;

// Strict: valid UTF-8, the exact schema, the exact canonical byte encoding,
// and an identity equal to the canonical path it was read from.
export function parseVisualEvidenceAdoptionBytes(
  bytes:
    Uint8Array,

  identity:
    VisualEvidenceAdoptionIdentity,
): VisualEvidenceAdoption {
  let text:
    string;

  try {
    text =
      new TextDecoder(
        "utf-8",
        {
          fatal:
            true,
        },
      ).decode(
        bytes,
      );
  } catch {
    throw new Error(
      "Visual evidence adoption is not valid UTF-8.",
    );
  }

  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        text,
      );
  } catch {
    throw new Error(
      "Visual evidence adoption is not valid JSON.",
    );
  }

  const validated =
    VisualEvidenceAdoptionSchema
      .safeParse(
        parsed,
      );

  if (!validated.success) {
    throw new Error(
      "Visual evidence adoption does not match its schema.",
    );
  }

  const record =
    validated.data;

  if (
    text !==
    serializeVisualEvidenceAdoption(
      record,
    )
  ) {
    throw new Error(
      "Visual evidence adoption bytes are not canonical.",
    );
  }

  if (
    record.target.episodeId !==
      identity.episodeId ||
    record.target.shotId !==
      identity.shotId ||
    record.manifestRawSha256 !==
      identity.manifestRawSha256 ||
    record.observationSha256 !==
      identity.observationSha256
  ) {
    throw new Error(
      "Visual evidence adoption identity does not match its canonical path.",
    );
  }

  return record;
}

// One bounded, link-safe optional read of exactly the canonical path.
export async function readVisualEvidenceAdoptionEvidence(
  mediaRoot:
    string,

  identity:
    VisualEvidenceAdoptionIdentity,
): Promise<ReadVisualEvidenceAdoptionEvidence | null> {
  const adoptionPath =
    createVisualEvidenceAdoptionPath(
      mediaRoot,
      identity.episodeId,
      identity.shotId,
      identity.manifestRawSha256,
      identity.observationSha256,
    );

  const read =
    await readBoundFile({
      root:
        mediaRoot,

      canonicalPath:
        adoptionPath,

      role:
        "VISUAL_EVIDENCE_ADOPTION",

      maxBytes:
        VISUAL_EVIDENCE_ADOPTION_MAX_BYTES,

      optional:
        true,
    });

  if (
    !read.binding.exists ||
    read.bytes === null
  ) {
    return null;
  }

  const record =
    parseVisualEvidenceAdoptionBytes(
      read.bytes,
      identity,
    );

  return Object.freeze({
    record,

    adoptionPath,

    adoptionSha256:
      calculateVisualEvidenceAdoptionSha256(
        read.bytes,
      ),
  });
}

export async function readVisualEvidenceAdoption(
  mediaRoot:
    string,

  identity:
    VisualEvidenceAdoptionIdentity,
): Promise<VisualEvidenceAdoption | null> {
  return (
    await readVisualEvidenceAdoptionEvidence(
      mediaRoot,
      identity,
    )
  )?.record ??
    null;
}
