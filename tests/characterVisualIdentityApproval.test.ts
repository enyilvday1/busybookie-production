import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CHARACTER_APPROVAL_CLOSED_VALUE_KEYS,
  CHARACTER_APPROVAL_FREE_TEXT_KEYS,
  CHARACTER_REFERENCE_ACCEPTANCE_RULES,
  CharacterReferenceAssetIdSchema,
  CharacterVisualIdentityApprovalV1Schema,
} from "../src/characterIdentity/characterVisualIdentityApproval.schema.js";

import {
  collectUnresolvedApprovalWording,
  findUnresolvedApprovalWording,
} from "../src/characterIdentity/characterVisualIdentityApprovalAmbiguity.js";

import {
  computeCharacterBibleCanonicalSha256,
  computeExactSourceTextSha256,
  parseCharacterApprovalSourceAlternatives,
  resolveCharacterApprovalSourceText,
  selectCharacterApprovalAlternative,
} from "../src/characterIdentity/characterVisualIdentityApprovalSource.js";

import {
  validateCharacterVisualIdentityApprovalDecisions,
} from "../src/characterIdentity/validateCharacterVisualIdentityApproval.js";

import { CharacterBibleSchema, type Character } from "../src/schemas/character.schema.js";
import { CharacterVisualReferenceAssetIdSchema } from "../src/schemas/characterVisualIdentity.schema.js";
import { VisualReferenceAssetSchema } from "../src/execution/visualReferenceAsset.schema.js";

type Json = Record<string, any>;

const bible = CharacterBibleSchema.parse(
  JSON.parse(readFileSync(new URL("../config/characters.json", import.meta.url), "utf8")),
);

function character(id: string): Character {
  return bible.characters.find((candidate) => candidate.id === id)!;
}

function sourceSha(id: string, field: "appearance.outfit" | "appearance.accessories", index: number): string {
  return computeExactSourceTextSha256(resolveCharacterApprovalSourceText(character(id), { field, index }));
}

function attestations(): Json {
  return Object.fromEntries(CHARACTER_REFERENCE_ACCEPTANCE_RULES.map((rule) => [rule, true]));
}

function binding(characterId: string, role = "MASTER_IDENTITY", version = 1): Json {
  const assetId = `${characterId.toLowerCase()}-${role.toLowerCase().replaceAll("_", "-")}-reference-v${version}`;

  return {
    role,
    assetId,
    registryEntry: {
      assetId,
      mediaRootRelativePath: `references/characters/${characterId}/${assetId}.png`,
      bytes: 40,
      sha256: "a".repeat(64),
      contentType: "image/png",
    },
  };
}

function decision(id: string, itemKey: string, field: "appearance.outfit" | "appearance.accessories", index: number,
  disposition: string, extra: Json = {}): Json {
  return {
    itemKey,
    source: { field, index, sourceTextSha256: sourceSha(id, field, index) },
    disposition,
    resolutions: [],
    ...extra,
  };
}

function receipt(characterId: string, decisions: Json[], extra: Json = {}): Json {
  return {
    schemaVersion: "1.0",
    recordType: "CHARACTER_VISUAL_IDENTITY_APPROVAL",
    approvalId: "4f0c4a52-5d0e-4c55-9d0c-2b8f4a9b6c11",
    approvedAt: "2026-10-22T12:00:00.000Z",
    status: "APPROVED",
    characterId,
    targetIdentityVersion: 1,
    sourceCharacterBible: { schemaVersion: "1.0", canonicalSha256: computeCharacterBibleCanonicalSha256(bible) },
    referenceBindings: [binding(characterId)],
    defaultStateDecisions: decisions,
    acceptanceAttestations: attestations(),
    authorizationSource: "HUMAN_OPERATOR",
    workflowStep: "E9_STEP_1137D",
    activationEffect: "NONE_EVIDENCE_ONLY",
    ...extra,
  };
}

function ollieDecisions(): Json[] {
  return [
    decision("OLLIE", "BACKPACK", "appearance.outfit", 0, "DEFAULT_STATE_ITEM", { approvedDescription: "teal explorer backpack" }),
    decision("OLLIE", "PENDANT", "appearance.accessories", 0, "DEFAULT_STATE_ITEM", { approvedDescription: "small compass pendant" }),
    decision("OLLIE", "SATCHEL", "appearance.accessories", 1, "EXCLUDED_SHOT_OR_STORY_STATE"),
  ];
}

