import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runExecutionReconcileCli, type RunExecutionReconcileCliDependencies } from "../src/execution/cli/runExecutionReconcileCli.js";
import { runSingleShotExecutionCli, type RunSingleShotExecutionCliDependencies } from "../src/execution/cli/runSingleShotExecutionCli.js";
import { createExecutionReservation } from "../src/execution/createExecutionReservation.js";
import { createExecutionSubmission } from "../src/execution/createExecutionSubmission.js";
import { createGoogleGenAiOperatorProductionDependencies } from "../src/execution/createGoogleGenAiOperatorProductionDependencies.js";
import {
  createProductionSingleShotExecutionDependencies,
  type ProductionSingleShotExecutionCompositionDependencies,
} from "../src/execution/createProductionSingleShotExecutionDependencies.js";
import { createProductionVisualReferenceVerifier } from "../src/execution/createProductionVisualReferenceVerifier.js";
import { executeGoogleGenAiOperatorSingleShot, GoogleGenAiOperatorError, type GoogleGenAiOperatorPolicies } from "../src/execution/executeGoogleGenAiOperatorSingleShot.js";
import { executeSingleShot } from "../src/execution/executeSingleShot.js";
import { createExecutionCompletionPath } from "../src/execution/executionCompletionPath.js";
import { createExecutionReservationPath } from "../src/execution/executionReservationPath.js";
import { createExecutionSubmissionPath } from "../src/execution/executionSubmissionPath.js";
import { inspectExecutionLifecycle } from "../src/execution/inspectExecutionLifecycle.js";
import { createGoogleGenAiSingleShotSecureProductionRecovery } from "../src/execution/providers/createGoogleGenAiSingleShotSecureProductionRecovery.js";
import { materializeGoogleGenAiSingleShotOutput } from "../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js";
import { persistGoogleGenAiSingleShotCompletion } from "../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js";
import { reconcileGoogleGenAiExecutionLifecycle } from "../src/execution/reconcileGoogleGenAiExecutionLifecycle.js";
import { resolveDurableShotExecutionReadiness } from "../src/execution/resolveDurableShotExecutionReadiness.js";
import { resolveDurableShotVisualGenerationState } from "../src/execution/resolveDurableShotVisualGenerationState.js";
import type { SingleShotExecutionDependencies, SingleShotGoogleSubmittedExecution } from "../src/execution/singleShotExecution.types.js";
import { createVisualReferenceAssetRegistryPath } from "../src/execution/visualReferenceAssetRegistryPath.js";
import type { GoogleGenAiFetch } from "../src/googleGenai/transport/googleGenAiSecureOutputTransport.types.js";
import { evaluateShotExecutionReadiness } from "../src/planning/evaluateShotExecutionReadiness.js";
import type { CharacterBible } from "../src/schemas/character.schema.js";
import type { EpisodeManifest, Shot } from "../src/schemas/episodeManifest.schema.js";
import type { ProductionRules } from "../src/schemas/productionRules.schema.js";
import type { ProviderRoutingPolicy } from "../src/schemas/providerRoutingPolicy.schema.js";
import { loadCharacterBible } from "../src/validation/loadCharacterBible.js";
import { loadEpisodeManifest } from "../src/validation/loadEpisodeManifest.js";
import { loadGoogleGenAiActivationPolicy } from "../src/validation/loadGoogleGenAiActivationPolicy.js";
import { loadGoogleGenAiPolicy } from "../src/validation/loadGoogleGenAiPolicy.js";
import { loadProductionRules } from "../src/validation/loadProductionRules.js";
import { loadProviderRoutingPolicy } from "../src/validation/loadProviderRoutingPolicy.js";
import { validateEpisodeProduction } from "../src/validation/validateEpisodeProduction.js";

// B5C-X1 shared Google async execution contract (X1.1-X1.15, frozen in the B5C-X1 prep report).
// Shared execution of an explicit GOOGLE_GENAI shot delegates to the EXISTING Google orchestrator and stops at a
// durable SUBMITTED lifecycle; the published R1 reconcile path completes it later. Everything here is offline:
// the real SDK constructor is a tripwire, global fetch rejects, and the committed activation policy is never edited.
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(() => {
    throw new Error("The real Google SDK must never be constructed by the B5C-X1 tests.");
  }),
}));
vi.mock("../src/execution/resolveDurableShotExecutionReadiness.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/execution/resolveDurableShotExecutionReadiness.js")>();
  return { ...original, resolveDurableShotExecutionReadiness: vi.fn(original.resolveDurableShotExecutionReadiness) };
});
vi.mock("../src/execution/createGoogleGenAiOperatorProductionDependencies.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/execution/createGoogleGenAiOperatorProductionDependencies.js")>();
  return { ...original, createGoogleGenAiOperatorProductionDependencies: vi.fn(original.createGoogleGenAiOperatorProductionDependencies) };
});
vi.mock("../src/validation/loadGoogleGenAiActivationPolicy.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/validation/loadGoogleGenAiActivationPolicy.js")>();
  return { ...original, loadGoogleGenAiActivationPolicy: vi.fn(original.loadGoogleGenAiActivationPolicy) };
});
vi.mock("../src/execution/reconcileGoogleGenAiExecutionLifecycle.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/execution/reconcileGoogleGenAiExecutionLifecycle.js")>();
  return { ...original, reconcileGoogleGenAiExecutionLifecycle: vi.fn(original.reconcileGoogleGenAiExecutionLifecycle) };
});
vi.mock("../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js")>();
  return { ...original, materializeGoogleGenAiSingleShotOutput: vi.fn(original.materializeGoogleGenAiSingleShotOutput) };
});
vi.mock("../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js")>();
  return { ...original, persistGoogleGenAiSingleShotCompletion: vi.fn(original.persistGoogleGenAiSingleShotCompletion) };
});

