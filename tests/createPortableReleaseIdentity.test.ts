import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
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

  for (
    const relativePath
    of [
      "dist/a.js",
      "dist/a.js.map",
      "dist/a.d.ts",
      "dist/nested/b.js",
      "package.json",
      "package-lock.json",
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
            "1.0",
          kind:
            "BUSYBOOKIE_PORTABLE_RELEASE_IDENTITY",
          reviewedRevision:
            fixture.reviewedRevision,
          files: [
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
        ).toBe(4);

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
