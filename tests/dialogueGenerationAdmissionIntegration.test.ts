import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { admitDialogueLineGeneration } from "../src/dialogue/admitDialogueLineGeneration.js";
import { buildShotDialoguePlan, type ShotDialoguePlan } from "../src/dialogue/buildShotDialoguePlan.js";
import type { DialogueLifecycleClassification } from "../src/dialogue/classifyDialogueLifecycle.js";
import { runDialogueGenerationCli } from "../src/dialogue/cli/runDialogueGenerationCli.js";
import { createDialogueDirectSeedAudioReservation } from "../src/dialogue/createDialogueDirectSeedAudioReservation.js";
import { createDialogueReservation } from "../src/dialogue/createDialogueReservation.js";
import {
  createRunwayDialogueProductionExecutor,
  prepareRunwayDialogueProductionExecutor,
} from "../src/dialogue/createRunwayDialogueProductionExecutor.js";
import {
  createRunwayDirectSeedAudioProductionExecutor,
  prepareRunwayDirectSeedAudioProductionExecutor,
} from "../src/dialogue/createRunwayDirectSeedAudioProductionExecutor.js";
import { createDialogueGenerationAdmissionDirectory } from "../src/dialogue/dialogueGenerationAdmissionPaths.js";
import { createDialogueDirectSeedAudioReservationPath } from "../src/dialogue/dialogueDirectSeedAudioLifecyclePaths.js";
import { createDialogueReservationPath } from "../src/dialogue/dialogueReservationPath.js";
import { executeDialogueDirectSeedAudioLine } from "../src/dialogue/executeDialogueDirectSeedAudioLine.js";
import { executeDialogueLine } from "../src/dialogue/executeDialogueLine.js";
import { inspectDialogueDirectSeedAudioPlanLifecycles } from "../src/dialogue/inspectDialogueDirectSeedAudioPlanHistory.js";
import { inspectDialogueGenerationAdmissionLedger } from "../src/dialogue/inspectDialogueGenerationAdmissionLedger.js";
import { inspectDialogueLifecycle } from "../src/dialogue/inspectDialogueLifecycle.js";
import { readLatestDialoguePlacementDecision } from "../src/dialogue/readDialoguePlacementDecision.js";
import { resolveDurableDialogueCompositionAudioPlan } from "../src/dialogue/resolveDurableDialogueCompositionAudioPlan.js";
import { resolveDurableShotDialogueCompositionState } from "../src/dialogue/resolveDurableShotDialogueCompositionState.js";
import { resolveDurableEpisodeProductionState } from "../src/execution/resolveDurableEpisodeProductionState.js";
import type { CharacterBible } from "../src/schemas/character.schema.js";
import type { EpisodeManifest } from "../src/schemas/episodeManifest.schema.js";
import { loadCharacterBible } from "../src/validation/loadCharacterBible.js";
import { loadDialogueSeedAudioPolicy } from "../src/validation/loadDialogueSeedAudioPolicy.js";
import { loadDialogueVoicePolicy } from "../src/validation/loadDialogueVoicePolicy.js";
import { loadEpisodeManifest } from "../src/validation/loadEpisodeManifest.js";
import { loadProductionRules } from "../src/validation/loadProductionRules.js";
import { loadProviderRoutingPolicy } from "../src/validation/loadProviderRoutingPolicy.js";
import { validateEpisodeProduction } from "../src/validation/validateEpisodeProduction.js";

// C6a end-to-end on temp media roots: real admission gate, real ledger, real
// namespace reservation writers and real lifecycle executors. The provider
// transaction is a spy that records the call and throws, so no provider
// operation can happen and nothing paid is reachable.

const LINE = "EP02_SC01_S02_L01";
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function mediaRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "busybookie-c6a-integration-"));
  roots.push(root);
  return root;
}

type Speaker = "OLLIE" | "KACEY" | "MONT";

