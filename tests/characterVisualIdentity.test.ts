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
  return {
    schemaVersion:
      "1.0",
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
    ...overrides,
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
      "keeps the canonical CharacterBible unactivated (E9 activation deferred)",
      async () => {
        const bible =
          await loadCharacterBible();

        expect(
          bible.schemaVersion,
        ).toBe(
          "1.0",
        );

        expect(
          bible.characters.map(
            (character) =>
              character.visualIdentity,
          ),
        ).toEqual([
          undefined,
          undefined,
          undefined,
        ]);
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
      "still accepts a registered future character with or without a visual identity",
      () => {
        const source =
          readCanonicalBible();

        const template =
          source.characters[0]!;

        const guest =
          {
            ...template,
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
        ).toBe(true);

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
