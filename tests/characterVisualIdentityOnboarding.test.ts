import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CHARACTER_REFERENCE_ACCEPTANCE_RULES } from "../src/characterIdentity/characterVisualIdentityApproval.schema.js";
import { findUnresolvedApprovalWording } from "../src/characterIdentity/characterVisualIdentityApprovalAmbiguity.js";

import {
  approveCharacterVisualIdentity,
  characterReferenceRelativePath,
  registerCharacterReferenceAsset,
} from "../src/characterIdentity/onboardCharacterVisualIdentity.js";

import { readVisualReferenceRegistrySha256 } from "../src/execution/appendVisualReferenceAssetRegistry.js";
import { createVisualReferenceAssetRegistryPath } from "../src/execution/visualReferenceAssetRegistryPath.js";
import { computeCharacterBibleCanonicalSha256 } from "../src/characterIdentity/characterVisualIdentityApprovalSource.js";
import { HistoricalCharacterBibleV1Schema as CharacterBibleSchema } from "../src/schemas/historicalCharacterBible.schema.js";

type Json = Record<string, any>;

// D1 creation-time contract (D-2): the frozen pre-1137E v1 CharacterBible. It is a byte copy of config/characters.json
// as it stood at the D2 approvals (raw sha cbb68ce6..., canonical a4825c43... = every IV1 receipt's source digest).
const BIBLE_URL = new URL("./fixtures/characterBible.pre1137e.v1.json", import.meta.url);
const BIBLE_BYTES_SHA256 = "cbb68ce6e5ad758636cdd3adeeae340f890f5745df4e8e7cbd9ec2e88352c96f";
const BIBLE_CANONICAL_SHA256 = "a4825c432fdecbf7415d714689fbe5efb1783a09bf628e3b238c68b2730b524d";
const bible = CharacterBibleSchema.parse(JSON.parse(readFileSync(BIBLE_URL, "utf8")));

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function png(seed: number): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(48, seed)]);
}

function attestations(): Json {
  return Object.fromEntries(CHARACTER_REFERENCE_ACCEPTANCE_RULES.map((rule) => [rule, true]));
}

const REQUESTS: Record<string, Json> = {
  OLLIE: {
    defaultStateDecisions: [
      { itemKey: "BACKPACK", source: { field: "appearance.outfit", index: 0 }, disposition: "DEFAULT_STATE_ITEM", approvedDescription: "teal explorer backpack" },
      { itemKey: "PENDANT", source: { field: "appearance.accessories", index: 0 }, disposition: "DEFAULT_STATE_ITEM", approvedDescription: "small compass pendant" },
      { itemKey: "SATCHEL", source: { field: "appearance.accessories", index: 1 }, disposition: "EXCLUDED_SHOT_OR_STORY_STATE" },
    ],
  },
  KACEY: {
    defaultStateDecisions: [
      { itemKey: "BACKPACK", source: { field: "appearance.outfit", index: 0 }, disposition: "DEFAULT_STATE_ITEM", resolutions: [{ attribute: "COLOUR", valueCode: "pink" }], approvedDescription: "pink backpack" },
      { itemKey: "SCARF", source: { field: "appearance.outfit", index: 1 }, disposition: "DEFAULT_STATE_ITEM", resolutions: [{ attribute: "COLOUR", valueCode: "PINK" }], approvedDescription: "pink neck scarf" },
      { itemKey: "HAIR_ACCESSORY", source: { field: "appearance.accessories", index: 0 }, disposition: "DEFAULT_STATE_ITEM", resolutions: [{ attribute: "FORM", valueCode: "LEAF" }], approvedDescription: "small leaf hair accessory" },
    ],
    operatorNotes: "approved PINK backpack, PINK scarf and LEAF hair accessory",
  },
  MONT: {
    defaultStateDecisions: [
      { itemKey: "BACKPACK", source: { field: "appearance.outfit", index: 0 }, disposition: "DEFAULT_STATE_ITEM", approvedDescription: "green explorer backpack" },
      { itemKey: "CAP", source: { field: "appearance.outfit", index: 1 }, disposition: "DEFAULT_STATE_ITEM", approvedDescription: "yellow cap with a leaf emblem" },
      { itemKey: "GREEN_EXPLORER_ACCENTS", source: { field: "appearance.accessories", index: 0 }, disposition: "PRESENTATION_GUIDANCE_NOT_STATE" },
    ],
  },
};

