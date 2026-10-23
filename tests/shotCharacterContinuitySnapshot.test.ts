import {
  readdirSync,
  readFileSync,
} from "node:fs";

import {
  rm,
} from "node:fs/promises";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  buildShotCharacterContinuitySnapshotV2,
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
  hashShotCharacterContinuitySnapshotV2,
  parseShotCharacterContinuitySnapshotV2,
} from "../src/characterIdentity/shotCharacterContinuitySnapshot.schema.js";

import {
  verifyCharacterVisualIdentityApprovalForConsumption,
} from "../src/characterIdentity/verifyCharacterVisualIdentityApprovalForConsumption.js";

import {
  createConsumptionFixture,
  type ConsumptionFixture,
} from "./fixtures/characterIdentityConsumptionFixture.js";

type JsonRecord =
  Record<string, any>;

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function readJson(relativePath: string): JsonRecord {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function multiCharacterEpisode(characters: readonly string[] = ["OLLIE", "MONT", "KACEY"]): JsonRecord {
  const episode = readJson("../episodes/EP02/episode.json");

  episode.scenes[0].shots[1].characters = [...characters];

  return episode;
}

async function verifiedFixture(): Promise<{ f: ConsumptionFixture; verified: unknown[] }> {
  const f = await createConsumptionFixture();
  roots.push(f.mediaRoot);

  const verified = [];

  for (const characterId of ["OLLIE", "KACEY", "MONT"]) {
    verified.push(await verifyCharacterVisualIdentityApprovalForConsumption({ mediaRoot: f.mediaRoot, bible: f.bible, characterId }));
  }

  return { f, verified };
}

async function build(overrides: JsonRecord = {}) {
  const { f, verified } = await verifiedFixture();

  return buildShotCharacterContinuitySnapshotV2({
    episode: multiCharacterEpisode(),
    sceneId: "SC01",
    shotId: "S02",
    bible: f.bible,
    visualReferenceRegistry: f.registry,
    verifiedIdentities: verified,
    ...overrides,
  });
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (!Array.isArray(value)) keys.add(key);
      collectKeys(child, keys);
    }
  }

  return keys;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }

  return value;
}

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
  }

  return value;
}

function input(f: ConsumptionFixture, verified: unknown[], characters: readonly string[] = ["OLLIE"]) {
  return { episode: multiCharacterEpisode(characters), sceneId: "SC01", shotId: "S02", bible: f.bible, visualReferenceRegistry: f.registry, verifiedIdentities: verified };
}

function bibleCharacter(bible: JsonRecord, id: string): JsonRecord {
  return bible.characters.find((character: JsonRecord) => character.id === id);
}

