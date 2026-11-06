import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BoundEpisodeError, type FileBinding } from "../src/execution/boundEpisodeProduction.types.js";
import { createExecutionReservation } from "../src/execution/createExecutionReservation.js";
import {
  acquireEpisodeExecutionGuard,
  createCheckedEpisodeExecutionContext,
  recheckEpisodeExecutionBindings,
  type CheckedEpisodeExecutionContext,
  type CheckedEpisodeExecutionData,
} from "../src/execution/episodeExecutionGuard.js";
import { createExecutionSubmission } from "../src/execution/createExecutionSubmission.js";
import { createVisualAttemptAdmission } from "../src/execution/createVisualAttemptAdmission.js";
import { createVisualAttemptExecutionCompletion } from "../src/execution/createVisualAttemptExecutionCompletion.js";
import { createVisualAttemptExecutionReservation } from "../src/execution/createVisualAttemptExecutionReservation.js";
import { createVisualAttemptExecutionSubmission } from "../src/execution/createVisualAttemptExecutionSubmission.js";
import { createVisualAttemptGenerationRecord } from "../src/execution/createVisualAttemptGenerationRecord.js";
import {
  executeGoogleGenAiOperatorSingleShot,
  executeGoogleGenAiVisualAttemptSingleShot,
  GoogleGenAiOperatorError,
  type GoogleGenAiOperatorErrorCode,
  type GoogleGenAiOperatorPolicies,
  type GoogleGenAiVisualAttemptExecuteDependencies,
  type GoogleGenAiVisualAttemptExecuteRequest,
} from "../src/execution/executeGoogleGenAiOperatorSingleShot.js";
import { createGoogleGenAiProviderExecutionClaimPath } from "../src/execution/googleGenAiProviderExecutionClaimPath.js";
import { inspectExecutionLifecycle } from "../src/execution/inspectExecutionLifecycle.js";
import { inspectVisualAttemptExecutionLifecycle } from "../src/execution/inspectVisualAttemptExecutionLifecycle.js";
import { buildGoogleGenAiSingleShotPrompt } from "../src/execution/providers/buildGoogleGenAiSingleShotPrompt.js";
import { executeRunwaySingleShot } from "../src/execution/providers/executeRunwaySingleShot.js";
import { executeVeoSingleShot } from "../src/execution/providers/executeVeoSingleShot.js";
import { materializeGoogleGenAiSingleShotOutput, type GoogleGenAiOutputRetriever } from "../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js";
import { persistGoogleGenAiSingleShotCompletion } from "../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js";
import {
  GoogleGenAiNewSubmissionsDisabledError,
  submitGoogleGenAiSingleShot,
  submitGoogleGenAiSingleShotFromReservationIdentity,
  type GoogleGenAiSingleShotInteractionRequest,
  type GoogleGenAiSubmissionAcceptance,
} from "../src/execution/providers/submitGoogleGenAiSingleShot.js";
import { reconcileGoogleGenAiExecutionLifecycle } from "../src/execution/reconcileGoogleGenAiExecutionLifecycle.js";
import {
  createVisualAttemptExecutionCompletionPath,
  createVisualAttemptExecutionReservationPath,
  createVisualAttemptExecutionSubmissionPath,
} from "../src/execution/visualAttemptExecutionPaths.js";
import { createVisualAttemptAdmissionPath } from "../src/execution/visualAttemptPaths.js";
import type { CharacterBible } from "../src/schemas/character.schema.js";
import type { EpisodeManifest, Shot } from "../src/schemas/episodeManifest.schema.js";
import type { GoogleGenAiPolicy } from "../src/schemas/googleGenAiPolicy.schema.js";
import type { ProductionRules } from "../src/schemas/productionRules.schema.js";
import { loadCharacterBible } from "../src/validation/loadCharacterBible.js";
import { loadEpisodeManifest } from "../src/validation/loadEpisodeManifest.js";
import { loadGoogleGenAiActivationPolicy, type LoadedGoogleGenAiActivationPolicy } from "../src/validation/loadGoogleGenAiActivationPolicy.js";
import { loadGoogleGenAiPolicy } from "../src/validation/loadGoogleGenAiPolicy.js";
import { loadProductionRules } from "../src/validation/loadProductionRules.js";

// B5 Slice-2H-B (R36E sections 10-15, 19): attempt-mode Google operator and the narrow submitter seam.
// Every media root is a fresh temporary directory; the Google client, credentials and network are synthetic.

// The attempt operator stops at SUBMITTED: recovery, completion and other providers are observed and must stay untouched.
vi.mock("../src/execution/reconcileGoogleGenAiExecutionLifecycle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/reconcileGoogleGenAiExecutionLifecycle.js")>();
  return { ...actual, reconcileGoogleGenAiExecutionLifecycle: vi.fn(actual.reconcileGoogleGenAiExecutionLifecycle) };
});
vi.mock("../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js")>();
  return { ...actual, materializeGoogleGenAiSingleShotOutput: vi.fn(actual.materializeGoogleGenAiSingleShotOutput) };
});
vi.mock("../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js")>();
  return { ...actual, persistGoogleGenAiSingleShotCompletion: vi.fn(actual.persistGoogleGenAiSingleShotCompletion) };
});
vi.mock("../src/execution/createVisualAttemptExecutionCompletion.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/createVisualAttemptExecutionCompletion.js")>();
  return { ...actual, createVisualAttemptExecutionCompletion: vi.fn(actual.createVisualAttemptExecutionCompletion) };
});
vi.mock("../src/execution/createVisualAttemptGenerationRecord.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/createVisualAttemptGenerationRecord.js")>();
  return { ...actual, createVisualAttemptGenerationRecord: vi.fn(actual.createVisualAttemptGenerationRecord) };
});
vi.mock("../src/execution/providers/executeRunwaySingleShot.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/providers/executeRunwaySingleShot.js")>();
  return { ...actual, executeRunwaySingleShot: vi.fn(actual.executeRunwaySingleShot) };
});
vi.mock("../src/execution/providers/executeVeoSingleShot.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/providers/executeVeoSingleShot.js")>();
  return { ...actual, executeVeoSingleShot: vi.fn(actual.executeVeoSingleShot) };
});
// R37D: the real checked-context authority (its private WeakMap included), observed through a passthrough spy.
vi.mock("../src/execution/episodeExecutionGuard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/episodeExecutionGuard.js")>();
  return { ...actual, recheckEpisodeExecutionBindings: vi.fn(actual.recheckEpisodeExecutionBindings) };
});
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(() => {
    throw new Error("The real Google SDK must never be constructed by the attempt operator tests.");
  }),
}));

const INTERACTION_ID = "v1_b5-2hb-synthetic-attempt2-interaction";
const ATTEMPT1_INTERACTION_ID = "v1_b5-2hb-synthetic-attempt1-interaction";
const ADMISSION_ID = "4f7c2a9e-1d3b-4c5a-8e6f-7a8b9c0d1e2f";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("busybookie-b5-2hb", "utf8")]);
const OTHER_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("busybookie-b5-2hb-drift", "utf8")]);
const SECRET_SENTINEL = "SENTINEL-SECRET-b5-2hb";
const MANIFEST_BYTES = Buffer.from(`${JSON.stringify({ episodeId: "EP90", fixture: "b5-2hb-r37d-bound-manifest" })}\n`, "utf8");
const MANIFEST_RAW_SHA256 = createHash("sha256").update(MANIFEST_BYTES).digest("hex");

let baseEpisode: EpisodeManifest;
let bible: CharacterBible;
let rules: ProductionRules;
let committedActivationPolicy: LoadedGoogleGenAiActivationPolicy;
let googlePolicy: GoogleGenAiPolicy;

beforeAll(async () => {
  [baseEpisode, bible, rules, committedActivationPolicy, googlePolicy] = await Promise.all([
    loadEpisodeManifest("EP90"), loadCharacterBible(), loadProductionRules(), loadGoogleGenAiActivationPolicy(), loadGoogleGenAiPolicy(),
  ]);
});

