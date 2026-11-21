import {
  createHash,
} from "node:crypto";

import {
  link,
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createPortableReleaseDependencyTreeManifest,
  PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST_KIND,
  PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST_SCHEMA_VERSION,
  serializePortableReleaseDependencyTreeManifest,
} from "../src/deployment/portableReleaseDependencyTreeManifest.js";

const temporaryRoots:
  string[] =
    [];

async function temporaryRoot(): Promise<string> {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-dependency-tree-",
      ),
    );

  temporaryRoots.push(
    root,
  );

  return root;
}

async function writeRelative(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const components =
    relativePath.split(
      "/",
    );

  const fileName =
    components.pop();

  if (
    fileName ===
      undefined
  ) {
    throw new Error(
      "Fixture path has no file name.",
    );
  }

  const parent =
    join(
      root,
      ...components,
    );

  await mkdir(
    parent,
    {
      recursive:
        true,
    },
  );

  await writeFile(
    join(
      parent,
      fileName,
    ),
    content,
    {
      flag:
        "wx",
    },
  );
}

function rawSha256(
  value:
    string |
    Uint8Array,
): string {
  return createHash(
    "sha256",
  )
    .update(
      value,
    )
    .digest(
      "hex",
    );
}

afterEach(
  async () => {
    for (
      const root
      of temporaryRoots.splice(
        0,
      )
    ) {
      await rm(
        root,
        {
          recursive:
            true,

          force:
            true,
        },
      );
    }
  },
);

