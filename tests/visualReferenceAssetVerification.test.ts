import {
  createHash,
} from "node:crypto";

import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
  resolve,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  VisualReferenceAssetRegistrySchema,
  type VisualReferenceAsset,
  type VisualReferenceAssetRegistry,
} from "../src/execution/visualReferenceAsset.schema.js";

import {
  verifyApprovedVisualReferenceAsset,
} from "../src/execution/verifyApprovedVisualReferenceAsset.js";

const directories:
  string[] = [];

const PNG_BYTES =
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZbQAAAABJRU5ErkJggg==",
    "base64",
  );

const ASSET_ID =
  "ollie-ep02-sc01-s02-visual-source-v1";

const MEDIA_ROOT_RELATIVE_PATH =
  "references/episodes/EP02/SC01/S02/ollie-ep02-s02-visual-source-v1.png";

function sha256(
  bytes:
    Buffer,
): string {
  return createHash(
    "sha256",
  )
    .update(
      bytes,
    )
    .digest(
      "hex",
    );
}

function createAsset(
  overrides:
    Partial<
      VisualReferenceAsset
    > = {},
): VisualReferenceAsset {
  return {
    assetId:
      ASSET_ID,

    mediaRootRelativePath:
      MEDIA_ROOT_RELATIVE_PATH,

    bytes:
      PNG_BYTES.length,

    sha256:
      sha256(
        PNG_BYTES,
      ),

    contentType:
      "image/png",

    ...overrides,
  };
}

async function createFixture() {
  const mediaRoot =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-visual-reference-",
      ),
    );

  directories.push(
    mediaRoot,
  );

  const sourceImagePath =
    resolve(
      mediaRoot,
      ...MEDIA_ROOT_RELATIVE_PATH
        .split(
          "/",
        ),
    );

  await mkdir(
    dirname(
      sourceImagePath,
    ),
    {
      recursive:
        true,
    },
  );

  await writeFile(
    sourceImagePath,
    PNG_BYTES,
  );

  const asset =
    createAsset();

  const registry =
    VisualReferenceAssetRegistrySchema
      .parse({
        schemaVersion:
          "1.0",

        assets: [
          asset,
        ],
      });

  return {
    mediaRoot,
    sourceImagePath,
    asset,
    registry,
  };
}

afterEach(
  async () => {
    await Promise.all(
      directories.splice(
        0,
      )
        .map(
          (directory) =>
            rm(
              directory,
              {
                recursive:
                  true,
                force:
                  true,
              },
            ),
        ),
    );
  },
);