const temporaryDirectories: string[] = [];
beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real network is forbidden in these offline tests."));
});
afterEach(async () => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  for (const spy of [
    reconcileGoogleGenAiExecutionLifecycle, materializeGoogleGenAiSingleShotOutput, persistGoogleGenAiSingleShotCompletion,
    createVisualAttemptExecutionCompletion, createVisualAttemptGenerationRecord, executeRunwaySingleShot, executeVeoSingleShot,
  ]) {
    expect(vi.mocked(spy)).not.toHaveBeenCalled();
  }
  // No production filesystem: every media root used is a fresh temporary directory.
  for (const directory of temporaryDirectories) {
    expect(relative(tmpdir(), directory).startsWith("..")).toBe(false);
    expect(directory).not.toMatch(/Busybookie[\\/]Production/i);
  }
  vi.clearAllMocks();
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const sha256 = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const shotOf = (episode: EpisodeManifest): Shot => episode.scenes[0]!.shots[0]!;
const admittedPrompt = (): string => buildGoogleGenAiSingleShotPrompt(shotOf(baseEpisode));

function enabledPolicies(overrides: Partial<{ activation: LoadedGoogleGenAiActivationPolicy; google: GoogleGenAiPolicy }> = {}): GoogleGenAiOperatorPolicies {
  return {
    activationPolicy: overrides.activation ?? { ...committedActivationPolicy, admission: { newSubmissionsEnabled: true } },
    googlePolicy: overrides.google ?? googlePolicy,
  };
}

function disabledPolicies(): GoogleGenAiOperatorPolicies {
  return {
    activationPolicy: { ...committedActivationPolicy, admission: { newSubmissionsEnabled: false } },
    googlePolicy,
  };
}

function episodeWith(mutate: (shot: Shot, episode: EpisodeManifest) => void = () => undefined): EpisodeManifest {
  const episode = structuredClone(baseEpisode);
  mutate(shotOf(episode), episode);
  return episode;
}

async function realTemporaryDirectory(prefix: string): Promise<string> {
  // The bound-file authority rejects aliased paths, so every root is canonical.
  const directory = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  temporaryDirectories.push(directory);
  return directory;
}

async function mediaRootWithImage(bytes: Uint8Array = PNG): Promise<{ mediaRoot: string; imagePath: string }> {
  const mediaRoot = await realTemporaryDirectory("busybookie-b5-2hb-attempt-");
  const imagePath = join(mediaRoot, "references", "EP90", "S01", "reference.png");
  await mkdir(dirname(imagePath), { recursive: true });
  await writeFile(imagePath, bytes);
  return { mediaRoot, imagePath };
}

type CheckedContextOptions = Partial<{
  episodeId: string;
  planMediaRoot: string;
  fileBindings: (manifest: FileBinding, repositoryRoot: string) => Promise<readonly FileBinding[]> | readonly FileBinding[];
}>;

type IssuedCheckedContext = Readonly<{ context: CheckedEpisodeExecutionContext; manifestPath: string; repositoryRoot: string }>;

/**
 * Mints a REAL checked execution context: the episode guard is acquired through exclusive creation and the
 * context is issued and retained by the private WeakMap authority. Only the plan content is test data: a
 * repository root holding one bound raw MANIFEST file and the media root.
 */
async function issueCheckedContext(mediaRoot: string, options: CheckedContextOptions = {}): Promise<IssuedCheckedContext> {
  const episodeId = options.episodeId ?? "EP90";
  const planMediaRoot = options.planMediaRoot ?? mediaRoot;
  const repositoryRoot = await realTemporaryDirectory("busybookie-b5-2hb-repo-");
  const manifestPath = join(repositoryRoot, "episodes", "EP90", "episode.json");
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, MANIFEST_BYTES);
  const manifest: FileBinding = { role: "MANIFEST", canonicalPath: manifestPath, exists: true, rawSha256: MANIFEST_RAW_SHA256, bytes: MANIFEST_BYTES.byteLength };
  const fileBindings = options.fileBindings ? await options.fileBindings(manifest, repositoryRoot) : [manifest];
  const guard = await acquireEpisodeExecutionGuard({ mediaRoot: planMediaRoot, episodeId, manifestRawSha256: MANIFEST_RAW_SHA256, sessionId: randomUUID() });
  const plan = { episodeId, inputBinding: { fileBindings, referenceBindings: [], runtimeIdentity: { mediaRoot: planMediaRoot, repositoryRoot, executableInputs: [] } } };
  const context = await createCheckedEpisodeExecutionContext({ plan, guard } as unknown as CheckedEpisodeExecutionData);
  return { context, manifestPath, repositoryRoot };
}

type AdmissionOverrides = Partial<{ attemptNumber: number; sceneId: string; provider: "GOOGLE_GENAI" | "RUNWAY" | "VEO"; manifestRawSha256: string; promptIdentitySha256: string; referenceIdentitySha256: string }>;

async function admit(mediaRoot: string, overrides: AdmissionOverrides = {}) {
  const attemptNumber = overrides.attemptNumber ?? 2;
  return createVisualAttemptAdmission(mediaRoot, {
    attemptNumber,
    episodeId: "EP90",
    sceneId: overrides.sceneId ?? baseEpisode.scenes[0]!.id,
    shotId: "S01",
    provider: overrides.provider ?? "GOOGLE_GENAI",
    manifestRawSha256: overrides.manifestRawSha256 ?? MANIFEST_RAW_SHA256,
    promptIdentitySha256: overrides.promptIdentitySha256 ?? sha256(admittedPrompt()),
    referenceIdentitySha256: overrides.referenceIdentitySha256 ?? sha256(PNG),
    previousAttemptNumber: attemptNumber - 1,
    previousAttemptQcSha256: "d".repeat(64),
  }, { now: () => "2026-11-03T10:00:00.000Z", createAdmissionId: () => ADMISSION_ID });
}

function recoveryMetadata(mediaRoot: string) {
  return {
    request: { model: "gemini-omni-1.1-flash" as const, background: true as const, store: true as const, stream: false as const, promptText: "p", sourceImagePath: join(mediaRoot, "references", "EP90", "S01", "reference.png") },
    policySnapshot: googlePolicy,
  };
}

/** Immutable Attempt-1 legacy evidence: a shot-scoped Google COMPLETED lifecycle (reservation, submission, completion, output). */
async function attempt1LegacyCompleted(mediaRoot: string): Promise<void> {
  const reservation = await createExecutionReservation(mediaRoot, { episodeId: "EP90", shotId: "S01", provider: "GOOGLE_GENAI" });
  await createExecutionSubmission(mediaRoot, {
    reservationId: reservation.record.reservationId, episodeId: "EP90", shotId: "S01", provider: "GOOGLE_GENAI",
    providerExecutionId: ATTEMPT1_INTERACTION_ID, recoveryMetadata: recoveryMetadata(mediaRoot),
  });
  const payload = Buffer.from("busybookie-b5-2hb-attempt1-output", "utf8");
  const mdat = Buffer.alloc(8);
  mdat.writeUInt32BE(8 + payload.byteLength, 0);
  mdat.write("mdat", 4, "latin1");
  const video = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom", "latin1"), Buffer.from([0, 0, 2, 0]), Buffer.from("isommp41", "latin1"), mdat, payload]);
  const materializedOutput = await materializeGoogleGenAiSingleShotOutput({ mediaRoot, episodeId: "EP90", shotId: "S01", maxOutputBytes: 4096 }, {
    retrieveOutput: vi.fn<GoogleGenAiOutputRetriever>(async (providerExecutionId) => ({
      id: providerExecutionId, status: "completed", outputVideo: { type: "video", mime_type: "video/mp4", data: video.toString("base64") },
    })),
    downloadUri: async () => { throw new Error("URI downloader must not be called."); },
  });
  await persistGoogleGenAiSingleShotCompletion({ mediaRoot, episodeId: "EP90", shotId: "S01", materializedOutput }, { now: () => "2026-11-01T12:00:00.000Z" });
  // The fixture itself used the legacy completion chain; the operator under test must not.
  vi.mocked(materializeGoogleGenAiSingleShotOutput).mockClear();
  vi.mocked(persistGoogleGenAiSingleShotCompletion).mockClear();
}

async function snapshotTree(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    snapshot[relative(root, path).split(sep).join("/")] = sha256(await readFile(path));
  }
  return snapshot;
}

const rel = (root: string, path: string): string => relative(root, path).split(sep).join("/");

type Harness = Readonly<{
  request: GoogleGenAiVisualAttemptExecuteRequest;
  dependencies: GoogleGenAiVisualAttemptExecuteDependencies;
  checked: IssuedCheckedContext;
  checkedContext: CheckedEpisodeExecutionContext;
  events: string[];
  createInteraction: ReturnType<typeof vi.fn>;
  calls: () => Readonly<{ policies: number; prepare: number; inspect: number; verify: number; reservations: number; creates: number; submissions: number }>;
}>;

