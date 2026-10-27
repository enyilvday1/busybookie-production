import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { attemptHardLink } from "../filesystem/hardLink.js";
import { join } from "node:path";
import {
  interchangeArtifactFileName, interchangeArtifactPath, interchangeArtifactRelativePath, interchangeDirectoryPath, reservedInterchangeTempName,
} from "./editorialInterchangePaths.js";

// Bytes-only E7 persistence adapter. It never derives, validates or interprets interchange content: it publishes
// caller-serialized bytes atomically without ever overwriting, and verifies stored bytes against caller bytes.

export type EditorialInterchangePublishResult =
  | Readonly<{ status: "PUBLISHED"; relativePath: string }>
  | Readonly<{ status: "EXISTS"; relativePath: string }>
  | Readonly<{ status: "STORE_EXISTS_CONFLICT"; detail: string }>
  | Readonly<{ status: "STORED_ARTIFACT_CORRUPT"; detail: string }>
  | Readonly<{ status: "STORE_UNSUPPORTED"; detail: string }>;

export type EditorialInterchangeReadResult =
  | Readonly<{ status: "VERIFIED"; relativePath: string }>
  | Readonly<{ status: "STORED_ARTIFACT_CORRUPT"; detail: string }>;

function errorCode(cause: unknown): string | undefined {
  return typeof cause === "object" && cause !== null ? (cause as { code?: string }).code : undefined;
}

// Same classification as E6 (Step 1106 m1106-2): EEXIST = existing-target validation; only codes that reliably mean the
// no-clobber hard link is unavailable are STORE_UNSUPPORTED; everything else (EPERM, EACCES, EINVAL, EROFS, ENOENT,
// EXDEV, unknown, no code) is operational and propagates. There is no rename/copy fallback.
const UNSUPPORTED_LINK_CODES = new Set(["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EMLINK"]);

export type EditorialInterchangeLinkFailure = "EXISTS" | "STORE_UNSUPPORTED" | "OPERATIONAL";

export function classifyInterchangeLinkFailure(cause: unknown): EditorialInterchangeLinkFailure {
  const code = errorCode(cause);
  if (code === "EEXIST") return "EXISTS";
  return code !== undefined && UNSUPPORTED_LINK_CODES.has(code) ? "STORE_UNSUPPORTED" : "OPERATIONAL";
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // A leftover reserved temporary is never an artifact.
  }
}

type TrustedRead = Readonly<{ ok: true; bytes: Uint8Array }> | Readonly<{ ok: false; detail: string }>;

// One trust invariant for every stored-artifact read (Step 1120 sections 5-6): lstat first; only a regular file that is
// not a symbolic link (Windows junctions/reparse links report as symbolic links) is opened; the opened handle must be
// the same file the lstat saw (dev/ino, defence in depth for n1121-1); the read must be complete. No byte is trusted
// before positive validation and no read ever follows a link to reach success.
async function readTrustedRegularFile(path: string): Promise<TrustedRead> {
  let entry;
  try {
    entry = await lstat(path, { bigint: true });
  } catch (cause) {
    return { ok: false, detail: `lstat failed (${errorCode(cause) ?? "unknown"})` };
  }
  if (entry.isSymbolicLink()) return { ok: false, detail: "final entry is a symbolic link or reparse link" };
  if (!entry.isFile()) return { ok: false, detail: "final entry is not a regular file" };
  let handle;
  try {
    handle = await open(path, "r");
  } catch (cause) {
    return { ok: false, detail: `final entry could not be opened (${errorCode(cause) ?? "unknown"})` };
  }
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== entry.dev || opened.ino !== entry.ino) {
      return { ok: false, detail: "final entry changed between lstat and open" };
    }
    const bytes = new Uint8Array(await handle.readFile());
    if (BigInt(bytes.length) !== opened.size) return { ok: false, detail: "final entry read is incomplete" };
    return { ok: true, bytes };
  } catch (cause) {
    return { ok: false, detail: `final entry could not be read (${errorCode(cause) ?? "unknown"})` };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean => left.length === right.length && left.every((byte, i) => byte === right[i]);

function requireBytes(bytes: unknown): Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error("Editorial interchange store requires artifact bytes.");
  return bytes;
}

