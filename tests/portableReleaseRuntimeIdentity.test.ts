import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  BUSYBOOKIE_RELEASE_IDENTITY_FILE,
  rawSha256,
  readEpisodeRuntimeIdentity,
} from "../src/execution/episodeInputBinding.js";

const REVIEWED_REVISION =
  "a15cb68ead89c969742a016d27daf235bf584a8b";

type ReleaseFileEntry =
  Readonly<{
    relativePath:
      string;

    bytes:
      number;

    sha256:
      string;
  }>;

type PortableFixture =
  Readonly<{
    fixtureRoot:
      string;

    releaseRoot:
      string;

    mediaRoot:
      string;

    files:
      readonly ReleaseFileEntry[];
  }>;

const temporaryRoots:
  string[] =
    [];

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

async function writeReleaseFile(
  releaseRoot:
    string,

  relativePath:
    string,

  content:
    string,
): Promise<ReleaseFileEntry> {
  const absolutePath =
    join(
      releaseRoot,
      ...relativePath.split(
        "/",
      ),
    );

  await mkdir(
    dirname(
      absolutePath,
    ),
    {
      recursive:
        true,
    },
  );

  const bytes =
    Buffer.from(
      content,
      "utf8",
    );

  await writeFile(
    absolutePath,
    bytes,
    {
      flag:
        "wx",
    },
  );

  return Object.freeze({
    relativePath,

    bytes:
      bytes.byteLength,

    sha256:
      rawSha256(
        bytes,
      ),
  });
}

function sortEntries(
  files:
    readonly ReleaseFileEntry[],
): readonly ReleaseFileEntry[] {
  return Object.freeze(
    [...files]
      .sort(
        (
          left,
          right,
        ) =>
          left.relativePath <
          right.relativePath
            ? -1
            : left.relativePath >
                right.relativePath
              ? 1
              : 0,
      ),
  );
}

async function createPortableFixture(): Promise<PortableFixture> {
  /*
   * Deliberately create the fixture outside the BusyBookie repository.
   * A runtime implementation that still requires Git cannot accidentally
   * discover the developer checkout by walking parent directories.
   */
  const fixtureRoot =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-portable-release-",
      ),
    );

  temporaryRoots.push(
    fixtureRoot,
  );

  const releaseRoot =
    join(
      fixtureRoot,
      "release",
    );

  const mediaRoot =
    join(
      fixtureRoot,
      "media",
    );

  await mkdir(
    releaseRoot,
    {
      recursive:
        true,
    },
  );

  await mkdir(
    mediaRoot,
    {
      recursive:
        true,
    },
  );

  const files =
    sortEntries([
      await writeReleaseFile(
        releaseRoot,
        "dist/execution/episodeAutomationProcess.js",
        "export {};\n",
      ),

      await writeReleaseFile(
        releaseRoot,
        "dist/execution/episodeInputBinding.js",
        "export {};\n",
      ),

      await writeReleaseFile(
        releaseRoot,
        "package-lock.json",
        "{\"lockfileVersion\":3}\n",
      ),

      await writeReleaseFile(
        releaseRoot,
        "package.json",
        "{\"name\":\"busybookie-portable-test\",\"type\":\"module\"}\n",
      ),
    ]);

  return Object.freeze({
    fixtureRoot,
    releaseRoot,
    mediaRoot,
    files,
  });
}

async function writeManifest(
  fixture:
    PortableFixture,

  files:
    readonly ReleaseFileEntry[] =
      fixture.files,
): Promise<void> {
  const manifest =
    Object.freeze({
      schemaVersion:
        "1.0",

      kind:
        "BUSYBOOKIE_PORTABLE_RELEASE_IDENTITY",

      reviewedRevision:
        REVIEWED_REVISION,

      files,
    });

  await writeFile(
    join(
      fixture.releaseRoot,
      BUSYBOOKIE_RELEASE_IDENTITY_FILE,
    ),
    JSON.stringify(
      manifest,
      null,
      2,
    ) +
      "\n",
    {
      flag:
        "wx",
    },
  );
}

describe(
  "portable release runtime identity",
  () => {
    it(
      "reads the exact immutable runtime identity without a Git worktree",
      async () => {
        const fixture =
          await createPortableFixture();

        await writeManifest(
          fixture,
        );

        const identity =
          await readEpisodeRuntimeIdentity(
            fixture.releaseRoot,
            fixture.mediaRoot,
          );

        expect(
          identity.reviewedRevision,
        ).toBe(
          REVIEWED_REVISION,
        );

        expect(
          identity.repositoryRoot,
        ).toBe(
          fixture.releaseRoot,
        );

        expect(
          identity.mediaRoot,
        ).toBe(
          fixture.mediaRoot,
        );

        expect(
          identity.physicalMediaRoot,
        ).toBe(
          fixture.mediaRoot,
        );

        expect(
          identity.ffprobe,
        ).toBeNull();

        expect(
          identity.executableInputs.map(
            (
              binding,
            ) =>
              binding.role,
          ),
        ).toEqual([
          "RUNTIME_RELEASE_MANIFEST",
          "RUNTIME:dist/execution/episodeAutomationProcess.js",
          "RUNTIME:dist/execution/episodeInputBinding.js",
          "RUNTIME:package-lock.json",
          "RUNTIME:package.json",
        ]);

        expect(
          identity.executableInputs.every(
            (
              binding,
            ) =>
              binding.exists &&
              typeof binding.rawSha256 ===
                "string" &&
              /^[a-f0-9]{64}$/u.test(
                binding.rawSha256,
              ) &&
              binding.bytes >
                0,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "fails closed when a manifest-bound runtime file is modified",
      async () => {
        const fixture =
          await createPortableFixture();

        await writeManifest(
          fixture,
        );

        await writeFile(
          join(
            fixture.releaseRoot,
            "dist",
            "execution",
            "episodeInputBinding.js",
          ),
          "export const tampered = true;\n",
        );

        await expect(
          readEpisodeRuntimeIdentity(
            fixture.releaseRoot,
            fixture.mediaRoot,
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "fails closed when an unmanifested executable is added to dist",
      async () => {
        const fixture =
          await createPortableFixture();

        await writeManifest(
          fixture,
        );

        await writeFile(
          join(
            fixture.releaseRoot,
            "dist",
            "execution",
            "unexpected.js",
          ),
          "export {};\n",
          {
            flag:
              "wx",
          },
        );

        await expect(
          readEpisodeRuntimeIdentity(
            fixture.releaseRoot,
            fixture.mediaRoot,
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects release-manifest path traversal instead of falling back to Git",
      async () => {
        const fixture =
          await createPortableFixture();

        const malicious =
          sortEntries([
            ...fixture.files,

            Object.freeze({
              relativePath:
                "../escape.js",

              bytes:
                1,

              sha256:
                "a".repeat(
                  64,
                ),
            }),
          ]);

        await writeManifest(
          fixture,
          malicious,
        );

        await expect(
          readEpisodeRuntimeIdentity(
            fixture.releaseRoot,
            fixture.mediaRoot,
          ),
        ).rejects.toThrow();
      },
    );
  },
);