async function harness(options: Partial<{
  episode: EpisodeManifest;
  policies: GoogleGenAiOperatorPolicies;
  confirm: unknown;
  attemptNumber: unknown;
  mediaRoot: string;
  imagePath: string;
  admission: AdmissionOverrides | null;
  createInteraction: (request: GoogleGenAiSingleShotInteractionRequest) => Promise<{ id: unknown }>;
  dependencies: Partial<GoogleGenAiVisualAttemptExecuteDependencies>;
  checked: IssuedCheckedContext;
  context: CheckedContextOptions;
}> = {}): Promise<Harness> {
  const created = options.mediaRoot === undefined ? await mediaRootWithImage() : undefined;
  const mediaRoot = options.mediaRoot ?? created!.mediaRoot;
  const imagePath = options.imagePath ?? created!.imagePath;
  if (options.admission !== null && created !== undefined) await admit(mediaRoot, options.admission ?? {});
  const checked = options.checked ?? await issueCheckedContext(mediaRoot, options.context);
  const events: string[] = [];
  const createInteraction = vi.fn(options.createInteraction ?? (async () => ({ id: INTERACTION_ID })));
  const loadPolicies = vi.fn(async () => { events.push("policies"); return options.policies ?? enabledPolicies(); });
  const prepareSubmission = vi.fn(() => {
    events.push("prepare");
    return { createInteraction: async (request: GoogleGenAiSingleShotInteractionRequest) => { events.push("create"); return createInteraction(request); } };
  });
  const inspectVisualAttemptLifecycle = vi.fn(async (...args: Parameters<typeof inspectVisualAttemptExecutionLifecycle>) => { events.push("inspect"); return inspectVisualAttemptExecutionLifecycle(...args); });
  const verifyVisualReference = vi.fn(async () => { events.push("verify"); return { absolutePath: imagePath }; });
  const createVisualAttemptReservation = vi.fn(async (...args: Parameters<typeof createVisualAttemptExecutionReservation>) => { events.push("reservation"); return createVisualAttemptExecutionReservation(...args); });
  const createVisualAttemptSubmission = vi.fn(async (...args: Parameters<typeof createVisualAttemptExecutionSubmission>) => { events.push("submission"); return createVisualAttemptExecutionSubmission(...args); });
  const dependencies: GoogleGenAiVisualAttemptExecuteDependencies = {
    loadPolicies, prepareSubmission, inspectVisualAttemptLifecycle, verifyVisualReference, createVisualAttemptReservation, createVisualAttemptSubmission,
    ...options.dependencies,
  };
  const request = {
    episode: options.episode ?? episodeWith(), shotId: "S01", bible, rules, mediaRoot, sourceImagePath: imagePath, resolution: "720p",
    confirmPaidGeneration: "confirm" in options ? options.confirm : true, attemptNumber: "attemptNumber" in options ? options.attemptNumber : 2,
  } as GoogleGenAiVisualAttemptExecuteRequest;
  return {
    request, dependencies, checked, checkedContext: checked.context, events, createInteraction,
    calls: () => ({
      policies: loadPolicies.mock.calls.length, prepare: prepareSubmission.mock.calls.length, inspect: inspectVisualAttemptLifecycle.mock.calls.length,
      verify: verifyVisualReference.mock.calls.length, reservations: createVisualAttemptReservation.mock.calls.length,
      creates: createInteraction.mock.calls.length, submissions: createVisualAttemptSubmission.mock.calls.length,
    }),
  };
}

async function expectOperatorError(promise: Promise<unknown>, code: GoogleGenAiOperatorErrorCode, stateChange = "NONE"): Promise<GoogleGenAiOperatorError> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(GoogleGenAiOperatorError);
  const operatorError = error as GoogleGenAiOperatorError;
  expect(operatorError.code).toBe(code);
  expect(operatorError.stateChange).toBe(stateChange);
  expect(operatorError.cause).toBeUndefined();
  expect(Object.keys(operatorError).sort()).toEqual(["code", "name", "stage", "stateChange"]);
  expect(operatorError.message).toBe(`Google GenAI operator runner stopped (${code}).`);
  return operatorError;
}

async function attemptState(h: Harness): Promise<string> {
  return (await inspectVisualAttemptExecutionLifecycle(h.request.mediaRoot, "EP90", "S01", 2)).state;
}

/** Refused before the reservation: no attempt reservation, no create, no submission, no claim and no new file at all. */
async function expectRefusedBeforeReservation(h: Harness, code: GoogleGenAiOperatorErrorCode, expectedState = "ADMITTED_ONLY"): Promise<void> {
  const before = await snapshotTree(h.request.mediaRoot);
  await expectOperatorError(executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext), code);
  expect(h.calls()).toMatchObject({ reservations: 0, creates: 0, submissions: 0 });
  expect(await snapshotTree(h.request.mediaRoot)).toEqual(before);
  if (expectedState !== "SKIP") expect(await attemptState(h)).toBe(expectedState);
}

