import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createPortableReleaseIdentity,
} from "../scripts/create-portable-release-identity.js";
import {
  BUSYBOOKIE_RELEASE_IDENTITY_FILE,
} from "../src/execution/portableReleaseRuntimeIdentity.js";

const temporaryRoots: string[] = [];

const CONSOLE_INDEX =
  "apps/operator-console/dist/index.html";

const CONSOLE_SCRIPT =
  "apps/operator-console/dist/assets/index-Abc123.js";

const CONSOLE_STYLE =
  "apps/operator-console/dist/assets/index-Def456.css";

const CONSOLE_INDEX_HTML =
  "<!doctype html>\n<html><head>" +
  "<script type=\"module\" crossorigin src=\"/assets/index-Abc123.js\"></script>" +
  "<link rel=\"stylesheet\" crossorigin href=\"/assets/index-Def456.css\">" +
  "</head><body><div id=\"root\"></div></body></html>\n";

afterEach(async () => {
  for (
    const root
    of temporaryRoots.splice(0)
  ) {
    await rm(
      root,
      {
        recursive: true,
        force: true,
      },
    );
  }
});

async function git(
  root: string,
  args: readonly string[],
): Promise<string> {
  return (
    await promisify(execFile)(
      "git",
      [...args],
      {
        cwd: root,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
    )
  ).stdout;
}

async function copyRuntimeFile(
  sourceRoot: string,
  releaseRoot: string,
  relativePath: string,
): Promise<void> {
  const source =
    join(
      sourceRoot,
      ...relativePath.split("/"),
    );

  const destination =
    join(
      releaseRoot,
      ...relativePath.split("/"),
    );

  await mkdir(
    join(
      destination,
      "..",
    ),
    {
      recursive: true,
    },
  );

  await writeFile(
    destination,
    await readFile(source),
    {
      flag: "wx",
    },
  );
}

async function createFixture() {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-release-writer-",
      ),
    );

  temporaryRoots.push(root);

  const sourceRoot =
    join(
      root,
      "source",
    );

  const releaseRoot =
    join(
      root,
      "release",
    );

  await mkdir(
    join(
      sourceRoot,
      "src",
    ),
    {
      recursive: true,
    },
  );

  await mkdir(
    join(
      sourceRoot,
      "dist",
      "nested",
    ),
    {
      recursive: true,
    },
  );

  await mkdir(
    join(
      releaseRoot,
      "dist",
      "nested",
    ),
    {
      recursive: true,
    },
  );

  await writeFile(
    join(
      sourceRoot,
      "src",
      "main.ts",
    ),
    "export const reviewed = true;\n",
  );

  await writeFile(
    join(
      sourceRoot,
      "tsconfig.json",
    ),
    "{}\n",
  );

  await writeFile(
    join(
      sourceRoot,
      "tsconfig.build.json",
    ),
    "{}\n",
  );

  await writeFile(
    join(
      sourceRoot,
      "package.json",
    ),
    "{\"name\":\"busybookie-test\",\"type\":\"module\"}\n",
  );

  await writeFile(
    join(
      sourceRoot,
      "package-lock.json",
    ),
    "{\"name\":\"busybookie-test\",\"lockfileVersion\":3}\n",
  );

  await writeFile(
    join(
      sourceRoot,
      "dist",
      "a.js",
    ),
    "export const a = 1;\n",
  );

  await writeFile(
    join(
      sourceRoot,
      "dist",
      "a.js.map",
    ),
    "{}\n",
  );

  await writeFile(
    join(
      sourceRoot,
      "dist",
      "a.d.ts",
    ),
    "export declare const a: number;\n",
  );

  await writeFile(
    join(
      sourceRoot,
      "dist",
      "nested",
      "b.js",
    ),
    "export const b = 2;\n",
  );

  // The built console is ignored build output, as in the real repository.
  await writeFile(
    join(
      sourceRoot,
      ".gitignore",
    ),
    "apps/operator-console/dist/\n",
  );

  for (
    const [relativePath, content]
    of [
      [CONSOLE_INDEX, CONSOLE_INDEX_HTML],
      [CONSOLE_SCRIPT, "console.log(\"reviewed console\");\n"],
      [CONSOLE_STYLE, "body{margin:0}\n"],
    ] as const
  ) {
    const destination =
      join(
        sourceRoot,
        ...relativePath.split("/"),
      );

    await mkdir(
      join(
        destination,
        "..",
      ),
      {
        recursive: true,
      },
    );

    await writeFile(
      destination,
      content,
    );
  }

  for (
    const relativePath
    of [
      "dist/a.js",
      "dist/a.js.map",
      "dist/a.d.ts",
      "dist/nested/b.js",
      "package.json",
      "package-lock.json",
      CONSOLE_INDEX,
      CONSOLE_SCRIPT,
      CONSOLE_STYLE,
    ]
  ) {
    await copyRuntimeFile(
      sourceRoot,
      releaseRoot,
      relativePath,
    );
  }

  await git(
    sourceRoot,
    ["init", "-q"],
  );

  await git(
    sourceRoot,
    [
      "config",
      "user.email",
      "busybookie-test@example.invalid",
    ],
  );

  await git(
    sourceRoot,
    [
      "config",
      "user.name",
      "BusyBookie Test",
    ],
  );

  await git(
    sourceRoot,
    [
      "add",
      ".gitignore",
      "src/main.ts",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "tsconfig.build.json",
    ],
  );

  await git(
    sourceRoot,
    [
      "commit",
      "-qm",
      "fixture",
    ],
  );

  const reviewedRevision =
    (
      await git(
        sourceRoot,
        [
          "rev-parse",
          "HEAD",
        ],
      )
    ).trim();

  return {
    root,
    sourceRoot,
    releaseRoot,
    reviewedRevision,
    manifestPath:
      join(
        releaseRoot,
        BUSYBOOKIE_RELEASE_IDENTITY_FILE,
      ),
  };
}

