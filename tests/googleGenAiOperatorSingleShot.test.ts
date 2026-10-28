import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionReservation } from "../src/execution/createExecutionReservation.js";
import { createExecutionSubmission } from "../src/execution/createExecutionSubmission.js";
import { createExecutionReservationPath } from "../src/execution/executionReservationPath.js";
import {
  executeGoogleGenAiOperatorSingleShot,
  GoogleGenAiOperatorError,
  type GoogleGenAiOperatorErrorCode,
  type GoogleGenAiOperatorExecuteDependencies,
  type GoogleGenAiOperatorExecuteRequest,
  type GoogleGenAiOperatorPolicies,
} from "../src/execution/executeGoogleGenAiOperatorSingleShot.js";
import { inspectExecutionLifecycle } from "../src/execution/inspectExecutionLifecycle.js";
import { buildGoogleGenAiSingleShotPrompt } from "../src/execution/providers/buildGoogleGenAiSingleShotPrompt.js";
import type { GoogleGenAiSingleShotInteractionRequest } from "../src/execution/providers/submitGoogleGenAiSingleShot.js";
import { materializeGoogleGenAiSingleShotOutput } from "../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js";
import { persistGoogleGenAiSingleShotCompletion } from "../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js";
import { reconcileGoogleGenAiExecutionLifecycle } from "../src/execution/reconcileGoogleGenAiExecutionLifecycle.js";
import type { CharacterBible } from "../src/schemas/character.schema.js";
import type { EpisodeManifest, Shot } from "../src/schemas/episodeManifest.schema.js";
import type { GoogleGenAiPolicy } from "../src/schemas/googleGenAiPolicy.schema.js";
import type { ProductionRules } from "../src/schemas/productionRules.schema.js";
import { loadCharacterBible } from "../src/validation/loadCharacterBible.js";
import { loadEpisodeManifest } from "../src/validation/loadEpisodeManifest.js";
import { loadGoogleGenAiActivationPolicy, type LoadedGoogleGenAiActivationPolicy } from "../src/validation/loadGoogleGenAiActivationPolicy.js";
import { loadGoogleGenAiPolicy } from "../src/validation/loadGoogleGenAiPolicy.js";
import { loadProductionRules } from "../src/validation/loadProductionRules.js";

// Execution must stop at SUBMITTED: the recovery chain is observed and must stay untouched.
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
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(() => {
    throw new Error("The real Google SDK must never be constructed by the operator orchestrator tests.");
  }),
}));

const INTERACTION_ID = "v1_b4x2-synthetic-interaction";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("busybookie-b4x2", "utf8")]);
const SECRET_SENTINEL = "SENTINEL-SECRET-b4x2";

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
  expect(vi.mocked(reconcileGoogleGenAiExecutionLifecycle)).not.toHaveBeenCalled();
  expect(vi.mocked(materializeGoogleGenAiSingleShotOutput)).not.toHaveBeenCalled();
  expect(vi.mocked(persistGoogleGenAiSingleShotCompletion)).not.toHaveBeenCalled();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function enabledPolicies(overrides: Partial<{ activation: LoadedGoogleGenAiActivationPolicy; google: GoogleGenAiPolicy }> = {}): GoogleGenAiOperatorPolicies {
  return {
    activationPolicy: overrides.activation ?? { ...committedActivationPolicy, admission: { newSubmissionsEnabled: true } },
    googlePolicy: overrides.google ?? googlePolicy,
  };
}

function episodeWith(mutate: (shot: Shot, episode: EpisodeManifest) => void = () => undefined): EpisodeManifest {
  const episode = structuredClone(baseEpisode);
  mutate(episode.scenes[0]!.shots[0]!, episode);
  return episode;
}

async function mediaRootWithImage(name = "reference.png", bytes: Uint8Array = PNG): Promise<{ mediaRoot: string; imagePath: string }> {
  const mediaRoot = await mkdtemp(join(tmpdir(), "busybookie-b4x2-operator-"));
  temporaryDirectories.push(mediaRoot);
  const imagePath = join(mediaRoot, "references", "EP90", "S01", name);
  await mkdir(dirname(imagePath), { recursive: true });
  await writeFile(imagePath, bytes);
  return { mediaRoot, imagePath };
}

