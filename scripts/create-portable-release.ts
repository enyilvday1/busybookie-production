import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { platform } from "node:os";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  createPortableReleasePackage,
  type PortableReleasePackageResult,
} from "./create-portable-release-package.js";
import {
  requireLinkSafeContainedPath,
} from "../src/execution/episodeInputBinding.js";

const MAX_CHILD_OUTPUT_BYTES =
  32 * 1024 * 1024;

const MAX_GIT_BLOB_BYTES =
  64 * 1024 * 1024;

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

const BUILD_OUTPUT_ROOTS =
  Object.freeze([
    "dist",
    "apps/operator-console/dist",
  ]);

const PACKAGE_AUTHORITY_PATHS =
  Object.freeze([
    "package-lock.json",
    "package.json",
  ]);

type SourceAuthority =
  Readonly<{
    sourceRoot: string;
    reviewedRevision: string;
  }>;

type BuildSnapshotEntry =
  Readonly<{
    relativePath: string;
    bytes: Buffer;
    byteLength: number;
    sha256: string;
  }>;

export type PortableReleaseCreateResult =
  Readonly<{
    reviewedRevision: string;

    assembledFileCount: number;
    trackedFileCount: number;
    buildFileCount: number;

    releaseFileCount: number;

    identityFileCount: number;
    identityManifestBytes: number;
    identityManifestSha256: string;

    treeManifestPath: string;
    treeManifestBytes: number;
    treeManifestSha256: string;

    archivePath: string;
    archiveBytes: number;
    archiveSha256: string;

    tarVersion: string;
    gzipVersion: string;
  }>;

function fail(
  message: string,
): Error {
  return new Error(message);
}

function rawSha256(
  bytes: Buffer,
): string {
  return createHash("sha256")
    .update(bytes)
    .digest("hex");
}

function comparePortablePaths(
  left: string,
  right: string,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length ===
      right.length &&
    left.every(
      (value, index) =>
        value ===
        right[index],
    )
  );
}

function isContainedPath(
  root: string,
  candidate: string,
): boolean {
  const child =
    relative(
      root,
      candidate,
    );

  return (
    child === "" ||
    (
      child !== ".." &&
      !child.startsWith(
        `..${sep}`,
      ) &&
      !isAbsolute(child)
    )
  );
}

function parseReleaseRelativePath(
  value: string,
): string {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(
      value,
    )
  ) {
    throw fail(
      "Portable release assembly contains an unsafe relative path.",
    );
  }

  const parts =
    value.split("/");

  if (
    parts.some(
      part =>
        part.length === 0 ||
        part === "." ||
        part === "..",
    )
  ) {
    throw fail(
      "Portable release assembly contains an unsafe relative path.",
    );
  }

  return value;
}

async function exists(
  path: string,
): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }

    throw error;
  }
}

async function requireRealDirectory(
  path: string,
  label: string,
): Promise<void> {
  const metadata =
    await lstat(path);

  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory()
  ) {
    throw fail(
      `${label} must be a real directory.`,
    );
  }
}

async function execText(
  program: string,
  args: readonly string[],
  cwd: string,
): Promise<string> {
  const result =
    await promisify(execFile)(
      program,
      [...args],
      {
        cwd,
        windowsHide: true,
        maxBuffer:
          MAX_CHILD_OUTPUT_BYTES,
        encoding: "utf8",
      },
    );

  return result.stdout;
}

async function execBytes(
  program: string,
  args: readonly string[],
  cwd: string,
  maxBuffer: number,
): Promise<Buffer> {
  const result =
    await promisify(execFile)(
      program,
      [...args],
      {
        cwd,
        windowsHide: true,
        maxBuffer,
        encoding: null,
      },
    );

  return result.stdout;
}

async function runControlledBuild(
  sourceRoot: string,
): Promise<void> {
  const currentPlatform =
    platform();

  const program =
    currentPlatform === "win32"
      ? process.env.ComSpec ||
        "C:\\Windows\\System32\\cmd.exe"
      : "npm";

  const args =
    currentPlatform === "win32"
      ? [
          "/d",
          "/s",
          "/c",
          "npm run build",
        ]
      : [
          "run",
          "build",
        ];

  try {
    await promisify(execFile)(
      program,
      args,
      {
        cwd: sourceRoot,
        windowsHide: true,
        maxBuffer:
          MAX_CHILD_OUTPUT_BYTES,
        encoding: "utf8",
      },
    );
  } catch {
    throw fail(
      "Controlled portable release build failed.",
    );
  }
}