const { GoogleGenAI } = await import("@google/genai");

const ROOT = process.cwd();
const ACTIVATION_POLICY_SHA256 = "12c2728465972de9df3d3c0ba7fef539ad8802ae5b8161ad83c57409bd268ffb";
const INTERACTION_ID = "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM";
const SYNTHETIC_KEY = "synthetic-x1-key-not-a-secret";
const SENTINEL_KEY = "SENTINEL-X1-CREDENTIAL";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZbQAAAABJRU5ErkJggg==", "base64");
const sha256Hex = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

let episode: EpisodeManifest;
let bible: CharacterBible;
let rules: ProductionRules;
let policy: ProviderRoutingPolicy;
let enabledPolicies: GoogleGenAiOperatorPolicies;
let fetchSpy: ReturnType<typeof vi.spyOn>;
const temporaryDirectories: string[] = [];

beforeAll(async () => {
  const [loadedEpisode, loadedBible, loadedRules, loadedPolicy, activationPolicy, googlePolicy] = await Promise.all([
    loadEpisodeManifest("EP90"), loadCharacterBible(), loadProductionRules(), loadProviderRoutingPolicy(), loadGoogleGenAiActivationPolicy(), loadGoogleGenAiPolicy(),
  ]);
  [episode, bible, rules, policy] = [loadedEpisode, loadedBible, loadedRules, loadedPolicy];
  // In-memory only: the committed policy file stays newSubmissionsEnabled=false.
  enabledPolicies = { activationPolicy: { ...activationPolicy, admission: { newSubmissionsEnabled: true } }, googlePolicy };
});
beforeEach(() => {
  vi.clearAllMocks();
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Real network is forbidden in B5C-X1 tests."); });
});
afterEach(async () => {
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(vi.mocked(GoogleGenAI)).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function googleShot(nativeAudio = false, overrides: Partial<Shot> = {}): Shot {
  const shot = episode.scenes[0]!.shots.find((candidate) => candidate.id === "S01")!;
  return { ...structuredClone(shot), ...overrides, generation: { ...shot.generation, provider: "GOOGLE_GENAI", nativeAudio } };
}

function episodeWith(shot: Shot): EpisodeManifest {
  const copy = structuredClone(episode);
  copy.scenes[0]!.shots = copy.scenes[0]!.shots.map((candidate) => (candidate.id === shot.id ? shot : candidate));
  return copy;
}

// A temporary media root holding the registered, approved EP90/S01 reference (verified by the real verifier).
async function mediaRoot(): Promise<{ root: string; imagePath: string }> {
  const root = await mkdtemp(join(tmpdir(), "busybookie-x1-shared-google-"));
  temporaryDirectories.push(root);
  const imagePath = join(root, "references", "source.png");
  await mkdir(join(root, "references"));
  await writeFile(imagePath, PNG);
  const assetId = episode.scenes[0]!.shots[0]!.references.assetIds[0]!;
  await writeFile(createVisualReferenceAssetRegistryPath(root), JSON.stringify({
    schemaVersion: "1.0",
    assets: [{ assetId, mediaRootRelativePath: "references/source.png", bytes: PNG.length, sha256: sha256Hex(PNG), contentType: "image/png" }],
  }));
  return { root, imagePath };
}

async function listTree(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listTree(join(directory, entry.name), relative)));
    else files.push(relative);
  }
  return files.sort();
}

function request(root: string, imagePath: string, shot: Shot = googleShot()) {
  return { episode: episodeWith(shot), shotId: "S01", bible, rules, policy, mediaRoot: root, sourceImagePath: imagePath, confirmPaidGeneration: true };
}

type SharedOptions = Partial<{
  policies: "COMMITTED" | "ENABLED";
  createInteraction: () => Promise<{ id: unknown }>;
  createSubmission: ProductionSingleShotExecutionCompositionDependencies["createSubmission"];
  realCredentialValidation: boolean;
}>;

