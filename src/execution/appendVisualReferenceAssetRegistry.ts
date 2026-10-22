import {
  createHash,
  randomUUID,
} from "node:crypto";

import {
  open,
  readFile,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";

import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  isDeepStrictEqual,
} from "node:util";

import {
  VisualReferenceAssetRegistrySchema,
  VisualReferenceAssetSchema,
  type VisualReferenceAsset,
  type VisualReferenceAssetRegistry,
} from "./visualReferenceAsset.schema.js";

import {
  createVisualReferenceAssetRegistryPath,
} from "./visualReferenceAssetRegistryPath.js";

import {
  detectImageContentType,
  verifyApprovedVisualReferenceAsset,
  type VerifyApprovedVisualReferenceAssetDependencies,
} from "./verifyApprovedVisualReferenceAsset.js";

// Generic, append-only registry mutation. The registry must already exist (it is never bootstrapped).
// Concurrency: an exclusive sibling "<registry>.lock" is created with "wx"; an existing lock fails closed
// and is never removed as stale. Under the lock the exact on-disk registry bytes are re-read and their
// SHA-256 must equal the operator's expected digest (optimistic precondition on the inspected file).
// Publication: the complete validated candidate is written to a same-directory temporary file, flushed,
// then renamed over the registry, so readers see either the old or the new complete file.

export type AppendVisualReferenceAssetRegistryInput =
  Readonly<{
    mediaRoot: string;
    // Absolute path of the already-placed physical image strictly inside <mediaRoot>/references.
    sourceImagePath: string;
    assetId: string;
    expectedRegistrySha256: string;
    // Optional extra guard: the derived content type must equal this value.
    expectedContentType?: VisualReferenceAsset["contentType"];
  }>;

export type AppendVisualReferenceAssetRegistryDependencies =
  VerifyApprovedVisualReferenceAssetDependencies &
    Readonly<{
      createTemporarySuffix?: () => string;
      // Test seam invoked after the lock is held and before the registry is re-read.
      afterLockAcquired?: () => Promise<void>;
    }>;

export type AppendVisualReferenceAssetRegistryResult =
  Readonly<{
    entry: VisualReferenceAsset;
    registry: VisualReferenceAssetRegistry;
    registryPath: string;
    previousRegistrySha256: string;
    registrySha256: string;
  }>;

const SHA256 = /^[0-9a-f]{64}$/;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

export function visualReferenceRegistryLockPath(registryPath: string): string {
  return `${registryPath}.lock`;
}

