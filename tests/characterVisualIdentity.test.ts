import {
  readFileSync,
} from "node:fs";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CharacterBibleSchema,
} from "../src/schemas/character.schema.js";

import {
  CharacterVisualIdentityV1Schema,
} from "../src/schemas/characterVisualIdentity.schema.js";

import {
  loadCharacterBible,
} from "../src/validation/loadCharacterBible.js";

function readCanonicalBible(): {
  schemaVersion: string;
  characters: Record<string, unknown>[];
} {
  return JSON.parse(
    readFileSync(
      new URL(
        "../config/characters.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

function lockedIdentity(
  overrides:
    Record<string, unknown> = {},
) {
  const identity: Record<string, unknown> = {
    ...lockedIdentityBase(),
    ...overrides,
  };

  // PENDING identities carry no approval link (strict schema).
  if (identity.status === "PENDING" && !("approval" in overrides)) {
    delete identity.approval;
  }

  return identity;
}

function lockedIdentityBase() {
  return {
    schemaVersion:
      "2.0",
    status:
      "LOCKED",
    characterId:
      "OLLIE",
    identityVersion:
      1,
    referenceBindings: [
      {
        role:
          "MASTER_IDENTITY",
        assetId:
          "ollie-master-character-reference-v1",
      },
      {
        role:
          "PROFILE",
        assetId:
          "ollie-profile-reference-v1",
      },
    ],
    invariantTraits: [
      "round otter face with a small dark nose",
      "warm brown fur with a cream muzzle",
    ],
    prohibitedVariations: [
      "human anatomy",
      "a different species",
    ],
    approvedTraitDecisions:
      [] as unknown[],
    approval: {
      approvalId:
        "371599c1-35d3-4893-913b-9c4f63730cb8",
      receiptSha256:
        "a".repeat(64),
    },
  };
}

describe(
  "E9 CharacterVisualIdentityV1",
  () => {
    it(
      "accepts a valid locked identity",
      () => {
        const parsed =
          CharacterVisualIdentityV1Schema.parse(
            lockedIdentity(),
          );

        expect(
          parsed.status,
        ).toBe(
          "LOCKED",
        );

        expect(
          parsed.referenceBindings,
        ).toHaveLength(2);
      },
    );

    it(
      "accepts a pending identity with no bindings or traits yet",
      () => {
        expect(
          CharacterVisualIdentityV1Schema.safeParse(
            lockedIdentity({
              status:
                "PENDING",
              referenceBindings:
                [],
              invariantTraits:
                [],
              prohibitedVariations:
                [],
            }),
          ).success,
        ).toBe(true);
      },
    );

    it(
      "accepts language-independent trait text in any script",
      () => {
        expect(
          CharacterVisualIdentityV1Schema.safeParse(
            lockedIdentity({
              invariantTraits: [
                "fourrure brune et crème",
                "茶色とクリーム色の毛並み",
              ],
            }),
          ).success,
        ).toBe(true);
      },
    );

    it(
      "rejects a locked identity with zero reference bindings",
      () => {
        expect(
          CharacterVisualIdentityV1Schema.safeParse(
            lockedIdentity({
              referenceBindings:
                [],
            }),
          ).success,
        ).toBe(false);
      },
    );

    it(
      "rejects a locked identity without a MASTER_IDENTITY binding",
      () => {
        const result =
          CharacterVisualIdentityV1Schema.safeParse(
            lockedIdentity({
              referenceBindings: [
                {
                  role:
                    "FRONT",
                  assetId:
                    "ollie-front-v1",
                },
              ],
            }),
          );

        expect(
          result.success,
        ).toBe(false);

        expect(
          result.error?.message,
        ).toMatch(
          /MASTER_IDENTITY/,
        );
      },
    );

    it(
      "rejects duplicate semantic role bindings",
      () => {
        const result =
          CharacterVisualIdentityV1Schema.safeParse(
            lockedIdentity({
              referenceBindings: [
                {
                  role:
                    "MASTER_IDENTITY",
                  assetId:
                    "ollie-master-a",
                },
                {
                  role:
                    "MASTER_IDENTITY",
                  assetId:
                    "ollie-master-b",
                },
              ],
            }),
          );

        expect(
          result.success,
        ).toBe(false);

        expect(
          result.error?.message,
        ).toMatch(
          /Duplicate visual reference role/,
        );
      },
    );

    it(
      "rejects one asset bound to two roles",
      () => {
        const result =
          CharacterVisualIdentityV1Schema.safeParse(
            lockedIdentity({
              referenceBindings: [
                {
                  role:
                    "MASTER_IDENTITY",
                  assetId:
                    "ollie-master-v1",
                },
                {
                  role:
                    "FRONT",
                  assetId:
                    "ollie-master-v1",
                },
              ],
            }),
          );

        expect(
          result.success,
        ).toBe(false);

        expect(
          result.error?.message,
        ).toMatch(
          /Duplicate visual reference asset/,
        );
      },
    );

    it(
      "rejects duplicate bindings even while pending",
      () => {
        expect(
          CharacterVisualIdentityV1Schema.safeParse(
            lockedIdentity({
              status:
                "PENDING",
              referenceBindings: [
                {
                  role:
                    "FRONT",
                  assetId:
                    "a",
                },
                {
                  role:
                    "FRONT",
                  assetId:
                    "b",
                },
              ],
            }),
          ).success,
        ).toBe(false);
      },
    );

    it(
      "rejects free-form or unknown roles",
      () => {
        expect(
          CharacterVisualIdentityV1Schema.safeParse(
            lockedIdentity({
              referenceBindings: [
                {
                  role:
                    "references/ollie/master.png",
                  assetId:
                    "ollie-master-v1",
                },
              ],
            }),
          ).success,
        ).toBe(false);
      },
    );

    it.each([
      "ollie",
      "Ollie",
      "OLLIE__V1",
      "_OLLIE",
      "",
    ])(
      "rejects malformed character id %j",
      (characterId) => {
        expect(
          CharacterVisualIdentityV1Schema.safeParse(
            lockedIdentity({
              characterId,
            }),
          ).success,
        ).toBe(false);
      },
    );

    it.each([
      "C:/Busybookie/Production/references/ollie.png",
      "references/ollie.png",
      "https://cdn.example.com/ollie.png",
      "C:ollie",
      " ollie-master-v1",
      "ollie master",
      "..",
    ])(
      "rejects path, URL or malformed asset id %j",
      (assetId) => {
        expect(
          CharacterVisualIdentityV1Schema.safeParse(
            lockedIdentity({
              referenceBindings: [
                {
                  role:
                    "MASTER_IDENTITY",
                  assetId,
                },
              ],
            }),
          ).success,
        ).toBe(false);
      },
    );

    it.each([
      [
        "invariantTraits",
        [],
      ],
      [
        "prohibitedVariations",
        [],
      ],
      [
        "invariantTraits",
        [""],
      ],
      [
        "invariantTraits",
        [" padded "],
      ],
      [
        "invariantTraits",
        [
          "same trait",
          "Same Trait",
        ],
      ],
      [
        "prohibitedVariations",
        ["see https://provider.example/model"],
      ],
      [
        "invariantTraits",
        ["D:\\Busybookie\\face.png"],
      ],
    ])(
      "rejects invalid locked %s %j",
      (
        field,
        value,
      ) => {
        expect(
          CharacterVisualIdentityV1Schema.safeParse(
            lockedIdentity({
              [field]:
                value,
            }),
          ).success,
        ).toBe(false);
      },
    );

    it.each([
      "provider",
      "model",
      "seed",
      "sha256",
      "mediaRootRelativePath",
    ])(
      "rejects unknown identity field %s",
      (field) => {
        expect(
          CharacterVisualIdentityV1Schema.safeParse(
            lockedIdentity({
              [field]:
                "x",
            }),
          ).success,
        ).toBe(false);
      },
    );

    it(
      "rejects byte authority fields on a binding",
      () => {
        expect(
          CharacterVisualIdentityV1Schema.safeParse(
            lockedIdentity({
              referenceBindings: [
                {
                  role:
                    "MASTER_IDENTITY",
                  assetId:
                    "ollie-master-v1",
                  sha256:
                    "a".repeat(64),
                },
              ],
            }),
          ).success,
        ).toBe(false);
      },
    );

    it.each([
      0,
      -1,
      1.5,
    ])(
      "rejects identity version %j",
      (identityVersion) => {
        expect(
          CharacterVisualIdentityV1Schema.safeParse(
            lockedIdentity({
              identityVersion,
            }),
          ).success,
        ).toBe(false);
      },
    );
  },
);

describe(
  "E9 CharacterBible visualIdentity slot",
  () => {
    it(
      "activates the canonical CharacterBible v2 with LOCKED, approval-linked identities (Step 1137E)",
      async () => {
        const bible =
          await loadCharacterBible();

        expect(
          bible.schemaVersion,
        ).toBe(
          "2.0",
        );

        expect(
          bible.characters.map(
            (character) => [
              character.id,
              character.visualIdentity.status,
              character.visualIdentity.status === "LOCKED"
                ? character.visualIdentity.approval.approvalId
                : null,
            ],
          ),
        ).toEqual([
          ["OLLIE", "LOCKED", "371599c1-35d3-4893-913b-9c4f63730cb8"],
          ["KACEY", "LOCKED", "ecc47e91-26a7-4687-b7fa-5b6661370028"],
          ["MONT", "LOCKED", "eb043e11-f533-443a-a368-54babc680d0f"],
        ]);
      },
    );

    it(
      "requires an approval link on LOCKED and forbids one on PENDING",
      () => {
        const locked =
          lockedIdentity();

        delete locked.approval;

        expect(
          CharacterVisualIdentityV1Schema.safeParse(
            locked,
          ).success,
        ).toBe(false);

        expect(
          CharacterVisualIdentityV1Schema.safeParse(
            lockedIdentity({
              status:
                "PENDING",
              approval:
                lockedIdentityBase().approval,
            }),
          ).success,
        ).toBe(false);
      },
    );

    it(
      "requires provenance-specific evidence on structured trait decisions",
      () => {
        const human = {
          traitKey: "PAW_PAD_COLOUR",
          valueCode: "DARK_BROWN",
          description: "dark-brown paw pads",
          provenance: "HUMAN_APPROVED_VISUAL_IDENTITY_DECISION",
          legacyIv1ReceiptNoteCorroboration: "DARK_BROWN paw pads",
        };

        expect(CharacterVisualIdentityV1Schema.safeParse(lockedIdentity({ approvedTraitDecisions: [human] })).success).toBe(true);

        const { legacyIv1ReceiptNoteCorroboration: _omitted, ...withoutCorroboration } = human;
        expect(CharacterVisualIdentityV1Schema.safeParse(lockedIdentity({ approvedTraitDecisions: [withoutCorroboration] })).success).toBe(false);
        expect(CharacterVisualIdentityV1Schema.safeParse(lockedIdentity({ approvedTraitDecisions: [{ ...human, provenance: "PROMPT_ANCHOR" }] })).success).toBe(false);
        expect(CharacterVisualIdentityV1Schema.safeParse(lockedIdentity({ approvedTraitDecisions: [human, human] })).success).toBe(false);
      },
    );

    it(
      "rejects a key classified both as default state and as shot state or guidance",
      () => {
        const source =
          readCanonicalBible();

        const ollie = source.characters[0] as Record<string, unknown>;

        source.characters[0] = {
          ...ollie,
          shotOrStoryStateItems: [
            { itemKey: "BACKPACK", description: "explorer satchel", classification: "SHOT_OR_STORY_STATE" },
          ],
        };

        expect(CharacterBibleSchema.safeParse(source).error?.message).toMatch(/classified both as default state/);
      },
    );

    it(
      "accepts a CharacterBible character carrying a matching visual identity",
      () => {
        const source =
          readCanonicalBible();

        source.characters[0] = {
          ...source.characters[0],
          visualIdentity:
            lockedIdentity(),
        };

        expect(
          CharacterBibleSchema.safeParse(
            source,
          ).success,
        ).toBe(true);
      },
    );

    it(
      "rejects a visual identity whose characterId does not match its character",
      () => {
        const source =
          readCanonicalBible();

        source.characters[0] = {
          ...source.characters[0],
          visualIdentity:
            lockedIdentity({
              characterId:
                "KACEY",
            }),
        };

        const result =
          CharacterBibleSchema.safeParse(
            source,
          );

        expect(
          result.success,
        ).toBe(false);

        expect(
          result.error?.message,
        ).toMatch(
          /does not match character OLLIE/,
        );
      },
    );

    it(
      "rejects an invalid visual identity inside the CharacterBible",
      () => {
        const source =
          readCanonicalBible();

        source.characters[0] = {
          ...source.characters[0],
          visualIdentity:
            lockedIdentity({
              referenceBindings:
                [],
            }),
        };

        expect(
          CharacterBibleSchema.safeParse(
            source,
          ).success,
        ).toBe(false);
      },
    );

    it(
      "requires a visual identity for a registered future character and accepts it PENDING",
      () => {
        const source =
          readCanonicalBible();

        const template =
          source.characters[0]!;

        const { visualIdentity: _ollieIdentity, ...withoutIdentity } = template;

        const guest =
          {
            ...withoutIdentity,
            id:
              "TEST_GUEST",
            name:
              "Test Guest",
          };

        expect(
          CharacterBibleSchema.safeParse({
            ...source,
            characters: [
              ...source.characters,
              guest,
            ],
          }).success,
        ).toBe(false);

        expect(
          CharacterBibleSchema.safeParse({
            ...source,
            characters: [
              ...source.characters,
              {
                ...guest,
                visualIdentity:
                  lockedIdentity({
                    characterId:
                      "TEST_GUEST",
                    status:
                      "PENDING",
                    referenceBindings:
                      [],
                  }),
              },
            ],
          }).success,
        ).toBe(true);
      },
    );
  },
);