function kaceyDecisions(backpack = "PINK", scarf = "PURPLE", hair = "FLOWER"): Json[] {
  return [
    decision("KACEY", "BACKPACK", "appearance.outfit", 0, "DEFAULT_STATE_ITEM", {
      resolutions: [{ attribute: "COLOUR", valueCode: backpack }],
      approvedDescription: `${backpack.toLowerCase()} backpack`,
    }),
    decision("KACEY", "SCARF", "appearance.outfit", 1, "DEFAULT_STATE_ITEM", {
      resolutions: [{ attribute: "COLOUR", valueCode: scarf }],
      approvedDescription: `${scarf.toLowerCase()} neck scarf`,
    }),
    decision("KACEY", "HAIR_ACCESSORY", "appearance.accessories", 0, "DEFAULT_STATE_ITEM", {
      resolutions: [{ attribute: "FORM", valueCode: hair }],
      approvedDescription: `small ${hair.toLowerCase()} hair accessory`,
    }),
  ];
}

function montDecisions(): Json[] {
  return [
    decision("MONT", "BACKPACK", "appearance.outfit", 0, "DEFAULT_STATE_ITEM", { approvedDescription: "green explorer backpack" }),
    decision("MONT", "CAP", "appearance.outfit", 1, "DEFAULT_STATE_ITEM", { approvedDescription: "yellow cap with a leaf emblem" }),
    decision("MONT", "GREEN_EXPLORER_ACCENTS", "appearance.accessories", 0, "PRESENTATION_GUIDANCE_NOT_STATE"),
  ];
}

function parse(value: Json) {
  return CharacterVisualIdentityApprovalV1Schema.safeParse(value);
}

function validateDecisions(value: Json): void {
  validateCharacterVisualIdentityApprovalDecisions(CharacterVisualIdentityApprovalV1Schema.parse(value), bible);
}

