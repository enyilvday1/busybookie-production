import {
  createHash,
  randomUUID,
} from "node:crypto";

import {
  constants,
} from "node:fs";

import {
  copyFile,
  lstat,
  open,
  readFile,
  stat,
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
  z,
} from "zod";

import {
  releaseOwnedRegistryLock,
  visualReferenceRegistryLockPath,
} from "./appendVisualReferenceAssetRegistry.js";

import {
  readVisualReferenceAssetRegistry,
} from "./readVisualReferenceAssetRegistry.js";

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

// Explicit maintenance operation: create the visual-reference registry exactly once, containing exactly one
// operator-named, physically verified initial asset. It never overwrites a registry, never creates the
// references/ root and never discovers or registers other files. appendVisualReferenceAssetRegistry stays the
// only way to add assets to an existing registry and still refuses a missing one.
//
// Concurrency: the same sibling "<registry>.lock" as the append writer ("wx"; an existing lock fails closed and is
// never removed). Publication: the complete candidate is written to a same-directory temporary file, flushed,
// then copied to the final path with COPYFILE_EXCL, so an existing registry is never replaced. COPYFILE_EXCL is
// used rather than a hard link because the production volume is exFAT, which has no hard links. Readers racing
// the copy may briefly see an incomplete file; the strict registry reader then fails closed (malformed JSON).

const SHA256 = /^[0-9a-f]{64}$/;

// Strict: authoritative values (content type, registry entry, registry payload, output path) cannot be supplied.
export const BootstrapVisualReferenceAssetRegistryInputSchema =
  z.object({
    mediaRoot: z.string().min(1),
    sourceFile: z.string().min(1),
    assetId: VisualReferenceAssetSchema.shape.assetId,
    expectedSourceSha256: z.string().regex(SHA256, "expectedSourceSha256 must be a lowercase 64-character hexadecimal SHA-256."),
    expectedSourceBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }).strict();

export type BootstrapVisualReferenceAssetRegistryInput =
  z.input<typeof BootstrapVisualReferenceAssetRegistryInputSchema>;

export type BootstrapVisualReferenceAssetRegistryDependencies =
  VerifyApprovedVisualReferenceAssetDependencies &
    Readonly<{
      // Test seam invoked under the lock after the temporary candidate is written, before publication.
      beforePublish?: () => Promise<void>;
    }>;

export type BootstrapVisualReferenceAssetRegistryResult =
  Readonly<{
    registryPath: string;
    entry: VisualReferenceAsset;
    registry: VisualReferenceAssetRegistry;
    // SHA-256 of the exact persisted registry file bytes (the next append's expectedRegistrySha256).
    registrySha256: string;
  }>;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function blocked(detail: string): never {
  throw new Error(`Visual reference registry bootstrap blocked: ${detail}`);
}

async function requireDirectory(path: string, label: string): Promise<void> {
  try {
    if (!(await stat(path)).isDirectory()) blocked(`${label} is not a directory: ${path}`);
  } catch (error) {
    if (errorCode(error) === "ENOENT") blocked(`${label} does not exist: ${path}. It is never created by bootstrap.`);
    throw error;
  }
}