describe("2H-B attempt operator: ADMITTED_ONLY executes to SUBMITTED (A-D)", () => {
  it("reserves once, creates once, persists one attempt submission with exact lineage and stops at SUBMITTED", async () => {
    const h = await harness();
    const admission = await inspectVisualAttemptExecutionLifecycle(h.request.mediaRoot, "EP90", "S01", 2);
    if (admission.state !== "ADMITTED_ONLY") throw new Error("unreachable");
    const before = await snapshotTree(h.request.mediaRoot);

    const result = await executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext);

    expect(Object.isFrozen(result)).toBe(true);
    expect(result).toMatchObject({
      lifecycleState: "SUBMITTED", episodeId: "EP90", sceneId: baseEpisode.scenes[0]!.id, shotId: "S01", attemptNumber: 2,
      provider: "GOOGLE_GENAI", model: "gemini-omni-1.1-flash", resolution: "720p", expectedMicroUsd: 1_513_600, maxExpectedCostMicroUsd: 2_000_000,
      admissionId: ADMISSION_ID, admissionSha256: admission.admission.admissionSha256, providerExecutionId: INTERACTION_ID,
    });
    expect(h.events).toEqual(["policies", "prepare", "inspect", "verify", "reservation", "create", "submission"]);
    expect(h.calls()).toEqual({ policies: 1, prepare: 1, inspect: 1, verify: 1, reservations: 1, creates: 1, submissions: 1 });

    // Durable lineage is exact: admission -> reservation -> submission.
    const lifecycle = await inspectVisualAttemptExecutionLifecycle(h.request.mediaRoot, "EP90", "S01", 2);
    expect(lifecycle.state).toBe("SUBMITTED");
    if (lifecycle.state !== "SUBMITTED") throw new Error("unreachable");
    expect(lifecycle.reservation.record).toMatchObject({ admissionId: ADMISSION_ID, admissionSha256: admission.admission.admissionSha256, attemptNumber: 2, provider: "GOOGLE_GENAI" });
    expect(lifecycle.reservation.reservationSha256).toBe(result.reservationSha256);
    expect(lifecycle.submission.record).toMatchObject({
      reservationId: result.reservationId, reservationSha256: result.reservationSha256, admissionId: ADMISSION_ID,
      admissionSha256: admission.admission.admissionSha256, episodeId: "EP90", sceneId: baseEpisode.scenes[0]!.id, shotId: "S01",
      attemptNumber: 2, provider: "GOOGLE_GENAI", providerExecutionId: INTERACTION_ID,
    });
    expect(lifecycle.submission.submissionSha256).toBe(result.submissionSha256);
    expect(sha256(await readFile(result.submissionPath))).toBe(result.submissionSha256);

    // Exactly three new files: attempt reservation, global claim, attempt submission. No completion, no legacy record.
    const written = Object.keys(await snapshotTree(h.request.mediaRoot)).filter((file) => !(file in before)).sort();
    expect(written).toEqual([
      rel(h.request.mediaRoot, createGoogleGenAiProviderExecutionClaimPath(h.request.mediaRoot, INTERACTION_ID)),
      rel(h.request.mediaRoot, createVisualAttemptExecutionReservationPath(h.request.mediaRoot, "EP90", "S01", 2)),
      rel(h.request.mediaRoot, createVisualAttemptExecutionSubmissionPath(h.request.mediaRoot, "EP90", "S01", 2)),
    ].sort());
    expect(written).not.toContain(rel(h.request.mediaRoot, createVisualAttemptExecutionCompletionPath(h.request.mediaRoot, "EP90", "S01", 2)));
    expect(await inspectExecutionLifecycle(h.request.mediaRoot, "EP90", "S01")).toEqual({ state: "NOTHING" });

    // The irreversible request carries exactly the admitted prompt and reference identities.
    const [interactionRequest] = h.createInteraction.mock.calls[0]! as [GoogleGenAiSingleShotInteractionRequest];
    expect(interactionRequest.input[0]).toEqual({ type: "text", text: admittedPrompt() });
    expect(sha256(interactionRequest.input[0].text)).toBe(admission.admission.record.promptIdentitySha256);
    expect(interactionRequest.input[1]).toMatchObject({ type: "image", mime_type: "image/png", data: PNG.toString("base64") });
    expect(sha256(Buffer.from(interactionRequest.input[1].data, "base64"))).toBe(admission.admission.record.referenceIdentitySha256);
    expect(interactionRequest.response_format).toEqual({ type: "video", delivery: "uri", resolution: "720p" });
  });

  it("returns SUBMITTED only after the durable attempt submission: the attempt is RESERVED_ONLY while the writer runs", async () => {
    const observed: string[] = [];
    const h = await harness({
      dependencies: {
        createVisualAttemptSubmission: vi.fn(async (...args: Parameters<typeof createVisualAttemptExecutionSubmission>) => {
          observed.push((await inspectVisualAttemptExecutionLifecycle(args[0], "EP90", "S01", 2)).state);
          const written = await createVisualAttemptExecutionSubmission(...args);
          observed.push((await inspectVisualAttemptExecutionLifecycle(args[0], "EP90", "S01", 2)).state);
          return written;
        }),
      },
    });
    await executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext);
    expect(observed).toEqual(["RESERVED_ONLY", "SUBMITTED"]);
  });

  it("takes the providerExecutionId only from the provider acceptance", async () => {
    const h = await harness({ createInteraction: async () => ({ id: "v1_provider-assigned-only" }) });
    const result = await executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext);
    expect(result.providerExecutionId).toBe("v1_provider-assigned-only");
    const submission = vi.mocked(h.dependencies.createVisualAttemptSubmission).mock.calls[0]![1];
    expect(submission.providerExecutionId).toBe("v1_provider-assigned-only");
    expect(JSON.parse(await readFile(result.submissionPath, "utf8"))).toMatchObject({ providerExecutionId: "v1_provider-assigned-only" });
  });

  it("passes only durable lineage to the attempt writers", async () => {
    const h = await harness();
    const result = await executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext);
    const admission = await inspectVisualAttemptExecutionLifecycle(h.request.mediaRoot, "EP90", "S01", 2);
    if (admission.state !== "SUBMITTED") throw new Error("unreachable");
    expect(vi.mocked(h.dependencies.createVisualAttemptReservation).mock.calls[0]![1]).toEqual({
      episodeId: "EP90", sceneId: baseEpisode.scenes[0]!.id, shotId: "S01", attemptNumber: 2, provider: "GOOGLE_GENAI",
      expectedAdmissionId: ADMISSION_ID, expectedAdmissionSha256: admission.admission.admissionSha256,
    });
    expect(vi.mocked(h.dependencies.createVisualAttemptSubmission).mock.calls[0]![1]).toMatchObject({
      episodeId: "EP90", sceneId: baseEpisode.scenes[0]!.id, shotId: "S01", attemptNumber: 2,
      expectedAdmissionId: ADMISSION_ID, expectedAdmissionSha256: admission.admission.admissionSha256,
      expectedReservationId: result.reservationId, expectedReservationSha256: result.reservationSha256, providerExecutionId: INTERACTION_ID,
    });
  });
});

describe("2H-B attempt operator: request surface", () => {
  it.each([1, 0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "2", null, undefined])("refuses attemptNumber %s before any policy, credential or durable read", async (attemptNumber) => {
    const h = await harness({ attemptNumber });
    const request = attemptNumber === undefined ? (({ attemptNumber: _omitted, ...rest }) => rest)(h.request) as GoogleGenAiVisualAttemptExecuteRequest : h.request;
    const before = await snapshotTree(h.request.mediaRoot);
    const error = await expectOperatorError(executeGoogleGenAiVisualAttemptSingleShot(request, h.dependencies, h.checkedContext), "USAGE_INVALID");
    expect(error.stage).toBe("ARGS");
    expect(h.calls()).toEqual({ policies: 0, prepare: 0, inspect: 0, verify: 0, reservations: 0, creates: 0, submissions: 0 });
    expect(await snapshotTree(h.request.mediaRoot)).toEqual(before);
  });

  it.each(["admissionId", "admissionSha256", "reservationId", "reservationSha256", "providerExecutionId", "submissionPath", "submissionSha256"])("refuses caller-supplied lineage field %s", async (field) => {
    const h = await harness();
    const request = { ...h.request, [field]: field.endsWith("Sha256") ? "f".repeat(64) : ADMISSION_ID } as unknown as GoogleGenAiVisualAttemptExecuteRequest;
    await expectOperatorError(executeGoogleGenAiVisualAttemptSingleShot(request, h.dependencies, h.checkedContext), "USAGE_INVALID");
    expect(h.calls()).toMatchObject({ policies: 0, reservations: 0, creates: 0 });
    expect(await attemptState(h)).toBe("ADMITTED_ONLY");
  });
});

describe("2H-B attempt operator: activation and paid confirmation (M, N)", () => {
  it("refuses with an explicit disabled policy before any credential, lifecycle, reservation or create", async () => {
    expect(disabledPolicies().activationPolicy.admission.newSubmissionsEnabled).toBe(false);
    const h = await harness({ policies: disabledPolicies() });
    await expectRefusedBeforeReservation(h, "NEW_SUBMISSIONS_DISABLED");
    expect(h.events).toEqual(["policies"]);
    expect(h.calls()).toMatchObject({ prepare: 0, inspect: 0 });
  });

  it.each([false, "true", 1, undefined])("refuses without explicit paid-generation confirmation (%s) before credentials", async (confirm) => {
    const h = await harness({ confirm });
    await expectRefusedBeforeReservation(h, "CONFIRMATION_REQUIRED");
    expect(h.calls()).toMatchObject({ prepare: 0, inspect: 0 });
  });

  it("refuses a malformed credential without leaking it, before the lifecycle read", async () => {
    const h = await harness({ dependencies: { prepareSubmission: vi.fn(() => { throw new Error(`invalid key ${SECRET_SENTINEL}`); }) } });
    const error = await expectOperatorError(executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext), "CREDENTIAL_INVALID");
    expect(JSON.stringify({ ...error, message: error.message, stack: error.stack })).not.toContain(SECRET_SENTINEL);
    expect(h.calls()).toMatchObject({ inspect: 0, reservations: 0, creates: 0 });
  });

  it("keeps the shared local admission: an unapproved shot is refused before the lifecycle read", async () => {
    const h = await harness({ episode: episodeWith((shot) => { shot.generation = { ...shot.generation, status: "READY_FOR_APPROVAL" }; }) });
    await expectRefusedBeforeReservation(h, "SHOT_STATUS_NOT_APPROVED");
    expect(h.calls().inspect).toBe(0);
  });
});

