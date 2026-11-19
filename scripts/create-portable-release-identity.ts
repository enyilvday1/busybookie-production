import { execFile } from "node:child_process";
import { open, lstat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { rawSha256 } from "../src/execution/boundEpisodeProduction.types.js";
import {
  BUSYBOOKIE_RELEASE_IDENTITY_FILE,
  PORTABLE_RELEASE_IDENTITY_KIND,
  PORTABLE_RELEASE_IDENTITY_SCHEMA_VERSION,
  listPortableReleaseInventory,
} from "../src/execution/portableReleaseRuntimeIdentity.js";
import {
  readBoundFile,
  requireLinkSafeContainedPath,
} from "../src/execution/episodeInputBinding.js";

const RELEASE_IDENTITY_KIND =
  PORTABLE_RELEASE_IDENTITY_KIND;

const RELEASE_IDENTITY_SCHEMA_VERSION =
  PORTABLE_RELEASE_IDENTITY_SCHEMA_VERSION;

const OPERATOR_CONSOLE_INDEX_PATH =
  "apps/operator-console/dist/index.html";

const OPERATOR_CONSOLE_ASSETS_PREFIX =
  "apps/operator-console/dist/assets/";

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

const GIT_BLOB_AUTHORITY_RUNTIME_PATHS =
  Object.freeze(
    new Set([
      "package-lock.json",
      "package.json",
    ]),
  );

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

async function readReviewedGitBlob(
  sourceRoot: string,
  reviewedRevision: string,
  relativePath: string,
): Promise<Buffer> {
  try {
    const result =
      await promisify(execFile)(
        "git",
        [
          "cat-file",
          "blob",
          `${reviewedRevision}:${relativePath}`,
        ],
        {
          cwd: sourceRoot,
          windowsHide: true,
          maxBuffer: MAX_RUNTIME_FILE_BYTES,
          encoding: null,
        },
      );

    return result.stdout;
  } catch {
    throw fail(
      `Unable to read reviewed Git runtime blob: ${relativePath}`,
    );
  }
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

/*
 * The complete schema 2.0 inventory (root dist JavaScript, the
 * operator-console build, package.json and package-lock.json), using the
 * same inventory authority that runtime verification applies. Symlinks,
 * non-regular entries, unexpected file classes, a missing index.html or a
 * console build without a script all fail closed here.
 */
async function listReleaseInventory(
  root: string,
  label: "source" | "release",
): Promise<readonly string[]> {
  try {
    return await listPortableReleaseInventory(
      root,
      requireLinkSafeContainedPath,
    );
  } catch (cause) {
    throw new Error(
      `Portable ${label} build is missing or has an invalid runtime or operator-console inventory.`,
      { cause },
    );
  }
}

/*
 * Every /assets/ reference in the bound operator-console index.html must
 * name a bound asset. Bytes are already proven equal to the reviewed build;
 * this refuses a reviewed build whose own references are incomplete.
 */
function requireReferencedConsoleAssets(
  indexBytes: Buffer,
  inventory: readonly string[],
): void {
  const html =
    indexBytes.toString("utf8");

  const bound =
    new Set(inventory);

  let scripts =
    0;

  for (
    const match
    of html.matchAll(
      /\b(?:src|href)\s*=\s*"\/assets\/([^"]*)"/giu,
    )
  ) {
    const name =
      match[1] ?? "";

    if (
      !bound.has(
        `${OPERATOR_CONSOLE_ASSETS_PREFIX}${name}`,
      )
    ) {
      throw fail(
        "Operator-console index.html references an asset that is not in the release inventory.",
      );
    }

    if (name.endsWith(".js")) {
      scripts += 1;
    }
  }

  if (scripts === 0) {
    throw fail(
      "Operator-console index.html references no bound script asset.",
    );
  }
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
  reviewedRevision: string,
  releaseRoot: string,
  relativePath: string,
): Promise<Readonly<{
  entry: ReleaseIdentityEntry;
  bytes: Buffer;
}>> {
  let sourceBytes: Buffer;
  let sourceSha256: string;

  if (
    GIT_BLOB_AUTHORITY_RUNTIME_PATHS.has(
      relativePath,
    )
  ) {
    sourceBytes =
      await readReviewedGitBlob(
        sourceRoot,
        reviewedRevision,
        relativePath,
      );

    sourceSha256 =
      rawSha256(sourceBytes);
  } else {
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

    if (
      !source.binding.exists ||
      source.bytes === null ||
      source.binding.rawSha256 === null
    ) {
      throw fail(
        `Reviewed runtime file is unavailable: ${relativePath}`,
      );
    }

    sourceBytes =
      source.bytes;

    sourceSha256 =
      source.binding.rawSha256;
  }

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
    !release.binding.exists ||
    release.bytes === null ||
    release.binding.rawSha256 === null ||
    sourceBytes.byteLength !==
      release.binding.bytes ||
    sourceSha256 !==
      release.binding.rawSha256
  ) {
    throw fail(
      `Release runtime file does not match the reviewed build: ${relativePath}`,
    );
  }

  return Object.freeze({
    entry:
      Object.freeze({
        relativePath,
        bytes:
          release.binding.bytes,
        sha256:
          release.binding.rawSha256,
      }),
    bytes:
      release.bytes,
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
    await listReleaseInventory(
      sourceRoot,
      "source",
    );

  const releaseInventory =
    await listReleaseInventory(
      releaseRoot,
      "release",
    );

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

  let consoleIndexBytes:
    Buffer | null =
      null;

  for (const relativePath of sourceInventory) {
    const observed =
      await readRuntimeEntry(
        sourceRoot,
        reviewedRevision,
        releaseRoot,
        relativePath,
      );

    files.push(
      observed.entry,
    );

    if (
      relativePath ===
      OPERATOR_CONSOLE_INDEX_PATH
    ) {
      consoleIndexBytes =
        observed.bytes;
    }
  }

  if (consoleIndexBytes === null) {
    throw fail(
      "Portable release inventory has no operator-console index.html.",
    );
  }

  requireReferencedConsoleAssets(
    consoleIndexBytes,
    sourceInventory,
  );

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
