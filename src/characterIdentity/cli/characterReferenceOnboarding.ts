import {
  readFile,
} from "node:fs/promises";

import {
  isAbsolute,
  resolve,
} from "node:path";

import {
  pathToFileURL,
} from "node:url";

import {
  approveCharacterVisualIdentity,
  registerCharacterReferenceAsset,
} from "../onboardCharacterVisualIdentity.js";

import {
  verifyCharacterVisualIdentityApprovalForConsumption,
} from "../verifyCharacterVisualIdentityApprovalForConsumption.js";

import {
  loadCharacterBible,
} from "../../validation/loadCharacterBible.js";

// E9 Step 1137D1 operator CLI. Run with: npx tsx src/characterIdentity/cli/characterReferenceOnboarding.ts
//   register-reference --media-root <abs> --source-file <abs> --asset-id <id> --expected-registry-sha256 <hex>
//   approve-identity --media-root <abs> --character-id <ID> --identity-version <n> --request <request.json>
//   verify-identity --media-root <abs> --character-id <ID>   (read-only consumption verification, Step 1137E)
// --media-root is always explicit: the CLI never reads the environment or defaults to a production media root.

const SUBCOMMAND_FLAGS = {
  "register-reference": ["--media-root", "--source-file", "--asset-id", "--expected-registry-sha256"],
  "approve-identity": ["--media-root", "--character-id", "--identity-version", "--request"],
  "verify-identity": ["--media-root", "--character-id"],
} as const;

type Subcommand = keyof typeof SUBCOMMAND_FLAGS;

export type CharacterReferenceOnboardingCliOptions =
  | Readonly<{
    subcommand: "register-reference";
    mediaRoot: string;
    sourceFile: string;
    assetId: string;
    expectedRegistrySha256: string;
  }>
  | Readonly<{
    subcommand: "approve-identity";
    mediaRoot: string;
    characterId: string;
    identityVersion: number;
    requestPath: string;
  }>
  | Readonly<{
    subcommand: "verify-identity";
    mediaRoot: string;
    characterId: string;
  }>;

function isSubcommand(value: string | undefined): value is Subcommand {
  return value === "register-reference" || value === "approve-identity" || value === "verify-identity";
}

export function parseCharacterReferenceOnboardingCliArgs(
  args: readonly string[],
): CharacterReferenceOnboardingCliOptions {
  const [subcommand, ...rest] = args;

  if (!isSubcommand(subcommand)) {
    throw new Error(
      `Unknown character reference onboarding subcommand: ${subcommand ?? "(none)"}. Use register-reference, approve-identity or verify-identity.`,
    );
  }

  const allowed: readonly string[] = SUBCOMMAND_FLAGS[subcommand];
  const values = new Map<string, string>();

  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index]!;

    if (!allowed.includes(flag)) {
      throw new Error(`Unknown ${subcommand} argument: ${flag}`);
    }

    if (values.has(flag)) {
      throw new Error(`Duplicate ${subcommand} argument: ${flag}`);
    }

    const value = rest[index + 1]?.trim();

    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }

    values.set(flag, value);
  }

  const required = (flag: string): string => {
    const value = values.get(flag);

    if (!value) {
      throw new Error(`${subcommand} requires ${flag}.`);
    }

    return value;
  };

  const mediaRoot = required("--media-root");

  if (!isAbsolute(mediaRoot)) {
    throw new Error("--media-root must be an absolute path.");
  }

  if (subcommand === "register-reference") {
    return Object.freeze({
      subcommand,
      mediaRoot,
      sourceFile: required("--source-file"),
      assetId: required("--asset-id"),
      expectedRegistrySha256: required("--expected-registry-sha256"),
    });
  }

  if (subcommand === "verify-identity") {
    return Object.freeze({
      subcommand,
      mediaRoot,
      characterId: required("--character-id"),
    });
  }

  const versionText = required("--identity-version");

  if (!/^[1-9][0-9]*$/.test(versionText) || !Number.isSafeInteger(Number(versionText))) {
    throw new Error("--identity-version must be a positive integer.");
  }

  return Object.freeze({
    subcommand,
    mediaRoot,
    characterId: required("--character-id"),
    identityVersion: Number(versionText),
    requestPath: required("--request"),
  });
}

