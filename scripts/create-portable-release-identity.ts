import { execFile } from "node:child_process";
import { open, lstat, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { rawSha256 } from "../src/execution/boundEpisodeProduction.types.js";
import {
  BUSYBOOKIE_RELEASE_IDENTITY_FILE,
} from "../src/execution/portableReleaseRuntimeIdentity.js";
import {
  readBoundFile,
  requireLinkSafeContainedPath,
} from "../src/execution/episodeInputBinding.js";

const RELEASE_IDENTITY_KIND =
  "BUSYBOOKIE_PORTABLE_RELEASE_IDENTITY";

const RELEASE_IDENTITY_SCHEMA_VERSION =
  "1.0";

const MAX_RUNTIME_FILE_BYTES =
  64 * 1024 * 1024;

const MAX_MANIFEST_BYTES =
  8 * 1024 * 1024;

const SOURCE_UNTRACKED_GUARD_PATHS =
  Object.freeze([
    "src",
    "scripts",
    "tests",
    "apps/operator-console",
    "config",
    "episodes",
    "deployment",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.build.json",
  ]);

type ReleaseIdentityEntry =
  Readonly<{
    relativePath: string;
    bytes: number;
    sha256: string;
  }>;

export type PortableReleaseIdentityResult =
  Readonly<{
    manifestPath: string;
    reviewedRevision: string;
    fileCount: number;
    manifestBytes: number;
    manifestSha256: string;
  }>;

function fail(message: string): Error {
  return new Error(message);
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeRoot(path: string): string {
  return resolve(path);
}

function requireDistinctRoots(
  sourceRoot: string,
  releaseRoot: string,
): void {
  if (sourceRoot === releaseRoot) {
    throw fail("Source root and release root must be different.");
  }
}

async function git(
  sourceRoot: string,
  args: readonly string[],
): Promise<string> {
  return (
    await promisify(execFile)(
      "git",
      [...args],
      {
        cwd: sourceRoot,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
    )
  ).stdout;
}

async function readReviewedRevision(
  sourceRoot: string,
): Promise<string> {
  const topLevel =
    normalizeRoot(
      (
        await git(
          sourceRoot,
          ["rev-parse", "--show-toplevel"],
        )
      ).trim(),
    );

  if (topLevel !== sourceRoot) {
    throw fail(
      "Source root must be the Git repository top level.",
    );
  }

  const revision =
    (
      await git(
        sourceRoot,
        ["rev-parse", "--verify", "HEAD"],
      )
    ).trim();

  if (!/^[a-f0-9]{40}$/u.test(revision)) {
    throw fail("Git HEAD is not a canonical 40-character revision.");
  }

  return revision;
}

async function requireCleanSourceCheckout(
  sourceRoot: string,
): Promise<void> {
  const tracked =
    await git(
      sourceRoot,
      [
        "status",
        "--porcelain=v1",
        "--untracked-files=no",
      ],
    );

  if (tracked.trim()) {
    throw fail(
      "Tracked or staged source changes are present.",
    );
  }

  const untracked =
    await git(
      sourceRoot,
      [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ...SOURCE_UNTRACKED_GUARD_PATHS,
      ],
    );

  if (
    untracked
      .split("\0")
      .filter(Boolean)
      .length >
    0
  ) {
    throw fail(
      "Untracked release-authority source files are present.",
    );
  }
}

async function requireNoReleaseGitMetadata(
  releaseRoot: string,
): Promise<void> {
  const metadata =
    resolve(
      releaseRoot,
      ".git",
    );

  try {
    await lstat(metadata);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }

    throw error;
  }

  throw fail(
    "Portable release root must not contain Git metadata.",
  );
}

async function listRuntimeJavaScript(
  root: string,
): Promise<readonly string[]> {
  const distRoot =
    resolve(
      root,
      "dist",
    );

  await requireLinkSafeContainedPath(
    root,
    distRoot,
  );

  const result: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries =
      await readdir(
        directory,
        {
          withFileTypes: true,
          encoding: "utf8",
        },
      );

    entries.sort(
      (left, right) =>
        comparePaths(
          left.name,
          right.name,
        ),
    );

    for (const entry of entries) {
      const candidate =
        resolve(
          directory,
          entry.name,
        );

      await requireLinkSafeContainedPath(
        root,
        candidate,
      );

      const metadata =
        await lstat(candidate);

      if (metadata.isSymbolicLink()) {
        throw fail(
          `Symlink found in runtime dist: ${candidate}`,
        );
      }

      if (metadata.isDirectory()) {
        await visit(candidate);
        continue;
      }

      if (!metadata.isFile()) {
        throw fail(
          `Non-regular entry found in runtime dist: ${candidate}`,
        );
      }

      const relativePath =
        relative(root, candidate)
          .split(sep)
          .join("/");

      if (relativePath.endsWith(".js")) {
        result.push(relativePath);
        continue;
      }

      if (
        relativePath.endsWith(".js.map") ||
        relativePath.endsWith(".d.ts")
      ) {
        continue;
      }

      throw fail(
        `Unsupported runtime dist file class: ${relativePath}`,
      );
    }
  }

  await visit(distRoot);

  if (result.length === 0) {
    throw fail(
      "Portable release contains no compiled JavaScript.",
    );
  }

  return Object.freeze(
    result.sort(comparePaths),
  );
}

function sameInventory(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (value, index) =>
        value === right[index],
    )
  );
}

