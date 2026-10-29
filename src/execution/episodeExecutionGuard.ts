import type { BoundEpisodePreflight, ControlledEpisodeAutomationPlan } from "./boundEpisodeProduction.types.js";
import { bindingDigest } from "./boundEpisodeProduction.types.js";
import type { buildBoundEpisodePreflight } from "./buildBoundEpisodePreflight.js";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hostname, platform } from "node:os";
import { lstat, mkdir, open, unlink, statfs } from "node:fs/promises";
import { dirname, resolve, parse } from "node:path";
import { z } from "zod";
import { ExecutionReservationEpisodeIdSchema } from "./executionReservation.schema.js";
import { readBoundFile, parseBoundJson, requireLinkSafeContainedPath, verifyEpisodeRuntimeIdentity } from "./episodeInputBinding.js";
import { BoundEpisodeError, requireSameBinding } from "./boundEpisodeProduction.types.js";

const Payload = z.object({ schemaVersion: z.literal("1.0"), episodeId: ExecutionReservationEpisodeIdSchema,
  ownerNonce: z.string().uuid(), processId: z.number().int().positive(), sessionId: z.string().uuid(), hostname: z.string().min(1),
  createdAt: z.iso.datetime(), manifestRawSha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
type OwnedGuard = Readonly<{ mediaRoot: string; path: string; episodeId: string;
  dev: number; ino: number; payload: z.infer<typeof Payload>; active: boolean }>;
// No serializable token can be adopted: only an object minted in this process
// and retained in this private WeakMap is an owner.
export type EpisodeGuardContext = Readonly<{ episodeId: string }>;
const owners = new WeakMap<EpisodeGuardContext, OwnedGuard>();
export function episodeExecutionGuardPath(mediaRoot: string, episodeId: string): string {
  return resolve(mediaRoot, "generated-video", ExecutionReservationEpisodeIdSchema.parse(episodeId), ".episode-execution-guard.json");
}
export async function acquireEpisodeExecutionGuard(input: Readonly<{
  mediaRoot: string; episodeId: string; manifestRawSha256: string; sessionId: string;
}>): Promise<EpisodeGuardContext> {
  const episodeId = ExecutionReservationEpisodeIdSchema.parse(input.episodeId);
  const path = episodeExecutionGuardPath(input.mediaRoot, episodeId);
  const payload = Payload.parse({ schemaVersion: "1.0", episodeId, ownerNonce: randomUUID(), processId: process.pid,
    sessionId: input.sessionId, hostname: hostname(), createdAt: new Date().toISOString(), manifestRawSha256: input.manifestRawSha256 });
  try {
    if (resolve(input.mediaRoot) !== input.mediaRoot) throw new Error("Media-root aliases are unsupported.");
    await requireLinkSafeContainedPath(input.mediaRoot, path, true);
    // Reject remote/unknown filesystems. Windows statfs reports type 0; drive
    // roots must be local (UNC/device paths are refused). Exclusive wx itself
    // is additionally exercised while the newly created handle is held.
    if (/^(\\\\|\/\/)/.test(input.mediaRoot) || input.mediaRoot.includes("\\?\\")) throw new Error("Unsupported guard namespace.");
    let ancestor = dirname(path);
    while (true) {
      try { await lstat(ancestor); break; }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        const parent = dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent;
      }
    }
    const filesystem = await statfs(ancestor);
    // NTFS/local Windows, ext, xfs, btrfs, apfs/hfs; NFS, SMB and unknown
    // non-Windows types are refused rather than treated as a distributed lock.
    let supported = platform() === "win32" ? false
      : [0xef53, 0x58465342, 0x9123683e, 0x4253584e, 0x482b].includes(filesystem.type);
    if (platform() === "win32") {
      const driveRoot = parse(resolve(input.mediaRoot)).root;
      if (!/^[A-Za-z]:\\$/.test(driveRoot)) throw new Error("Unsupported local drive.");
      // Node's Windows statfs type is not a local-drive proof. Query the
      // canonical fixed drive through the built-in DriveInfo authority;
      // mapped network/removable/unknown drives fail closed.
      const result = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `$volume = [IO.DriveInfo]::new('${driveRoot}'); [Console]::Write([string]$volume.DriveType + ':' + $volume.DriveFormat)`],
        { windowsHide: true, timeout: 10000, maxBuffer: 1024 });
      supported = result.stdout === "Fixed:NTFS" || result.stdout === "Fixed:ReFS" || result.stdout === "Fixed:exFAT";
    }
    if (!supported) throw new Error("Unsupported guard filesystem.");
    await mkdir(dirname(path), { recursive: true });
    await requireLinkSafeContainedPath(input.mediaRoot, path, true);
    const handle = await open(path, "wx");
    // Anything after successful exclusive open retains the evidence on failure.
    try {
      let rejectedDuplicate = false;
      try {
        const duplicate = await open(path, "wx");
        await duplicate.close();
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") rejectedDuplicate = true;
        else throw error;
      }
      if (!rejectedDuplicate) throw new Error("Exclusive create is unproven.");
      await handle.writeFile(JSON.stringify(payload) + "\n", "utf8");
      await handle.sync();
      const stats = await handle.stat();
      const context: EpisodeGuardContext = Object.freeze({ episodeId });
      owners.set(context, { mediaRoot: input.mediaRoot, path, episodeId, dev: stats.dev, ino: stats.ino, payload, active: true });
      return context;
    } finally { await handle.close(); }
  } catch (cause) { throw new BoundEpisodeError("EPISODE_OWNERSHIP_CONFLICT", { cause }); }
}
export async function assertEpisodeGuardOwner(context: EpisodeGuardContext, mediaRoot: string, episodeId: string): Promise<void> {
  const owned = owners.get(context);
  if (!owned?.active || owned.episodeId !== episodeId || owned.mediaRoot !== mediaRoot ||
      owned.path !== episodeExecutionGuardPath(mediaRoot, episodeId)) throw new BoundEpisodeError("EPISODE_OWNERSHIP_CONFLICT");
  try {
    const read = await readBoundFile({ root: mediaRoot, canonicalPath: owned.path, role: "GUARD", maxBytes: 8192 });
    if (!read.bytes) throw new Error("Missing owned guard.");
    requireSameBinding(parseBoundJson(read.bytes, value => Payload.parse(value)), owned.payload);
    const stats = await lstat(owned.path);
    if (stats.ino !== owned.ino || stats.dev !== owned.dev) throw new Error("Guard identity changed.");
  } catch (cause) { throw new BoundEpisodeError("EPISODE_OWNERSHIP_CONFLICT", { cause }); }
}
export async function releaseEpisodeExecutionGuard(context: EpisodeGuardContext): Promise<void> {
  const owned = owners.get(context);
  if (!owned?.active) throw new BoundEpisodeError("EPISODE_OWNERSHIP_CONFLICT");
  await assertEpisodeGuardOwner(context, owned.mediaRoot, owned.episodeId);
  try { await unlink(owned.path); owners.set(context, { ...owned, active: false }); }
  catch (cause) { throw new BoundEpisodeError("EPISODE_OWNERSHIP_CONFLICT", { cause }); }
}

