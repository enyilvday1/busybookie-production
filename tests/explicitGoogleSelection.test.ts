import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionReservation } from "../src/execution/createExecutionReservation.js";
import { createProductionSingleShotExecutionDependencies } from "../src/execution/createProductionSingleShotExecutionDependencies.js";
import { executeSingleShot } from "../src/execution/executeSingleShot.js";
import { inspectExecutionLifecycle } from "../src/execution/inspectExecutionLifecycle.js";
import { createGoogleGenAiSingleShotProductionInteractionCreator } from "../src/execution/providers/createGoogleGenAiSingleShotProductionInteractionCreator.js";
import { resolveDurableShotExecutionReadiness } from "../src/execution/resolveDurableShotExecutionReadiness.js";
import { resolveDurableShotVisualGenerationState } from "../src/execution/resolveDurableShotVisualGenerationState.js";
import type { SingleShotExecutionDependencies } from "../src/execution/singleShotExecution.types.js";
import { evaluateShotExecutionReadiness } from "../src/planning/evaluateShotExecutionReadiness.js";
import { evaluateShotProvider } from "../src/routing/evaluateShotProvider.js";
import type { CharacterBible } from "../src/schemas/character.schema.js";
import type { EpisodeManifest, Shot } from "../src/schemas/episodeManifest.schema.js";
import { GenerationProviderSchema, type GenerationProvider, type ProductionRules } from "../src/schemas/productionRules.schema.js";
import type { ProviderRoutingPolicy } from "../src/schemas/providerRoutingPolicy.schema.js";
import { loadCharacterBible } from "../src/validation/loadCharacterBible.js";
import { loadEpisodeManifest } from "../src/validation/loadEpisodeManifest.js";
import { loadGoogleGenAiActivationPolicy } from "../src/validation/loadGoogleGenAiActivationPolicy.js";
import { loadProductionRules } from "../src/validation/loadProductionRules.js";
import { loadProviderRoutingPolicy } from "../src/validation/loadProviderRoutingPolicy.js";
import { validateEpisodeProduction } from "../src/validation/validateEpisodeProduction.js";

// B5C-S1 explicit Google selection. Three layers stay distinct:
//   S1  selection eligibility  - GOOGLE_GENAI may be explicitly selected (schema + production rules + routing);
//   X1  shared submission      - absent: readiness BLOCKS Google before any reservation or provider authority;
//   B5D paid activation        - absent: config/google-genai-activation-policy.json keeps newSubmissionsEnabled=false.
vi.mock("../src/execution/resolveDurableShotExecutionReadiness.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/execution/resolveDurableShotExecutionReadiness.js")>();
  return { ...original, resolveDurableShotExecutionReadiness: vi.fn(original.resolveDurableShotExecutionReadiness) };
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
const PRE_X1_BLOCKER = "GOOGLE_GENAI is explicitly selected, but shared Google execution is not available before B5C-X1.";
const temporaryDirectories: string[] = [];
let episode: EpisodeManifest;
let bible: CharacterBible;
let rules: ProductionRules;
let policy: ProviderRoutingPolicy;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  [episode, bible, rules, policy] = await Promise.all([loadEpisodeManifest("EP90"), loadCharacterBible(), loadProductionRules(), loadProviderRoutingPolicy()]);
});
beforeEach(() => {
  vi.mocked(resolveDurableShotExecutionReadiness).mockClear();
  vi.mocked(createGoogleGenAiSingleShotProductionInteractionCreator).mockClear();
  vi.mocked(loadGoogleGenAiActivationPolicy).mockClear();
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("network is forbidden in B5C-S1 tests"); });
});
afterEach(async () => {
  fetchSpy.mockRestore();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function baseShot(): Shot {
  const shot = episode.scenes[0]?.shots.find((candidate) => candidate.id === "S01");
  if (!shot) throw new Error("EP90/S01 fixture missing");
  return shot;
}

// A copy of the real EP90/S01 visual-only shot with an overridden provider/audio intent (never written to disk).
function shotWith(provider: GenerationProvider, nativeAudio = false, overrides: Partial<Shot> = {}): Shot {
  const shot = baseShot();
  return { ...shot, ...overrides, generation: { ...shot.generation, provider, nativeAudio } };
}

function episodeWith(shot: Shot): EpisodeManifest {
  return { ...episode, scenes: episode.scenes.map((scene, index) => (index === 0 ? { ...scene, shots: scene.shots.map((candidate) => (candidate.id === shot.id ? shot : candidate)) } : scene)) };
}

function tripDependencies() {
  const trip = (name: string) => vi.fn(async () => { throw new Error(`${name} must not run for a pre-X1 Google shot.`); });
  return {
    readDialogueVisualAuthorization: trip("readDialogueVisualAuthorization"),
    verifyVisualReference: trip("verifyVisualReference"),
    createReservation: trip("createReservation"),
    createSubmission: trip("createSubmission"),
    createCompletion: trip("createCompletion"),
    executeRunway: trip("executeRunway"),
    executeVeo: trip("executeVeo"),
  } satisfies SingleShotExecutionDependencies;
}

async function mediaRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "busybookie-explicit-google-selection-"));
  temporaryDirectories.push(directory);
  return directory;
}