describe(
  "E9 ShotCharacterContinuitySnapshotV2 (Step 1137E)",
  () => {
    it("builds a snapshot from active v2 authority for multiple characters in canonical order", async () => {
      const { snapshot, snapshotSha256 } = await build();

      expect(snapshot.recordVersion).toBe("2");
      expect(snapshot.characters.map((character) => character.characterId)).toEqual(["KACEY", "MONT", "OLLIE"]);
      expect(snapshotSha256).toBe(hashShotCharacterContinuitySnapshotV2(snapshot));

      const ollie = snapshot.characters.find((character) => character.characterId === "OLLIE")!;

      expect(ollie.identityVersion).toBe(1);
      expect(ollie.approval.approvalId).toBe("371599c1-35d3-4893-913b-9c4f63730cb8");
      expect(ollie.immutableIdentity.referenceBindings).toEqual([{ role: "MASTER_IDENTITY", assetId: "ollie-master-identity-reference-v1" }]);
      expect(ollie.immutableIdentity.approvedTraitDecisions.map((decision) => `${decision.traitKey}=${decision.valueCode}`))
        .toEqual(["PAW_FUR_COLOUR=BROWN", "PAW_PAD_COLOUR=DARK_BROWN", "PINK_PAWS=PROHIBITED"]);
      expect(ollie.continuityState).toEqual({
        source: "CHARACTER_BIBLE_DEFAULT",
        items: [
          { itemKey: "BACKPACK", description: "teal explorer backpack", resolutions: [] },
          { itemKey: "PENDANT", description: "small compass pendant", resolutions: [] },
        ],
      });

      const kacey = snapshot.characters.find((character) => character.characterId === "KACEY")!;
      expect(kacey.continuityState.items.map((item) => item.resolutions)).toEqual([
        [{ attribute: "COLOUR", valueCode: "PINK" }],
        [{ attribute: "COLOUR", valueCode: "PINK" }],
        [{ attribute: "FORM", valueCode: "FLOWER" }],
      ]);
      expect(JSON.stringify(snapshot)).not.toMatch(/satchel|green explorer accents|pink or purple|flower or leaf/i);
      expect(snapshot.shotContinuityNotes).toEqual(multiCharacterEpisode().scenes[0].shots[1].continuityNotes);
    });

    it("does not carry promptAnchor, and a promptAnchor-only change keeps the verification valid and the digest unchanged", async () => {
      const { f, verified } = await verifiedFixture();
      const first = buildShotCharacterContinuitySnapshotV2(input(f, verified, ["OLLIE", "MONT", "KACEY"]));

      for (const character of f.bible.characters) character.promptAnchor = "Overridden legacy prose: a purple dragon.";

      const second = buildShotCharacterContinuitySnapshotV2(input(f, verified, ["OLLIE", "MONT", "KACEY"]));

      expect(collectKeys(first.snapshot).has("promptAnchor")).toBe(false);
      expect(second.snapshotSha256).toBe(first.snapshotSha256);
    });

    it("contains no provider, model, prompt or byte-authority fields", async () => {
      const keys = collectKeys((await build()).snapshot);

      for (const forbidden of ["provider", "model", "seed", "prompt", "promptAnchor", "sha256", "bytes", "mediaRootRelativePath", "absolutePath", "voice", "camera", "audio"]) {
        expect(keys.has(forbidden), forbidden).toBe(false);
      }
    });

    it("rejects an old verification once authoritative CharacterBible state changes (M1 regression)", async () => {
      const mutations: Array<[string, (bible: JsonRecord) => void]> = [
        ["approved trait", (bible) => { bibleCharacter(bible, "OLLIE").visualIdentity.approvedTraitDecisions[0].valueCode = "PINK"; }],
        ["default continuity item", (bible) => { bibleCharacter(bible, "OLLIE").defaultContinuityState.items[0].description = "pink or purple backpack"; }],
        ["master binding", (bible) => { bibleCharacter(bible, "OLLIE").visualIdentity.referenceBindings[0].assetId = "ollie-master-identity-reference-v2"; }],
        ["invariant trait", (bible) => { bibleCharacter(bible, "OLLIE").visualIdentity.invariantTraits.push("pink or purple paws"); }],
        ["species", (bible) => { bibleCharacter(bible, "OLLIE").species = "owl"; }],
        ["prohibited variation", (bible) => { bibleCharacter(bible, "OLLIE").visualIdentity.prohibitedVariations.pop(); }],
      ];

      for (const [label, mutate] of mutations) {
        const { f, verified } = await verifiedFixture();
        const registry = structuredClone(f.registry);

        if (label === "master binding") registry.assets.push({ ...registry.assets[0], assetId: "ollie-master-identity-reference-v2", mediaRootRelativePath: "references/characters/OLLIE/ollie-master-identity-reference-v2.png" });

        mutate(f.bible);

        expect(() => buildShotCharacterContinuitySnapshotV2({ ...input(f, verified), visualReferenceRegistry: registry }), label)
          .toThrow(/no matching consumption-verified approval[\s\S]*stale or belongs to another character/);
      }
    });

    it.each(["OLLIE", "KACEY", "MONT"])(
      "cannot snapshot %s with all approved trait decisions stripped (M1137E2A2-1)",
      async (id) => {
        const { f, verified } = await verifiedFixture();
        bibleCharacter(f.bible, id).visualIdentity.approvedTraitDecisions = [];

        // The genuine verification of the full authority is stale for the stripped authority (S02 keeps its OLLIE
        // dialogue speaker in the shot)...
        expect(() => buildShotCharacterContinuitySnapshotV2(input(f, verified, [...new Set(["OLLIE", id])])))
          .toThrow(new RegExp(`character ${id} has no matching consumption-verified approval[\\s\\S]*stale`));

        // ...and no new verification can be obtained for it.
        await expect(verifyCharacterVisualIdentityApprovalForConsumption({ mediaRoot: f.mediaRoot, bible: f.bible, characterId: id }))
          .rejects.toThrow(/approvedTraitDecisions do not exactly equal the allowlisted legacy IV1 decisions/);
      },
    );

    it("changes the digest when immutable identity changes, each state with its own valid verification", async () => {
      const a = await verifiedFixture();
      const digestA = buildShotCharacterContinuitySnapshotV2(input(a.f, a.verified)).snapshotSha256;

      const b = await verifiedFixture();
      bibleCharacter(b.f.bible, "OLLIE").visualIdentity.invariantTraits.push("soft rounded paws");
      const verifiedB = [await verifyCharacterVisualIdentityApprovalForConsumption({ mediaRoot: b.f.mediaRoot, bible: b.f.bible, characterId: "OLLIE" })];
      const digestB = buildShotCharacterContinuitySnapshotV2(input(b.f, verifiedB)).snapshotSha256;

      expect(digestB).not.toBe(digestA);
      expect(buildShotCharacterContinuitySnapshotV2(input(a.f, a.verified)).snapshotSha256).toBe(digestA);

      // A's genuine verification is stale for authority B.
      expect(() => buildShotCharacterContinuitySnapshotV2(input(b.f, b.verified))).toThrow(/stale or belongs to another character/);
    });

    it("is independent of shot membership, verification, CharacterBible character and property insertion order", async () => {
      const { f, verified } = await verifiedFixture();
      const reference = buildShotCharacterContinuitySnapshotV2(input(f, verified, ["OLLIE", "MONT", "KACEY"])).snapshotSha256;

      const reordered = buildShotCharacterContinuitySnapshotV2({
        ...input(f, [...verified].reverse(), ["KACEY", "OLLIE", "MONT"]),
        bible: reverseKeys({ ...f.bible, characters: [...f.bible.characters].reverse() }),
        visualReferenceRegistry: reverseKeys(f.registry),
      });

      expect(reordered.snapshotSha256).toBe(reference);
      expect(reordered.snapshot.characters.map((character) => character.characterId)).toEqual(["KACEY", "MONT", "OLLIE"]);
    });

    it("does not mutate caller inputs", async () => {
      const { f, verified } = await verifiedFixture();
      const episode = multiCharacterEpisode(["OLLIE", "MONT", "KACEY"]);
      const verifiedList = [...verified];
      const before = JSON.stringify({ episode, bible: f.bible, registry: f.registry, verified: verifiedList });

      deepFreeze(episode);
      deepFreeze(f.bible);
      deepFreeze(f.registry);
      deepFreeze(verifiedList);

      const result = buildShotCharacterContinuitySnapshotV2({ episode, sceneId: "SC01", shotId: "S02", bible: f.bible, visualReferenceRegistry: f.registry, verifiedIdentities: verifiedList });

      expect(result.snapshot.characters).toHaveLength(3);
      expect(JSON.stringify({ episode, bible: f.bible, registry: f.registry, verified: verifiedList })).toBe(before);
      expect(Object.isFrozen(result.snapshot)).toBe(true);
    });

    it("fails closed without a verification, with a forged one, with another character's or with duplicates", async () => {
      const { f, verified } = await verifiedFixture();
      const base = input(f, verified);
      const ollie = verified.find((value) => (value as JsonRecord).characterId === "OLLIE") as JsonRecord;
      const kacey = verified.find((value) => (value as JsonRecord).characterId === "KACEY")!;

      expect(() => buildShotCharacterContinuitySnapshotV2({ ...base, verifiedIdentities: [] })).toThrow(/no matching consumption-verified approval/);
      expect(() => buildShotCharacterContinuitySnapshotV2({ ...base, verifiedIdentities: [kacey] })).toThrow(/no matching consumption-verified approval/);

      for (const forged of [{ ...ollie }, Object.freeze({ ...ollie }), structuredClone(ollie), JSON.parse(JSON.stringify(ollie))]) {
        expect(() => buildShotCharacterContinuitySnapshotV2({ ...base, verifiedIdentities: [forged] })).toThrow(/not issued by the consumption verifier/);
      }

      const second = await verifyCharacterVisualIdentityApprovalForConsumption({ mediaRoot: f.mediaRoot, bible: f.bible, characterId: "OLLIE" });
      expect(() => buildShotCharacterContinuitySnapshotV2({ ...base, verifiedIdentities: [ollie, second] })).toThrow(/more than one verification for OLLIE/);

      f.bible.characters[0].visualIdentity.approval.receiptSha256 = "0".repeat(64);
      expect(() => buildShotCharacterContinuitySnapshotV2(base)).toThrow(/no matching consumption-verified approval/);
    });

    it("fails closed on a PENDING identity, an unregistered binding, an unknown character or an invalid registry", async () => {
      const { f, verified } = await verifiedFixture();
      const base = { episode: multiCharacterEpisode(["OLLIE"]), sceneId: "SC01", shotId: "S02", visualReferenceRegistry: f.registry, verifiedIdentities: verified };

      const pendingBible = structuredClone(f.bible);
      const { approval: _link, ...rest } = pendingBible.characters[0].visualIdentity;
      pendingBible.characters[0].visualIdentity = { ...rest, status: "PENDING" };
      expect(() => buildShotCharacterContinuitySnapshotV2({ ...base, bible: pendingBible })).toThrow(/PENDING, not LOCKED/);

      expect(() => buildShotCharacterContinuitySnapshotV2({ ...base, bible: f.bible, visualReferenceRegistry: { schemaVersion: "1.0", assets: [] } }))
        .toThrow(/not in the visual reference asset registry/);

      expect(() => buildShotCharacterContinuitySnapshotV2({ ...base, bible: f.bible, episode: multiCharacterEpisode(["OLLIE", "TEST_GUEST"]) }))
        .toThrow(/unknown character TEST_GUEST/);

      expect(() => buildShotCharacterContinuitySnapshotV2({ ...base, bible: f.bible, visualReferenceRegistry: { schemaVersion: "9" } }))
        .toThrow(/registry is invalid/);

      expect(() => buildShotCharacterContinuitySnapshotV2({ ...base, bible: f.bible, shotId: "S99" })).toThrow(/was not found/);
    });

    it("rejects duplicate shot characters instead of deduplicating them", async () => {
      const { f, verified } = await verifiedFixture();

      expect(() => buildShotCharacterContinuitySnapshotV2(input(f, verified, ["OLLIE", "MONT", "OLLIE"])))
        .toThrow(/episode manifest is invalid[\s\S]*Duplicate character in shot: OLLIE/);

      const { snapshot } = await build();
      const duplicated = structuredClone(snapshot) as JsonRecord;
      duplicated.characters = [duplicated.characters[0], duplicated.characters[0], duplicated.characters[1]];
      expect(() => parseShotCharacterContinuitySnapshotV2(duplicated)).toThrow(/Duplicate snapshot character: KACEY/);
    });

    it("builds an empty character set for a shot without characters", async () => {
      const episode = multiCharacterEpisode([]);
      episode.scenes[0].shots[1].dialogue = [];

      const { snapshot } = await build({ episode });

      expect(snapshot.characters).toEqual([]);
    });

    it("rejects malformed snapshots at the schema boundary", async () => {
      const { snapshot } = await build();
      const value = structuredClone(snapshot) as JsonRecord;

      value.characters.reverse();
      expect(() => parseShotCharacterContinuitySnapshotV2(value)).toThrow(/ascending characterId order/);

      const v1 = structuredClone(snapshot) as JsonRecord;
      v1.recordVersion = "1";
      expect(() => parseShotCharacterContinuitySnapshotV2(v1)).toThrow();

      const withPrompt = structuredClone(snapshot) as JsonRecord;
      withPrompt.characters[0].promptAnchor = "legacy";
      expect(() => parseShotCharacterContinuitySnapshotV2(withPrompt)).toThrow();
    });

    it.each([
      ["snapshot", (s: JsonRecord) => { s.extra = true; }],
      ["character", (s: JsonRecord) => { s.characters[0].extra = true; }],
      ["approval", (s: JsonRecord) => { s.characters[0].approval.extra = true; }],
      ["immutable identity", (s: JsonRecord) => { s.characters[0].immutableIdentity.extra = true; }],
      ["trait decision", (s: JsonRecord) => { s.characters[0].immutableIdentity.approvedTraitDecisions[0].legacyIv1ReceiptNoteCorroboration = "x"; }],
      ["reference binding", (s: JsonRecord) => { s.characters[0].immutableIdentity.referenceBindings[0].sha256 = "a".repeat(64); }],
      ["continuity state", (s: JsonRecord) => { s.characters[0].continuityState.extra = true; }],
      ["continuity item", (s: JsonRecord) => { s.characters[0].continuityState.items[0].extra = true; }],
      ["item resolution", (s: JsonRecord) => { s.characters[0].continuityState.items[0].resolutions[0].extra = true; }],
    ])("rejects unknown fields at %s", async (_label, mutate) => {
      const { snapshot } = await build();
      const value = structuredClone(snapshot) as JsonRecord;

      mutate(value);
      expect(() => parseShotCharacterContinuitySnapshotV2(value)).toThrow(/Shot character continuity snapshot is invalid/);
    });

    it("rejects unknown nested CharacterBible fields before snapshot construction", async () => {
      const { f, verified } = await verifiedFixture();

      for (const mutate of [
        (bible: JsonRecord) => { bibleCharacter(bible, "OLLIE").visualIdentity.extra = true; },
        (bible: JsonRecord) => { bibleCharacter(bible, "OLLIE").defaultContinuityState.items[0].extra = true; },
        (bible: JsonRecord) => { bibleCharacter(bible, "OLLIE").visualIdentity.approvedTraitDecisions[0].extra = true; },
      ]) {
        const bible = structuredClone(f.bible);
        mutate(bible);
        expect(() => buildShotCharacterContinuitySnapshotV2({ ...input(f, verified), bible })).toThrow(/character bible is invalid/);
      }
    });
  },
);