describe("2H-B attempt operator: the attempt lifecycle authority (E-I)", () => {
  it("E: NOT_ADMITTED refuses with zero provider creates", async () => {
    const h = await harness({ admission: null });
    await expectRefusedBeforeReservation(h, "NO_LIFECYCLE", "NOT_ADMITTED");
  });

  it("F: RESERVED_ONLY refuses with zero provider creates and never infers a missing submission", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const admission = await admit(mediaRoot);
    await createVisualAttemptExecutionReservation(mediaRoot, {
      episodeId: "EP90", sceneId: admission.record.sceneId, shotId: "S01", attemptNumber: 2, provider: "GOOGLE_GENAI",
      expectedAdmissionId: ADMISSION_ID, expectedAdmissionSha256: admission.admissionSha256,
    });
    const h = await harness({ mediaRoot, imagePath });
    await expectRefusedBeforeReservation(h, "LIFECYCLE_EXISTS", "RESERVED_ONLY");
    expect(h.calls().verify).toBe(0);
  });

  it("G: SUBMITTED refuses with zero provider creates", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const admission = await admit(mediaRoot);
    const reservation = await createVisualAttemptExecutionReservation(mediaRoot, {
      episodeId: "EP90", sceneId: admission.record.sceneId, shotId: "S01", attemptNumber: 2, provider: "GOOGLE_GENAI",
      expectedAdmissionId: ADMISSION_ID, expectedAdmissionSha256: admission.admissionSha256,
    });
    await createVisualAttemptExecutionSubmission(mediaRoot, {
      episodeId: "EP90", sceneId: admission.record.sceneId, shotId: "S01", attemptNumber: 2,
      expectedAdmissionId: ADMISSION_ID, expectedAdmissionSha256: admission.admissionSha256,
      expectedReservationId: reservation.record.reservationId, expectedReservationSha256: reservation.reservationSha256,
      providerExecutionId: "v1_previous-attempt2-interaction", recoveryMetadata: recoveryMetadata(mediaRoot),
    });
    const h = await harness({ mediaRoot, imagePath });
    await expectRefusedBeforeReservation(h, "LIFECYCLE_EXISTS", "SUBMITTED");
  });

  it("H: COMPLETED refuses with zero provider creates", async () => {
    const h = await harness({
      dependencies: { inspectVisualAttemptLifecycle: vi.fn(async () => ({ state: "COMPLETED" }) as unknown as Awaited<ReturnType<typeof inspectVisualAttemptExecutionLifecycle>>) },
    });
    await expectRefusedBeforeReservation(h, "LIFECYCLE_EXISTS");
  });

  it("refuses an unknown lifecycle state from the authority", async () => {
    const h = await harness({
      dependencies: { inspectVisualAttemptLifecycle: vi.fn(async () => ({ state: "RECONCILING" }) as unknown as Awaited<ReturnType<typeof inspectVisualAttemptExecutionLifecycle>>) },
    });
    await expectRefusedBeforeReservation(h, "LIFECYCLE_INVALID");
  });

  it("refuses malformed admission evidence as unreadable", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const path = createVisualAttemptAdmissionPath(mediaRoot, "EP90", "S01", 2);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{ corrupt");
    const h = await harness({ mediaRoot, imagePath });
    await expectRefusedBeforeReservation(h, "LIFECYCLE_UNREADABLE", "SKIP");
  });

  it("refuses ambiguous evidence: an attempt reservation without its durable admission", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const path = createVisualAttemptExecutionReservationPath(mediaRoot, "EP90", "S01", 2);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{}");
    const h = await harness({ mediaRoot, imagePath });
    await expectRefusedBeforeReservation(h, "LIFECYCLE_UNREADABLE", "SKIP");
  });

  it("refuses a non-Google admission (provider binding) with zero provider creates", async () => {
    const h = await harness({ admission: { provider: "RUNWAY" } });
    await expectRefusedBeforeReservation(h, "LIFECYCLE_UNREADABLE", "SKIP");
  });

  it("I: leaves Attempt-1 legacy COMPLETED evidence byte-identical and never consults the legacy lifecycle", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    await attempt1LegacyCompleted(mediaRoot);
    expect((await inspectExecutionLifecycle(mediaRoot, "EP90", "S01")).state).toBe("COMPLETED");
    await admit(mediaRoot);
    const h = await harness({ mediaRoot, imagePath });
    const before = await snapshotTree(mediaRoot);

    await executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext);

    const after = await snapshotTree(mediaRoot);
    for (const [file, digest] of Object.entries(before)) expect(after[file], file).toBe(digest);
    expect(Object.keys(after).filter((file) => !(file in before))).toHaveLength(3);
    expect((await inspectExecutionLifecycle(mediaRoot, "EP90", "S01")).state).toBe("COMPLETED");
    expect(await attemptState(h)).toBe("SUBMITTED");
  });
});

describe("2H-B attempt operator: identity binding before reservation (J-L)", () => {
  it("J: refuses a durable prompt identity that is not the effective prompt", async () => {
    const h = await harness({ admission: { promptIdentitySha256: sha256(`${admittedPrompt()} `) } });
    await expectRefusedBeforeReservation(h, "PROMPT_INVALID");
    expect(h.calls().verify).toBe(0);
  });

  it("J: refuses a manifest prompt edited after admission", async () => {
    const h = await harness({ episode: episodeWith((shot) => { shot.visualAction = `${shot.visualAction} Edited after admission.`; }) });
    await expectRefusedBeforeReservation(h, "PROMPT_INVALID");
  });

  it("K: refuses reference bytes that are not the admitted reference identity", async () => {
    const h = await harness({ admission: { referenceIdentitySha256: sha256(OTHER_PNG) } });
    await expectRefusedBeforeReservation(h, "REFERENCE_IMAGE_REJECTED");
    expect(h.calls().verify).toBe(1);
  });

  it("K: refuses reference bytes swapped between verification and the create, with zero provider creates", async () => {
    const h = await harness({
      dependencies: {
        createVisualAttemptReservation: vi.fn(async (...args: Parameters<typeof createVisualAttemptExecutionReservation>) => {
          const reservation = await createVisualAttemptExecutionReservation(...args);
          await writeFile(join(args[0], "references", "EP90", "S01", "reference.png"), OTHER_PNG);
          return reservation;
        }),
      },
    });
    await expectOperatorError(executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext), "SUBMISSION_REFUSED_BEFORE_PROVIDER_CALL", "RESERVED_ONLY");
    expect(h.createInteraction).not.toHaveBeenCalled();
    expect(await attemptState(h)).toBe("RESERVED_ONLY");
  });

  it("L: refuses an admission bound to another scene", async () => {
    const h = await harness({ admission: { sceneId: "SC99" } });
    await expectRefusedBeforeReservation(h, "LIFECYCLE_INVALID");
  });

  it.each([
    ["episode", { episodeId: "EP91" }],
    ["scene", { sceneId: "SC99" }],
    ["shot", { shotId: "S02" }],
    ["attempt", { attemptNumber: 3 }],
    ["provider", { provider: "VEO" }],
  ])("L: refuses an authority result whose %s does not match the request", async (_label, mismatch) => {
    const h = await harness({
      dependencies: {
        inspectVisualAttemptLifecycle: vi.fn(async (...args: Parameters<typeof inspectVisualAttemptExecutionLifecycle>) => {
          const lifecycle = await inspectVisualAttemptExecutionLifecycle(...args);
          return { ...lifecycle, ...mismatch } as Awaited<ReturnType<typeof inspectVisualAttemptExecutionLifecycle>>;
        }),
      },
    });
    await expectRefusedBeforeReservation(h, "LIFECYCLE_INVALID");
  });
});