async function readSourceAuthority(
  sourceRootInput: string,
): Promise<SourceAuthority> {
  const sourceRoot =
    resolve(
      sourceRootInput,
    );

  if (!isAbsolute(sourceRoot)) {
    throw fail(
      "Portable release source root must be absolute.",
    );
  }

  await requireRealDirectory(
    sourceRoot,
    "Source root",
  );

  await requireLinkSafeContainedPath(
    sourceRoot,
    sourceRoot,
  );

  const topLevel =
    resolve(
      (
        await execText(
          "git",
          [
            "rev-parse",
            "--show-toplevel",
          ],
          sourceRoot,
        )
      ).trim(),
    );

  if (
    topLevel !==
      sourceRoot
  ) {
    throw fail(
      "Source root must be the Git repository top level.",
    );
  }

  const reviewedRevision =
    (
      await execText(
        "git",
        [
          "rev-parse",
          "--verify",
          "HEAD",
        ],
        sourceRoot,
      )
    ).trim();

  if (
    !/^[a-f0-9]{40}$/u.test(
      reviewedRevision,
    )
  ) {
    throw fail(
      "Git HEAD is not a canonical 40-character revision.",
    );
  }

  const trackedStatus =
    await execText(
      "git",
      [
        "status",
        "--porcelain=v1",
        "--untracked-files=no",
      ],
      sourceRoot,
    );

  if (
    trackedStatus.trim()
  ) {
    throw fail(
      "Tracked or staged source changes are present.",
    );
  }

  const untrackedBytes =
    await execBytes(
      "git",
      [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ...SOURCE_UNTRACKED_GUARD_PATHS,
      ],
      sourceRoot,
      MAX_CHILD_OUTPUT_BYTES,
    );

  if (
    untrackedBytes
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .length >
    0
  ) {
    throw fail(
      "Untracked release-authority source files are present.",
    );
  }

  return Object.freeze({
    sourceRoot,
    reviewedRevision,
  });
}

async function requireSameSourceAuthority(
  expected: SourceAuthority,
): Promise<void> {
  const current =
    await readSourceAuthority(
      expected.sourceRoot,
    );

  if (
    current.reviewedRevision !==
      expected.reviewedRevision
  ) {
    throw fail(
      "Reviewed Git revision changed while creating the portable release.",
    );
  }
}

async function readReviewedGitBlob(
  authority: SourceAuthority,
  relativePath: string,
): Promise<Buffer> {
  try {
    return await execBytes(
      "git",
      [
        "cat-file",
        "blob",
        `${authority.reviewedRevision}:${relativePath}`,
      ],
      authority.sourceRoot,
      MAX_GIT_BLOB_BYTES,
    );
  } catch {
    throw fail(
      `Unable to read reviewed Git release blob: ${relativePath}`,
    );
  }
}

async function listReviewedTreePaths(
  authority: SourceAuthority,
): Promise<readonly string[]> {
  const bytes =
    await execBytes(
      "git",
      [
        "ls-tree",
        "-r",
        "--name-only",
        "-z",
        authority.reviewedRevision,
        "--",
        "config",
        "episodes",
      ],
      authority.sourceRoot,
      MAX_CHILD_OUTPUT_BYTES,
    );

  const all =
    bytes
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map(
        path =>
          parseReleaseRelativePath(
            path,
          ),
      );

  const selected =
    all.filter(
      path =>
        /^config\/[^/]+\.json$/u.test(
          path,
        ) ||
        /^episodes\/[^/]+\/episode\.json$/u.test(
          path,
        ),
    );

  selected.push(
    ...PACKAGE_AUTHORITY_PATHS,
  );

  selected.sort(
    comparePortablePaths,
  );

  const unique =
    [...new Set(selected)];

  if (
    unique.length !==
      selected.length
  ) {
    throw fail(
      "Reviewed Git release path selection contains duplicates.",
    );
  }

  for (
    const required
    of PACKAGE_AUTHORITY_PATHS
  ) {
    try {
      await execText(
        "git",
        [
          "cat-file",
          "-e",
          `${authority.reviewedRevision}:${required}`,
        ],
        authority.sourceRoot,
      );
    } catch {
      throw fail(
        `Reviewed Git release authority is missing: ${required}`,
      );
    }
  }

  return Object.freeze(
    unique,
  );
}

