import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { canonicalCharacterIdentityJson, characterIdentitySha256 } from "../src/characterIdentity/canonicalCharacterIdentityJson.js";
import { findUnresolvedApprovalWording } from "../src/characterIdentity/characterVisualIdentityApprovalAmbiguity.js";
import { computeCharacterBibleCanonicalSha256 } from "../src/characterIdentity/characterVisualIdentityApprovalSource.js";
import { HistoricalCharacterBibleV1Schema } from "../src/schemas/historicalCharacterBible.schema.js";
import { loadCharacterBible } from "../src/validation/loadCharacterBible.js";

type Json = Record<string, any>;

const V1_FIXTURE = new URL("./fixtures/characterBible.pre1137e.v1.json", import.meta.url);
const HISTORICAL_SOURCE_CANONICAL_SHA256 = "a4825c432fdecbf7415d714689fbe5efb1783a09bf628e3b238c68b2730b524d";

const v1 = HistoricalCharacterBibleV1Schema.parse(JSON.parse(readFileSync(V1_FIXTURE, "utf8")));

async function live() {
  const bible = await loadCharacterBible();
  const byId = Object.fromEntries(bible.characters.map((character) => [character.id, character]));
  return { bible, ollie: byId.OLLIE!, kacey: byId.KACEY!, mont: byId.MONT! };
}

function lockedOrFail(character: Awaited<ReturnType<typeof live>>["ollie"]) {
  if (character.visualIdentity.status !== "LOCKED") throw new Error(`${character.id} not LOCKED`);
  return character.visualIdentity;
}

function traits(character: Awaited<ReturnType<typeof live>>["ollie"]) {
  return Object.fromEntries(character.visualIdentity.approvedTraitDecisions.map((decision) => [decision.traitKey, decision]));
}

function activeStructuredStrings(character: Json): string[] {
  return [
    ...character.defaultContinuityState.items.flatMap((item: Json) => [item.itemKey, item.description, ...item.resolutions.map((r: Json) => r.valueCode)]),
    ...character.shotOrStoryStateItems.flatMap((item: Json) => [item.itemKey, item.description]),
    ...character.presentationGuidance.flatMap((guidance: Json) => [guidance.guidanceKey, guidance.text]),
    ...character.visualIdentity.approvedTraitDecisions.flatMap((decision: Json) => [decision.traitKey, decision.valueCode, decision.description]),
    ...character.visualIdentity.invariantTraits,
  ];
}