// Real production composition, real durable writers, real orchestrator; only the policy source (in-memory enabled
// copy), the interaction creator (fake, no SDK) and the synchronous RUNWAY/VEO executors (tripwires) are replaced.
function shared(credentials: { GEMINI_API_KEY?: string }, options: SharedOptions = {}) {
  const events: string[] = [];
  const trip = (name: string) => vi.fn(async () => { throw new Error(`${name} must not run for a GOOGLE_GENAI shot.`); });
  const createInteraction = vi.fn(options.createInteraction ?? (async () => { events.push("create"); return { id: INTERACTION_ID }; }));
  const spies = {
    createInteraction,
    createReservation: vi.fn(async (...args: Parameters<typeof createExecutionReservation>) => { events.push("reservation"); return createExecutionReservation(...args); }),
    createSubmission: vi.fn(options.createSubmission ?? (async (...args: Parameters<typeof createExecutionSubmission>) => { events.push("submission"); return createExecutionSubmission(...args); })),
    createCompletion: trip("createCompletion"),
    prepareRunwayExecutor: trip("prepareRunwayExecutor"),
    prepareVeoExecutor: trip("prepareVeoExecutor"),
    loadGooglePolicies: vi.fn(async () => { events.push("policies"); return enabledPolicies; }),
    prepareGoogleInteraction: vi.fn((apiKey: string) => { events.push("prepare"); expect(apiKey.length).toBeGreaterThan(0); return { createInteraction, submittedRecovery: {} } as never; }),
    submitGoogle: vi.fn(executeGoogleGenAiOperatorSingleShot),
  };
  const dependencies = createProductionSingleShotExecutionDependencies(credentials, {
    verifyVisualReference: createProductionVisualReferenceVerifier(),
    createReservation: spies.createReservation,
    createSubmission: spies.createSubmission,
    createCompletion: spies.createCompletion,
    prepareRunwayExecutor: spies.prepareRunwayExecutor as never,
    prepareVeoExecutor: spies.prepareVeoExecutor as never,
    ...(options.policies === "COMMITTED" ? {} : { loadGooglePolicies: spies.loadGooglePolicies }),
    ...(options.realCredentialValidation ? {} : { prepareGoogleInteraction: spies.prepareGoogleInteraction as never }),
    submitGoogle: spies.submitGoogle,
  });
  return { dependencies, spies, events };
}

async function expectOperatorRefusal(promise: Promise<unknown>, code: string, stateChange = "NONE"): Promise<void> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(GoogleGenAiOperatorError);
  expect((error as GoogleGenAiOperatorError).code).toBe(code);
  expect((error as GoogleGenAiOperatorError).stateChange).toBe(stateChange);
}

function expectNoOutputWork(): void {
  expect(vi.mocked(reconcileGoogleGenAiExecutionLifecycle)).not.toHaveBeenCalled();
  expect(vi.mocked(materializeGoogleGenAiSingleShotOutput)).not.toHaveBeenCalled();
  expect(vi.mocked(persistGoogleGenAiSingleShotCompletion)).not.toHaveBeenCalled();
}

// Offline Google endpoint fake for the published secure recovery chain (same contract as the operator CLI test).
const ORIGIN = "https://generativelanguage.googleapis.com";
const FILE_ID = "x1-shared-123";
const OUTPUT_URI = `${ORIGIN}/v1beta/files/${FILE_ID}:download?alt=media`;
const REPLAY_URL = `${ORIGIN}/v1beta/interactions/${INTERACTION_ID}?stream=true&include_input=false`;
const METADATA_URL = `${ORIGIN}/v1beta/files/${FILE_ID}`;
function makeMp4(): Buffer {
  const payload = Buffer.from("busybookie-x1-shared-output", "utf8");
  const mdat = Buffer.alloc(8);
  mdat.writeUInt32BE(8 + payload.byteLength, 0);
  mdat.write("mdat", 4, "latin1");
  return Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom", "latin1"), Buffer.from([0, 0, 2, 0]), Buffer.from("isommp41", "latin1"), mdat, payload]);
}
const OUTPUT_BYTES = makeMp4();
const frame = (event: Record<string, unknown>) => `event: ${String(event.event_type)}\ndata: ${JSON.stringify(event)}\n\n`;
const completedSse = () => [
  { event_type: "interaction.created", interaction: { id: INTERACTION_ID, status: "in_progress" } },
  { event_type: "step.start", index: 0, step: { type: "model_output" } },
  { event_type: "step.delta", index: 0, delta: { type: "video", mime_type: "video/mp4", uri: OUTPUT_URI } },
  { event_type: "step.stop", index: 0 },
  { event_type: "interaction.completed", interaction: { id: INTERACTION_ID, status: "completed" } },
].map(frame).join("");
function googleRecoveryFetch(expirationTime: string) {
  return vi.fn<GoogleGenAiFetch>(async (url) => {
    if (url === REPLAY_URL) return new Response(new TextEncoder().encode(completedSse()), { headers: { "content-type": "text/event-stream" } });
    if (url === METADATA_URL) {
      return new Response(JSON.stringify({
        name: `files/${FILE_ID}`, state: "ACTIVE", source: "GENERATED", mimeType: "video/mp4", sizeBytes: String(OUTPUT_BYTES.byteLength),
        sha256Hash: Buffer.from(sha256Hex(OUTPUT_BYTES), "ascii").toString("base64"), expirationTime,
      }), { headers: { "content-type": "application/json" } });
    }
    if (url === OUTPUT_URI) {
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(OUTPUT_BYTES)); controller.close(); } }),
        { headers: { "content-type": "video/mp4", "content-length": String(OUTPUT_BYTES.byteLength) } });
    }
    throw new Error(`Unexpected fetch target in offline test: ${url}`);
  });
}

