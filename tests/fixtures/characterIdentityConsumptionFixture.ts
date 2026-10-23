import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  CHARACTER_REFERENCE_ACCEPTANCE_RULES,
  CharacterVisualIdentityApprovalV1Schema,
} from "../../src/characterIdentity/characterVisualIdentityApproval.schema.js";

import { createCharacterVisualIdentityApprovalPath } from "../../src/characterIdentity/characterVisualIdentityApprovalPath.js";
import { createVisualReferenceAssetRegistryPath } from "../../src/execution/visualReferenceAssetRegistryPath.js";

// Test-only fixture for Step 1137E consumption verification. It builds, in a temporary media root, receipts shaped like
// the real IV1 receipts (same approvalIds, decisions and operatorNotes as the T7 receipts), a registry and synthetic
// PNG masters, then pins the written receipts' digests into a copy of the live v2 CharacterBible. Nothing touches the
// production media root.

export type Json = Record<string, any>;

export const HISTORICAL_SOURCE_CANONICAL_SHA256 = "a4825c432fdecbf7415d714689fbe5efb1783a09bf628e3b238c68b2730b524d";

// Verbatim operatorNotes of the production IV1 receipts (D2C2, D2C3, D2C4).
export const IV1_OPERATOR_NOTES: Record<string, string> = {
  OLLIE: "Approved master: BROWN paw fur, DARK_BROWN paw pads, pink paws prohibited, satchel not visible (excluded shot state).",
  KACEY: "Approved master: DARK_BROWN paw fur, PINK backpack, PINK neck scarf, FLOWER hair accessory.",
  MONT: "Approved master: blue-grey body, hands and feet; light cream ivory nails. Green explorer accents remain presentation guidance only.",
};

export function liveV2Bible(): Json {
  return JSON.parse(readFileSync(new URL("../../config/characters.json", import.meta.url), "utf8"));
}

function sha(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function png(seed: number): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(48, seed)]);
}

// Receipt equivalent to the production IV1 receipt for this v2 character (decisions derived from its v2 state).
export function receiptFor(character: Json, registryEntry: Json, identityVersion = 1): Json {
  let index = 0;
  const location = () => ({ field: "appearance.outfit", index: index++, sourceTextSha256: "b".repeat(64) });

  return {
    schemaVersion: "1.0",
    recordType: "CHARACTER_VISUAL_IDENTITY_APPROVAL",
    approvalId: character.visualIdentity.approval?.approvalId ?? "11111111-1111-4111-8111-111111111111",
    approvedAt: "2026-10-23T15:30:00.000Z",
    status: "APPROVED",
    characterId: character.id,
    targetIdentityVersion: identityVersion,
    sourceCharacterBible: { schemaVersion: "1.0", canonicalSha256: HISTORICAL_SOURCE_CANONICAL_SHA256 },
    referenceBindings: [{ role: "MASTER_IDENTITY", assetId: registryEntry.assetId, registryEntry: { ...registryEntry } }],
    defaultStateDecisions: [
      ...character.defaultContinuityState.items.map((item: Json) => ({
        itemKey: item.itemKey,
        source: location(),
        disposition: "DEFAULT_STATE_ITEM",
        resolutions: item.resolutions,
        approvedDescription: item.description,
      })),
      ...character.shotOrStoryStateItems.map((item: Json) => ({
        itemKey: item.itemKey,
        source: location(),
        disposition: "EXCLUDED_SHOT_OR_STORY_STATE",
        resolutions: [],
      })),
      ...character.presentationGuidance.map((guidance: Json) => ({
        itemKey: guidance.guidanceKey,
        source: location(),
        disposition: "PRESENTATION_GUIDANCE_NOT_STATE",
        resolutions: [],
      })),
    ],
    acceptanceAttestations: Object.fromEntries(CHARACTER_REFERENCE_ACCEPTANCE_RULES.map((rule) => [rule, true])),
    authorizationSource: "HUMAN_OPERATOR",
    workflowStep: "E9_STEP_1137D",
    operatorNotes: IV1_OPERATOR_NOTES[character.id],
    activationEffect: "NONE_EVIDENCE_ONLY",
  };
}

export type ConsumptionFixture = Readonly<{
  mediaRoot: string;
  bible: Json;
  registry: Json;
  masterPath: (characterId: string) => string;
  writeReceipt: (characterId: string, receipt: Json, identityVersion?: number) => Promise<string>;
}>;

export async function createConsumptionFixture(
  options: Readonly<{ mutateReceipt?: (characterId: string, receipt: Json) => void }> = {},
): Promise<ConsumptionFixture> {
  const mediaRoot = await mkdtemp(join(tmpdir(), "busybookie-identity-consumption-"));
  const bible = liveV2Bible();
  const entries: Record<string, Json> = {};

  bible.characters.forEach((character: Json, seed: number) => {
    const assetId = character.visualIdentity.referenceBindings.find((binding: Json) => binding.role === "MASTER_IDENTITY").assetId;
    const bytes = png(seed + 1);

    entries[character.id] = {
      assetId,
      mediaRootRelativePath: `references/characters/${character.id}/${assetId}.png`,
      bytes: bytes.length,
      sha256: sha(bytes),
      contentType: "image/png",
      _bytes: bytes,
    };
  });

  for (const entry of Object.values(entries)) {
    const path = resolve(mediaRoot, ...entry.mediaRootRelativePath.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, entry._bytes);
    delete entry._bytes;
  }

  const registry = { schemaVersion: "1.0", assets: Object.values(entries) };
  await writeFile(createVisualReferenceAssetRegistryPath(mediaRoot), `${JSON.stringify(registry, null, 2)}\n`);

  const writeReceipt = async (characterId: string, receipt: Json, identityVersion = 1): Promise<string> => {
    const bytes = `${JSON.stringify(CharacterVisualIdentityApprovalV1Schema.parse(receipt), null, 2)}\n`;
    const path = createCharacterVisualIdentityApprovalPath(mediaRoot, characterId, identityVersion);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return sha(bytes);
  };

  for (const character of bible.characters) {
    const receipt = receiptFor(character, entries[character.id]!);
    options.mutateReceipt?.(character.id, receipt);
    character.visualIdentity.approval.receiptSha256 = await writeReceipt(character.id, receipt);
  }

  return {
    mediaRoot,
    bible,
    registry,
    masterPath: (characterId) => resolve(mediaRoot, ...entries[characterId]!.mediaRootRelativePath.split("/")),
    writeReceipt,
  };
}