describe("CharacterBible v2 activation (Step 1137E)", () => {
  it("parses the migrated config as v2 with LOCKED, approval-linked identities bound to the approved masters", async () => {
    const { bible, ollie, kacey, mont } = await live();

    expect(bible.schemaVersion).toBe("2.0");

    expect([ollie, kacey, mont].map((character) => {
      const identity = lockedOrFail(character);
      return [character.id, identity.identityVersion, identity.referenceBindings, identity.approval];
    })).toEqual([
      ["OLLIE", 1, [{ role: "MASTER_IDENTITY", assetId: "ollie-master-identity-reference-v1" }],
        { approvalId: "371599c1-35d3-4893-913b-9c4f63730cb8", receiptSha256: "84e0fdf306e8172ffd39baf901b3e90d11deddd3a5b7e5b6354351da03a5a7ef" }],
      ["KACEY", 1, [{ role: "MASTER_IDENTITY", assetId: "kacey-master-identity-reference-v1" }],
        { approvalId: "ecc47e91-26a7-4687-b7fa-5b6661370028", receiptSha256: "9f435355322e968eaf0de77c9647829a8db5119fcc147ed0872751a4d9338f0a" }],
      ["MONT", 1, [{ role: "MASTER_IDENTITY", assetId: "mont-master-identity-reference-v1" }],
        { approvalId: "eb043e11-f533-443a-a368-54babc680d0f", receiptSha256: "cce84088b5cb3c4ba2233abaef0f7a947076a71106647a7af2f0612cb48d7e8b" }],
    ]);
  });

  it("migrates Ollie: teal backpack and compass pendant as defaults, satchel as shot state, structured paw decisions", async () => {
    const { ollie } = await live();

    expect(ollie.defaultContinuityState.items).toEqual([
      { itemKey: "BACKPACK", description: "teal explorer backpack", resolutions: [] },
      { itemKey: "PENDANT", description: "small compass pendant", resolutions: [] },
    ]);
    expect(ollie.shotOrStoryStateItems).toEqual([{ itemKey: "SATCHEL", description: "explorer satchel", classification: "SHOT_OR_STORY_STATE" }]);
    expect(ollie.defaultContinuityState.items.map((item) => item.itemKey)).not.toContain("SATCHEL");
    expect(ollie.presentationGuidance).toEqual([]);

    expect(Object.values(traits(ollie)).map((decision) => [decision.traitKey, decision.valueCode, decision.provenance])).toEqual([
      ["PAW_FUR_COLOUR", "BROWN", "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION"],
      ["PAW_PAD_COLOUR", "DARK_BROWN", "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION"],
      ["PINK_PAWS", "PROHIBITED", "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION"],
    ]);
  });

  it("migrates Kacey to exactly PINK, PINK, FLOWER with no unresolved alternative in active structured state", async () => {
    const { kacey } = await live();

    expect(kacey.defaultContinuityState.items).toEqual([
      { itemKey: "BACKPACK", description: "pink backpack", resolutions: [{ attribute: "COLOUR", valueCode: "PINK" }] },
      { itemKey: "SCARF", description: "pink neck scarf", resolutions: [{ attribute: "COLOUR", valueCode: "PINK" }] },
      { itemKey: "HAIR_ACCESSORY", description: "small flower hair accessory", resolutions: [{ attribute: "FORM", valueCode: "FLOWER" }] },
    ]);

    for (const text of activeStructuredStrings(kacey)) {
      expect(text, text).not.toMatch(/purple|leaf|\bor\b/i);
    }

    expect(traits(kacey).PAW_FUR_COLOUR).toMatchObject({ valueCode: "DARK_BROWN", provenance: "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION" });
  });

  it("migrates Mont: green backpack and yellow leaf-emblem cap as defaults, accents as guidance only, structured colours", async () => {
    const { mont } = await live();

    expect(mont.defaultContinuityState.items).toEqual([
      { itemKey: "BACKPACK", description: "green explorer backpack", resolutions: [] },
      { itemKey: "CAP", description: "yellow cap with a leaf emblem", resolutions: [] },
    ]);
    expect(mont.presentationGuidance).toEqual([{ guidanceKey: "GREEN_EXPLORER_ACCENTS", text: "green explorer accents" }]);
    expect(mont.shotOrStoryStateItems).toEqual([]);

    expect(traits(mont).BODY_HAND_FOOT_COLOUR).toMatchObject({ valueCode: "BLUE_GREY", description: "blue-grey body, hands and feet", provenance: "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION" });
    expect(traits(mont).NAIL_COLOUR).toMatchObject({ valueCode: "LIGHT_CREAM_IVORY", provenance: "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION" });
    expect(traits(mont).INNER_EAR_COLOUR).toMatchObject({ valueCode: "PINK", provenance: "CHARACTER_BIBLE_SOURCE",
      characterBibleSourceText: "large rounded ears with soft pink inner ears" });
    expect(mont.appearance.body).toBe("soft pale grey-blue elephant skin with child-friendly rounded proportions");
  });

  it("never classifies removable items as immutable identity", async () => {
    const { ollie, kacey, mont } = await live();

    for (const character of [ollie, kacey, mont]) {
      const identityText = [...character.visualIdentity.invariantTraits, ...character.visualIdentity.approvedTraitDecisions.map((d) => d.description)].join(" | ");
      expect(identityText, character.id).not.toMatch(/backpack|pendant|scarf|cap\b|hair accessory|satchel/i);
    }
  });

  it("leaves no second default-state authority: legacy appearance items and continuity are gone, identity prose is carried", async () => {
    const { bible } = await live();

    for (const character of bible.characters as Json[]) {
      expect(Object.keys(character.appearance).sort(), character.id).toEqual(["body", "distinguishingFeatures", "eyes", "face"]);
      expect(character, character.id).not.toHaveProperty("continuity");

      for (const text of [character.appearance.body, character.appearance.face, character.appearance.eyes, ...character.appearance.distinguishingFeatures]) {
        expect(character.visualIdentity.invariantTraits, `${character.id}: ${text}`).toContain(text);
      }
    }
  });

  it("keeps active structured state free of unresolved PREACT14 ambiguity", async () => {
    const { bible } = await live();

    for (const character of bible.characters as Json[]) {
      for (const text of activeStructuredStrings(character)) {
        expect(findUnresolvedApprovalWording(text, { freeText: true }), `${character.id}: ${text}`).toBeNull();
      }
    }
  });

  it("retains promptAnchor verbatim as legacy text (D-3)", async () => {
    const { bible } = await live();

    expect(bible.characters.map((character) => character.promptAnchor)).toEqual(v1.characters.map((character) => character.promptAnchor));
    expect(bible.characters.find((character) => character.id === "KACEY")?.promptAnchor).toMatch(/pink or purple/);
  });

  it("has no production consumer reading promptAnchor (only the schema declares it)", () => {
    const sourceRoot = new URL("../src/", import.meta.url);
    const files = readdirSync(sourceRoot, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => join(entry.parentPath, entry.name));

    const readers = files.filter((file) => /\.promptAnchor\b|\[["']promptAnchor["']\]/.test(readFileSync(file, "utf8")));
    const declarers = files.filter((file) => /promptAnchor\s*:/.test(readFileSync(file, "utf8"))).map((file) => file.replaceAll("\\", "/"));

    expect(readers).toEqual([]);
    expect(declarers.map((file) => file.slice(file.indexOf("src/")))).toEqual(
      expect.arrayContaining(["src/schemas/character.schema.ts", "src/schemas/historicalCharacterBible.schema.ts"]),
    );
    expect(declarers).toHaveLength(2);
  });

  it("changes the CharacterBible canonical digest intentionally while the historical v1 digest stays the IV1 source", async () => {
    const { bible } = await live();

    expect(computeCharacterBibleCanonicalSha256(v1)).toBe(HISTORICAL_SOURCE_CANONICAL_SHA256);
    expect(characterIdentitySha256(canonicalCharacterIdentityJson(bible))).not.toBe(HISTORICAL_SOURCE_CANONICAL_SHA256);
  });

  it("refuses an unmigrated v1 CharacterBible loudly in the production loader", async () => {
    await expect(loadCharacterBible(V1_FIXTURE.pathname.replace(/^\/([A-Za-z]:)/, "$1"))).rejects.toThrow(/Character Bible validation failed/);
  });

  it("keeps character identity language-independent (machine codes, no locale enum)", async () => {
    const { bible } = await live();
    const keys = JSON.stringify(bible);

    expect(keys).not.toMatch(/"(locale|language|lang)"\s*:/i);
  });
});
