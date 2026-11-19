import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  join,
} from "node:path";
import { promisify } from "node:util";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createPortableReleasePackage,
} from "../scripts/create-portable-release-package.js";
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

function sha256(
  bytes: Buffer,
): string {
  return createHash("sha256")
    .update(bytes)
    .digest("hex");
}

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

async function writeRelative(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const destination =
    join(
      root,
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
    {
      flag: "wx",
    },
  );
}

async function copyRelative(
  sourceRoot: string,
  destinationRoot: string,
  relativePath: string,
): Promise<void> {
  await writeRelative(
    destinationRoot,
    relativePath,
    await readFile(
      join(
        sourceRoot,
        ...relativePath.split("/"),
      ),
      "utf8",
    ),
  );
}

async function createFixture() {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-release-package-",
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

  const outputDirectory =
    join(
      root,
      "output",
    );

  await mkdir(
    sourceRoot,
    {
      recursive: true,
    },
  );

  await mkdir(
    releaseRoot,
    {
      recursive: true,
    },
  );

  await mkdir(
    outputDirectory,
    {
      recursive: true,
    },
  );

  await writeRelative(
    sourceRoot,
    "src/main.ts",
    "export const reviewed = true;\n",
  );

  await writeRelative(
    sourceRoot,
    "tsconfig.json",
    "{}\n",
  );

  await writeRelative(
    sourceRoot,
    "tsconfig.build.json",
    "{}\n",
  );

  await writeRelative(
    sourceRoot,
    ".gitignore",
    "apps/operator-console/dist/\n",
  );

  await writeRelative(
    sourceRoot,
    "package.json",
    "{\"name\":\"busybookie-test\",\"type\":\"module\"}\n",
  );

  await writeRelative(
    sourceRoot,
    "package-lock.json",
    "{\"name\":\"busybookie-test\",\"lockfileVersion\":3}\n",
  );

  await writeRelative(
    sourceRoot,
    "dist/a.js",
    "export const a = 1;\n",
  );

  await writeRelative(
    sourceRoot,
    "dist/a.js.map",
    "{}\n",
  );

  await writeRelative(
    sourceRoot,
    "dist/a.d.ts",
    "export declare const a: number;\n",
  );

  await writeRelative(
    sourceRoot,
    "dist/nested/b.js",
    "export const b = 2;\n",
  );

  await writeRelative(
    sourceRoot,
    CONSOLE_INDEX,
    CONSOLE_INDEX_HTML,
  );

  await writeRelative(
    sourceRoot,
    CONSOLE_SCRIPT,
    "console.log(\"reviewed console\");\n",
  );

  await writeRelative(
    sourceRoot,
    CONSOLE_STYLE,
    "body{margin:0}\n",
  );

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
    await copyRelative(
      sourceRoot,
      releaseRoot,
      relativePath,
    );
  }

  await writeRelative(
    releaseRoot,
    "config/production-rules.json",
    "{\"schemaVersion\":\"test\"}\n",
  );

  await writeRelative(
    releaseRoot,
    "episodes/EP90/episode.json",
    "{\"id\":\"EP90\"}\n",
  );

  await git(
    sourceRoot,
    [
      "init",
      "-q",
    ],
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
    outputDirectory,
    reviewedRevision,
  };
}

async function listOutput(
  outputDirectory: string,
): Promise<readonly string[]> {
  return (
    await readdir(
      outputDirectory,
    )
  ).sort();
}

