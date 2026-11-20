import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
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
  createPortableRelease,
} from "../scripts/create-portable-release.js";

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
        maxBuffer:
          8 * 1024 * 1024,
      },
    )
  ).stdout;
}

async function writeRelative(
  root: string,
  relativePath: string,
  content: string | Buffer,
): Promise<void> {
  const destination =
    join(
      root,
      ...relativePath.split("/"),
    );

  await mkdir(
    dirname(destination),
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

async function listOutput(
  outputDirectory: string,
): Promise<readonly string[]> {
  return (
    await readdir(
      outputDirectory,
    )
  ).sort();
}

async function archiveMemberBytes(
  archivePath: string,
  relativePath: string,
): Promise<Buffer> {
  const result =
    await promisify(execFile)(
      "tar",
      [
        "--force-local",
        "-xOzf",
        archivePath,
        `./${relativePath}`,
      ],
      {
        windowsHide: true,
        maxBuffer:
          32 * 1024 * 1024,
        encoding: null,
      },
    );

  return result.stdout;
}

type FixtureBuildMode =
  | "normal"
  | "missing-dist"
  | "symlink"
  | "hardlink"
  | "dirty-source"
  | "head-drift"
  | "build-failure";

async function createFixture(
  buildMode: FixtureBuildMode =
    "normal",
) {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-release-create-",
      ),
    );

  temporaryRoots.push(root);

  const sourceRoot =
    join(
      root,
      "source",
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
    outputDirectory,
    {
      recursive: true,
    },
  );

  await writeRelative(
    sourceRoot,
    ".gitignore",
    [
      "dist/",
      "apps/operator-console/dist/",
      "",
    ].join("\n"),
  );

  await writeRelative(
    sourceRoot,
    "src/main.ts",
    "export const reviewed = true;\n",
  );

  await writeRelative(
    sourceRoot,
    "scripts/example.ts",
    "export const script = true;\n",
  );

  await writeRelative(
    sourceRoot,
    "tests/example.test.ts",
    "export const test = true;\n",
  );

  await writeRelative(
    sourceRoot,
    "deployment/README.md",
    "fixture deployment\n",
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
    "package.json",
    [
      "{",
      "  \"name\": \"busybookie-test\",",
      "  \"type\": \"module\",",
      "  \"scripts\": {",
      "    \"build\": \"node scripts/fixture-build.cjs\"",
      "  }",
      "}",
      "",
    ].join("\n"),
  );

  await writeRelative(
    sourceRoot,
    "package-lock.json",
    "{\"name\":\"busybookie-test\",\"lockfileVersion\":3}\n",
  );

  const fixtureBuildLines =
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const { execFileSync } = require("node:child_process");',
      'const root = process.cwd();',
      'const dist = path.join(root, "dist");',
      'const consoleDist = path.join(root, "apps", "operator-console", "dist");',
      'fs.rmSync(dist, { recursive: true, force: true });',
      'fs.rmSync(consoleDist, { recursive: true, force: true });',
    ];

  if (
    buildMode ===
      "build-failure"
  ) {
    fixtureBuildLines.push(
      'process.exit(23);',
    );
  }

  if (
    buildMode !==
      "missing-dist"
  ) {
    fixtureBuildLines.push(
      'fs.mkdirSync(path.join(dist, "nested"), { recursive: true });',
      'fs.writeFileSync(path.join(dist, "a.js"), "export const a = 1;\\n");',
      'fs.writeFileSync(path.join(dist, "a.js.map"), "{}\\n");',
      'fs.writeFileSync(path.join(dist, "a.d.ts"), "export declare const a: number;\\n");',
      'fs.writeFileSync(path.join(dist, "nested", "b.js"), "export const b = 2;\\n");',
    );

    if (
      buildMode ===
        "symlink"
    ) {
      fixtureBuildLines.push(
        'fs.symlinkSync(path.join(dist, "nested"), path.join(dist, "linked-directory"), process.platform === "win32" ? "junction" : "dir");',
      );
    }

    if (
      buildMode ===
        "hardlink"
    ) {
      fixtureBuildLines.push(
        'fs.linkSync(path.join(dist, "a.js"), path.join(dist, "alias.js"));',
      );
    }
  }

  fixtureBuildLines.push(
    'fs.mkdirSync(path.join(consoleDist, "assets"), { recursive: true });',
    'fs.writeFileSync(path.join(consoleDist, "index.html"), ' +
      JSON.stringify(CONSOLE_INDEX_HTML) +
      ');',
    'fs.writeFileSync(path.join(consoleDist, "assets", "index-Abc123.js"), "console.log(\\\"reviewed console\\\");\\n");',
    'fs.writeFileSync(path.join(consoleDist, "assets", "index-Def456.css"), "body{margin:0}\\n");',
  );

  if (
    buildMode ===
      "dirty-source"
  ) {
    fixtureBuildLines.push(
      'fs.writeFileSync(path.join(root, "config", "production-rules.json"), "{\\\"schemaVersion\\\":\\\"mutated-by-build\\\"}\\n");',
    );
  }

  if (
    buildMode ===
      "head-drift"
  ) {
    fixtureBuildLines.push(
      'execFileSync("git", ["commit", "--allow-empty", "-qm", "build-head-drift"], { cwd: root, windowsHide: true });',
    );
  }

  fixtureBuildLines.push(
    "",
  );

  await writeRelative(
    sourceRoot,
    "scripts/fixture-build.cjs",
    fixtureBuildLines.join("\n"),
  );

  await writeRelative(
    sourceRoot,
    "config/production-rules.json",
    "{\"schemaVersion\":\"reviewed\"}\n",
  );

  await writeRelative(
    sourceRoot,
    "config/provider-routing-policy.json",
    "{\"provider\":\"reviewed\"}\n",
  );

  await writeRelative(
    sourceRoot,
    "episodes/EP90/episode.json",
    "{\"id\":\"EP90\"}\n",
  );

  await writeRelative(
    sourceRoot,
    "episodes/EP91/episode.json",
    "{\"id\":\"EP91\"}\n",
  );

  await writeRelative(
    sourceRoot,
    "dist/a.js",
    "export const stale = true;\n",
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
      "scripts/example.ts",
      "scripts/fixture-build.cjs",
      "tests/example.test.ts",
      "deployment/README.md",
      "tsconfig.json",
      "tsconfig.build.json",
      "package.json",
      "package-lock.json",
      "config/production-rules.json",
      "config/provider-routing-policy.json",
      "episodes/EP90/episode.json",
      "episodes/EP91/episode.json",
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
    outputDirectory,
    reviewedRevision,
    temporaryReleaseRoot:
      join(
        outputDirectory,
        `.busybookie-release-${reviewedRevision}.assembling`,
      ),
  };
}

