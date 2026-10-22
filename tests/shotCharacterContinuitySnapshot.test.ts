import {
  readdirSync,
  readFileSync,
} from "node:fs";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildShotCharacterContinuitySnapshotV1,
} from "../src/characterIdentity/buildShotCharacterContinuitySnapshot.js";

import {
  canonicalCharacterIdentityJson,
  characterIdentitySha256,
} from "../src/characterIdentity/canonicalCharacterIdentityJson.js";

import {
  canonicalEditorialJson,
  editorialSha256,
} from "../src/editorial/canonicalizeEditorialPlan.js";

import {
  hashShotCharacterContinuitySnapshotV1,
  parseShotCharacterContinuitySnapshotV1,
} from "../src/characterIdentity/shotCharacterContinuitySnapshot.schema.js";

type JsonRecord =
  Record<string, any>;

function readJson(
  relativePath:
    string,
): JsonRecord {
  return JSON.parse(
    readFileSync(
      new URL(
        relativePath,
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

function identityFor(
  characterId:
    string,
  overrides:
    JsonRecord = {},
): JsonRecord {
  const slug =
    characterId.toLowerCase();

  return {
    schemaVersion:
      "1.0",
    status:
      "LOCKED",
    characterId,
    identityVersion:
      1,
    // Deliberately not in canonical role order; the builder canonicalizes.
    referenceBindings: [
      {
        role:
          "PROFILE",
        assetId:
          `${slug}-profile-v1`,
      },
      {
        role:
          "MASTER_IDENTITY",
        assetId:
          `${slug}-master-v1`,
      },
    ],
    invariantTraits: [
      `${slug} approved face identity`,
      `${slug} child-friendly body proportions`,
    ],
    prohibitedVariations: [
      "a different species",
      "adult proportions",
    ],
    ...overrides,
  };
}

function activatedBible(): JsonRecord {
  const bible =
    readJson(
      "../config/characters.json",
    );

  bible.characters =
    bible.characters.map(
      (character: JsonRecord) => ({
        ...character,
        visualIdentity:
          identityFor(
            character.id,
          ),
      }),
    );

  return bible;
}

function registryFor(
  assetIds:
    readonly string[],
): JsonRecord {
  return {
    schemaVersion:
      "1.0",
    assets:
      assetIds.map(
        (assetId) => ({
          assetId,
          mediaRootRelativePath:
            `references/characters/${assetId}.png`,
          bytes:
            1024,
          sha256:
            "0".repeat(64),
          contentType:
            "image/png",
        }),
      ),
  };
}

const ALL_ASSETS =
  [
    "OLLIE",
    "KACEY",
    "MONT",
  ].flatMap(
    (id) => [
      `${id.toLowerCase()}-master-v1`,
      `${id.toLowerCase()}-profile-v1`,
    ],
  );

function multiCharacterEpisode(
  characters:
    readonly string[] = [
      "OLLIE",
      "MONT",
      "KACEY",
    ],
): JsonRecord {
  const episode =
    readJson(
      "../episodes/EP02/episode.json",
    );

  episode.scenes[0].shots[1].characters =
    [...characters];

  return episode;
}

function build(
  overrides:
    JsonRecord = {},
) {
  return buildShotCharacterContinuitySnapshotV1({
    episode:
      multiCharacterEpisode(),
    sceneId:
      "SC01",
    shotId:
      "S02",
    bible:
      activatedBible(),
    visualReferenceRegistry:
      registryFor(
        ALL_ASSETS,
      ),
    ...overrides,
  });
}

function collectKeys(
  value:
    unknown,
  keys =
    new Set<string>(),
): Set<string> {
  if (
    value &&
    typeof value ===
      "object"
  ) {
    for (
      const [key, child]
      of Object.entries(
        value,
      )
    ) {
      if (
        !Array.isArray(
          value,
        )
      ) {
        keys.add(
          key,
        );
      }

      collectKeys(
        child,
        keys,
      );
    }
  }

  return keys;
}

function reverseObjectKeys(
  value:
    unknown,
): unknown {
  if (
    Array.isArray(
      value,
    )
  ) {
    return value.map(
      reverseObjectKeys,
    );
  }

  if (
    value &&
    typeof value ===
      "object"
  ) {
    return Object.fromEntries(
      Object.entries(
        value,
      )
        .reverse()
        .map(
          ([key, child]) => [
            key,
            reverseObjectKeys(
              child,
            ),
          ],
        ),
    );
  }

  return value;
}

describe(
  "E9 ShotCharacterContinuitySnapshotV1",
  () => {
    it(
      "builds a snapshot for a shot with multiple characters in canonical order",
      () => {
        const {
          snapshot,
          snapshotSha256,
        } =
          build();

        expect(
          snapshot.recordType,
        ).toBe(
          "BUSYBOOKIE_SHOT_CHARACTER_CONTINUITY_SNAPSHOT",
        );

        expect(
          [
            snapshot.episodeId,
            snapshot.sceneId,
            snapshot.shotId,
          ],
        ).toEqual([
          "EP02",
          "SC01",
          "S02",
        ]);

        expect(
          snapshot.characters.map(
            (character) =>
              character.characterId,
          ),
        ).toEqual([
          "KACEY",
          "MONT",
          "OLLIE",
        ]);

        const ollie =
          snapshot.characters[2]!;

        expect(
          ollie.immutableIdentity.referenceBindings,
        ).toEqual([
          {
            role:
              "MASTER_IDENTITY",
            assetId:
              "ollie-master-v1",
          },
          {
            role:
              "PROFILE",
            assetId:
              "ollie-profile-v1",
          },
        ]);

        expect(
          ollie.immutableIdentity.species,
        ).toBe(
          "young otter",
        );

        expect(
          ollie.continuityState,
        ).toEqual({
          source:
            "CHARACTER_BIBLE_DEFAULT",
          outfit: [
            "teal explorer backpack",
          ],
          accessories: [
            "small compass pendant",
            "explorer satchel when required by the approved shot reference",
          ],
        });

        expect(
          ollie.promptAnchor,
        ).toMatch(
          /^Ollie is a young boy otter/,
        );

        expect(
          snapshot.shotContinuityNotes.length,
        ).toBeGreaterThan(0);

        expect(
          snapshotSha256,
        ).toMatch(
          /^[0-9a-f]{64}$/,
        );

        expect(
          Object.isFrozen(
            snapshot,
          ) &&
            Object.isFrozen(
              snapshot.characters[0]!.immutableIdentity.referenceBindings,
            ),
        ).toBe(true);
      },
    );

    it(
      "does not mutate caller inputs",
      () => {
        const episode =
          multiCharacterEpisode();

        const bible =
          activatedBible();

        const before =
          JSON.stringify([
            episode,
            bible,
          ]);

        buildShotCharacterContinuitySnapshotV1({
          episode,
          sceneId:
            "SC01",
          shotId:
            "S02",
          bible,
          visualReferenceRegistry:
            registryFor(
              ALL_ASSETS,
            ),
        });

        expect(
          JSON.stringify([
            episode,
            bible,
          ]),
        ).toBe(
          before,
        );
      },
    );

    it(
      "builds an empty character set for a shot without characters",
      () => {
        const {
          snapshot,
        } =
          build({
            shotId:
              "S01",
          });

        expect(
          snapshot.characters,
        ).toEqual([]);
      },
    );

    it(
      "produces the same digest for the same canonical snapshot",
      () => {
        const first =
          build();

        const second =
          build();

        expect(
          second.snapshotSha256,
        ).toBe(
          first.snapshotSha256,
        );

        expect(
          hashShotCharacterContinuitySnapshotV1(
            first.snapshot,
          ),
        ).toBe(
          first.snapshotSha256,
        );
      },
    );

    it(
      "is independent of shot membership order and property insertion order",
      () => {
        const base =
          build();

        const reordered =
          build({
            episode:
              multiCharacterEpisode([
                "KACEY",
                "OLLIE",
                "MONT",
              ]),
          });

        expect(
          reordered.snapshotSha256,
        ).toBe(
          base.snapshotSha256,
        );

        expect(
          hashShotCharacterContinuitySnapshotV1(
            reverseObjectKeys(
              base.snapshot,
            ),
          ),
        ).toBe(
          base.snapshotSha256,
        );
      },
    );

    it(
      "changes the digest when immutable identity changes",
      () => {
        const base =
          build();

        const bible =
          activatedBible();

        bible.characters[0].visualIdentity =
          identityFor(
            "OLLIE",
            {
              identityVersion:
                2,
            },
          );

        const versionBumped =
          build({
            bible,
          });

        const traitBible =
          activatedBible();

        traitBible.characters[1].visualIdentity.invariantTraits =
          [
            "kacey approved face identity",
            "kacey longer fluffy tail",
          ];

        const traitChanged =
          build({
            bible:
              traitBible,
          });

        expect(
          versionBumped.snapshotSha256,
        ).not.toBe(
          base.snapshotSha256,
        );

        expect(
          traitChanged.snapshotSha256,
        ).not.toBe(
          base.snapshotSha256,
        );
      },
    );

    it(
      "changes the digest when shot continuity state changes",
      () => {
        const base =
          build();

        const bible =
          activatedBible();

        bible.characters[2].appearance.outfit =
          [
            "green explorer backpack",
            "red rain cap",
          ];

        const outfitChanged =
          build({
            bible,
          });

        const episode =
          multiCharacterEpisode();

        episode.scenes[0].shots[1].continuityNotes.push(
          "Mont now carries the lantern from the previous shot.",
        );

        const notesChanged =
          build({
            episode,
          });

        expect(
          outfitChanged.snapshotSha256,
        ).not.toBe(
          base.snapshotSha256,
        );

        expect(
          notesChanged.snapshotSha256,
        ).not.toBe(
          base.snapshotSha256,
        );
      },
    );

    it(
      "contains no provider, model or byte-authority fields",
      () => {
        const keys =
          collectKeys(
            build().snapshot,
          );

        for (
          const forbidden
          of [
            "provider",
            "model",
            "seed",
            "sha256",
            "bytes",
            "mediaRootRelativePath",
            "absolutePath",
            "voice",
            "camera",
            "audio",
          ]
        ) {
          expect(
            keys.has(
              forbidden,
            ),
          ).toBe(false);
        }
      },
    );

    it.each([
      [
        "top level",
        (snapshot: JsonRecord) => {
          snapshot.provider =
            "VEO";
        },
      ],
      [
        "character",
        (snapshot: JsonRecord) => {
          snapshot.characters[0].model =
            "veo-3.1";
        },
      ],
      [
        "immutable identity",
        (snapshot: JsonRecord) => {
          snapshot.characters[0].immutableIdentity.seed =
            42;
        },
      ],
      [
        "continuity state",
        (snapshot: JsonRecord) => {
          snapshot.characters[0].continuityState.expression =
            "happy";
        },
      ],
      [
        "self digest",
        (snapshot: JsonRecord) => {
          snapshot.snapshotSha256 =
            "0".repeat(64);
        },
      ],
    ])(
      "rejects unknown fields at %s",
      (
        _label,
        mutate,
      ) => {
        const snapshot =
          structuredClone(
            build().snapshot,
          ) as JsonRecord;

        mutate(
          snapshot,
        );

        expect(() =>
          parseShotCharacterContinuitySnapshotV1(
            snapshot,
          ),
        ).toThrow(
          /invalid/,
        );
      },
    );

    it(
      "rejects duplicate or non-canonically ordered characters",
      () => {
        const snapshot =
          structuredClone(
            build().snapshot,
          ) as JsonRecord;

        const duplicated =
          structuredClone(
            snapshot,
          );

        duplicated.characters[1] =
          duplicated.characters[0];

        expect(() =>
          parseShotCharacterContinuitySnapshotV1(
            duplicated,
          ),
        ).toThrow(
          /Duplicate snapshot character/,
        );

        snapshot.characters.reverse();

        expect(() =>
          parseShotCharacterContinuitySnapshotV1(
            snapshot,
          ),
        ).toThrow(
          /ascending characterId order/,
        );
      },
    );

    it(
      "rejects non-canonical, duplicate or master-less snapshot bindings",
      () => {
        const base =
          build().snapshot;

        const reordered =
          structuredClone(
            base,
          ) as JsonRecord;

        reordered.characters[0].immutableIdentity.referenceBindings.reverse();

        expect(() =>
          parseShotCharacterContinuitySnapshotV1(
            reordered,
          ),
        ).toThrow(
          /canonical role order/,
        );

        const masterless =
          structuredClone(
            base,
          ) as JsonRecord;

        masterless.characters[0].immutableIdentity.referenceBindings =
          [
            {
              role:
                "PROFILE",
              assetId:
                "kacey-profile-v1",
            },
          ];

        expect(() =>
          parseShotCharacterContinuitySnapshotV1(
            masterless,
          ),
        ).toThrow(
          /MASTER_IDENTITY/,
        );
      },
    );

    it(
      "fails closed when a shot character has no CharacterBible visual identity",
      () => {
        expect(() =>
          build({
            bible:
              readJson(
                "../config/characters.json",
              ),
          }),
        ).toThrow(
          /no CharacterBible visualIdentity \(E9 activation pending\)/,
        );
      },
    );

    it(
      "fails closed when a shot character identity is PENDING",
      () => {
        const bible =
          activatedBible();

        bible.characters[1].visualIdentity =
          identityFor(
            "KACEY",
            {
              status:
                "PENDING",
            },
          );

        expect(() =>
          build({
            bible,
          }),
        ).toThrow(
          /KACEY visual identity is PENDING, not LOCKED/,
        );
      },
    );

    it(
      "fails closed when a bound asset is not in the visual reference registry",
      () => {
        expect(() =>
          build({
            visualReferenceRegistry:
              registryFor(
                ALL_ASSETS.filter(
                  (assetId) =>
                    assetId !==
                    "mont-profile-v1",
                ),
              ),
          }),
        ).toThrow(
          /MONT PROFILE asset mont-profile-v1 is not in the visual reference asset registry/,
        );
      },
    );

    it(
      "fails closed on an invalid registry, unknown scene or unknown shot",
      () => {
        expect(() =>
          build({
            visualReferenceRegistry: {
              schemaVersion:
                "1.0",
              assets: [
                {
                  assetId:
                    "x",
                  mediaRootRelativePath:
                    "../escape.png",
                  bytes:
                    1,
                  sha256:
                    "0".repeat(64),
                  contentType:
                    "image/png",
                },
              ],
            },
          }),
        ).toThrow(
          /visual reference asset registry is invalid/,
        );

        expect(() =>
          build({
            sceneId:
              "SC09",
          }),
        ).toThrow(
          /scene SC09 was not found/,
        );

        expect(() =>
          build({
            shotId:
              "S09",
          }),
        ).toThrow(
          /shot S09 was not found/,
        );
      },
    );

    it(
      "rejects a shot that repeats a character before building",
      () => {
        expect(() =>
          build({
            episode:
              multiCharacterEpisode([
                "OLLIE",
                "OLLIE",
              ]),
          }),
        ).toThrow(
          /episode manifest is invalid/,
        );
      },
    );

    it(
      "rejects a shot character unknown to the CharacterBible",
      () => {
        expect(() =>
          build({
            episode:
              multiCharacterEpisode([
                "OLLIE",
                "TEST_GUEST",
              ]),
          }),
        ).toThrow(
          /unknown character TEST_GUEST/,
        );
      },
    );
  },
);

describe(
  "E9 canonical JSON parity and isolation",
  () => {
    it(
      "matches the repository canonical editorial JSON byte-for-byte",
      () => {
        const samples: unknown[] = [
          build().snapshot,
          {
            b: 1,
            a: [
              true,
              null,
              "é",
            ],
            "10": "x",
            "2": {
              z: 0.5,
              y: -3,
            },
          },
          [],
          {},
          "茶色",
        ];

        for (const sample of samples) {
          expect(
            canonicalCharacterIdentityJson(
              sample,
            ),
          ).toBe(
            canonicalEditorialJson(
              sample,
            ),
          );
        }

        expect(
          characterIdentitySha256(
            "e9",
          ),
        ).toBe(
          editorialSha256(
            "e9",
          ),
        );
      },
    );

    it.each([
      -0,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date(0),
      new Map(),
    ])(
      "rejects non-canonical value %j like the editorial algorithm",
      (value) => {
        expect(() =>
          canonicalEditorialJson(
            value,
          ),
        ).toThrow();

        expect(() =>
          canonicalCharacterIdentityJson(
            value,
          ),
        ).toThrow();
      },
    );

    it(
      "keeps E9 modules pure, provider-neutral and independent of editorial modules",
      () => {
        const directory =
          new URL(
            "../src/characterIdentity/",
            import.meta.url,
          );

        const files = [
          ...readdirSync(
            directory,
          ).map(
            (name) =>
              new URL(
                name,
                directory,
              ),
          ),
          new URL(
            "../src/schemas/characterVisualIdentity.schema.ts",
            import.meta.url,
          ),
          new URL(
            "../src/schemas/characterId.schema.ts",
            import.meta.url,
          ),
        ];

        expect(
          files.length,
        ).toBe(5);

        for (const file of files) {
          const text =
            readFileSync(
              file,
              "utf8",
            );

          expect(
            text,
            file.pathname,
          ).not.toMatch(
            /node:fs|child_process|process\.|dotenv|import\(|fetch\(/,
          );

          for (
            const specifier
            of text.matchAll(
              /from\s+["']([^"']+)["']/g,
            )
          ) {
            expect(
              specifier[1],
              file.pathname,
            ).toMatch(
              /^(zod|node:crypto|\.\/[A-Za-z.]+\.js|\.\.\/(schemas|characterIdentity)\/[A-Za-z.]+\.js|\.\.\/execution\/visualReferenceAsset\.schema\.js)$/,
            );
          }
        }
      },
    );
  },
);
