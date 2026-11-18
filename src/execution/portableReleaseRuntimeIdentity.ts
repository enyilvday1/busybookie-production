import { lstat, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  BoundEpisodeError,
  type FileBinding,
  type RuntimeIdentity,
} from "./boundEpisodeProduction.types.js";

export const BUSYBOOKIE_RELEASE_IDENTITY_FILE =
  "busybookie-release-identity.json";

export const PORTABLE_RELEASE_IDENTITY_KIND =
  "BUSYBOOKIE_PORTABLE_RELEASE_IDENTITY";

/*
 * Schema 2.0 binds the deployable operator-console build in addition to the
 * root runtime files bound by schema 1.0. A 1.0 manifest is not a valid
 * portable production identity and is rejected rather than widened.
 */
export const PORTABLE_RELEASE_IDENTITY_SCHEMA_VERSION =
  "2.0";

const RELEASE_IDENTITY_MAX_BYTES =
  8 * 1024 * 1024;

const RELEASE_RUNTIME_FILE_MAX_BYTES =
  64 * 1024 * 1024;

/*
 * The deployable operator-console build shape: exactly index.html plus flat
 * assets/<safe-name>.js|css, mirroring the operator-console loader. Declared
 * here rather than imported so execution code does not depend on operator
 * server presentation code.
 */
const OPERATOR_CONSOLE_DIST_SEGMENTS =
  Object.freeze(["apps", "operator-console", "dist"]);

const OPERATOR_CONSOLE_DIST_PREFIX =
  "apps/operator-console/dist/";

const OPERATOR_CONSOLE_INDEX_FILE =
  "index.html";

const OPERATOR_CONSOLE_ASSETS_DIRECTORY =
  "assets";

const OPERATOR_CONSOLE_INDEX_PATH =
  `${OPERATOR_CONSOLE_DIST_PREFIX}${OPERATOR_CONSOLE_INDEX_FILE}`;

const OPERATOR_CONSOLE_ASSET_NAME_PATTERN =
  /^[A-Za-z0-9_-]+\.(?:js|css)$/u;

const OPERATOR_CONSOLE_ASSET_PATH_PATTERN =
  /^apps\/operator-console\/dist\/assets\/[A-Za-z0-9_-]+\.(?:js|css)$/u;

const OPERATOR_CONSOLE_SCRIPT_PATH_PATTERN =
  /^apps\/operator-console\/dist\/assets\/[A-Za-z0-9_-]+\.js$/u;

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
  schemaVersion: typeof PORTABLE_RELEASE_IDENTITY_SCHEMA_VERSION;
  kind: typeof PORTABLE_RELEASE_IDENTITY_KIND;
  reviewedRevision: string;
  files: readonly PortableReleaseFileEntry[];
}>;

export type PortableReleaseRuntimeIdentityDependencies = Readonly<{
  readBoundFile: BoundFileReader;
  requireLinkSafeContainedPath: LinkSafePathValidator;
}>;

export type VerifiedPortableRelease = Readonly<{
  reviewedRevision: string;
  root: string;
  manifest: FileBinding;
  files: readonly FileBinding[];
}>;

export type PortableReleaseIdentityFailure =
  | "RELEASE_ROOT_WORKING_DIRECTORY_MISMATCH"
  | "RELEASE_IDENTITY_MISSING"
  | "RELEASE_IDENTITY_INVALID";

// Fixed, path-free message and no cause: manifest contents, hashes and
// filesystem error messages (which carry absolute paths) must not reach a
// launcher's output.
export class PortableReleaseIdentityError extends Error {
  readonly failure: PortableReleaseIdentityFailure;

  constructor(failure: PortableReleaseIdentityFailure) {
    super(`Portable release identity verification failed (${failure}).`);
    this.name = "PortableReleaseIdentityError";
    this.failure = failure;
  }
}

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

function isRootRuntimeJavaScriptPath(value: string): boolean {
  return value.startsWith("dist/") && value.endsWith(".js");
}