async function writeExclusiveFile(
  path: string,
  bytes: Buffer,
): Promise<void> {
  await mkdir(
    dirname(path),
    {
      recursive: true,
    },
  );

  const handle =
    await open(
      path,
      "wx",
      0o644,
    );

  try {
    await handle.writeFile(
      bytes,
    );

    await handle.sync();

    const metadata =
      await handle.stat();

    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      metadata.size !==
        bytes.byteLength
    ) {
      throw fail(
        "Portable release assembly write verification failed.",
      );
    }
  } finally {
    await handle.close();
  }

  await chmod(
    path,
    0o644,
  );

  const written =
    await readFile(path);

  if (
    written.byteLength !==
      bytes.byteLength ||
    rawSha256(written) !==
      rawSha256(bytes)
  ) {
    throw fail(
      "Portable release assembly bytes changed after writing.",
    );
  }
}

async function assembleReviewedGitFiles(
  authority: SourceAuthority,
  releaseRoot: string,
  relativePaths: readonly string[],
): Promise<void> {
  for (
    const relativePath
    of relativePaths
  ) {
    const bytes =
      await readReviewedGitBlob(
        authority,
        relativePath,
      );

    const destination =
      resolve(
        releaseRoot,
        ...relativePath.split("/"),
      );

    if (
      !isContainedPath(
        releaseRoot,
        destination,
      )
    ) {
      throw fail(
        "Reviewed Git release path escapes the temporary release root.",
      );
    }

    await requireLinkSafeContainedPath(
      releaseRoot,
      destination,
      true,
    );

    await writeExclusiveFile(
      destination,
      bytes,
    );
  }
}

async function listBuildOutputFiles(
  sourceRoot: string,
): Promise<readonly string[]> {
  const relativePaths: string[] = [];

  async function walk(
    absoluteDirectory: string,
    relativeDirectory: string,
  ): Promise<void> {
    await requireLinkSafeContainedPath(
      sourceRoot,
      absoluteDirectory,
    );

    const directoryMetadata =
      await lstat(
        absoluteDirectory,
      );

    if (
      directoryMetadata.isSymbolicLink() ||
      !directoryMetadata.isDirectory()
    ) {
      throw fail(
        `Reviewed build output root is not a real directory: ${relativeDirectory}`,
      );
    }

    const entries =
      await readdir(
        absoluteDirectory,
        {
          withFileTypes: true,
        },
      );

    entries.sort(
      (left, right) =>
        comparePortablePaths(
          left.name,
          right.name,
        ),
    );

    for (
      const entry
      of entries
    ) {
      const relativePath =
        parseReleaseRelativePath(
          `${relativeDirectory}/${entry.name}`,
        );

      const absolutePath =
        resolve(
          sourceRoot,
          ...relativePath.split("/"),
        );

      if (
        !isContainedPath(
          sourceRoot,
          absolutePath,
        )
      ) {
        throw fail(
          "Reviewed build output path escapes the source root.",
        );
      }

      await requireLinkSafeContainedPath(
        sourceRoot,
        absolutePath,
      );

      const metadata =
        await lstat(
          absolutePath,
        );

      if (
        metadata.isSymbolicLink()
      ) {
        throw fail(
          `Reviewed build output contains a symbolic link: ${relativePath}`,
        );
      }

      if (
        metadata.isDirectory()
      ) {
        await walk(
          absolutePath,
          relativePath,
        );

        continue;
      }

      if (
        !metadata.isFile()
      ) {
        throw fail(
          `Reviewed build output contains a non-regular entry: ${relativePath}`,
        );
      }

      if (
        metadata.nlink !== 1
      ) {
        throw fail(
          `Reviewed build output contains a multiply-linked file: ${relativePath}`,
        );
      }

      relativePaths.push(
        relativePath,
      );
    }
  }

  for (
    const buildRoot
    of BUILD_OUTPUT_ROOTS
  ) {
    const absoluteRoot =
      resolve(
        sourceRoot,
        ...buildRoot.split("/"),
      );

    await walk(
      absoluteRoot,
      buildRoot,
    );
  }

  relativePaths.sort(
    comparePortablePaths,
  );

  const unique =
    [...new Set(relativePaths)];

  if (
    unique.length !==
      relativePaths.length
  ) {
    throw fail(
      "Reviewed build output inventory contains duplicate paths.",
    );
  }

  if (
    unique.length === 0
  ) {
    throw fail(
      "Reviewed build output inventory is empty.",
    );
  }

  return Object.freeze(
    unique,
  );
}

