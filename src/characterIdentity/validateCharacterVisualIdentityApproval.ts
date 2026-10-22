import {
  isAbsolute,
  resolve,
} from "node:path";

import {
  canonicalCharacterIdentityJson,
} from "./canonicalCharacterIdentityJson.js";

import {
  CharacterVisualIdentityApprovalV1Schema,
  type CharacterVisualIdentityApprovalV1,
} from "./characterVisualIdentityApproval.schema.js";

import {
  approvalTextWords,
} from "./characterVisualIdentityApprovalAmbiguity.js";

import {
  computeCharacterBibleCanonicalSha256,
  computeExactSourceTextSha256,
  listCharacterApprovalSourceLocations,
  parseCharacterApprovalSourceAlternatives,
  resolveCharacterApprovalSourceText,
  sourceLocationKey,
  sourceTextRequiresResolution,
} from "./characterVisualIdentityApprovalSource.js";

import {
  CharacterBibleSchema,
  type Character,
  type CharacterBible,
} from "../schemas/character.schema.js";

import {
  VisualReferenceAssetRegistrySchema,
} from "../execution/visualReferenceAsset.schema.js";

import {
  verifyApprovedVisualReferenceAsset,
} from "../execution/verifyApprovedVisualReferenceAsset.js";

// E9 Step 1137D1 cross-document validation. The schema proves shape; this layer proves the receipt against
// the validated CharacterBible (coverage, exact source digests, narrow alternative grammar) and against the
// live visual-reference registry and physical bytes. Every failure throws: there is no partial acceptance.

function invalid(detail: string): never {
  throw new Error(`Character visual identity approval rejected: ${detail}`);
}

function findCharacter(bible: CharacterBible, characterId: string): Character {
  return bible.characters.find((candidate) => candidate.id === characterId) ??
    invalid(`character ${characterId} is not in the CharacterBible.`);
}

// Synchronous, I/O-free semantic validation against the CharacterBible.
export function validateCharacterVisualIdentityApprovalDecisions(
  approval: CharacterVisualIdentityApprovalV1,
  bible: CharacterBible,
): void {
  const character = findCharacter(bible, approval.characterId);

  if (approval.sourceCharacterBible.schemaVersion !== bible.schemaVersion) {
    invalid(`source CharacterBible schemaVersion ${approval.sourceCharacterBible.schemaVersion} does not match ${bible.schemaVersion}.`);
  }

  // Creation-time precondition: the receipt must identify the exact Bible being approved. After the 1137E
  // migration this digest is historical provenance; 1137E needs its own consumption verifier, not this check.
  if (approval.sourceCharacterBible.canonicalSha256 !== computeCharacterBibleCanonicalSha256(bible)) {
    invalid("source CharacterBible canonical SHA-256 does not match the validated CharacterBible.");
  }

  const expected = new Set(listCharacterApprovalSourceLocations(character).map(sourceLocationKey));
  const covered = new Set<string>();
  const selectedWords = new Set<string>();
  const rejectedWords = new Set<string>();

  for (const decision of approval.defaultStateDecisions) {
    const key = sourceLocationKey(decision.source);

    let text: string;

    try {
      text = resolveCharacterApprovalSourceText(character, decision.source);
    } catch (error) {
      invalid(`${decision.itemKey}: ${(error as Error).message}`);
    }

    if (covered.has(key)) {
      invalid(`source ${key} has more than one decision.`);
    }

    covered.add(key);

    if (decision.source.sourceTextSha256 !== computeExactSourceTextSha256(text)) {
      invalid(`${decision.itemKey}: sourceTextSha256 does not match the exact CharacterBible string at ${key}.`);
    }

    const requiresResolution = sourceTextRequiresResolution(text);

    if (decision.disposition !== "DEFAULT_STATE_ITEM") {
      continue;
    }

    if (!requiresResolution) {
      if (decision.resolutions.length > 0) {
        invalid(`${decision.itemKey}: source ${key} offers no alternatives, so it takes no resolution.`);
      }

      continue;
    }

    let alternatives: readonly [string, string];

    try {
      alternatives = parseCharacterApprovalSourceAlternatives(text);
    } catch (error) {
      invalid(`${decision.itemKey}: default state from ${key} cannot be resolved: ${(error as Error).message}`);
    }

    const [resolution, ...extra] = decision.resolutions;

    if (!resolution || extra.length > 0) {
      invalid(`${decision.itemKey}: source ${key} offers alternatives and needs exactly one resolution.`);
    }

    if (!alternatives.includes(resolution.valueCode)) {
      invalid(`${decision.itemKey}: ${resolution.valueCode} is not one of the alternatives offered at ${key}.`);
    }

    const rejected = alternatives.filter((alternative) => alternative !== resolution.valueCode);
    const descriptionWords = new Set(approvalTextWords(decision.approvedDescription ?? ""));

    if (!descriptionWords.has(resolution.valueCode.toLowerCase())) {
      invalid(`${decision.itemKey}: approvedDescription must name the approved ${resolution.valueCode}.`);
    }

    for (const word of rejected) {
      if (descriptionWords.has(word.toLowerCase())) {
        invalid(`${decision.itemKey}: approvedDescription must not restate the rejected alternative ${word}.`);
      }

      rejectedWords.add(word.toLowerCase());
    }

    selectedWords.add(resolution.valueCode.toLowerCase());
  }

  for (const key of expected) {
    if (!covered.has(key)) {
      invalid(`source ${key} of ${character.id} has no decision.`);
    }
  }

  // Notes record the resolved outcome, never the deliberation: a word rejected everywhere it was offered
  // may not appear. (A colour rejected for one item may still be the approved value of another.)
  if (approval.operatorNotes !== undefined) {
    for (const word of approvalTextWords(approval.operatorNotes)) {
      if (rejectedWords.has(word) && !selectedWords.has(word)) {
        invalid(`operatorNotes must not restate the rejected alternative ${word.toUpperCase()}.`);
      }
    }
  }
}

