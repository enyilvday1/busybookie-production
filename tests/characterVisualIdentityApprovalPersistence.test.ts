import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CHARACTER_REFERENCE_ACCEPTANCE_RULES,
} from "../src/characterIdentity/characterVisualIdentityApproval.schema.js";

import {
  createCharacterVisualIdentityApprovalPath,
  createCharacterVisualIdentityApprovalRelativePath,
} from "../src/characterIdentity/characterVisualIdentityApprovalPath.js";

import {
  computeExactSourceTextSha256,
} from "../src/characterIdentity/characterVisualIdentityApprovalSource.js";

import { createCharacterVisualIdentityApproval } from "../src/characterIdentity/createCharacterVisualIdentityApproval.js";
import { readCharacterVisualIdentityApproval } from "../src/characterIdentity/readCharacterVisualIdentityApproval.js";
import { validateCharacterVisualIdentityApproval } from "../src/characterIdentity/validateCharacterVisualIdentityApproval.js";
import { verifyApprovedVisualReferenceAsset } from "../src/execution/verifyApprovedVisualReferenceAsset.js";
import { createVisualReferenceAssetRegistryPath } from "../src/execution/visualReferenceAssetRegistryPath.js";

type Json = Record<string, any>;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 9)]);
const ASSET_ID = "ollie-master-identity-reference-v1";
const RELATIVE = `references/characters/OLLIE/${ASSET_ID}.png`;
const APPROVAL_ID = "9b1f6a3e-2c4d-4e5f-8a7b-1c2d3e4f5a6b";
const APPROVED_AT = "2026-10-22T12:00:00.000Z";