async function exists(
  path: string,
): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe(
  "portable release identity writer",
  () => {
    it(
      "writes a deterministic manifest for an exact clean reviewed build without copying Git metadata",
      async () => {
        const fixture =
          await createFixture();

        expect(
          await exists(
            join(
              fixture.releaseRoot,
              ".git",
            ),
          ),
        ).toBe(false);

        const first =
          await createPortableReleaseIdentity({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
          });

        const firstBytes =
          await readFile(
            fixture.manifestPath,
          );

        const parsed =
          JSON.parse(
            firstBytes.toString(
              "utf8",
            ),
          );

        expect(
          parsed,
        ).toEqual({
          schemaVersion:
            "2.0",
          kind:
            "BUSYBOOKIE_PORTABLE_RELEASE_IDENTITY",
          reviewedRevision:
            fixture.reviewedRevision,
          files: [
            expect.objectContaining({
              relativePath:
                CONSOLE_SCRIPT,
            }),
            expect.objectContaining({
              relativePath:
                CONSOLE_STYLE,
            }),
            expect.objectContaining({
              relativePath:
                CONSOLE_INDEX,
            }),
            expect.objectContaining({
              relativePath:
                "dist/a.js",
            }),
            expect.objectContaining({
              relativePath:
                "dist/nested/b.js",
            }),
            expect.objectContaining({
              relativePath:
                "package-lock.json",
            }),
            expect.objectContaining({
              relativePath:
                "package.json",
            }),
          ],
        });

        expect(
          first.fileCount,
        ).toBe(7);

        // Console entries carry real byte length and SHA-256, not just names.
        const consoleScript =
          (parsed.files as { relativePath: string; bytes: number; sha256: string }[])
            .find(
              (entry) =>
                entry.relativePath ===
                CONSOLE_SCRIPT,
            );

        expect(
          consoleScript,
        ).toEqual({
          relativePath:
            CONSOLE_SCRIPT,
          bytes:
            Buffer.byteLength(
              "console.log(\"reviewed console\");\n",
            ),
          sha256:
            expect.stringMatching(
              /^[a-f0-9]{64}$/u,
            ),
        });

        expect(
          first.reviewedRevision,
        ).toBe(
          fixture.reviewedRevision,
        );

        expect(
          first.manifestSha256,
        ).toMatch(
          /^[a-f0-9]{64}$/u,
        );

        await rm(
          fixture.manifestPath,
        );

        const second =
          await createPortableReleaseIdentity({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
          });

        const secondBytes =
          await readFile(
            fixture.manifestPath,
          );

        expect(
          second,
        ).toEqual(first);

        expect(
          secondBytes,
        ).toEqual(firstBytes);
      },
    );

    it(
      "binds tracked package runtime files to reviewed Git blobs instead of host-specific worktree EOL bytes",
      async () => {
        const fixture =
          await createFixture();

        const autocrlfSourceRoot =
          join(
            fixture.root,
            "autocrlf-source",
          );

        await git(
          fixture.root,
          [
            "-c",
            "core.autocrlf=true",
            "clone",
            "-q",
            fixture.sourceRoot,
            autocrlfSourceRoot,
          ],
        );

        await git(
          autocrlfSourceRoot,
          [
            "config",
            "core.autocrlf",
            "true",
          ],
        );

        for (
          const relativePath
          of [
            "dist/a.js",
            "dist/a.js.map",
            "dist/a.d.ts",
            "dist/nested/b.js",
            CONSOLE_INDEX,
            CONSOLE_SCRIPT,
            CONSOLE_STYLE,
          ]
        ) {
          await copyRuntimeFile(
            fixture.sourceRoot,
            autocrlfSourceRoot,
            relativePath,
          );
        }

        const eol =
          await git(
            autocrlfSourceRoot,
            [
              "ls-files",
              "--eol",
              "--",
              "package.json",
              "package-lock.json",
            ],
          );

        const eolLines =
          eol
            .trim()
            .split("\n");

        expect(
          eolLines,
        ).toHaveLength(2);

        expect(
          eolLines.every(
            line =>
              line.includes("i/lf") &&
              line.includes("w/crlf"),
          ),
        ).toBe(true);

        expect(
          (
            await git(
              autocrlfSourceRoot,
              [
                "status",
                "--porcelain=v1",
                "--untracked-files=no",
              ],
            )
          ).trim(),
        ).toBe("");

        const packageJsonWorktree =
          await readFile(
            join(
              autocrlfSourceRoot,
              "package.json",
            ),
          );

        const packageLockWorktree =
          await readFile(
            join(
              autocrlfSourceRoot,
              "package-lock.json",
            ),
          );

        const packageJsonRelease =
          await readFile(
            join(
              fixture.releaseRoot,
              "package.json",
            ),
          );

        const packageLockRelease =
          await readFile(
            join(
              fixture.releaseRoot,
              "package-lock.json",
            ),
          );

        expect(
          packageJsonWorktree.equals(
            packageJsonRelease,
          ),
        ).toBe(false);

        expect(
          packageLockWorktree.equals(
            packageLockRelease,
          ),
        ).toBe(false);

        const result =
          await createPortableReleaseIdentity({
            sourceRoot:
              autocrlfSourceRoot,
            releaseRoot:
              fixture.releaseRoot,
          });

        expect(
          result.reviewedRevision,
        ).toBe(
          fixture.reviewedRevision,
        );

        const manifest =
          JSON.parse(
            await readFile(
              fixture.manifestPath,
              "utf8",
            ),
          ) as {
            files: Array<{
              relativePath: string;
              bytes: number;
              sha256: string;
            }>;
          };

        const packageJsonEntry =
          manifest.files.find(
            entry =>
              entry.relativePath ===
              "package.json",
          );

        const packageLockEntry =
          manifest.files.find(
            entry =>
              entry.relativePath ===
              "package-lock.json",
          );

        expect(
          packageJsonEntry?.bytes,
        ).toBe(
          packageJsonRelease.byteLength,
        );

        expect(
          packageLockEntry?.bytes,
        ).toBe(
          packageLockRelease.byteLength,
        );

        expect(
          packageJsonEntry?.bytes,
        ).not.toBe(
          packageJsonWorktree.byteLength,
        );

        expect(
          packageLockEntry?.bytes,
        ).not.toBe(
          packageLockWorktree.byteLength,
        );
      },
    );

    it(
      "rejects a dirty tracked source checkout before publishing a manifest",
      async () => {
        const fixture =
          await createFixture();

        await writeFile(
          join(
            fixture.sourceRoot,
            "src",
            "main.ts",
          ),
          "export const reviewed = false;\n",
        );

        await expect(
          createPortableReleaseIdentity({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
          }),
        ).rejects.toThrow(
          /Tracked or staged source changes/u,
        );

        expect(
          await exists(
            fixture.manifestPath,
          ),
        ).toBe(false);
      },
    );

    it(
      "rejects an untracked release-authority source file",
      async () => {
        const fixture =
          await createFixture();

        await mkdir(
          join(
            fixture.sourceRoot,
            "scripts",
          ),
          {
            recursive: true,
          },
        );

        await writeFile(
          join(
            fixture.sourceRoot,
            "scripts",
            "unreviewed.ts",
          ),
          "export {};\n",
        );

        await expect(
          createPortableReleaseIdentity({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
          }),
        ).rejects.toThrow(
          /Untracked release-authority source files/u,
        );

        expect(
          await exists(
            fixture.manifestPath,
          ),
        ).toBe(false);
      },
    );

    it(
      "rejects release bytes that differ from the reviewed build",
      async () => {
        const fixture =
          await createFixture();

        await writeFile(
          join(
            fixture.releaseRoot,
            "dist",
            "nested",
            "b.js",
          ),
          "export const tampered = true;\n",
        );

        await expect(
          createPortableReleaseIdentity({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
          }),
        ).rejects.toThrow(
          /does not match the reviewed build/u,
        );

        expect(
          await exists(
            fixture.manifestPath,
          ),
        ).toBe(false);
      },
    );

    it(
      "rejects an extra executable in the release root",
      async () => {
        const fixture =
          await createFixture();

        await writeFile(
          join(
            fixture.releaseRoot,
            "dist",
            "unexpected.js",
          ),
          "export {};\n",
        );

        await expect(
          createPortableReleaseIdentity({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
          }),
        ).rejects.toThrow(
          /inventory does not match/u,
        );

        expect(
          await exists(
            fixture.manifestPath,
          ),
        ).toBe(false);
      },
    );

    it(
      "refuses to overwrite an existing release identity",
      async () => {
        const fixture =
          await createFixture();

        await writeFile(
          fixture.manifestPath,
          "{}\n",
          {
            flag: "wx",
          },
        );

        await expect(
          createPortableReleaseIdentity({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
          }),
        ).rejects.toThrow();

        expect(
          await readFile(
            fixture.manifestPath,
            "utf8",
          ),
        ).toBe("{}\n");
      },
    );

    it(
      "rejects Git metadata inside the portable release root",
      async () => {
        const fixture =
          await createFixture();

        await mkdir(
          join(
            fixture.releaseRoot,
            ".git",
          ),
        );

        await expect(
          createPortableReleaseIdentity({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
          }),
        ).rejects.toThrow(
          /must not contain Git metadata/u,
        );

        expect(
          await exists(
            fixture.manifestPath,
          ),
        ).toBe(false);
      },
    );
  },
);