describe("2H-B attempt operator: failures after the reservation never retry (O-R)", () => {
  it("maps a reservation write failure to RESERVATION_FAILED with zero creates", async () => {
    const h = await harness({ dependencies: { createVisualAttemptReservation: vi.fn(async () => { throw new Error("Visual attempt reservation already exists"); }) } });
    await expectOperatorError(executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext), "RESERVATION_FAILED", "UNKNOWN");
    expect(h.createInteraction).not.toHaveBeenCalled();
  });

  it("loses a concurrent reservation race (real exclusive create) with zero creates", async () => {
    const h = await harness({
      dependencies: {
        verifyVisualReference: vi.fn(async () => {
          const admission = await inspectVisualAttemptExecutionLifecycle(h.request.mediaRoot, "EP90", "S01", 2);
          if (admission.state !== "ADMITTED_ONLY") throw new Error("unreachable");
          await createVisualAttemptExecutionReservation(h.request.mediaRoot, {
            episodeId: "EP90", sceneId: admission.sceneId, shotId: "S01", attemptNumber: 2, provider: "GOOGLE_GENAI",
            expectedAdmissionId: ADMISSION_ID, expectedAdmissionSha256: admission.admission.admissionSha256,
          });
          return { absolutePath: h.request.sourceImagePath };
        }),
      },
    });
    await expectOperatorError(executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext), "RESERVATION_FAILED", "UNKNOWN");
    expect(h.createInteraction).not.toHaveBeenCalled();
    expect(await attemptState(h)).toBe("RESERVED_ONLY");
  });

  it("O: a hostile provider create failure is acceptance-uncertain after exactly one create, leaks nothing and is never retried", async () => {
    const hostile = Object.assign(new Error(`SDK failure ${SECRET_SENTINEL}`, { cause: new Error(`cause ${SECRET_SENTINEL}`) }), {
      providerBody: SECRET_SENTINEL, headers: { authorization: `Bearer ${SECRET_SENTINEL}` },
    });
    const h = await harness({ createInteraction: async () => { throw hostile; } });
    const error = await expectOperatorError(executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext), "SUBMISSION_ACCEPTANCE_UNCERTAIN", "RESERVED_ONLY");
    expect(h.createInteraction).toHaveBeenCalledTimes(1);
    expect(h.calls().submissions).toBe(0);
    expect(JSON.stringify({ ...error, message: error.message, stack: error.stack })).not.toContain(SECRET_SENTINEL);
    expect(await attemptState(h)).toBe("RESERVED_ONLY");

    const rerun = await harness({ mediaRoot: h.request.mediaRoot, imagePath: h.request.sourceImagePath, checked: h.checked });
    await expectOperatorError(executeGoogleGenAiVisualAttemptSingleShot(rerun.request, rerun.dependencies, rerun.checkedContext), "LIFECYCLE_EXISTS");
    expect(h.createInteraction.mock.calls.length + rerun.createInteraction.mock.calls.length).toBe(1);
  });

  it.each([" ", "", 42, null])("P: an invalid Interaction.id (%j) is acceptance-uncertain, unclaimed and never retried", async (id) => {
    const h = await harness({ createInteraction: async () => ({ id }) });
    await expectOperatorError(executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext), "SUBMISSION_ACCEPTANCE_UNCERTAIN", "RESERVED_ONLY");
    expect(h.createInteraction).toHaveBeenCalledTimes(1);
    expect(h.calls().submissions).toBe(0);
    expect(Object.keys(await snapshotTree(h.request.mediaRoot)).some((file) => file.includes(".google-genai-provider-execution-id-claims"))).toBe(false);
    expect(await attemptState(h)).toBe("RESERVED_ONLY");
  });

  it("Q: a providerExecutionId already owned by Attempt-1 is a durable-submission failure, never a second owner or a retry", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    await attempt1LegacyCompleted(mediaRoot);
    await admit(mediaRoot);
    const claimPath = createGoogleGenAiProviderExecutionClaimPath(mediaRoot, ATTEMPT1_INTERACTION_ID);
    const h = await harness({ mediaRoot, imagePath, createInteraction: async () => ({ id: ATTEMPT1_INTERACTION_ID }) });
    const before = await snapshotTree(mediaRoot);
    expect(before[rel(mediaRoot, claimPath)]).toBeDefined();

    await expectOperatorError(executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext), "DURABLE_SUBMISSION_FAILED", "UNKNOWN");

    expect(h.createInteraction).toHaveBeenCalledTimes(1);
    expect(h.calls().submissions).toBe(1);
    const after = await snapshotTree(mediaRoot);
    for (const [file, digest] of Object.entries(before)) expect(after[file], file).toBe(digest);
    expect(Object.keys(after).filter((file) => !(file in before))).toEqual([rel(mediaRoot, createVisualAttemptExecutionReservationPath(mediaRoot, "EP90", "S01", 2))]);
    expect(await attemptState(h)).toBe("RESERVED_ONLY");
    expect((await inspectExecutionLifecycle(mediaRoot, "EP90", "S01")).state).toBe("COMPLETED");
  });

  it("R: a durable attempt submission failure after acceptance is never retried, and a rerun creates nothing", async () => {
    const h = await harness({ dependencies: { createVisualAttemptSubmission: vi.fn(async () => { throw new Error(`disk ${SECRET_SENTINEL}`); }) } });
    const error = await expectOperatorError(executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext), "DURABLE_SUBMISSION_FAILED", "UNKNOWN");
    expect(h.createInteraction).toHaveBeenCalledTimes(1);
    expect(error.message).not.toContain(SECRET_SENTINEL);
    expect(await attemptState(h)).toBe("RESERVED_ONLY");

    const rerun = await harness({ mediaRoot: h.request.mediaRoot, imagePath: h.request.sourceImagePath, checked: h.checked });
    await expectOperatorError(executeGoogleGenAiVisualAttemptSingleShot(rerun.request, rerun.dependencies, rerun.checkedContext), "LIFECYCLE_EXISTS");
    expect(rerun.createInteraction).not.toHaveBeenCalled();
  });

  it("R: a publication failure after the claim keeps the claim and the reservation (never deleted), with one create", async () => {
    const h = await harness({
      dependencies: {
        createVisualAttemptReservation: vi.fn(async (...args: Parameters<typeof createVisualAttemptExecutionReservation>) => {
          const reservation = await createVisualAttemptExecutionReservation(...args);
          // Occupy the final submission path so the create-once publication fails after the claim is acquired.
          await mkdir(createVisualAttemptExecutionSubmissionPath(args[0], "EP90", "S01", 2), { recursive: true });
          return reservation;
        }),
      },
    });
    await expectOperatorError(executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext), "DURABLE_SUBMISSION_FAILED", "UNKNOWN");
    expect(h.createInteraction).toHaveBeenCalledTimes(1);
    const claim = JSON.parse(await readFile(createGoogleGenAiProviderExecutionClaimPath(h.request.mediaRoot, INTERACTION_ID), "utf8"));
    expect(claim).toMatchObject({ lifecycleMode: "VISUAL_ATTEMPT", providerExecutionId: INTERACTION_ID, attemptNumber: 2, admissionId: ADMISSION_ID });
    expect(JSON.parse(await readFile(createVisualAttemptExecutionReservationPath(h.request.mediaRoot, "EP90", "S01", 2), "utf8"))).toMatchObject({ reservationId: claim.reservationId });
  });

  it("rejects a durable writer result whose lineage does not match the attempt (fail closed, no retry)", async () => {
    const h = await harness({
      dependencies: {
        createVisualAttemptSubmission: vi.fn(async (...args: Parameters<typeof createVisualAttemptExecutionSubmission>) => {
          const written = await createVisualAttemptExecutionSubmission(...args);
          return { ...written, record: { ...written.record, admissionSha256: "0".repeat(64) } };
        }),
      },
    });
    await expectOperatorError(executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext), "DURABLE_SUBMISSION_FAILED", "UNKNOWN");
    expect(h.createInteraction).toHaveBeenCalledTimes(1);
  });
});

async function expectBoundRefusal(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(BoundEpisodeError);
  expect((error as BoundEpisodeError).code).toBe(code);
}

/** Refused by the checked-context manifest gate: no reservation, create, submission, claim or other new file. */
async function expectManifestGateRefusal(h: Harness, code: string, forged: Readonly<{ context: CheckedEpisodeExecutionContext }> | null = null): Promise<void> {
  const context = forged === null ? h.checkedContext : forged.context;
  const before = await snapshotTree(h.request.mediaRoot);
  await expectBoundRefusal(executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, context), code);
  expect(h.calls()).toMatchObject({ reservations: 0, creates: 0, submissions: 0 });
  expect(await snapshotTree(h.request.mediaRoot)).toEqual(before);
  expect(await attemptState(h)).toBe("ADMITTED_ONLY");
}