describe(
  "portable release dependency-tree manifest",
  () => {
    it(
      "creates a versioned canonical byte manifest and digest for sorted regular files",
      async () => {
        const root =
          await temporaryRoot();

        await writeRelative(
          root,
          "@scope/pkg/index.js",
          "export const value = 1;\n",
        );

        await writeRelative(
          root,
          ".package-lock.json",
          "{\"lockfileVersion\":3}\n",
        );

        const result =
          await createPortableReleaseDependencyTreeManifest(
            root,
          );

        const expectedFiles =
          Object.freeze([
            Object.freeze({
              relativePath:
                ".package-lock.json",

              bytes:
                Buffer.byteLength(
                  "{\"lockfileVersion\":3}\n",
                ),

              sha256:
                rawSha256(
                  "{\"lockfileVersion\":3}\n",
                ),
            }),

            Object.freeze({
              relativePath:
                "@scope/pkg/index.js",

              bytes:
                Buffer.byteLength(
                  "export const value = 1;\n",
                ),

              sha256:
                rawSha256(
                  "export const value = 1;\n",
                ),
            }),
          ]);

        expect(
          result.schemaVersion,
        ).toBe(
          "1.0",
        );

        expect(
          result.kind,
        ).toBe(
          "BUSYBOOKIE_PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST",
        );

        expect(
          result.files,
        ).toEqual(
          expectedFiles,
        );

        expect(
          result.fileCount,
        ).toBe(
          2,
        );

        expect(
          result.totalBytes,
        ).toBe(
          expectedFiles.reduce(
            (
              total,
              file,
            ) =>
              total +
              file.bytes,
            0,
          ),
        );

        const expectedManifest =
          Buffer.from(
            [
              JSON.stringify({
                kind:
                  PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST_KIND,

                schemaVersion:
                  PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST_SCHEMA_VERSION,
              }),

              JSON.stringify(
                expectedFiles[0],
              ),

              JSON.stringify(
                expectedFiles[1],
              ),

              "",
            ].join(
              "\n",
            ),
            "utf8",
          );

        expect(
          serializePortableReleaseDependencyTreeManifest(
            result.files,
          ),
        ).toEqual(
          expectedManifest,
        );

        expect(
          result.manifestSha256,
        ).toBe(
          rawSha256(
            expectedManifest,
          ),
        );
      },
    );

    it(
      "produces identical manifest bytes after creation order and mtimes change",
      async () => {
        const first =
          await temporaryRoot();

        const second =
          await temporaryRoot();

        await writeRelative(
          first,
          "pkg/b.js",
          "b\n",
        );

        await writeRelative(
          first,
          "pkg/a.js",
          "a\n",
        );

        await writeRelative(
          second,
          "pkg/a.js",
          "a\n",
        );

        await writeRelative(
          second,
          "pkg/b.js",
          "b\n",
        );

        await utimes(
          join(
            second,
            "pkg",
            "a.js",
          ),
          new Date(
            "2020-01-01T00:00:00.000Z",
          ),
          new Date(
            "2020-01-01T00:00:00.000Z",
          ),
        );

        const firstResult =
          await createPortableReleaseDependencyTreeManifest(
            first,
          );

        const secondResult =
          await createPortableReleaseDependencyTreeManifest(
            second,
          );

        expect(
          firstResult.files,
        ).toEqual(
          secondResult.files,
        );

        expect(
          firstResult.manifestSha256,
        ).toBe(
          secondResult.manifestSha256,
        );

        expect(
          serializePortableReleaseDependencyTreeManifest(
            firstResult.files,
          ),
        ).toEqual(
          serializePortableReleaseDependencyTreeManifest(
            secondResult.files,
          ),
        );
      },
    );

    it(
      "changes the manifest digest when dependency bytes change",
      async () => {
        const first =
          await temporaryRoot();

        const second =
          await temporaryRoot();

        await writeRelative(
          first,
          "pkg/index.js",
          "one\n",
        );

        await writeRelative(
          second,
          "pkg/index.js",
          "two\n",
        );

        const firstResult =
          await createPortableReleaseDependencyTreeManifest(
            first,
          );

        const secondResult =
          await createPortableReleaseDependencyTreeManifest(
            second,
          );

        expect(
          firstResult.manifestSha256,
        ).not.toBe(
          secondResult.manifestSha256,
        );
      },
    );

    it(
      "rejects a file added after initial discovery",
      async () => {
        const root =
          await temporaryRoot();

        await writeRelative(
          root,
          "pkg/index.js",
          "value\n",
        );

        await expect(
          createPortableReleaseDependencyTreeManifest(
            root,
            {
              afterInitialDiscovery:
                async () => {
                  await writeRelative(
                    root,
                    "pkg/late.js",
                    "late\n",
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Dependency-tree inventory changed while manifest was being created.",
        );
      },
    );

    it(
      "rejects a file removed after initial discovery",
      async () => {
        const root =
          await temporaryRoot();

        const file =
          join(
            root,
            "pkg",
            "index.js",
          );

        await writeRelative(
          root,
          "pkg/index.js",
          "value\n",
        );

        await expect(
          createPortableReleaseDependencyTreeManifest(
            root,
            {
              afterInitialDiscovery:
                async () => {
                  await rm(
                    file,
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Dependency-tree regular file changed before hashing.",
        );
      },
    );

    it(
      "rejects same-path file replacement after initial discovery",
      async () => {
        const root =
          await temporaryRoot();

        const holdingRoot =
          await temporaryRoot();

        const file =
          join(
            root,
            "pkg",
            "index.js",
          );

        await writeRelative(
          root,
          "pkg/index.js",
          "value\n",
        );

        await expect(
          createPortableReleaseDependencyTreeManifest(
            root,
            {
              afterInitialDiscovery:
                async () => {
                  await rename(
                    file,
                    join(
                      holdingRoot,
                      "original.js",
                    ),
                  );

                  await writeFile(
                    file,
                    "other\n",
                    {
                      flag:
                        "wx",
                    },
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Dependency-tree inventory changed while manifest was being created.",
        );
      },
    );

    it(
      "rejects a multiply-linked regular file",
      async () => {
        const root =
          await temporaryRoot();

        await writeRelative(
          root,
          "pkg/index.js",
          "value\n",
        );

        await link(
          join(
            root,
            "pkg",
            "index.js",
          ),
          join(
            root,
            "pkg",
            "alias.js",
          ),
        );

        await expect(
          createPortableReleaseDependencyTreeManifest(
            root,
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Dependency tree contains a multiply-linked regular file.",
        );
      },
    );

    it.skipIf(
      process.platform ===
        "win32",
    )(
      "rejects symbolic links",
      async () => {
        const root =
          await temporaryRoot();

        await writeRelative(
          root,
          "pkg/index.js",
          "value\n",
        );

        await symlink(
          "index.js",
          join(
            root,
            "pkg",
            "alias.js",
          ),
        );

        await expect(
          createPortableReleaseDependencyTreeManifest(
            root,
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Dependency tree contains a symbolic link.",
        );
      },
    );

    it(
      "rejects an empty dependency tree",
      async () => {
        const root =
          await temporaryRoot();

        await expect(
          createPortableReleaseDependencyTreeManifest(
            root,
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Dependency tree must contain at least one regular file.",
        );
      },
    );

    it(
      "rejects a regular file as the dependency root",
      async () => {
        const root =
          await temporaryRoot();

        const file =
          join(
            root,
            "not-a-directory",
          );

        await writeFile(
          file,
          "x\n",
          {
            flag:
              "wx",
          },
        );

        await expect(
          createPortableReleaseDependencyTreeManifest(
            file,
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Dependency-tree root must be a real directory.",
        );
      },
    );
  },
);
