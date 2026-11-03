import {
  createHash,
} from "node:crypto";

import {
  mkdir,
  open,
  readdir,
  readFile,
} from "node:fs/promises";

import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  ExecutionSubmissionSchema,
} from "./executionSubmission.schema.js";

import {
  createExecutionSubmissionPath,
} from "./executionSubmissionPath.js";

import {
  GoogleGenAiProviderExecutionClaimSchema,
  type GoogleGenAiProviderExecutionClaim,
} from "./googleGenAiProviderExecutionClaim.schema.js";

import {
  calculateGoogleGenAiProviderExecutionIdSha256,
  createGoogleGenAiProviderExecutionClaimPath,
} from "./googleGenAiProviderExecutionClaimPath.js";

import {
  readGoogleGenAiProviderExecutionClaim,
} from "./readGoogleGenAiProviderExecutionClaim.js";

import {
  VisualAttemptGoogleGenAiExecutionSubmissionSchema,
} from "./visualAttemptExecutionLifecycle.schema.js";

import {
  createVisualAttemptExecutionSubmissionPath,
} from "./visualAttemptExecutionPaths.js";

export type GoogleGenAiLegacyProviderExecutionClaimOwner =
  Readonly<{
    lifecycleMode:
      "LEGACY";

    provider:
      GoogleGenAiProviderExecutionClaim[
        "provider"
      ];

    providerExecutionId:
      string;

    episodeId:
      string;

    shotId:
      string;

    reservationId:
      string;

    submissionPath:
      string;
  }>;

export type GoogleGenAiVisualAttemptProviderExecutionClaimOwner =
  Readonly<{
    lifecycleMode:
      "VISUAL_ATTEMPT";

    provider:
      GoogleGenAiProviderExecutionClaim[
        "provider"
      ];

    providerExecutionId:
      string;

    episodeId:
      string;

    sceneId:
      string;

    shotId:
      string;

    attemptNumber:
      number;

    admissionId:
      string;

    admissionSha256:
      string;

    reservationId:
      string;

    reservationSha256:
      string;

    submissionPath:
      string;
  }>;

export type GoogleGenAiProviderExecutionClaimOwner =
  | GoogleGenAiLegacyProviderExecutionClaimOwner
  | GoogleGenAiVisualAttemptProviderExecutionClaimOwner;

export type ClaimGoogleGenAiProviderExecutionIdDependencies =
  Readonly<{
    now?:
      () => string;
  }>;

export type ClaimGoogleGenAiProviderExecutionIdResult =
  Readonly<{
    record:
      GoogleGenAiProviderExecutionClaim;

    claimPath:
      string;

    claimSha256:
      string;

    reused:
      boolean;
  }>;

function errorCode(
  error:
    unknown,
): string | null {
  if (
    typeof error !==
      "object" ||
    error ===
      null ||
    !(
      "code" in
      error
    )
  ) {
    return null;
  }

  const code =
    (
      error as {
        code?:
          unknown;
      }
    ).code;

  return typeof code ===
    "string"
    ? code
    : null;
}

function canonicalRelativeSubmissionPath(
  mediaRoot:
    string,

  submissionPath:
    string,
): string {
  if (
    !isAbsolute(
      mediaRoot,
    ) ||
    !isAbsolute(
      submissionPath,
    )
  ) {
    throw new Error(
      "Google GenAI provider execution claim requires absolute mediaRoot and submission paths.",
    );
  }

  const canonicalRoot =
    resolve(
      mediaRoot,
    );

  const canonicalSubmissionPath =
    resolve(
      submissionPath,
    );

  const relativePath =
    relative(
      canonicalRoot,
      canonicalSubmissionPath,
    );

  if (
    relativePath.length ===
      0 ||
    relativePath ===
      ".." ||
    relativePath.startsWith(
      ".." +
        sep,
    ) ||
    isAbsolute(
      relativePath,
    )
  ) {
    throw new Error(
      "Google GenAI provider execution claim submission path must be strictly inside mediaRoot.",
    );
  }

  return relativePath
    .split(
      sep,
    )
    .join(
      "/",
    );
}