describe("CharacterVisualIdentityApprovalV1 schema", () => {
  it("accepts a valid receipt for each canonical character", () => {
    expect(parse(receipt("OLLIE", ollieDecisions())).success).toBe(true);
    expect(parse(receipt("KACEY", kaceyDecisions())).success).toBe(true);
    expect(parse(receipt("MONT", montDecisions())).success).toBe(true);
  });

  it("rejects unknown top-level and nested fields", () => {
    expect(parse(receipt("OLLIE", ollieDecisions(), { extra: true })).success).toBe(false);

    const nested = receipt("OLLIE", ollieDecisions());
    nested.sourceCharacterBible.extra = true;
    expect(parse(nested).success).toBe(false);

    const nestedBinding = receipt("OLLIE", ollieDecisions());
    nestedBinding.referenceBindings[0].registryEntry.extra = true;
    expect(parse(nestedBinding).success).toBe(false);
  });

  it("rejects an invalid character id and identity version", () => {
    expect(parse(receipt("OLLIE", ollieDecisions(), { characterId: "ollie" })).success).toBe(false);
    expect(parse(receipt("OLLIE", ollieDecisions(), { targetIdentityVersion: 0 })).success).toBe(false);
    expect(parse(receipt("OLLIE", ollieDecisions(), { targetIdentityVersion: 1.5 })).success).toBe(false);
  });

  it("requires exactly one MASTER_IDENTITY binding and rejects duplicate roles and assets", () => {
    expect(parse(receipt("OLLIE", ollieDecisions(), { referenceBindings: [binding("OLLIE", "FRONT")] })).success).toBe(false);
    expect(parse(receipt("OLLIE", ollieDecisions(), {
      referenceBindings: [binding("OLLIE"), binding("OLLIE", "MASTER_IDENTITY", 2)],
    })).success).toBe(false);

    const duplicateAsset = binding("OLLIE", "FRONT");
    duplicateAsset.assetId = "ollie-master-identity-reference-v1";
    duplicateAsset.registryEntry.assetId = duplicateAsset.assetId;
    expect(parse(receipt("OLLIE", ollieDecisions(), {
      referenceBindings: [binding("OLLIE"), duplicateAsset],
    })).success).toBe(false);

    expect(parse(receipt("OLLIE", ollieDecisions(), {
      referenceBindings: [binding("OLLIE"), binding("OLLIE", "FRONT")],
    })).success).toBe(true);
  });

  it("rejects a binding whose asset id names another character or role", () => {
    expect(parse(receipt("OLLIE", ollieDecisions(), { referenceBindings: [binding("KACEY")] })).success).toBe(false);
  });

  it("requires all fifteen acceptance attestations to be literally true", () => {
    expect(CHARACTER_REFERENCE_ACCEPTANCE_RULES).toHaveLength(15);

    for (const rule of CHARACTER_REFERENCE_ACCEPTANCE_RULES) {
      const missing = receipt("OLLIE", ollieDecisions());
      delete missing.acceptanceAttestations[rule];
      expect(parse(missing).success, rule).toBe(false);

      const falsy = receipt("OLLIE", ollieDecisions());
      falsy.acceptanceAttestations[rule] = false;
      expect(parse(falsy).success, rule).toBe(false);
    }

    const unknown = receipt("OLLIE", ollieDecisions());
    unknown.acceptanceAttestations.AR16_EXTRA = true;
    expect(parse(unknown).success).toBe(false);
  });

  it("rejects an invalid activationEffect and other changed constants", () => {
    expect(parse(receipt("OLLIE", ollieDecisions(), { activationEffect: "ACTIVATES_IDENTITY" })).success).toBe(false);
    expect(parse(receipt("OLLIE", ollieDecisions(), { status: "PENDING" })).success).toBe(false);
    expect(parse(receipt("OLLIE", ollieDecisions(), { recordType: "OTHER" })).success).toBe(false);
  });

  it("rejects provider, model and seed injection", () => {
    for (const field of ["provider", "model", "seed"]) {
      expect(parse(receipt("OLLIE", ollieDecisions(), { [field]: "RUNWAY" })).success, field).toBe(false);
    }
  });

  it("rejects absolute paths in the receipt", () => {
    const registryPath = receipt("OLLIE", ollieDecisions());
    registryPath.referenceBindings[0].registryEntry.mediaRootRelativePath = "D:/Busybookie/Production/references/x.png";
    expect(parse(registryPath).success).toBe(false);

    expect(parse(receipt("OLLIE", ollieDecisions(), { operatorNotes: "stored at C:\\media\\ollie.png" })).success).toBe(false);
  });

  it("rejects a supplied sourceText field", () => {
    const decisions = ollieDecisions();
    decisions[0]!.source.sourceText = "teal explorer backpack";
    expect(parse(receipt("OLLIE", decisions)).success).toBe(false);
  });
});

describe("exact source provenance", () => {
  it("hashes the exact UTF-8 source string deterministically", () => {
    expect(computeExactSourceTextSha256("pink or purple backpack"))
      .toBe("893c2671ddf5b6212766778141f2f81e9e806ba2f474598f92902584a02129c2");
    expect(sourceSha("OLLIE", "appearance.outfit", 0))
      .toBe("2cd7979ef5b939a47ee2d7f40f6ed01fa923082e28acc49c8336b42501cbe4a9");
    expect(computeExactSourceTextSha256("teal explorer backpack")).toBe(computeExactSourceTextSha256("teal explorer backpack"));
  });

  it("changes the digest for whitespace, case and punctuation changes", () => {
    const base = computeExactSourceTextSha256("teal explorer backpack");

    for (const variant of ["teal  explorer backpack", " teal explorer backpack", "Teal explorer backpack", "teal explorer backpack."]) {
      expect(computeExactSourceTextSha256(variant), variant).not.toBe(base);
    }
  });

  it("rejects wrong fields, out-of-range indices and fields outside outfit/accessories", () => {
    const ollie = character("OLLIE");

    expect(() => resolveCharacterApprovalSourceText(ollie, { field: "appearance.hat", index: 0 })).toThrow();
    expect(() => resolveCharacterApprovalSourceText(ollie, { field: "appearance.outfit", index: 1 })).toThrow();
    expect(() => resolveCharacterApprovalSourceText(ollie, { field: "appearance.outfit", index: -1 })).toThrow();

    for (const field of ["promptAnchor", "continuity.mustPreserve", "continuity.mustNotChange", "personalityTraits", "role", "voice"]) {
      expect(() => resolveCharacterApprovalSourceText(ollie, { field, index: 0 }), field).toThrow();

      const decisions = ollieDecisions();
      decisions[0]!.source.field = field;
      expect(parse(receipt("OLLIE", decisions)).success, field).toBe(false);
    }
  });

  it("rejects a completed receipt whose sourceTextSha256 does not match", () => {
    const decisions = ollieDecisions();
    decisions[0]!.source.sourceTextSha256 = computeExactSourceTextSha256("teal explorer backpack ");
    expect(() => validateDecisions(receipt("OLLIE", decisions))).toThrow(/sourceTextSha256/);
  });

  it("rejects a receipt bound to a different CharacterBible", () => {
    expect(() => validateDecisions(receipt("OLLIE", ollieDecisions(), {
      sourceCharacterBible: { schemaVersion: "1.0", canonicalSha256: "b".repeat(64) },
    }))).toThrow(/canonical SHA-256/);
  });
});

