import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyExecutionLifecycle } from "../src/execution/classifyExecutionLifecycle.js";
import { runExecutionReconcileCli, type RunExecutionReconcileCliDependencies } from "../src/execution/cli/runExecutionReconcileCli.js";
import { createExecutionCompletion } from "../src/execution/createExecutionCompletion.js";
import { createExecutionReservation } from "../src/execution/createExecutionReservation.js";
import { createExecutionSubmission } from "../src/execution/createExecutionSubmission.js";
import { createProductionExecutionReconcileDependencies } from "../src/execution/createProductionExecutionReconcileDependencies.js";
import { createExecutionCompletionPath } from "../src/execution/executionCompletionPath.js";
import { createExecutionReservationPath } from "../src/execution/executionReservationPath.js";
import { inspectExecutionLifecycle } from "../src/execution/inspectExecutionLifecycle.js";
import { inspectGoogleGenAiExecutionLifecycle } from "../src/execution/inspectGoogleGenAiExecutionLifecycle.js";
import { materializeGoogleGenAiSingleShotOutput, type GoogleGenAiOutputRetriever } from "../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js";
import { persistGoogleGenAiSingleShotCompletion } from "../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js";
import { createGoogleGenAiSingleShotProductionInteractionCreator } from "../src/execution/providers/createGoogleGenAiSingleShotProductionInteractionCreator.js";
import { GoogleGenAiNewSubmissionsDisabledError, submitGoogleGenAiSingleShot } from "../src/execution/providers/submitGoogleGenAiSingleShot.js";
import { readExecutionCompletion } from "../src/execution/readExecutionCompletion.js";
import { readExecutionReservation } from "../src/execution/readExecutionReservation.js";
import { readExecutionSubmission } from "../src/execution/readExecutionSubmission.js";
import { readGoogleGenAiExecutionCompletion } from "../src/execution/readGoogleGenAiExecutionCompletion.js";
import { reconcileExecutionLifecycle } from "../src/execution/reconcileExecutionLifecycle.js";
import { reconcileGoogleGenAiExecutionLifecycle } from "../src/execution/reconcileGoogleGenAiExecutionLifecycle.js";
import { resolveDurableShotVisualGenerationState } from "../src/execution/resolveDurableShotVisualGenerationState.js";
import { verifyCompletedShotForComposition } from "../src/composition/verifyCompletedShotForComposition.js";
import type { GoogleGenAiPolicy } from "../src/schemas/googleGenAiPolicy.schema.js";
import { loadGoogleGenAiActivationPolicy } from "../src/validation/loadGoogleGenAiActivationPolicy.js";
import { loadGoogleGenAiPolicy } from "../src/validation/loadGoogleGenAiPolicy.js";

// B5C-R1 shared Google recovery interoperability. Pass-through spies observe which reader/inspector/reconciler
// runs; the create authority and activation-policy loader are spied so any new-submission attempt is counted.
vi.mock("../src/execution/inspectGoogleGenAiExecutionLifecycle.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/execution/inspectGoogleGenAiExecutionLifecycle.js")>();
  return { ...original, inspectGoogleGenAiExecutionLifecycle: vi.fn(original.inspectGoogleGenAiExecutionLifecycle) };
});
vi.mock("../src/execution/readExecutionCompletion.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/execution/readExecutionCompletion.js")>();
  return { ...original, readExecutionCompletion: vi.fn(original.readExecutionCompletion) };
});
vi.mock("../src/execution/readGoogleGenAiExecutionCompletion.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/execution/readGoogleGenAiExecutionCompletion.js")>();
  return { ...original, readGoogleGenAiExecutionCompletion: vi.fn(original.readGoogleGenAiExecutionCompletion) };
});
vi.mock("../src/execution/reconcileGoogleGenAiExecutionLifecycle.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/execution/reconcileGoogleGenAiExecutionLifecycle.js")>();
  return { ...original, reconcileGoogleGenAiExecutionLifecycle: vi.fn(original.reconcileGoogleGenAiExecutionLifecycle) };
});
vi.mock("../src/execution/providers/createGoogleGenAiSingleShotProductionInteractionCreator.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/execution/providers/createGoogleGenAiSingleShotProductionInteractionCreator.js")>();
  return { ...original, createGoogleGenAiSingleShotProductionInteractionCreator: vi.fn(original.createGoogleGenAiSingleShotProductionInteractionCreator) };
});
vi.mock("../src/validation/loadGoogleGenAiActivationPolicy.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/validation/loadGoogleGenAiActivationPolicy.js")>();
  return { ...original, loadGoogleGenAiActivationPolicy: vi.fn(original.loadGoogleGenAiActivationPolicy) };
});

