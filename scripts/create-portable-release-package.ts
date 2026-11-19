import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  createPortableReleaseIdentity,
  type PortableReleaseIdentityResult,
} from "./create-portable-release-identity.js";
import {
  BUSYBOOKIE_RELEASE_IDENTITY_FILE,
} from "../src/execution/portableReleaseRuntimeIdentity.js";

const MAX_CHILD_OUTPUT_BYTES =
  32 * 1024 * 1024;

const TREE_MANIFEST_SUFFIX =
  "-tree.sha256";

const ARCHIVE_SUFFIX =
  ".tar.gz";

type TreeEntry =
  Readonly<{
    relativePath: string;
    bytes: number;
    sha256: string;
  }>;

export type PortableReleasePackageResult =
  Readonly<{
    reviewedRevision: string;
    releaseFileCount: number;

    identityManifestPath: string;
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

function toolPath(
  path: string,
): string {
  return path.replaceAll(
    "\\",
    "/",
  );
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

async function requireAbsent(
  path: string,
  label: string,
): Promise<void> {
  if (await exists(path)) {
    throw fail(
      `${label} already exists.`,
    );
  }
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

function parseReleaseRelativePath(
  value: string,
): string {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw fail(
      "Portable release tree contains an unsafe relative path.",
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
      "Portable release tree contains an unsafe relative path.",
    );
  }

  return value;
}

async function listReleaseTreeFiles(
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
        left.name.localeCompare(
          right.name,
          "en",
        ),
    );

    for (const entry of entries) {
      if (
        entry.name === ".git" ||
        entry.name === ".gitmodules"
      ) {
        throw fail(
          "Portable release tree must not contain Git metadata.",
        );
      }

      if (
        entry.name === "node_modules"
      ) {
        throw fail(
          "Portable release tree must not contain node_modules.",
        );
      }

      const relativePath =
        parseReleaseRelativePath(
          prefix.length === 0
            ? entry.name
            : `${prefix}/${entry.name}`,
        );

      const canonicalPath =
        resolve(
          releaseRoot,
          ...relativePath.split("/"),
        );

      if (
        !isContainedPath(
          releaseRoot,
          canonicalPath,
        )
      ) {
        throw fail(
          "Portable release tree path escapes the release root.",
        );
      }

      const metadata =
        await lstat(
          canonicalPath,
        );

      if (
        metadata.isSymbolicLink()
      ) {
        throw fail(
          `Portable release tree contains a symbolic link: ${relativePath}`,
        );
      }

      if (
        metadata.isDirectory()
      ) {
        await walk(
          canonicalPath,
          relativePath,
        );

        continue;
      }

      if (
        !metadata.isFile()
      ) {
        throw fail(
          `Portable release tree contains a non-regular entry: ${relativePath}`,
        );
      }

      if (
        metadata.nlink !== 1
      ) {
        throw fail(
          `Portable release tree contains a multiply-linked file: ${relativePath}`,
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

  files.sort();

  return Object.freeze(files);
}

function sameStringArray(
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

async function readTreeEntry(
  releaseRoot: string,
  relativePath: string,
): Promise<TreeEntry> {
  const canonicalPath =
    resolve(
      releaseRoot,
      ...relativePath.split("/"),
    );

  const metadataBefore =
    await lstat(
      canonicalPath,
    );

  if (
    metadataBefore.isSymbolicLink() ||
    !metadataBefore.isFile() ||
    metadataBefore.nlink !== 1
  ) {
    throw fail(
      `Portable release file changed type while packaging: ${relativePath}`,
    );
  }

  const bytes =
    await readFile(
      canonicalPath,
    );

  const metadataAfter =
    await lstat(
      canonicalPath,
    );

  if (
    metadataAfter.isSymbolicLink() ||
    !metadataAfter.isFile() ||
    metadataAfter.nlink !== 1 ||
    metadataAfter.size !==
      bytes.byteLength
  ) {
    throw fail(
      `Portable release file changed while packaging: ${relativePath}`,
    );
  }

  return Object.freeze({
    relativePath,
    bytes:
      bytes.byteLength,
    sha256:
      rawSha256(bytes),
  });
}

async function buildTreeManifest(
  releaseRoot: string,
  relativePaths: readonly string[],
): Promise<
  Readonly<{
    entries: readonly TreeEntry[];
    bytes: Buffer;
  }>
> {
  const entries: TreeEntry[] = [];

  for (
    const relativePath
    of relativePaths
  ) {
    entries.push(
      await readTreeEntry(
        releaseRoot,
        relativePath,
      ),
    );
  }

  const text =
    entries
      .map(
        entry =>
          `${entry.sha256} *./${entry.relativePath}\n`,
      )
      .join("");

  return Object.freeze({
    entries:
      Object.freeze(entries),
    bytes:
      Buffer.from(
        text,
        "utf8",
      ),
  });
}

async function writeExclusive(
  path: string,
  bytes: Buffer,
): Promise<void> {
  const handle =
    await open(
      path,
      "wx",
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
        "Packaging artifact write verification failed.",
      );
    }
  } finally {
    await handle.close();
  }
}

async function execText(
  program: string,
  args: readonly string[],
  options: Readonly<{
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }> = {},
): Promise<string> {
  const result =
    await promisify(execFile)(
      program,
      [...args],
      {
        cwd:
          options.cwd,
        env:
          options.env,
        windowsHide:
          true,
        maxBuffer:
          MAX_CHILD_OUTPUT_BYTES,
        encoding:
          "utf8",
      },
    );

  return result.stdout;
}

async function requireDeterministicToolchain(): Promise<
  Readonly<{
    tarVersion: string;
    gzipVersion: string;
  }>
> {
  const tarVersionOutput =
    await execText(
      "tar",
      ["--version"],
    );

  const gzipVersionOutput =
    await execText(
      "gzip",
      ["--version"],
    );

  const tarVersion =
    tarVersionOutput
      .split(/\r?\n/u)[0] ?? "";

  const gzipVersion =
    gzipVersionOutput
      .split(/\r?\n/u)[0] ?? "";

  if (
    !tarVersion.includes(
      "GNU tar",
    )
  ) {
    throw fail(
      "Portable release packaging requires GNU tar.",
    );
  }

  if (
    !gzipVersion.toLowerCase().includes(
      "gzip",
    )
  ) {
    throw fail(
      "Portable release packaging requires gzip.",
    );
  }

  const tarHelp =
    await execText(
      "tar",
      ["--help"],
    );

  for (
    const option
    of [
      "--sort",
      "--mtime",
      "--owner",
      "--group",
      "--numeric-owner",
      "--format",
      "--no-recursion",
      "--files-from",
      "--null",
      "--verbatim-files-from",
      "--force-local",
    ]
  ) {
    if (
      !tarHelp.includes(option)
    ) {
      throw fail(
        `GNU tar lacks required deterministic packaging option: ${option}`,
      );
    }
  }

  const gzipHelp =
    await execText(
      "gzip",
      ["--help"],
    );

  if (
    !gzipHelp.includes("--no-name") &&
    !/(^|[\s,])-n([\s,]|$)/u.test(
      gzipHelp,
    )
  ) {
    throw fail(
      "gzip lacks the required no-name mode.",
    );
  }

  return Object.freeze({
    tarVersion,
    gzipVersion,
  });
}

async function createDeterministicArchive(
  releaseRoot: string,
  relativePaths: readonly string[],
  fileListPath: string,
  temporaryTarPath: string,
): Promise<string> {
  const fileListBytes =
    Buffer.from(
      relativePaths
        .map(
          path =>
            `./${path}\0`,
        )
        .join(""),
      "utf8",
    );

  await writeExclusive(
    fileListPath,
    fileListBytes,
  );

  await execText(
    "tar",
    [
      "--force-local",
      "--sort=name",
      "--mtime=UTC 1970-01-01",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "--format=ustar",
      "--no-recursion",
      "--null",
      "--verbatim-files-from",
      `--files-from=${toolPath(fileListPath)}`,
      "-cf",
      toolPath(temporaryTarPath),
    ],
    {
      cwd:
        releaseRoot,
    },
  );

  await execText(
    "gzip",
    [
      "-n",
      "-9",
      "-f",
      toolPath(
        temporaryTarPath,
      ),
    ],
  );

  const temporaryArchivePath =
    `${temporaryTarPath}.gz`;

  if (
    !(await exists(
      temporaryArchivePath,
    ))
  ) {
    throw fail(
      "Deterministic archive creation did not produce a gzip archive.",
    );
  }

  return temporaryArchivePath;
}

function normalizeManifestLines(
  bytes: Buffer,
): readonly string[] {
  const text =
    bytes.toString(
      "utf8",
    );

  if (
    text.length === 0 ||
    !text.endsWith("\n")
  ) {
    throw fail(
      "Whole-tree manifest is malformed.",
    );
  }

  const lines =
    text
      .slice(
        0,
        -1,
      )
      .split("\n")
      .sort();

  return Object.freeze(lines);
}

async function verifyArchive(
  archivePath: string,
  relativePaths: readonly string[],
  expectedManifestBytes: Buffer,
  streamedManifestPath: string,
): Promise<void> {
  const expectedMembers =
    relativePaths.map(
      path =>
        `./${path}`,
    );

  const listingOutput =
    await execText(
      "tar",
      [
        "--force-local",
        "-tzf",
        toolPath(
          archivePath,
        ),
      ],
    );

  const archiveMembers =
    listingOutput
      .split(/\r?\n/u)
      .filter(
        line =>
          line.length > 0,
      );

  if (
    new Set(
      archiveMembers,
    ).size !==
      archiveMembers.length
  ) {
    throw fail(
      "Portable release archive contains duplicate members.",
    );
  }

  const sortedArchiveMembers =
    [...archiveMembers]
      .sort();

  const sortedExpectedMembers =
    [...expectedMembers]
      .sort();

  if (
    !sameStringArray(
      sortedArchiveMembers,
      sortedExpectedMembers,
    )
  ) {
    throw fail(
      "Portable release archive inventory does not match the whole-tree manifest.",
    );
  }

  const verboseOutput =
    await execText(
      "tar",
      [
        "--force-local",
        "-tvzf",
        toolPath(
          archivePath,
        ),
      ],
    );

  const verboseLines =
    verboseOutput
      .split(/\r?\n/u)
      .filter(
        line =>
          line.length > 0,
      );

  if (
    verboseLines.length !==
      expectedMembers.length ||
    verboseLines.some(
      line =>
        !line.startsWith("-"),
    )
  ) {
    throw fail(
      "Portable release archive contains a non-regular member.",
    );
  }

  await requireAbsent(
    streamedManifestPath,
    "Streamed archive verification manifest",
  );

  const streamCommand =
    [
      "node -e '",
      "const crypto=require(\"node:crypto\");",
      "const fs=require(\"node:fs\");",
      "const chunks=[];",
      "process.stdin.on(\"data\",chunk=>chunks.push(chunk));",
      "process.stdin.on(\"end\",()=>{",
      "const data=Buffer.concat(chunks);",
      "const sha256=crypto.createHash(\"sha256\").update(data).digest(\"hex\");",
      "const name=process.env.TAR_FILENAME;",
      "const output=process.env.BUSYBOOKIE_STREAMED_ARCHIVE_MANIFEST;",
      "if(!name||!output){process.exitCode=1;return;}",
      "fs.appendFileSync(output,sha256+\" *\"+name+\"\\n\",\"utf8\");",
      "});",
      "'",
    ].join("");

  await execText(
    "tar",
    [
      "--force-local",
      "-xzf",
      toolPath(
        archivePath,
      ),
      `--to-command=${streamCommand}`,
    ],
    {
      env: {
        ...process.env,
        BUSYBOOKIE_STREAMED_ARCHIVE_MANIFEST:
          streamedManifestPath,
      },
    },
  );

  const streamedManifestBytes =
    await readFile(
      streamedManifestPath,
    );

  const expectedLines =
    normalizeManifestLines(
      expectedManifestBytes,
    );

  const streamedLines =
    normalizeManifestLines(
      streamedManifestBytes,
    );

  if (
    !sameStringArray(
      expectedLines,
      streamedLines,
    )
  ) {
    throw fail(
      "Portable release archive member bytes do not match the whole-tree manifest.",
    );
  }
}

async function hashArtifact(
  path: string,
): Promise<
  Readonly<{
    bytes: number;
    sha256: string;
  }>
> {
  const metadata =
    await lstat(path);

  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.nlink !== 1
  ) {
    throw fail(
      "Packaging artifact is not a single regular file.",
    );
  }

  const bytes =
    await readFile(path);

  if (
    bytes.byteLength !==
      metadata.size
  ) {
    throw fail(
      "Packaging artifact changed while being hashed.",
    );
  }

  return Object.freeze({
    bytes:
      bytes.byteLength,
    sha256:
      rawSha256(bytes),
  });
}

function requireIdentityInsertionOnly(
  before: readonly string[],
  after: readonly string[],
): void {
  const expected =
    [
      ...before,
      BUSYBOOKIE_RELEASE_IDENTITY_FILE,
    ].sort();

  if (
    !sameStringArray(
      expected,
      after,
    )
  ) {
    throw fail(
      "Portable release tree changed unexpectedly while creating its identity.",
    );
  }
}

export async function createPortableReleasePackage(
  input: Readonly<{
    sourceRoot: string;
    releaseRoot: string;
    outputDirectory: string;
  }>,
): Promise<PortableReleasePackageResult> {
  const sourceRoot =
    resolve(
      input.sourceRoot,
    );

  const releaseRoot =
    resolve(
      input.releaseRoot,
    );

  const outputDirectory =
    resolve(
      input.outputDirectory,
    );

  if (
    !isAbsolute(sourceRoot) ||
    !isAbsolute(releaseRoot) ||
    !isAbsolute(outputDirectory)
  ) {
    throw fail(
      "Portable release packaging roots must be absolute.",
    );
  }

  if (
    sourceRoot ===
      releaseRoot
  ) {
    throw fail(
      "Source root and release root must be different.",
    );
  }

  await requireRealDirectory(
    sourceRoot,
    "Source root",
  );

  await requireRealDirectory(
    releaseRoot,
    "Release root",
  );

  await requireRealDirectory(
    outputDirectory,
    "Output directory",
  );

  if (
    isContainedPath(
      releaseRoot,
      outputDirectory,
    )
  ) {
    throw fail(
      "Output directory must not be inside the portable release root.",
    );
  }

  if (
    isContainedPath(
      sourceRoot,
      outputDirectory,
    ) &&
    !isContainedPath(
      resolve(
        sourceRoot,
        ".git",
      ),
      outputDirectory,
    )
  ) {
    throw fail(
      "Output directory inside the reviewed source checkout is allowed only under .git.",
    );
  }

  const toolchain =
    await requireDeterministicToolchain();

  const identityPath =
    resolve(
      releaseRoot,
      BUSYBOOKIE_RELEASE_IDENTITY_FILE,
    );

  await requireAbsent(
    identityPath,
    "Portable release identity",
  );

  const beforeIdentityFiles =
    await listReleaseTreeFiles(
      releaseRoot,
    );

  let identity:
    PortableReleaseIdentityResult | null =
      null;

  let treeManifestPath:
    string | null =
      null;

  let archivePath:
    string | null =
      null;

  let temporaryManifestPath:
    string | null =
      null;

  let fileListPath:
    string | null =
      null;

  let temporaryTarPath:
    string | null =
      null;

  let temporaryArchivePath:
    string | null =
      null;

  let streamedManifestPath:
    string | null =
      null;

  let manifestPublished =
    false;

  let archivePublished =
    false;

  try {
    identity =
      await createPortableReleaseIdentity({
        sourceRoot,
        releaseRoot,
      });

    const afterIdentityFiles =
      await listReleaseTreeFiles(
        releaseRoot,
      );

    requireIdentityInsertionOnly(
      beforeIdentityFiles,
      afterIdentityFiles,
    );

    const artifactBaseName =
      `busybookie-release-${identity.reviewedRevision}`;

    treeManifestPath =
      resolve(
        outputDirectory,
        `${artifactBaseName}${TREE_MANIFEST_SUFFIX}`,
      );

    archivePath =
      resolve(
        outputDirectory,
        `${artifactBaseName}${ARCHIVE_SUFFIX}`,
      );

    temporaryManifestPath =
      resolve(
        outputDirectory,
        `.${artifactBaseName}${TREE_MANIFEST_SUFFIX}.building`,
      );

    fileListPath =
      resolve(
        outputDirectory,
        `.${artifactBaseName}.files.building`,
      );

    temporaryTarPath =
      resolve(
        outputDirectory,
        `.${artifactBaseName}.building.tar`,
      );

    temporaryArchivePath =
      `${temporaryTarPath}.gz`;

    streamedManifestPath =
      resolve(
        outputDirectory,
        `.${artifactBaseName}.streamed-tree.building`,
      );

    for (
      const [path, label]
      of [
        [
          treeManifestPath,
          "Final whole-tree manifest",
        ],
        [
          archivePath,
          "Final release archive",
        ],
        [
          temporaryManifestPath,
          "Temporary whole-tree manifest",
        ],
        [
          fileListPath,
          "Temporary archive file list",
        ],
        [
          temporaryTarPath,
          "Temporary tar archive",
        ],
        [
          temporaryArchivePath,
          "Temporary gzip archive",
        ],
        [
          streamedManifestPath,
          "Temporary streamed verification manifest",
        ],
      ] as const
    ) {
      await requireAbsent(
        path,
        label,
      );
    }

    const treeManifest =
      await buildTreeManifest(
        releaseRoot,
        afterIdentityFiles,
      );

    await writeExclusive(
      temporaryManifestPath,
      treeManifest.bytes,
    );

    const producedArchivePath =
      await createDeterministicArchive(
        releaseRoot,
        afterIdentityFiles,
        fileListPath,
        temporaryTarPath,
      );

    if (
      producedArchivePath !==
        temporaryArchivePath
    ) {
      throw fail(
        "Deterministic archive output path changed unexpectedly.",
      );
    }

    await verifyArchive(
      temporaryArchivePath,
      afterIdentityFiles,
      treeManifest.bytes,
      streamedManifestPath,
    );

    const treeManifestArtifact =
      await hashArtifact(
        temporaryManifestPath,
      );

    const archiveArtifact =
      await hashArtifact(
        temporaryArchivePath,
      );

    if (
      treeManifestArtifact.sha256 !==
        rawSha256(
          treeManifest.bytes,
        )
    ) {
      throw fail(
        "Whole-tree manifest changed after creation.",
      );
    }

    const finalReleaseFiles =
      await listReleaseTreeFiles(
        releaseRoot,
      );

    if (
      !sameStringArray(
        finalReleaseFiles,
        afterIdentityFiles,
      )
    ) {
      throw fail(
        "Portable release tree inventory changed before package publication.",
      );
    }

    const finalTreeManifest =
      await buildTreeManifest(
        releaseRoot,
        finalReleaseFiles,
      );

    if (
      !finalTreeManifest.bytes.equals(
        treeManifest.bytes,
      )
    ) {
      throw fail(
        "Portable release tree bytes changed before package publication.",
      );
    }

    await rename(
      temporaryManifestPath,
      treeManifestPath,
    );

    manifestPublished =
      true;

    await rename(
      temporaryArchivePath,
      archivePath,
    );

    archivePublished =
      true;

    await rm(
      fileListPath,
      {
        force: true,
      },
    );

    await rm(
      streamedManifestPath,
      {
        force: true,
      },
    );

    return Object.freeze({
      reviewedRevision:
        identity.reviewedRevision,
      releaseFileCount:
        afterIdentityFiles.length,

      identityManifestPath:
        identity.manifestPath,
      identityFileCount:
        identity.fileCount,
      identityManifestBytes:
        identity.manifestBytes,
      identityManifestSha256:
        identity.manifestSha256,

      treeManifestPath,
      treeManifestBytes:
        treeManifestArtifact.bytes,
      treeManifestSha256:
        treeManifestArtifact.sha256,

      archivePath,
      archiveBytes:
        archiveArtifact.bytes,
      archiveSha256:
        archiveArtifact.sha256,

      tarVersion:
        toolchain.tarVersion,
      gzipVersion:
        toolchain.gzipVersion,
    });
  } catch (error) {
    if (
      archivePublished &&
      archivePath !== null
    ) {
      await rm(
        archivePath,
        {
          force: true,
        },
      );
    }

    if (
      manifestPublished &&
      treeManifestPath !== null
    ) {
      await rm(
        treeManifestPath,
        {
          force: true,
        },
      );
    }

    for (
      const path
      of [
        temporaryManifestPath,
        fileListPath,
        temporaryTarPath,
        temporaryArchivePath,
        streamedManifestPath,
      ]
    ) {
      if (path !== null) {
        await rm(
          path,
          {
            force: true,
          },
        );
      }
    }

    if (
      identity !== null ||
      await exists(
        identityPath,
      )
    ) {
      await rm(
        identityPath,
        {
          force: true,
        },
      );
    }

    throw error;
  }
}

function parseCliArgs(
  args: readonly string[],
): Readonly<{
  sourceRoot: string;
  releaseRoot: string;
  outputDirectory: string;
}> {
  let sourceRoot =
    process.cwd();

  let sourceRootExplicit =
    false;

  let releaseRoot:
    string | null =
      null;

  let outputDirectory:
    string | null =
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
      if (
        !value ||
        sourceRootExplicit
      ) {
        throw fail(
          "Invalid or duplicate --source-root.",
        );
      }

      sourceRoot =
        resolve(value);

      sourceRootExplicit =
        true;

      index += 1;
      continue;
    }

    if (
      arg ===
        "--release-root"
    ) {
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
      `Unknown portable release package argument: ${String(arg)}`,
    );
  }

  if (
    releaseRoot === null
  ) {
    throw fail(
      "--release-root is required.",
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
    releaseRoot,
    outputDirectory,
  });
}

export async function runCreatePortableReleasePackageCli(
  args: readonly string[] =
    process.argv.slice(2),
): Promise<void> {
  const parsed =
    parseCliArgs(args);

  const result =
    await createPortableReleasePackage(
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
  runCreatePortableReleasePackageCli()
    .catch(
      error => {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown portable release packaging failure.";

        process.stderr.write(
          `Portable release package creation failed: ${message}\n`,
        );

        process.exitCode =
          1;
      },
    );
}
