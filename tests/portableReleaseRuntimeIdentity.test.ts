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
  readBoundFile,
  readEpisodeRuntimeIdentity,
  requireLinkSafeContainedPath,
} from "../src/execution/episodeInputBinding.js";
import {
  PortableReleaseIdentityError,
  requirePortableReleaseIdentity,
} from "../src/execution/portableReleaseRuntimeIdentity.js";

const REVIEWED_REVISION =
  "a15cb68ead89c969742a016d27daf235bf584a8b";

const CONSOLE_INDEX =
  "apps/operator-console/dist/index.html";

const CONSOLE_SCRIPT =
  "apps/operator-console/dist/assets/index-Abc123.js";

const CONSOLE_STYLE =
  "apps/operator-console/dist/assets/index-Def456.css";

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

      await writeReleaseFile(
        releaseRoot,
        CONSOLE_INDEX,
        "<!doctype html><script type=\"module\" src=\"/assets/index-Abc123.js\"></script>\n",
      ),

      await writeReleaseFile(
        releaseRoot,
        CONSOLE_SCRIPT,
        "console.log(\"reviewed console\");\n",
      ),

      await writeReleaseFile(
        releaseRoot,
        CONSOLE_STYLE,
        "body{margin:0}\n",
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

  schemaVersion =
    "2.0",
): Promise<void> {
  const manifest =
    Object.freeze({
      schemaVersion,

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
          `RUNTIME:${CONSOLE_SCRIPT}`,
          `RUNTIME:${CONSOLE_STYLE}`,
          `RUNTIME:${CONSOLE_INDEX}`,
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

describe("portable release identity schema 2.0: operator-console build", () => {
  const at = (root: string, relativePath: string) =>
    join(root, ...relativePath.split("/"));

  const read = (fixture: PortableFixture) =>
    readEpisodeRuntimeIdentity(fixture.releaseRoot, fixture.mediaRoot);

  const dependencies = Object.freeze({ readBoundFile, requireLinkSafeContainedPath });

  it("binds every operator-console file by exact byte length and SHA-256", async () => {
    const fixture = await createPortableFixture();
    await writeManifest(fixture);

    const identity = await read(fixture);

    for (const relativePath of [CONSOLE_INDEX, CONSOLE_SCRIPT, CONSOLE_STYLE]) {
      const entry = fixture.files.find((file) => file.relativePath === relativePath)!;
      const binding = identity.executableInputs.find((input) => input.role === `RUNTIME:${relativePath}`);

      expect(binding).toMatchObject({ exists: true, bytes: entry.bytes, rawSha256: entry.sha256 });
    }
  });

  it.each([
    ["changed operator-console script", CONSOLE_SCRIPT, "console.log(\"tampered console\");\n"],
    ["changed operator-console index.html", CONSOLE_INDEX, "<!doctype html><script type=\"module\" src=\"/assets/rogue.js\"></script>\n"],
    ["changed operator-console stylesheet", CONSOLE_STYLE, "body{margin:1px}\n"],
    ["changed root runtime JavaScript", "dist/execution/episodeInputBinding.js", "export const tampered = true;\n"],
  ])("fails closed on a %s", async (_label, relativePath, content) => {
    const fixture = await createPortableFixture();
    await writeManifest(fixture);
    await writeFile(at(fixture.releaseRoot, relativePath), content);

    await expect(read(fixture)).rejects.toMatchObject({ name: "BoundEpisodeError" });
  });

  it.each([CONSOLE_SCRIPT, CONSOLE_STYLE, CONSOLE_INDEX])("fails closed when %s is missing", async (relativePath) => {
    const fixture = await createPortableFixture();
    await writeManifest(fixture);
    await rm(at(fixture.releaseRoot, relativePath));

    await expect(read(fixture)).rejects.toMatchObject({ name: "BoundEpisodeError" });
  });

  it.each([
    "apps/operator-console/dist/assets/extra-Zz9.js",
    "apps/operator-console/dist/assets/extra-Zz9.css",
    "apps/operator-console/dist/assets/index-Abc123.js.map",
    "apps/operator-console/dist/favicon.svg",
    "apps/operator-console/dist/assets/nested/inner-Q1.js",
  ])("fails closed on an unmanifested operator-console entry: %s", async (relativePath) => {
    const fixture = await createPortableFixture();
    await writeManifest(fixture);
    await mkdir(dirname(at(fixture.releaseRoot, relativePath)), { recursive: true });
    await writeFile(at(fixture.releaseRoot, relativePath), "x\n", { flag: "wx" });

    await expect(read(fixture)).rejects.toMatchObject({ name: "BoundEpisodeError" });
  });

  it("fails closed when the operator-console build is absent from the manifest", async () => {
    const fixture = await createPortableFixture();
    const rootOnly = fixture.files.filter((file) => !file.relativePath.startsWith("apps/"));

    await writeManifest(fixture, rootOnly);

    await expect(read(fixture)).rejects.toMatchObject({ name: "BoundEpisodeError" });
  });

  it("fails closed when the operator-console build is absent from the release", async () => {
    const fixture = await createPortableFixture();
    await writeManifest(fixture);
    await rm(at(fixture.releaseRoot, "apps"), { recursive: true, force: true });

    await expect(read(fixture)).rejects.toMatchObject({ name: "BoundEpisodeError" });
  });

  it.each([
    ["the complete v2 file set", (files: readonly ReleaseFileEntry[]) => files],
    ["a v1-shaped root-only file set", (files: readonly ReleaseFileEntry[]) => files.filter((file) => !file.relativePath.startsWith("apps/"))],
  ])("rejects schema 1.0 with %s", async (_label, select) => {
    const fixture = await createPortableFixture();

    if (select(fixture.files).length !== fixture.files.length) {
      await rm(at(fixture.releaseRoot, "apps"), { recursive: true, force: true });
    }

    await writeManifest(fixture, select(fixture.files), "1.0");

    await expect(read(fixture)).rejects.toMatchObject({ name: "BoundEpisodeError" });
    await expect(requirePortableReleaseIdentity(fixture.releaseRoot, dependencies)).rejects.toMatchObject({
      failure: "RELEASE_IDENTITY_INVALID",
    });
  });

  it.each([
    "apps/other-app/dist/index.html",
    "apps/operator-console/src/main.js",
    "apps/operator-console/dist/other.html",
    "apps/operator-console/dist/assets/nested/inner-Q1.js",
    "apps/operator-console/dist/assets/index-Abc123.js.map",
    "apps/operator-console/dist/assets/index.min.js",
    "apps/operator-console/dist/assets/index-Abc123.mjs",
    "apps/operator-console/dist/assets/../index.html",
    "apps/operator-console/dist/./index.html",
    "apps/operator-console//dist/index.html",
    "apps\\operator-console\\dist\\index.html",
    "/apps/operator-console/dist/index.html",
    "../apps/operator-console/dist/index.html",
  ])("rejects the manifest path %s", async (relativePath) => {
    const fixture = await createPortableFixture();
    const files = sortEntries([
      ...fixture.files,
      Object.freeze({ relativePath, bytes: 2, sha256: "a".repeat(64) }),
    ]);

    await writeManifest(fixture, files);

    await expect(read(fixture)).rejects.toMatchObject({ name: "BoundEpisodeError" });
  });
});

describe("required portable release identity (production operator startup)", () => {
  const dependencies = Object.freeze({ readBoundFile, requireLinkSafeContainedPath });

  it("verifies the complete v2 inventory without a media root", async () => {
    const fixture = await createPortableFixture();
    await writeManifest(fixture);

    const verified = await requirePortableReleaseIdentity(fixture.releaseRoot, dependencies);

    expect(verified.reviewedRevision).toBe(REVIEWED_REVISION);
    expect(verified.root).toBe(fixture.releaseRoot);
    expect(verified.manifest.role).toBe("RUNTIME_RELEASE_MANIFEST");
    expect(verified.files.map((file) => file.role)).toEqual(
      fixture.files.map((file) => `RUNTIME:${file.relativePath}`),
    );
  });

  it("refuses a release without an identity manifest instead of falling back to Git", async () => {
    const fixture = await createPortableFixture();

    const failure = await requirePortableReleaseIdentity(fixture.releaseRoot, dependencies).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PortableReleaseIdentityError);
    expect(failure).toMatchObject({ failure: "RELEASE_IDENTITY_MISSING" });
  });

  it("reports a tampered release with one fixed message and no cause, path or hash", async () => {
    const fixture = await createPortableFixture();
    await writeManifest(fixture);
    await writeFile(join(fixture.releaseRoot, ...CONSOLE_SCRIPT.split("/")), "console.log(\"tampered console\");\n");

    const failure = await requirePortableReleaseIdentity(fixture.releaseRoot, dependencies).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PortableReleaseIdentityError);
    expect(failure).toMatchObject({ failure: "RELEASE_IDENTITY_INVALID" });
    expect((failure as Error).message).toBe("Portable release identity verification failed (RELEASE_IDENTITY_INVALID).");
    expect((failure as Error).cause).toBeUndefined();
  });
});