async function readStableBuildFile(
  sourceRoot: string,
  relativePath: string,
): Promise<BuildSnapshotEntry> {
  const absolutePath =
    resolve(
      sourceRoot,
      ...relativePath.split("/"),
    );

  if (
    !isContainedPath(
      sourceRoot,
      absolutePath,
    )
  ) {
    throw fail(
      "Reviewed build output path escapes the source root.",
    );
  }

  await requireLinkSafeContainedPath(
    sourceRoot,
    absolutePath,
  );

  const before =
    await lstat(
      absolutePath,
    );

  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !== 1
  ) {
    throw fail(
      `Reviewed build output changed type while being read: ${relativePath}`,
    );
  }

  const bytes =
    await readFile(
      absolutePath,
    );

  const after =
    await lstat(
      absolutePath,
    );

  if (
    after.isSymbolicLink() ||
    !after.isFile() ||
    after.nlink !== 1 ||
    before.size !==
      after.size ||
    after.size !==
      bytes.byteLength ||
    before.mtimeMs !==
      after.mtimeMs ||
    before.ctimeMs !==
      after.ctimeMs
  ) {
    throw fail(
      `Reviewed build output changed while being read: ${relativePath}`,
    );
  }

  return Object.freeze({
    relativePath,
    bytes,
    byteLength:
      bytes.byteLength,
    sha256:
      rawSha256(bytes),
  });
}

async function captureBuildSnapshot(
  sourceRoot: string,
): Promise<readonly BuildSnapshotEntry[]> {
  const relativePaths =
    await listBuildOutputFiles(
      sourceRoot,
    );

  const entries:
    BuildSnapshotEntry[] =
      [];

  for (
    const relativePath
    of relativePaths
  ) {
    entries.push(
      await readStableBuildFile(
        sourceRoot,
        relativePath,
      ),
    );
  }

  return Object.freeze(
    entries,
  );
}

async function requireBuildSnapshotUnchanged(
  sourceRoot: string,
  expected: readonly BuildSnapshotEntry[],
): Promise<void> {
  const currentPaths =
    await listBuildOutputFiles(
      sourceRoot,
    );

  const expectedPaths =
    expected.map(
      entry =>
        entry.relativePath,
    );

  if (
    !sameStringArray(
      expectedPaths,
      currentPaths,
    )
  ) {
    throw fail(
      "Reviewed build output inventory changed while creating the portable release.",
    );
  }

  for (
    const expectedEntry
    of expected
  ) {
    const currentEntry =
      await readStableBuildFile(
        sourceRoot,
        expectedEntry.relativePath,
      );

    if (
      currentEntry.byteLength !==
        expectedEntry.byteLength ||
      currentEntry.sha256 !==
        expectedEntry.sha256
    ) {
      throw fail(
        `Reviewed build output bytes changed while creating the portable release: ${expectedEntry.relativePath}`,
      );
    }
  }
}

async function assembleBuildSnapshot(
  releaseRoot: string,
  snapshot: readonly BuildSnapshotEntry[],
): Promise<void> {
  for (
    const entry
    of snapshot
  ) {
    const destination =
      resolve(
        releaseRoot,
        ...entry.relativePath.split("/"),
      );

    if (
      !isContainedPath(
        releaseRoot,
        destination,
      )
    ) {
      throw fail(
        "Reviewed build output path escapes the temporary release root.",
      );
    }

    await requireLinkSafeContainedPath(
      releaseRoot,
      destination,
      true,
    );

    await writeExclusiveFile(
      destination,
      entry.bytes,
    );
  }
}

