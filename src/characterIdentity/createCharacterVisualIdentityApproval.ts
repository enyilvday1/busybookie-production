import {
  createHash,
  randomUUID,
} from "node:crypto";

import {
  constants,
} from "node:fs";

import {
  copyFile,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
} from "node:path";

import {
  canonicalCharacterIdentityJson,
} from "./canonicalCharacterIdentityJson.js";

import {
  CHARACTER_REFERENCE_ACCEPTANCE_RULES,
  CharacterVisualIdentityApprovalRequestV1Schema,
  CharacterVisualIdentityApprovalV1Schema,
  type CharacterVisualIdentityApprovalV1,
} from "./characterVisualIdentityApproval.schema.js";

import {
  createCharacterVisualIdentityApprovalPath,
} from "./characterVisualIdentityApprovalPath.js";

import {
  computeCharacterBibleCanonicalSha256,
  computeExactSourceTextSha256,
  resolveCharacterApprovalSourceText,
  selectCharacterApprovalAlternative,
} from "./characterVisualIdentityApprovalSource.js";

import {
  readCharacterVisualIdentityApproval,
} from "./readCharacterVisualIdentityApproval.js";

import {
  validateCharacterVisualIdentityApproval,
} from "./validateCharacterVisualIdentityApproval.js";

import {
  CharacterBibleSchema,
} from "../schemas/character.schema.js";

import {
  CharacterIdSchema,
} from "../schemas/characterId.schema.js";

import {
  CharacterIdentityVersionSchema,
  compareCharacterVisualReferenceRoles,
} from "../schemas/characterVisualIdentity.schema.js";

import {
  readVisualReferenceAssetRegistry,
} from "../execution/readVisualReferenceAssetRegistry.js";

import {
  verifyApprovedVisualReferenceAsset,
} from "../execution/verifyApprovedVisualReferenceAsset.js";

export type CreateCharacterVisualIdentityApprovalInput =
  Readonly<{
    bible: unknown;
    characterId: string;
    targetIdentityVersion: number;
    // Operator request: coordinates and human resolutions only (CharacterVisualIdentityApprovalRequestV1).
    request: unknown;
  }>;

export type CreateCharacterVisualIdentityApprovalDependencies =
  Readonly<{
    now?: () => string;
    createApprovalId?: () => string;
    readRegistry?: typeof readVisualReferenceAssetRegistry;
    verifyAsset?: typeof verifyApprovedVisualReferenceAsset;
  }>;

export type CreateCharacterVisualIdentityApprovalResult =
  Readonly<{
    record: CharacterVisualIdentityApprovalV1;
    approvalPath: string;
    approvalSha256: string;
  }>;

function blocked(detail: string): never {
  throw new Error(`Character visual identity approval blocked: ${detail} No approval was written.`);
}