describe(
  "portable release package",
  () => {
    it(
      "creates a verified whole-tree manifest and deterministic archive",
      async () => {
        const fixture =
          await createFixture();

        const result =
          await createPortableReleasePackage({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
            outputDirectory:
              fixture.outputDirectory,
          });

        expect(
          result.reviewedRevision,
        ).toBe(
          fixture.reviewedRevision,
        );

        expect(
          result.identityFileCount,
        ).toBe(7);

        expect(
          result.releaseFileCount,
        ).toBe(12);

        expect(
          result.identityManifestSha256,
        ).toMatch(
          /^[a-f0-9]{64}$/u,
        );

        expect(
          result.treeManifestSha256,
        ).toMatch(
          /^[a-f0-9]{64}$/u,
        );

        expect(
          result.archiveSha256,
        ).toMatch(
          /^[a-f0-9]{64}$/u,
        );

        expect(
          result.archiveBytes,
        ).toBeGreaterThan(0);

        expect(
          result.treeManifestBytes,
        ).toBeGreaterThan(0);

        expect(
          result.tarVersion,
        ).toContain(
          "GNU tar",
        );

        expect(
          result.gzipVersion.toLowerCase(),
        ).toContain(
          "gzip",
        );

        expect(
          await listOutput(
            fixture.outputDirectory,
          ),
        ).toEqual([
          `busybookie-release-${fixture.reviewedRevision}-tree.sha256`,
          `busybookie-release-${fixture.reviewedRevision}.tar.gz`,
        ]);

        const manifestBytes =
          await readFile(
            result.treeManifestPath,
          );

        expect(
          sha256(
            manifestBytes,
          ),
        ).toBe(
          result.treeManifestSha256,
        );

        const archiveBytes =
          await readFile(
            result.archivePath,
          );

        expect(
          sha256(
            archiveBytes,
          ),
        ).toBe(
          result.archiveSha256,
        );

        const manifestText =
          manifestBytes.toString(
            "utf8",
          );

        for (
          const expected
          of [
            `*./${BUSYBOOKIE_RELEASE_IDENTITY_FILE}`,
            "*./config/production-rules.json",
            "*./episodes/EP90/episode.json",
            "*./package.json",
            "*./package-lock.json",
            "*./dist/a.js",
            `*./${CONSOLE_INDEX}`,
          ]
        ) {
          expect(
            manifestText,
          ).toContain(
            expected,
          );
        }

        const archiveListing =
          (
            await promisify(execFile)(
              "tar",
              [
                "--force-local",
                "-tzf",
                result.archivePath,
              ],
              {
                windowsHide: true,
                maxBuffer: 4 * 1024 * 1024,
              },
            )
          ).stdout
            .split(/\r?\n/u)
            .filter(
              line =>
                line.length > 0,
            );

        expect(
          archiveListing.length,
        ).toBe(
          result.releaseFileCount,
        );

        expect(
          archiveListing,
        ).toContain(
          "./episodes/EP90/episode.json",
        );

        expect(
          archiveListing,
        ).not.toContain(
          "./",
        );

        expect(
          archiveListing.some(
            member =>
              member.endsWith("/"),
          ),
        ).toBe(false);
      },
      15_000,
    );

    it(
      "produces the same archive bytes after source mtimes change",
      async () => {
        const first =
          await createFixture();

        const firstResult =
          await createPortableReleasePackage({
            sourceRoot:
              first.sourceRoot,
            releaseRoot:
              first.releaseRoot,
            outputDirectory:
              first.outputDirectory,
          });

        const firstArchive =
          await readFile(
            firstResult.archivePath,
          );

        const second =
          await createFixture();

        const secondCommitTime =
          "2001-01-01T00:00:00Z";

        await git(
          second.sourceRoot,
          [
            "commit",
            "--amend",
            "--no-edit",
            "--date",
            secondCommitTime,
          ],
        );

        const pathsToTouch =
          [
            "dist/a.js",
            "dist/a.js.map",
            "dist/a.d.ts",
            "dist/nested/b.js",
            "package.json",
            "package-lock.json",
            CONSOLE_INDEX,
            CONSOLE_SCRIPT,
            CONSOLE_STYLE,
            "config/production-rules.json",
            "episodes/EP90/episode.json",
          ];

        const changedTime =
          new Date(
            "2035-05-06T07:08:09Z",
          );

        for (
          const relativePath
          of pathsToTouch
        ) {
          await utimes(
            join(
              second.releaseRoot,
              ...relativePath.split("/"),
            ),
            changedTime,
            changedTime,
          );
        }

        const secondResult =
          await createPortableReleasePackage({
            sourceRoot:
              second.sourceRoot,
            releaseRoot:
              second.releaseRoot,
            outputDirectory:
              second.outputDirectory,
          });

        const secondArchive =
          await readFile(
            secondResult.archivePath,
          );

        /*
         * The reviewed Git commit differs because the synthetic fixture was
         * amended, so the identity manifest and therefore archive bytes must
         * differ. Determinism is asserted separately below using the same
         * reviewed revision and byte-identical release tree.
         */
        expect(
          secondResult.reviewedRevision,
        ).not.toBe(
          firstResult.reviewedRevision,
        );

        expect(
          secondArchive.equals(
            firstArchive,
          ),
        ).toBe(false);
      },
    );

    it(
      "is byte-deterministic for the same reviewed revision and tree bytes",
      async () => {
        const fixture =
          await createFixture();

        const firstOutput =
          join(
            fixture.root,
            "output-first",
          );

        const secondOutput =
          join(
            fixture.root,
            "output-second",
          );

        await mkdir(
          firstOutput,
        );

        await mkdir(
          secondOutput,
        );

        const firstResult =
          await createPortableReleasePackage({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
            outputDirectory:
              firstOutput,
          });

        const firstArchive =
          await readFile(
            firstResult.archivePath,
          );

        const firstManifest =
          await readFile(
            firstResult.treeManifestPath,
          );

        await rm(
          join(
            fixture.releaseRoot,
            BUSYBOOKIE_RELEASE_IDENTITY_FILE,
          ),
        );

        const changedTime =
          new Date(
            "2037-08-09T10:11:12Z",
          );

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
            "config/production-rules.json",
            "episodes/EP90/episode.json",
          ]
        ) {
          await utimes(
            join(
              fixture.releaseRoot,
              ...relativePath.split("/"),
            ),
            changedTime,
            changedTime,
          );
        }

        const secondResult =
          await createPortableReleasePackage({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
            outputDirectory:
              secondOutput,
          });

        expect(
          await readFile(
            secondResult.treeManifestPath,
          ),
        ).toEqual(
          firstManifest,
        );

        expect(
          await readFile(
            secondResult.archivePath,
          ),
        ).toEqual(
          firstArchive,
        );

        expect(
          secondResult.archiveSha256,
        ).toBe(
          firstResult.archiveSha256,
        );

        expect(
          secondResult.treeManifestSha256,
        ).toBe(
          firstResult.treeManifestSha256,
        );
      },
    );

    it(
      "rejects a release-tree byte mutation during package verification",
      async () => {
        const fixture =
          await createFixture();

        const packaging =
          createPortableReleasePackage({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
            outputDirectory:
              fixture.outputDirectory,
          });

        const deadline =
          Date.now() + 15_000;

        let streamedProofObserved =
          false;

        while (
          Date.now() <
          deadline
        ) {
          const names =
            await readdir(
              fixture.outputDirectory,
            );

          if (
            names.some(
              name =>
                name.endsWith(
                  ".streamed-tree.building",
                ),
            )
          ) {
            streamedProofObserved =
              true;
            break;
          }

          await new Promise<void>(
            resolveDelay =>
              setTimeout(
                resolveDelay,
                5,
              ),
          );
        }

        expect(
          streamedProofObserved,
        ).toBe(true);

        await writeFile(
          join(
            fixture.releaseRoot,
            "config",
            "production-rules.json",
          ),
          "{\"schemaVersion\":\"mutated-during-packaging\"}\n",
        );

        await expect(
          packaging,
        ).rejects.toThrow(
          /Portable release tree bytes changed before package publication/u,
        );

        expect(
          await listOutput(
            fixture.outputDirectory,
          ),
        ).toEqual([]);

        expect(
          await exists(
            join(
              fixture.releaseRoot,
              BUSYBOOKIE_RELEASE_IDENTITY_FILE,
            ),
          ),
        ).toBe(false);
      },
      20_000,
    );
    it(
      "rejects output inside the reviewed source checkout outside .git",
      async () => {
        const fixture =
          await createFixture();

        const sourceOutput =
          join(
            fixture.sourceRoot,
            "release-output",
          );

        await mkdir(
          sourceOutput,
        );

        await expect(
          createPortableReleasePackage({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
            outputDirectory:
              sourceOutput,
          }),
        ).rejects.toThrow(
          /inside the reviewed source checkout is allowed only under .git/u,
        );

        expect(
          await listOutput(
            sourceOutput,
          ),
        ).toEqual([]);

        expect(
          await exists(
            join(
              fixture.releaseRoot,
              BUSYBOOKIE_RELEASE_IDENTITY_FILE,
            ),
          ),
        ).toBe(false);
      },
    );

    it(
      "allows output under the reviewed source .git directory",
      async () => {
        const fixture =
          await createFixture();

        const gitOutput =
          join(
            fixture.sourceRoot,
            ".git",
            "busybookie-package-test",
          );

        await mkdir(
          gitOutput,
        );

        const result =
          await createPortableReleasePackage({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
            outputDirectory:
              gitOutput,
          });

        expect(
          await listOutput(
            gitOutput,
          ),
        ).toEqual([
          `busybookie-release-${fixture.reviewedRevision}-tree.sha256`,
          `busybookie-release-${fixture.reviewedRevision}.tar.gz`,
        ]);

        expect(
          result.reviewedRevision,
        ).toBe(
          fixture.reviewedRevision,
        );
      },
      15_000,
    );

    it(
      "rejects node_modules before identity generation",
      async () => {
        const fixture =
          await createFixture();

        await writeRelative(
          fixture.releaseRoot,
          "node_modules/rogue/index.js",
          "module.exports = {};\n",
        );

        await expect(
          createPortableReleasePackage({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
            outputDirectory:
              fixture.outputDirectory,
          }),
        ).rejects.toThrow(
          /must not contain node_modules/u,
        );

        expect(
          await exists(
            join(
              fixture.releaseRoot,
              BUSYBOOKIE_RELEASE_IDENTITY_FILE,
            ),
          ),
        ).toBe(false);

        expect(
          await listOutput(
            fixture.outputDirectory,
          ),
        ).toEqual([]);
      },
    );

    it(
      "rejects Git metadata before identity generation",
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
          createPortableReleasePackage({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
            outputDirectory:
              fixture.outputDirectory,
          }),
        ).rejects.toThrow(
          /must not contain Git metadata/u,
        );

        expect(
          await listOutput(
            fixture.outputDirectory,
          ),
        ).toEqual([]);
      },
    );

    it(
      "rejects linked directories in the whole release tree",
      async () => {
        const fixture =
          await createFixture();

        const target =
          join(
            fixture.releaseRoot,
            "config",
          );

        await symlink(
          target,
          join(
            fixture.releaseRoot,
            "linked-config",
          ),
          "junction",
        );

        await expect(
          createPortableReleasePackage({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
            outputDirectory:
              fixture.outputDirectory,
          }),
        ).rejects.toThrow(
          /symbolic link/u,
        );

        expect(
          await listOutput(
            fixture.outputDirectory,
          ),
        ).toEqual([]);
      },
    );

    it(
      "rejects multiply-linked regular files in the whole release tree",
      async () => {
        const fixture =
          await createFixture();

        const source =
          join(
            fixture.releaseRoot,
            "config",
            "production-rules.json",
          );

        const alias =
          join(
            fixture.releaseRoot,
            "config",
            "alias.json",
          );

        await link(
          source,
          alias,
        );

        await expect(
          createPortableReleasePackage({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
            outputDirectory:
              fixture.outputDirectory,
          }),
        ).rejects.toThrow(
          /multiply-linked/u,
        );

        expect(
          await listOutput(
            fixture.outputDirectory,
          ),
        ).toEqual([]);
      },
    );

    it(
      "rejects a release whose reviewed runtime bytes are wrong",
      async () => {
        const fixture =
          await createFixture();

        await writeFile(
          join(
            fixture.releaseRoot,
            "dist",
            "a.js",
          ),
          "export const tampered = true;\n",
        );

        await expect(
          createPortableReleasePackage({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
            outputDirectory:
              fixture.outputDirectory,
          }),
        ).rejects.toThrow(
          /does not match the reviewed build/u,
        );

        expect(
          await exists(
            join(
              fixture.releaseRoot,
              BUSYBOOKIE_RELEASE_IDENTITY_FILE,
            ),
          ),
        ).toBe(false);

        expect(
          await listOutput(
            fixture.outputDirectory,
          ),
        ).toEqual([]);
      },
    );

    it(
      "refuses to overwrite existing final artifacts",
      async () => {
        const fixture =
          await createFixture();

        const archivePath =
          join(
            fixture.outputDirectory,
            `busybookie-release-${fixture.reviewedRevision}.tar.gz`,
          );

        await writeFile(
          archivePath,
          "existing\n",
          {
            flag: "wx",
          },
        );

        await expect(
          createPortableReleasePackage({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
            outputDirectory:
              fixture.outputDirectory,
          }),
        ).rejects.toThrow(
          /Final release archive already exists/u,
        );

        expect(
          await readFile(
            archivePath,
            "utf8",
          ),
        ).toBe(
          "existing\n",
        );

        expect(
          await exists(
            join(
              fixture.releaseRoot,
              BUSYBOOKIE_RELEASE_IDENTITY_FILE,
            ),
          ),
        ).toBe(false);
      },
    );

    it(
      "leaves no temporary packaging artifacts after success",
      async () => {
        const fixture =
          await createFixture();

        const result =
          await createPortableReleasePackage({
            sourceRoot:
              fixture.sourceRoot,
            releaseRoot:
              fixture.releaseRoot,
            outputDirectory:
              fixture.outputDirectory,
          });

        const outputNames =
          await listOutput(
            fixture.outputDirectory,
          );

        expect(
          outputNames.every(
            name =>
              !name.startsWith("."),
          ),
        ).toBe(true);

        expect(
          outputNames,
        ).toEqual([
          basename(
            result.treeManifestPath,
          ),
          basename(
            result.archivePath,
          ),
        ].sort());
      },
    );
  },
);