// D1 creation-time contract (D-2): the frozen pre-1137E v1 CharacterBible fixture.
const bible = JSON.parse(readFileSync(new URL("./fixtures/characterBible.pre1137e.v1.json", import.meta.url), "utf8"));
const liveV2Bible = JSON.parse(readFileSync(new URL("../config/characters.json", import.meta.url), "utf8"));
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function sha(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function entry(overrides: Json = {}): Json {
  return { assetId: ASSET_ID, mediaRootRelativePath: RELATIVE, bytes: PNG.length, sha256: sha(PNG), contentType: "image/png", ...overrides };
}

async function fixture(registryEntry: Json = entry()) {
  const mediaRoot = await mkdtemp(join(tmpdir(), "busybookie-approval-persistence-"));
  roots.push(mediaRoot);

  const imagePath = resolve(mediaRoot, ...RELATIVE.split("/"));
  await mkdir(dirname(imagePath), { recursive: true });
  await writeFile(imagePath, PNG);

  const registry = { schemaVersion: "1.0", assets: [registryEntry] };
  await writeFile(createVisualReferenceAssetRegistryPath(mediaRoot), `${JSON.stringify(registry, null, 2)}\n`);

  return { mediaRoot, imagePath, registry };
}

function request(overrides: Json = {}): Json {
  return {
    referenceBindings: [{ role: "MASTER_IDENTITY", assetId: ASSET_ID }],
    defaultStateDecisions: [
      { itemKey: "BACKPACK", source: { field: "appearance.outfit", index: 0 }, disposition: "DEFAULT_STATE_ITEM", approvedDescription: "teal explorer backpack" },
      { itemKey: "PENDANT", source: { field: "appearance.accessories", index: 0 }, disposition: "DEFAULT_STATE_ITEM", approvedDescription: "small compass pendant" },
      { itemKey: "SATCHEL", source: { field: "appearance.accessories", index: 1 }, disposition: "EXCLUDED_SHOT_OR_STORY_STATE" },
    ],
    acceptanceAttestations: Object.fromEntries(CHARACTER_REFERENCE_ACCEPTANCE_RULES.map((rule) => [rule, true])),
    ...overrides,
  };
}

function create(mediaRoot: string, overrides: Json = {}, dependencies: Json = {}) {
  return createCharacterVisualIdentityApproval(
    mediaRoot,
    { bible, characterId: "OLLIE", targetIdentityVersion: 1, request: request(overrides) },
    { now: () => APPROVED_AT, createApprovalId: () => APPROVAL_ID, ...dependencies },
  );
}

async function approvalDirectoryFiles(mediaRoot: string): Promise<string[]> {
  return readdir(dirname(createCharacterVisualIdentityApprovalPath(mediaRoot, "OLLIE", 1)));
}

describe("approval create-once publication", () => {
  it("refuses CharacterBible v2 input explicitly and writes nothing (D-2 creation contract is v1 only)", async () => {
    const f = await fixture();

    await expect(createCharacterVisualIdentityApproval(
      f.mediaRoot,
      { bible: liveV2Bible, characterId: "OLLIE", targetIdentityVersion: 1, request: request() },
      { now: () => APPROVED_AT, createApprovalId: () => APPROVAL_ID },
    )).rejects.toThrow(/supports CharacterBible v1 only/);

    await expect(readFile(createCharacterVisualIdentityApprovalPath(f.mediaRoot, "OLLIE", 1))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("publishes a validated receipt at the canonical path with derived provenance", async () => {
    const f = await fixture();
    const result = await create(f.mediaRoot);

    expect(result.approvalPath).toBe(resolve(f.mediaRoot, ...createCharacterVisualIdentityApprovalRelativePath("OLLIE", 1).split("/")));
    expect(createCharacterVisualIdentityApprovalRelativePath("OLLIE", 1))
      .toBe("references/character-identity-approvals/OLLIE/OLLIE_IV1.character-visual-identity-approval.json");
    expect(result.record).toMatchObject({ approvalId: APPROVAL_ID, approvedAt: APPROVED_AT, status: "APPROVED", activationEffect: "NONE_EVIDENCE_ONLY" });
    expect(result.record.referenceBindings[0]!.registryEntry).toEqual(entry());
    expect(result.record.defaultStateDecisions[0]!.source.sourceTextSha256).toBe(computeExactSourceTextSha256("teal explorer backpack"));
    expect(result.approvalSha256).toBe(sha(await readFile(result.approvalPath)));
    expect(await approvalDirectoryFiles(f.mediaRoot)).toEqual(["OLLIE_IV1.character-visual-identity-approval.json"]);
  });

  it("never overwrites an existing receipt", async () => {
    const f = await fixture();
    const first = await create(f.mediaRoot);
    const bytes = await readFile(first.approvalPath);

    await expect(create(f.mediaRoot, { operatorNotes: "approved again" }, { createApprovalId: () => "1b1f6a3e-2c4d-4e5f-8a7b-1c2d3e4f5a6b" }))
      .rejects.toThrow(/already exists and is never replaced/);

    expect(await readFile(first.approvalPath)).toEqual(bytes);
    expect(await approvalDirectoryFiles(f.mediaRoot)).toEqual(["OLLIE_IV1.character-visual-identity-approval.json"]);
  });

  it("writes nothing when validation fails", async () => {
    const f = await fixture();

    await expect(create(f.mediaRoot, { operatorNotes: "pink or purple" })).rejects.toThrow();
    await expect(readFile(createCharacterVisualIdentityApprovalPath(f.mediaRoot, "OLLIE", 1))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects canonical path traversal", () => {
    expect(() => createCharacterVisualIdentityApprovalPath("/media", "../OLLIE", 1)).toThrow();
    expect(() => createCharacterVisualIdentityApprovalPath("/media", "OLLIE/../KACEY", 1)).toThrow();
    expect(() => createCharacterVisualIdentityApprovalPath("relative/media", "OLLIE", 1)).toThrow(/absolute/);
    expect(() => createCharacterVisualIdentityApprovalPath("/media", "OLLIE", 0)).toThrow();
  });
});

describe("strict approval reader", () => {
  it("fails when the receipt is missing", async () => {
    const f = await fixture();
    await expect(readCharacterVisualIdentityApproval(f.mediaRoot, "OLLIE", 1)).rejects.toThrow(/does not exist/);
  });

  it("rejects malformed JSON and an invalid schema", async () => {
    const f = await fixture();
    const path = createCharacterVisualIdentityApprovalPath(f.mediaRoot, "OLLIE", 1);
    await mkdir(dirname(path), { recursive: true });

    await writeFile(path, "{broken");
    await expect(readCharacterVisualIdentityApproval(f.mediaRoot, "OLLIE", 1)).rejects.toThrow(/malformed JSON/);

    await writeFile(path, JSON.stringify({ schemaVersion: "2.0" }));
    await expect(readCharacterVisualIdentityApproval(f.mediaRoot, "OLLIE", 1)).rejects.toThrow(/is invalid/);
  });

  it("rejects a record whose character or identity version does not match its path", async () => {
    const f = await fixture();
    const created = await create(f.mediaRoot);
    const record = created.record as Json;

    const kaceyPath = createCharacterVisualIdentityApprovalPath(f.mediaRoot, "KACEY", 1);
    await mkdir(dirname(kaceyPath), { recursive: true });
    await writeFile(kaceyPath, JSON.stringify(record));
    await expect(readCharacterVisualIdentityApproval(f.mediaRoot, "KACEY", 1)).rejects.toThrow(/names OLLIE, not KACEY/);

    await writeFile(createCharacterVisualIdentityApprovalPath(f.mediaRoot, "OLLIE", 2), JSON.stringify(record));
    await expect(readCharacterVisualIdentityApproval(f.mediaRoot, "OLLIE", 2)).rejects.toThrow(/targets identity version 1, not 2/);
  });
});

describe("registry evidence", () => {
  async function storedReceipt(): Promise<{ mediaRoot: string; record: Json; registry: Json }> {
    const f = await fixture();
    const { record } = await create(f.mediaRoot);

    return { mediaRoot: f.mediaRoot, record: structuredClone(record) as Json, registry: f.registry };
  }

  it("accepts a snapshot that exactly matches the live registry entry", async () => {
    const { mediaRoot, record, registry } = await storedReceipt();
    await expect(validateCharacterVisualIdentityApproval({ mediaRoot, approval: record, bible, registry })).resolves.toBeDefined();
  });

  it.each([
    ["sha256", "d".repeat(64)],
    ["mediaRootRelativePath", "references/characters/OLLIE/other.png"],
    ["bytes", 41],
    ["contentType", "image/webp"],
  ])("rejects a copied %s that differs from the live registry", async (field, value) => {
    const { mediaRoot, record, registry } = await storedReceipt();
    record.referenceBindings[0].registryEntry[field] = value;

    await expect(validateCharacterVisualIdentityApproval({ mediaRoot, approval: record, bible, registry }))
      .rejects.toThrow(new RegExp(`snapshot ${field} differs`));
  });

  it("rejects an unregistered asset", async () => {
    const f = await fixture();
    await expect(create(f.mediaRoot, { referenceBindings: [{ role: "MASTER_IDENTITY", assetId: "ollie-master-identity-reference-v2" }] }))
      .rejects.toThrow(/is not registered/);
  });

  it("rejects physical SHA-256 and byte-count drift", async () => {
    const shaDrift = await fixture();
    await writeFile(shaDrift.imagePath, Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(32, 1)]));
    await expect(create(shaDrift.mediaRoot)).rejects.toThrow(/SHA-256 mismatch/);

    const byteDrift = await fixture();
    await writeFile(byteDrift.imagePath, Buffer.concat([PNG, Buffer.alloc(4)]));
    await expect(create(byteDrift.mediaRoot)).rejects.toThrow(/byte-count mismatch/);
  });

  it("rejects a physical content type that differs from the registry", async () => {
    const f = await fixture(entry({ contentType: "image/jpeg" }));
    await expect(create(f.mediaRoot)).rejects.toThrow(/content type mismatch/);
  });

  it("rejects a realpath escape", async () => {
    const f = await fixture();

    await expect(create(f.mediaRoot, {}, {
      verifyAsset: (input: Parameters<typeof verifyApprovedVisualReferenceAsset>[0]) => verifyApprovedVisualReferenceAsset(input, {
        realpath: async (path: string) => (path === resolve(f.imagePath) ? join(tmpdir(), "escaped.png") : resolve(path)),
      }),
    })).rejects.toThrow(/outside the trusted references root/);
  });

  it("rejects a non-regular source", async () => {
    const f = await fixture();
    await unlink(f.imagePath);
    await mkdir(f.imagePath);

    await expect(create(f.mediaRoot)).rejects.toThrow(/not a regular file/);
  });
});