async function listAssembledFiles(
  releaseRoot: string,
): Promise<readonly string[]> {
  const files: string[] = [];

  async function walk(
    directory: string,
    prefix: string,
  ): Promise<void> {
    const entries =
      await readdir(
        directory,
        {
          withFileTypes: true,
        },
      );

    entries.sort(
      (left, right) =>
        comparePortablePaths(
          left.name,
          right.name,
        ),
    );

    for (
      const entry
      of entries
    ) {
      const relativePath =
        parseReleaseRelativePath(
          prefix.length === 0
            ? entry.name
            : `${prefix}/${entry.name}`,
        );

      const absolutePath =
        resolve(
          releaseRoot,
          ...relativePath.split("/"),
        );

      if (
        !isContainedPath(
          releaseRoot,
          absolutePath,
        )
      ) {
        throw fail(
          "Temporary portable release path escapes its root.",
        );
      }

      await requireLinkSafeContainedPath(
        releaseRoot,
        absolutePath,
      );

      const metadata =
        await lstat(
          absolutePath,
        );

      if (
        metadata.isSymbolicLink()
      ) {
        throw fail(
          `Temporary portable release contains a symbolic link: ${relativePath}`,
        );
      }

      if (
        metadata.isDirectory()
      ) {
        await walk(
          absolutePath,
          relativePath,
        );

        continue;
      }

      if (
        !metadata.isFile() ||
        metadata.nlink !== 1
      ) {
        throw fail(
          `Temporary portable release contains an invalid file: ${relativePath}`,
        );
      }

      files.push(
        relativePath,
      );
    }
  }

  await walk(
    releaseRoot,
    "",
  );

  files.sort(
    comparePortablePaths,
  );

  return Object.freeze(
    files,
  );
}

function requireExactAssembledInventory(
  trackedPaths: readonly string[],
  buildSnapshot: readonly BuildSnapshotEntry[],
  assembledPaths: readonly string[],
): void {
  const expected =
    [
      ...trackedPaths,
      ...buildSnapshot.map(
        entry =>
          entry.relativePath,
      ),
    ].sort(
      comparePortablePaths,
    );

  if (
    new Set(expected).size !==
      expected.length
  ) {
    throw fail(
      "Portable release assembly authorities overlap.",
    );
  }

  if (
    !sameStringArray(
      expected,
      assembledPaths,
    )
  ) {
    throw fail(
      "Temporary portable release inventory does not match its reviewed authorities.",
    );
  }
}

function toCreateResult(
  packageResult: PortableReleasePackageResult,
  trackedFileCount: number,
  buildFileCount: number,
): PortableReleaseCreateResult {
  return Object.freeze({
    reviewedRevision:
      packageResult.reviewedRevision,

    assembledFileCount:
      trackedFileCount +
      buildFileCount,

    trackedFileCount,
    buildFileCount,

    releaseFileCount:
      packageResult.releaseFileCount,

    identityFileCount:
      packageResult.identityFileCount,
    identityManifestBytes:
      packageResult.identityManifestBytes,
    identityManifestSha256:
      packageResult.identityManifestSha256,

    treeManifestPath:
      packageResult.treeManifestPath,
    treeManifestBytes:
      packageResult.treeManifestBytes,
    treeManifestSha256:
      packageResult.treeManifestSha256,

    archivePath:
      packageResult.archivePath,
    archiveBytes:
      packageResult.archiveBytes,
    archiveSha256:
      packageResult.archiveSha256,

    tarVersion:
      packageResult.tarVersion,
    gzipVersion:
      packageResult.gzipVersion,
  });
}