function request(characterId: string, overrides: Json = {}): Json {
  return {
    referenceBindings: [{ role: "MASTER_IDENTITY", assetId: `${characterId.toLowerCase()}-master-identity-reference-v1` }],
    acceptanceAttestations: attestations(),
    ...structuredClone(REQUESTS[characterId]),
    ...overrides,
  };
}

async function mediaRootWithRegistry(): Promise<string> {
  const mediaRoot = await mkdtemp(join(tmpdir(), "busybookie-onboarding-"));
  roots.push(mediaRoot);

  const registryPath = createVisualReferenceAssetRegistryPath(mediaRoot);
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(registryPath, `${JSON.stringify({ schemaVersion: "1.0", assets: [] }, null, 2)}\n`);

  return mediaRoot;
}

async function placeReference(mediaRoot: string, characterId: string, seed: number): Promise<string> {
  const assetId = `${characterId.toLowerCase()}-master-identity-reference-v1`;
  const path = resolve(mediaRoot, ...characterReferenceRelativePath(assetId, ".png").split("/"));

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, png(seed));

  return path;
}

async function register(mediaRoot: string, characterId: string, seed: number) {
  const sourceFile = await placeReference(mediaRoot, characterId, seed);

  return registerCharacterReferenceAsset({
    mediaRoot,
    sourceFile,
    assetId: `${characterId.toLowerCase()}-master-identity-reference-v1`,
    expectedRegistrySha256: await readVisualReferenceRegistrySha256(mediaRoot),
  });
}

function approve(mediaRoot: string, characterId: string, body: Json = request(characterId)) {
  return approveCharacterVisualIdentity(
    { mediaRoot, characterId, targetIdentityVersion: 1, request: body },
    { readCharacterBibleDocument: async () => bible },
  );
}

describe("Operation A: register reference asset", () => {
  it("registers each character master at its canonical path with derived evidence", async () => {
    const mediaRoot = await mediaRootWithRegistry();
    const before = await readVisualReferenceRegistrySha256(mediaRoot);
    const result = await register(mediaRoot, "OLLIE", 1);

    expect(result.previousRegistrySha256).toBe(before);
    expect(result.registrySha256).toBe(await readVisualReferenceRegistrySha256(mediaRoot));
    expect(result.entry).toMatchObject({
      assetId: "ollie-master-identity-reference-v1",
      mediaRootRelativePath: "references/characters/OLLIE/ollie-master-identity-reference-v1.png",
      contentType: "image/png",
    });

    await register(mediaRoot, "KACEY", 2);
    const mont = await register(mediaRoot, "MONT", 3);
    expect(mont.registry.assets.map((asset) => asset.assetId)).toEqual([
      "ollie-master-identity-reference-v1",
      "kacey-master-identity-reference-v1",
      "mont-master-identity-reference-v1",
    ]);
  });

  it("rejects a file outside its canonical character reference path", async () => {
    const mediaRoot = await mediaRootWithRegistry();
    const misplaced = join(mediaRoot, "references", "ollie.png");
    await writeFile(misplaced, png(1));

    await expect(registerCharacterReferenceAsset({
      mediaRoot,
      sourceFile: misplaced,
      assetId: "ollie-master-identity-reference-v1",
      expectedRegistrySha256: await readVisualReferenceRegistrySha256(mediaRoot),
    })).rejects.toThrow(/canonical path/);

    expect(() => characterReferenceRelativePath("ollie-master-identity-reference-v1", ".gif")).toThrow(/extension/);
    expect(() => characterReferenceRelativePath("OLLIE_MASTER_IDENTITY_V1", ".png")).toThrow();
  });

  it("fails on a missing registry or wrong expected digest", async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), "busybookie-onboarding-missing-"));
    roots.push(mediaRoot);
    const sourceFile = await placeReference(mediaRoot, "OLLIE", 1);

    await expect(registerCharacterReferenceAsset({
      mediaRoot, sourceFile, assetId: "ollie-master-identity-reference-v1", expectedRegistrySha256: "0".repeat(64),
    })).rejects.toThrow(/does not exist/);
    await expect(readFile(createVisualReferenceAssetRegistryPath(mediaRoot))).rejects.toMatchObject({ code: "ENOENT" });

    const withRegistry = await mediaRootWithRegistry();
    await expect(registerCharacterReferenceAsset({
      mediaRoot: withRegistry,
      sourceFile: await placeReference(withRegistry, "OLLIE", 1),
      assetId: "ollie-master-identity-reference-v1",
      expectedRegistrySha256: "0".repeat(64),
    })).rejects.toThrow(/registry changed/);
  });
});