type Harness = Readonly<{
  request: GoogleGenAiOperatorExecuteRequest;
  dependencies: GoogleGenAiOperatorExecuteDependencies;
  events: string[];
  createInteraction: ReturnType<typeof vi.fn>;
  calls: () => Readonly<{ policies: number; prepare: number; inspect: number; verify: number; reservations: number; creates: number; submissions: number }>;
}>;

async function harness(options: Partial<{
  episode: EpisodeManifest;
  rules: ProductionRules;
  policies: GoogleGenAiOperatorPolicies;
  resolution: string;
  confirm: boolean;
  imageName: string;
  imageBytes: Uint8Array;
  mediaRoot: string;
  imagePath: string;
  createInteraction: (request: GoogleGenAiSingleShotInteractionRequest) => Promise<{ id: unknown }>;
  dependencies: Partial<GoogleGenAiOperatorExecuteDependencies>;
}> = {}): Promise<Harness> {
  const created = options.mediaRoot === undefined ? await mediaRootWithImage(options.imageName, options.imageBytes) : undefined;
  const mediaRoot = options.mediaRoot ?? created!.mediaRoot;
  const imagePath = options.imagePath ?? created!.imagePath;
  const events: string[] = [];
  const createInteraction = vi.fn(options.createInteraction ?? (async () => ({ id: INTERACTION_ID })));
  const loadPolicies = vi.fn(async () => { events.push("policies"); return options.policies ?? enabledPolicies(); });
  const prepareSubmission = vi.fn(() => {
    events.push("prepare");
    return { createInteraction: async (request: GoogleGenAiSingleShotInteractionRequest) => { events.push("create"); return createInteraction(request); } };
  });
  const inspectLifecycle = vi.fn(async (...args: Parameters<typeof inspectExecutionLifecycle>) => { events.push("inspect"); return inspectExecutionLifecycle(...args); });
  const verifyVisualReference = vi.fn(async () => { events.push("verify"); return { absolutePath: imagePath }; });
  const createReservation = vi.fn(async (...args: Parameters<typeof createExecutionReservation>) => { events.push("reservation"); return createExecutionReservation(...args); });
  const createSubmission = vi.fn(async (...args: Parameters<typeof createExecutionSubmission>) => { events.push("submission"); return createExecutionSubmission(...args); });
  const dependencies: GoogleGenAiOperatorExecuteDependencies = {
    loadPolicies, prepareSubmission, inspectLifecycle, verifyVisualReference, createReservation, createSubmission,
    ...options.dependencies,
  };
  const request: GoogleGenAiOperatorExecuteRequest = {
    episode: options.episode ?? episodeWith(), shotId: "S01", bible, rules: options.rules ?? rules,
    mediaRoot, sourceImagePath: imagePath, resolution: options.resolution ?? "720p", confirmPaidGeneration: options.confirm ?? true,
  };
  return {
    request, dependencies, events, createInteraction,
    calls: () => ({
      policies: loadPolicies.mock.calls.length, prepare: prepareSubmission.mock.calls.length, inspect: inspectLifecycle.mock.calls.length,
      verify: verifyVisualReference.mock.calls.length, reservations: createReservation.mock.calls.length,
      creates: createInteraction.mock.calls.length, submissions: createSubmission.mock.calls.length,
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

async function expectRefusedBeforeReservation(h: Harness, code: GoogleGenAiOperatorErrorCode): Promise<void> {
  await expectOperatorError(executeGoogleGenAiOperatorSingleShot(h.request, h.dependencies), code);
  const calls = h.calls();
  expect(calls.reservations).toBe(0);
  expect(calls.creates).toBe(0);
  expect(calls.submissions).toBe(0);
  expect(await inspectExecutionLifecycle(h.request.mediaRoot, "EP90", "S01")).toEqual({ state: "NOTHING" });
}

describe("operator-only Google execute: synthetic success", () => {
  it("admits, reserves, creates exactly once, records the durable submission and stops at SUBMITTED", async () => {
    const h = await harness();
    const result = await executeGoogleGenAiOperatorSingleShot(h.request, h.dependencies);

    expect(result).toMatchObject({
      lifecycleState: "SUBMITTED", episodeId: "EP90", shotId: "S01", provider: "GOOGLE_GENAI", model: "gemini-omni-1.1-flash",
      resolution: "720p", expectedMicroUsd: 1_513_600, maxExpectedCostMicroUsd: 2_000_000, providerExecutionId: INTERACTION_ID,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(h.events).toEqual(["policies", "prepare", "inspect", "verify", "reservation", "create", "submission"]);
    expect(h.calls()).toEqual({ policies: 1, prepare: 1, inspect: 1, verify: 1, reservations: 1, creates: 1, submissions: 1 });

    const lifecycle = await inspectExecutionLifecycle(h.request.mediaRoot, "EP90", "S01");
    expect(lifecycle.state).toBe("SUBMITTED");
    if (lifecycle.state !== "SUBMITTED") throw new Error("unreachable");
    expect(lifecycle.reservation.provider).toBe("GOOGLE_GENAI");
    expect(lifecycle.submission).toMatchObject({ provider: "GOOGLE_GENAI", providerExecutionId: INTERACTION_ID, reservationId: result.reservationId });
    expect(JSON.parse(await readFile(result.submissionPath, "utf8"))).toMatchObject({ providerExecutionId: INTERACTION_ID });

    const [interactionRequest] = h.createInteraction.mock.calls[0]! as [GoogleGenAiSingleShotInteractionRequest];
    expect(interactionRequest.model).toBe("gemini-omni-1.1-flash");
    expect(interactionRequest.response_format).toEqual({ type: "video", delivery: "uri", resolution: "720p" });
    expect(interactionRequest.input[0]).toEqual({ type: "text", text: buildGoogleGenAiSingleShotPrompt(baseEpisode.scenes[0]!.shots[0]!) });
    expect(interactionRequest.input[1]).toMatchObject({ type: "image", mime_type: "image/png", data: PNG.toString("base64") });
    expect(JSON.stringify(interactionRequest)).not.toContain("durationSeconds");
  });

  it("admits the exact 10-second duration limit", async () => {
    const h = await harness({ episode: episodeWith((shot) => { shot.durationSeconds = 10; }) });
    await expect(executeGoogleGenAiOperatorSingleShot(h.request, h.dependencies)).resolves.toMatchObject({ lifecycleState: "SUBMITTED" });
  });

  it("never mutates the manifest provider: a RUNWAY manifest shot is executed only as a GOOGLE_GENAI lifecycle", async () => {
    const episode = episodeWith();
    const snapshot = JSON.stringify(episode);
    const h = await harness({ episode });
    await executeGoogleGenAiOperatorSingleShot(h.request, h.dependencies);
    expect(JSON.stringify(episode)).toBe(snapshot);
    expect(episode.scenes[0]!.shots[0]!.generation.provider).toBe("RUNWAY");
  });
});

describe("operator-only Google execute: deterministic admission precedes the reservation", () => {
  it("refuses with the committed default-off policy before any credential, lifecycle, reservation or create", async () => {
    expect(committedActivationPolicy.admission.newSubmissionsEnabled).toBe(false);
    const h = await harness({ policies: { activationPolicy: committedActivationPolicy, googlePolicy } });
    await expectRefusedBeforeReservation(h, "NEW_SUBMISSIONS_DISABLED");
    expect(h.events).toEqual(["policies"]);
  });

  it.each([
    ["10.01 seconds", 10.01],
    ["11 seconds", 11],
    ["30 seconds", 30],
  ])("refuses a %s duration without rounding or truncation", async (_label, seconds) => {
    const h = await harness({ episode: episodeWith((shot) => { shot.durationSeconds = seconds; }) });
    await expectRefusedBeforeReservation(h, "DURATION_EXCEEDS_LIMIT");
  });

  it.each(["1080p", "360p", "4k", "720P", ""])("refuses resolution %j", async (resolution) => {
    const h = await harness({ resolution });
    await expectRefusedBeforeReservation(h, "RESOLUTION_UNSUPPORTED");
  });

  it("refuses when the authoritative 720p price is missing", async () => {
    const pricing: Record<string, unknown> = { ...googlePolicy.pricing };
    delete pricing.knownVideoOutput720pMicroUsdPerSecond;
    const h = await harness({ policies: enabledPolicies({ google: { ...googlePolicy, pricing } as unknown as GoogleGenAiPolicy }) });
    await expectRefusedBeforeReservation(h, "PRICING_UNAVAILABLE");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5])("refuses a non-finite or invalid price (%s)", async (rate) => {
    const h = await harness({ policies: enabledPolicies({ google: { ...googlePolicy, pricing: { ...googlePolicy.pricing, knownVideoOutput720pMicroUsdPerSecond: rate } } }) });
    await expectRefusedBeforeReservation(h, "CALCULATION_FAILED");
  });

  it("refuses an expected cost above the cap", async () => {
    // Hostile fixture: the schema pins the cap, so an injected lower cap is the only way to exceed it.
    const activation = { ...committedActivationPolicy, admission: { newSubmissionsEnabled: true }, cost: { ...committedActivationPolicy.cost, maxExpectedCostMicroUsd: 1_513_599 } } as unknown as LoadedGoogleGenAiActivationPolicy;
    const h = await harness({ policies: enabledPolicies({ activation }) });
    await expectRefusedBeforeReservation(h, "COST_EXCEEDS_CAP");
  });

  it("refuses native audio", async () => {
    const h = await harness({ episode: episodeWith((shot) => { shot.generation = { ...shot.generation, provider: "VEO", nativeAudio: true }; }) });
    await expectRefusedBeforeReservation(h, "NATIVE_AUDIO_REJECTED");
  });

  it("refuses dialogue lines without stripping them", async () => {
    const episode = episodeWith((shot) => { shot.characters = ["OLLIE"]; shot.dialogue = [{ characterId: "OLLIE", text: "Hello!" }]; });
    const h = await harness({ episode });
    await expectRefusedBeforeReservation(h, "DIALOGUE_REJECTED");
    expect(episode.scenes[0]!.shots[0]!.dialogue).toHaveLength(1);
  });

  it("refuses a DIALOGUE shot type", async () => {
    const h = await harness({ episode: episodeWith((shot) => { shot.type = "DIALOGUE"; }) });
    await expectRefusedBeforeReservation(h, "DIALOGUE_REJECTED");
  });

  it("refuses a MUSICAL shot type", async () => {
    const h = await harness({ episode: episodeWith((shot) => { shot.type = "MUSICAL"; }) });
    await expectRefusedBeforeReservation(h, "AUDIO_DEPENDENT_SHOT_TYPE_REJECTED");
  });

  it("refuses a MANUAL manifest provider", async () => {
    const h = await harness({ episode: episodeWith((shot) => { shot.generation = { ...shot.generation, provider: "MANUAL" }; }) });
    await expectRefusedBeforeReservation(h, "MANIFEST_PROVIDER_NOT_PAID");
  });

  it("refuses a KREA manifest provider even when production rules enable it", async () => {
    const kreaRules = { ...rules, generation: { ...rules.generation, supportedProviders: [...rules.generation.supportedProviders, "KREA" as const] } };
    const h = await harness({ rules: kreaRules, episode: episodeWith((shot) => { shot.generation = { ...shot.generation, provider: "KREA" }; }) });
    await expectRefusedBeforeReservation(h, "MANIFEST_PROVIDER_NOT_PAID");
  });

  it("admits an explicit GOOGLE_GENAI manifest provider (B5C-X1) and still creates exactly once", async () => {
    const h = await harness({ episode: episodeWith((shot) => { shot.generation = { ...shot.generation, provider: "GOOGLE_GENAI" }; }) });
    await expect(executeGoogleGenAiOperatorSingleShot(h.request, h.dependencies)).resolves.toMatchObject({ lifecycleState: "SUBMITTED", provider: "GOOGLE_GENAI" });
    expect(h.calls()).toMatchObject({ reservations: 1, creates: 1, submissions: 1 });
  });

  it("refuses a shot that is not APPROVED_FOR_GENERATION", async () => {
    const h = await harness({ episode: episodeWith((shot) => { shot.generation = { ...shot.generation, status: "READY_FOR_APPROVAL" }; }) });
    await expectRefusedBeforeReservation(h, "SHOT_STATUS_NOT_APPROVED");
  });

  it("refuses a shot without a required approved reference", async () => {
    const h = await harness({ episode: episodeWith((shot) => { shot.references = { required: false, assetIds: [], approvalStatus: "NOT_REQUIRED" }; }) });
    await expectRefusedBeforeReservation(h, "REFERENCES_NOT_APPROVED");
  });

  it("refuses an episode that is not in a live generation status", async () => {
    const h = await harness({ episode: episodeWith((_shot, episode) => { episode.status = "ROUGH_CUT"; }) });
    await expectRefusedBeforeReservation(h, "EPISODE_STATUS_NOT_LIVE");
  });

  it("refuses missing episode approvals", async () => {
    const h = await harness({ episode: episodeWith((_shot, episode) => { episode.approvals = { ...episode.approvals, storyboard: "PENDING" }; }) });
    await expectRefusedBeforeReservation(h, "APPROVALS_MISSING");
  });

  it("refuses an unknown shot and an ambiguous shot identity (exactly one shot per invocation)", async () => {
    const missing = await harness();
    await expectRefusedBeforeReservation({ ...missing, request: { ...missing.request, shotId: "S02" } }, "SHOT_NOT_FOUND");
    const ambiguous = await harness({
      episode: episodeWith((shot, episode) => { episode.scenes.push({ ...structuredClone(episode.scenes[0]!), id: "SC99", shots: [structuredClone(shot)] }); }),
    });
    await expectRefusedBeforeReservation(ambiguous, "SHOT_AMBIGUOUS");
  });

  it("refuses an over-limit Google prompt", async () => {
    const h = await harness({ episode: episodeWith((shot) => { shot.visualAction = "a".repeat(1001); }) });
    await expectRefusedBeforeReservation(h, "PROMPT_INVALID");
  });

  it("refuses without explicit paid-generation confirmation", async () => {
    const h = await harness({ confirm: false });
    await expectRefusedBeforeReservation(h, "CONFIRMATION_REQUIRED");
    expect(h.calls().prepare).toBe(0);
  });

  it("refuses a malformed credential before the lifecycle read or reservation", async () => {
    const h = await harness({ dependencies: { prepareSubmission: vi.fn(() => { throw new Error(`invalid key ${SECRET_SENTINEL}`); }) } });
    const error = await expectOperatorError(executeGoogleGenAiOperatorSingleShot(h.request, h.dependencies), "CREDENTIAL_INVALID");
    expect(error.message).not.toContain(SECRET_SENTINEL);
    expect(h.calls()).toMatchObject({ inspect: 0, reservations: 0, creates: 0 });
  });

  it("refuses an unverified visual reference", async () => {
    const h = await harness({ dependencies: { verifyVisualReference: vi.fn(async () => { throw new Error("not registered"); }) } });
    await expectRefusedBeforeReservation(h, "VISUAL_REFERENCE_UNVERIFIED");
  });

  it.each(["reference.gif", "reference.bmp", "reference.heic", "reference"])("refuses unsupported reference extension %s", async (name) => {
    const h = await harness({ imageName: name });
    await expectRefusedBeforeReservation(h, "REFERENCE_IMAGE_UNSUPPORTED");
  });

  it("refuses a missing reference image", async () => {
    const { mediaRoot } = await mediaRootWithImage();
    const h = await harness({ mediaRoot, imagePath: join(mediaRoot, "references", "EP90", "S01", "missing.png") });
    await expectRefusedBeforeReservation(h, "REFERENCE_IMAGE_REJECTED");
  });

  it("refuses an oversized reference image at the existing 10 MiB policy limit", async () => {
    const limit = committedActivationPolicy.limits.maxReferenceImageBytes;
    expect(limit).toBe(10_485_760);
    const oversized = Buffer.alloc(limit + 1);
    PNG.copy(oversized);
    const h = await harness({ imageBytes: oversized });
    await expectRefusedBeforeReservation(h, "REFERENCE_IMAGE_REJECTED");
  });

  it("refuses a reference whose bytes do not match its extension", async () => {
    const h = await harness({ imageBytes: Buffer.from("not an image at all", "utf8") });
    await expectRefusedBeforeReservation(h, "REFERENCE_IMAGE_REJECTED");
  });

  it("refuses an invalid policy load without touching durable state", async () => {
    const h = await harness({ dependencies: { loadPolicies: vi.fn(async () => { throw new Error("bad policy"); }) } });
    await expectRefusedBeforeReservation(h, "CONFIG_INVALID");
  });
});

describe("operator-only Google execute: existing records and duplicate submission", () => {
  async function withRecord(write: (mediaRoot: string) => Promise<void>, code: GoogleGenAiOperatorErrorCode): Promise<void> {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    await write(mediaRoot);
    const h = await harness({ mediaRoot, imagePath });
    await expectOperatorError(executeGoogleGenAiOperatorSingleShot(h.request, h.dependencies), code);
    expect(h.calls()).toMatchObject({ reservations: 0, creates: 0, submissions: 0, verify: 0 });
  }

  it.each(["RUNWAY", "VEO", "GOOGLE_GENAI"] as const)("refuses an existing %s reservation", async (provider) => {
    await withRecord((mediaRoot) => createExecutionReservation(mediaRoot, { episodeId: "EP90", shotId: "S01", provider }).then(() => undefined), "LIFECYCLE_EXISTS");
  });

  it("refuses an existing Google SUBMITTED lifecycle", async () => {
    await withRecord(async (mediaRoot) => {
      const reservation = await createExecutionReservation(mediaRoot, { episodeId: "EP90", shotId: "S01", provider: "GOOGLE_GENAI" });
      await createExecutionSubmission(mediaRoot, {
        reservationId: reservation.record.reservationId, episodeId: "EP90", shotId: "S01", provider: "GOOGLE_GENAI", providerExecutionId: INTERACTION_ID,
        recoveryMetadata: { request: { model: "gemini-omni-1.1-flash", background: true, store: true, stream: false, promptText: "p", sourceImagePath: join(mediaRoot, "references", "x.png") }, policySnapshot: googlePolicy },
      });
    }, "LIFECYCLE_EXISTS");
  });

  it("refuses a COMPLETED lifecycle of any provider", async () => {
    const h = await harness({ dependencies: { inspectLifecycle: vi.fn(async () => ({ state: "COMPLETED" }) as unknown as Awaited<ReturnType<typeof inspectExecutionLifecycle>>) } });
    await expectOperatorError(executeGoogleGenAiOperatorSingleShot(h.request, h.dependencies), "LIFECYCLE_EXISTS");
    expect(h.calls()).toMatchObject({ reservations: 0, creates: 0 });
  });

  it("refuses an unreadable or mixed lifecycle (corrupt durable record)", async () => {
    await withRecord(async (mediaRoot) => {
      const path = createExecutionReservationPath(mediaRoot, "EP90", "S01");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "{ corrupt");
    }, "LIFECYCLE_UNREADABLE");
  });

  it("never creates a second paid submission when execute is rerun for an already-submitted shot", async () => {
    const first = await harness();
    await executeGoogleGenAiOperatorSingleShot(first.request, first.dependencies);
    expect(first.createInteraction).toHaveBeenCalledTimes(1);

    const second = await harness({ mediaRoot: first.request.mediaRoot, imagePath: first.request.sourceImagePath });
    await expectOperatorError(executeGoogleGenAiOperatorSingleShot(second.request, second.dependencies), "LIFECYCLE_EXISTS");
    expect(second.calls()).toMatchObject({ reservations: 0, creates: 0, submissions: 0 });
    expect(first.createInteraction).toHaveBeenCalledTimes(1);
  });
});

describe("operator-only Google execute: reservation and submission state machine", () => {
  it("maps a reservation write failure (e.g. a concurrent EEXIST) to RESERVATION_FAILED with zero creates", async () => {
    const h = await harness({ dependencies: { createReservation: vi.fn(async () => { throw new Error("Execution reservation already exists"); }) } });
    await expectOperatorError(executeGoogleGenAiOperatorSingleShot(h.request, h.dependencies), "RESERVATION_FAILED", "UNKNOWN");
    expect(h.createInteraction).not.toHaveBeenCalled();
  });

  it("maps a submitter refusal before the provider call to SUBMISSION_REFUSED_BEFORE_PROVIDER_CALL", async () => {
    const h = await harness();
    const real = h.dependencies.createReservation;
    const dependencies = { ...h.dependencies, createReservation: vi.fn(async (mediaRoot: string, input: Parameters<typeof createExecutionReservation>[1]) => {
      const reservation = await real(mediaRoot, input);
      return { ...reservation, record: { ...reservation.record, shotId: "S99" } };
    }) };
    await expectOperatorError(executeGoogleGenAiOperatorSingleShot(h.request, dependencies), "SUBMISSION_REFUSED_BEFORE_PROVIDER_CALL", "RESERVED_ONLY");
    expect(h.createInteraction).not.toHaveBeenCalled();
    expect((await inspectExecutionLifecycle(h.request.mediaRoot, "EP90", "S01")).state).toBe("RESERVED_ONLY");
  });

  it("maps a hostile create failure to SUBMISSION_ACCEPTANCE_UNCERTAIN after exactly one create, discarding every detail", async () => {
    const hostile = Object.assign(new Error(`SDK failure ${SECRET_SENTINEL}`, { cause: new Error(`cause ${SECRET_SENTINEL}`) }), {
      providerBody: SECRET_SENTINEL, headers: { authorization: `Bearer ${SECRET_SENTINEL}` },
    });
    const h = await harness({ createInteraction: async () => { throw hostile; } });
    const error = await expectOperatorError(executeGoogleGenAiOperatorSingleShot(h.request, h.dependencies), "SUBMISSION_ACCEPTANCE_UNCERTAIN", "RESERVED_ONLY");
    expect(h.createInteraction).toHaveBeenCalledTimes(1);
    expect(h.calls().submissions).toBe(0);
    expect(JSON.stringify({ ...error, message: error.message, stack: error.stack })).not.toContain(SECRET_SENTINEL);
    expect((await inspectExecutionLifecycle(h.request.mediaRoot, "EP90", "S01")).state).toBe("RESERVED_ONLY");
  });

  it("treats an empty Interaction.id after the create as acceptance-uncertain", async () => {
    const h = await harness({ createInteraction: async () => ({ id: " " }) });
    await expectOperatorError(executeGoogleGenAiOperatorSingleShot(h.request, h.dependencies), "SUBMISSION_ACCEPTANCE_UNCERTAIN", "RESERVED_ONLY");
    expect(h.createInteraction).toHaveBeenCalledTimes(1);
  });

  it("maps a failed durable submission write after acceptance to DURABLE_SUBMISSION_FAILED (never resubmitted)", async () => {
    const h = await harness({ dependencies: { createSubmission: vi.fn(async () => { throw new Error(`disk ${SECRET_SENTINEL}`); }) } });
    const error = await expectOperatorError(executeGoogleGenAiOperatorSingleShot(h.request, h.dependencies), "DURABLE_SUBMISSION_FAILED", "UNKNOWN");
    expect(h.createInteraction).toHaveBeenCalledTimes(1);
    expect(error.message).not.toContain(SECRET_SENTINEL);
  });

  it("has no fallback, retry, recovery or provider-specific coupling in its source", async () => {
    const source = await readFile(join(process.cwd(), "src/execution/executeGoogleGenAiOperatorSingleShot.ts"), "utf8");
    expect(source).not.toMatch(/\/runway\/|\/veo\/|\/routing\/|executeSingleShot\b|executeRunway|executeVeo|reconcileGoogle|materializeGoogle|persistGoogle|process\.env|loadEnvironment|console\.|@google\/genai|\bcause\s*:|ProductionInteractionGetter|ProductionOutputRetriever/);
    expect(source.match(/submitGoogleGenAiSingleShot\(/g)).toHaveLength(1);
    expect(source.match(/dependencies\.createReservation\(/g)).toHaveLength(1);
  });
});