describe("decision coverage", () => {
  it("accepts complete coverage with all three dispositions", () => {
    expect(() => validateDecisions(receipt("OLLIE", ollieDecisions()))).not.toThrow();
    expect(() => validateDecisions(receipt("KACEY", kaceyDecisions()))).not.toThrow();
    expect(() => validateDecisions(receipt("MONT", montDecisions()))).not.toThrow();
  });

  it("rejects a missing source decision", () => {
    expect(() => validateDecisions(receipt("OLLIE", ollieDecisions().slice(0, 2)))).toThrow(/has no decision/);
  });

  it("rejects duplicate source locations", () => {
    const decisions = ollieDecisions();
    decisions.push({ ...decisions[0]!, itemKey: "BACKPACK_AGAIN" });
    expect(parse(receipt("OLLIE", decisions)).success).toBe(false);
  });

  it("rejects nonexistent sources and arbitrary new garments", () => {
    const decisions = ollieDecisions();
    decisions.push({
      itemKey: "RAINCOAT",
      source: { field: "appearance.outfit", index: 5, sourceTextSha256: computeExactSourceTextSha256("raincoat") },
      disposition: "DEFAULT_STATE_ITEM",
      resolutions: [],
      approvedDescription: "yellow raincoat",
    });
    expect(() => validateDecisions(receipt("OLLIE", decisions))).toThrow(/no source entry/);
  });

  it("does not let one decision represent two source entries", () => {
    const decisions = ollieDecisions();
    decisions[0]!.source.index = [0, 1];
    expect(parse(receipt("OLLIE", decisions)).success).toBe(false);
  });

  it("rejects the satchel as an unresolvable default and Mont's accents need no invented item", () => {
    const decisions = ollieDecisions();
    decisions[2] = decision("OLLIE", "SATCHEL", "appearance.accessories", 1, "DEFAULT_STATE_ITEM", { approvedDescription: "explorer satchel" });
    expect(() => validateDecisions(receipt("OLLIE", decisions))).toThrow(/cannot be resolved/);

    expect(receipt("MONT", montDecisions()).defaultStateDecisions).toHaveLength(3);
  });

  it("rejects descriptions or resolutions on non-default dispositions", () => {
    const withDescription = ollieDecisions();
    withDescription[2]!.approvedDescription = "explorer satchel";
    expect(parse(receipt("OLLIE", withDescription)).success).toBe(false);

    const withResolution = ollieDecisions();
    withResolution[2]!.resolutions = [{ attribute: "FORM", valueCode: "SATCHEL" }];
    expect(parse(receipt("OLLIE", withResolution)).success).toBe(false);
  });

  it("rejects a resolution on a source that offers no alternatives", () => {
    const decisions = ollieDecisions();
    decisions[0]!.resolutions = [{ attribute: "COLOUR", valueCode: "TEAL" }];
    expect(() => validateDecisions(receipt("OLLIE", decisions))).toThrow(/takes no resolution/);
  });
});