describe(
  "E9 canonical JSON parity and isolation",
  () => {
    it(
      "matches the repository canonical editorial JSON byte-for-byte",
      async () => {
        const samples: unknown[] = [
          (await build()).snapshot,
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

    // Step 1137D1 replaced the former readdir + file-count(5) assertion with a capability-based
    // classification: every module under src/characterIdentity/ is either pure (rules unchanged) or an
    // explicitly authorised I/O module (stricter rules below). An unclassified module fails the build.
    const characterIdentityDirectory =
      new URL(
        "../src/characterIdentity/",
        import.meta.url,
      );

    const PURE_CHARACTER_IDENTITY_MODULES = [
      "buildShotCharacterContinuitySnapshot.ts",
      "canonicalCharacterIdentityJson.ts",
      "shotCharacterContinuitySnapshot.schema.ts",
      "characterVisualIdentityApproval.schema.ts",
      "characterVisualIdentityApprovalAmbiguity.ts",
      "characterVisualIdentityApprovalSource.ts",
    ];

    const AUTHORISED_IO_CHARACTER_IDENTITY_MODULES = [
      "characterVisualIdentityApprovalPath.ts",
      "readCharacterVisualIdentityApproval.ts",
      "createCharacterVisualIdentityApproval.ts",
      "validateCharacterVisualIdentityApproval.ts",
      "onboardCharacterVisualIdentity.ts",
      "cli/characterReferenceOnboarding.ts",
      "verifyCharacterVisualIdentityApprovalForConsumption.ts",
    ];

    function listCharacterIdentityModules(
      relativeDirectory = "",
    ): string[] {
      return readdirSync(
        new URL(
          relativeDirectory,
          characterIdentityDirectory,
        ),
        {
          withFileTypes: true,
        },
      ).flatMap(
        (entry) =>
          entry.isDirectory()
            ? listCharacterIdentityModules(
              `${relativeDirectory}${entry.name}/`,
            )
            : [
              `${relativeDirectory}${entry.name}`,
            ],
      );
    }

    it(
      "classifies every src/characterIdentity module as pure or authorised I/O",
      () => {
        expect(
          listCharacterIdentityModules().sort(),
        ).toEqual(
          [
            ...PURE_CHARACTER_IDENTITY_MODULES,
            ...AUTHORISED_IO_CHARACTER_IDENTITY_MODULES,
          ].sort(),
        );
      },
    );

    it(
      "keeps authorised E9 I/O modules provider-neutral, git-free and independent of editorial modules",
      () => {
        for (
          const name
          of AUTHORISED_IO_CHARACTER_IDENTITY_MODULES
        ) {
          const text =
            readFileSync(
              new URL(
                name,
                characterIdentityDirectory,
              ),
              "utf8",
            );

          expect(
            text,
            name,
          ).not.toMatch(
            /child_process|fetch\(|dotenv|import\(|require\(|process\.env|@google\/genai|@runwayml|\bveo\b|\brunway\b|\bgit\b|BUSYBOOKIE_MEDIA_ROOT|D:[\\/]/i,
          );

          for (
            const specifier
            of text.matchAll(
              /from\s+["']([^"']+)["']/g,
            )
          ) {
            expect(
              specifier[1],
              name,
            ).toMatch(
              /^(zod|node:(crypto|fs|fs\/promises|path|url)|\.\.?\/[A-Za-z.]+\.js|\.\.\/(schemas|characterIdentity|execution|validation)\/[A-Za-z.]+\.js|\.\.\/\.\.\/(schemas|characterIdentity|execution|validation)\/[A-Za-z.]+\.js)$/,
            );

            expect(
              specifier[1],
              name,
            ).not.toMatch(
              /editorial|providers|veo|runway|dialogue/i,
            );
          }
        }
      },
    );

    it(
      "keeps E9 modules pure, provider-neutral and independent of editorial modules",
      () => {
        const files = [
          ...PURE_CHARACTER_IDENTITY_MODULES.map(
            (name) =>
              new URL(
                name,
                characterIdentityDirectory,
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
        ).toBe(8);

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