async function readRuntimeEntry(
  sourceRoot: string,
  releaseRoot: string,
  relativePath: string,
): Promise<ReleaseIdentityEntry> {
  const source =
    await readBoundFile({
      root: sourceRoot,
      canonicalPath:
        resolve(
          sourceRoot,
          ...relativePath.split("/"),
        ),
      role:
        `SOURCE_RUNTIME:${relativePath}`,
      maxBytes:
        MAX_RUNTIME_FILE_BYTES,
    });

  const release =
    await readBoundFile({
      root: releaseRoot,
      canonicalPath:
        resolve(
          releaseRoot,
          ...relativePath.split("/"),
        ),
      role:
        `RELEASE_RUNTIME:${relativePath}`,
      maxBytes:
        MAX_RUNTIME_FILE_BYTES,
    });

  if (
    !source.binding.exists ||
    !release.binding.exists ||
    source.binding.rawSha256 === null ||
    release.binding.rawSha256 === null ||
    source.binding.bytes !==
      release.binding.bytes ||
    source.binding.rawSha256 !==
      release.binding.rawSha256
  ) {
    throw fail(
      `Release runtime file does not match the reviewed build: ${relativePath}`,
    );
  }

  return Object.freeze({
    relativePath,
    bytes:
      release.binding.bytes,
    sha256:
      release.binding.rawSha256,
  });
}