function isOperatorConsoleScriptPath(value: string): boolean {
  return OPERATOR_CONSOLE_SCRIPT_PATH_PATTERN.test(value);
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

  if (
    value === "package.json" ||
    value === "package-lock.json" ||
    value === OPERATOR_CONSOLE_INDEX_PATH ||
    OPERATOR_CONSOLE_ASSET_PATH_PATTERN.test(value) ||
    isRootRuntimeJavaScriptPath(value)
  ) {
    return value;
  }

  throw inputBindingDrift();
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
    value.files.length < 5 ||
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
    !files.some(file => isRootRuntimeJavaScriptPath(file.relativePath)) ||
    !files.some(file => file.relativePath === OPERATOR_CONSOLE_INDEX_PATH) ||
    !files.some(file => isOperatorConsoleScriptPath(file.relativePath))
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

function portableRelativePath(root: string, candidate: string): string {
  return relative(root, candidate)
    .split(sep)
    .join("/");
}

async function requireContained(
  root: string,
  candidate: string,
  requireLinkSafeContainedPath: LinkSafePathValidator,
): Promise<void> {
  try {
    await requireLinkSafeContainedPath(root, candidate);
  } catch (cause) {
    throw inputBindingDrift(cause);
  }
}

async function readDirectoryEntries(
  directory: string,
): Promise<import("node:fs").Dirent<string>[]> {
  try {
    const entries = await readdir(directory, {
      withFileTypes: true,
      encoding: "utf8",
    });

    return entries.sort((left, right) =>
      comparePortablePaths(left.name, right.name),
    );
  } catch (cause) {
    throw inputBindingDrift(cause);
  }
}

async function observeEntry(
  candidate: string,
): Promise<import("node:fs").Stats> {
  try {
    return await lstat(candidate);
  } catch (cause) {
    throw inputBindingDrift(cause);
  }
}

async function listRootRuntimeJavaScript(
  root: string,
  requireLinkSafeContainedPath: LinkSafePathValidator,
): Promise<readonly string[]> {
  const distRoot = resolve(root, "dist");

  await requireContained(root, distRoot, requireLinkSafeContainedPath);

  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    for (const entry of await readDirectoryEntries(directory)) {
      const candidate = resolve(directory, entry.name);

      await requireContained(root, candidate, requireLinkSafeContainedPath);

      const metadata = await observeEntry(candidate);

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

      const relativePath = portableRelativePath(root, candidate);

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

  if (files.length === 0) {
    throw inputBindingDrift();
  }

  return Object.freeze(files);
}

async function requireRegularFile(
  root: string,
  candidate: string,
  requireLinkSafeContainedPath: LinkSafePathValidator,
): Promise<void> {
  await requireContained(root, candidate, requireLinkSafeContainedPath);

  const metadata = await observeEntry(candidate);

  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw inputBindingDrift();
  }
}

/*
 * The served operator-console build: exactly index.html and a flat assets/
 * directory of <safe-name>.js|css regular files, with at least one script.
 * Any other entry, nesting, link or file class fails closed.
 */
async function listOperatorConsoleBuild(
  root: string,
  requireLinkSafeContainedPath: LinkSafePathValidator,
): Promise<readonly string[]> {
  const consoleRoot = resolve(root, ...OPERATOR_CONSOLE_DIST_SEGMENTS);

  await requireContained(root, consoleRoot, requireLinkSafeContainedPath);

  const consoleMetadata = await observeEntry(consoleRoot);

  if (consoleMetadata.isSymbolicLink() || !consoleMetadata.isDirectory()) {
    throw inputBindingDrift();
  }

  const names =
    (await readDirectoryEntries(consoleRoot)).map(entry => entry.name);

  if (
    !equalStringArrays(names, [
      OPERATOR_CONSOLE_ASSETS_DIRECTORY,
      OPERATOR_CONSOLE_INDEX_FILE,
    ])
  ) {
    throw inputBindingDrift();
  }

  const indexPath = resolve(consoleRoot, OPERATOR_CONSOLE_INDEX_FILE);

  await requireRegularFile(root, indexPath, requireLinkSafeContainedPath);

  const assetsRoot = resolve(consoleRoot, OPERATOR_CONSOLE_ASSETS_DIRECTORY);

  await requireContained(root, assetsRoot, requireLinkSafeContainedPath);

  const assetsMetadata = await observeEntry(assetsRoot);

  if (assetsMetadata.isSymbolicLink() || !assetsMetadata.isDirectory()) {
    throw inputBindingDrift();
  }

  const files = [portableRelativePath(root, indexPath)];

  for (const entry of await readDirectoryEntries(assetsRoot)) {
    if (!OPERATOR_CONSOLE_ASSET_NAME_PATTERN.test(entry.name)) {
      throw inputBindingDrift();
    }

    const candidate = resolve(assetsRoot, entry.name);

    await requireRegularFile(root, candidate, requireLinkSafeContainedPath);

    files.push(portableRelativePath(root, candidate));
  }

  if (!files.some(isOperatorConsoleScriptPath)) {
    throw inputBindingDrift();
  }

  return Object.freeze(files);
}

/*
 * The complete schema 2.0 inventory of a release root: root dist/**\/*.js,
 * the operator-console build, package.json and package-lock.json, sorted.
 * Shared by the packaging-time writer and runtime verification so both apply
 * one inventory algorithm. Fails closed with INPUT_BINDING_DRIFT.
 */
export async function listPortableReleaseInventory(
  rootInput: string,
  requireLinkSafeContainedPath: LinkSafePathValidator,
): Promise<readonly string[]> {
  const root = resolve(rootInput);

  return Object.freeze(
    [
      ...await listRootRuntimeJavaScript(root, requireLinkSafeContainedPath),
      ...await listOperatorConsoleBuild(root, requireLinkSafeContainedPath),
      "package-lock.json",
      "package.json",
    ].sort(comparePortablePaths),
  );
}

/*
 * Verifies the portable manifest and every bound file without a media root.
 * Returns null only when no manifest exists; any present manifest must be a
 * valid schema 2.0 identity whose inventory and bytes match exactly.
 */
async function verifyPortableReleaseIfPresent(
  rootInput: string,
  dependencies: PortableReleaseRuntimeIdentityDependencies,
): Promise<VerifiedPortableRelease | null> {
  const root = resolve(rootInput);
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

  const inventory = () =>
    listPortableReleaseInventory(
      root,
      dependencies.requireLinkSafeContainedPath,
    );

  if (!equalStringArrays(await inventory(), expectedInventory)) {
    throw inputBindingDrift();
  }

  const files: FileBinding[] = [];

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

    files.push(observed.binding);
  }

  /*
   * Re-observe both manifest and the complete inventory after binding every
   * file so identity assembly cannot silently accept simple drift.
   */
  await dependencies.readBoundFile({
    root,
    canonicalPath: manifestPath,
    role: manifestRead.binding.role,
    maxBytes: RELEASE_IDENTITY_MAX_BYTES,
    expected: manifestRead.binding,
  });

  if (!equalStringArrays(await inventory(), expectedInventory)) {
    throw inputBindingDrift();
  }

  return Object.freeze({
    reviewedRevision: manifest.reviewedRevision,
    root,
    manifest: manifestRead.binding,
    files: Object.freeze(files),
  });
}