export type InvocationContext = Readonly<{ episodeId: string }>;
type Allowance = { limit: 0 | 1; generation: 0 | 1; recovery: 0 | 1; dispatch: boolean };
const invocations = new WeakMap<InvocationContext, Allowance>();
export type FreshEpisodeOperatorSession = Readonly<{ sessionId: string; confirmation: "GENERATION" | "RECONCILIATION" }>;
const freshOperatorSessions = new WeakSet<FreshEpisodeOperatorSession>();
export function createFreshEpisodeOperatorSession(confirmation: "GENERATION" | "RECONCILIATION", literalConfirmation: true): FreshEpisodeOperatorSession {
  if (literalConfirmation !== true || (confirmation !== "GENERATION" && confirmation !== "RECONCILIATION")) {
    throw new BoundEpisodeError("OPERATING_CONDITION_UNESTABLISHED");
  }
  const session = Object.freeze({ sessionId: randomUUID(), confirmation });
  freshOperatorSessions.add(session); return session;
}
export function consumeFreshEpisodeOperatorSession(session: FreshEpisodeOperatorSession | undefined,
  confirmation: "GENERATION" | "RECONCILIATION"): string {
  if (!session || !freshOperatorSessions.has(session) || session.confirmation !== confirmation) throw new BoundEpisodeError("OPERATING_CONDITION_UNESTABLISHED");
  freshOperatorSessions.delete(session); return session.sessionId;
}
export function createEpisodeInvocation(episodeId: string, limit: 0 | 1): InvocationContext {
  const context = Object.freeze({ episodeId: ExecutionReservationEpisodeIdSchema.parse(episodeId) });
  invocations.set(context, { limit, generation: 0, recovery: 0, dispatch: false });
  return context;
}
export function admitEpisodeCoordinatorDispatch(context: InvocationContext): void {
  const state = invocations.get(context);
  if (!state || state.dispatch) throw new BoundEpisodeError("MAX_CREATE_COUNT_REACHED");
  state.dispatch = true;
}
export function consumeEpisodeGenerationAllowance(context: InvocationContext): void {
  const state = invocations.get(context);
  if (!state || state.limit !== 1 || state.generation !== 0 || state.recovery !== 0 || !state.dispatch) throw new BoundEpisodeError("MAX_CREATE_COUNT_REACHED");
  // Synchronous private latch, before any await or paid-capable handoff.
  state.generation = 1;
}
export function consumeEpisodeRecoveryDispatch(context: InvocationContext): void {
  const state = invocations.get(context);
  if (!state || state.limit !== 0 || state.recovery !== 0 || state.generation !== 0 || !state.dispatch) throw new BoundEpisodeError("MAX_CREATE_COUNT_REACHED");
  state.recovery = 1;
}
export function episodeInvocationCounts(context: InvocationContext): Readonly<{ dispatchAllowanceConsumed: 0 | 1; recoveryDispatchCount: 0 | 1 }> {
  const state = invocations.get(context);
  if (!state) throw new BoundEpisodeError("MAX_CREATE_COUNT_REACHED");
  return Object.freeze({ dispatchAllowanceConsumed: state.generation, recoveryDispatchCount: state.recovery });
}