export async function createPortableRelease(
  input: Readonly<{
    sourceRoot: string;
    outputDirectory: string;
  }>,
): Promise<PortableReleaseCreateResult> {
  const sourceRoot =
    resolve(
      input.sourceRoot,
    );

  const outputDirectory =
    resolve(
      input.outputDirectory,
    );

  if (
    !isAbsolute(sourceRoot) ||
    !isAbsolute(outputDirectory)
  ) {
    throw fail(
      "Portable release creation roots must be absolute.",
    );
  }

  await requireRealDirectory(
    outputDirectory,
    "Output directory",
  );

  await requireLinkSafeContainedPath(
    outputDirectory,
    outputDirectory,
  );

  if (
    isContainedPath(
      sourceRoot,
      outputDirectory,
    )
  ) {
    throw fail(
      "Output directory must not be inside the reviewed source checkout.",
    );
  }

  const authority =
    await readSourceAuthority(
      sourceRoot,
    );

  const trackedPaths =
    await listReviewedTreePaths(
      authority,
    );

  await runControlledBuild(
    sourceRoot,
  );

  await requireSameSourceAuthority(
    authority,
  );

  const buildSnapshot =
    await captureBuildSnapshot(
      sourceRoot,
    );

  const temporaryReleaseRoot =
    resolve(
      outputDirectory,
      `.busybookie-release-${authority.reviewedRevision}.assembling`,
    );

  if (
    await exists(
      temporaryReleaseRoot,
    )
  ) {
    throw fail(
      "Temporary portable release root already exists.",
    );
  }

  let packageResult:
    PortableReleasePackageResult |
    null =
      null;

  let completed =
    false;

  try {
    await mkdir(
      temporaryReleaseRoot,
      {
        recursive: false,
      },
    );

    await requireLinkSafeContainedPath(
      temporaryReleaseRoot,
      temporaryReleaseRoot,
    );

    await assembleReviewedGitFiles(
      authority,
      temporaryReleaseRoot,
      trackedPaths,
    );

    await assembleBuildSnapshot(
      temporaryReleaseRoot,
      buildSnapshot,
    );

    const assembledPaths =
      await listAssembledFiles(
        temporaryReleaseRoot,
      );

    requireExactAssembledInventory(
      trackedPaths,
      buildSnapshot,
      assembledPaths,
    );

    await requireSameSourceAuthority(
      authority,
    );

    await requireBuildSnapshotUnchanged(
      sourceRoot,
      buildSnapshot,
    );

    packageResult =
      await createPortableReleasePackage({
        sourceRoot,
        releaseRoot:
          temporaryReleaseRoot,
        outputDirectory,
      });

    if (
      packageResult.reviewedRevision !==
        authority.reviewedRevision
    ) {
      throw fail(
        "Packaged release revision does not match the reviewed assembly revision.",
      );
    }

    await requireSameSourceAuthority(
      authority,
    );

    await requireBuildSnapshotUnchanged(
      sourceRoot,
      buildSnapshot,
    );

    completed =
      true;

    return toCreateResult(
      packageResult,
      trackedPaths.length,
      buildSnapshot.length,
    );
  } finally {
    if (
      !completed &&
      packageResult !== null
    ) {
      await Promise.allSettled([
        rm(
          packageResult.treeManifestPath,
          {
            force: true,
          },
        ),
        rm(
          packageResult.archivePath,
          {
            force: true,
          },
        ),
      ]);
    }

    await rm(
      temporaryReleaseRoot,
      {
        recursive: true,
        force: true,
      },
    );
  }
}

function parseCliArgs(
  args: readonly string[],
): Readonly<{
  sourceRoot: string;
  outputDirectory: string;
}> {
  let sourceRoot =
    process.cwd();

  let outputDirectory:
    string |
    null =
      null;

  for (
    let index = 0;
    index < args.length;
    index += 1
  ) {
    const arg =
      args[index];

    const value =
      args[index + 1];

    if (
      arg ===
        "--source-root"
    ) {
      if (!value) {
        throw fail(
          "Invalid --source-root.",
        );
      }

      sourceRoot =
        resolve(value);

      index += 1;
      continue;
    }

    if (
      arg ===
        "--output-directory"
    ) {
      if (
        !value ||
        outputDirectory !==
          null
      ) {
        throw fail(
          "Invalid or duplicate --output-directory.",
        );
      }

      outputDirectory =
        resolve(value);

      index += 1;
      continue;
    }

    throw fail(
      `Unknown portable release creation argument: ${String(arg)}`,
    );
  }

  if (
    outputDirectory ===
      null
  ) {
    throw fail(
      "--output-directory is required.",
    );
  }

  return Object.freeze({
    sourceRoot:
      resolve(
        sourceRoot,
      ),
    outputDirectory,
  });
}

export async function runCreatePortableReleaseCli(
  args: readonly string[] =
    process.argv.slice(2),
): Promise<void> {
  const parsed =
    parseCliArgs(args);

  const result =
    await createPortableRelease(
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
    ? resolve(
        process.argv[1],
      )
    : null;

if (
  executedPath !== null &&
  fileURLToPath(
    import.meta.url,
  ) ===
    executedPath
) {
  runCreatePortableReleaseCli()
    .catch(
      error => {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown portable release creation failure.";

        process.stderr.write(
          `Portable release creation failed: ${message}\n`,
        );

        process.exitCode =
          1;
      },
    );
}
