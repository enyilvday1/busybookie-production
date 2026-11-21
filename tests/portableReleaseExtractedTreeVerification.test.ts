import {
  createHash,
} from "node:crypto";

import {
  link,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
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
  verifyPortableReleaseExtractedTree,
} from "../src/deployment/verifyPortableReleaseExtractedTree.js";

const roots: string[] = [];

async function fixtureRoot(): Promise<string> {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-extracted-tree-",
      ),
    );

  roots.push(root);

  return root;
}

function sha256(
  bytes: Buffer,
): string {
  return createHash("sha256")
    .update(bytes)
    .digest("hex");
}

function entry(
  relativePath: string,
  bytes: Buffer,
) {
  return Object.freeze({
    relativePath,
    sha256:
      sha256(bytes),
  });
}

afterEach(
  async () => {
    while (roots.length > 0) {
      const root =
        roots.pop();

      if (root !== undefined) {
        await rm(
          root,
          {
            recursive: true,
            force: true,
          },
        );
      }
    }
  },
);

describe(
  "portable release extracted-tree verification",
  () => {
    it(
      "accepts an exact regular-file tree whose bytes match the manifest",
      async () => {
        const root =
          await fixtureRoot();

        const payload =
          resolve(root, "payload");

        await mkdir(
          resolve(payload, "dist"),
          {
            recursive: true,
          },
        );

        const packageJson =
          Buffer.from("{}\n");

        const appJs =
          Buffer.from(
            "console.log('ok');\n",
          );

        await writeFile(
          resolve(
            payload,
            "package.json",
          ),
          packageJson,
        );

        await writeFile(
          resolve(
            payload,
            "dist/app.js",
          ),
          appJs,
        );

        const result =
          await verifyPortableReleaseExtractedTree({
            root:
              payload,
            manifest:
              Object.freeze([
                entry(
                  "dist/app.js",
                  appJs,
                ),
                entry(
                  "package.json",
                  packageJson,
                ),
              ]),
          });

        expect(
          result.fileCount,
        ).toBe(2);

        expect(
          result.files,
        ).toEqual([
          "dist/app.js",
          "package.json",
        ]);

        expect(
          Object.isFrozen(result),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.files,
          ),
        ).toBe(true);
      },
    );

    it(
      "rejects an extracted regular file absent from the manifest",
      async () => {
        const root =
          await fixtureRoot();

        const payload =
          resolve(root, "payload");

        await mkdir(
          payload,
          {
            recursive: true,
          },
        );

        const packageJson =
          Buffer.from("{}\n");

        await writeFile(
          resolve(
            payload,
            "package.json",
          ),
          packageJson,
        );

        await writeFile(
          resolve(
            payload,
            "extra.txt",
          ),
          "extra\n",
        );

        await expect(
          verifyPortableReleaseExtractedTree({
            root:
              payload,
            manifest:
              Object.freeze([
                entry(
                  "package.json",
                  packageJson,
                ),
              ]),
          }),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects a manifest file missing from the extracted tree",
      async () => {
        const root =
          await fixtureRoot();

        const payload =
          resolve(root, "payload");

        await mkdir(
          payload,
          {
            recursive: true,
          },
        );

        const bytes =
          Buffer.from("{}\n");

        await expect(
          verifyPortableReleaseExtractedTree({
            root:
              payload,
            manifest:
              Object.freeze([
                entry(
                  "package.json",
                  bytes,
                ),
              ]),
          }),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects extracted file bytes that differ from the manifest hash",
      async () => {
        const root =
          await fixtureRoot();

        const payload =
          resolve(root, "payload");

        await mkdir(
          payload,
          {
            recursive: true,
          },
        );

        await writeFile(
          resolve(
            payload,
            "package.json",
          ),
          "actual\n",
        );

        await expect(
          verifyPortableReleaseExtractedTree({
            root:
              payload,
            manifest:
              Object.freeze([
                entry(
                  "package.json",
                  Buffer.from(
                    "expected\n",
                  ),
                ),
              ]),
          }),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects a multi-link regular file",
      async () => {
        const root =
          await fixtureRoot();

        const payload =
          resolve(root, "payload");

        await mkdir(
          payload,
          {
            recursive: true,
          },
        );

        const bytes =
          Buffer.from("{}\n");

        const primary =
          resolve(
            payload,
            "package.json",
          );

        const alias =
          resolve(
            payload,
            "package-copy.json",
          );

        await writeFile(
          primary,
          bytes,
        );

        await link(
          primary,
          alias,
        );

        await expect(
          verifyPortableReleaseExtractedTree({
            root:
              payload,
            manifest:
              Object.freeze([
                entry(
                  "package-copy.json",
                  bytes,
                ),
                entry(
                  "package.json",
                  bytes,
                ),
              ]),
          }),
        ).rejects.toThrow();
      },
    );

    it.skipIf(
      process.platform === "win32",
    )(
      "rejects an extracted symlink",
      async () => {
        const root =
          await fixtureRoot();

        const payload =
          resolve(root, "payload");

        await mkdir(
          payload,
          {
            recursive: true,
          },
        );

        const bytes =
          Buffer.from("{}\n");

        const primary =
          resolve(
            payload,
            "package.json",
          );

        const alias =
          resolve(
            payload,
            "package-alias.json",
          );

        await writeFile(
          primary,
          bytes,
        );

        await symlink(
          primary,
          alias,
          "file",
        );

        await expect(
          verifyPortableReleaseExtractedTree({
            root:
              payload,
            manifest:
              Object.freeze([
                entry(
                  "package-alias.json",
                  bytes,
                ),
                entry(
                  "package.json",
                  bytes,
                ),
              ]),
          }),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects a manifest path that attempts to leave the extracted root",
      async () => {
        const root =
          await fixtureRoot();

        const payload =
          resolve(root, "payload");

        await mkdir(
          payload,
          {
            recursive: true,
          },
        );

        await expect(
          verifyPortableReleaseExtractedTree({
            root:
              payload,
            manifest:
              Object.freeze([
                {
                  relativePath:
                    "../escape.txt",
                  sha256:
                    "0".repeat(64),
                },
              ]),
          }),
        ).rejects.toThrow();
      },
    );
  },
);
