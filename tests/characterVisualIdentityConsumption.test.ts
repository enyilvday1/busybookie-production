import { readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalCharacterIdentityJson, characterIdentitySha256 } from "../src/characterIdentity/canonicalCharacterIdentityJson.js";

import {
  assertCharacterVisualIdentityConsumptionVerificationMatchesAuthority,
  characterVisualIdentityConsumptionAuthoritySha256,
  corroboratesLegacyIv1ReceiptNote,
  isVerifiedCharacterIdentityConsumption,
  textContainsMachineCode,
  verifyCharacterVisualIdentityApprovalForConsumption,
} from "../src/characterIdentity/verifyCharacterVisualIdentityApprovalForConsumption.js";

import type { Character } from "../src/schemas/character.schema.js";

import {
  createConsumptionFixture,
  HISTORICAL_SOURCE_CANONICAL_SHA256,
  IV1_OPERATOR_NOTES,
  receiptFor,
  type ConsumptionFixture,
  type Json,
} from "./fixtures/characterIdentityConsumptionFixture.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(options: Parameters<typeof createConsumptionFixture>[0] = {}): Promise<ConsumptionFixture> {
  const created = await createConsumptionFixture(options);
  roots.push(created.mediaRoot);
  return created;
}

function character(f: ConsumptionFixture, id: string): Json {
  return f.bible.characters.find((candidate: Json) => candidate.id === id);
}

function verify(f: ConsumptionFixture, characterId: string) {
  return verifyCharacterVisualIdentityApprovalForConsumption({ mediaRoot: f.mediaRoot, bible: f.bible, characterId });
}