describe("narrow alternative grammar", () => {
  it("parses the live Kacey source strings", () => {
    const kacey = character("KACEY");

    expect(parseCharacterApprovalSourceAlternatives(kacey.appearance.outfit[0]!)).toEqual(["PINK", "PURPLE"]);
    expect(parseCharacterApprovalSourceAlternatives(kacey.appearance.outfit[1]!)).toEqual(["PINK", "PURPLE"]);
    expect(parseCharacterApprovalSourceAlternatives(kacey.appearance.accessories[0]!)).toEqual(["FLOWER", "LEAF"]);
  });

  it("accepts either alternative case-insensitively and stores the canonical code", () => {
    expect(selectCharacterApprovalAlternative("pink or purple backpack", "pink")).toBe("PINK");
    expect(selectCharacterApprovalAlternative("pink or purple backpack", "PURPLE")).toBe("PURPLE");
    expect(() => validateDecisions(receipt("KACEY", kaceyDecisions("PURPLE", "PINK", "LEAF")))).not.toThrow();
  });

  it("rejects a value outside the parsed alternatives", () => {
    expect(() => selectCharacterApprovalAlternative("pink or purple backpack", "RED")).toThrow(/not one of/);
    expect(() => validateDecisions(receipt("KACEY", kaceyDecisions("RED")))).toThrow(/not one of the alternatives/);
  });

  it("fails closed on unrecognised grammar", () => {
    for (const text of [
      "teal explorer backpack",
      "pink or purple or blue backpack",
      "light-pink or purple backpack",
      "pink or deep-purple backpack",
      "pink, or purple backpack",
      "pink  or purple backpack",
      "pink OR purple backpack",
      "or purple backpack",
      "pink or",
      "explorer satchel when required by the approved shot reference",
    ]) {
      expect(() => parseCharacterApprovalSourceAlternatives(text), text).toThrow();
    }
  });

  it("uses only the immediate tokens and claims no semantic multi-word detection", () => {
    // "light" may or may not belong to the alternative; the immediate-token rule cannot know and does not try.
    expect(parseCharacterApprovalSourceAlternatives("light pink or purple backpack")).toEqual(["PINK", "PURPLE"]);
  });

  it("does not mistake letters inside words for a standalone or", () => {
    expect(() => parseCharacterApprovalSourceAlternatives("orange colour accessory")).toThrow(/exactly one standalone/);
    expect(parseCharacterApprovalSourceAlternatives("colour or decor")).toEqual(["COLOUR", "DECOR"]);
  });

  it("keeps no character-specific option table in production code", () => {
    for (const file of [
      "../src/characterIdentity/characterVisualIdentityApprovalSource.ts",
      "../src/characterIdentity/characterVisualIdentityApproval.schema.ts",
      "../src/characterIdentity/validateCharacterVisualIdentityApproval.ts",
      "../src/characterIdentity/createCharacterVisualIdentityApproval.ts",
    ]) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");

      expect(text, file).not.toMatch(/KACEY|PINK|PURPLE|FLOWER|LEAF|pink|purple/);
    }
  });
});