const ROOT = process.cwd();
const RESERVATION_ID = "11111111-1111-4111-8111-111111111111";
const INTERACTION_ID = "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM";
const RUNWAY_TASK_ID = "task-runway-interop-123";
const SYNTHETIC_KEY = "synthetic-test-key-not-a-secret";
const temporaryDirectories: string[] = [];
let policySnapshot: GoogleGenAiPolicy;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => { policySnapshot = await loadGoogleGenAiPolicy(); });
beforeEach(() => {
  vi.mocked(inspectGoogleGenAiExecutionLifecycle).mockClear();
  vi.mocked(readExecutionCompletion).mockClear();
  vi.mocked(readGoogleGenAiExecutionCompletion).mockClear();
  vi.mocked(reconcileGoogleGenAiExecutionLifecycle).mockClear();
  vi.mocked(createGoogleGenAiSingleShotProductionInteractionCreator).mockClear();
  vi.mocked(loadGoogleGenAiActivationPolicy).mockClear();
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("network is forbidden in B5C-R1 tests"); });
});
afterEach(async () => {
  fetchSpy.mockRestore();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function mediaRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "busybookie-shared-google-interop-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function reserve(root: string, provider: "GOOGLE_GENAI" | "RUNWAY" | "VEO", episodeId = "EP92"): Promise<void> {
  await createExecutionReservation(root, { episodeId, shotId: "S01", provider }, {
    now: () => "2026-10-24T12:00:00.000Z",
    createReservationId: () => RESERVATION_ID,
  });
}

async function googleSubmitted(root: string, episodeId = "EP92"): Promise<void> {
  await reserve(root, "GOOGLE_GENAI", episodeId);
  await createExecutionSubmission(root, {
    reservationId: RESERVATION_ID,
    episodeId,
    shotId: "S01",
    provider: "GOOGLE_GENAI",
    providerExecutionId: INTERACTION_ID,
    recoveryMetadata: {
      request: {
        model: "gemini-omni-1.1-flash",
        background: true,
        store: true,
        stream: false,
        promptText: "Busybookie shared Google interoperability test.",
        sourceImagePath: join(root, "references", episodeId, "S01", "reference.png"),
      },
      policySnapshot,
    },
  }, { now: () => "2026-10-24T12:01:00.000Z" });
}

function mp4(): Buffer {
  const payload = Buffer.from("busybookie-shared-google-interop-output", "utf8");
  const mdat = Buffer.alloc(8);
  mdat.writeUInt32BE(8 + payload.byteLength, 0);
  mdat.write("mdat", 4, "latin1");
  return Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom", "latin1"), Buffer.from([0, 0, 2, 0]), Buffer.from("isommp41", "latin1"), mdat, payload]);
}

async function googleCompleted(root: string, episodeId = "EP92"): Promise<void> {
  await googleSubmitted(root, episodeId);
  const bytes = mp4();
  const materializedOutput = await materializeGoogleGenAiSingleShotOutput({ mediaRoot: root, episodeId, shotId: "S01", maxOutputBytes: 4096 }, {
    retrieveOutput: vi.fn<GoogleGenAiOutputRetriever>(async (providerExecutionId) => ({
      id: providerExecutionId,
      status: "completed",
      outputVideo: { type: "video", mime_type: "video/mp4", data: bytes.toString("base64") },
    })),
    downloadUri: async () => { throw new Error("URI downloader must not be called."); },
  });
  await persistGoogleGenAiSingleShotCompletion({ mediaRoot: root, episodeId, shotId: "S01", materializedOutput }, { now: () => "2026-10-24T12:10:00.000Z" });
}

async function runwaySubmitted(root: string): Promise<void> {
  await reserve(root, "RUNWAY");
  await createExecutionSubmission(root, {
    reservationId: RESERVATION_ID,
    episodeId: "EP92",
    shotId: "S01",
    provider: "RUNWAY",
    providerExecutionId: RUNWAY_TASK_ID,
    providerEstimatedCredits: 60,
    recoveryMetadata: {
      request: {
        durationSeconds: 5,
        ratio: "1280:720",
        outputFormat: "mp4",
        promptText: "Busybookie shared interoperability Runway regression.",
        sourceImagePath: "D:/Busybookie/Production/references/EP92/S01/reference.png",
        assetStrategy: "DATA_URI",
      },
      locallyExpectedCredits: 60,
    },
  }, { now: () => "2026-10-24T12:01:00.000Z" });
}

async function runwayCompleted(root: string): Promise<void> {
  await runwaySubmitted(root);
  const generationRecordPath = join(root, "generated-video", "EP92", "S01", `EP92_S01_${RUNWAY_TASK_ID}.runway-generation.json`);
  await mkdir(dirname(generationRecordPath), { recursive: true });
  await writeFile(generationRecordPath, "{}\n", "utf8");
  await createExecutionCompletion(root, {
    reservationId: RESERVATION_ID,
    episodeId: "EP92",
    shotId: "S01",
    provider: "RUNWAY",
    providerExecutionId: RUNWAY_TASK_ID,
    generationRecordPath,
  }, { now: () => "2026-10-24T12:10:00.000Z" });
}

// The pre-R1 shared algorithm, used as the reference for unchanged RUNWAY/VEO inspection.
async function preR1SharedClassification(root: string) {
  return classifyExecutionLifecycle({
    reservation: await readExecutionReservation(root, "EP92", "S01"),
    submission: await readExecutionSubmission(root, "EP92", "S01"),
    completion: await readExecutionCompletion(root, "EP92", "S01"),
  });
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    result[path] = createHash("sha256").update(await readFile(path)).digest("hex");
  }
  return result;
}