async function canonical(
  speakers: readonly Speaker[] | null = null,
  text?: string,
): Promise<{ episode: EpisodeManifest; bible: CharacterBible; plan: ShotDialoguePlan }> {
  const [loaded, bible] = await Promise.all([loadEpisodeManifest("EP02"), loadCharacterBible()]);
  const episode = structuredClone(loaded);
  const scene = episode.scenes[0]!;
  const shot = scene.shots[1]!;
  if (speakers !== null) {
    const template = shot.dialogue[0]!;
    shot.dialogue = speakers.map((characterId, index) => ({
      ...template,
      characterId,
      text: text ?? (index === 0 ? template.text : `Line ${index + 1} spoken by ${characterId}.`),
    }));
    shot.characters = [...new Set(speakers)];
  }
  const plan = buildShotDialoguePlan({ episodeId: episode.episodeId, sceneId: scene.id, shot, bible });
  return { episode, bible, plan };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ledgerFiles(root: string, line = LINE): Promise<string[]> {
  try {
    return (await readdir(createDialogueGenerationAdmissionDirectory(root, "EP02", "SC01", "S02", line))).sort();
  } catch {
    return [];
  }
}

async function tree(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true });
  return entries.map(String).sort();
}

function providerSpy() {
  return vi.fn(async () => {
    throw new Error("provider transaction spy reached (no provider operation performed)");
  });
}

function seedAudioExecutorDependencies(runTransaction: ReturnType<typeof providerSpy>) {
  return {
    createClient: vi.fn(() => ({}) as never),
    createTransactionRunner: vi.fn(() => runTransaction as never),
    createReservation: createDialogueDirectSeedAudioReservation,
    createSubmission: vi.fn() as never,
    recoverCompletion: vi.fn() as never,
    executeLifecycle: executeDialogueDirectSeedAudioLine,
    admitGeneration: admitDialogueLineGeneration,
  };
}

function lineScopedExecutorDependencies(runTransaction: ReturnType<typeof providerSpy>) {
  return {
    loadPolicy: loadDialogueVoicePolicy,
    createClient: vi.fn(() => ({}) as never),
    createTransactionRunner: vi.fn(() => runTransaction as never),
    createReservation: createDialogueReservation,
    createSubmission: vi.fn() as never,
    recoverCompletion: vi.fn() as never,
    executeLifecycle: executeDialogueLine,
    admitGeneration: admitDialogueLineGeneration,
  };
}

function seedAudioInput(root: string, plan: ShotDialoguePlan, waitTimeoutMs = 1000) {
  return {
    plan,
    dialogueLineId: LINE,
    mediaRoot: root,
    ffprobeExecutable: "controlled-ffprobe",
    localCreditCeiling: 50,
    waitTimeoutMs,
    confirmPaidGeneration: true,
  };
}

function seedReservationPath(root: string, plan: ShotDialoguePlan): string {
  return createDialogueDirectSeedAudioReservationPath(root, "EP02", "SC01", "S02", LINE, plan.planKey);
}

const credentials = Object.freeze({ RUNWAYML_API_SECRET: "test-runway-secret" });