describe("PREACT_14 complete receipt scan", () => {
  it("rejects unresolved alternatives and conditionals", () => {
    expect(findUnresolvedApprovalWording("pink or purple")).not.toBeNull();
    expect(findUnresolvedApprovalWording("flower or leaf")).not.toBeNull();
    expect(findUnresolvedApprovalWording("satchel when required by the shot")).not.toBeNull();
    expect(findUnresolvedApprovalWording("pink/purple")).not.toBeNull();
    expect(findUnresolvedApprovalWording("either colour")).not.toBeNull();
  });

  it("accepts positive resolved wording and benign words containing or", () => {
    expect(findUnresolvedApprovalWording("approved PINK")).toBeNull();
    expect(findUnresolvedApprovalWording("small compass pendant in orange colour, a decorated accessory")).toBeNull();
    expect(findUnresolvedApprovalWording("references/characters/OLLIE/ollie.png", { freeText: false })).toBeNull();
  });

  it("rejects ambiguous approvedDescription and operatorNotes in a receipt", () => {
    const description = kaceyDecisions();
    description[0]!.approvedDescription = "pink or purple backpack";
    expect(parse(receipt("KACEY", description)).success).toBe(false);

    expect(parse(receipt("KACEY", kaceyDecisions(), { operatorNotes: "pink or purple" })).success).toBe(false);
    expect(parse(receipt("KACEY", kaceyDecisions(), { operatorNotes: "flower or leaf" })).success).toBe(false);
    expect(parse(receipt("OLLIE", ollieDecisions(), { operatorNotes: "satchel when required" })).success).toBe(false);
  });

  it("rejects notes and descriptions that restate a rejected alternative", () => {
    expect(() => validateDecisions(receipt("KACEY", kaceyDecisions(), { operatorNotes: "flower rather than leaf" })))
      .toThrow(/rejected alternative LEAF/);

    const description = kaceyDecisions();
    description[2]!.approvedDescription = "small flower hair accessory, not leaf";
    expect(() => validateDecisions(receipt("KACEY", description))).toThrow(/rejected alternative/);

    const unnamed = kaceyDecisions();
    unnamed[0]!.approvedDescription = "backpack";
    expect(() => validateDecisions(receipt("KACEY", unnamed))).toThrow(/must name the approved/);
  });

  it("accepts positive resolved notes", () => {
    expect(() => validateDecisions(receipt("KACEY", kaceyDecisions(), {
      operatorNotes: "approved PINK backpack, PURPLE scarf and FLOWER accessory",
    }))).not.toThrow();
  });

  it("scans every persisted string", () => {
    const value = receipt("KACEY", kaceyDecisions());
    expect(collectUnresolvedApprovalWording(
      value,
      CHARACTER_APPROVAL_FREE_TEXT_KEYS,
      CHARACTER_APPROVAL_CLOSED_VALUE_KEYS,
    )).toEqual([]);

    // Without the closed-value exemption the frozen disposition code itself would trip the word rule.
    expect(collectUnresolvedApprovalWording(receipt("OLLIE", ollieDecisions()), CHARACTER_APPROVAL_FREE_TEXT_KEYS))
      .not.toEqual([]);
    expect(parse(receipt("OLLIE", ollieDecisions())).success).toBe(true);

    // Machine identifiers pass their own schemas but still may not smuggle an alternative into the receipt.
    value.defaultStateDecisions[0].itemKey = "PINK_OR_PURPLE";
    expect(parse(value).success).toBe(false);
  });
});

describe("asset id compatibility", () => {
  it.each(["ollie-master-identity-reference-v1", "kacey-master-identity-reference-v1", "mont-master-identity-reference-v1"])(
    "%s is valid under the registry and E9 contracts",
    (assetId) => {
      expect(VisualReferenceAssetSchema.shape.assetId.safeParse(assetId).success).toBe(true);
      expect(CharacterVisualReferenceAssetIdSchema.safeParse(assetId).success).toBe(true);
      expect(CharacterReferenceAssetIdSchema.safeParse(assetId).success).toBe(true);
    },
  );

  it("keeps a registry-valid but E9-invalid id out of approval bindings", () => {
    for (const assetId of ["ollie master v1", "littleleaf-valley-storybook-village-v1", "OLLIE_MASTER_IDENTITY_V1"]) {
      expect(VisualReferenceAssetSchema.shape.assetId.safeParse(assetId).success, assetId).toBe(true);
      expect(CharacterReferenceAssetIdSchema.safeParse(assetId).success, assetId).toBe(false);

      const value = receipt("OLLIE", ollieDecisions());
      value.referenceBindings[0].assetId = assetId;
      value.referenceBindings[0].registryEntry.assetId = assetId;
      expect(parse(value).success, assetId).toBe(false);
    }
  });

  it("does not enumerate the proposed ids in generic or schema code", () => {
    for (const file of [
      "../src/execution/appendVisualReferenceAssetRegistry.ts",
      "../src/characterIdentity/characterVisualIdentityApproval.schema.ts",
    ]) {
      expect(readFileSync(new URL(file, import.meta.url), "utf8"), file).not.toMatch(/ollie|kacey|mont-/i);
    }
  });
});
