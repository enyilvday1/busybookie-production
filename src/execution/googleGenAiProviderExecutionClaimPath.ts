import {
  createHash,
} from "node:crypto";

import {
  isAbsolute,
  resolve,
} from "node:path";

import {
  GoogleGenAiExecutionSubmissionV1_4Schema,
} from "./executionSubmission.schema.js";

const CLAIM_DIRECTORY =
  ".google-genai-provider-execution-id-claims";

export function calculateGoogleGenAiProviderExecutionIdSha256(
  providerExecutionId:
    string,
): string {
  const validated =
    GoogleGenAiExecutionSubmissionV1_4Schema
      .shape
      .providerExecutionId
      .parse(
        providerExecutionId,
      );

  return createHash(
    "sha256",
  )
    .update(
      validated,
      "utf8",
    )
    .digest(
      "hex",
    );
}

export function createGoogleGenAiProviderExecutionClaimPath(
  mediaRoot:
    string,

  providerExecutionId:
    string,
): string {
  if (
    typeof mediaRoot !==
      "string" ||
    mediaRoot.trim().length ===
      0 ||
    !isAbsolute(
      mediaRoot,
    )
  ) {
    throw new Error(
      "Google GenAI provider execution claim mediaRoot must be an absolute path.",
    );
  }

  const providerExecutionIdSha256 =
    calculateGoogleGenAiProviderExecutionIdSha256(
      providerExecutionId,
    );

  return resolve(
    mediaRoot,
    "generated-video",
    CLAIM_DIRECTORY,
    providerExecutionIdSha256 +
      ".json",
  );
}