function serializeClaim(
  record:
    GoogleGenAiProviderExecutionClaim,
): string {
  return JSON.stringify(
    record,
    null,
    2,
  ) +
    "\n";
}

function claimSha256(
  serialized:
    string,
): string {
  return createHash(
    "sha256",
  )
    .update(
      serialized,
      "utf8",
    )
    .digest(
      "hex",
    );
}

function ownerIdentity(
  record:
    GoogleGenAiProviderExecutionClaim,
): string {
  if (
    record.lifecycleMode ===
      "LEGACY"
  ) {
    return JSON.stringify({
      lifecycleMode:
        record.lifecycleMode,

      provider:
        record.provider,

      providerExecutionId:
        record.providerExecutionId,

      episodeId:
        record.episodeId,

      shotId:
        record.shotId,

      reservationId:
        record.reservationId,

      submissionPath:
        record.submissionPath,
    });
  }

  return JSON.stringify({
    lifecycleMode:
      record.lifecycleMode,

    provider:
      record.provider,

    providerExecutionId:
      record.providerExecutionId,

    episodeId:
      record.episodeId,

    sceneId:
      record.sceneId,

    shotId:
      record.shotId,

    attemptNumber:
      record.attemptNumber,

    admissionId:
      record.admissionId,

    admissionSha256:
      record.admissionSha256,

    reservationId:
      record.reservationId,

    reservationSha256:
      record.reservationSha256,

    submissionPath:
      record.submissionPath,
  });
}

function isSameOwner(
  left:
    GoogleGenAiProviderExecutionClaim,

  right:
    GoogleGenAiProviderExecutionClaim,
): boolean {
  return ownerIdentity(
    left,
  ) ===
    ownerIdentity(
      right,
    );
}

async function listSubmissionEvidencePaths(
  directory:
    string,
): Promise<string[]> {
  let entries:
    import("node:fs").Dirent<string>[];

  try {
    entries =
      await readdir(
        directory,
        {
          withFileTypes:
            true,
        },
      );
  } catch (
    error
  ) {
    if (
      errorCode(
        error,
      ) ===
        "ENOENT"
    ) {
      return [];
    }

    throw error;
  }

  const paths:
    string[] =
      [];

  for (
    const entry of entries
  ) {
    const full =
      resolve(
        directory,
        entry.name,
      );

    if (
      entry.isDirectory()
    ) {
      paths.push(
        ...(
          await listSubmissionEvidencePaths(
            full,
          )
        ),
      );

      continue;
    }

    if (
      entry.isSymbolicLink() &&
      entry.name.endsWith(
        ".execution-submission.json",
      )
    ) {
      throw new Error(
        "Google GenAI provider execution claim historical submission evidence must not be a symbolic link: " +
          full,
      );
    }

    if (
      entry.isFile() &&
      entry.name.endsWith(
        ".execution-submission.json",
      )
    ) {
      paths.push(
        full,
      );
    }
  }

  return paths;
}

function parseJson(
  raw:
    string,

  sourcePath:
    string,
): unknown {
  try {
    return JSON.parse(
      raw,
    );
  } catch {
    throw new Error(
      "Malformed durable execution submission evidence blocks Google provider execution claiming: " +
        sourcePath,
    );
  }
}

function looksAttemptAware(
  parsed:
    unknown,
): boolean {
  return (
    typeof parsed ===
      "object" &&
    parsed !==
      null &&
    "attemptNumber" in
      parsed
  );
}

async function historicalOwnerForPath(
  mediaRoot:
    string,

  sourcePath:
    string,

  candidate:
    GoogleGenAiProviderExecutionClaim,
): Promise<
  GoogleGenAiProviderExecutionClaim | null