export type CheckedEpisodeExecutionContext = Readonly<{ episodeId: string }>;
export type CheckedEpisodeExecutionData = Readonly<{
  plan: ControlledEpisodeAutomationPlan; beforePlan: BoundEpisodePreflight;
  guard: EpisodeGuardContext; invocation: InvocationContext;
  preflight: typeof buildBoundEpisodePreflight;
  verifyRuntime: typeof verifyEpisodeRuntimeIdentity;
}>;
const checkedContexts = new WeakMap<CheckedEpisodeExecutionContext, CheckedEpisodeExecutionData>();
export async function createCheckedEpisodeExecutionContext(data: CheckedEpisodeExecutionData): Promise<CheckedEpisodeExecutionContext> {
  await assertEpisodeGuardOwner(data.guard, data.plan.inputBinding.runtimeIdentity.mediaRoot, data.plan.episodeId);
  const context = Object.freeze({ episodeId: data.plan.episodeId });
  checkedContexts.set(context, data);
  return context;
}
export function checkedEpisodeExecutionData(context: CheckedEpisodeExecutionContext): CheckedEpisodeExecutionData {
  const data = checkedContexts.get(context);
  if (!data) throw new BoundEpisodeError("OPERATING_CONDITION_UNESTABLISHED");
  return data;
}
export async function readCheckedEpisodeJson<T>(context: CheckedEpisodeExecutionContext, role: string,
  parse: (value: unknown) => T): Promise<T | null> {
  const data = checkedEpisodeExecutionData(context);
  const matches = data.plan.inputBinding.fileBindings.filter(file => file.role === role);
  if (matches.length !== 1) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
  const file = matches[0]!;
  const root = role.startsWith("AUTHORIZATION:") || role === "REFERENCE_REGISTRY"
    ? data.plan.inputBinding.runtimeIdentity.mediaRoot : data.plan.inputBinding.runtimeIdentity.repositoryRoot;
  const read = await readBoundFile({ root, canonicalPath: file.canonicalPath, role, maxBytes: 1048576,
    optional: !file.exists, expected: file });
  return read.bytes === null ? null : parseBoundJson(read.bytes, parse);
}
export async function recheckEpisodeExecutionBindings(context: CheckedEpisodeExecutionContext): Promise<void> {
  const data = checkedEpisodeExecutionData(context);
  const bundle = data.plan.inputBinding;
  await assertEpisodeGuardOwner(data.guard, bundle.runtimeIdentity.mediaRoot, data.plan.episodeId);
  for (const file of [...bundle.fileBindings, ...bundle.runtimeIdentity.executableInputs]) {
    const root = file.role.startsWith("AUTHORIZATION:") || file.role === "REFERENCE_REGISTRY"
      ? bundle.runtimeIdentity.mediaRoot : bundle.runtimeIdentity.repositoryRoot;
    await readBoundFile({ root, canonicalPath: file.canonicalPath, role: file.role, maxBytes: 32 * 1024 * 1024,
      optional: !file.exists, expected: file });
  }
  for (const reference of bundle.referenceBindings) {
    const read = await readBoundFile({ root: bundle.runtimeIdentity.mediaRoot, canonicalPath: reference.canonicalAbsolutePath,
      role: "REFERENCE", maxBytes: reference.bytes + 1 });
    if (read.binding.rawSha256 !== reference.sha256 || read.binding.bytes !== reference.bytes) throw new BoundEpisodeError("REFERENCE_DRIFT");
  }
}

