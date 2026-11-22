import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
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
  publishPortableReleaseAtomically,
  quarantinePortableRelease,
  requirePortableReleaseSameFilesystem,
} from "../src/deployment/portableReleaseFilesystem.js";

const REVISION =
  "0ff4981807eb8db6a0aac73fefbd94292d7d12ef";

const temporaryRoots:
  string[] =
    [];

afterEach(
  async () => {
    await Promise.all(
      temporaryRoots.splice(
        0,
      ).map(
        value =>
          rm(
            value,
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

async function releaseFixture(): Promise<
  Readonly<{
    releasesRoot: string;
    releaseRoot: string;
  }>
> {
  const releasesRoot =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-release-quarantine-",
      ),
    );

  temporaryRoots.push(
    releasesRoot,
  );

  const releaseRoot =
    join(
      releasesRoot,
      REVISION,
    );

  await mkdir(
    join(
      releaseRoot,
      "app",
    ),
    {
      recursive:
        true,
    },
  );

  await writeFile(
    join(
      releaseRoot,
      "app",
      "package.json",
    ),
    "residue-evidence\n",
  );

  return Object.freeze({
    releasesRoot,
    releaseRoot,
  });
}

describe(
  "portable release filesystem publication",
  () => {
    it(
      "accepts publication roots on the same filesystem device",
      async () => {
        const observed:
          string[] =
          [];

        await expect(
          requirePortableReleaseSameFilesystem(
            {
              releasesRoot:
                "/opt/busybookie/releases",

              stagingReleaseRoot:
                "/opt/busybookie/.installing/revision",
            },
            {
              readDevice:
                async path => {
                  observed.push(
                    path,
                  );

                  return 42;
                },
            },
          ),
        ).resolves.toBeUndefined();

        expect(
          observed,
        ).toEqual([
          "/opt/busybookie/releases",
          "/opt/busybookie/.installing/revision",
        ]);
      },
    );

    it(
      "fails closed when staging and releases are on different filesystem devices",
      async () => {
        await expect(
          requirePortableReleaseSameFilesystem(
            {
              releasesRoot:
                "/opt/busybookie/releases",

              stagingReleaseRoot:
                "/mnt/other/revision",
            },
            {
              readDevice:
                async path =>
                  path.includes(
                    "/mnt/other/",
                  )
                    ? 99
                    : 42,
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release staging and releases roots must be on the same filesystem for atomic publication.",
        );
      },
    );

    it(
      "fails closed when filesystem identity cannot be established",
      async () => {
        await expect(
          requirePortableReleaseSameFilesystem(
            {
              releasesRoot:
                "/opt/busybookie/releases",

              stagingReleaseRoot:
                "/opt/busybookie/.installing/revision",
            },
            {
              readDevice:
                async () => {
                  throw new Error(
                    "synthetic-stat-failure",
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release publication filesystem identity could not be established.",
        );
      },
    );

    it(
      "publishes with one atomic rename",
      async () => {
        const observed:
          Array<
            readonly [
              string,
              string,
            ]
          > =
          [];

        await expect(
          publishPortableReleaseAtomically(
            {
              stagingReleaseRoot:
                "/opt/busybookie/.installing/revision",

              finalReleaseRoot:
                "/opt/busybookie/releases/revision",
            },
            {
              renameRelease:
                async (
                  source,
                  destination,
                ) => {
                  observed.push([
                    source,
                    destination,
                  ]);
                },
            },
          ),
        ).resolves.toBeUndefined();

        expect(
          observed,
        ).toEqual([
          [
            "/opt/busybookie/.installing/revision",
            "/opt/busybookie/releases/revision",
          ],
        ]);
      },
    );

    it(
      "translates EXDEV into an explicit atomic-publication failure",
      async () => {
        const crossDevice =
          Object.assign(
            new Error(
              "cross-device link not permitted",
            ),
            {
              code:
                "EXDEV",
            },
          );

        await expect(
          publishPortableReleaseAtomically(
            {
              stagingReleaseRoot:
                "/mnt/other/revision",

              finalReleaseRoot:
                "/opt/busybookie/releases/revision",
            },
            {
              renameRelease:
                async () => {
                  throw crossDevice;
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release publication crossed filesystem devices; atomic rename is required.",
        );
      },
    );

    it(
      "preserves non-EXDEV rename failures",
      async () => {
        const failure =
          Object.assign(
            new Error(
              "synthetic-permission-failure",
            ),
            {
              code:
                "EACCES",
            },
          );

        let observed:
          unknown;

        try {
          await publishPortableReleaseAtomically(
            {
              stagingReleaseRoot:
                "/opt/busybookie/.installing/revision",

              finalReleaseRoot:
                "/opt/busybookie/releases/revision",
            },
            {
              renameRelease:
                async () => {
                  throw failure;
                },
            },
          );
        } catch (cause) {
          observed =
            cause;
        }

        expect(
          observed,
        ).toBe(
          failure,
        );
      },
    );
  },
);

describe(
  "portable release uncommitted-release quarantine",
  () => {
    it(
      "moves the receipt-less release into .quarantine with one rename, preserves its bytes, then syncs releasesRoot and .quarantine",
      async () => {
        const current =
          await releaseFixture();

        const synced:
          string[] =
            [];

        const destination =
          await quarantinePortableRelease(
            {
              releasesRoot:
                current.releasesRoot,

              reviewedRevision:
                REVISION,

              releaseRoot:
                current.releaseRoot,
            },
            {
              syncDirectory:
                async directory => {
                  synced.push(
                    directory,
                  );
                },
            },
          );

        const quarantineRoot =
          join(
            current.releasesRoot,
            ".quarantine",
          );

        expect(
          await readdir(
            current.releasesRoot,
          ),
        ).toEqual([
          ".quarantine",
        ]);

        const entries =
          await readdir(
            quarantineRoot,
          );

        expect(
          entries,
        ).toHaveLength(
          1,
        );

        expect(
          entries[0],
        ).toMatch(
          new RegExp(
            `^${REVISION}\\.[0-9a-z]+-[0-9a-f]{16}$`,
            "u",
          ),
        );

        expect(
          destination,
        ).toBe(
          join(
            quarantineRoot,
            entries[0] ?? "",
          ),
        );

        expect(
          await readFile(
            join(
              destination,
              "app",
              "package.json",
            ),
            "utf8",
          ),
        ).toBe(
          "residue-evidence\n",
        );

        expect(
          synced,
        ).toEqual([
          current.releasesRoot,
          quarantineRoot,
        ]);
      },
    );

    it(
      "never overwrites existing quarantine evidence on a destination collision",
      async () => {
        const current =
          await releaseFixture();

        const collision =
          join(
            current.releasesRoot,
            ".quarantine",
            `${REVISION}.fixed-0123456789abcdef`,
          );

        await mkdir(
          collision,
          {
            recursive:
              true,
          },
        );

        await writeFile(
          join(
            collision,
            "older-evidence.txt",
          ),
          "older\n",
        );

        await expect(
          quarantinePortableRelease(
            {
              releasesRoot:
                current.releasesRoot,

              reviewedRevision:
                REVISION,

              releaseRoot:
                current.releaseRoot,
            },
            {
              syncDirectory:
                async () => {},

              createQuarantineSuffix:
                () =>
                  "fixed-0123456789abcdef",
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release quarantine destination already exists; existing evidence is never overwritten.",
        );

        expect(
          await readdir(
            collision,
          ),
        ).toEqual([
          "older-evidence.txt",
        ]);

        expect(
          await readFile(
            join(
              collision,
              "older-evidence.txt",
            ),
            "utf8",
          ),
        ).toBe(
          "older\n",
        );

        expect(
          await readFile(
            join(
              current.releaseRoot,
              "app",
              "package.json",
            ),
            "utf8",
          ),
        ).toBe(
          "residue-evidence\n",
        );
      },
    );

    it(
      "fails closed when .quarantine is not a real directory and leaves the release in place",
      async () => {
        const current =
          await releaseFixture();

        await writeFile(
          join(
            current.releasesRoot,
            ".quarantine",
          ),
          "not-a-directory\n",
        );

        await expect(
          quarantinePortableRelease(
            {
              releasesRoot:
                current.releasesRoot,

              reviewedRevision:
                REVISION,

              releaseRoot:
                current.releaseRoot,
            },
            {
              syncDirectory:
                async () => {},
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release quarantine must be a safe real directory.",
        );

        expect(
          await readFile(
            join(
              current.releaseRoot,
              "app",
              "package.json",
            ),
            "utf8",
          ),
        ).toBe(
          "residue-evidence\n",
        );
      },
    );

    it.skipIf(
      process.platform === "win32",
    )(
      "fails closed when .quarantine is a symbolic link",
      async () => {
        const current =
          await releaseFixture();

        const elsewhere =
          await mkdtemp(
            join(
              tmpdir(),
              "busybookie-quarantine-elsewhere-",
            ),
          );

        temporaryRoots.push(
          elsewhere,
        );

        await symlink(
          elsewhere,
          join(
            current.releasesRoot,
            ".quarantine",
          ),
        );

        await expect(
          quarantinePortableRelease(
            {
              releasesRoot:
                current.releasesRoot,

              reviewedRevision:
                REVISION,

              releaseRoot:
                current.releaseRoot,
            },
            {
              syncDirectory:
                async () => {},
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release quarantine must be a safe real directory.",
        );

        expect(
          await readdir(
            elsewhere,
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "rejects a quarantine source other than the reviewed revision directory and an invalid destination name",
      async () => {
        const current =
          await releaseFixture();

        await expect(
          quarantinePortableRelease(
            {
              releasesRoot:
                current.releasesRoot,

              reviewedRevision:
                REVISION,

              releaseRoot:
                join(
                  current.releasesRoot,
                  "other",
                ),
            },
            {
              syncDirectory:
                async () => {},
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release quarantine source must be the reviewed revision directory inside the releases root.",
        );

        await expect(
          quarantinePortableRelease(
            {
              releasesRoot:
                current.releasesRoot,

              reviewedRevision:
                REVISION,

              releaseRoot:
                current.releaseRoot,
            },
            {
              syncDirectory:
                async () => {},

              createQuarantineSuffix:
                () =>
                  "../escape",
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable release quarantine destination name is invalid.",
        );

        expect(
          await readFile(
            join(
              current.releaseRoot,
              "app",
              "package.json",
            ),
            "utf8",
          ),
        ).toBe(
          "residue-evidence\n",
        );
      },
    );
  },
);
