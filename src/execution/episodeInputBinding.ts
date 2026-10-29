export { canonicalBindingJson, rawSha256, bindingDigest, freezeBoundCopy, requireSameBinding, assertBindingBundleOrder } from "./boundEpisodeProduction.types.js";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { BoundEpisodeError, rawSha256, requireSameBinding, type FileBinding } from "./boundEpisodeProduction.types.js";
import type { RuntimeIdentity } from "./boundEpisodeProduction.types.js";

export async function requireLinkSafeContainedPath(root: string, candidate: string, allowMissing = false): Promise<string> {
  const canonicalRoot = resolve(root);
  const canonicalPath = resolve(candidate);
  const child = relative(canonicalRoot, canonicalPath);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
  // Reject namespace aliases on the trusted root and every existing component.
  const chain: string[] = [];
  let path = canonicalPath;
  while (true) {
    chain.unshift(path);
    const parent = dirname(path);
    if (parent === path) break;
    path = parent;
  }
  let missing = false;
  for (const component of chain) {
    if (missing) continue;
    try {
      const stats = await lstat(component);
      if (stats.isSymbolicLink()) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
      if (await realpath(component) !== component) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
    } catch (error) {
      if (allowMissing && error instanceof Error && "code" in error && error.code === "ENOENT") missing = true;
      else throw error;
    }
  }
  return canonicalPath;
}
export async function readBoundFile(input: Readonly<{
  root: string; canonicalPath: string; role: string; maxBytes: number; optional?: boolean; expected?: FileBinding;
}>): Promise<Readonly<{ binding: FileBinding; bytes: Buffer | null }>> {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1) throw new TypeError("Invalid bound read limit.");
  const path = await requireLinkSafeContainedPath(input.root, input.canonicalPath, input.optional === true);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    if (input.optional && error instanceof Error && "code" in error && error.code === "ENOENT") {
      const binding: FileBinding = { role: input.role, canonicalPath: path, exists: false, rawSha256: null, bytes: 0 };
      if (input.expected) requireSameBinding(binding, input.expected);
      return Object.freeze({ binding: Object.freeze(binding), bytes: null });
    }
    throw error;
  }
  try {
    const before = await handle.stat();
    const pathBefore = await lstat(path);
    if (!before.isFile() || before.nlink !== 1 || before.size > input.maxBytes ||
        before.ino !== pathBefore.ino || before.dev !== pathBefore.dev) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
    const buffer = Buffer.alloc(Math.min(input.maxBytes + 1, before.size + 1));
    let total = 0;
    while (total < buffer.length) {
      const read = await handle.read(buffer, total, buffer.length - total, total);
      if (read.bytesRead === 0) break;
      total += read.bytesRead;
    }
    const after = await handle.stat();
    await requireLinkSafeContainedPath(input.root, path);
    const pathAfter = await lstat(path);
    if (total !== before.size || after.size !== total || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs || pathAfter.ino !== before.ino || pathAfter.dev !== before.dev ||
        pathAfter.size !== total || pathAfter.nlink !== 1) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
    const bytes = buffer.subarray(0, total);
    const binding: FileBinding = { role: input.role, canonicalPath: path, exists: true, rawSha256: rawSha256(bytes), bytes: total };
    if (input.expected) requireSameBinding(binding, input.expected);
    return Object.freeze({ binding: Object.freeze(binding), bytes });
  } finally { await handle.close(); }
}
export function parseBoundJson<T>(bytes: Buffer, parse: (value: unknown) => T): T {
  const result = parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  function freeze(value: unknown): void {
    if (value !== null && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  }
  freeze(result);
  return result;
}

export async function readEpisodeRuntimeIdentity(repositoryRoot: string, mediaRoot: string,
  ffprobeExecutable?: string): Promise<RuntimeIdentity> {
  const git = async (args: readonly string[]) => (await promisify(execFile)("git", [...args],
    { cwd: repositoryRoot, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })).stdout;
  const reviewedRevision = (await git(["rev-parse", "HEAD"])).trim();
  const root = resolve(repositoryRoot);
  await requireLinkSafeContainedPath(root, root);
  await requireLinkSafeContainedPath(mediaRoot, mediaRoot, true);
  const names = (await git(["ls-files", "-z", "--", "src", "scripts", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"]))
    .split("\0").filter(Boolean).sort();
  // Include untracked executable inputs as well: a clean commit cannot pin
  // an untracked module that the reviewed source could import.
  const untracked = (await git(["ls-files", "--others", "--exclude-standard", "-z", "--", "src", "scripts"]))
    .split("\0").filter(Boolean);
  const executableInputs: FileBinding[] = [];
  for (const name of [...new Set([...names, ...untracked])].sort()) {
    executableInputs.push((await readBoundFile({ root, canonicalPath: resolve(root, name), role: `RUNTIME:${name}`, maxBytes: 32 * 1024 * 1024 })).binding);
  }
  let ffprobe: FileBinding | null = null;
  if (ffprobeExecutable) {
    if (!isAbsolute(ffprobeExecutable)) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
    ffprobe = (await readBoundFile({ root: dirname(ffprobeExecutable), canonicalPath: ffprobeExecutable, role: "FFPROBE", maxBytes: 256 * 1024 * 1024 })).binding;
  }
  return { reviewedRevision, repositoryRoot: root, mediaRoot: resolve(mediaRoot), physicalMediaRoot: resolve(mediaRoot), executableInputs, ffprobe };
}
export async function verifyEpisodeRuntimeIdentity(expected: RuntimeIdentity, requireClean: boolean): Promise<void> {
  if (expected.repositoryRoot !== resolve(process.cwd()) || !process.env.BUSYBOOKIE_MEDIA_ROOT ||
      expected.mediaRoot !== resolve(process.env.BUSYBOOKIE_MEDIA_ROOT)) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
  const current = await readEpisodeRuntimeIdentity(expected.repositoryRoot, expected.mediaRoot, expected.ffprobe?.canonicalPath);
  requireSameBinding(current, expected);
  if (requireClean) {
    try {
      const status = await promisify(execFile)("git", ["status", "--porcelain=v1", "--untracked-files=all", "--",
        "src", "scripts", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"],
        { cwd: expected.repositoryRoot, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
      if (status.stdout.trim()) throw new BoundEpisodeError("OPERATING_CONDITION_UNESTABLISHED");
    } catch (cause) { throw new BoundEpisodeError("OPERATING_CONDITION_UNESTABLISHED", { cause }); }
  }
}