function request(shot: Shot, root: string) {
  return {
    episode: episodeWith(shot), shotId: shot.id, bible, rules, policy, mediaRoot: root,
    sourceImagePath: join(root, "references", "reference.png"), confirmPaidGeneration: true,
  };
}

describe("B5C-S1 explicit Google selection", () => {
  it("S1.1 the manifest/rules vocabulary accepts GOOGLE_GENAI and keeps every existing provider", () => {
    for (const provider of ["RUNWAY", "VEO", "KREA", "MANUAL", "GOOGLE_GENAI"]) {
      expect(GenerationProviderSchema.safeParse(provider).success, provider).toBe(true);
    }
    for (const alias of ["GOOGLE", "GEMINI", "GOOGLE_VEO", "GENAI", "google_genai"]) {
      expect(GenerationProviderSchema.safeParse(alias).success, alias).toBe(false);
    }
  });

  it("S1.2 real production rules enable GOOGLE_GENAI selection while the activation policy keeps paid submission off", async () => {
    expect(rules.generation.supportedProviders.filter((provider) => provider === "GOOGLE_GENAI")).toEqual(["GOOGLE_GENAI"]);
    const google = shotWith("GOOGLE_GENAI");
    expect(() => validateEpisodeProduction(episodeWith(google), bible, rules)).not.toThrow();
    const activation = await loadGoogleGenAiActivationPolicy();
    expect(activation.admission.newSubmissionsEnabled).toBe(false);
  });

  it("S1.3 a visual-only shot explicitly naming GOOGLE_GENAI routes to GOOGLE_GENAI", () => {
    const decision = evaluateShotProvider(shotWith("GOOGLE_GENAI"), bible, rules, policy);
    expect(decision).toMatchObject({ disposition: "ROUTABLE", recommendedProvider: "GOOGLE_GENAI", currentProvider: "GOOGLE_GENAI", currentProviderMatchesRecommendation: true, manifestConflict: false, blockers: [] });
    expect(decision.reasons).toEqual(["S01: non-dialogue visual-only shot explicitly selects GOOGLE_GENAI as a visual-only alternative."]);
  });

  it("S1.4 Google is never the default: no other manifest value or audio intent routes GOOGLE_GENAI", () => {
    for (const provider of ["RUNWAY", "VEO", "KREA", "MANUAL"] as const) {
      for (const nativeAudio of [false, true]) {
        const decision = evaluateShotProvider(shotWith(provider, nativeAudio), bible, rules, policy);
        expect(decision.recommendedProvider, `${provider}/${nativeAudio}`).toBe(nativeAudio ? "VEO" : "RUNWAY");
      }
    }
    expect(evaluateShotProvider(shotWith("RUNWAY"), bible, rules, policy).recommendedProvider).toBe("RUNWAY");
  });

  it("S1.5 GOOGLE_GENAI with native audio is a visible CONFLICT, never a silent switch to VEO or RUNWAY", () => {
    const decision = evaluateShotProvider(shotWith("GOOGLE_GENAI", true), bible, rules, policy);
    expect(decision).toMatchObject({ disposition: "CONFLICT", recommendedProvider: "VEO", currentProvider: "GOOGLE_GENAI", currentProviderMatchesRecommendation: false, manifestConflict: true });
    expect(decision.reasons).toContain("S01: manifest provider GOOGLE_GENAI conflicts with routing recommendation VEO.");
    expect(decision.reasons).toContain("S01: GOOGLE_GENAI is a visual-only alternative and cannot satisfy native audio.");
    const readiness = evaluateShotExecutionReadiness(episodeWith(shotWith("GOOGLE_GENAI", true)), shotWith("GOOGLE_GENAI", true), bible, rules, policy);
    expect(readiness).toMatchObject({ disposition: "CONFLICT", executionProvider: null });
  });

  it("S1.6 native-audio VEO routing is unchanged", () => {
    expect(evaluateShotProvider(shotWith("VEO", true), bible, rules, policy)).toEqual({
      disposition: "ROUTABLE", recommendedProvider: "VEO", currentProvider: "VEO", currentProviderMatchesRecommendation: true, manifestConflict: false,
      reasons: ["S01: non-dialogue shot requests native audio, so routing policy recommends VEO."], blockers: [],
    });
  });

  it("S1.7 visual-only RUNWAY routing is unchanged", () => {
    expect(evaluateShotProvider(shotWith("RUNWAY"), bible, rules, policy)).toEqual({
      disposition: "ROUTABLE", recommendedProvider: "RUNWAY", currentProvider: "RUNWAY", currentProviderMatchesRecommendation: true, manifestConflict: false,
      reasons: ["S01: non-dialogue visual-only shot routes to RUNWAY."], blockers: [],
    });
    expect(evaluateShotExecutionReadiness(episode, shotWith("RUNWAY"), bible, rules, policy)).toMatchObject({ disposition: "EXECUTABLE", executionProvider: "RUNWAY" });
  });

  it("S1.8 readiness BLOCKS an explicitly selected Google shot before B5C-X1; status reports it as not executable", async () => {
    const google = shotWith("GOOGLE_GENAI");
    const readiness = evaluateShotExecutionReadiness(episodeWith(google), google, bible, rules, policy);
    expect(readiness).toMatchObject({ disposition: "BLOCKED", executionProvider: null, routing: { disposition: "ROUTABLE", recommendedProvider: "GOOGLE_GENAI" } });
    expect(readiness.blockers).toEqual([`S01: ${PRE_X1_BLOCKER}`]);
    const state = await resolveDurableShotVisualGenerationState({ episode: episodeWith(google), shot: google, bible, rules, policy, mediaRoot: await mediaRoot() });
    expect(state).toMatchObject({ state: "CANONICAL_NOT_EXECUTABLE", readiness: { disposition: "BLOCKED" } });
  });

  it("S1.9 shared execution of a Google-selected shot creates zero reservations (readiness block and RUNWAY|VEO backstop)", async () => {
    const root = await mediaRoot();
    const google = shotWith("GOOGLE_GENAI");
    const blocked = tripDependencies();
    await expect(executeSingleShot(request(google, root), blocked)).rejects.toThrow(`Single-shot execution blocked: S01 readiness is BLOCKED. Blockers: S01: ${PRE_X1_BLOCKER}`);
    expect(blocked.createReservation).not.toHaveBeenCalled();

    // Defence in depth: even if readiness were bypassed, executeSingleShot's unchanged paid-provider check refuses Google.
    vi.mocked(resolveDurableShotExecutionReadiness).mockResolvedValueOnce({ disposition: "EXECUTABLE", executionProvider: "GOOGLE_GENAI", routing: evaluateShotProvider(google, bible, rules, policy), reasons: [], blockers: [] });
    const bypassed = tripDependencies();
    await expect(executeSingleShot(request(google, root), bypassed)).rejects.toThrow("Single-shot execution blocked: S01 has no supported paid execution provider.");
    expect(bypassed.createReservation).not.toHaveBeenCalled();
    expect(await inspectExecutionLifecycle(root, "EP90", "S01")).toEqual({ state: "NOTHING" });
  });

  it("S1.10 zero provider authority: no Runway/Veo/Google executor, client, create or network", async () => {
    const root = await mediaRoot();
    const prepareRunwayExecutor = vi.fn(async () => { throw new Error("Runway executor must not be prepared."); });
    const prepareVeoExecutor = vi.fn(async () => { throw new Error("Veo executor must not be prepared."); });
    const trip = tripDependencies();
    const production = createProductionSingleShotExecutionDependencies({}, {
      readDialogueVisualAuthorization: trip.readDialogueVisualAuthorization,
      verifyVisualReference: trip.verifyVisualReference,
      createReservation: trip.createReservation,
      createSubmission: trip.createSubmission,
      createCompletion: trip.createCompletion,
      prepareRunwayExecutor,
      prepareVeoExecutor,
    });
    await expect(executeSingleShot(request(shotWith("GOOGLE_GENAI"), root), production)).rejects.toThrow(PRE_X1_BLOCKER);
    for (const spy of [prepareRunwayExecutor, prepareVeoExecutor, trip.verifyVisualReference, trip.createReservation, trip.createSubmission, trip.createCompletion]) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(createGoogleGenAiSingleShotProductionInteractionCreator).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("S1.11 selection, validation, routing and readiness need no Google credential", () => {
    expect(process.env.GEMINI_API_KEY ?? "").toBe("");
    const google = shotWith("GOOGLE_GENAI");
    expect(() => validateEpisodeProduction(episodeWith(google), bible, rules)).not.toThrow();
    expect(evaluateShotProvider(google, bible, rules, policy).recommendedProvider).toBe("GOOGLE_GENAI");
    expect(evaluateShotExecutionReadiness(episodeWith(google), google, bible, rules, policy).disposition).toBe("BLOCKED");
    expect(createGoogleGenAiSingleShotProductionInteractionCreator).not.toHaveBeenCalled();
  });

  it("S1.12 dialogue, KREA and MANUAL semantics are unchanged and never route Google", () => {
    const dialogue = shotWith("GOOGLE_GENAI", false, { type: "DIALOGUE" });
    const routing = evaluateShotProvider(dialogue, bible, rules, policy);
    expect(routing).toMatchObject({ disposition: "MANUAL_REVIEW", recommendedProvider: null });
    const resolved = evaluateShotExecutionReadiness(episodeWith(dialogue), dialogue, bible, rules, policy, { provider: "RUNWAY", source: "DURABLE_DIALOGUE_VISUAL_AUTHORIZATION" });
    expect(resolved).toMatchObject({ disposition: "CONFLICT", executionProvider: null });
    expect(evaluateShotProvider(shotWith("KREA"), bible, rules, policy)).toMatchObject({ disposition: "CONFLICT", recommendedProvider: "RUNWAY" });
    expect(evaluateShotProvider(shotWith("MANUAL"), bible, rules, policy)).toMatchObject({ disposition: "CONFLICT", recommendedProvider: "RUNWAY" });
    expect(rules.generation.supportedProviders).not.toContain("KREA");
  });

  it("S1.13 selection never reads or changes the paid-submission activation policy", async () => {
    const google = shotWith("GOOGLE_GENAI");
    evaluateShotProvider(google, bible, rules, policy);
    evaluateShotExecutionReadiness(episodeWith(google), google, bible, rules, policy);
    await expect(executeSingleShot(request(google, await mediaRoot()), tripDependencies())).rejects.toThrow(PRE_X1_BLOCKER);
    expect(loadGoogleGenAiActivationPolicy).not.toHaveBeenCalled();
    const bytes = await readFile(join(ROOT, "config", "google-genai-activation-policy.json"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("12c2728465972de9df3d3c0ba7fef539ad8802ae5b8161ad83c57409bd268ffb");
    expect(JSON.parse(bytes.toString("utf8"))).toMatchObject({ admission: { newSubmissionsEnabled: false } });
  });

  it("S1.14 historical EP90 stays a RUNWAY manifest while R1 lifecycle ownership still comes from the durable reservation", async () => {
    expect(baseShot().generation.provider).toBe("RUNWAY");
    expect(evaluateShotProvider(baseShot(), bible, rules, policy)).toMatchObject({ disposition: "ROUTABLE", recommendedProvider: "RUNWAY" });
    const root = await mediaRoot();
    await createExecutionReservation(root, { episodeId: "EP90", shotId: "S01", provider: "GOOGLE_GENAI" }, {
      now: () => "2026-10-28T00:00:00.000Z",
      createReservationId: () => "11111111-1111-4111-8111-111111111111",
    });
    const state = await resolveDurableShotVisualGenerationState({ episode, shot: baseShot(), bible, rules, policy, mediaRoot: root });
    expect(state).toMatchObject({ state: "RESERVED_ONLY_INTERVENTION_REQUIRED", lifecycle: { reservation: { provider: "GOOGLE_GENAI" } } });
  });
});