describe("C6a through the paid production executors", () => {
  it("E two concurrent exact resumers of one open attempt: one namespace reservation, one provider path", async () => {
    const root = await mediaRoot();
    const { plan } = await canonical();
    // Crash window B/C: admission exists, no namespace reservation yet.
    const open = await admitDialogueLineGeneration({
      mediaRoot: root,
      plan,
      dialogueLineId: LINE,
      generationNamespace: "DIRECT_SEED_AUDIO",
      confirmPaidGeneration: true,
    });
    const runTransaction = providerSpy();
    // Two independent "processes", each with its own prepared executor.
    const [first, second] = await Promise.all([
      prepareRunwayDirectSeedAudioProductionExecutor(credentials, seedAudioExecutorDependencies(runTransaction)),
      prepareRunwayDirectSeedAudioProductionExecutor(credentials, seedAudioExecutorDependencies(runTransaction)),
    ]);

    const results = await Promise.allSettled([first(seedAudioInput(root, plan)), second(seedAudioInput(root, plan))]);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(await exists(seedReservationPath(root, plan))).toBe(true);
    expect(await ledgerFiles(root)).toEqual([`${LINE}_a1.dialogue-generation-admission.json`]);
    const ledger = await inspectDialogueGenerationAdmissionLedger(root, "EP02", "SC01", "S02", LINE);
    expect(ledger.latest?.admission.admissionId).toBe(open.admission.admissionId);
    expect(ledger.latest?.attemptState).toBe("RESERVED_ONLY_OPEN");
  });

  it("A concurrent first admissions across namespaces through both executors reach at most one provider path", async () => {
    const root = await mediaRoot();
    const seed = await canonical(["OLLIE"]);
    const preset = await canonical(["KACEY"]);
    const runTransaction = providerSpy();
    const seedExecutor = createRunwayDirectSeedAudioProductionExecutor(credentials, seedAudioExecutorDependencies(runTransaction));
    const presetExecutor = createRunwayDialogueProductionExecutor(credentials, lineScopedExecutorDependencies(runTransaction));

    await Promise.allSettled([
      seedExecutor(seedAudioInput(root, seed.plan)),
      presetExecutor({ plan: preset.plan, dialogueLineId: LINE, mediaRoot: root, confirmPaidGeneration: true }),
    ]);

    const reservations = [
      await exists(seedReservationPath(root, seed.plan)),
      await exists(createDialogueReservationPath(root, "EP02", "SC01", "S02", LINE)),
    ].filter(Boolean);
    // Exactly one caller won admission and reached its namespace reservation;
    // the other failed before any reservation or provider path.
    expect(reservations).toHaveLength(1);
    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(await ledgerFiles(root)).toEqual([`${LINE}_a1.dialogue-generation-admission.json`]);
  });

  it("the line-scoped executor admits, then reserves, then reaches its provider path exactly once", async () => {
    const root = await mediaRoot();
    const { plan } = await canonical(["KACEY"]);
    const runTransaction = providerSpy();
    const executor = await prepareRunwayDialogueProductionExecutor(credentials, lineScopedExecutorDependencies(runTransaction));

    await expect(
      executor({ plan, dialogueLineId: LINE, mediaRoot: root, confirmPaidGeneration: true }),
    ).rejects.toThrow(/provider transaction spy reached/);

    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(await exists(createDialogueReservationPath(root, "EP02", "SC01", "S02", LINE))).toBe(true);
    const ledger = await inspectDialogueGenerationAdmissionLedger(root, "EP02", "SC01", "S02", LINE);
    expect(ledger.latest?.admission.generationNamespace).toBe("LINE_SCOPED");
    expect(ledger.latest?.attemptState).toBe("RESERVED_ONLY_OPEN");
  });

  it("G failure before the namespace reservation leaves the attempt open and resumable (no abandonment, no N+1)", async () => {
    const root = await mediaRoot();
    const { plan } = await canonical();
    const runTransaction = providerSpy();
    const executor = await prepareRunwayDirectSeedAudioProductionExecutor(
      credentials,
      seedAudioExecutorDependencies(runTransaction),
    );

    await expect(executor(seedAudioInput(root, plan, 0))).rejects.toThrow(/wait timeout must be a positive/);
    expect(runTransaction).not.toHaveBeenCalled();
    expect(await exists(seedReservationPath(root, plan))).toBe(false);
    expect(await ledgerFiles(root)).toEqual([`${LINE}_a1.dialogue-generation-admission.json`]);
    const open = await inspectDialogueGenerationAdmissionLedger(root, "EP02", "SC01", "S02", LINE);
    expect(open.latest?.attemptState).toBe("PRE_RESERVATION_OPEN");

    await expect(executor(seedAudioInput(root, plan))).rejects.toThrow(/provider transaction spy reached/);
    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(await ledgerFiles(root)).toEqual([`${LINE}_a1.dialogue-generation-admission.json`]);
    const resumed = await inspectDialogueGenerationAdmissionLedger(root, "EP02", "SC01", "S02", LINE);
    expect(resumed.latest?.admission.admissionId).toBe(open.latest?.admission.admissionId);
  });

  it("H failure after the namespace reservation is never retried through the shared admission", async () => {
    const root = await mediaRoot();
    const { plan } = await canonical();
    const runTransaction = providerSpy();
    const executor = await prepareRunwayDirectSeedAudioProductionExecutor(
      credentials,
      seedAudioExecutorDependencies(runTransaction),
    );

    await expect(executor(seedAudioInput(root, plan))).rejects.toThrow(/provider transaction spy reached/);
    await expect(executor(seedAudioInput(root, plan))).rejects.toThrow(/RESERVED_ONLY/);
    const changed = await canonical(["OLLIE"], "A changed canonical line after the reservation.");
    await expect(executor(seedAudioInput(root, changed.plan))).rejects.toThrow(/RESERVED_ONLY/);

    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(await ledgerFiles(root)).toEqual([`${LINE}_a1.dialogue-generation-admission.json`]);
  });

  it("I an unconfirmed executor call writes nothing and reaches no reservation or provider", async () => {
    const root = await mediaRoot();
    const { plan } = await canonical();
    const runTransaction = providerSpy();
    const executor = await prepareRunwayDirectSeedAudioProductionExecutor(
      credentials,
      seedAudioExecutorDependencies(runTransaction),
    );

    await expect(executor({ ...seedAudioInput(root, plan), confirmPaidGeneration: false })).rejects.toThrow(
      /confirmation is required before dialogue generation admission/,
    );
    expect(runTransaction).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });
});