// Production publication boundary: builds the receipt from the human request plus trusted derived evidence,
// validates it against the CharacterBible, live registry and physical bytes, then publishes it create-once.
// An existing receipt is never replaced; a changed decision needs a new targetIdentityVersion.
export async function createCharacterVisualIdentityApproval(
  mediaRoot: string,
  input: CreateCharacterVisualIdentityApprovalInput,
  dependencies: CreateCharacterVisualIdentityApprovalDependencies = {},
): Promise<CreateCharacterVisualIdentityApprovalResult> {
  const characterId = CharacterIdSchema.parse(input.characterId);
  const targetIdentityVersion = CharacterIdentityVersionSchema.parse(input.targetIdentityVersion);
  const approvalPath = createCharacterVisualIdentityApprovalPath(mediaRoot, characterId, targetIdentityVersion);

  const requestResult = CharacterVisualIdentityApprovalRequestV1Schema.safeParse(input.request);

  if (!requestResult.success) {
    blocked(`operator request is invalid: ${requestResult.error.message}`);
  }

  const request = requestResult.data;

  const bibleResult = CharacterBibleSchema.safeParse(input.bible);

  if (!bibleResult.success) {
    blocked(`CharacterBible is invalid: ${bibleResult.error.message}`);
  }

  const bible = bibleResult.data;

  const character = bible.characters.find((candidate) => candidate.id === characterId) ??
    blocked(`character ${characterId} is not in the CharacterBible.`);

  const unconfirmed = CHARACTER_REFERENCE_ACCEPTANCE_RULES.filter((rule) => request.acceptanceAttestations[rule] !== true);

  if (unconfirmed.length > 0) {
    blocked(`human acceptance not confirmed for ${unconfirmed.join(", ")}.`);
  }

  const registry = await (dependencies.readRegistry ?? readVisualReferenceAssetRegistry)(mediaRoot);

  const referenceBindings = [...request.referenceBindings]
    .sort((left, right) => compareCharacterVisualReferenceRoles(left.role, right.role))
    .map((binding) => {
      const live = registry.assets.find((asset) => asset.assetId === binding.assetId) ??
        blocked(`${binding.role} asset ${binding.assetId} is not registered.`);

      return { role: binding.role, assetId: binding.assetId, registryEntry: { ...live } };
    });

  const defaultStateDecisions = request.defaultStateDecisions.map((decision) => {
    let text: string;

    try {
      text = resolveCharacterApprovalSourceText(character, decision.source);
    } catch (error) {
      blocked(`${decision.itemKey}: ${(error as Error).message}`);
    }

    const resolutions = (decision.resolutions ?? []).map((resolution) => {
      try {
        return {
          attribute: resolution.attribute,
          valueCode: selectCharacterApprovalAlternative(text, resolution.valueCode),
        };
      } catch (error) {
        blocked(`${decision.itemKey}: ${(error as Error).message}`);
      }
    });

    return {
      itemKey: decision.itemKey,
      source: {
        field: decision.source.field,
        index: decision.source.index,
        sourceTextSha256: computeExactSourceTextSha256(text),
      },
      disposition: decision.disposition,
      resolutions,
      ...(decision.approvedDescription === undefined ? {} : { approvedDescription: decision.approvedDescription }),
    };
  });

  const candidate = {
    schemaVersion: "1.0",
    recordType: "CHARACTER_VISUAL_IDENTITY_APPROVAL",
    approvalId: (dependencies.createApprovalId ?? randomUUID)(),
    approvedAt: (dependencies.now ?? (() => new Date().toISOString()))(),
    status: "APPROVED",
    characterId,
    targetIdentityVersion,
    sourceCharacterBible: {
      schemaVersion: bible.schemaVersion,
      canonicalSha256: computeCharacterBibleCanonicalSha256(bible),
    },
    referenceBindings,
    defaultStateDecisions,
    acceptanceAttestations: request.acceptanceAttestations,
    authorizationSource: "HUMAN_OPERATOR",
    workflowStep: "E9_STEP_1137D",
    ...(request.operatorNotes === undefined ? {} : { operatorNotes: request.operatorNotes }),
    activationEffect: "NONE_EVIDENCE_ONLY",
  };

  const validationDependencies = dependencies.verifyAsset ? { verifyAsset: dependencies.verifyAsset } : {};

  const record = await validateCharacterVisualIdentityApproval(
    { mediaRoot, approval: candidate, bible, registry },
    validationDependencies,
  );

  const bytes = `${JSON.stringify(record, null, 2)}\n`;

  await mkdir(dirname(approvalPath), { recursive: true });

  const temporaryPath = `${approvalPath}.part-${process.pid}-${randomUUID()}`;
  let temporaryCreated = false;

  try {
    await writeFile(temporaryPath, bytes, { encoding: "utf8", flag: "wx" });
    temporaryCreated = true;

    try {
      await copyFile(temporaryPath, approvalPath, constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(
          `Character visual identity approval already exists and is never replaced: ${approvalPath}. A changed decision requires a new identity version.`,
        );
      }

      throw error;
    }
  } finally {
    if (temporaryCreated) {
      try {
        await unlink(temporaryPath);
      } catch {
        // Preserve the original result or failure.
      }
    }
  }

  // Read back through the strict reader and re-run full validation on what is now durable.
  const stored = await readCharacterVisualIdentityApproval(mediaRoot, characterId, targetIdentityVersion);

  if (canonicalCharacterIdentityJson(stored) !== canonicalCharacterIdentityJson(record)) {
    throw new Error(`Character visual identity approval read-back differs from the published record: ${approvalPath}`);
  }

  await validateCharacterVisualIdentityApproval(
    { mediaRoot, approval: stored, bible, registry: await (dependencies.readRegistry ?? readVisualReferenceAssetRegistry)(mediaRoot) },
    validationDependencies,
  );

  const approvalSha256 = createHash("sha256").update(await readFile(approvalPath)).digest("hex");

  return Object.freeze({ record: stored, approvalPath, approvalSha256 });
}