describe("2H-B R37D: the checked execution context binds the admitted raw manifest", () => {
  it("1/12: a real checked context with the admitted manifest runs ADMITTED_ONLY -> SUBMITTED, rechecking before the reservation and before the create", async () => {
    const h = await harness();
    vi.mocked(recheckEpisodeExecutionBindings).mockClear();

    const result = await executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext);

    expect(result).toMatchObject({ lifecycleState: "SUBMITTED", providerExecutionId: INTERACTION_ID });
    expect(h.calls()).toMatchObject({ reservations: 1, creates: 1, submissions: 1 });
    expect(await attemptState(h)).toBe("SUBMITTED");
    const recheck = vi.mocked(recheckEpisodeExecutionBindings).mock;
    expect(recheck.calls).toEqual([[h.checkedContext], [h.checkedContext]]);
    const reservedAt = vi.mocked(h.dependencies.createVisualAttemptReservation).mock.invocationCallOrder[0]!;
    const createdAt = h.createInteraction.mock.invocationCallOrder[0]!;
    expect(recheck.invocationCallOrder[0]!).toBeLessThan(reservedAt);
    expect(reservedAt).toBeLessThan(recheck.invocationCallOrder[1]!);
    expect(recheck.invocationCallOrder[1]!).toBeLessThan(createdAt);
  });

  it.each([
    ["a fabricated context object", () => Object.freeze({ episodeId: "EP90" }) as CheckedEpisodeExecutionContext],
    ["a missing context", () => undefined as unknown as CheckedEpisodeExecutionContext],
  ])("2: refuses %s through the existing authority before policies, reservation or create", async (_label, forge) => {
    const h = await harness();
    await expectManifestGateRefusal(h, "OPERATING_CONDITION_UNESTABLISHED", { context: forge() });
    expect(h.calls()).toMatchObject({ policies: 0, prepare: 0, inspect: 0 });
  });

  it("3: refuses a checked context issued for another episode", async () => {
    const h = await harness({ context: { episodeId: "EP91" } });
    await expectManifestGateRefusal(h, "INPUT_BINDING_DRIFT");
    expect(h.calls()).toMatchObject({ policies: 0, inspect: 0 });
  });

  it("4: refuses a checked context issued for another media root", async () => {
    const other = await realTemporaryDirectory("busybookie-b5-2hb-other-media-");
    const h = await harness({ context: { planMediaRoot: other } });
    await expectManifestGateRefusal(h, "INPUT_BINDING_DRIFT");
    expect(h.calls()).toMatchObject({ policies: 0, inspect: 0 });
  });

  it.each([
    ["no bound file at all", () => []],
    ["only a non-MANIFEST role", (manifest: FileBinding) => [{ ...manifest, role: "EPISODE_MANIFEST" }]],
  ])("5: refuses a missing MANIFEST binding (%s)", async (_label, bindings) => {
    const h = await harness({ context: { fileBindings: bindings } });
    await expectManifestGateRefusal(h, "INPUT_BINDING_DRIFT");
    expect(h.calls()).toMatchObject({ inspect: 1, verify: 1 });
  });

  it("6: refuses more than one MANIFEST binding", async () => {
    const h = await harness({
      context: {
        fileBindings: async (manifest, repositoryRoot) => {
          const copy = join(repositoryRoot, "episodes", "EP90", "episode-copy.json");
          await writeFile(copy, MANIFEST_BYTES);
          return [manifest, { ...manifest, canonicalPath: copy }];
        },
      },
    });
    await expectManifestGateRefusal(h, "INPUT_BINDING_DRIFT");
  });

  it.each([
    ["an absent bound file with a null raw SHA", (manifest: FileBinding, repositoryRoot: string) => [{ ...manifest, canonicalPath: join(repositoryRoot, "episodes", "EP90", "missing.json"), exists: false, rawSha256: null, bytes: 0 }]],
    ["an existing file bound with a null raw SHA", (manifest: FileBinding) => [{ ...manifest, rawSha256: null }]],
    ["an existing file bound with a malformed raw SHA", (manifest: FileBinding) => [{ ...manifest, rawSha256: MANIFEST_RAW_SHA256.toUpperCase() }]],
  ])("7: refuses a MANIFEST binding with %s", async (_label, bindings) => {
    const h = await harness({ context: { fileBindings: bindings } });
    await expectManifestGateRefusal(h, "INPUT_BINDING_DRIFT");
  });

  it("8: refuses a bound manifest whose raw SHA is not the admission manifestRawSha256", async () => {
    const h = await harness({ admission: { manifestRawSha256: "e".repeat(64) } });
    await expectManifestGateRefusal(h, "INPUT_BINDING_DRIFT");
    expect(h.calls()).toMatchObject({ inspect: 1, verify: 1 });
  });

  it("8: refuses manifest bytes changed after the context was issued, before the reservation", async () => {
    const h = await harness();
    await writeFile(h.checked.manifestPath, Buffer.concat([MANIFEST_BYTES, Buffer.from(" ")]));
    await expectManifestGateRefusal(h, "INPUT_BINDING_DRIFT");
  });

  it("9: manifest drift after the reservation and before the create leaves one reservation, zero creates and zero submissions, never retried", async () => {
    const h = await harness({
      dependencies: {
        createVisualAttemptReservation: vi.fn(async (...args: Parameters<typeof createVisualAttemptExecutionReservation>) => {
          const reservation = await createVisualAttemptExecutionReservation(...args);
          await writeFile(h.checked.manifestPath, `${MANIFEST_BYTES.toString("utf8")}{"drift":true}\n`);
          return reservation;
        }),
      },
    });
    const before = await snapshotTree(h.request.mediaRoot);

    await expectOperatorError(executeGoogleGenAiVisualAttemptSingleShot(h.request, h.dependencies, h.checkedContext), "SUBMISSION_REFUSED_BEFORE_PROVIDER_CALL", "RESERVED_ONLY");

    expect(vi.mocked(h.dependencies.createVisualAttemptReservation)).toHaveBeenCalledTimes(1);
    expect(h.calls()).toMatchObject({ creates: 0, submissions: 0 });
    expect(vi.mocked(recheckEpisodeExecutionBindings).mock.settledResults.at(-1)).toMatchObject({ type: "rejected", value: { code: "INPUT_BINDING_DRIFT" } });
    expect(Object.keys(await snapshotTree(h.request.mediaRoot)).filter((file) => !(file in before)))
      .toEqual([rel(h.request.mediaRoot, createVisualAttemptExecutionReservationPath(h.request.mediaRoot, "EP90", "S01", 2))]);
    expect(await attemptState(h)).toBe("RESERVED_ONLY");

    const rerun = await harness({ mediaRoot: h.request.mediaRoot, imagePath: h.request.sourceImagePath, checked: h.checked });
    await expectOperatorError(executeGoogleGenAiVisualAttemptSingleShot(rerun.request, rerun.dependencies, rerun.checkedContext), "LIFECYCLE_EXISTS");
    expect(h.createInteraction.mock.calls.length + rerun.createInteraction.mock.calls.length).toBe(0);
    expect(rerun.calls().reservations).toBe(0);
    expect(await attemptState(h)).toBe("RESERVED_ONLY");
  });
});

