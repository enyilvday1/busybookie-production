import { lstat, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  BoundEpisodeError,
  type FileBinding,
  type RuntimeIdentity,
} from "./boundEpisodeProduction.types.js";

export const BUSYBOOKIE_RELEASE_IDENTITY_FILE =
  "busybookie-release-identity.json";

const PORTABLE_RELEASE_IDENTITY_KIND =
  "BUSYBOOKIE_PORTABLE_RELEASE_IDENTITY";

const PORTABLE_RELEASE_IDENTITY_SCHEMA_VERSION =
  "1.0";

const RELEASE_IDENTITY_MAX_BYTES =
  8 * 1024 * 1024;

const RELEASE_RUNTIME_FILE_MAX_BYTES =
  64 * 1024 * 1024;

type BoundFileReader = (
  input: Readonly<{
    root: string;
    canonicalPath: string;
    role: string;
    maxBytes: number;
    optional?: boolean;
    expected?: FileBinding;
  }>,
) => Promise<
  Readonly<{
    binding: FileBinding;
    bytes: Buffer | null;
  }>
>;

type LinkSafePathValidator = (
  root: string,
  candidate: string,
  allowMissing?: boolean,
) => Promise<string>;

type PortableReleaseFileEntry = Readonly<{
  relativePath: string;
  bytes: number;
  sha256: string;
}>;

type PortableReleaseIdentityManifest = Readonly<{
  schemaVersion: "1.0";
  kind: "BUSYBOOKIE_PORTABLE_RELEASE_IDENTITY";
  reviewedRevision: string;
  files: readonly PortableReleaseFileEntry[];
}>;

export type PortableReleaseRuntimeIdentityDependencies = Readonly<{
  readBoundFile: BoundFileReader;
  requireLinkSafeContainedPath: LinkSafePathValidator;
}>;

function inputBindingDrift(cause?: unknown): BoundEpisodeError {
  return new BoundEpisodeError(
    "INPUT_BINDING_DRIFT",
    cause === undefined ? undefined : { cause },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();

  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    throw inputBindingDrift();
  }
}

function comparePortablePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parsePortableReleaseRelativePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/")
  ) {
    throw inputBindingDrift();
  }

  const segments = value.split("/");

  if (
    segments.some(
      segment =>
        segment.length === 0 ||
        segment === "." ||
        segment === "..",
    )
  ) {
    throw inputBindingDrift();
  }

  if (value === "package.json" || value === "package-lock.json") {
    return value;
  }

  if (!value.startsWith("dist/") || !value.endsWith(".js")) {
    throw inputBindingDrift();
  }

  return value;
}

function parsePortableReleaseIdentityManifest(
  value: unknown,
): PortableReleaseIdentityManifest {
  if (!isRecord(value)) {
    throw inputBindingDrift();
  }

  requireExactKeys(value, [
    "schemaVersion",
    "kind",
    "reviewedRevision",
    "files",
  ]);

  if (
    value.schemaVersion !== PORTABLE_RELEASE_IDENTITY_SCHEMA_VERSION ||
    value.kind !== PORTABLE_RELEASE_IDENTITY_KIND ||
    typeof value.reviewedRevision !== "string" ||
    !/^[a-f0-9]{40}$/u.test(value.reviewedRevision) ||
    !Array.isArray(value.files) ||
    value.files.length < 3 ||
    value.files.length > 10000
  ) {
    throw inputBindingDrift();
  }

  const files: PortableReleaseFileEntry[] = [];

  for (const rawEntry of value.files) {
    if (!isRecord(rawEntry)) {
      throw inputBindingDrift();
    }

    requireExactKeys(rawEntry, [
      "relativePath",
      "bytes",
      "sha256",
    ]);

    const relativePath =
      parsePortableReleaseRelativePath(rawEntry.relativePath);

    if (
      typeof rawEntry.bytes !== "number" ||
      !Number.isSafeInteger(rawEntry.bytes) ||
      rawEntry.bytes <= 0 ||
      rawEntry.bytes > RELEASE_RUNTIME_FILE_MAX_BYTES ||
      typeof rawEntry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(rawEntry.sha256)
    ) {
      throw inputBindingDrift();
    }

    files.push(
      Object.freeze({
        relativePath,
        bytes: rawEntry.bytes,
        sha256: rawEntry.sha256,
      }),
    );
  }

  for (let index = 1; index < files.length; index += 1) {
    if (
      comparePortablePaths(
        files[index - 1]!.relativePath,
        files[index]!.relativePath,
      ) >= 0
    ) {
      throw inputBindingDrift();
    }
  }

  if (
    !files.some(file => file.relativePath === "package.json") ||
    !files.some(file => file.relativePath === "package-lock.json") ||
    !files.some(
      file =>
        file.relativePath.startsWith("dist/") &&
        file.relativePath.endsWith(".js"),
    )
  ) {
    throw inputBindingDrift();
  }

  return Object.freeze({
    schemaVersion: PORTABLE_RELEASE_IDENTITY_SCHEMA_VERSION,
    kind: PORTABLE_RELEASE_IDENTITY_KIND,
    reviewedRevision: value.reviewedRevision,
    files: Object.freeze(files),
  });
}

function parseManifestBytes(bytes: Buffer): PortableReleaseIdentityManifest {
  let value: unknown;

  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch (cause) {
    throw inputBindingDrift(cause);
  }

  return parsePortableReleaseIdentityManifest(value);
}