async function requireRegistryAbsent(registryPath: string): Promise<void> {
  try {
    await lstat(registryPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }

  blocked(`a visual reference registry already exists and is never overwritten: ${registryPath}`);
}

function canonicalReferencePath(mediaRoot: string, referencesRoot: string, sourceFile: string): string {
  const insideReferences = relative(referencesRoot, sourceFile);

  if (!insideReferences || insideReferences === ".." || insideReferences.startsWith(`..${sep}`) || isAbsolute(insideReferences)) {
    blocked(`source file must be strictly inside ${referencesRoot}: ${sourceFile}`);
  }

  const canonical = relative(mediaRoot, sourceFile).split(sep).join("/");

  if (resolve(mediaRoot, ...canonical.split("/")) !== sourceFile) {
    blocked(`source file path is not canonical: ${sourceFile}`);
  }

  return canonical;
}

export async function bootstrapVisualReferenceAssetRegistry(
  rawInput: BootstrapVisualReferenceAssetRegistryInput,
  dependencies: BootstrapVisualReferenceAssetRegistryDependencies = {},
): Promise<BootstrapVisualReferenceAssetRegistryResult> {
  const parsedInput = BootstrapVisualReferenceAssetRegistryInputSchema.safeParse(rawInput);

  if (!parsedInput.success) {
    blocked(`input is invalid: ${parsedInput.error.message}`);
  }

  const input = parsedInput.data;

  if (input.assetId !== rawInput.assetId) {
    blocked("assetId must not carry leading or trailing whitespace.");
  }

  if (!isAbsolute(input.mediaRoot.trim())) blocked("media root must be absolute.");
  if (!isAbsolute(input.sourceFile)) blocked("source file must be absolute.");

  const mediaRoot = resolve(input.mediaRoot.trim());
  const referencesRoot = resolve(mediaRoot, "references");
  const sourceFile = resolve(input.sourceFile);
  const registryPath = createVisualReferenceAssetRegistryPath(mediaRoot);
  const lockPath = visualReferenceRegistryLockPath(registryPath);
  const verifyDependencies = dependencies.realpath ? { realpath: dependencies.realpath } : {};

  await requireDirectory(mediaRoot, "media root");
  await requireDirectory(referencesRoot, "trusted references root");

  const mediaRootRelativePath = canonicalReferencePath(mediaRoot, referencesRoot, sourceFile);

  await requireRegistryAbsent(registryPath);

  let lock: FileHandle | undefined;
  let lockCreated = false;
  let temporaryPath: string | undefined;

  try {
    try {
      lock = await open(lockPath, "wx");
      lockCreated = true;
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        blocked(
          `visual reference asset registry is locked: ${lockPath}. An existing lock is never removed automatically; investigate and remove it manually only if no writer is running.`,
        );
      }

      throw new Error(`Could not acquire visual reference asset registry lock: ${lockPath}`, { cause: error });
    }

    await lock.writeFile(`pid=${process.pid}\nacquiredAt=${new Date().toISOString()}\noperation=bootstrap\n`, "utf8");
    await lock.sync();

    await requireRegistryAbsent(registryPath);

    // Derive the evidence from the physical file and require the operator's independent expectations.
    let sourceIsFile: boolean;

    try {
      sourceIsFile = (await stat(sourceFile)).isFile();
    } catch (error) {
      if (errorCode(error) === "ENOENT") blocked(`source file does not exist: ${sourceFile}`);
      throw error;
    }

    if (!sourceIsFile) blocked(`source is not a regular file: ${sourceFile}`);

    const sourceBytes = await readFile(sourceFile);

    if (sourceBytes.length !== input.expectedSourceBytes) {
      blocked(`source byte count ${sourceBytes.length} does not equal expected ${input.expectedSourceBytes}.`);
    }

    const sourceSha256 = sha256(sourceBytes);

    if (sourceSha256 !== input.expectedSourceSha256) {
      blocked(`source SHA-256 ${sourceSha256} does not equal expected ${input.expectedSourceSha256}.`);
    }

    const entry = VisualReferenceAssetSchema.parse({
      assetId: input.assetId,
      mediaRootRelativePath,
      bytes: sourceBytes.length,
      sha256: sourceSha256,
      contentType: detectImageContentType(sourceBytes),
    });

    const candidate = VisualReferenceAssetRegistrySchema.parse({ schemaVersion: "1.0", assets: [entry] });

    // One authoritative algorithm: lexical + realpath containment, regular file, size before/after read,
    // SHA-256 and signature, verified against the in-memory candidate before anything becomes durable.
    await verifyApprovedVisualReferenceAsset(
      { mediaRoot, sourceImagePath: sourceFile, approvedAssetIds: [entry.assetId], registry: candidate },
      verifyDependencies,
    );

    const candidateBytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`, "utf8");

    temporaryPath = `${registryPath}.part-${process.pid}-${randomUUID()}`;

    const temporary = await open(temporaryPath, "wx");

    try {
      await temporary.writeFile(candidateBytes);
      await temporary.sync();
    } finally {
      await temporary.close();
    }

    await dependencies.beforePublish?.();

    try {
      await copyFile(temporaryPath, registryPath, constants.COPYFILE_EXCL);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        blocked(`a visual reference registry appeared during bootstrap and was not overwritten: ${registryPath}`);
      }

      throw new Error(
        `Visual reference registry publication failed: ${registryPath}. Inspect it manually before any retry; bootstrap never deletes or overwrites a registry.`,
        { cause: error },
      );
    }

    // Read back through the production reader and confirm the exact candidate was persisted.
    const persistedBytes = await readFile(registryPath);

    if (!persistedBytes.equals(candidateBytes)) {
      throw new Error(`Visual reference registry read-back bytes differ from the published candidate: ${registryPath}`);
    }

    const persisted = await readVisualReferenceAssetRegistry(mediaRoot);

    if (!isDeepStrictEqual(persisted, candidate)) {
      throw new Error(`Visual reference registry read-back differs from the published candidate: ${registryPath}`);
    }

    await verifyApprovedVisualReferenceAsset(
      { mediaRoot, sourceImagePath: sourceFile, approvedAssetIds: [entry.assetId], registry: persisted },
      verifyDependencies,
    );

    return Object.freeze({ registryPath, entry, registry: persisted, registrySha256: sha256(persistedBytes) });
  } finally {
    if (temporaryPath) {
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