describe("B5C-X1 shared Google async execution", () => {
  it("X1.1 readiness: an explicit GOOGLE_GENAI visual-only shot is technically EXECUTABLE without reading the activation policy", () => {
    const shot = googleShot();
    const readiness = evaluateShotExecutionReadiness(episodeWith(shot), shot, bible, rules, policy);
    expect(readiness).toMatchObject({ disposition: "EXECUTABLE", executionProvider: "GOOGLE_GENAI", blockers: [] });
    expect(readiness.reasons).toContain("S01: GOOGLE_GENAI execution readiness checks passed.");
    expect(loadGoogleGenAiActivationPolicy).not.toHaveBeenCalled();
  });

  it("X1.2 readiness: GOOGLE_GENAI with native audio or dialogue is never executable and never falls back to VEO or RUNWAY", () => {
    const audio = googleShot(true);
    expect(evaluateShotExecutionReadiness(episodeWith(audio), audio, bible, rules, policy)).toMatchObject({ disposition: "CONFLICT", executionProvider: null });
    const dialogue = googleShot(false, { type: "DIALOGUE" });
    expect(evaluateShotExecutionReadiness(episodeWith(dialogue), dialogue, bible, rules, policy)).toMatchObject({ disposition: "MANUAL_REVIEW", executionProvider: null });
  });

  it("X1.3 durable visual state: an executable GOOGLE_GENAI shot with no lifecycle is READY_FOR_GENERATION, never complete", async () => {
    const { root } = await mediaRoot();
    const shot = googleShot();
    const state = await resolveDurableShotVisualGenerationState({ episode: episodeWith(shot), shot, bible, rules, policy, mediaRoot: root });
    expect(state).toMatchObject({ state: "READY_FOR_GENERATION", provider: "GOOGLE_GENAI", readiness: { executionProvider: "GOOGLE_GENAI" } });
    expect(state).not.toHaveProperty("lifecycle");
  });

  it("X1.4 executeSingleShot delegates exactly once to the injected Google submitter (resolution 720p) and returns a discriminated SUBMITTED result", async () => {
    const { root, imagePath } = await mediaRoot();
    const submitted: SingleShotGoogleSubmittedExecution = Object.freeze({
      lifecycleState: "SUBMITTED", episodeId: "EP90", shotId: "S01", provider: "GOOGLE_GENAI", model: "gemini-omni-1.1-flash", resolution: "720p",
      expectedMicroUsd: 1, maxExpectedCostMicroUsd: 2, reservationId: "r", reservationPath: "r.json", providerExecutionId: INTERACTION_ID, submissionPath: "s.json",
    });
    const submitGoogle = vi.fn(async () => submitted);
    const dependencies = createProductionSingleShotExecutionDependencies({}, {
      createReservation: vi.fn(), createSubmission: vi.fn(), createCompletion: vi.fn(),
      prepareRunwayExecutor: vi.fn(), prepareVeoExecutor: vi.fn(), submitGoogle: submitGoogle as never,
    } as unknown as ProductionSingleShotExecutionCompositionDependencies);

    const result = await executeSingleShot(request(root, imagePath), dependencies);

    expect(submitGoogle).toHaveBeenCalledTimes(1);
    const [forwarded] = submitGoogle.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(forwarded).toMatchObject({ shotId: "S01", mediaRoot: root, sourceImagePath: imagePath, confirmPaidGeneration: true, resolution: "720p" });
    expect(Object.keys(result).sort()).toEqual(["lifecycleState", "provider", "readiness", "submitted"]);
    expect(result).toMatchObject({ provider: "GOOGLE_GENAI", lifecycleState: "SUBMITTED", readiness: { executionProvider: "GOOGLE_GENAI" } });
    if (result.provider !== "GOOGLE_GENAI") throw new Error("unreachable");
    expect(result.submitted).toBe(submitted);
    expect(Object.isFrozen(result)).toBe(true);
    // No fabricated completion/output fields on the SUBMITTED variant.
    expect(JSON.stringify(result)).not.toMatch(/completion|outputPath|outputSha256|outputBytes|completedAt|"COMPLETED"/);
  });

  it("X1.5 the Google branch bypasses the synchronous paid-provider path: no RUNWAY/VEO executor, no shared completion", async () => {
    const { root, imagePath } = await mediaRoot();
    const { dependencies, spies } = shared({ GEMINI_API_KEY: SYNTHETIC_KEY });
    await executeSingleShot(request(root, imagePath), dependencies);
    expect(spies.prepareRunwayExecutor).not.toHaveBeenCalled();
    expect(spies.prepareVeoExecutor).not.toHaveBeenCalled();
    expect(spies.createCompletion).not.toHaveBeenCalled();
    expect(spies.createReservation.mock.calls.map((call) => call[1].provider)).toEqual(["GOOGLE_GENAI"]);
    const source = (await readFile(join(ROOT, "src/execution/executeSingleShot.ts"), "utf8")).replace(/\r/g, "");
    expect(source.indexOf('"GOOGLE_GENAI"')).toBeGreaterThan(-1);
    expect(source.indexOf('"GOOGLE_GENAI"')).toBeLessThan(source.indexOf("requirePaidProvider(\n      readiness"));
  });

  it("X1.6 a GOOGLE_GENAI shot without the injected Google submitter fails closed with zero writes and no RUNWAY|VEO cast", async () => {
    const { root, imagePath } = await mediaRoot();
    const before = await listTree(root);
    const trip = (name: string) => vi.fn(async () => { throw new Error(`${name} must not run.`); });
    const dependencies = {
      verifyVisualReference: trip("verifyVisualReference"), createReservation: trip("createReservation"), createSubmission: trip("createSubmission"),
      createCompletion: trip("createCompletion"), executeRunway: trip("executeRunway"), executeVeo: trip("executeVeo"),
    } satisfies SingleShotExecutionDependencies;
    await expect(executeSingleShot(request(root, imagePath), dependencies)).rejects.toThrow("Single-shot execution blocked: S01 has no shared Google submission dependency.");
    for (const spy of Object.values(dependencies)) expect(spy).not.toHaveBeenCalled();
    expect(await listTree(root)).toEqual(before);
  });

  it("X1.7 the real committed policy (false) refuses NEW_SUBMISSIONS_DISABLED before credential, lifecycle, reservation or create", async () => {
    const bytes = await readFile(join(ROOT, "config", "google-genai-activation-policy.json"));
    expect(sha256Hex(bytes)).toBe(ACTIVATION_POLICY_SHA256);
    expect(JSON.parse(bytes.toString("utf8"))).toMatchObject({ admission: { newSubmissionsEnabled: false } });
    for (const credentials of [{}, { GEMINI_API_KEY: "" }, { GEMINI_API_KEY: SYNTHETIC_KEY }]) {
      const { root, imagePath } = await mediaRoot();
      const before = await listTree(root);
      const { dependencies, spies } = shared(credentials, { policies: "COMMITTED", realCredentialValidation: true });
      await expectOperatorRefusal(executeSingleShot(request(root, imagePath), dependencies), "NEW_SUBMISSIONS_DISABLED");
      expect(createGoogleGenAiOperatorProductionDependencies).not.toHaveBeenCalled();
      expect(spies.createReservation).not.toHaveBeenCalled();
      expect(spies.createInteraction).not.toHaveBeenCalled();
      expect(spies.createSubmission).not.toHaveBeenCalled();
      expect(await inspectExecutionLifecycle(root, "EP90", "S01")).toEqual({ state: "NOTHING" });
      expect(await listTree(root)).toEqual(before);
    }
    expect(loadGoogleGenAiActivationPolicy).toHaveBeenCalledTimes(3);
    expect(sha256Hex(await readFile(join(ROOT, "config", "google-genai-activation-policy.json")))).toBe(ACTIVATION_POLICY_SHA256);
    expectNoOutputWork();
  });

  it("X1.8 activation enabled in memory: one reservation, one create, one durable submission, zero completion, SUBMITTED only after the durable record", async () => {
    const { root, imagePath } = await mediaRoot();
    const before = await listTree(root);
    const { dependencies, spies, events } = shared({ GEMINI_API_KEY: SYNTHETIC_KEY });

    const result = await executeSingleShot(request(root, imagePath), dependencies);
    events.push("returned");

    expect(events).toEqual(["policies", "prepare", "reservation", "create", "submission", "returned"]);
    expect(spies.createReservation).toHaveBeenCalledTimes(1);
    expect(spies.createInteraction).toHaveBeenCalledTimes(1);
    expect(spies.createSubmission).toHaveBeenCalledTimes(1);
    expect(spies.createCompletion).not.toHaveBeenCalled();
    expect(result).toMatchObject({ provider: "GOOGLE_GENAI", lifecycleState: "SUBMITTED" });
    if (result.provider !== "GOOGLE_GENAI") throw new Error("unreachable");
    expect(result.submitted).toMatchObject({ lifecycleState: "SUBMITTED", provider: "GOOGLE_GENAI", episodeId: "EP90", shotId: "S01", providerExecutionId: INTERACTION_ID, resolution: "720p" });
    expect(JSON.parse(await readFile(result.submitted.submissionPath, "utf8"))).toMatchObject({ provider: "GOOGLE_GENAI", providerExecutionId: INTERACTION_ID, reservationId: result.submitted.reservationId });

    // Immediate shared inspection from disk.
    const lifecycle = await inspectExecutionLifecycle(root, "EP90", "S01");
    expect(lifecycle.state).toBe("SUBMITTED");
    if (lifecycle.state !== "SUBMITTED") throw new Error("unreachable");
    expect(lifecycle.reservation.provider).toBe("GOOGLE_GENAI");
    expect(lifecycle.submission).toMatchObject({ provider: "GOOGLE_GENAI", providerExecutionId: INTERACTION_ID });
    const shot = googleShot();
    expect(await resolveDurableShotVisualGenerationState({ episode: episodeWith(shot), shot, bible, rules, policy, mediaRoot: root }))
      .toMatchObject({ state: "SUBMITTED_RECONCILIATION_REQUIRED" });
    // Exactly the two durable lifecycle records were written: no completion record, no generation record, no media.
    const toRelative = (path: string) => relative(root, path).split(sep).join("/");
    const written = (await listTree(root)).filter((file) => !before.includes(file));
    expect(written).toEqual([toRelative(createExecutionReservationPath(root, "EP90", "S01")), toRelative(createExecutionSubmissionPath(root, "EP90", "S01"))].sort());
    expect(written.map((file) => toRelative(join(root, file)))).not.toContain(toRelative(createExecutionCompletionPath(root, "EP90", "S01")));
    expect(written.some((file) => /\.mp4$|generation\.json$/.test(file))).toBe(false);
    expectNoOutputWork();
  });

  it("X1.9 restart: fresh modules and fresh dependencies see SUBMITTED from disk, and a second execute creates no second job", async () => {
    const { root, imagePath } = await mediaRoot();
    const first = shared({ GEMINI_API_KEY: SYNTHETIC_KEY });
    await executeSingleShot(request(root, imagePath), first.dependencies);
    expect(first.spies.createInteraction).toHaveBeenCalledTimes(1);

    vi.resetModules();
    const freshInspector = await import("../src/execution/inspectExecutionLifecycle.js");
    expect((await freshInspector.inspectExecutionLifecycle(root, "EP90", "S01")).state).toBe("SUBMITTED");

    const second = shared({ GEMINI_API_KEY: SYNTHETIC_KEY });
    await expectOperatorRefusal(executeSingleShot(request(root, imagePath), second.dependencies), "LIFECYCLE_EXISTS");
    expect(second.spies.createReservation).not.toHaveBeenCalled();
    expect(first.spies.createInteraction.mock.calls.length + second.spies.createInteraction.mock.calls.length).toBe(1);
    expect((await inspectExecutionLifecycle(root, "EP90", "S01")).state).toBe("SUBMITTED");
    expectNoOutputWork();
  });

  it("X1.10 crash windows fail closed: RESERVED_ONLY, ambiguous create and accepted-record failure never re-create or return SUBMITTED", async () => {
    // W1: a GOOGLE_GENAI reservation without an accepted submission.
    const w1 = await mediaRoot();
    await createExecutionReservation(w1.root, { episodeId: "EP90", shotId: "S01", provider: "GOOGLE_GENAI" });
    const w1Run = shared({ GEMINI_API_KEY: SYNTHETIC_KEY });
    await expectOperatorRefusal(executeSingleShot(request(w1.root, w1.imagePath), w1Run.dependencies), "LIFECYCLE_EXISTS");
    expect(w1Run.spies.createInteraction).not.toHaveBeenCalled();
    const shot = googleShot();
    expect(await resolveDurableShotVisualGenerationState({ episode: episodeWith(shot), shot, bible, rules, policy, mediaRoot: w1.root }))
      .toMatchObject({ state: "RESERVED_ONLY_INTERVENTION_REQUIRED" });

    // W2: the create outcome is ambiguous (lost response).
    const w2 = await mediaRoot();
    const w2Run = shared({ GEMINI_API_KEY: SYNTHETIC_KEY }, { createInteraction: async () => { throw new Error("connection reset after send"); } });
    await expectOperatorRefusal(executeSingleShot(request(w2.root, w2.imagePath), w2Run.dependencies), "SUBMISSION_ACCEPTANCE_UNCERTAIN", "RESERVED_ONLY");
    expect(w2Run.spies.createInteraction).toHaveBeenCalledTimes(1);
    const w2Rerun = shared({ GEMINI_API_KEY: SYNTHETIC_KEY });
    await expectOperatorRefusal(executeSingleShot(request(w2.root, w2.imagePath), w2Rerun.dependencies), "LIFECYCLE_EXISTS");
    expect(w2Rerun.spies.createInteraction).not.toHaveBeenCalled();
    expect((await inspectExecutionLifecycle(w2.root, "EP90", "S01")).state).toBe("RESERVED_ONLY");

    // W3: the provider accepted, but the durable accepted-submission record could not be written.
    const w3 = await mediaRoot();
    const w3Run = shared({ GEMINI_API_KEY: SYNTHETIC_KEY }, { createSubmission: async () => { throw new Error("disk full"); } });
    const outcome = await executeSingleShot(request(w3.root, w3.imagePath), w3Run.dependencies).then((value) => value, (error: unknown) => error);
    expect(outcome).toBeInstanceOf(GoogleGenAiOperatorError);
    expect((outcome as GoogleGenAiOperatorError).code).toBe("DURABLE_SUBMISSION_FAILED");
    expect(w3Run.spies.createInteraction).toHaveBeenCalledTimes(1);
    const w3Rerun = shared({ GEMINI_API_KEY: SYNTHETIC_KEY });
    await expectOperatorRefusal(executeSingleShot(request(w3.root, w3.imagePath), w3Rerun.dependencies), "LIFECYCLE_EXISTS");
    expect(w3Rerun.spies.createInteraction).not.toHaveBeenCalled();
    expect((await inspectExecutionLifecycle(w3.root, "EP90", "S01")).state).toBe("RESERVED_ONLY");
    for (const run of [w1Run, w2Run, w2Rerun, w3Run, w3Rerun]) {
      expect(run.spies.prepareRunwayExecutor).not.toHaveBeenCalled();
      expect(run.spies.prepareVeoExecutor).not.toHaveBeenCalled();
      expect(run.spies.createCompletion).not.toHaveBeenCalled();
    }
    expectNoOutputWork();
  });

  it("X1.11 activation enabled but the Gemini credential is missing or invalid: refusal before any reservation or client", async () => {
    for (const credentials of [{}, { GEMINI_API_KEY: "" }]) {
      const { root, imagePath } = await mediaRoot();
      const { dependencies, spies } = shared(credentials, { realCredentialValidation: true });
      await expectOperatorRefusal(executeSingleShot(request(root, imagePath), dependencies), "CREDENTIAL_INVALID");
      expect(spies.loadGooglePolicies).toHaveBeenCalledTimes(1);
      expect(spies.createReservation).not.toHaveBeenCalled();
      expect(spies.createInteraction).not.toHaveBeenCalled();
      expect(await inspectExecutionLifecycle(root, "EP90", "S01")).toEqual({ state: "NOTHING" });
    }
  });

  it("X1.12 the shared CLI reports SUBMITTED with the durable submission record, never completed, and never prints the credential", async () => {
    const { root, imagePath } = await mediaRoot();
    const googleEpisode = episodeWith(googleShot());
    let composed: ReturnType<typeof shared> | undefined;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dependencies: RunSingleShotExecutionCliDependencies = {
      loadEnvironment: () => ({ BUSYBOOKIE_MEDIA_ROOT: root, GEMINI_API_KEY: SENTINEL_KEY }),
      loadEpisodeManifest: async () => googleEpisode,
      loadCharacterBible: async () => bible,
      loadProductionRules,
      loadProviderRoutingPolicy,
      validateEpisodeProduction,
      validateMediaRoot: vi.fn(async () => root),
      inspectExecutionLifecycle,
      createDependencies: (credentials) => { composed = shared(credentials); return composed.dependencies; },
      executeSingleShot,
    };

    await runSingleShotExecutionCli(["--episode", "EP90", "--shot", "S01", "--image", imagePath, "--confirm-paid-generation"], dependencies);

    const lifecycle = await inspectExecutionLifecycle(root, "EP90", "S01");
    if (lifecycle.state !== "SUBMITTED") throw new Error(`expected SUBMITTED, got ${lifecycle.state}`);
    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines).toEqual([
      "Single-shot execution submitted: EP90/S01 (GOOGLE_GENAI)",
      `Provider execution: ${INTERACTION_ID}`,
      `Submission record: ${createExecutionSubmissionPath(root, "EP90", "S01")}`,
      "Reconcile later with npm run execution:reconcile -- --episode EP90 --shot S01. Do not resubmit.",
    ]);
    const output = [...lines, ...error.mock.calls.map((call) => String(call[0]))].join("\n");
    expect(output).not.toMatch(/completed|Completion record/i);
    expect(output).not.toContain(SENTINEL_KEY);
    expect(composed?.spies.prepareGoogleInteraction).toHaveBeenCalledExactlyOnceWith(SENTINEL_KEY);
    expectNoOutputWork();
  });

  it("X1.13 R1 handoff: the published shared reconcile path completes the X1-created records, and re-execution after COMPLETED creates nothing", async () => {
    const { root, imagePath } = await mediaRoot();
    const first = shared({ GEMINI_API_KEY: SYNTHETIC_KEY });
    await executeSingleShot(request(root, imagePath), first.dependencies);
    const submitted = await inspectExecutionLifecycle(root, "EP90", "S01");
    if (submitted.state !== "SUBMITTED") throw new Error("unreachable");
    const submittedAtMs = Date.parse(submitted.submission.submittedAt);
    const fetchImpl = googleRecoveryFetch(new Date(submittedAtMs + 2 * 86_400_000).toISOString());
    const trip = (name: string) => vi.fn(() => { throw new Error(`${name} must not run for a Google lifecycle.`); });
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runExecutionReconcileCli(["--episode", "EP90", "--shot", "S01"], {
      loadEnvironment: vi.fn(() => ({ BUSYBOOKIE_MEDIA_ROOT: root, GEMINI_API_KEY: SYNTHETIC_KEY })),
      loadProductionRules: vi.fn(async () => rules),
      resolveMediaRoot: vi.fn(() => root),
      inspectLifecycle: vi.fn(inspectExecutionLifecycle),
      reconcileLifecycle: trip("shared reconcileLifecycle"),
      loadRunwayPolicy: trip("loadRunwayPolicy"),
      loadVeoPolicy: trip("loadVeoPolicy"),
      reconcileGoogleLifecycle: reconcileGoogleGenAiExecutionLifecycle,
      createGoogleSubmittedRecovery: (apiKey: string) =>
        createGoogleGenAiSingleShotSecureProductionRecovery(apiKey, { fetchImpl, nowMs: () => submittedAtMs + 19 * 60_000, monotonicNowMs: () => 0 }),
    } as unknown as RunExecutionReconcileCliDependencies);

    expect(vi.mocked(reconcileGoogleGenAiExecutionLifecycle)).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const completed = await inspectExecutionLifecycle(root, "EP90", "S01");
    expect(completed.state).toBe("COMPLETED");
    if (completed.state !== "COMPLETED") throw new Error("unreachable");
    expect(completed.reservation.provider).toBe("GOOGLE_GENAI");
    expect(completed.submission.providerExecutionId).toBe(INTERACTION_ID);

    const again = shared({ GEMINI_API_KEY: SYNTHETIC_KEY });
    await expectOperatorRefusal(executeSingleShot(request(root, imagePath), again.dependencies), "LIFECYCLE_EXISTS");
    expect(again.spies.createReservation).not.toHaveBeenCalled();
    expect(again.spies.createInteraction).not.toHaveBeenCalled();
    expect(first.spies.createInteraction).toHaveBeenCalledTimes(1);
  });

  it("X1.14 RUNWAY and VEO keep the synchronous COMPLETED result shape and never prepare Google", async () => {
    const shapes: string[][] = [];
    for (const provider of ["RUNWAY", "VEO"] as const) {
      const { root, imagePath } = await mediaRoot();
      const shot = { ...googleShot(), generation: { ...googleShot().generation, provider } };
      vi.mocked(resolveDurableShotExecutionReadiness).mockResolvedValueOnce({ disposition: "EXECUTABLE", executionProvider: provider, routing: {} as never, reasons: [], blockers: [] });
      const executor = vi.fn(async (input: Parameters<SingleShotExecutionDependencies["executeRunway"]>[0]) => {
        await input.onSubmissionAccepted(provider === "RUNWAY"
          ? { provider, providerExecutionId: "sync-1", providerEstimatedCredits: 1, recoveryMetadata: {} as never }
          : { provider, providerExecutionId: "sync-1", recoveryMetadata: {} as never });
        return { providerExecutionId: "sync-1", recordPath: "record.json" };
      });
      const submitGoogle = vi.fn();
      const dependencies = createProductionSingleShotExecutionDependencies({}, {
        verifyVisualReference: async () => ({ absolutePath: imagePath }),
        createReservation: vi.fn(async () => ({ record: { reservationId: "res-1" } }) as never),
        createSubmission: vi.fn(async () => ({ marker: "submission" }) as never),
        createCompletion: vi.fn(async () => ({ completionPath: "completion.json" }) as never),
        prepareRunwayExecutor: vi.fn(async () => executor) as never,
        prepareVeoExecutor: vi.fn(async () => executor) as never,
        loadGooglePolicies: vi.fn(),
        prepareGoogleInteraction: vi.fn() as never,
        submitGoogle: submitGoogle as never,
      });
      const result = await executeSingleShot(request(root, imagePath, shot), dependencies);
      expect(result.provider).toBe(provider);
      expect(result).not.toHaveProperty("lifecycleState");
      shapes.push(Object.keys(result).sort());
      expect(submitGoogle).not.toHaveBeenCalled();
      expect(executor).toHaveBeenCalledTimes(1);
    }
    expect(shapes).toEqual([
      ["completion", "provider", "providerExecution", "readiness", "reservation", "submission"],
      ["completion", "provider", "providerExecution", "readiness", "reservation", "submission"],
    ]);
  });

  it("X1.15 boundaries: one shared seam reaches the orchestrator, the shared branch is Google-module-free, and the sync provider domain is unwidened", async () => {
    const types = await readFile(join(ROOT, "src/execution/singleShotExecution.types.ts"), "utf8");
    expect(types).toMatch(/export type PaidExecutionProvider =\s*\|\s*"RUNWAY"\s*\|\s*"VEO";/);
    const execute = (await readFile(join(ROOT, "src/execution/executeSingleShot.ts"), "utf8")).replace(/\r/g, "");
    expect(execute).toMatch(/case "RUNWAY":\s*case "VEO":\s*return provider;/);
    expect([...execute.matchAll(/from "([^"]+)"/g)].map((match) => match[1])).toEqual([
      "../schemas/episodeManifest.schema.js", "./resolveDurableShotExecutionReadiness.js", "./singleShotExecution.types.js",
    ]);
    const googleBranch = execute.slice(execute.indexOf('"GOOGLE_GENAI"'), execute.indexOf("requirePaidProvider(\n      readiness"));
    expect(googleBranch).not.toMatch(/reconcile|materializ|download|retriev|createCompletion|createReservation|setInterval|setTimeout|while\s*\(|poll|executeRunway|executeVeo/);
    for (const file of ["src/execution/executeSingleShot.ts", "src/execution/singleShotExecution.types.ts", "src/execution/cli/runSingleShotExecutionCli.ts"]) {
      expect(await readFile(join(ROOT, file), "utf8"), file).not.toMatch(/@google\/genai|GoogleGenAi|googleGenai|newSubmissionsEnabled|ActivationPolicy|\bfetch\s*\(/);
    }
    const importers: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(join(ROOT, directory), { withFileTypes: true })) {
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) await walk(relative);
        else if (relative.endsWith(".ts") && /executeGoogleGenAiOperatorSingleShot\.js["']/.test(await readFile(join(ROOT, relative), "utf8"))) importers.push(relative);
      }
    };
    await walk("src");
    await walk("scripts");
    expect(importers.sort()).toEqual(["src/execution/cli/runGoogleGenAiOperatorCli.ts", "src/execution/createProductionSingleShotExecutionDependencies.ts"]);
    const bytes = await readFile(join(ROOT, "config", "google-genai-activation-policy.json"));
    expect(sha256Hex(bytes)).toBe(ACTIVATION_POLICY_SHA256);
    expect(JSON.parse(bytes.toString("utf8"))).toMatchObject({ admission: { newSubmissionsEnabled: false } });
  });
});