async function rewriteJson(path: string, edit: (value: Record<string, unknown>) => void): Promise<void> {
  const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  edit(value);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function cliDependencies(root: string, overrides: Partial<RunExecutionReconcileCliDependencies> = {}, apiKey?: string) {
  const trip = (name: string) => vi.fn(() => { throw new Error(`${name} must not run for a Google lifecycle.`); });
  const dependencies = {
    loadEnvironment: vi.fn(() => ({ BUSYBOOKIE_MEDIA_ROOT: root, ...(apiKey === undefined ? {} : { GEMINI_API_KEY: apiKey }) })),
    loadProductionRules: vi.fn(async () => ({}) as never),
    resolveMediaRoot: vi.fn(() => root),
    inspectLifecycle: vi.fn(inspectExecutionLifecycle),
    reconcileLifecycle: trip("shared reconcileLifecycle"),
    loadRunwayPolicy: trip("loadRunwayPolicy"),
    createRunwayTaskLookupClient: trip("createRunwayTaskLookupClient"),
    resumeRunwayTask: trip("resumeRunwayTask"),
    loadVeoPolicy: trip("loadVeoPolicy"),
    createVeoOperationLookupClient: trip("createVeoOperationLookupClient"),
    createVeoFileDownloadClient: trip("createVeoFileDownloadClient"),
    resumeVeoOperation: trip("resumeVeoOperation"),
    recoverVeoOutput: trip("recoverVeoOutput"),
    reconcileGoogleLifecycle: vi.fn(async () => ({}) as never),
    createGoogleSubmittedRecovery: vi.fn(() => ({ marker: "existing-submission-recovery" }) as never),
    ...overrides,
  };
  return dependencies as typeof dependencies & RunExecutionReconcileCliDependencies;
}

const ARGS = ["--episode", "EP92", "--shot", "S01"];

describe("B5C-R1 shared Google lifecycle inspection", () => {
  it("R1.1 RUNWAY inspection is unchanged and never consults the Google inspector", async () => {
    for (const build of [async (root: string) => reserve(root, "RUNWAY"), runwaySubmitted, runwayCompleted]) {
      const root = await mediaRoot();
      await build(root);
      const shared = await inspectExecutionLifecycle(root, "EP92", "S01");
      expect(shared).toStrictEqual(await preR1SharedClassification(root));
    }
    const empty = await mediaRoot();
    expect(await inspectExecutionLifecycle(empty, "EP92", "S01")).toStrictEqual({ state: "NOTHING" });
    expect(inspectGoogleGenAiExecutionLifecycle).not.toHaveBeenCalled();
    expect(readGoogleGenAiExecutionCompletion).not.toHaveBeenCalled();
  });

  it("R1.2 VEO inspection is unchanged and never consults the Google inspector", async () => {
    const root = await mediaRoot();
    await reserve(root, "VEO");
    const shared = await inspectExecutionLifecycle(root, "EP92", "S01");
    expect(shared).toStrictEqual(await preR1SharedClassification(root));
    expect(shared).toMatchObject({ state: "RESERVED_ONLY", reservation: { provider: "VEO" } });
    expect(inspectGoogleGenAiExecutionLifecycle).not.toHaveBeenCalled();
  });

  it("R1.3 recognises a Google SUBMITTED lifecycle without the shared completion parser", async () => {
    const root = await mediaRoot();
    await googleSubmitted(root);
    const shared = await inspectExecutionLifecycle(root, "EP92", "S01");
    expect(shared.state).toBe("SUBMITTED");
    expect(shared).toMatchObject({ submission: { provider: "GOOGLE_GENAI", providerExecutionId: INTERACTION_ID } });
    expect(readExecutionCompletion).not.toHaveBeenCalled();
  });

  it("R1.4 recognises a Google COMPLETED lifecycle carrying the authoritative 1.1 completion", async () => {
    const root = await mediaRoot();
    await googleCompleted(root);
    const shared = await inspectExecutionLifecycle(root, "EP92", "S01");
    expect(shared.state).toBe("COMPLETED");
    expect(shared).toMatchObject({ completion: { schemaVersion: "1.1", provider: "GOOGLE_GENAI", providerExecutionId: INTERACTION_ID } });
    await expect(readExecutionCompletion(root, "EP92", "S01")).rejects.toThrow();
  });

  it("R1.5 EP90 shape: a RUNWAY manifest does not decide ownership; Google durable records yield COMPLETED unchanged", async () => {
    const manifest = JSON.parse(await readFile(join(ROOT, "episodes", "EP90", "episode.json"), "utf8")) as { episodeId: string; scenes: { shots: { id: string; generation: { provider: string } }[] }[] };
    const shot = manifest.scenes.flatMap((scene) => scene.shots).find((candidate) => candidate.id === "S01");
    expect(shot?.generation.provider).toBe("RUNWAY");
    const root = await mediaRoot();
    await googleCompleted(root, "EP90");
    const before = await snapshot(root);
    const state = await resolveDurableShotVisualGenerationState({
      episode: manifest, shot, bible: {}, rules: {}, policy: {}, mediaRoot: root,
    } as unknown as Parameters<typeof resolveDurableShotVisualGenerationState>[0]);
    expect(state.state).toBe("LIFECYCLE_COMPLETED");
    expect(state).toMatchObject({ lifecycle: { reservation: { provider: "GOOGLE_GENAI" }, submission: { provider: "GOOGLE_GENAI" }, completion: { provider: "GOOGLE_GENAI", schemaVersion: "1.1" } } });
    expect(await snapshot(root)).toStrictEqual(before);
  });

  it("R1.6 delegates the Google branch to the existing Google inspector and maps its result 1:1", async () => {
    const root = await mediaRoot();
    await googleCompleted(root);
    vi.mocked(inspectGoogleGenAiExecutionLifecycle).mockClear();
    const shared = await inspectExecutionLifecycle(root, "EP92", "S01");
    expect(inspectGoogleGenAiExecutionLifecycle).toHaveBeenCalledTimes(1);
    expect(inspectGoogleGenAiExecutionLifecycle).toHaveBeenCalledWith(root, "EP92", "S01");
    const google = await vi.mocked(inspectGoogleGenAiExecutionLifecycle).mock.results[0]!.value as Awaited<ReturnType<typeof inspectGoogleGenAiExecutionLifecycle>>;
    expect(google.state).toBe("COMPLETED");
    if (google.state !== "COMPLETED") throw new Error("expected COMPLETED");
    expect(shared).toStrictEqual({ state: "COMPLETED", reservation: google.reservation, submission: google.submission, completion: google.completion });
    expect(shared.state === "COMPLETED" && shared.completion).toBe(google.completion);
    expect(readExecutionCompletion).not.toHaveBeenCalled();
  });

  it("R1.9 a malformed Google completion fails closed without the shared parser", async () => {
    const root = await mediaRoot();
    await googleCompleted(root);
    await writeFile(createExecutionCompletionPath(root, "EP92", "S01"), "{ corrupt", "utf8");
    await expect(inspectExecutionLifecycle(root, "EP92", "S01")).rejects.toThrow();
    expect(readExecutionCompletion).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("R1.10 unknown or mixed ownership fails closed and is never reinterpreted", async () => {
    const unknown = await mediaRoot();
    await reserve(unknown, "RUNWAY");
    await rewriteJson(createExecutionReservationPath(unknown, "EP92", "S01"), (value) => { value.provider = "KREA"; });
    await expect(inspectExecutionLifecycle(unknown, "EP92", "S01")).rejects.toThrow();

    const runwayOwnsGoogleCompletion = await mediaRoot();
    await googleCompleted(runwayOwnsGoogleCompletion);
    await rewriteJson(createExecutionReservationPath(runwayOwnsGoogleCompletion, "EP92", "S01"), (value) => { value.provider = "RUNWAY"; });
    await expect(inspectExecutionLifecycle(runwayOwnsGoogleCompletion, "EP92", "S01")).rejects.toThrow();

    const googleOwnsRunwayRecords = await mediaRoot();
    await runwayCompleted(googleOwnsRunwayRecords);
    await rewriteJson(createExecutionReservationPath(googleOwnsRunwayRecords, "EP92", "S01"), (value) => { value.provider = "GOOGLE_GENAI"; });
    vi.mocked(inspectGoogleGenAiExecutionLifecycle).mockClear();
    vi.mocked(readExecutionCompletion).mockClear();
    // The Google owner reads the shared-shaped records and rejects them; nothing is reread as RUNWAY.
    await expect(inspectExecutionLifecycle(googleOwnsRunwayRecords, "EP92", "S01")).rejects.toThrow();
    expect(inspectGoogleGenAiExecutionLifecycle).toHaveBeenCalledTimes(1);
    expect(readExecutionCompletion).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("R1.11 no exception-driven fallback: each lifecycle reads exactly one completion reader", async () => {
    const googleWithSharedCompletion = await mediaRoot();
    await googleSubmitted(googleWithSharedCompletion);
    await writeFile(createExecutionCompletionPath(googleWithSharedCompletion, "EP92", "S01"), `${JSON.stringify({
      schemaVersion: "1.0", completedAt: "2026-10-24T12:10:00.000Z", status: "COMPLETED", reservationId: RESERVATION_ID,
      episodeId: "EP92", shotId: "S01", provider: "RUNWAY", providerExecutionId: INTERACTION_ID, generationRecordPath: "x.json",
    }, null, 2)}\n`, "utf8");
    await expect(inspectExecutionLifecycle(googleWithSharedCompletion, "EP92", "S01")).rejects.toThrow();
    expect(readGoogleGenAiExecutionCompletion).toHaveBeenCalledTimes(1);
    expect(readExecutionCompletion).not.toHaveBeenCalled();

    vi.mocked(readGoogleGenAiExecutionCompletion).mockClear();
    const runwayWithGoogleCompletion = await mediaRoot();
    await googleCompleted(runwayWithGoogleCompletion);
    await rewriteJson(createExecutionReservationPath(runwayWithGoogleCompletion, "EP92", "S01"), (value) => { value.provider = "RUNWAY"; });
    vi.mocked(inspectGoogleGenAiExecutionLifecycle).mockClear();
    vi.mocked(readGoogleGenAiExecutionCompletion).mockClear();
    vi.mocked(readExecutionCompletion).mockClear();
    await expect(inspectExecutionLifecycle(runwayWithGoogleCompletion, "EP92", "S01")).rejects.toThrow();
    expect(readGoogleGenAiExecutionCompletion).not.toHaveBeenCalled();
    expect(inspectGoogleGenAiExecutionLifecycle).not.toHaveBeenCalled();
    expect(readExecutionCompletion).toHaveBeenCalledTimes(1);
  });

  it("R1.12/R1.13 attribution stays GOOGLE_GENAI and COMPLETED inspection needs no credential or network", async () => {
    const root = await mediaRoot();
    await googleCompleted(root);
    const shared = await inspectExecutionLifecycle(root, "EP92", "S01");
    expect(shared).toMatchObject({ reservation: { provider: "GOOGLE_GENAI" }, submission: { provider: "GOOGLE_GENAI" }, completion: { provider: "GOOGLE_GENAI" } });
    expect(process.env.GEMINI_API_KEY ?? "").toBe("");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(createGoogleGenAiSingleShotProductionInteractionCreator).not.toHaveBeenCalled();
  });
});

describe("B5C-R1 shared reconcile dispatch to the existing Google reconciler", () => {
  it("R1.7/R1.8 dispatches an existing Google SUBMITTED job exactly once, with no create and no other provider", async () => {
    const root = await mediaRoot();
    await googleSubmitted(root);
    const before = await snapshot(root);
    const dependencies = cliDependencies(root, {}, SYNTHETIC_KEY);
    await runExecutionReconcileCli(ARGS, dependencies);
    expect(dependencies.reconcileGoogleLifecycle).toHaveBeenCalledTimes(1);
    expect(dependencies.reconcileGoogleLifecycle).toHaveBeenCalledWith(
      { mediaRoot: root, episodeId: "EP92", shotId: "S01" },
      { submittedRecovery: { marker: "existing-submission-recovery" } },
    );
    expect(dependencies.createGoogleSubmittedRecovery).toHaveBeenCalledTimes(1);
    expect(dependencies.createGoogleSubmittedRecovery).toHaveBeenCalledWith(SYNTHETIC_KEY);
    for (const name of ["reconcileLifecycle", "loadRunwayPolicy", "createRunwayTaskLookupClient", "resumeRunwayTask", "loadVeoPolicy", "createVeoOperationLookupClient", "createVeoFileDownloadClient", "resumeVeoOperation", "recoverVeoOutput"] as const) {
      expect(dependencies[name], name).not.toHaveBeenCalled();
    }
    expect(createGoogleGenAiSingleShotProductionInteractionCreator).not.toHaveBeenCalled();
    expect(loadGoogleGenAiActivationPolicy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await snapshot(root)).toStrictEqual(before);
  });

  it("R1.8 the reconcile dependency and CLI modules import no create, submit or activation authority", async () => {
    for (const file of ["src/execution/cli/runExecutionReconcileCli.ts", "src/execution/createProductionExecutionReconcileDependencies.ts", "src/execution/inspectExecutionLifecycle.ts"]) {
      const source = await readFile(join(ROOT, file), "utf8");
      expect(source, file).not.toMatch(/createGoogleGenAiSingleShotProductionInteractionCreator|submitGoogleGenAiSingleShot|executeGoogleGenAiOperatorSingleShot|loadGoogleGenAiActivationPolicy|newSubmissionsEnabled|@google\/genai/);
    }
    const production = createProductionExecutionReconcileDependencies();
    expect(production.reconcileGoogleLifecycle).toBe(reconcileGoogleGenAiExecutionLifecycle);
    expect(typeof production.createGoogleSubmittedRecovery).toBe("function");
  });

  it("R1.13 an existing Google COMPLETED job verifies locally through the real Google reconciler with no credential", async () => {
    const root = await mediaRoot();
    await googleCompleted(root);
    const before = await snapshot(root);
    const dependencies = cliDependencies(root, { reconcileGoogleLifecycle: vi.mocked(reconcileGoogleGenAiExecutionLifecycle) });
    await runExecutionReconcileCli(ARGS, dependencies);
    expect(reconcileGoogleGenAiExecutionLifecycle).toHaveBeenCalledTimes(1);
    expect(reconcileGoogleGenAiExecutionLifecycle).toHaveBeenCalledWith({ mediaRoot: root, episodeId: "EP92", shotId: "S01" }, {});
    await expect(vi.mocked(reconcileGoogleGenAiExecutionLifecycle).mock.results[0]!.value).resolves.toMatchObject({ lifecycleState: "COMPLETED", reconciliationMode: "DURABLE_COMPLETION", provider: "GOOGLE_GENAI" });
    expect(dependencies.createGoogleSubmittedRecovery).not.toHaveBeenCalled();
    expect(dependencies.reconcileLifecycle).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await snapshot(root)).toStrictEqual(before);
  });

  it("refuses a Google RESERVED_ONLY job and a SUBMITTED job without a credential before any recovery", async () => {
    const reserved = await mediaRoot();
    await reserve(reserved, "GOOGLE_GENAI");
    const reservedDependencies = cliDependencies(reserved, {}, SYNTHETIC_KEY);
    await expect(runExecutionReconcileCli(ARGS, reservedDependencies)).rejects.toThrow("SUBMITTED or COMPLETED lifecycle only; received RESERVED_ONLY");
    expect(reservedDependencies.reconcileGoogleLifecycle).not.toHaveBeenCalled();

    const submitted = await mediaRoot();
    await googleSubmitted(submitted);
    const keyless = cliDependencies(submitted);
    await expect(runExecutionReconcileCli(ARGS, keyless)).rejects.toThrow("Google GenAI reconciliation requires GEMINI_API_KEY.");
    expect(keyless.createGoogleSubmittedRecovery).not.toHaveBeenCalled();
    expect(keyless.reconcileGoogleLifecycle).not.toHaveBeenCalled();

    const unwired = cliDependencies(submitted, {}, SYNTHETIC_KEY);
    Reflect.deleteProperty(unwired, "reconcileGoogleLifecycle");
    await expect(runExecutionReconcileCli(ARGS, unwired)).rejects.toThrow("requires the existing Google lifecycle reconciler");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("R1.14 RUNWAY reconciliation is unchanged and never dispatches to Google", async () => {
    const root = await mediaRoot();
    await runwayCompleted(root);
    const reconcileLifecycle = vi.fn(async () => ({}) as never);
    const dependencies = cliDependencies(root, { reconcileLifecycle });
    await runExecutionReconcileCli(ARGS, dependencies);
    expect(reconcileLifecycle).toHaveBeenCalledTimes(1);
    expect(dependencies.reconcileGoogleLifecycle).not.toHaveBeenCalled();
    expect(dependencies.createGoogleSubmittedRecovery).not.toHaveBeenCalled();
  });

  it("R1.15 newSubmissionsEnabled=false blocks a NEW submission but not recovery of an EXISTING one", async () => {
    const activationPolicy = await loadGoogleGenAiActivationPolicy();
    expect(activationPolicy.admission.newSubmissionsEnabled).toBe(false);
    const createInteraction = vi.fn(async () => { throw new Error("create must not be reached"); });
    await expect(submitGoogleGenAiSingleShot({ activationPolicy } as unknown as Parameters<typeof submitGoogleGenAiSingleShot>[0], { createInteraction } as never)).rejects.toBeInstanceOf(GoogleGenAiNewSubmissionsDisabledError);
    expect(createInteraction).not.toHaveBeenCalled();

    vi.mocked(loadGoogleGenAiActivationPolicy).mockClear();
    const root = await mediaRoot();
    await googleSubmitted(root);
    const dependencies = cliDependencies(root, {}, SYNTHETIC_KEY);
    await runExecutionReconcileCli(ARGS, dependencies);
    expect(dependencies.reconcileGoogleLifecycle).toHaveBeenCalledTimes(1);
    expect(loadGoogleGenAiActivationPolicy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the shared core and composition fail-closed for a Google-completed lifecycle (B5A deferred)", async () => {
    const root = await mediaRoot();
    await googleCompleted(root);
    const lifecycle = await inspectExecutionLifecycle(root, "EP92", "S01");
    await expect(reconcileExecutionLifecycle({ mediaRoot: root, episodeId: "EP92", shotId: "S01" }, { inspectLifecycle: async () => lifecycle })).rejects.toThrow("Execution lifecycle reconciliation for completed provider GOOGLE_GENAI is not implemented in this milestone.");
    await expect(verifyCompletedShotForComposition({ mediaRoot: root, episodeId: "EP92", shotId: "S01" })).rejects.toThrow("completed provider GOOGLE_GENAI is not implemented");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