describe("C6a manual dialogue:generate", () => {
  function cliDependencies(root: string, runTransaction: ReturnType<typeof providerSpy>) {
    const createSeedAudioExecutor = vi.fn((source: Readonly<{ RUNWAYML_API_SECRET: string }>) =>
      createRunwayDirectSeedAudioProductionExecutor(source, seedAudioExecutorDependencies(runTransaction)),
    );
    const createExecutor = vi.fn((source: Readonly<{ RUNWAYML_API_SECRET: string }>) =>
      createRunwayDialogueProductionExecutor(source, lineScopedExecutorDependencies(runTransaction)),
    );
    return {
      dependencies: {
        loadEnvironment: () =>
          ({ BUSYBOOKIE_MEDIA_ROOT: root, RUNWAYML_API_SECRET: "test-runway-secret", BUSYBOOKIE_FFPROBE_PATH: "controlled-ffprobe" }) as never,
        loadProductionRules,
        loadDialogueVoicePolicy,
        loadDialogueSeedAudioPolicy,
        loadCharacterBible,
        loadEpisodeManifest,
        // The temp root shares the system drive; skip only the drive policy probe.
        validateMediaRoot: vi.fn(async () => root),
        validateEpisodeProduction,
        createExecutor,
        createSeedAudioExecutor,
      },
      createExecutor,
      createSeedAudioExecutor,
    };
  }

  const args = ["--episode", "EP02", "--scene", "SC01", "--shot", "S02", "--line", LINE];

  it("M the unconfirmed dry run creates no admission, reservation or provider call", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const root = await mediaRoot();
    const runTransaction = providerSpy();
    const controlled = cliDependencies(root, runTransaction);

    await runDialogueGenerationCli(args, controlled.dependencies);

    expect(controlled.createSeedAudioExecutor).not.toHaveBeenCalled();
    expect(runTransaction).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it("M the identical confirmed manual command naturally resumes an open compatible attempt", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const root = await mediaRoot();
    const { plan } = await canonical();
    const open = await admitDialogueLineGeneration({
      mediaRoot: root,
      plan,
      dialogueLineId: LINE,
      generationNamespace: "DIRECT_SEED_AUDIO",
      confirmPaidGeneration: true,
    });
    const runTransaction = providerSpy();
    const controlled = cliDependencies(root, runTransaction);

    await expect(
      runDialogueGenerationCli([...args, "--confirm-paid-generation"], controlled.dependencies),
    ).rejects.toThrow(/provider transaction spy reached/);

    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(await exists(seedReservationPath(root, plan))).toBe(true);
    expect(await ledgerFiles(root)).toEqual([`${LINE}_a1.dialogue-generation-admission.json`]);
    const ledger = await inspectDialogueGenerationAdmissionLedger(root, "EP02", "SC01", "S02", LINE);
    expect(ledger.latest?.admission.admissionId).toBe(open.admission.admissionId);
  });

  it("M a confirmed manual run is refused while a different-plan attempt is open", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const root = await mediaRoot();
    const other = await canonical(["OLLIE"], "An earlier canonical text that was admitted.");
    await admitDialogueLineGeneration({
      mediaRoot: root,
      plan: other.plan,
      dialogueLineId: LINE,
      generationNamespace: "DIRECT_SEED_AUDIO",
      confirmPaidGeneration: true,
    });
    const runTransaction = providerSpy();

    await expect(
      runDialogueGenerationCli([...args, "--confirm-paid-generation"], cliDependencies(root, runTransaction).dependencies),
    ).rejects.toThrow(/can only be resumed by the identical canonical attempt/);
    expect(runTransaction).not.toHaveBeenCalled();
    expect(await ledgerFiles(root)).toEqual([`${LINE}_a1.dialogue-generation-admission.json`]);
  });
});