export type ValidateCharacterVisualIdentityApprovalInput =
  Readonly<{
    mediaRoot: string;
    approval: unknown;
    bible: unknown;
    registry: unknown;
  }>;

export type ValidateCharacterVisualIdentityApprovalDependencies =
  Readonly<{
    verifyAsset?: typeof verifyApprovedVisualReferenceAsset;
  }>;

// Full validation: schema, CharacterBible semantics, live registry snapshot equality and physical bytes.
export async function validateCharacterVisualIdentityApproval(
  input: ValidateCharacterVisualIdentityApprovalInput,
  dependencies: ValidateCharacterVisualIdentityApprovalDependencies = {},
): Promise<CharacterVisualIdentityApprovalV1> {
  const mediaRoot = input.mediaRoot.trim();

  if (!mediaRoot || !isAbsolute(mediaRoot)) {
    invalid("media root must be absolute.");
  }

  const approvalResult = CharacterVisualIdentityApprovalV1Schema.safeParse(input.approval);

  if (!approvalResult.success) {
    invalid(`schema validation failed: ${approvalResult.error.message}`);
  }

  const bibleResult = CharacterBibleSchema.safeParse(input.bible);

  if (!bibleResult.success) {
    invalid(`CharacterBible is invalid: ${bibleResult.error.message}`);
  }

  const registryResult = VisualReferenceAssetRegistrySchema.safeParse(input.registry);

  if (!registryResult.success) {
    invalid(`visual reference registry is invalid: ${registryResult.error.message}`);
  }

  const approval = approvalResult.data;
  const registry = registryResult.data;

  validateCharacterVisualIdentityApprovalDecisions(approval, bibleResult.data);

  const verifyAsset = dependencies.verifyAsset ?? verifyApprovedVisualReferenceAsset;

  for (const binding of approval.referenceBindings) {
    const live = registry.assets.find((asset) => asset.assetId === binding.assetId) ??
      invalid(`${binding.role} asset ${binding.assetId} is not registered.`);

    for (const field of ["assetId", "mediaRootRelativePath", "bytes", "sha256", "contentType"] as const) {
      if (binding.registryEntry[field] !== live[field]) {
        invalid(`${binding.role} registry snapshot ${field} differs from the live registry entry for ${binding.assetId}.`);
      }
    }

    if (canonicalCharacterIdentityJson(binding.registryEntry) !== canonicalCharacterIdentityJson(live)) {
      invalid(`${binding.role} registry snapshot differs from the live registry entry for ${binding.assetId}.`);
    }

    await verifyAsset({
      mediaRoot,
      sourceImagePath: resolve(mediaRoot, ...live.mediaRootRelativePath.split("/")),
      approvedAssetIds: [binding.assetId],
      registry,
    });
  }

  return approval;
}
