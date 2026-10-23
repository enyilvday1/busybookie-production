import {
  createHash,
} from "node:crypto";

import {
  readFile,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";

import {
  canonicalCharacterIdentityJson,
  characterIdentitySha256,
  freezeCharacterIdentity,
} from "./canonicalCharacterIdentityJson.js";

import {
  findUnresolvedApprovalWording,
} from "./characterVisualIdentityApprovalAmbiguity.js";

import {
  createCharacterVisualIdentityApprovalPath,
  createCharacterVisualIdentityApprovalRelativePath,
} from "./characterVisualIdentityApprovalPath.js";

import {
  readCharacterVisualIdentityApproval,
} from "./readCharacterVisualIdentityApproval.js";

import {
  CharacterBibleSchema,
  CharacterSchema,
  type Character,
} from "../schemas/character.schema.js";

import type {
  CharacterApprovedTraitDecision,
} from "../schemas/characterVisualIdentity.schema.js";

import {
  readVisualReferenceAssetRegistry,
} from "../execution/readVisualReferenceAssetRegistry.js";

import {
  verifyApprovedVisualReferenceAsset,
} from "../execution/verifyApprovedVisualReferenceAsset.js";

import type {
  VisualReferenceAsset,
} from "../execution/visualReferenceAsset.schema.js";

// E9 Step 1137E (N2): consumption-time verification of an already-created approval receipt against the migrated
// CharacterBible v2. Distinct from the D1 creation-time validator, which requires the receipt's source digest to equal
// the CharacterBible being approved. Here that digest is HISTORICAL_PROVENANCE: it is returned, never compared with
// the current (migrated) CharacterBible. Intentional migration is proven by the explicit approval link (approvalId +
// exact receipt bytes), one-to-one equality between the receipt's structured decisions and the current structured
// state, and registry + physical re-verification. No version-control history or repository metadata is read.
//
// Supplemental IV1 visual decisions (FREE_TEXT_ONLY_SUPPLEMENTAL_DECISION_PATH = LEGACY_IV1_MIGRATION_EXCEPTION) live
// in IV1 receipts only as operatorNotes text. They are current structured authority in CharacterBible v2; the receipt
// note is deterministic CORROBORATION only, never structured receipt proof. The exception is a CLOSED migration
// allowlist keyed by character + trait + value and bound to the exact IV1 receipts below; nothing outside it can be
// corroborated, and later identity versions require a future structured approval contract.

export const LEGACY_IV1_NOTE_CORROBORATION_IDENTITY_VERSION = 1;

const LEGACY_IV1_WORKFLOW_STEP = "E9_STEP_1137D";
const LEGACY_IV1_SOURCE_CHARACTER_BIBLE_CANONICAL_SHA256 = "a4825c432fdecbf7415d714689fbe5efb1783a09bf628e3b238c68b2730b524d";

type LegacyIv1TraitDecision =
  | Readonly<{ traitKey: string; valueCode: string; description: string; provenance: "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION"; legacyIv1ReceiptNoteCorroboration: string }>
  | Readonly<{ traitKey: string; valueCode: string; description: string; provenance: "CHARACTER_BIBLE_SOURCE"; characterBibleSourceText: string }>;

type LegacyIv1Receipt = Readonly<{
  characterId: string;
  approvalId: string;
  operatorNotes: string;
  traitDecisions: readonly LegacyIv1TraitDecision[];
}>;

// The exact D2 (Steps 1137D2C2-D2C4) IV1 receipts and their approved supplemental decisions. Receipt bytes are pinned
// by each LOCKED identity's approval link; approvalId, workflow, historical source digest and the verbatim
// operatorNotes are pinned here. Phrases are verbatim substrings of those operatorNotes.
const LEGACY_IV1_RECEIPTS: readonly LegacyIv1Receipt[] = freezeCharacterIdentity([
  {
    characterId: "OLLIE",
    approvalId: "371599c1-35d3-4893-913b-9c4f63730cb8",
    operatorNotes: "Approved master: BROWN paw fur, DARK_BROWN paw pads, pink paws prohibited, satchel not visible (excluded shot state).",
    traitDecisions: [
      { traitKey: "PAW_FUR_COLOUR", valueCode: "BROWN", description: "brown paw fur", provenance: "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION", legacyIv1ReceiptNoteCorroboration: "BROWN paw fur" },
      { traitKey: "PAW_PAD_COLOUR", valueCode: "DARK_BROWN", description: "dark-brown paw pads", provenance: "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION", legacyIv1ReceiptNoteCorroboration: "DARK_BROWN paw pads" },
      { traitKey: "PINK_PAWS", valueCode: "PROHIBITED", description: "pink paws are prohibited", provenance: "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION", legacyIv1ReceiptNoteCorroboration: "pink paws prohibited" },
    ],
  },
  {
    characterId: "KACEY",
    approvalId: "ecc47e91-26a7-4687-b7fa-5b6661370028",
    operatorNotes: "Approved master: DARK_BROWN paw fur, PINK backpack, PINK neck scarf, FLOWER hair accessory.",
    traitDecisions: [
      { traitKey: "PAW_FUR_COLOUR", valueCode: "DARK_BROWN", description: "dark-brown paw fur", provenance: "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION", legacyIv1ReceiptNoteCorroboration: "DARK_BROWN paw fur" },
    ],
  },
  {
    characterId: "MONT",
    approvalId: "eb043e11-f533-443a-a368-54babc680d0f",
    operatorNotes: "Approved master: blue-grey body, hands and feet; light cream ivory nails. Green explorer accents remain presentation guidance only.",
    traitDecisions: [
      { traitKey: "BODY_HAND_FOOT_COLOUR", valueCode: "BLUE_GREY", description: "blue-grey body, hands and feet", provenance: "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION", legacyIv1ReceiptNoteCorroboration: "blue-grey body, hands and feet" },
      { traitKey: "INNER_EAR_COLOUR", valueCode: "PINK", description: "soft pink inner ears", provenance: "CHARACTER_BIBLE_SOURCE", characterBibleSourceText: "large rounded ears with soft pink inner ears" },
      { traitKey: "NAIL_COLOUR", valueCode: "LIGHT_CREAM_IVORY", description: "light cream ivory nails", provenance: "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION", legacyIv1ReceiptNoteCorroboration: "light cream ivory nails" },
    ],
  },
]);

// The exact per-character authority that consumption verification proves and Snapshot V2 consumes: the snapshot read
// set (id, species, visualIdentity, defaultContinuityState) plus the state the verifier proves against the receipt
// (appearance identity prose, shotOrStoryStateItems, presentationGuidance, trait-decision evidence inside
// visualIdentity). Deliberately excluded: promptAnchor (legacy, D-3) and name, gender, pronouns, presentation, role,
// personalityTraits and voice, which neither the verifier nor the snapshot reads.
export function createCharacterVisualIdentityConsumptionAuthorityProjection(character: Character) {
  return {
    characterId: character.id,
    species: character.species,
    appearance: {
      body: character.appearance.body,
      face: character.appearance.face,
      eyes: character.appearance.eyes,
      distinguishingFeatures: [...character.appearance.distinguishingFeatures],
    },
    visualIdentity: character.visualIdentity,
    defaultContinuityState: character.defaultContinuityState,
    shotOrStoryStateItems: character.shotOrStoryStateItems,
    presentationGuidance: character.presentationGuidance,
  };
}

export function characterVisualIdentityConsumptionAuthoritySha256(character: Character): string {
  return characterIdentitySha256(canonicalCharacterIdentityJson(createCharacterVisualIdentityConsumptionAuthorityProjection(character)));
}

export type CharacterTraitDecisionEvidence =
  Readonly<{
    traitKey: string;
    valueCode: string;
    provenance: CharacterApprovedTraitDecision["provenance"];
    currentStructuredAuthority: true;
    structuredReceiptProof: false;
    historicalReceiptCorroboration: boolean;
    characterBibleSourceVerified: boolean;
  }>;

export type CharacterIdentityConsumptionVerification =
  Readonly<{
    result: "CONSUMPTION_VERIFIED";
    characterId: string;
    identityVersion: number;
    approvalId: string;
    receiptSha256: string;
    receiptRelativePath: string;
    masterAssetId: string;
    registryEntries: readonly VisualReferenceAsset[];
    physicalVerification: "PASS";
    historicalSourceCharacterBible: Readonly<{ schemaVersion: string; canonicalSha256: string }>;
    historicalSourceDigestEqualityRequired: false;
    currentCharacterBibleCanonicalSha256: string;
    currentCharacterAuthoritySha256: string;
    traitDecisionEvidence: readonly CharacterTraitDecisionEvidence[];
  }>;

export type VerifyCharacterVisualIdentityApprovalForConsumptionInput =
  Readonly<{
    mediaRoot: string;
    bible: unknown;
    characterId: string;
  }>;

type TrustedVerificationBinding = Readonly<{
  characterId: string;
  identityVersion: number;
  approvalId: string;
  receiptSha256: string;
  masterAssetId: string;
  authoritySha256: string;
}>;

// Module-private: only a successful run of the production verifier below (genuine physical verification included)
// registers a result, together with the exact authority it verified. Nothing else can insert into this map.
const trustedVerifications = new WeakMap<object, TrustedVerificationBinding>();

// Origin only. Consumers must use assertCharacterVisualIdentityConsumptionVerificationMatchesAuthority.
export function isVerifiedCharacterIdentityConsumption(value: unknown): value is CharacterIdentityConsumptionVerification {
  return typeof value === "object" && value !== null && trustedVerifications.has(value);
}

// Fails closed unless `verification` is a genuine result issued for exactly the current authority of `character`.
export function assertCharacterVisualIdentityConsumptionVerificationMatchesAuthority(
  verification: unknown,
  character: unknown,
): CharacterIdentityConsumptionVerification {
  const binding = typeof verification === "object" && verification !== null ? trustedVerifications.get(verification) : undefined;

  if (!binding) {
    rejected("the verification result was not issued by the consumption verifier.");
  }

  const parsed = CharacterSchema.safeParse(character);

  if (!parsed.success) {
    rejected(`the current character is invalid: ${parsed.error.message}`);
  }

  const current = parsed.data;
  const identity = current.visualIdentity;

  if (identity.status !== "LOCKED") {
    rejected(`${current.id} visual identity is ${identity.status}, not LOCKED.`);
  }

  const master = identity.referenceBindings.find((candidate) => candidate.role === "MASTER_IDENTITY");

  if (
    binding.characterId !== current.id ||
    binding.identityVersion !== identity.identityVersion ||
    binding.approvalId !== identity.approval.approvalId ||
    binding.receiptSha256 !== identity.approval.receiptSha256 ||
    binding.masterAssetId !== master?.assetId ||
    binding.authoritySha256 !== characterVisualIdentityConsumptionAuthoritySha256(current)
  ) {
    rejected(`the verification result for ${binding.characterId} does not match the current authority of ${current.id}; it is stale or belongs to another character.`);
  }

  return verification as CharacterIdentityConsumptionVerification;
}

function rejected(detail: string): never {
  throw new Error(`Character visual identity consumption verification failed: ${detail}`);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Exact renderings of a machine code accepted inside a corroboration phrase: the code itself (DARK_BROWN), its
// lowercase hyphen form (dark-brown) or its lowercase space form (dark brown), as a whole token sequence.
export function machineCodeRenderings(valueCode: string): string[] {
  const lower = valueCode.toLowerCase();

  return [...new Set([valueCode, lower.replaceAll("_", "-"), lower.replaceAll("_", " ")])];
}

export function textContainsMachineCode(text: string, valueCode: string): boolean {
  return machineCodeRenderings(valueCode).some((rendering) =>
    new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(rendering)}(?![A-Za-z0-9_-])`).test(text));
}

// Deterministic legacy IV1 corroboration: the phrase must occur verbatim (case-sensitive) in the pinned receipt's
// operatorNotes and must itself contain the trait's value code rendering. No fuzzy or unordered word matching.
export function corroboratesLegacyIv1ReceiptNote(
  operatorNotes: string | undefined,
  phrase: string,
  valueCode: string,
): boolean {
  return operatorNotes !== undefined && operatorNotes.includes(phrase) && textContainsMachineCode(phrase, valueCode);
}

function sortedJson(values: readonly unknown[]): string {
  return JSON.stringify(values.map((value) => canonicalCharacterIdentityJson(value)).sort());
}

function scanActiveStructuredState(character: Character): void {
  const freeText: Array<[string, string]> = [];
  const codes: Array<[string, string]> = [];

  for (const item of character.defaultContinuityState.items) {
    codes.push([`defaultContinuityState ${item.itemKey}`, item.itemKey]);
    freeText.push([`defaultContinuityState ${item.itemKey}`, item.description]);
    item.resolutions.forEach((resolution) => codes.push([`defaultContinuityState ${item.itemKey}`, resolution.valueCode]));
  }

  for (const item of character.shotOrStoryStateItems) {
    codes.push([`shotOrStoryStateItems ${item.itemKey}`, item.itemKey]);
    freeText.push([`shotOrStoryStateItems ${item.itemKey}`, item.description]);
  }

  for (const guidance of character.presentationGuidance) {
    codes.push([`presentationGuidance ${guidance.guidanceKey}`, guidance.guidanceKey]);
    freeText.push([`presentationGuidance ${guidance.guidanceKey}`, guidance.text]);
  }

  for (const decision of character.visualIdentity.approvedTraitDecisions) {
    codes.push([`approvedTraitDecisions ${decision.traitKey}`, decision.traitKey]);
    codes.push([`approvedTraitDecisions ${decision.traitKey}`, decision.valueCode]);
    freeText.push([`approvedTraitDecisions ${decision.traitKey}`, decision.description]);
  }

  // invariantTraits are scanned; prohibitedVariations are not: their "or" enumerates forbidden outcomes
  // ("do not turn Ollie into an owl or another animal"), not an unresolved choice.
  character.visualIdentity.invariantTraits.forEach((trait) => freeText.push(["invariantTraits", trait]));

  for (const [where, value] of freeText) {
    const finding = findUnresolvedApprovalWording(value, { freeText: true });

    if (finding) rejected(`${character.id} ${where} contains unresolved wording (${finding}).`);
  }

  for (const [where, value] of codes) {
    const finding = findUnresolvedApprovalWording(value, { freeText: false });

    if (finding) rejected(`${character.id} ${where} code ${value} contains unresolved wording (${finding}).`);
  }
}

function verifyTraitDecisions(
  character: Character,
  receipt: Awaited<ReturnType<typeof readCharacterVisualIdentityApproval>>,
  identityProse: readonly string[],
): CharacterTraitDecisionEvidence[] {
  const identity = character.visualIdentity;
  const decisions = identity.approvedTraitDecisions;

  // The applicable trait-decision contract is resolved BEFORE an empty list can be accepted: an absent decision is
  // evidence too. A legacy IV1 contract applies to the pinned approval, and an IV1 identity of a pinned character
  // must use exactly that approval.
  const legacy = LEGACY_IV1_RECEIPTS.find((candidate) =>
    candidate.characterId === character.id && candidate.approvalId === receipt.approvalId);
  const pinnedIv1Character = identity.identityVersion === LEGACY_IV1_NOTE_CORROBORATION_IDENTITY_VERSION &&
    LEGACY_IV1_RECEIPTS.some((candidate) => candidate.characterId === character.id);

  if (!legacy && !pinnedIv1Character && decisions.length === 0) {
    // No trait-decision contract applies (e.g. a future character or identity version without trait decisions).
    return [];
  }

  if (identity.identityVersion !== LEGACY_IV1_NOTE_CORROBORATION_IDENTITY_VERSION || receipt.workflowStep !== LEGACY_IV1_WORKFLOW_STEP) {
    rejected(`${character.id}: free-text receipt-note corroboration is a legacy IV1 migration exception and is not accepted for identity version ${identity.identityVersion}; trait decisions require a future structured approval contract.`);
  }

  if (
    !legacy ||
    receipt.characterId !== legacy.characterId ||
    receipt.sourceCharacterBible.canonicalSha256 !== LEGACY_IV1_SOURCE_CHARACTER_BIBLE_CANONICAL_SHA256 ||
    receipt.operatorNotes !== legacy.operatorNotes
  ) {
    rejected(`${character.id} receipt ${receipt.approvalId} is not a legacy IV1 receipt in the closed migration allowlist; trait decisions require a future structured approval contract.`);
  }

  // Closed world, EXACT SET in both directions: every current decision is an allowlisted (character, trait, value,
  // provenance, evidence) tuple, and every allowlisted tuple is present exactly once. Array order is not authoritative.
  const allowed = new Map(legacy.traitDecisions.map((decision) => [decision.traitKey, decision]));

  for (const decision of decisions) {
    const expected = allowed.get(decision.traitKey);

    if (!expected || canonicalCharacterIdentityJson(expected) !== canonicalCharacterIdentityJson(decision)) {
      rejected(`${character.id} ${decision.traitKey}=${decision.valueCode} is not corroborated by the pinned IV1 receipt operatorNotes: it is not the allowlisted legacy IV1 decision for ${character.id} ${decision.traitKey}.`);
    }
  }

  const actualTuples = decisions.map((decision) => canonicalCharacterIdentityJson(decision)).sort();
  const expectedTuples = legacy.traitDecisions.map((decision) => canonicalCharacterIdentityJson(decision)).sort();

  if (
    actualTuples.length !== expectedTuples.length ||
    new Set(actualTuples).size !== actualTuples.length ||
    actualTuples.some((tuple, index) => tuple !== expectedTuples[index])
  ) {
    rejected(`${character.id} approvedTraitDecisions do not exactly equal the allowlisted legacy IV1 decisions (expected ${expectedTuples.length}, found ${actualTuples.length}).`);
  }

  return decisions.map((decision) => {
    if (decision.provenance === "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION") {
      if (!corroboratesLegacyIv1ReceiptNote(receipt.operatorNotes, decision.legacyIv1ReceiptNoteCorroboration, decision.valueCode)) {
        rejected(`${character.id} ${decision.traitKey}=${decision.valueCode} is not corroborated by the pinned IV1 receipt operatorNotes.`);
      }

      return {
        traitKey: decision.traitKey,
        valueCode: decision.valueCode,
        provenance: decision.provenance,
        currentStructuredAuthority: true as const,
        structuredReceiptProof: false as const,
        historicalReceiptCorroboration: true,
        characterBibleSourceVerified: false,
      };
    }

    if (!identityProse.includes(decision.characterBibleSourceText) ||
      !textContainsMachineCode(decision.characterBibleSourceText, decision.valueCode)) {
      rejected(`${character.id} ${decision.traitKey}=${decision.valueCode} does not match its CharacterBible identity source text.`);
    }

    return {
      traitKey: decision.traitKey,
      valueCode: decision.valueCode,
      provenance: decision.provenance,
      currentStructuredAuthority: true as const,
      structuredReceiptProof: false as const,
      historicalReceiptCorroboration: false,
      characterBibleSourceVerified: true,
    };
  });
}

// No dependency parameter: physical verification always runs through the genuine approved-reference verifier, so a
// caller can never obtain a trusted result with a substituted check.
export async function verifyCharacterVisualIdentityApprovalForConsumption(
  input: VerifyCharacterVisualIdentityApprovalForConsumptionInput,
): Promise<CharacterIdentityConsumptionVerification> {
  const parsedBible = CharacterBibleSchema.safeParse(input.bible);

  if (!parsedBible.success) {
    rejected(`CharacterBible v2 is invalid: ${parsedBible.error.message}`);
  }

  const bible = parsedBible.data;
  const character = bible.characters.find((candidate) => candidate.id === input.characterId) ??
    rejected(`character ${input.characterId} is not in the CharacterBible.`);
  const identity = character.visualIdentity;

  if (identity.status !== "LOCKED") {
    rejected(`${character.id} visual identity is ${identity.status}, not LOCKED.`);
  }

  // 1-6, 6a: the approval link pins one immutable receipt; the strict reader enforces schema, APPROVED,
  // HUMAN_OPERATOR, E9_STEP_1137D, NONE_EVIDENCE_ONLY and character/version identity with its path.
  let receipt: Awaited<ReturnType<typeof readCharacterVisualIdentityApproval>>;

  try {
    receipt = await readCharacterVisualIdentityApproval(input.mediaRoot, character.id, identity.identityVersion);
  } catch (error) {
    rejected(`${character.id} IV${identity.identityVersion} receipt unavailable: ${(error as Error).message}`);
  }

  const receiptBytes = await readFile(
    createCharacterVisualIdentityApprovalPath(input.mediaRoot, character.id, identity.identityVersion),
  );
  const receiptSha256 = sha256(receiptBytes);

  if (receiptSha256 !== identity.approval.receiptSha256) {
    rejected(`${character.id} receipt SHA-256 ${receiptSha256} does not match the approval link ${identity.approval.receiptSha256}.`);
  }

  if (receipt.approvalId !== identity.approval.approvalId) {
    rejected(`${character.id} receipt approvalId ${receipt.approvalId} does not match the approval link ${identity.approval.approvalId}.`);
  }

  // 7: bindings must be exactly the approved bindings.
  if (sortedJson(receipt.referenceBindings.map((binding) => ({ role: binding.role, assetId: binding.assetId }))) !==
    sortedJson(identity.referenceBindings.map((binding) => ({ role: binding.role, assetId: binding.assetId })))) {
    rejected(`${character.id} active reference bindings differ from the approved receipt bindings.`);
  }

  // 8-10: registry entries exist, equal the receipt snapshots, and the physical bytes verify.
  const registry = await readVisualReferenceAssetRegistry(input.mediaRoot);
  const registryEntries: VisualReferenceAsset[] = [];

  for (const binding of receipt.referenceBindings) {
    const live = registry.assets.find((asset) => asset.assetId === binding.assetId) ??
      rejected(`${character.id} ${binding.role} asset ${binding.assetId} is not registered.`);

    if (canonicalCharacterIdentityJson(live) !== canonicalCharacterIdentityJson(binding.registryEntry)) {
      rejected(`${character.id} ${binding.role} registry entry differs from the approved receipt snapshot.`);
    }

    await verifyApprovedVisualReferenceAsset({
      mediaRoot: input.mediaRoot,
      sourceImagePath: resolve(input.mediaRoot, ...live.mediaRootRelativePath.split("/")),
      approvedAssetIds: [live.assetId],
      registry,
    });

    registryEntries.push({ ...live });
  }

  const master = identity.referenceBindings.find((binding) => binding.role === "MASTER_IDENTITY") ??
    rejected(`${character.id} has no MASTER_IDENTITY binding.`);

  // 12: stable identity prose of the CharacterBible is carried by invariantTraits (no divergent second copy).
  for (const text of [character.appearance.body, character.appearance.face, character.appearance.eyes,
    ...character.appearance.distinguishingFeatures]) {
    if (!identity.invariantTraits.includes(text)) {
      rejected(`${character.id} appearance identity text is missing from visualIdentity.invariantTraits: ${text}`);
    }
  }

  // 13-16: one-to-one correspondence of receipt decisions and current structured state.
  const receiptDefaults = receipt.defaultStateDecisions.filter((decision) => decision.disposition === "DEFAULT_STATE_ITEM");
  const receiptExcluded = receipt.defaultStateDecisions.filter((decision) => decision.disposition === "EXCLUDED_SHOT_OR_STORY_STATE");
  const receiptGuidance = receipt.defaultStateDecisions.filter((decision) => decision.disposition === "PRESENTATION_GUIDANCE_NOT_STATE");

  if (sortedJson(receiptDefaults.map((decision) => ({
    itemKey: decision.itemKey,
    description: decision.approvedDescription ?? "",
    resolutions: [...decision.resolutions].sort((a, b) => a.attribute.localeCompare(b.attribute)),
  }))) !== sortedJson(character.defaultContinuityState.items.map((item) => ({
    itemKey: item.itemKey,
    description: item.description,
    resolutions: [...item.resolutions].sort((a, b) => a.attribute.localeCompare(b.attribute)),
  })))) {
    rejected(`${character.id} defaultContinuityState does not exactly match the approved DEFAULT_STATE_ITEM decisions.`);
  }

  if (sortedJson(receiptExcluded.map((decision) => decision.itemKey)) !==
    sortedJson(character.shotOrStoryStateItems.map((item) => item.itemKey))) {
    rejected(`${character.id} shotOrStoryStateItems do not exactly match the approved EXCLUDED_SHOT_OR_STORY_STATE decisions.`);
  }

  if (sortedJson(receiptGuidance.map((decision) => decision.itemKey)) !==
    sortedJson(character.presentationGuidance.map((guidance) => guidance.guidanceKey))) {
    rejected(`${character.id} presentationGuidance does not exactly match the approved PRESENTATION_GUIDANCE_NOT_STATE decisions.`);
  }

  // 17: structured trait decisions: only the closed legacy IV1 allowlist (character + trait + value), with the
  // human decisions corroborated by exact phrases of the pinned operatorNotes and CharacterBible-sourced decisions
  // quoting existing identity prose exactly.
  const traitDecisionEvidence = verifyTraitDecisions(character, receipt, [character.appearance.body,
    character.appearance.face, character.appearance.eyes, ...character.appearance.distinguishingFeatures]);

  // 19: no unresolved ambiguity in active structured state (promptAnchor is legacy text and is never read here).
  scanActiveStructuredState(character);

  const authoritySha256 = characterVisualIdentityConsumptionAuthoritySha256(character);

  const result: CharacterIdentityConsumptionVerification = freezeCharacterIdentity({
    result: "CONSUMPTION_VERIFIED",
    characterId: character.id,
    identityVersion: identity.identityVersion,
    approvalId: receipt.approvalId,
    receiptSha256,
    receiptRelativePath: createCharacterVisualIdentityApprovalRelativePath(character.id, identity.identityVersion),
    masterAssetId: master.assetId,
    registryEntries,
    physicalVerification: "PASS",
    // 11: historical provenance, intentionally not compared with the current CharacterBible.
    historicalSourceCharacterBible: { ...receipt.sourceCharacterBible },
    historicalSourceDigestEqualityRequired: false,
    currentCharacterBibleCanonicalSha256: characterIdentitySha256(canonicalCharacterIdentityJson(bible)),
    currentCharacterAuthoritySha256: authoritySha256,
    traitDecisionEvidence,
  });

  trustedVerifications.set(result, freezeCharacterIdentity({
    characterId: character.id,
    identityVersion: identity.identityVersion,
    approvalId: receipt.approvalId,
    receiptSha256,
    masterAssetId: master.assetId,
    authoritySha256,
  }));

  return result;
}