describe(
  "Busybookie immutable visual-reference assets",
  () => {
    it(
      "accepts a strict v1 immutable image registry entry",
      () => {
        const parsed =
          VisualReferenceAssetRegistrySchema
            .parse({
              schemaVersion:
                "1.0",

              assets: [
                createAsset(),
              ],
            });

        expect(
          parsed,
        ).toEqual({
          schemaVersion:
            "1.0",

          assets: [
            createAsset(),
          ],
        });
      },
    );

    it(
      "rejects duplicate asset ids",
      () => {
        expect(
          () =>
            VisualReferenceAssetRegistrySchema
              .parse({
                schemaVersion:
                  "1.0",

                assets: [
                  createAsset(),

                  createAsset({
                    mediaRootRelativePath:
                      "references/episodes/EP02/SC01/S03/alternate.png",
                  }),
                ],
              }),
        ).toThrow(
          /duplicate.*asset|asset.*duplicate/i,
        );
      },
    );

    it(
      "rejects duplicate canonical media paths",
      () => {
        expect(
          () =>
            VisualReferenceAssetRegistrySchema
              .parse({
                schemaVersion:
                  "1.0",

                assets: [
                  createAsset(),

                  createAsset({
                    assetId:
                      "different-asset-id",
                  }),
                ],
              }),
        ).toThrow(
          /duplicate.*path|path.*duplicate/i,
        );
      },
    );

    it(
      "rejects a registry path outside the trusted references tree",
      () => {
        expect(
          () =>
            VisualReferenceAssetRegistrySchema
              .parse({
                schemaVersion:
                  "1.0",

                assets: [
                  createAsset({
                    mediaRootRelativePath:
                      "../escaped-reference.png",
                  }),
                ],
              }),
        ).toThrow(
          /references|mediaRootRelativePath|path/i,
        );
      },
    );

    it(
      "verifies the exact physical image bound to an approved registered asset",
      async () => {
        const fixture =
          await createFixture();

        const expectedPhysicalPath =
          await realpath(
            fixture
              .sourceImagePath,
          );

        const result =
          await verifyApprovedVisualReferenceAsset({
            mediaRoot:
              fixture.mediaRoot,

            sourceImagePath:
              fixture
                .sourceImagePath,

            approvedAssetIds: [
              fixture
                .asset
                .assetId,
            ],

            registry:
              fixture.registry,
          });

        expect(
          result,
        ).toEqual({
          ...fixture.asset,

          absolutePath:
            expectedPhysicalPath,
        });

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "rejects a registered image when its asset id is not approved by the shot",
      async () => {
        const fixture =
          await createFixture();

        await expect(
          verifyApprovedVisualReferenceAsset({
            mediaRoot:
              fixture.mediaRoot,

            sourceImagePath:
              fixture
                .sourceImagePath,

            approvedAssetIds: [
              "different-approved-asset",
            ],

            registry:
              fixture.registry,
          }),
        ).rejects.toThrow(
          /approved|asset id/i,
        );
      },
    );

    it(
      "rejects a different caller source path even when its bytes are identical",
      async () => {
        const fixture =
          await createFixture();

        const alternatePath =
          resolve(
            fixture.mediaRoot,
            "references",
            "episodes",
            "EP02",
            "SC01",
            "S02",
            "alternate-identical.png",
          );

        await writeFile(
          alternatePath,
          PNG_BYTES,
        );

        await expect(
          verifyApprovedVisualReferenceAsset({
            mediaRoot:
              fixture.mediaRoot,

            sourceImagePath:
              alternatePath,

            approvedAssetIds: [
              fixture
                .asset
                .assetId,
            ],

            registry:
              fixture.registry,
          }),
        ).rejects.toThrow(
          /source.*path|registered.*path|approved.*path|canonical.*path/i,
        );
      },
    );

    it(
      "rejects immutable byte-count drift",
      async () => {
        const fixture =
          await createFixture();

        const registry:
          VisualReferenceAssetRegistry =
          VisualReferenceAssetRegistrySchema
            .parse({
              schemaVersion:
                "1.0",

              assets: [
                {
                  ...fixture.asset,

                  bytes:
                    fixture
                      .asset
                      .bytes +
                    1,
                },
              ],
            });

        await expect(
          verifyApprovedVisualReferenceAsset({
            mediaRoot:
              fixture.mediaRoot,

            sourceImagePath:
              fixture
                .sourceImagePath,

            approvedAssetIds: [
              fixture
                .asset
                .assetId,
            ],

            registry,
          }),
        ).rejects.toThrow(
          /byte|size/i,
        );
      },
    );

    it(
      "rejects immutable SHA-256 drift",
      async () => {
        const fixture =
          await createFixture();

        const registry:
          VisualReferenceAssetRegistry =
          VisualReferenceAssetRegistrySchema
            .parse({
              schemaVersion:
                "1.0",

              assets: [
                {
                  ...fixture.asset,

                  sha256:
                    "0".repeat(
                      64,
                    ),
                },
              ],
            });

        await expect(
          verifyApprovedVisualReferenceAsset({
            mediaRoot:
              fixture.mediaRoot,

            sourceImagePath:
              fixture
                .sourceImagePath,

            approvedAssetIds: [
              fixture
                .asset
                .assetId,
            ],

            registry,
          }),
        ).rejects.toThrow(
          /sha-?256|hash/i,
        );
      },
    );

    it(
      "rejects physical realpath escape outside the trusted references root",
      async () => {
        const fixture =
          await createFixture();

        const escapedPhysicalPath =
          resolve(
            fixture.mediaRoot,
            "..",
            "escaped-reference",
            "ollie.png",
          );

        const resolveRealpath =
          vi.fn(
            async (
              candidate:
                string,
            ) => {
              const normalized =
                resolve(
                  candidate,
                );

              if (
                normalized ===
                resolve(
                  fixture
                    .sourceImagePath,
                )
              ) {
                return escapedPhysicalPath;
              }

              return normalized;
            },
          );

        await expect(
          verifyApprovedVisualReferenceAsset(
            {
              mediaRoot:
                fixture.mediaRoot,

              sourceImagePath:
                fixture
                  .sourceImagePath,

              approvedAssetIds: [
                fixture
                  .asset
                  .assetId,
              ],

              registry:
                fixture.registry,
            },
            {
              realpath:
                resolveRealpath,
            },
          ),
        ).rejects.toThrow(
          /physical|realpath|outside.*references|references.*root/i,
        );
      },
    );
    it(
      "rejects a relative Busybookie media root",
      async () => {
        const fixture =
          await createFixture();

        await expect(
          verifyApprovedVisualReferenceAsset({
            mediaRoot:
              "relative/media-root",

            sourceImagePath:
              fixture
                .sourceImagePath,

            approvedAssetIds: [
              fixture
                .asset
                .assetId,
            ],

            registry:
              fixture.registry,
          }),
        ).rejects.toThrow(
          /media root.*absolute|absolute.*media root/i,
        );
      },
    );

    it(
      "rejects a relative caller source image path",
      async () => {
        const fixture =
          await createFixture();

        await expect(
          verifyApprovedVisualReferenceAsset({
            mediaRoot:
              fixture.mediaRoot,

            sourceImagePath:
              "references/episodes/EP02/SC01/S02/ollie.png",

            approvedAssetIds: [
              fixture
                .asset
                .assetId,
            ],

            registry:
              fixture.registry,
          }),
        ).rejects.toThrow(
          /source image path.*absolute|absolute.*source image path/i,
        );
      },
    );

    it(
      "rejects an empty approved-asset set",
      async () => {
        const fixture =
          await createFixture();

        await expect(
          verifyApprovedVisualReferenceAsset({
            mediaRoot:
              fixture.mediaRoot,

            sourceImagePath:
              fixture
                .sourceImagePath,

            approvedAssetIds:
              [],

            registry:
              fixture.registry,
          }),
        ).rejects.toThrow(
          /at least one approved asset id/i,
        );
      },
    );

    it(
      "rejects duplicate approved asset ids",
      async () => {
        const fixture =
          await createFixture();

        await expect(
          verifyApprovedVisualReferenceAsset({
            mediaRoot:
              fixture.mediaRoot,

            sourceImagePath:
              fixture
                .sourceImagePath,

            approvedAssetIds: [
              fixture
                .asset
                .assetId,

              fixture
                .asset
                .assetId,
            ],

            registry:
              fixture.registry,
          }),
        ).rejects.toThrow(
          /approved.*asset.*duplicate|duplicate.*approved/i,
        );
      },
    );

    it(
      "rejects an approved asset id absent from the registry",
      async () => {
        const fixture =
          await createFixture();

        await expect(
          verifyApprovedVisualReferenceAsset({
            mediaRoot:
              fixture.mediaRoot,

            sourceImagePath:
              fixture
                .sourceImagePath,

            approvedAssetIds: [
              "missing-registered-asset",
            ],

            registry:
              fixture.registry,
          }),
        ).rejects.toThrow(
          /approved.*asset.*not registered|not registered.*asset/i,
        );
      },
    );

    it(
      "rejects a caller source path outside the trusted references root",
      async () => {
        const fixture =
          await createFixture();

        const outsidePath =
          resolve(
            fixture.mediaRoot,
            "generated-video",
            "EP02",
            "S02",
            "ollie.png",
          );

        await mkdir(
          dirname(
            outsidePath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          outsidePath,
          PNG_BYTES,
        );

        await expect(
          verifyApprovedVisualReferenceAsset({
            mediaRoot:
              fixture.mediaRoot,

            sourceImagePath:
              outsidePath,

            approvedAssetIds: [
              fixture
                .asset
                .assetId,
            ],

            registry:
              fixture.registry,
          }),
        ).rejects.toThrow(
          /strictly inside.*references|references.*root/i,
        );
      },
    );

    it(
      "rejects declared image content type that does not match physical bytes",
      async () => {
        const fixture =
          await createFixture();

        const registry:
          VisualReferenceAssetRegistry =
          VisualReferenceAssetRegistrySchema
            .parse({
              schemaVersion:
                "1.0",

              assets: [
                {
                  ...fixture.asset,

                  contentType:
                    "image/jpeg",
                },
              ],
            });

        await expect(
          verifyApprovedVisualReferenceAsset({
            mediaRoot:
              fixture.mediaRoot,

            sourceImagePath:
              fixture
                .sourceImagePath,

            approvedAssetIds: [
              fixture
                .asset
                .assetId,
            ],

            registry,
          }),
        ).rejects.toThrow(
          /content type.*mismatch|mismatch.*content type/i,
        );
      },
    );

    it(
      "rejects an empty approved asset id",
      async () => {
        const fixture =
          await createFixture();

        await expect(
          verifyApprovedVisualReferenceAsset({
            mediaRoot:
              fixture.mediaRoot,

            sourceImagePath:
              fixture
                .sourceImagePath,

            approvedAssetIds: [
              "   ",
            ],

            registry:
              fixture.registry,
          }),
        ).rejects.toThrow(
          /approved.*asset.*empty|must not be empty/i,
        );
      },
    );

  },
);