describe("Operation B: approve character identity evidence", () => {
  it.each(["OLLIE", "KACEY", "MONT"])("records the frozen %s outcome as resolved evidence", async (characterId) => {
    const mediaRoot = await mediaRootWithRegistry();
    await register(mediaRoot, characterId, 5);

    const result = await approve(mediaRoot, characterId);
    const stored = await readFile(result.approvalPath, "utf8");

    // The source prose is never copied: only coordinates plus sourceTextSha256.
    const character = bible.characters.find((candidate) => candidate.id === characterId)!;

    for (const text of [...character.appearance.outfit, ...character.appearance.accessories]) {
      if (findUnresolvedApprovalWording(text) !== null) expect(stored).not.toContain(text);
    }

    expect(stored).not.toContain("\"sourceText\"");
    expect(stored).not.toMatch(/\bor\b|when required/i);

    for (const decision of result.record.defaultStateDecisions) {
      expect(decision.source.sourceTextSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("captures Kacey's concrete choices as canonical value codes", async () => {
    const mediaRoot = await mediaRootWithRegistry();
    await register(mediaRoot, "KACEY", 6);

    const { record } = await approve(mediaRoot, "KACEY");

    expect(record.defaultStateDecisions.map((decision) => decision.resolutions)).toEqual([
      [{ attribute: "COLOUR", valueCode: "PINK" }],
      [{ attribute: "COLOUR", valueCode: "PINK" }],
      [{ attribute: "FORM", valueCode: "LEAF" }],
    ]);
    expect(await readFile(join(mediaRoot, "references", "character-identity-approvals", "KACEY", "KACEY_IV1.character-visual-identity-approval.json"), "utf8"))
      .not.toMatch(/purple|flower/i);
  });

  it("keeps Ollie's satchel excluded and Mont's accents as presentation guidance", async () => {
    const mediaRoot = await mediaRootWithRegistry();
    await register(mediaRoot, "OLLIE", 7);
    await register(mediaRoot, "MONT", 8);

    const ollie = await approve(mediaRoot, "OLLIE");
    const mont = await approve(mediaRoot, "MONT");

    expect(ollie.record.defaultStateDecisions.find((decision) => decision.itemKey === "SATCHEL"))
      .toMatchObject({ disposition: "EXCLUDED_SHOT_OR_STORY_STATE", resolutions: [] });
    expect(ollie.record.defaultStateDecisions.find((decision) => decision.itemKey === "SATCHEL")).not.toHaveProperty("approvedDescription");
    expect(mont.record.defaultStateDecisions.find((decision) => decision.itemKey === "GREEN_EXPLORER_ACCENTS"))
      .toMatchObject({ disposition: "PRESENTATION_GUIDANCE_NOT_STATE" });
    expect(mont.record.defaultStateDecisions).toHaveLength(3);
  });

  it("rejects a Kacey value outside the source alternatives", async () => {
    const mediaRoot = await mediaRootWithRegistry();
    await register(mediaRoot, "KACEY", 9);
    const body = request("KACEY");
    body.defaultStateDecisions[0].resolutions = [{ attribute: "COLOUR", valueCode: "RED" }];

    await expect(approve(mediaRoot, "KACEY", body)).rejects.toThrow(/not one of the alternatives/);
  });

  it("requires every human acceptance attestation to be confirmed", async () => {
    const mediaRoot = await mediaRootWithRegistry();
    await register(mediaRoot, "OLLIE", 10);
    const body = request("OLLIE");
    body.acceptanceAttestations.AR09_EXCLUDED_ITEMS_ABSENT = false;

    await expect(approve(mediaRoot, "OLLIE", body)).rejects.toThrow(/AR09_EXCLUDED_ITEMS_ABSENT/);
  });

  it("does not let the operator request inject trusted values", async () => {
    const mediaRoot = await mediaRootWithRegistry();
    await register(mediaRoot, "OLLIE", 11);

    const injections: Json[] = [
      { approvalId: "9b1f6a3e-2c4d-4e5f-8a7b-1c2d3e4f5a6b" },
      { approvedAt: "2020-01-01T00:00:00.000Z" },
      { sourceCharacterBible: { schemaVersion: "1.0", canonicalSha256: "a".repeat(64) } },
      { status: "APPROVED" },
      { activationEffect: "NONE_EVIDENCE_ONLY" },
      { authorizationSource: "HUMAN_OPERATOR" },
      { workflowStep: "E9_STEP_1137D" },
    ];

    for (const injection of injections) {
      await expect(approve(mediaRoot, "OLLIE", request("OLLIE", injection)), JSON.stringify(injection))
        .rejects.toThrow(/operator request is invalid/);
    }

    const sourceHash = request("OLLIE");
    sourceHash.defaultStateDecisions[0].source.sourceTextSha256 = "a".repeat(64);
    await expect(approve(mediaRoot, "OLLIE", sourceHash)).rejects.toThrow(/operator request is invalid/);

    const registryEntry = request("OLLIE");
    registryEntry.referenceBindings[0].registryEntry = { assetId: "ollie-master-identity-reference-v1" };
    await expect(approve(mediaRoot, "OLLIE", registryEntry)).rejects.toThrow(/operator request is invalid/);

    const sourceText = request("OLLIE");
    sourceText.defaultStateDecisions[0].source.sourceText = "teal explorer backpack";
    await expect(approve(mediaRoot, "OLLIE", sourceText)).rejects.toThrow(/operator request is invalid/);
  });

  it("keeps the frozen v1 fixture byte-identical to the pre-1137E config and to the IV1 source digest", () => {
    expect(createHash("sha256").update(readFileSync(BIBLE_URL)).digest("hex")).toBe(BIBLE_BYTES_SHA256);
    expect(computeCharacterBibleCanonicalSha256(bible)).toBe(BIBLE_CANONICAL_SHA256);
  });

  it("refuses to create an IV1 approval from the live CharacterBible v2 (D-2)", async () => {
    const mediaRoot = await mediaRootWithRegistry();
    await register(mediaRoot, "OLLIE", 12);

    // Default path: the canonical config/characters.json, which is v2 after activation.
    await expect(approveCharacterVisualIdentity({ mediaRoot, characterId: "OLLIE", targetIdentityVersion: 1, request: request("OLLIE") }))
      .rejects.toThrow(/supports CharacterBible v1 only[\s\S]*later identity-version approval contract/);
    await expect(readFile(join(mediaRoot, "references", "character-identity-approvals", "OLLIE", "OLLIE_IV1.character-visual-identity-approval.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});