// Same-directory reserved temporary (exclusive create), complete write, flush, close, hard link temp -> final (fails
// with EEXIST if the final exists), unlink temp, then best-effort directory flush. The publication primitive is always
// the real node:fs hard link. On EEXIST the existing entry is validated lstat-first: regular + equal bytes = EXISTS,
// regular + different bytes = STORE_EXISTS_CONFLICT, anything else = STORED_ARTIFACT_CORRUPT. Never overwrites.
export async function publishEditorialInterchangeArtifact(input: Readonly<{
  mediaRoot: string; episodeId: string; exportIdentitySha256: string; bytes: Uint8Array;
}>): Promise<EditorialInterchangePublishResult> {
  const bytes = requireBytes(input.bytes);
  const finalPath = interchangeArtifactPath(input.mediaRoot, input.episodeId, input.exportIdentitySha256);
  const relativePath = interchangeArtifactRelativePath(input.episodeId, input.exportIdentitySha256);
  const directoryPath = interchangeDirectoryPath(input.mediaRoot, input.episodeId);
  const finalName = interchangeArtifactFileName(input.episodeId, input.exportIdentitySha256);
  await mkdir(directoryPath, { recursive: true });
  const tempPath = join(directoryPath, reservedInterchangeTempName(finalName, randomBytes(16).toString("hex")));
  const handle = await open(tempPath, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const attempt = await attemptHardLink(tempPath, finalPath);
  if (attempt.status === "FAILED") {
    const cause = attempt.error;
    await removeQuietly(tempPath);
    const failure = classifyInterchangeLinkFailure(cause);
    if (failure === "STORE_UNSUPPORTED") return { status: "STORE_UNSUPPORTED", detail: `hard link unavailable (${errorCode(cause)})` };
    if (failure === "OPERATIONAL") throw cause;
    const existing = await readTrustedRegularFile(finalPath);
    if (!existing.ok) return { status: "STORED_ARTIFACT_CORRUPT", detail: existing.detail };
    return sameBytes(existing.bytes, bytes) ? { status: "EXISTS", relativePath }
      : { status: "STORE_EXISTS_CONFLICT", detail: "a different artifact already exists at the identity path" };
  }
  await removeQuietly(tempPath);
  try {
    const directoryHandle = await open(directoryPath, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch {
    // Directory flush is not supported on every platform (e.g. Windows); publication is already complete.
  }
  return { status: "PUBLISHED", relativePath };
}

// Direct read path: the stored artifact must be a regular non-link file whose bytes equal the caller's fresh
// serialization of the same identity; otherwise STORED_ARTIFACT_CORRUPT (Step 1118 section 15, Step 1120 section 6).
export async function verifyEditorialInterchangeArtifact(input: Readonly<{
  mediaRoot: string; episodeId: string; exportIdentitySha256: string; expectedBytes: Uint8Array;
}>): Promise<EditorialInterchangeReadResult> {
  const expected = requireBytes(input.expectedBytes);
  const finalPath = interchangeArtifactPath(input.mediaRoot, input.episodeId, input.exportIdentitySha256);
  const stored = await readTrustedRegularFile(finalPath);
  if (!stored.ok) return { status: "STORED_ARTIFACT_CORRUPT", detail: stored.detail };
  if (!sameBytes(stored.bytes, expected)) return { status: "STORED_ARTIFACT_CORRUPT", detail: "stored bytes differ from the identity's serialization" };
  return { status: "VERIFIED", relativePath: interchangeArtifactRelativePath(input.episodeId, input.exportIdentitySha256) };
}
