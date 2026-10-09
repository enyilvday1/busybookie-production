import {
  mkdtemp,
  mkdir,
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
} from "vitest";

import {
  readVisualReferenceAssetRegistry,
} from "../src/execution/readVisualReferenceAssetRegistry.js";

import {
  createVisualReferenceAssetRegistryPath,
} from "../src/execution/visualReferenceAssetRegistryPath.js";

const temporaryDirectories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-visual-reference-registry-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

function validRegistry() {
  return {
    schemaVersion:
      "1.0",

    assets: [
      {
        assetId:
          "OLLIE_CHARACTER_MASTER_REFERENCE_V1",

        mediaRootRelativePath:
          "references/ollie-master-character-reference-v1.png",

        bytes:
          1_024,

        sha256:
          "a".repeat(
            64,
          ),

        contentType:
          "image/png",
      },
    ],
  };
}

afterEach(
  async () => {
    const directories =
      temporaryDirectories.splice(
        0,
      );

    await Promise.all(
      directories.map(
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
  "Busybookie visual-reference asset registry persistence",
  () => {
    it(
      "creates one canonical registry path under the trusted references root",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        expect(
          createVisualReferenceAssetRegistryPath(
            mediaRoot,
          ),
        ).toBe(
          resolve(
            mediaRoot,
            "references",
            "visual-reference-asset-registry.json",
          ),
        );
      },
    );

    it(
      "rejects empty and relative media roots",
      () => {
        expect(
          () =>
            createVisualReferenceAssetRegistryPath(
              "   ",
            ),
        ).toThrow(
          /media root.*required/i,
        );

        expect(
          () =>
            createVisualReferenceAssetRegistryPath(
              "relative/media-root",
            ),
        ).toThrow(
          /media root.*absolute/i,
        );
      },
    );

    it(
      "reads and schema-validates the durable registry",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const registryPath =
          createVisualReferenceAssetRegistryPath(
            mediaRoot,
          );

        await mkdir(
          dirname(
            registryPath,
          ),
          {
            recursive:
              true,
          },
        );

        const expected =
          validRegistry();

        await writeFile(
          registryPath,
          JSON.stringify(
            expected,
            null,
            2,
          ),
          "utf8",
        );

        await expect(
          readVisualReferenceAssetRegistry(
            mediaRoot,
          ),
        ).resolves.toEqual(
          expected,
        );
      },
    );

    it(
      "fails closed when the authoritative registry is missing",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          readVisualReferenceAssetRegistry(
            mediaRoot,
          ),
        ).rejects.toThrow(
          /registry.*required.*does not exist/i,
        );
      },
    );

    it(
      "fails closed on malformed registry JSON",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const registryPath =
          createVisualReferenceAssetRegistryPath(
            mediaRoot,
          );

        await mkdir(
          dirname(
            registryPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          registryPath,
          "{ this-is-not-json",
          "utf8",
        );

        await expect(
          readVisualReferenceAssetRegistry(
            mediaRoot,
          ),
        ).rejects.toThrow(
          /registry.*malformed JSON/i,
        );
      },
    );

    it(
      "fails closed when durable registry JSON violates the registry schema",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const registryPath =
          createVisualReferenceAssetRegistryPath(
            mediaRoot,
          );

        await mkdir(
          dirname(
            registryPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          registryPath,
          JSON.stringify(
            {
              schemaVersion:
                "1.0",

              assets: [
                {
                  assetId:
                    "OLLIE_CHARACTER_MASTER_REFERENCE_V1",

                  mediaRootRelativePath:
                    "../outside-references.png",

                  bytes:
                    1,

                  sha256:
                    "a".repeat(
                      64,
                    ),

                  contentType:
                    "image/png",
                },
              ],
            },
            null,
            2,
          ),
          "utf8",
        );

        await expect(
          readVisualReferenceAssetRegistry(
            mediaRoot,
          ),
        ).rejects.toThrow(
          /registry.*invalid/i,
        );
      },
    );
  },
);