function equalStringArrays(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function listPortableReleaseJavaScriptFiles(
  root: string,
  requireLinkSafeContainedPath: LinkSafePathValidator,
): Promise<readonly string[]> {
  const distRoot = resolve(root, "dist");

  try {
    await requireLinkSafeContainedPath(root, distRoot);
  } catch (cause) {
    throw inputBindingDrift(cause);
  }

  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    let entries: import("node:fs").Dirent<string>[];

    try {
      entries = await readdir(directory, {
        withFileTypes: true,
        encoding: "utf8",
      });
    } catch (cause) {
      throw inputBindingDrift(cause);
    }

    entries.sort((left, right) =>
      comparePortablePaths(left.name, right.name),
    );

    for (const entry of entries) {
      const candidate = resolve(directory, entry.name);

      try {
        await requireLinkSafeContainedPath(root, candidate);
      } catch (cause) {
        throw inputBindingDrift(cause);
      }

      const metadata = await lstat(candidate);

      if (metadata.isSymbolicLink()) {
        throw inputBindingDrift();
      }

      if (metadata.isDirectory()) {
        await visit(candidate);
        continue;
      }

      if (!metadata.isFile()) {
        throw inputBindingDrift();
      }

      const relativePath =
        relative(root, candidate)
          .split(sep)
          .join("/");

      if (relativePath.endsWith(".js")) {
        files.push(relativePath);
        continue;
      }

      /*
       * These are emitted TypeScript build/debug artefacts but are not
       * executed by Node. Any other file class in dist fails closed.
       */
      if (
        relativePath.endsWith(".js.map") ||
        relativePath.endsWith(".d.ts")
      ) {
        continue;
      }

      throw inputBindingDrift();
    }
  }

  await visit(distRoot);

  return Object.freeze(files.sort(comparePortablePaths));
}

export async function readPortableReleaseRuntimeIdentity(
  input: Readonly<{
    root: string;
    mediaRoot: string;
    ffprobeExecutable?: string;
  }>,
  dependencies: PortableReleaseRuntimeIdentityDependencies,
): Promise<RuntimeIdentity | null> {
  const root = resolve(input.root);
  const manifestPath =
    resolve(root, BUSYBOOKIE_RELEASE_IDENTITY_FILE);

  const manifestRead =
    await dependencies.readBoundFile({
      root,
      canonicalPath: manifestPath,
      role: "RUNTIME_RELEASE_MANIFEST",
      maxBytes: RELEASE_IDENTITY_MAX_BYTES,
      optional: true,
    });

  if (!manifestRead.binding.exists) {
    return null;
  }

  if (manifestRead.bytes === null) {
    throw inputBindingDrift();
  }

  const manifest =
    parseManifestBytes(manifestRead.bytes);

  const expectedInventory =
    manifest.files.map(file => file.relativePath);

  const inventory = async () =>
    [
      ...await listPortableReleaseJavaScriptFiles(
        root,
        dependencies.requireLinkSafeContainedPath,
      ),
      "package-lock.json",
      "package.json",
    ].sort(comparePortablePaths);

  const actualInventoryBefore = await inventory();

  if (!equalStringArrays(actualInventoryBefore, expectedInventory)) {
    throw inputBindingDrift();
  }

  const executableInputs: FileBinding[] = [
    manifestRead.binding,
  ];

  for (const file of manifest.files) {
    const absolutePath =
      resolve(root, ...file.relativePath.split("/"));

    const expected: FileBinding = Object.freeze({
      role: `RUNTIME:${file.relativePath}`,
      canonicalPath: absolutePath,
      exists: true,
      rawSha256: file.sha256,
      bytes: file.bytes,
    });

    const observed =
      await dependencies.readBoundFile({
        root,
        canonicalPath: absolutePath,
        role: expected.role,
        maxBytes: RELEASE_RUNTIME_FILE_MAX_BYTES,
        expected,
      });

    executableInputs.push(observed.binding);
  }

  /*
   * Re-observe both manifest and executable inventory after binding every
   * runtime file so identity assembly cannot silently accept simple drift.
   */
  await dependencies.readBoundFile({
    root,
    canonicalPath: manifestPath,
    role: manifestRead.binding.role,
    maxBytes: RELEASE_IDENTITY_MAX_BYTES,
    expected: manifestRead.binding,
  });

  const actualInventoryAfter = await inventory();

  if (!equalStringArrays(actualInventoryAfter, expectedInventory)) {
    throw inputBindingDrift();
  }

  let ffprobe: FileBinding | null = null;

  if (input.ffprobeExecutable) {
    if (!isAbsolute(input.ffprobeExecutable)) {
      throw inputBindingDrift();
    }

    ffprobe =
      (
        await dependencies.readBoundFile({
          root: dirname(input.ffprobeExecutable),
          canonicalPath: input.ffprobeExecutable,
          role: "FFPROBE",
          maxBytes: 256 * 1024 * 1024,
        })
      ).binding;
  }

  return Object.freeze({
    reviewedRevision: manifest.reviewedRevision,
    repositoryRoot: root,
    mediaRoot: resolve(input.mediaRoot),
    physicalMediaRoot: resolve(input.mediaRoot),
    executableInputs: Object.freeze(executableInputs),
    ffprobe,
  });
}

export function isPortableRuntimeIdentity(
  identity: RuntimeIdentity,
): boolean {
  return (
    identity.executableInputs[0]?.role ===
    "RUNTIME_RELEASE_MANIFEST"
  );
}