> {
  const raw =
    await readFile(
      sourcePath,
      "utf8",
    );

  const parsed =
    parseJson(
      raw,
      sourcePath,
    );

  if (
    looksAttemptAware(
      parsed,
    )
  ) {
    const record =
      VisualAttemptGoogleGenAiExecutionSubmissionSchema
        .parse(
          parsed,
        );

    const canonicalPath =
      createVisualAttemptExecutionSubmissionPath(
        mediaRoot,
        record.episodeId,
        record.shotId,
        record.attemptNumber,
      );

    if (
      resolve(
        sourcePath,
      ) !==
        resolve(
          canonicalPath,
        )
    ) {
      throw new Error(
        "Attempt-aware durable submission identity does not match its canonical path: " +
          sourcePath,
      );
    }

    const canonicalBytes =
      JSON.stringify(
        record,
        null,
        2,
      ) +
        "\n";

    if (
      raw !==
        canonicalBytes
    ) {
      throw new Error(
        "Attempt-aware durable submission bytes are not canonical: " +
          sourcePath,
      );
    }

    if (
      record.providerExecutionId !==
        candidate.providerExecutionId
    ) {
      return null;
    }

    return GoogleGenAiProviderExecutionClaimSchema
      .parse({
        schemaVersion:
          "1.0",

        claimedAt:
          candidate.claimedAt,

        provider:
          record.provider,

        providerExecutionId:
          record.providerExecutionId,

        providerExecutionIdSha256:
          candidate.providerExecutionIdSha256,

        lifecycleMode:
          "VISUAL_ATTEMPT",

        episodeId:
          record.episodeId,

        sceneId:
          record.sceneId,

        shotId:
          record.shotId,

        attemptNumber:
          record.attemptNumber,

        admissionId:
          record.admissionId,

        admissionSha256:
          record.admissionSha256,

        reservationId:
          record.reservationId,

        reservationSha256:
          record.reservationSha256,

        submissionPath:
          canonicalRelativeSubmissionPath(
            mediaRoot,
            canonicalPath,
          ),
      });
  }

  const record =
    ExecutionSubmissionSchema
      .parse(
        parsed,
      );

  const canonicalPath =
    createExecutionSubmissionPath(
      mediaRoot,
      record.episodeId,
      record.shotId,
    );

  if (
    resolve(
      sourcePath,
    ) !==
      resolve(
        canonicalPath,
      )
  ) {
    throw new Error(
      "Durable execution submission identity does not match its canonical path: " +
        sourcePath,
    );
  }

  const canonicalBytes =
    JSON.stringify(
      record,
      null,
      2,
    ) +
      "\n";

  if (
    raw !==
      canonicalBytes
  ) {
    throw new Error(
      "Durable execution submission bytes are not canonical: " +
        sourcePath,
    );
  }

  if (
    record.schemaVersion !==
      "1.4"
  ) {
    return null;
  }

  if (
    record.providerExecutionId !==
      candidate.providerExecutionId
  ) {
    return null;
  }

  return GoogleGenAiProviderExecutionClaimSchema
    .parse({
      schemaVersion:
        "1.0",

      claimedAt:
        candidate.claimedAt,

      provider:
        record.provider,

      providerExecutionId:
        record.providerExecutionId,

      providerExecutionIdSha256:
        candidate.providerExecutionIdSha256,

      lifecycleMode:
        "LEGACY",

      episodeId:
        record.episodeId,

      shotId:
        record.shotId,

      reservationId:
        record.reservationId,

      submissionPath:
        canonicalRelativeSubmissionPath(
          mediaRoot,
          canonicalPath,
        ),
    });
}

async function requireNoHistoricalCollision(
  mediaRoot:
    string,

  candidate:
    GoogleGenAiProviderExecutionClaim,
): Promise<void> {
  const generatedVideoRoot =
    resolve(
      mediaRoot,
      "generated-video",
    );

  const submissionPaths =
    await listSubmissionEvidencePaths(
      generatedVideoRoot,
    );

  for (
    const sourcePath of submissionPaths
  ) {
    const historical =
      await historicalOwnerForPath(
        mediaRoot,
        sourcePath,
        candidate,
      );

    if (
      historical ===
        null
    ) {
      continue;
    }

    if (
      !isSameOwner(
        historical,
        candidate,
      )
    ) {
      throw new Error(
        "Google GenAI providerExecutionId is already owned by another durable submission.",
      );
    }
  }
}