function mediaRootRelativeReferencePath(mediaRoot: string, sourceImagePath: string): string {
  const relativePath = relative(mediaRoot, sourceImagePath);

  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Visual reference source must be inside the media root: ${sourceImagePath}`);
  }

  const canonical = relativePath.split(sep).join("/");

  if (resolve(mediaRoot, ...canonical.split("/")) !== sourceImagePath) {
    throw new Error(`Visual reference source path is not canonical: ${sourceImagePath}`);
  }

  return canonical;
}

async function readRegistryBytes(registryPath: string): Promise<Buffer> {
  try {
    return await readFile(registryPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new Error(
        `Visual reference asset registry does not exist: ${registryPath}. Append never creates a registry.`,
        { cause: error },
      );
    }

    throw new Error(`Could not read visual reference asset registry: ${registryPath}`, { cause: error });
  }
}

export async function appendVisualReferenceAssetRegistry(
  input: AppendVisualReferenceAssetRegistryInput,
  dependencies: AppendVisualReferenceAssetRegistryDependencies = {},
): Promise<AppendVisualReferenceAssetRegistryResult> {
  const mediaRootText = input.mediaRoot.trim();

  if (!mediaRootText || !isAbsolute(mediaRootText)) {
    throw new Error("Visual reference registry append requires an absolute media root.");
  }

  if (!SHA256.test(input.expectedRegistrySha256)) {
    throw new Error("expectedRegistrySha256 must be a lowercase 64-character hexadecimal SHA-256.");
  }

  if (!isAbsolute(input.sourceImagePath)) {
    throw new Error("Visual reference source image path must be absolute.");
  }

  const assetId = VisualReferenceAssetSchema.shape.assetId.parse(input.assetId);

  if (assetId !== input.assetId) {
    throw new Error("Visual reference assetId must not carry leading or trailing whitespace.");
  }

  const mediaRoot = resolve(mediaRootText);
  const sourceImagePath = resolve(input.sourceImagePath);
  const mediaRootRelativePath = mediaRootRelativeReferencePath(mediaRoot, sourceImagePath);
  const registryPath = createVisualReferenceAssetRegistryPath(mediaRoot);
  const lockPath = visualReferenceRegistryLockPath(registryPath);

  // Fast fail before taking the lock; the authoritative existence check repeats under the lock.
  await readRegistryBytes(registryPath);

  let lock: FileHandle | undefined;
  let lockCreated = false;
  let temporaryPath: string | undefined;
  let renamed = false;

  try {
    try {
      lock = await open(lockPath, "wx");
      lockCreated = true;
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        throw new Error(
          `Visual reference asset registry is locked: ${lockPath}. An existing lock is never removed automatically; investigate and remove it manually only if no writer is running.`,
          { cause: error },
        );
      }

      throw new Error(`Could not acquire visual reference asset registry lock: ${lockPath}`, { cause: error });
    }

    await lock.writeFile(`pid=${process.pid}\nacquiredAt=${new Date().toISOString()}\n`, "utf8");
    await lock.sync();

    await dependencies.afterLockAcquired?.();

    const previousBytes = await readRegistryBytes(registryPath);
    const previousRegistrySha256 = sha256(previousBytes);

    if (previousRegistrySha256 !== input.expectedRegistrySha256) {
      throw new Error(
        `Visual reference asset registry changed: expected SHA-256 ${input.expectedRegistrySha256}, found ${previousRegistrySha256}. Nothing was appended.`,
      );
    }

    let rawRegistry: unknown;

    try {
      rawRegistry = JSON.parse(previousBytes.toString("utf8"));
    } catch (error) {
      throw new Error(`Visual reference asset registry contains malformed JSON: ${registryPath}`, { cause: error });
    }

    const parsedRegistry = VisualReferenceAssetRegistrySchema.safeParse(rawRegistry);

    if (!parsedRegistry.success) {
      throw new Error(`Visual reference asset registry is invalid: ${registryPath}`, { cause: parsedRegistry.error });
    }

    const registry = parsedRegistry.data;

    // Rewriting must not change any existing entry: if schema parsing transformed a stored value, fail
    // closed instead of silently rewriting it. Key order is irrelevant; values must be identical.
    if (!isDeepStrictEqual(registry, rawRegistry)) {
      throw new Error("Visual reference asset registry is not in canonical stored form; refusing to rewrite it.");
    }

    if (registry.assets.some((asset) => asset.assetId === assetId)) {
      throw new Error(`Visual reference asset id is already registered: ${assetId}.`);
    }

    if (registry.assets.some((asset) => asset.mediaRootRelativePath.toLowerCase() === mediaRootRelativePath.toLowerCase())) {
      throw new Error(`Visual reference path is already registered: ${mediaRootRelativePath}.`);
    }

    // Derive the evidence from the physical file; caller-supplied bytes/hash/type are never accepted.
    const sourceBytes = await readFile(sourceImagePath);

    const entry = VisualReferenceAssetSchema.parse({
      assetId,
      mediaRootRelativePath,
      bytes: sourceBytes.length,
      sha256: sha256(sourceBytes),
      contentType: detectImageContentType(sourceBytes),
    });

    if (input.expectedContentType !== undefined && entry.contentType !== input.expectedContentType) {
      throw new Error(
        `Visual reference content type ${entry.contentType} does not match the expected ${input.expectedContentType}.`,
      );
    }

    const candidate = VisualReferenceAssetRegistrySchema.parse({
      ...registry,
      assets: [...registry.assets, entry],
    });

    // One authoritative algorithm: containment, realpath, regular file, size before/after read, SHA-256
    // and signature are re-verified against the in-memory candidate before anything becomes durable.
    await verifyApprovedVisualReferenceAsset(
      { mediaRoot, sourceImagePath, approvedAssetIds: [assetId], registry: candidate },
      dependencies.realpath ? { realpath: dependencies.realpath } : {},
    );

    const candidateBytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`, "utf8");

    temporaryPath =
      `${registryPath}.part-${process.pid}-${(dependencies.createTemporarySuffix ?? randomUUID)()}`;

    const temporary = await open(temporaryPath, "wx");

    try {
      await temporary.writeFile(candidateBytes);
      await temporary.sync();
    } finally {
      await temporary.close();
    }

    // Last check under the lock immediately before replacement.
    if (sha256(await readRegistryBytes(registryPath)) !== previousRegistrySha256) {
      throw new Error("Visual reference asset registry changed while the lock was held. Nothing was appended.");
    }

    await rename(temporaryPath, registryPath);
    renamed = true;

    const publishedBytes = await readFile(registryPath);
    const registrySha256 = sha256(publishedBytes);

    if (registrySha256 !== sha256(candidateBytes)) {
      throw new Error(`Visual reference asset registry read-back does not match the published candidate: ${registryPath}`);
    }

    return Object.freeze({
      entry,
      registry: candidate,
      registryPath,
      previousRegistrySha256,
      registrySha256,
    });
  } finally {
    if (temporaryPath && !renamed) {
      try {
        await unlink(temporaryPath);
      } catch {
        // Preserve the original result or failure.
      }
    }

    // Only the lock this call created is released; a pre-existing lock is never touched.
    if (lock && lockCreated) {
      try {
        await releaseOwnedRegistryLock(lock, lockPath);
      } catch {
        // Preserve the original result or failure.
      }
    }
  }
}

// Close and unlink are attempted independently: a close failure must not skip removing the lock this
// invocation created. The caller contains either failure so it never hides the primary result.
// Shared with bootstrapVisualReferenceAssetRegistry, which uses the same sibling lock.
export async function releaseOwnedRegistryLock(lock: FileHandle, lockPath: string): Promise<void> {
  try {
    await lock.close();
  } finally {
    await unlink(lockPath);
  }
}

// Exact-file-bytes SHA-256 of the current registry: the value an operator inspects and then passes back
// as expectedRegistrySha256.
export async function readVisualReferenceRegistrySha256(mediaRoot: string): Promise<string> {
  return sha256(await readRegistryBytes(createVisualReferenceAssetRegistryPath(mediaRoot)));
}