describe(
  "portable release identity writer: operator-console build (schema 2.0)",
  () => {
    type Fixture = Awaited<ReturnType<typeof createFixture>>;

    const at = (root: string, relativePath: string) =>
      join(root, ...relativePath.split("/"));

    async function expectRejected(fixture: Fixture, pattern: RegExp): Promise<void> {
      await expect(
        createPortableReleaseIdentity({
          sourceRoot: fixture.sourceRoot,
          releaseRoot: fixture.releaseRoot,
        }),
      ).rejects.toThrow(pattern);

      expect(await exists(fixture.manifestPath)).toBe(false);
    }

    it("rejects changed operator-console script bytes under an unchanged name", async () => {
      const fixture = await createFixture();
      await writeFile(at(fixture.releaseRoot, CONSOLE_SCRIPT), "console.log(\"tampered console\");\n");
      await expectRejected(fixture, /does not match the reviewed build/u);
    });

    it("rejects changed operator-console index.html bytes", async () => {
      const fixture = await createFixture();
      await writeFile(at(fixture.releaseRoot, CONSOLE_INDEX), CONSOLE_INDEX_HTML.replace("root", "rogue"));
      await expectRejected(fixture, /does not match the reviewed build/u);
    });

    it("rejects a release without operator-console index.html", async () => {
      const fixture = await createFixture();
      await rm(at(fixture.releaseRoot, CONSOLE_INDEX));
      await expectRejected(fixture, /release build is missing or has an invalid/u);
    });

    it("rejects a release missing an operator-console asset present in the reviewed build", async () => {
      const fixture = await createFixture();
      await rm(at(fixture.releaseRoot, CONSOLE_STYLE));
      await expectRejected(fixture, /inventory does not match/u);
    });

    it("rejects a release without any operator-console script", async () => {
      const fixture = await createFixture();
      await rm(at(fixture.releaseRoot, CONSOLE_SCRIPT));
      await expectRejected(fixture, /release build is missing or has an invalid/u);
    });

    it("rejects an unexpected additional allowed-class operator-console asset", async () => {
      const fixture = await createFixture();
      await writeFile(at(fixture.releaseRoot, "apps/operator-console/dist/assets/extra-Zz9.js"), "export {};\n", { flag: "wx" });
      await expectRejected(fixture, /inventory does not match/u);
    });

    it.each([
      "apps/operator-console/dist/favicon.svg",
      "apps/operator-console/dist/assets/index-Abc123.js.map",
      "apps/operator-console/dist/assets/nested/inner-Q1.js",
    ])("rejects an unexpected console file class or nesting: %s", async (relativePath) => {
      const fixture = await createFixture();
      await mkdir(join(at(fixture.releaseRoot, relativePath), ".."), { recursive: true });
      await writeFile(at(fixture.releaseRoot, relativePath), "x\n", { flag: "wx" });
      await expectRejected(fixture, /release build is missing or has an invalid/u);
    });

    it("rejects a linked operator-console assets directory", async () => {
      const fixture = await createFixture();
      const assets = at(fixture.releaseRoot, "apps/operator-console/dist/assets");
      const real = at(fixture.releaseRoot, "apps/operator-console/dist-real-assets");
      await rename(assets, real);
      // A junction needs no elevated privilege on Windows; elsewhere this is
      // a directory symlink.
      await symlink(real, assets, "junction");
      await expectRejected(fixture, /release build is missing or has an invalid/u);
    });

    it("rejects a reviewed build whose index.html references an asset outside the inventory", async () => {
      const fixture = await createFixture();
      const html = CONSOLE_INDEX_HTML.replace(
        "</head>",
        "<link rel=\"modulepreload\" href=\"/assets/absent-Q9.js\"></head>",
      );
      await writeFile(at(fixture.sourceRoot, CONSOLE_INDEX), html);
      await writeFile(at(fixture.releaseRoot, CONSOLE_INDEX), html);
      await expectRejected(fixture, /references an asset that is not in the release inventory/u);
    });

    it("rejects a reviewed source checkout without an operator-console build", async () => {
      const fixture = await createFixture();
      await rm(at(fixture.sourceRoot, "apps/operator-console/dist"), { recursive: true, force: true });
      await expectRejected(fixture, /source build is missing or has an invalid/u);
    });
  },
);