export function assertReviewedEpisodeAction(plan: ControlledEpisodeAutomationPlan, fresh: BoundEpisodePreflight): void {
  if (!fresh.inventory.complete || fresh.bindingSha256 !== plan.inputBindingSha256 || fresh.observationsSha256 !== plan.observationsSha256) {
    throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
  }
  const candidate = fresh.nextActionCandidate;
  const action = plan.actions[0];
  if (!candidate || candidate.kind !== action.kind || candidate.shotId !== action.shotId || candidate.sceneId !== action.sceneId ||
      candidate.order !== action.order || candidate.episodeId !== action.episodeId) throw new BoundEpisodeError("EARLIER_EPISODE_WORK_UNRESOLVED");
  if (action.kind === "VISUAL_GENERATE" && candidate.kind === "VISUAL_GENERATE") {
    requireSameBinding(candidate.referenceBinding, action.referenceBinding);
    if (candidate.provider !== action.resolvedProvider || candidate.cost.unit !== action.costAuthority.unit ||
        candidate.cost.modeledValue !== action.costAuthority.modeledValue || candidate.cost.policySha256 !== action.costAuthority.policySha256 ||
        action.costAuthority.modeledValue > action.costAuthority.maxModeledValue || action.costAuthority.maxModeledValue > candidate.cost.perShotCap) {
      throw new BoundEpisodeError("COST_ADMISSION_BLOCKED");
    }
  } else if (action.kind === "VISUAL_RECONCILE" && candidate.kind === "VISUAL_RECONCILE") {
    const observed = candidate.observation;
    requireSameBinding([action.reservationId, action.durableProvider, action.reservationSha256, action.submissionSha256, action.providerExecutionIdentitySha256],
      [observed.reservationId, observed.durableProvider, observed.reservationSha256, observed.submissionSha256, observed.providerExecutionIdentitySha256]);
  }
}
export async function assertCheckedEpisodeAdmission(context: CheckedEpisodeExecutionContext): Promise<void> {
  const data = checkedEpisodeExecutionData(context);
  await data.verifyRuntime(data.plan.inputBinding.runtimeIdentity, true);
  await recheckEpisodeExecutionBindings(context);
  const fresh = await data.preflight({ episodeId: data.plan.episodeId, scope: data.plan.scope,
    mediaRoot: data.plan.inputBinding.runtimeIdentity.mediaRoot, runtimeIdentity: data.plan.inputBinding.runtimeIdentity,
    expectedBinding: data.plan.inputBinding, evidenceAdoptions: data.plan.evidenceAdoptions,
    ...(data.plan.inputBinding.runtimeIdentity.ffprobe ? { ffprobeExecutable: data.plan.inputBinding.runtimeIdentity.ffprobe.canonicalPath } : {}) });
  assertReviewedEpisodeAction(data.plan, fresh);
  if (bindingDigest(fresh.observations) !== data.plan.observationsSha256) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
}