describe("verifyCharacterVisualIdentityApprovalForConsumption", () => {
  it.each(["OLLIE", "KACEY", "MONT"])("verifies %s against its pinned IV1 receipt, registry and physical master", async (id) => {
    const f = await fixture();
    const result = await verify(f, id);

    expect(result).toMatchObject({
      result: "CONSUMPTION_VERIFIED",
      characterId: id,
      identityVersion: 1,
      approvalId: character(f, id).visualIdentity.approval.approvalId,
      receiptSha256: character(f, id).visualIdentity.approval.receiptSha256,
      masterAssetId: `${id.toLowerCase()}-master-identity-reference-v1`,
      physicalVerification: "PASS",
      historicalSourceDigestEqualityRequired: false,
    });
    expect(isVerifiedCharacterIdentityConsumption(result)).toBe(true);
  });

  it("keeps the historical source digest as provenance without comparing it to the migrated CharacterBible", async () => {
    const f = await fixture();
    const result = await verify(f, "OLLIE");
    const current = characterIdentitySha256(canonicalCharacterIdentityJson(f.bible));

    expect(result.historicalSourceCharacterBible).toEqual({ schemaVersion: "1.0", canonicalSha256: HISTORICAL_SOURCE_CANONICAL_SHA256 });
    expect(result.currentCharacterBibleCanonicalSha256).not.toBe(HISTORICAL_SOURCE_CANONICAL_SHA256);
    expect(result.currentCharacterBibleCanonicalSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof current).toBe("string");
  });

  it("rejects a receipt for a different character at the character's path", async () => {
    const f = await fixture({ mutateReceipt: (id, receipt) => {
      if (id === "OLLIE") {
        receipt.characterId = "KACEY";
        receipt.referenceBindings[0].assetId = "kacey-master-identity-reference-v1";
        receipt.referenceBindings[0].registryEntry.assetId = "kacey-master-identity-reference-v1";
      }
    } });

    await expect(verify(f, "OLLIE")).rejects.toThrow(/receipt unavailable[\s\S]*names KACEY, not OLLIE/);
  });

  it("rejects a wrong identity version (no receipt at IV2) and a missing receipt", async () => {
    const f = await fixture();
    character(f, "OLLIE").visualIdentity.identityVersion = 2;
    await expect(verify(f, "OLLIE")).rejects.toThrow(/IV2 receipt unavailable/);

    const g = await fixture();
    await rm(`${g.mediaRoot}/references/character-identity-approvals/KACEY`, { recursive: true, force: true });
    await expect(verify(g, "KACEY")).rejects.toThrow(/receipt unavailable/);
  });

  it("rejects a wrong master asset binding", async () => {
    const f = await fixture();
    character(f, "MONT").visualIdentity.referenceBindings[0].assetId = "mont-master-identity-reference-v2";
    await expect(verify(f, "MONT")).rejects.toThrow(/bindings differ from the approved receipt/);
  });

  it("rejects an approval link that does not pin the receipt", async () => {
    const f = await fixture();
    character(f, "KACEY").visualIdentity.approval.receiptSha256 = "0".repeat(64);
    await expect(verify(f, "KACEY")).rejects.toThrow(/does not match the approval link/);

    const g = await fixture();
    character(g, "KACEY").visualIdentity.approval.approvalId = "22222222-2222-4222-8222-222222222222";
    await expect(verify(g, "KACEY")).rejects.toThrow(/approvalId .* does not match the approval link/);
  });

  it("rejects physical master drift and registry/receipt snapshot drift", async () => {
    const f = await fixture();
    const original = readFileSync(f.masterPath("OLLIE"));
    await writeFile(f.masterPath("OLLIE"), Buffer.concat([original.subarray(0, 8), Buffer.alloc(original.length - 8, 99)]));
    await expect(verify(f, "OLLIE")).rejects.toThrow(/SHA-256 mismatch/);

    const g = await fixture({ mutateReceipt: (id, receipt) => {
      if (id === "MONT") receipt.referenceBindings[0].registryEntry.sha256 = "c".repeat(64);
    } });
    await expect(verify(g, "MONT")).rejects.toThrow(/registry entry differs from the approved receipt snapshot/);
  });

  it("rejects a PENDING canonical identity", async () => {
    const f = await fixture();
    const ollie = character(f, "OLLIE");
    const { approval: _link, ...pending } = ollie.visualIdentity;
    ollie.visualIdentity = { ...pending, status: "PENDING" };
    await expect(verify(f, "OLLIE")).rejects.toThrow(/PENDING, not LOCKED/);
  });

  it("requires current default, shot and guidance state to equal the receipt decisions one-to-one", async () => {
    const changed = await fixture();
    character(changed, "KACEY").defaultContinuityState.items[0].description = "pink explorer backpack";
    await expect(verify(changed, "KACEY")).rejects.toThrow(/defaultContinuityState does not exactly match/);

    const extra = await fixture();
    character(extra, "OLLIE").defaultContinuityState.items.push({ itemKey: "HAT", description: "explorer hat", resolutions: [] });
    await expect(verify(extra, "OLLIE")).rejects.toThrow(/defaultContinuityState does not exactly match/);

    const satchelAsDefault = await fixture();
    const ollie = character(satchelAsDefault, "OLLIE");
    ollie.shotOrStoryStateItems = [];
    ollie.defaultContinuityState.items.push({ itemKey: "SATCHEL", description: "explorer satchel", resolutions: [] });
    await expect(verify(satchelAsDefault, "OLLIE")).rejects.toThrow(/does not exactly match/);

    const guidanceDropped = await fixture();
    character(guidanceDropped, "MONT").presentationGuidance = [];
    await expect(verify(guidanceDropped, "MONT")).rejects.toThrow(/presentationGuidance does not exactly match/);

    const wrongColour = await fixture();
    character(wrongColour, "KACEY").defaultContinuityState.items[1].resolutions = [{ attribute: "COLOUR", valueCode: "PURPLE" }];
    await expect(verify(wrongColour, "KACEY")).rejects.toThrow(/defaultContinuityState does not exactly match/);
  });

  it("corroborates supplemental IV1 decisions from the exact pinned notes and fails on a mismatched current trait", async () => {
    const f = await fixture();
    const ollie = await verify(f, "OLLIE");

    expect(ollie.traitDecisionEvidence).toEqual([
      expect.objectContaining({ traitKey: "PAW_FUR_COLOUR", valueCode: "BROWN", currentStructuredAuthority: true, historicalReceiptCorroboration: true, structuredReceiptProof: false }),
      expect.objectContaining({ traitKey: "PAW_PAD_COLOUR", valueCode: "DARK_BROWN", historicalReceiptCorroboration: true, structuredReceiptProof: false }),
      expect.objectContaining({ traitKey: "PINK_PAWS", valueCode: "PROHIBITED", historicalReceiptCorroboration: true, structuredReceiptProof: false }),
    ]);

    const mont = await verify(f, "MONT");
    expect(mont.traitDecisionEvidence.find((evidence) => evidence.traitKey === "INNER_EAR_COLOUR"))
      .toMatchObject({ provenance: "CHARACTER_BIBLE_SOURCE", characterBibleSourceVerified: true, historicalReceiptCorroboration: false });

    const changed = await fixture();
    character(changed, "OLLIE").visualIdentity.approvedTraitDecisions[1].valueCode = "BLACK";
    await expect(verify(changed, "OLLIE")).rejects.toThrow(/PAW_PAD_COLOUR=BLACK is not corroborated/);

    const invented = await fixture();
    character(invented, "KACEY").visualIdentity.approvedTraitDecisions[0].legacyIv1ReceiptNoteCorroboration = "DARK_BROWN tail tip";
    await expect(verify(invented, "KACEY")).rejects.toThrow(/is not corroborated/);

    const sourceText = await fixture();
    character(sourceText, "MONT").visualIdentity.approvedTraitDecisions[1].characterBibleSourceText = "soft pink inner ears";
    await expect(verify(sourceText, "MONT")).rejects.toThrow(/not the allowlisted legacy IV1 decision for MONT INNER_EAR_COLOUR/);

    // The allowlisted CharacterBible-sourced decision must still quote the current identity prose exactly.
    const prose = await fixture();
    const montProse = character(prose, "MONT");
    const ears = "large rounded ears with soft pink inner ears";
    montProse.appearance.distinguishingFeatures = montProse.appearance.distinguishingFeatures.map((text: string) => text === ears ? "large rounded ears" : text);
    montProse.visualIdentity.invariantTraits = montProse.visualIdentity.invariantTraits.map((text: string) => text === ears ? "large rounded ears" : text);
    await expect(verify(prose, "MONT")).rejects.toThrow(/does not match its CharacterBible identity source text/);
  });

  it("accepts only the closed legacy IV1 allowlist keyed by character + trait + value (M3)", async () => {
    const human = (traitKey: string, valueCode: string, description: string, phrase: string) =>
      ({ traitKey, valueCode, description, provenance: "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION", legacyIv1ReceiptNoteCorroboration: phrase });

    const cases: Array<[string, string, (c: Json) => void, RegExp]> = [
      ["wrong trait, same value: Ollie pads BROWN citing the paw-fur phrase", "OLLIE", (c) => {
        c.visualIdentity.approvedTraitDecisions[1] = human("PAW_PAD_COLOUR", "BROWN", "brown paw pads", "BROWN paw fur");
      }, /OLLIE PAW_PAD_COLOUR=BROWN is not corroborated[\s\S]*not the allowlisted/],
      ["invented trait: Kacey nose PINK citing the backpack text", "KACEY", (c) => {
        c.visualIdentity.approvedTraitDecisions.push(human("NOSE_COLOUR", "PINK", "pink nose", "PINK backpack"));
      }, /KACEY NOSE_COLOUR=PINK is not corroborated[\s\S]*not the allowlisted/],
      ["invented trait: Mont accessory BLUE_GREY citing the body phrase", "MONT", (c) => {
        c.visualIdentity.approvedTraitDecisions.push(human("SCARF_COLOUR", "BLUE_GREY", "blue-grey scarf", "blue-grey body, hands and feet"));
      }, /MONT SCARF_COLOUR=BLUE_GREY is not corroborated/],
      ["changed description of an allowlisted decision", "OLLIE", (c) => {
        c.visualIdentity.approvedTraitDecisions[0].description = "pink paw fur";
      }, /OLLIE PAW_FUR_COLOUR=BROWN is not corroborated/],
      ["dropped allowlisted decision", "MONT", (c) => {
        c.visualIdentity.approvedTraitDecisions.splice(2, 1);
      }, /do not exactly equal the allowlisted legacy IV1 decisions/],
      ["provenance switch", "KACEY", (c) => {
        const [decision] = c.visualIdentity.approvedTraitDecisions;
        c.visualIdentity.approvedTraitDecisions[0] = { traitKey: decision.traitKey, valueCode: decision.valueCode, description: decision.description,
          provenance: "CHARACTER_BIBLE_SOURCE", characterBibleSourceText: c.appearance.body };
      }, /KACEY PAW_FUR_COLOUR=DARK_BROWN is not corroborated/],
    ];

    for (const [label, id, mutate, error] of cases) {
      const f = await fixture();
      mutate(character(f, id));
      await expect(verify(f, id), label).rejects.toThrow(error);
    }
  });

  it.each([["OLLIE", 3], ["KACEY", 1], ["MONT", 3]] as const)(
    "rejects %s with all approved trait decisions removed (exact set of %i required, M1137E2A2-1)",
    async (id, expected) => {
      const f = await fixture();
      expect(character(f, id).visualIdentity.approvedTraitDecisions).toHaveLength(expected);

      character(f, id).visualIdentity.approvedTraitDecisions = [];
      await expect(verify(f, id)).rejects.toThrow(new RegExp(`${id} approvedTraitDecisions do not exactly equal the allowlisted legacy IV1 decisions \\(expected ${expected}, found 0\\)`));
    },
  );

  it("rejects one missing decision, a duplicate decision, and accepts the exact set in any order", async () => {
    const dropOne = await fixture();
    character(dropOne, "OLLIE").visualIdentity.approvedTraitDecisions.splice(2, 1);
    await expect(verify(dropOne, "OLLIE")).rejects.toThrow(/do not exactly equal the allowlisted legacy IV1 decisions \(expected 3, found 2\)/);

    // Duplicate semantic decisions are rejected at the strict CharacterBible schema layer before trait verification.
    const duplicate = await fixture();
    const decisions = character(duplicate, "OLLIE").visualIdentity.approvedTraitDecisions;
    decisions.push(structuredClone(decisions[0]));
    await expect(verify(duplicate, "OLLIE")).rejects.toThrow(/CharacterBible v2 is invalid[\s\S]*approved trait traitKey/);

    const reordered = await fixture();
    character(reordered, "MONT").visualIdentity.approvedTraitDecisions.reverse();
    await expect(verify(reordered, "MONT")).resolves.toMatchObject({ result: "CONSUMPTION_VERIFIED" });
  });

  it("requires a pinned IV1 character to use its allowlisted approval even with no trait decisions", async () => {
    const otherApproval = "44444444-4444-4444-8444-444444444444";
    const f = await fixture({ mutateReceipt: (id, receipt) => { if (id === "KACEY") receipt.approvalId = otherApproval; } });
    character(f, "KACEY").visualIdentity.approval.approvalId = otherApproval;
    character(f, "KACEY").visualIdentity.approvedTraitDecisions = [];

    await expect(verify(f, "KACEY")).rejects.toThrow(/not a legacy IV1 receipt in the closed migration allowlist/);
  });

  it("binds the allowlist to the pinned IV1 receipt: approvalId, operatorNotes and historical source", async () => {
    const otherApproval = "33333333-3333-4333-8333-333333333333";
    const unknown = await fixture({ mutateReceipt: (id, receipt) => { if (id === "OLLIE") receipt.approvalId = otherApproval; } });
    character(unknown, "OLLIE").visualIdentity.approval.approvalId = otherApproval;
    await expect(verify(unknown, "OLLIE")).rejects.toThrow(/not a legacy IV1 receipt in the closed migration allowlist/);

    // Notes still containing every phrase, but not the exact pinned IV1 text.
    const notes = await fixture({ mutateReceipt: (id, receipt) => { if (id === "KACEY") receipt.operatorNotes = `${receipt.operatorNotes} Also PINK nose.`; } });
    await expect(verify(notes, "KACEY")).rejects.toThrow(/not a legacy IV1 receipt in the closed migration allowlist/);

    const source = await fixture({ mutateReceipt: (id, receipt) => { if (id === "MONT") receipt.sourceCharacterBible.canonicalSha256 = "d".repeat(64); } });
    await expect(verify(source, "MONT")).rejects.toThrow(/not a legacy IV1 receipt in the closed migration allowlist/);
  });

  it("has no public physical-verification override: corrupted master bytes always fail (M2)", async () => {
    expect(verifyCharacterVisualIdentityApprovalForConsumption.length).toBe(1);

    const f = await fixture();
    await writeFile(f.masterPath("MONT"), Buffer.from("not the approved bytes"));

    // An attempted no-op override is ignored; the genuine verifier still runs.
    const noOp = { verifyAsset: async () => ({}) };
    await expect(Reflect.apply(verifyCharacterVisualIdentityApprovalForConsumption, undefined,
      [{ mediaRoot: f.mediaRoot, bible: f.bible, characterId: "MONT" }, noOp])).rejects.toThrow(/mismatch/);
  });

  it("binds each genuine result to the exact current character authority (M1)", async () => {
    const f = await fixture();
    const result = await verify(f, "OLLIE");
    const ollie = () => character(f, "OLLIE");

    expect(result.currentCharacterAuthoritySha256).toBe(characterVisualIdentityConsumptionAuthoritySha256(ollie() as Character));
    expect(assertCharacterVisualIdentityConsumptionVerificationMatchesAuthority(result, ollie())).toBe(result);

    ollie().promptAnchor = "Ollie is a purple dragon.";
    ollie().voice = structuredClone(character(f, "KACEY").voice);
    expect(assertCharacterVisualIdentityConsumptionVerificationMatchesAuthority(result, ollie())).toBe(result);

    expect(() => assertCharacterVisualIdentityConsumptionVerificationMatchesAuthority(result, character(f, "KACEY")))
      .toThrow(/does not match the current authority of KACEY/);

    for (const forged of [{ ...result }, Object.freeze({ ...result }), structuredClone(result), JSON.parse(JSON.stringify(result))]) {
      expect(isVerifiedCharacterIdentityConsumption(forged)).toBe(false);
      expect(() => assertCharacterVisualIdentityConsumptionVerificationMatchesAuthority(forged, ollie())).toThrow(/not issued by the consumption verifier/);
    }

    ollie().defaultContinuityState.items[0].description = "teal explorer rucksack";
    expect(() => assertCharacterVisualIdentityConsumptionVerificationMatchesAuthority(result, ollie())).toThrow(/stale/);
  });

  it("projects exactly the consumed authority: authoritative changes alter the digest, promptAnchor and unconsumed fields do not", async () => {
    const f = await fixture();
    const base = character(f, "MONT");
    const digest = (c: Json) => characterVisualIdentityConsumptionAuthoritySha256(c as Character);
    const reference = digest(base);

    const changes: Array<[string, (c: Json) => void]> = [
      ["approved trait decision", (c) => { c.visualIdentity.approvedTraitDecisions[0].description = "blue-grey skin"; }],
      ["default continuity state", (c) => { c.defaultContinuityState.items[0].description = "green rucksack"; }],
      ["shot/story state", (c) => { c.shotOrStoryStateItems.push({ itemKey: "LANTERN", description: "small lantern", classification: "SHOT_OR_STORY_STATE" }); }],
      ["presentation guidance", (c) => { c.presentationGuidance[0].text = "green trim"; }],
      ["approval link", (c) => { c.visualIdentity.approval.receiptSha256 = "e".repeat(64); }],
      ["master binding", (c) => { c.visualIdentity.referenceBindings[0].assetId = "mont-master-identity-reference-v2"; }],
      ["appearance identity", (c) => { c.appearance.eyes = "large green eyes"; }],
      ["species", (c) => { c.species = "mammoth"; }],
    ];

    for (const [label, mutate] of changes) {
      const changed = structuredClone(base);
      mutate(changed);
      expect(digest(changed), label).not.toBe(reference);
    }

    const unconsumed: Array<[string, (c: Json) => void]> = [
      ["promptAnchor", (c) => { c.promptAnchor = "Mont is a purple dragon."; }],
      ["name", (c) => { c.name = "Monty"; }],
      ["personalityTraits", (c) => { c.personalityTraits = ["bold"]; }],
      ["voice", (c) => { c.voice.deliveryTraits = ["fast"]; }],
    ];

    for (const [label, mutate] of unconsumed) {
      const changed = structuredClone(base);
      mutate(changed);
      expect(digest(changed), label).toBe(reference);
    }
  });

  it("does not let operatorNotes act as structured evidence for later identity versions", async () => {
    const f = await fixture();
    const ollie = character(f, "OLLIE");
    const entry = f.registry.assets.find((asset: Json) => asset.assetId === "ollie-master-identity-reference-v1");

    ollie.visualIdentity.identityVersion = 2;
    ollie.visualIdentity.approval.receiptSha256 = await f.writeReceipt("OLLIE", receiptFor(ollie, entry, 2), 2);

    await expect(verify(f, "OLLIE")).rejects.toThrow(/legacy IV1 migration exception and is not accepted for identity version 2/);
  });

  it("matches value codes deterministically, never by scattered words", () => {
    expect(corroboratesLegacyIv1ReceiptNote(IV1_OPERATOR_NOTES.OLLIE, "DARK_BROWN paw pads", "DARK_BROWN")).toBe(true);
    expect(corroboratesLegacyIv1ReceiptNote(IV1_OPERATOR_NOTES.MONT, "blue-grey body, hands and feet", "BLUE_GREY")).toBe(true);
    expect(corroboratesLegacyIv1ReceiptNote(IV1_OPERATOR_NOTES.MONT, "light cream ivory nails", "LIGHT_CREAM_IVORY")).toBe(true);

    expect(textContainsMachineCode("dark paw brown", "DARK_BROWN")).toBe(false);
    expect(textContainsMachineCode("darkbrown paws", "DARK_BROWN")).toBe(false);
    expect(textContainsMachineCode("blue and grey body", "BLUE_GREY")).toBe(false);
    expect(textContainsMachineCode("BROWN paw fur", "DARK_BROWN")).toBe(false);
    expect(textContainsMachineCode("dark-brown paw pads", "BROWN")).toBe(false);
    expect(corroboratesLegacyIv1ReceiptNote(IV1_OPERATOR_NOTES.OLLIE, "dark-brown paw pads", "DARK_BROWN")).toBe(false);
    expect(corroboratesLegacyIv1ReceiptNote(undefined, "BROWN paw fur", "BROWN")).toBe(false);
    expect(corroboratesLegacyIv1ReceiptNote(IV1_OPERATOR_NOTES.KACEY, "Approved master", "DARK_BROWN")).toBe(false);
  });

  it("rejects unresolved ambiguity in active structured state", async () => {
    const f = await fixture();
    character(f, "OLLIE").shotOrStoryStateItems[0].description = "explorer satchel when required by the shot";
    await expect(verify(f, "OLLIE")).rejects.toThrow(/unresolved wording/);
  });

  it("gives promptAnchor no authority over verification", async () => {
    const f = await fixture();
    character(f, "KACEY").promptAnchor = "Kacey is a purple dragon with a leaf crown.";
    await expect(verify(f, "KACEY")).resolves.toMatchObject({ result: "CONSUMPTION_VERIFIED" });
  });

  it("rejects a structurally invalid or v1 CharacterBible", async () => {
    const f = await fixture();
    const v1 = JSON.parse(readFileSync(new URL("./fixtures/characterBible.pre1137e.v1.json", import.meta.url), "utf8"));
    await expect(verifyCharacterVisualIdentityApprovalForConsumption({ mediaRoot: f.mediaRoot, bible: v1, characterId: "OLLIE" }))
      .rejects.toThrow(/CharacterBible v2 is invalid/);
  });
});