describe(
  "createPortableRelease",
  () => {
    it(
      "assembles reviewed Git blobs plus complete build outputs and packages them",
      async () => {
        const fixture =
          await createFixture();

        const result =
          await createPortableRelease({
            sourceRoot:
              fixture.sourceRoot,
            outputDirectory:
              fixture.outputDirectory,
          });

        expect(
          result.reviewedRevision,
        ).toBe(
          fixture.reviewedRevision,
        );

        expect(
          result.trackedFileCount,
        ).toBe(6);

        expect(
          result.buildFileCount,
        ).toBe(7);

        expect(
          result.assembledFileCount,
        ).toBe(13);

        expect(
          result.releaseFileCount,
        ).toBe(14);

        expect(
          await listOutput(
            fixture.outputDirectory,
          ),
        ).toEqual([
          basename(
            result.treeManifestPath,
          ),
          basename(
            result.archivePath,
          ),
        ].sort());

        expect(
          await exists(
            fixture.temporaryReleaseRoot,
          ),
        ).toBe(false);

        expect(
          (
            await archiveMemberBytes(
              result.archivePath,
              "config/production-rules.json",
            )
          ).toString("utf8"),
        ).toBe(
          "{\"schemaVersion\":\"reviewed\"}\n",
        );

        expect(
          (
            await archiveMemberBytes(
              result.archivePath,
              "dist/a.js",
            )
          ).toString("utf8"),
        ).toBe(
          "export const a = 1;\n",
        );

        expect(
          (
            await archiveMemberBytes(
              result.archivePath,
              "dist/a.js.map",
            )
          ).toString("utf8"),
        ).toBe("{}\n");

        expect(
          (
            await archiveMemberBytes(
              result.archivePath,
              "dist/a.d.ts",
            )
          ).toString("utf8"),
        ).toBe(
          "export declare const a: number;\n",
        );
      },
      15_000,
    );

    it(
      "uses reviewed Git blob bytes instead of hidden tracked worktree bytes",
      async () => {
        const fixture =
          await createFixture();

        const trackedPath =
          "config/production-rules.json";

        await git(
          fixture.sourceRoot,
          [
            "update-index",
            "--assume-unchanged",
            trackedPath,
          ],
        );

        await writeFile(
          join(
            fixture.sourceRoot,
            ...trackedPath.split("/"),
          ),
          "{\"schemaVersion\":\"worktree-tamper\"}\r\n",
        );

        expect(
          (
            await git(
              fixture.sourceRoot,
              [
                "status",
                "--porcelain=v1",
              ],
            )
          ).trim(),
        ).toBe("");

        const result =
          await createPortableRelease({
            sourceRoot:
              fixture.sourceRoot,
            outputDirectory:
              fixture.outputDirectory,
          });

        expect(
          (
            await archiveMemberBytes(
              result.archivePath,
              trackedPath,
            )
          ).toString("utf8"),
        ).toBe(
          "{\"schemaVersion\":\"reviewed\"}\n",
        );
      },
      15_000,
    );

    it(
      "is byte-deterministic for the same reviewed revision and build bytes",
      async () => {
        const fixture =
          await createFixture();

        const outputOne =
          join(
            fixture.root,
            "output-one",
          );

        const outputTwo =
          join(
            fixture.root,
            "output-two",
          );

        await mkdir(
          outputOne,
        );

        await mkdir(
          outputTwo,
        );

        const first =
          await createPortableRelease({
            sourceRoot:
              fixture.sourceRoot,
            outputDirectory:
              outputOne,
          });

        const second =
          await createPortableRelease({
            sourceRoot:
              fixture.sourceRoot,
            outputDirectory:
              outputTwo,
          });

        expect(
          await readFile(
            second.archivePath,
          ),
        ).toEqual(
          await readFile(
            first.archivePath,
          ),
        );

        expect(
          await readFile(
            second.treeManifestPath,
          ),
        ).toEqual(
          await readFile(
            first.treeManifestPath,
          ),
        );

        expect(
          second.archiveSha256,
        ).toBe(
          first.archiveSha256,
        );

        expect(
          second.treeManifestSha256,
        ).toBe(
          first.treeManifestSha256,
        );
      },
      20_000,
    );

    it(
      "rejects tracked or staged source changes before assembly",
      async () => {
        const fixture =
          await createFixture();

        await writeFile(
          join(
            fixture.sourceRoot,
            "config",
            "production-rules.json",
          ),
          "{\"schemaVersion\":\"dirty\"}\n",
        );

        await expect(
          createPortableRelease({
            sourceRoot:
              fixture.sourceRoot,
            outputDirectory:
              fixture.outputDirectory,
          }),
        ).rejects.toThrow(
          /Tracked or staged source changes are present/u,
        );

        expect(
          await listOutput(
            fixture.outputDirectory,
          ),
        ).toEqual([]);
      },
    );

    it(
      "rejects an untracked release-authority source file",
      async () => {
        const fixture =
          await createFixture();

        await writeRelative(
          fixture.sourceRoot,
          "config/untracked-policy.json",
          "{}\n",
        );

        await expect(
          createPortableRelease({
            sourceRoot:
              fixture.sourceRoot,
            outputDirectory:
              fixture.outputDirectory,
          }),
        ).rejects.toThrow(
          /Untracked release-authority source files are present/u,
        );

        expect(
          await listOutput(
            fixture.outputDirectory,
          ),
        ).toEqual([]);
      },
    );

    it(
      "fails closed when the controlled build exits nonzero",
      async () => {
        const fixture =
          await createFixture(
            "build-failure",
          );

        await expect(
          createPortableRelease({
            sourceRoot:
              fixture.sourceRoot,
            outputDirectory:
              fixture.outputDirectory,
          }),
        ).rejects.toThrow(
          /Controlled portable release build failed\./u,
        );

        expect(
          await listOutput(
            fixture.outputDirectory,
          ),
        ).toEqual([]);

        await expect(
          access(
            fixture.temporaryReleaseRoot,
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "fails closed when the controlled build dirties reviewed source",
      async () => {
        const fixture =
          await createFixture(
            "dirty-source",
          );

        await expect(
          createPortableRelease({
            sourceRoot:
              fixture.sourceRoot,
            outputDirectory:
              fixture.outputDirectory,
          }),
        ).rejects.toThrow(
          /Tracked or staged source changes are present/u,
        );

        expect(
          await listOutput(
            fixture.outputDirectory,
          ),
        ).toEqual([]);

        await expect(
          access(
            fixture.temporaryReleaseRoot,
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "fails closed when the controlled build changes reviewed HEAD",
      async () => {
        const fixture =
          await createFixture(
            "head-drift",
          );

        await expect(
          createPortableRelease({
            sourceRoot:
              fixture.sourceRoot,
            outputDirectory:
              fixture.outputDirectory,
          }),
        ).rejects.toThrow(
          /Reviewed Git revision changed while creating the portable release/u,
        );

        expect(
          await listOutput(
            fixture.outputDirectory,
          ),
        ).toEqual([]);

        await expect(
          access(
            fixture.temporaryReleaseRoot,
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects a missing reviewed build-output root",
      async () => {
        const fixture =
          await createFixture(
            "missing-dist",
          );

        await expect(
          createPortableRelease({
            sourceRoot:
              fixture.sourceRoot,
            outputDirectory:
              fixture.outputDirectory,
          }),
        ).rejects.toThrow();

        expect(
          await listOutput(
            fixture.outputDirectory,
          ),
        ).toEqual([]);
      },
    );

    it(
      "rejects symbolic links in reviewed build output",
      async () => {
        const fixture =
          await createFixture(
            "symlink",
          );

        await expect(
          createPortableRelease({
            sourceRoot:
              fixture.sourceRoot,
            outputDirectory:
              fixture.outputDirectory,
          }),
        ).rejects.toThrow();

        expect(
          await listOutput(
            fixture.outputDirectory,
          ),
        ).toEqual([]);
      },
    );

    it(
      "rejects multiply-linked reviewed build files",
      async () => {
        const fixture =
          await createFixture(
            "hardlink",
          );

        await expect(
          createPortableRelease({
            sourceRoot:
              fixture.sourceRoot,
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
      "fails closed when build bytes mutate after snapshot capture",
      async () => {
        const fixture =
          await createFixture();

        const largeBytes =
          Buffer.alloc(
            8 * 1024 * 1024,
            0x61,
          );

        await writeRelative(
          fixture.sourceRoot,
          "dist/large.js",
          largeBytes,
        );

        const creating =
          createPortableRelease({
            sourceRoot:
              fixture.sourceRoot,
            outputDirectory:
              fixture.outputDirectory,
          });

        const deadline =
          Date.now() +
          15_000;

        let assemblyObserved =
          false;

        while (
          Date.now() <
          deadline
        ) {
          if (
            await exists(
              fixture.temporaryReleaseRoot,
            )
          ) {
            assemblyObserved =
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
          assemblyObserved,
        ).toBe(true);

        await writeFile(
          join(
            fixture.sourceRoot,
            "dist",
            "a.js",
          ),
          "export const a = 999;\n",
        );

        await expect(
          creating,
        ).rejects.toThrow(
          /Reviewed build output bytes changed while creating the portable release/u,
        );

        expect(
          await exists(
            fixture.temporaryReleaseRoot,
          ),
        ).toBe(false);

        expect(
          await listOutput(
            fixture.outputDirectory,
          ),
        ).toEqual([]);
      },
      20_000,
    );

    it(
      "refuses an existing temporary assembly root without altering it",
      async () => {
        const fixture =
          await createFixture();

        await mkdir(
          fixture.temporaryReleaseRoot,
        );

        await writeFile(
          join(
            fixture.temporaryReleaseRoot,
            "sentinel.txt",
          ),
          "keep\n",
        );

        await expect(
          createPortableRelease({
            sourceRoot:
              fixture.sourceRoot,
            outputDirectory:
              fixture.outputDirectory,
          }),
        ).rejects.toThrow(
          /Temporary portable release root already exists/u,
        );

        expect(
          await readFile(
            join(
              fixture.temporaryReleaseRoot,
              "sentinel.txt",
            ),
            "utf8",
          ),
        ).toBe("keep\n");
      },
    );

    it(
      "rejects an output directory inside the reviewed source checkout",
      async () => {
        const fixture =
          await createFixture();

        const outputInsideSource =
          join(
            fixture.sourceRoot,
            "release-output",
          );

        await mkdir(
          outputInsideSource,
        );

        await expect(
          createPortableRelease({
            sourceRoot:
              fixture.sourceRoot,
            outputDirectory:
              outputInsideSource,
          }),
        ).rejects.toThrow(
          /Output directory must not be inside the reviewed source checkout/u,
        );

        expect(
          await listOutput(
            outputInsideSource,
          ),
        ).toEqual([]);
      },
    );

    it(
      "removes the temporary assembly root when lower-level packaging fails",
      async () => {
        const fixture =
          await createFixture();

        const existingArchive =
          join(
            fixture.outputDirectory,
            `busybookie-release-${fixture.reviewedRevision}.tar.gz`,
          );

        await writeFile(
          existingArchive,
          "existing\n",
          {
            flag: "wx",
          },
        );

        await expect(
          createPortableRelease({
            sourceRoot:
              fixture.sourceRoot,
            outputDirectory:
              fixture.outputDirectory,
          }),
        ).rejects.toThrow(
          /Final release archive already exists/u,
        );

        expect(
          await exists(
            fixture.temporaryReleaseRoot,
          ),
        ).toBe(false);

        expect(
          await readFile(
            existingArchive,
            "utf8",
          ),
        ).toBe(
          "existing\n",
        );

        expect(
          await listOutput(
            fixture.outputDirectory,
          ),
        ).toEqual([
          basename(
            existingArchive,
          ),
        ]);
      },
      15_000,
    );

    it(
      "leaves no temporary assembly or packaging artifacts after success",
      async () => {
        const fixture =
          await createFixture();

        const result =
          await createPortableRelease({
            sourceRoot:
              fixture.sourceRoot,
            outputDirectory:
              fixture.outputDirectory,
          });

        const names =
          await listOutput(
            fixture.outputDirectory,
          );

        expect(
          names,
        ).toEqual([
          basename(
            result.treeManifestPath,
          ),
          basename(
            result.archivePath,
          ),
        ].sort());

        expect(
          names.some(
            name =>
              name.startsWith("."),
          ),
        ).toBe(false);

        expect(
          await exists(
            fixture.temporaryReleaseRoot,
          ),
        ).toBe(false);
      },
      15_000,
    );
  },
);