/*
 * Runtime inputs (episodes, config) resolve from the working directory, so a
 * production process must run from the exact release root it verifies and
 * executes from. Exact resolved-path equality only: no alias, realpath or
 * case folding. Neither path is reported.
 */
export function requirePortableReleaseWorkingDirectory(
  releaseRoot: string,
  workingDirectory: string,
): void {
  if (resolve(releaseRoot) !== resolve(workingDirectory)) {
    throw new PortableReleaseIdentityError(
      "RELEASE_ROOT_WORKING_DIRECTORY_MISMATCH",
    );
  }
}

/*
 * The production requirement: a portable release identity must exist and
 * verify. Every failure becomes one fixed, path-free error.
 */
export async function requirePortableReleaseIdentity(
  root: string,
  dependencies: PortableReleaseRuntimeIdentityDependencies,
): Promise<VerifiedPortableRelease> {
  let verified: VerifiedPortableRelease | null;

  try {
    verified = await verifyPortableReleaseIfPresent(root, dependencies);
  } catch {
    throw new PortableReleaseIdentityError("RELEASE_IDENTITY_INVALID");
  }

  if (verified === null) {
    throw new PortableReleaseIdentityError("RELEASE_IDENTITY_MISSING");
  }

  return verified;
}

export async function readPortableReleaseRuntimeIdentity(
  input: Readonly<{
    root: string;
    mediaRoot: string;
    ffprobeExecutable?: string;
  }>,
  dependencies: PortableReleaseRuntimeIdentityDependencies,
): Promise<RuntimeIdentity | null> {
  const verified =
    await verifyPortableReleaseIfPresent(input.root, dependencies);

  if (verified === null) {
    return null;
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
    reviewedRevision: verified.reviewedRevision,
    repositoryRoot: verified.root,
    mediaRoot: resolve(input.mediaRoot),
    physicalMediaRoot: resolve(input.mediaRoot),
    executableInputs: Object.freeze([verified.manifest, ...verified.files]),
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
