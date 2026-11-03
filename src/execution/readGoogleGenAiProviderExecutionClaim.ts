import {
  createHash,
} from "node:crypto";

import {
  readFile,
} from "node:fs/promises";

import {
  GoogleGenAiProviderExecutionClaimSchema,
  type GoogleGenAiProviderExecutionClaim,
} from "./googleGenAiProviderExecutionClaim.schema.js";

import {
  calculateGoogleGenAiProviderExecutionIdSha256,
  createGoogleGenAiProviderExecutionClaimPath,
} from "./googleGenAiProviderExecutionClaimPath.js";

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

export type GoogleGenAiProviderExecutionClaimEvidence =
  Readonly<{
    record:
      GoogleGenAiProviderExecutionClaim;

    claimPath:
      string;

    claimSha256:
      string;
  }>;

export async function readGoogleGenAiProviderExecutionClaim(
  mediaRoot:
    string,

  providerExecutionId:
    string,
): Promise<
  GoogleGenAiProviderExecutionClaimEvidence | null
> {
  const claimPath =
    createGoogleGenAiProviderExecutionClaimPath(
      mediaRoot,
      providerExecutionId,
    );

  let raw:
    string;

  try {
    raw =
      await readFile(
        claimPath,
        "utf8",
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
      return null;
    }

    throw error;
  }

  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        raw,
      );
  } catch {
    throw new Error(
      "Google GenAI provider execution claim contains invalid JSON: " +
        claimPath,
    );
  }

  const record =
    GoogleGenAiProviderExecutionClaimSchema
      .parse(
        parsed,
      );

  if (
    record.providerExecutionId !==
      providerExecutionId
  ) {
    throw new Error(
      "Google GenAI provider execution claim identity does not match its canonical providerExecutionId path.",
    );
  }

  const expectedSha256 =
    calculateGoogleGenAiProviderExecutionIdSha256(
      providerExecutionId,
    );

  if (
    record.providerExecutionIdSha256 !==
      expectedSha256
  ) {
    throw new Error(
      "Google GenAI provider execution claim providerExecutionId SHA-256 does not match its canonical path.",
    );
  }

  const canonical =
    JSON.stringify(
      record,
      null,
      2,
    ) +
    "\n";

  if (
    raw !==
      canonical
  ) {
    throw new Error(
      "Google GenAI provider execution claim bytes are not canonical.",
    );
  }

  const claimSha256 =
    createHash(
      "sha256",
    )
      .update(
        raw,
        "utf8",
      )
      .digest(
        "hex",
      );

  return Object.freeze({
    record,
    claimPath,
    claimSha256,
  });
}