describe("C6a in C3 and C4 (read-only)", () => {
  async function c3(root: string, episode: EpisodeManifest, bible: CharacterBible) {
    return resolveDurableShotDialogueCompositionState({
      episode,
      shotId: "S02",
      bible,
      mediaRoot: root,
      ffprobeExecutable: "controlled-ffprobe",
    });
  }

  async function seedOpen(root: string, plan: ShotDialoguePlan, line = LINE) {
    const namespace = plan.lines.find((candidate) => candidate.dialogueLineId === line)!;
    return admitDialogueLineGeneration({
      mediaRoot: root,
      plan,
      dialogueLineId: line,
      generationNamespace:
        "executionMode" in namespace.voice && namespace.voice.executionMode === "RUNWAY_REFERENCE_AUDIO"
          ? "DIRECT_SEED_AUDIO"
          : "LINE_SCOPED",
      confirmPaidGeneration: true,
    });
  }

  it("K no ledger: canonical DIALOGUE_AUDIO_REQUIRED (control)", async () => {
    const root = await mediaRoot();
    const { episode, bible } = await canonical();
    expect((await c3(root, episode, bible)).state).toBe("DIALOGUE_AUDIO_REQUIRED");
  });

  it("K an open admission matching the current plan is intervention, never DIALOGUE_AUDIO_REQUIRED, and C3 writes nothing", async () => {
    const root = await mediaRoot();
    const { episode, bible, plan } = await canonical();
    const open = await seedOpen(root, plan);
    const before = await tree(root);

    const state = await c3(root, episode, bible);

    expect(state).toEqual({
      state: "DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED",
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      openAdmissions: [
        {
          dialogueLineId: LINE,
          attemptNumber: 1,
          admissionId: open.admission.admissionId,
          planKey: plan.planKey,
          generationNamespace: "DIRECT_SEED_AUDIO",
          matchesCurrentCanonicalPlan: true,
        },
      ],
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(await tree(root)).toEqual(before);
  });

  it.each([
    ["a changed canonical plan", () => canonical(["OLLIE"], "A changed canonical line.")],
    ["a changed voice route / namespace", () => canonical(["KACEY"])],
  ] as const)("K %s keeps the intervention with matchesCurrentCanonicalPlan=false", async (_label, current) => {
    const root = await mediaRoot();
    const admitted = await canonical();
    await seedOpen(root, admitted.plan);
    const { episode, bible } = await current();

    const state = await c3(root, episode, bible);

    expect(state.state).toBe("DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED");
    expect(state.state === "DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED" && state.openAdmissions[0])
      .toMatchObject({ planKey: admitted.plan.planKey, matchesCurrentCanonicalPlan: false });
  });

  it("K a planning-blocked shot with an open admission and no active work reports the intervention", async () => {
    const root = await mediaRoot();
    const { episode, bible, plan } = await canonical();
    await seedOpen(root, plan);
    const pending = structuredClone(bible);
    const ollie = pending.characters.find((character) => character.id === "OLLIE")!;
    (ollie as { voice: unknown }).voice = {
      selectionStatus: "PENDING",
      provider: "RUNWAY",
      voiceName: null,
      deliveryTraits: ["young"],
    };

    const state = await c3(root, episode, pending);

    expect(state.state).toBe("DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED");
    expect(state.state === "DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED" && state.openAdmissions[0])
      .toMatchObject({ matchesCurrentCanonicalPlan: false });
  });

  it("K precedence: RESERVED_ONLY outranks an open admission", async () => {
    const root = await mediaRoot();
    const { episode, bible, plan } = await canonical(["OLLIE", "KACEY"]);
    await seedOpen(root, plan);
    await createDialogueReservation(root, {
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialogueLineId: "EP02_SC01_S02_L02",
      planKey: plan.planKey,
      provider: "RUNWAY",
    });

    expect((await c3(root, episode, bible)).state).toBe("DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED");
  });

  it("K precedence: an open admission outranks reconciliation and audio-required", async () => {
    const root = await mediaRoot();
    const { episode, bible, plan } = await canonical(["OLLIE", "KACEY"]);
    await seedOpen(root, plan);
    const submitted = Object.freeze({
      state: "SUBMITTED",
      reservation: Object.freeze({ planKey: plan.planKey }),
      submission: Object.freeze({}),
    }) as unknown as DialogueLifecycleClassification;

    const state = await resolveDurableShotDialogueCompositionState(
      { episode, shotId: "S02", bible, mediaRoot: root, ffprobeExecutable: "controlled-ffprobe" },
      {
        inspectLineLifecycle: vi.fn<typeof inspectDialogueLifecycle>(async (...callArgs) =>
          callArgs[4] === "EP02_SC01_S02_L02" ? submitted : inspectDialogueLifecycle(...callArgs),
        ),
        inspectDirectSeedAudioPlanLifecycles: inspectDialogueDirectSeedAudioPlanLifecycles,
        readLatestPlacementDecision: readLatestDialoguePlacementDecision,
        resolveCompositionAudioPlan: resolveDurableDialogueCompositionAudioPlan,
        inspectAdmissionLedger: inspectDialogueGenerationAdmissionLedger,
      },
    );

    expect(state.state).toBe("DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED");
  });

  it("L C4 propagates the open-admission state and count without collapsing either axis", async () => {
    const root = await mediaRoot();
    const [episode, bible, rules, policy] = await Promise.all([
      loadEpisodeManifest("EP02"),
      loadCharacterBible(),
      loadProductionRules(),
      loadProviderRoutingPolicy(),
    ]);
    const plan = buildShotDialoguePlan({
      episodeId: "EP02",
      sceneId: "SC01",
      shot: episode.scenes[0]!.shots[1]!,
      bible,
    });
    await seedOpen(root, plan);

    const report = await resolveDurableEpisodeProductionState({
      episode,
      bible,
      rules,
      policy,
      mediaRoot: root,
      ffprobeExecutable: "controlled-ffprobe",
    });

    const shot = report.shots.find((candidate) => candidate.shotId === "S02")!;
    expect(shot.dialogueCompositionState.state).toBe("DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED");
    expect(shot.visualGenerationState.shotId).toBe("S02");
    expect(report.summary.dialogueCompositionStates.DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED).toBe(1);
    expect(report.summary.dialogueCompositionStates.DIALOGUE_AUDIO_REQUIRED).toBe(0);
    expect(Object.keys(report.summary.dialogueCompositionStates).indexOf(
      "DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED",
    )).toBe(Object.keys(report.summary.dialogueCompositionStates).indexOf("DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED") + 1);
  });
});

describe("C6a security boundaries (source)", () => {
  const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const modules = [
    "src/dialogue/admitDialogueLineGeneration.ts",
    "src/dialogue/inspectDialogueGenerationAdmissionLedger.ts",
    "src/dialogue/inspectDialogueLineGenerationEvidence.ts",
    "src/dialogue/dialogueGenerationAdmissionPaths.ts",
    "src/dialogue/dialogueGenerationAdmission.schema.ts",
  ];

  it("N no abandonment, deletion, expiry or message parsing exists in the C6a modules", async () => {
    for (const path of modules) {
      const source = strip(await read(path));
      expect(source, path).not.toMatch(/abandon/i);
      expect(source, path).not.toMatch(/\brm\s*\(|\brmdir\s*\(|\bunlinkSync\b|\brename\s*\(/);
      expect(source, path).not.toMatch(/\.message\b|instanceof\s+Error/);
      expect(source, path).not.toMatch(/Date\.now|setTimeout|timeout/i);
      expect(source, path).not.toMatch(/fetch\s*\(|RunwayML|@runwayml|textToSpeech/);
    }
    const admission = strip(await read("src/dialogue/admitDialogueLineGeneration.ts"));
    expect([...admission.matchAll(/\bunlink\s*\(\s*([A-Za-z]+)/g)].map((match) => match[1])).toEqual(["temporaryPath"]);
  });

  it("N the read-only helpers never write and the eligibility helper never reads the ledger", async () => {
    for (const path of [
      "src/dialogue/inspectDialogueGenerationAdmissionLedger.ts",
      "src/dialogue/inspectDialogueLineGenerationEvidence.ts",
    ]) {
      expect(strip(await read(path)), path).not.toMatch(
        /writeFile|copyFile|mkdir|unlink|createDialogueGenerationAdmission\s*\(|createDialogue(Reservation|DirectSeedAudio|Submission|Completion|PlacementDecision)/,
      );
    }
    expect(strip(await read("src/dialogue/inspectDialogueLineGenerationEvidence.ts"))).not.toMatch(/Admission/);
  });

  it("N the two paid executors are the only production users of the shared gate, and the gate precedes executeLifecycle", async () => {
    const executors = [
      "src/dialogue/createRunwayDialogueProductionExecutor.ts",
      "src/dialogue/createRunwayDirectSeedAudioProductionExecutor.ts",
    ];
    for (const path of executors) {
      const source = strip(await read(path));
      const admit = source.indexOf(".admitGeneration(");
      const execute = source.indexOf(".executeLifecycle(");
      expect(admit, path).toBeGreaterThan(-1);
      expect(admit, path).toBeLessThan(execute);
    }
    expect(strip(await read("src/dialogue/cli/runDialogueGenerationCli.ts"))).not.toMatch(/admitDialogueLineGeneration/);
  });

  it("N package.json gains no abandon/resume command", async () => {
    const pkg = JSON.parse(await read("package.json")) as { scripts: Record<string, string> };
    expect(Object.keys(pkg.scripts).filter((name) => /abandon|resume|admission/i.test(name))).toEqual([]);
  });
});