export async function createPortableReleaseIdentity(
  input: Readonly<{
    sourceRoot: string;
    releaseRoot: string;
  }>,
): Promise<PortableReleaseIdentityResult> {
  const sourceRoot =
    normalizeRoot(input.sourceRoot);

  const releaseRoot =
    normalizeRoot(input.releaseRoot);

  if (
    !isAbsolute(sourceRoot) ||
    !isAbsolute(releaseRoot)
  ) {
    throw fail("Release identity roots must be absolute.");
  }

  requireDistinctRoots(
    sourceRoot,
    releaseRoot,
  );

  await requireLinkSafeContainedPath(
    sourceRoot,
    sourceRoot,
  );

  await requireLinkSafeContainedPath(
    releaseRoot,
    releaseRoot,
  );

  await requireNoReleaseGitMetadata(
    releaseRoot,
  );

  const reviewedRevision =
    await readReviewedRevision(
      sourceRoot,
    );

  await requireCleanSourceCheckout(
    sourceRoot,
  );

  const sourceInventory =
    [
      ...await listRuntimeJavaScript(
        sourceRoot,
      ),
      "package-lock.json",
      "package.json",
    ].sort(comparePaths);

  const releaseInventory =
    [
      ...await listRuntimeJavaScript(
        releaseRoot,
      ),
      "package-lock.json",
      "package.json",
    ].sort(comparePaths);

  if (
    !sameInventory(
      sourceInventory,
      releaseInventory,
    )
  ) {
    throw fail(
      "Portable release runtime inventory does not match the reviewed build.",
    );
  }

  const files: ReleaseIdentityEntry[] = [];

  for (const relativePath of sourceInventory) {
    files.push(
      await readRuntimeEntry(
        sourceRoot,
        releaseRoot,
        relativePath,
      ),
    );
  }

  const manifest =
    Object.freeze({
      schemaVersion:
        RELEASE_IDENTITY_SCHEMA_VERSION,
      kind:
        RELEASE_IDENTITY_KIND,
      reviewedRevision,
      files:
        Object.freeze(files),
    });

  const manifestBytes =
    Buffer.from(
      JSON.stringify(
        manifest,
        null,
        2,
      ) +
        "\n",
      "utf8",
    );

  if (
    manifestBytes.byteLength >
    MAX_MANIFEST_BYTES
  ) {
    throw fail(
      "Portable release identity manifest exceeds its size limit.",
    );
  }

  const manifestPath =
    resolve(
      releaseRoot,
      BUSYBOOKIE_RELEASE_IDENTITY_FILE,
    );

  await requireLinkSafeContainedPath(
    releaseRoot,
    manifestPath,
    true,
  );

  const handle =
    await open(
      manifestPath,
      "wx",
    );

  try {
    await handle.writeFile(
      manifestBytes,
    );

    await handle.sync();

    const metadata =
      await handle.stat();

    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      metadata.size !==
        manifestBytes.byteLength
    ) {
      throw fail(
        "Portable release identity manifest write verification failed.",
      );
    }
  } finally {
    await handle.close();
  }

  const verified =
    await readBoundFile({
      root: releaseRoot,
      canonicalPath:
        manifestPath,
      role:
        "RUNTIME_RELEASE_MANIFEST",
      maxBytes:
        MAX_MANIFEST_BYTES,
    });

  if (
    verified.bytes === null ||
    verified.binding.rawSha256 ===
      null ||
    verified.binding.bytes !==
      manifestBytes.byteLength ||
    verified.binding.rawSha256 !==
      rawSha256(manifestBytes)
  ) {
    throw fail(
      "Portable release identity manifest post-write verification failed.",
    );
  }

  return Object.freeze({
    manifestPath,
    reviewedRevision,
    fileCount:
      files.length,
    manifestBytes:
      manifestBytes.byteLength,
    manifestSha256:
      verified.binding.rawSha256,
  });
}

function parseCliArgs(
  args: readonly string[],
): Readonly<{
  sourceRoot: string;
  releaseRoot: string;
}> {
  let sourceRoot =
    process.cwd();

  let releaseRoot:
    string | null =
      null;

  for (
    let index = 0;
    index < args.length;
    index += 1
  ) {
    const arg =
      args[index];

    if (arg === "--source-root") {
      const value =
        args[index + 1];

      if (
        !value ||
        sourceRoot !==
          process.cwd()
      ) {
        throw fail(
          "Invalid or duplicate --source-root.",
        );
      }

      sourceRoot =
        resolve(value);

      index += 1;
      continue;
    }

    if (arg === "--release-root") {
      const value =
        args[index + 1];

      if (
        !value ||
        releaseRoot !==
          null
      ) {
        throw fail(
          "Invalid or duplicate --release-root.",
        );
      }

      releaseRoot =
        resolve(value);

      index += 1;
      continue;
    }

    throw fail(
      `Unknown release identity argument: ${String(arg)}`,
    );
  }

  if (releaseRoot === null) {
    throw fail(
      "--release-root is required.",
    );
  }

  return Object.freeze({
    sourceRoot:
      resolve(sourceRoot),
    releaseRoot,
  });
}

export async function runCreatePortableReleaseIdentityCli(
  args: readonly string[] =
    process.argv.slice(2),
): Promise<void> {
  const parsed =
    parseCliArgs(args);

  const result =
    await createPortableReleaseIdentity(
      parsed,
    );

  process.stdout.write(
    JSON.stringify(
      result,
      null,
      2,
    ) +
      "\n",
  );
}

const executedPath =
  process.argv[1]
    ? resolve(process.argv[1])
    : null;

if (
  executedPath !== null &&
  fileURLToPath(import.meta.url) ===
    executedPath
) {
  runCreatePortableReleaseIdentityCli()
    .catch(
      error => {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown release identity failure.";

        process.stderr.write(
          `Portable release identity generation failed: ${message}\n`,
        );

        process.exitCode =
          1;
      },
    );
}