export async function claimGoogleGenAiProviderExecutionId(
  mediaRoot:
    string,

  owner:
    GoogleGenAiProviderExecutionClaimOwner,

  dependencies:
    ClaimGoogleGenAiProviderExecutionIdDependencies =
      {},
): Promise<
  ClaimGoogleGenAiProviderExecutionIdResult
> {
  const providerExecutionIdSha256 =
    calculateGoogleGenAiProviderExecutionIdSha256(
      owner.providerExecutionId,
    );

  const submissionPath =
    canonicalRelativeSubmissionPath(
      mediaRoot,
      owner.submissionPath,
    );

  const now =
    dependencies.now ??
    (() =>
      new Date()
        .toISOString());

  const candidate =
    GoogleGenAiProviderExecutionClaimSchema
      .parse(
        owner.lifecycleMode ===
          "LEGACY"
          ? {
              schemaVersion:
                "1.0",

              claimedAt:
                now(),

              provider:
                owner.provider,

              providerExecutionId:
                owner.providerExecutionId,

              providerExecutionIdSha256,

              lifecycleMode:
                "LEGACY",

              episodeId:
                owner.episodeId,

              shotId:
                owner.shotId,

              reservationId:
                owner.reservationId,

              submissionPath,
            }
          : {
              schemaVersion:
                "1.0",

              claimedAt:
                now(),

              provider:
                owner.provider,

              providerExecutionId:
                owner.providerExecutionId,

              providerExecutionIdSha256,

              lifecycleMode:
                "VISUAL_ATTEMPT",

              episodeId:
                owner.episodeId,

              sceneId:
                owner.sceneId,

              shotId:
                owner.shotId,

              attemptNumber:
                owner.attemptNumber,

              admissionId:
                owner.admissionId,

              admissionSha256:
                owner.admissionSha256,

              reservationId:
                owner.reservationId,

              reservationSha256:
                owner.reservationSha256,

              submissionPath,
            },
      );

  await requireNoHistoricalCollision(
    mediaRoot,
    candidate,
  );

  const claimPath =
    createGoogleGenAiProviderExecutionClaimPath(
      mediaRoot,
      candidate.providerExecutionId,
    );

  await mkdir(
    dirname(
      claimPath,
    ),
    {
      recursive:
        true,
    },
  );

  let handle:
    Awaited<
      ReturnType<
        typeof open
      >
    >;

  try {
    handle =
      await open(
        claimPath,
        "wx",
      );
  } catch (
    error
  ) {
    if (
      errorCode(
        error,
      ) !==
        "EEXIST"
    ) {
      throw error;
    }

    const existing =
      await readGoogleGenAiProviderExecutionClaim(
        mediaRoot,
        candidate.providerExecutionId,
      );

    if (
      existing ===
        null
    ) {
      throw new Error(
        "Google GenAI provider execution claim reported EEXIST but no readable claim exists.",
      );
    }

    if (
      !isSameOwner(
        existing.record,
        candidate,
      )
    ) {
      throw new Error(
        "Google GenAI providerExecutionId claim is owned by another durable submission.",
      );
    }

    return Object.freeze({
      record:
        existing.record,

      claimPath:
        existing.claimPath,

      claimSha256:
        existing.claimSha256,

      reused:
        true,
    });
  }

  const serialized =
    serializeClaim(
      candidate,
    );

  try {
    await handle.writeFile(
      serialized,
      "utf8",
    );

    await handle.sync();
  } finally {
    await handle.close();
  }

  return Object.freeze({
    record:
      candidate,

    claimPath,

    claimSha256:
      claimSha256(
        serialized,
      ),

    reused:
      false,
  });
}