describe("2H-B legacy compatibility and the submitter seam (S-V)", () => {
  it("S: the legacy operator still runs the shot-scoped lifecycle and never touches the attempt namespace", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    await admit(mediaRoot);
    const createInteraction = vi.fn(async () => ({ id: INTERACTION_ID }));
    const result = await executeGoogleGenAiOperatorSingleShot({
      episode: episodeWith(), shotId: "S01", bible, rules, mediaRoot, sourceImagePath: imagePath, resolution: "720p", confirmPaidGeneration: true,
    }, {
      loadPolicies: async () => enabledPolicies(),
      prepareSubmission: () => ({ createInteraction }),
      inspectLifecycle: inspectExecutionLifecycle,
      verifyVisualReference: async () => ({ absolutePath: imagePath }),
      createReservation: createExecutionReservation,
      createSubmission: createExecutionSubmission,
    });
    expect(result).toMatchObject({ lifecycleState: "SUBMITTED", providerExecutionId: INTERACTION_ID });
    expect(Object.keys(result).sort()).toEqual([
      "episodeId", "expectedMicroUsd", "lifecycleState", "maxExpectedCostMicroUsd", "model", "provider", "providerExecutionId",
      "reservationId", "reservationPath", "resolution", "shotId", "submissionPath",
    ]);
    expect(createInteraction).toHaveBeenCalledTimes(1);
    expect((await inspectExecutionLifecycle(mediaRoot, "EP90", "S01")).state).toBe("SUBMITTED");
    expect((await inspectVisualAttemptExecutionLifecycle(mediaRoot, "EP90", "S01", 2)).state).toBe("ADMITTED_ONLY");
  });

  async function submitterInput(mediaRoot: string, imagePath: string) {
    const reservation = await createExecutionReservation(mediaRoot, { episodeId: "EP90", shotId: "S01", provider: "GOOGLE_GENAI" });
    return {
      reservation,
      shared: {
        mediaRoot, episodeId: "EP90", shotId: "S01", sourceImagePath: imagePath, promptText: admittedPrompt(), policySnapshot: googlePolicy,
        activationPolicy: enabledPolicies().activationPolicy, resolution: "720p",
      },
    };
  }

  it("T: the legacy wrapper and the identity core send the identical request and acceptance", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const { reservation, shared } = await submitterInput(mediaRoot, imagePath);
    const legacyCreate = vi.fn(async () => ({ id: INTERACTION_ID }));
    const coreCreate = vi.fn(async () => ({ id: INTERACTION_ID }));
    const legacyAccepted: GoogleGenAiSubmissionAcceptance[] = [];
    const coreAccepted: GoogleGenAiSubmissionAcceptance[] = [];

    const legacy = await submitGoogleGenAiSingleShot({ ...shared, reservation: reservation.record, onSubmissionAccepted: async (a) => { legacyAccepted.push(a); } }, { createInteraction: legacyCreate });
    const core = await submitGoogleGenAiSingleShotFromReservationIdentity({
      ...shared,
      reservationIdentity: { reservationId: reservation.record.reservationId, episodeId: "EP90", shotId: "S01", provider: "GOOGLE_GENAI" },
      onSubmissionAccepted: async (a) => { coreAccepted.push(a); },
    }, { createInteraction: coreCreate });

    expect(legacy).toEqual(core);
    expect(legacyCreate.mock.calls).toEqual(coreCreate.mock.calls);
    expect(legacyCreate).toHaveBeenCalledTimes(1);
    expect(legacyAccepted).toEqual(coreAccepted);
    expect(legacyAccepted).toHaveLength(1);
  });

  it("T: the legacy wrapper keeps the kill switch ahead of the reservation read and its exact reservation refusals", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const { reservation, shared } = await submitterInput(mediaRoot, imagePath);
    const createInteraction = vi.fn(async () => ({ id: INTERACTION_ID }));
    const onSubmissionAccepted = vi.fn(async () => undefined);

    await expect(submitGoogleGenAiSingleShot({ ...shared, activationPolicy: disabledPolicies().activationPolicy, reservation: "not-a-reservation", onSubmissionAccepted }, { createInteraction }))
      .rejects.toBeInstanceOf(GoogleGenAiNewSubmissionsDisabledError);
    await expect(submitGoogleGenAiSingleShot({ ...shared, reservation: { ...reservation.record, provider: "RUNWAY" }, onSubmissionAccepted }, { createInteraction }))
      .rejects.toThrow("Execution reservation must belong to GOOGLE_GENAI; received RUNWAY.");
    await expect(submitGoogleGenAiSingleShot({ ...shared, reservation: { ...reservation.record, shotId: "S02" }, onSubmissionAccepted }, { createInteraction }))
      .rejects.toThrow("Execution reservation EP90/S02 does not match requested shot EP90/S01.");
    await expect(submitGoogleGenAiSingleShot({ ...shared, reservation: { ...reservation.record, reservationId: "x" }, onSubmissionAccepted }, { createInteraction }))
      .rejects.toThrow();
    expect(createInteraction).not.toHaveBeenCalled();
    expect(onSubmissionAccepted).not.toHaveBeenCalled();
  });

  it("the identity core accepts exactly the narrow identity and refuses lineage, other providers and mismatches before any create", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const { reservation, shared } = await submitterInput(mediaRoot, imagePath);
    const createInteraction = vi.fn(async () => ({ id: INTERACTION_ID }));
    const onSubmissionAccepted = vi.fn(async () => undefined);
    const identity = { reservationId: reservation.record.reservationId, episodeId: "EP90", shotId: "S01", provider: "GOOGLE_GENAI" as const };
    const refused = [
      { ...identity, admissionId: ADMISSION_ID },
      { ...identity, attemptNumber: 2 },
      { ...identity, providerExecutionId: INTERACTION_ID },
      { ...identity, reservationSha256: "f".repeat(64) },
      reservation.record,
      { ...identity, provider: "RUNWAY" },
      { ...identity, shotId: "S02" },
      { ...identity, reservationId: "not-a-uuid" },
    ];
    for (const reservationIdentity of refused) {
      await expect(submitGoogleGenAiSingleShotFromReservationIdentity({
        ...shared, reservationIdentity: reservationIdentity as unknown as typeof identity, onSubmissionAccepted,
      }, { createInteraction }), JSON.stringify(reservationIdentity)).rejects.toThrow();
    }
    await expect(submitGoogleGenAiSingleShotFromReservationIdentity({ ...shared, activationPolicy: disabledPolicies().activationPolicy, reservationIdentity: identity, onSubmissionAccepted }, { createInteraction }))
      .rejects.toBeInstanceOf(GoogleGenAiNewSubmissionsDisabledError);
    expect(createInteraction).not.toHaveBeenCalled();
    expect(onSubmissionAccepted).not.toHaveBeenCalled();
  });

  it("the identity core wraps an acceptance-callback failure without resubmitting", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const { reservation, shared } = await submitterInput(mediaRoot, imagePath);
    const createInteraction = vi.fn(async () => ({ id: INTERACTION_ID }));
    await expect(submitGoogleGenAiSingleShotFromReservationIdentity({
      ...shared,
      reservationIdentity: { reservationId: reservation.record.reservationId, episodeId: "EP90", shotId: "S01", provider: "GOOGLE_GENAI" },
      onSubmissionAccepted: async () => { throw new Error("disk full"); },
    }, { createInteraction })).rejects.toThrow(`Google GenAI accepted paid interaction ${INTERACTION_ID}, but Busybookie could not durably record the submission. Do not resubmit automatically.`);
    expect(createInteraction).toHaveBeenCalledTimes(1);
  });

  it("U: the submitter keeps exactly one physical provider create call site shared by both entries", async () => {
    const source = await readFile(join(process.cwd(), "src/execution/providers/submitGoogleGenAiSingleShot.ts"), "utf8");
    expect(source.match(/\.createInteraction\(/g)).toHaveLength(1);
    expect(source.match(/\bsubmitGoogleGenAiSingleShotCore\(/g)).toHaveLength(3);
    expect(source).not.toMatch(/retry|fallback|\.cancel\(|\.delete\(|createExecutionSubmission|createVisualAttempt|claimGoogleGenAi|readFile|writeFile|process\.env/i);
  });

  it("V: the attempt operator introduces no CLI, routing, Runway, Veo, completion or claim authority", async () => {
    const source = await readFile(join(process.cwd(), "src/execution/executeGoogleGenAiOperatorSingleShot.ts"), "utf8");
    const start = source.indexOf("export async function executeGoogleGenAiVisualAttemptSingleShot(");
    expect(start).toBeGreaterThan(0);
    const attempt = source.slice(start);
    expect(attempt).not.toMatch(/\/runway\/|\/veo\/|\/routing\/|\/cli\/|executeRunway|executeVeo|executeSingleShot\b|reconcileGoogle|materializeGoogle|persistGoogle|Completion|GenerationRecord|claimGoogleGenAi|inspectLifecycle|createReservation\(|createSubmission\(|submitGoogleGenAiSingleShot\(|process\.env|console\.|\bcause\s*:|retry/);
    expect(attempt.match(/dependencies\.createVisualAttemptReservation\(/g)).toHaveLength(1);
    expect(attempt.match(/dependencies\.createVisualAttemptSubmission\(/g)).toHaveLength(1);
    expect(attempt.match(/submitGoogleGenAiSingleShotFromReservationIdentity\(/g)).toHaveLength(1);
    expect(attempt.match(/prepared\.createInteraction\(/g)).toHaveLength(1);
    // R37D: the checked context is a required argument; the manifest gate runs before the reservation and before the create.
    expect(attempt).toMatch(/checkedContext:\s*CheckedEpisodeExecutionContext,\s*\):/);
    expect(attempt.match(/requireCheckedAttemptAuthority\(/g)).toHaveLength(1);
    expect(attempt.match(/requireAdmittedManifestBinding\(/g)).toHaveLength(2);
    expect(attempt).not.toMatch(/JSON\.stringify\(\s*request|process\.cwd|manifestRawSha256:/);
    // The legacy entry still uses only the legacy submitter wrapper and the legacy lifecycle.
    const legacy = source.slice(source.indexOf("export async function executeGoogleGenAiOperatorSingleShot("), source.indexOf("function requireReplacementAttemptNumber("));
    expect(legacy).toMatch(/submitGoogleGenAiSingleShot\(/);
    expect(legacy).not.toMatch(/FromReservationIdentity|VisualAttempt|requireAdmittedManifestBinding/);
    expect(legacy).toMatch(/checkedContext\?: CheckedEpisodeExecutionContext,/);
    for (const file of ["src/execution/cli/runGoogleGenAiOperatorCli.ts", "src/execution/cli/runSingleShotExecutionCli.ts"]) {
      expect(await readFile(join(process.cwd(), file), "utf8"), file).not.toMatch(/executeGoogleGenAiVisualAttemptSingleShot|FromReservationIdentity/);
    }
    // B5 Slice-2I-B: the shared composition seam may compose the attempt operator, never the reservation-identity submitter.
    expect(await readFile(join(process.cwd(), "src/execution/createProductionSingleShotExecutionDependencies.ts"), "utf8")).not.toMatch(/FromReservationIdentity/);
  });
});