export type RunCharacterReferenceOnboardingCliDependencies =
  Readonly<{
    registerReference: typeof registerCharacterReferenceAsset;
    approveIdentity: typeof approveCharacterVisualIdentity;
    verifyIdentity: typeof verifyCharacterVisualIdentityApprovalForConsumption;
    loadCharacterBible: () => Promise<unknown>;
    readRequest: (path: string) => Promise<unknown>;
    log: (line: string) => void;
  }>;

async function readRequestJson(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Approval request contains malformed JSON: ${path}`, { cause: error });
  }
}

const defaultDependencies: RunCharacterReferenceOnboardingCliDependencies = Object.freeze({
  registerReference: registerCharacterReferenceAsset,
  approveIdentity: approveCharacterVisualIdentity,
  verifyIdentity: verifyCharacterVisualIdentityApprovalForConsumption,
  loadCharacterBible: () => loadCharacterBible(),
  readRequest: readRequestJson,
  log: (line: string) => console.log(line),
});

export async function runCharacterReferenceOnboardingCli(
  args: readonly string[],
  dependencies: RunCharacterReferenceOnboardingCliDependencies = defaultDependencies,
): Promise<void> {
  const options = parseCharacterReferenceOnboardingCliArgs(args);

  if (options.subcommand === "register-reference") {
    const result = await dependencies.registerReference({
      mediaRoot: options.mediaRoot,
      sourceFile: options.sourceFile,
      assetId: options.assetId,
      expectedRegistrySha256: options.expectedRegistrySha256,
    });

    dependencies.log(JSON.stringify({
      result: "REFERENCE_REGISTERED",
      entry: result.entry,
      registryPath: result.registryPath,
      previousRegistrySha256: result.previousRegistrySha256,
      registrySha256: result.registrySha256,
    }, null, 2));

    return;
  }

  if (options.subcommand === "verify-identity") {
    // Read-only: no receipt, registry, asset, lock or CharacterBible write. Failure throws (non-zero exit).
    const verified = await dependencies.verifyIdentity({
      mediaRoot: options.mediaRoot,
      bible: await dependencies.loadCharacterBible(),
      characterId: options.characterId,
    });

    dependencies.log(JSON.stringify({
      result: verified.result,
      characterId: verified.characterId,
      identityVersion: verified.identityVersion,
      approvalId: verified.approvalId,
      receiptRelativePath: verified.receiptRelativePath,
      receiptSha256: verified.receiptSha256,
      masterAssetId: verified.masterAssetId,
      registryEntries: verified.registryEntries,
      physicalVerification: verified.physicalVerification,
      historicalSourceCharacterBible: verified.historicalSourceCharacterBible,
      historicalSourceDigestEqualityRequired: verified.historicalSourceDigestEqualityRequired,
      currentCharacterBibleCanonicalSha256: verified.currentCharacterBibleCanonicalSha256,
      traitDecisionEvidence: verified.traitDecisionEvidence,
    }, null, 2));

    return;
  }

  // The request is operational input only; the creator derives every trusted value and persists the receipt.
  const request = await dependencies.readRequest(options.requestPath);

  const result = await dependencies.approveIdentity({
    mediaRoot: options.mediaRoot,
    characterId: options.characterId,
    targetIdentityVersion: options.identityVersion,
    request,
  });

  dependencies.log(JSON.stringify({
    result: "IDENTITY_APPROVAL_RECORDED",
    approvalId: result.record.approvalId,
    characterId: result.record.characterId,
    targetIdentityVersion: result.record.targetIdentityVersion,
    approvalPath: result.approvalPath,
    approvalSha256: result.approvalSha256,
    activationEffect: result.record.activationEffect,
  }, null, 2));
}

const invokedPath = process.argv[1];

if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  runCharacterReferenceOnboardingCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
