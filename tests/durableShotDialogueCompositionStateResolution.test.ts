import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
} from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

import type {
  DialogueCompositionAudioPlan,
} from "../src/dialogue/buildDialogueCompositionAudioPlan.js";

import {
  buildShotDialoguePlan,
  type ShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import type {
  DialogueLifecycleClassification,
} from "../src/dialogue/classifyDialogueLifecycle.js";

import {
  createDialogueDirectSeedAudioReservation,
} from "../src/dialogue/createDialogueDirectSeedAudioReservation.js";

import {
  createDialogueDirectSeedAudioSubmission,
} from "../src/dialogue/createDialogueDirectSeedAudioSubmission.js";

import {
  createDialoguePlacementDecision,
} from "../src/dialogue/createDialoguePlacementDecision.js";

import {
  createDialogueReservation,
} from "../src/dialogue/createDialogueReservation.js";

import {
  createDialogueDirectSeedAudioReservationPath,
} from "../src/dialogue/dialogueDirectSeedAudioLifecyclePaths.js";

import type {
  DialoguePlacementDecision,
} from "../src/dialogue/dialoguePlacementDecision.schema.js";

import {
  createDialogueReservationPath,
} from "../src/dialogue/dialogueReservationPath.js";

import {
  inspectDialogueDirectSeedAudioPlanLifecycles,
  type DialogueDirectSeedAudioPlanLifecycle,
} from "../src/dialogue/inspectDialogueDirectSeedAudioPlanHistory.js";

import type {
  inspectDialogueLifecycle,
} from "../src/dialogue/inspectDialogueLifecycle.js";

import type {
  DialoguePlanningBlocker,
} from "../src/dialogue/inspectShotDialoguePlanningBlockers.js";

import {
  readLatestDialoguePlacementDecision,
} from "../src/dialogue/readDialoguePlacementDecision.js";

import {
  resolveDurableDialogueCompositionAudioPlan,
} from "../src/dialogue/resolveDurableDialogueCompositionAudioPlan.js";

import {
  resolveDurableShotDialogueCompositionState,
  type DialogueActiveWork,
  type DialogueDurableNamespace,
  type DialogueStalePlanWork,
  type DurableShotDialogueCompositionState,
  type ResolveDurableShotDialogueCompositionStateDependencies,
  type ResolveDurableShotDialogueCompositionStateInput,
} from "../src/dialogue/resolveDurableShotDialogueCompositionState.js";

import type {
  VerifiedShotDialogueTiming,
} from "../src/dialogue/verifyShotDialogueTiming.js";

import type {
  CharacterBible,
} from "../src/schemas/character.schema.js";

import type {
  EpisodeManifest,
} from "../src/schemas/episodeManifest.schema.js";

import {
  loadCharacterBible,
} from "../src/validation/loadCharacterBible.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

// Pass-through spy: the real canonical planner runs, and calls are observable.
vi.mock("../src/dialogue/buildShotDialoguePlan.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/dialogue/buildShotDialoguePlan.js")>();
  return { ...actual, buildShotDialoguePlan: vi.fn(actual.buildShotDialoguePlan) };
});

const planBuilder = vi.mocked(buildShotDialoguePlan);

type LifecycleState = DialogueLifecycleClassification["state"];
type HistoryEntry = readonly [planKey: string, state: LifecycleState];

const ffprobeExecutable = "controlled-ffprobe";
const OLD_PLAN_A = "0".repeat(64);
const OLD_PLAN_B = "1".repeat(64);
const OLD_PLAN_C = "2".repeat(64);
const LINE_SCOPED_PLAN = "9".repeat(64);
const L01 = "EP02_SC01_S02_L01";
const L02 = "EP02_SC01_S02_L02";
const L03 = "EP02_SC01_S02_L03";

const roots: string[] = [];

async function createMediaRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "busybookie-shot-dialogue-composition-state-"));
  roots.push(root);
  return root;
}

beforeEach(() => {
  planBuilder.mockClear();
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtures(): Promise<{ episode: EpisodeManifest; bible: CharacterBible }> {
  const [episode, bible] = await Promise.all([loadEpisodeManifest("EP02"), loadCharacterBible()]);
  return { episode, bible };
}

type Speaker = "OLLIE" | "KACEY" | "MONT" | "GHOST";

// OLLIE is a RUNWAY_REFERENCE_AUDIO (Direct-SeedAudio) voice; KACEY and MONT are
// line-scoped presets; GHOST is absent from the character bible.
function episodeWithDialogue(base: EpisodeManifest, characters: readonly Speaker[]): EpisodeManifest {
  const episode = structuredClone(base);
  const shot = episode.scenes[0]!.shots[1]!;
  const template = shot.dialogue[0]!;
  shot.dialogue = characters.map((characterId, index) => ({
    ...template,
    characterId,
    text: `Line ${index + 1} spoken by ${characterId}.`,
  }));
  shot.characters = [...new Set(characters)];
  return episode;
}

function withPendingVoice(base: CharacterBible, characterId: string): CharacterBible {
  const bible = structuredClone(base);
  const character = bible.characters.find((candidate) => candidate.id === characterId)!;
  (character as { voice: unknown }).voice = {
    selectionStatus: "PENDING",
    provider: "RUNWAY",
    voiceName: null,
    deliveryTraits: ["young"],
  };
  return bible;
}

async function canonicalPlanFor(
  episode: EpisodeManifest,
  bible: CharacterBible,
  sceneIndex = 0,
  shotIndex = 1,
): Promise<ShotDialoguePlan> {
  const actual = await vi.importActual<typeof import("../src/dialogue/buildShotDialoguePlan.js")>(
    "../src/dialogue/buildShotDialoguePlan.js",
  );
  const scene = episode.scenes[sceneIndex]!;
  return actual.buildShotDialoguePlan({
    episodeId: episode.episodeId,
    sceneId: scene.id,
    shot: scene.shots[shotIndex]!,
    bible,
  });
}

function classification(state: LifecycleState, planKey: string): DialogueLifecycleClassification {
  if (state === "NOTHING") {
    return Object.freeze({ state });
  }
  return Object.freeze({
    state,
    reservation: Object.freeze({ planKey, marker: `reservation-${planKey.slice(0, 4)}` }),
    submission: Object.freeze({ marker: "submission" }),
    completion: Object.freeze({ marker: "completion" }),
  }) as unknown as DialogueLifecycleClassification;
}

const AUDIO_PLAN = Object.freeze({ marker: "b2d-audio-plan" }) as unknown as DialogueCompositionAudioPlan;
const DECISION = Object.freeze({ marker: "placement-decision" }) as unknown as DialoguePlacementDecision;

type LifecycleValue = LifecycleState | DialogueLifecycleClassification;

// current: the line's CURRENT lifecycle (LINE_SCOPED for presets; the current
//   plan's Direct-SeedAudio entry for reference voices; "NOTHING" omits it).
// currentDirectory: when true, a NOTHING current Direct-SeedAudio entry is
//   still returned (empty current plan directory).
// history: Direct-SeedAudio plans other than the current plan (both modes).
// lineScoped: LINE_SCOPED evidence for reference-voice lines (non-current).
type Scenario = Readonly<{
  current?: Readonly<Record<string, LifecycleValue>>;
  currentDirectory?: Readonly<Record<string, boolean>>;
  history?: Readonly<Record<string, readonly HistoryEntry[]>>;
  lineScoped?: Readonly<Record<string, LifecycleValue>>;
  decision?: DialoguePlacementDecision | null;
}>;

function seams(planOrKey: ShotDialoguePlan | string, scenario: Scenario = {}) {
  const planKey = typeof planOrKey === "string" ? planOrKey : planOrKey.planKey;
  const referenceLines = new Set(
    typeof planOrKey === "string"
      ? []
      : planOrKey.lines
          .filter((line) => "executionMode" in line.voice && line.voice.executionMode === "RUNWAY_REFERENCE_AUDIO")
          .map((line) => line.dialogueLineId),
  );
  const value = (entry: LifecycleValue | undefined, key: string): DialogueLifecycleClassification =>
    entry === undefined ? classification("NOTHING", key) : typeof entry === "string" ? classification(entry, key) : entry;

  const inspectLineLifecycle = vi.fn<typeof inspectDialogueLifecycle>(
    async (_mediaRoot, _episodeId, _sceneId, _shotId, lineId) =>
      referenceLines.has(lineId)
        ? value(scenario.lineScoped?.[lineId], LINE_SCOPED_PLAN)
        : value(scenario.current?.[lineId], planKey),
  );
  const inspectDirectSeedAudioPlanLifecycles = vi.fn<typeof inspectDialogueDirectSeedAudioPlanLifecycles>(
    async (_mediaRoot, _episodeId, _sceneId, _shotId, lineId) => {
      const plans: DialogueDirectSeedAudioPlanLifecycle[] = (scenario.history?.[lineId] ?? []).map(
        ([historicalPlanKey, state]) =>
          Object.freeze({ planKey: historicalPlanKey, lifecycle: classification(state, historicalPlanKey) }),
      );
      if (referenceLines.has(lineId)) {
        const current = value(scenario.current?.[lineId], planKey);
        if (current.state !== "NOTHING" || scenario.currentDirectory?.[lineId]) {
          plans.push(Object.freeze({ planKey, lifecycle: current }));
        }
      }
      plans.sort((left, right) => (left.planKey < right.planKey ? -1 : left.planKey > right.planKey ? 1 : 0));
      return Object.freeze(plans);
    },
  );
  const readLatestPlacementDecision = vi.fn<typeof readLatestDialoguePlacementDecision>(
    async () => (scenario.decision === undefined ? null : scenario.decision),
  );
  const resolveCompositionAudioPlan = vi.fn<typeof resolveDurableDialogueCompositionAudioPlan>(
    async () => AUDIO_PLAN,
  );

  const dependencies: ResolveDurableShotDialogueCompositionStateDependencies = {
    inspectLineLifecycle,
    inspectDirectSeedAudioPlanLifecycles,
    readLatestPlacementDecision,
    resolveCompositionAudioPlan,
  };

  return {
    dependencies,
    inspectLineLifecycle,
    inspectDirectSeedAudioPlanLifecycles,
    readLatestPlacementDecision,
    resolveCompositionAudioPlan,
  };
}

type Seams = ReturnType<typeof seams>;

function expectNoReads(controlled: Seams): void {
  expect(controlled.inspectLineLifecycle).not.toHaveBeenCalled();
  expect(controlled.inspectDirectSeedAudioPlanLifecycles).not.toHaveBeenCalled();
  expect(controlled.readLatestPlacementDecision).not.toHaveBeenCalled();
  expect(controlled.resolveCompositionAudioPlan).not.toHaveBeenCalled();
}

function expectNoPlacementPhase(controlled: Seams): void {
  expect(controlled.readLatestPlacementDecision).not.toHaveBeenCalled();
  expect(controlled.resolveCompositionAudioPlan).not.toHaveBeenCalled();
}

function expectBothNamespacesInspected(controlled: Seams, lineIds: readonly string[]): void {
  expect(controlled.inspectLineLifecycle.mock.calls.map((call) => call[4])).toEqual(lineIds);
  expect(controlled.inspectDirectSeedAudioPlanLifecycles.mock.calls.map((call) => call[4])).toEqual(lineIds);
}

function input(
  episode: EpisodeManifest,
  bible: CharacterBible,
  mediaRoot = "C:/controlled-media-root",
  shotId = "S02",
): ResolveDurableShotDialogueCompositionStateInput {
  return { episode, shotId, bible, mediaRoot, ffprobeExecutable };
}

function expectFrozenArrays(state: DurableShotDialogueCompositionState): void {
  expect(Object.isFrozen(state)).toBe(true);
  for (const key of ["staleWork", "activeWork", "blockers", "reservedLineIds", "submittedLineIds", "missingLineIds"] as const) {
    if (key in state) {
      const array = (state as Record<string, unknown>)[key] as readonly unknown[];
      expect(Object.isFrozen(array)).toBe(true);
      for (const item of array) {
        if (typeof item === "object") {
          expect(Object.isFrozen(item)).toBe(true);
        }
      }
    }
  }
}

function work(
  dialogueLineId: string,
  namespace: DialogueDurableNamespace,
  planKey: string,
  state: "RESERVED_ONLY" | "SUBMITTED",
): DialogueActiveWork {
  return { dialogueLineId, namespace, planKey, state };
}

// Shot-level precedence written as the Step-915 rule table (used by the
// exhaustive table-driven cases).
function expectedStateFor(
  states: readonly LifecycleState[],
  stale: boolean,
): DurableShotDialogueCompositionState["state"] {
  if (stale) return "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED";
  if (states.includes("RESERVED_ONLY")) return "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED";
  if (states.includes("SUBMITTED")) return "DIALOGUE_RECONCILIATION_REQUIRED";
  if (states.includes("NOTHING")) return "DIALOGUE_AUDIO_REQUIRED";
  return "PLACEMENT_REQUIRED";
}

const ALL_STATES: readonly LifecycleState[] = ["NOTHING", "RESERVED_ONLY", "SUBMITTED", "COMPLETED"];
const isActive = (state: LifecycleState): state is "RESERVED_ONLY" | "SUBMITTED" =>
  state === "RESERVED_ONLY" || state === "SUBMITTED";

describe("C3 canonical shot authority", () => {
  it("A fails hard when the shot id is absent from the episode", async () => {
    const { episode, bible } = await fixtures();
    const controlled = seams("f".repeat(64));

    await expect(
      resolveDurableShotDialogueCompositionState(input(episode, bible, undefined, "S99"), controlled.dependencies),
    ).rejects.toThrow("Shot S99 was not found in episode EP02.");
    expect(planBuilder).not.toHaveBeenCalled();
    expectNoReads(controlled);
  });

  it("B fails hard when the shot id appears in more than one scene", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = structuredClone(base);
    episode.scenes.push({ ...structuredClone(episode.scenes[0]!), id: "SC02", shots: [structuredClone(episode.scenes[0]!.shots[1]!)] });
    const controlled = seams("f".repeat(64));

    await expect(
      resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies),
    ).rejects.toThrow("Shot S02 appears in more than one scene of episode EP02.");
    expect(planBuilder).not.toHaveBeenCalled();
    expectNoReads(controlled);
  });

  it("C returns NO_DIALOGUE from the canonical non-dialogue shot without planning or reads", async () => {
    const { episode, bible } = await fixtures();
    const controlled = seams("f".repeat(64));

    const state = await resolveDurableShotDialogueCompositionState(
      input(episode, bible, undefined, "S01"),
      controlled.dependencies,
    );

    expect(state).toEqual({ state: "NO_DIALOGUE", episodeId: "EP02", sceneId: "SC01", shotId: "S01" });
    expect(Object.isFrozen(state)).toBe(true);
    expect(planBuilder).not.toHaveBeenCalled();
    expectNoReads(controlled);
  });

  it("C/D derives NO_DIALOGUE from the episode's copy of the shot, not from any other shot content", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = structuredClone(base);
    episode.scenes[0]!.shots[1]!.dialogue = [];
    const controlled = seams("f".repeat(64));

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state.state).toBe("NO_DIALOGUE");
    expect(planBuilder).not.toHaveBeenCalled();
    expectNoReads(controlled);
  });

  it("D builds the plan once from the canonical scene and Shot object stored in the episode", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["KACEY", "OLLIE"]);
    const plan = await canonicalPlanFor(episode, bible);
    const controlled = seams(plan);

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(planBuilder).toHaveBeenCalledTimes(1);
    const [planInput] = planBuilder.mock.calls[0]!;
    expect(planInput.episodeId).toBe("EP02");
    expect(planInput.sceneId).toBe("SC01");
    expect(planInput.shot).toBe(episode.scenes[0]!.shots[1]);
    expect(planInput.bible).toBe(bible);
    expect(state).toMatchObject({ dialoguePlanKey: plan.planKey, missingLineIds: [L01, L02] });
  });

  it("D derives the scene id from the episode, including for a shot in a later scene", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = structuredClone(base);
    const moved = episode.scenes[0]!.shots.splice(1, 1)[0]!;
    episode.scenes.push({ ...structuredClone(episode.scenes[0]!), id: "SC03", shots: [moved] });
    const plan = await canonicalPlanFor(episode, bible, 1, 0);
    const controlled = seams(plan);

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(planBuilder.mock.calls[0]![0].sceneId).toBe("SC03");
    expect(planBuilder.mock.calls[0]![0].shot).toBe(moved);
    expect(state).toEqual({
      state: "DIALOGUE_AUDIO_REQUIRED",
      episodeId: "EP02",
      sceneId: "SC03",
      shotId: "S02",
      dialoguePlanKey: plan.planKey,
      missingLineIds: ["EP02_SC03_S02_L01"],
    });
    expect(controlled.inspectDirectSeedAudioPlanLifecycles).toHaveBeenCalledWith(
      "C:/controlled-media-root",
      "EP02",
      "SC03",
      "S02",
      "EP02_SC03_S02_L01",
    );
    expect(controlled.inspectLineLifecycle).toHaveBeenCalledWith(
      "C:/controlled-media-root",
      "EP02",
      "SC03",
      "S02",
      "EP02_SC03_S02_L01",
    );
  });

  it("D exposes no Shot, scene, plan or lifecycle input", () => {
    expectTypeOf<ResolveDurableShotDialogueCompositionStateInput>().toEqualTypeOf<
      Readonly<{
        episode: EpisodeManifest;
        shotId: string;
        bible: CharacterBible;
        mediaRoot: string;
        ffprobeExecutable: string;
      }>
    >();
  });

  it("E no blockers but an unexpected planner failure is a hard failure (not caught)", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["OLLIE", "KACEY"]);
    const controlled = seams("f".repeat(64));
    const failure = new Error("controlled planner failure");
    planBuilder.mockImplementationOnce(() => {
      throw failure;
    });

    await expect(
      resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies),
    ).rejects.toBe(failure);
    expect(planBuilder).toHaveBeenCalledTimes(1);
    expectNoReads(controlled);
  });
});

describe("C3 planning-blocked path", () => {
  it("A unknown speaker + both namespaces empty -> DIALOGUE_PLANNING_BLOCKED; planner not called", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["KACEY", "GHOST"]);
    const controlled = seams("f".repeat(64));

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state).toEqual({
      state: "DIALOGUE_PLANNING_BLOCKED",
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      blockers: [{ reason: "UNKNOWN_DIALOGUE_CHARACTER", lineNumber: 2, dialogueLineId: L02, characterId: "GHOST" }],
    });
    expect("dialoguePlanKey" in state).toBe(false);
    expectFrozenArrays(state);
    expect(planBuilder).not.toHaveBeenCalled();
    expectBothNamespacesInspected(controlled, [L01, L02]);
    expectNoPlacementPhase(controlled);
  });

  it("B unlocked voice + both namespaces empty -> DIALOGUE_PLANNING_BLOCKED (VOICE_NOT_LOCKED)", async () => {
    const { episode: base, bible: baseBible } = await fixtures();
    const episode = episodeWithDialogue(base, ["OLLIE", "KACEY", "OLLIE"]);
    const bible = withPendingVoice(baseBible, "OLLIE");
    const controlled = seams("f".repeat(64));

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state).toEqual({
      state: "DIALOGUE_PLANNING_BLOCKED",
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      blockers: [
        { reason: "VOICE_NOT_LOCKED", lineNumber: 1, dialogueLineId: L01, characterId: "OLLIE", voiceSelectionStatus: "PENDING" },
        { reason: "VOICE_NOT_LOCKED", lineNumber: 3, dialogueLineId: L03, characterId: "OLLIE", voiceSelectionStatus: "PENDING" },
      ],
    });
    expect(planBuilder).not.toHaveBeenCalled();
    expectBothNamespacesInspected(controlled, [L01, L02, L03]);
    expectNoPlacementPhase(controlled);
  });

  it.each([
    ["LINE_SCOPED", "RESERVED_ONLY"],
    ["LINE_SCOPED", "SUBMITTED"],
    ["DIRECT_SEED_AUDIO", "RESERVED_ONLY"],
    ["DIRECT_SEED_AUDIO", "SUBMITTED"],
  ] as const)("F-I blocked + %s %s -> DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED", async (namespace, active) => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["GHOST", "KACEY"]);
    const controlled = seams(
      "f".repeat(64),
      namespace === "LINE_SCOPED"
        ? { current: { [L02]: classification(active, OLD_PLAN_B) } }
        : { history: { [L02]: [[OLD_PLAN_A, active]] } },
    );

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state).toEqual({
      state: "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED",
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      blockers: [{ reason: "UNKNOWN_DIALOGUE_CHARACTER", lineNumber: 1, dialogueLineId: L01, characterId: "GHOST" }],
      activeWork: [work(L02, namespace, namespace === "LINE_SCOPED" ? OLD_PLAN_B : OLD_PLAN_A, active)],
    });
    expectFrozenArrays(state);
    expect(planBuilder).not.toHaveBeenCalled();
    expectNoPlacementPhase(controlled);
  });

  it("J active work in both namespaces on several lines is retained in line, namespace, planKey order", async () => {
    const { episode: base, bible: baseBible } = await fixtures();
    const episode = episodeWithDialogue(base, ["OLLIE", "KACEY", "OLLIE"]);
    const bible = withPendingVoice(baseBible, "OLLIE");
    const controlled = seams("f".repeat(64), {
      current: {
        [L01]: classification("SUBMITTED", OLD_PLAN_C),
        [L02]: classification("COMPLETED", OLD_PLAN_A),
        [L03]: classification("RESERVED_ONLY", OLD_PLAN_A),
      },
      history: {
        [L01]: [
          [OLD_PLAN_A, "RESERVED_ONLY"],
          [OLD_PLAN_B, "COMPLETED"],
          [OLD_PLAN_C, "SUBMITTED"],
        ],
        [L02]: [[OLD_PLAN_B, "SUBMITTED"]],
      },
    });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state.state).toBe("DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED");
    expect(state.state === "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED" && state.activeWork).toEqual([
      work(L01, "LINE_SCOPED", OLD_PLAN_C, "SUBMITTED"),
      work(L01, "DIRECT_SEED_AUDIO", OLD_PLAN_A, "RESERVED_ONLY"),
      work(L01, "DIRECT_SEED_AUDIO", OLD_PLAN_C, "SUBMITTED"),
      work(L02, "DIRECT_SEED_AUDIO", OLD_PLAN_B, "SUBMITTED"),
      work(L03, "LINE_SCOPED", OLD_PLAN_A, "RESERVED_ONLY"),
    ]);
  });

  it.each([
    ["completed-only", { current: { [L01]: "COMPLETED" }, history: { [L01]: [[OLD_PLAN_A, "COMPLETED"]], [L02]: [[OLD_PLAN_B, "COMPLETED"]] } }],
    ["NOTHING-only", { history: { [L01]: [[OLD_PLAN_A, "NOTHING"]] } }],
  ] as const)("K/L blocked + %s evidence -> DIALOGUE_PLANNING_BLOCKED", async (_label, scenario) => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["KACEY", "GHOST"]);
    const controlled = seams("f".repeat(64), scenario);

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state.state).toBe("DIALOGUE_PLANNING_BLOCKED");
    expectNoPlacementPhase(controlled);
  });

  it.each(["LINE_SCOPED", "DIRECT_SEED_AUDIO"] as const)(
    "M/N blocked + %s corruption -> hard failure",
    async (namespace) => {
      const { episode: base, bible } = await fixtures();
      const episode = episodeWithDialogue(base, ["GHOST"]);
      const controlled = seams("f".repeat(64));
      const corruption = new Error(`controlled ${namespace} corruption`);
      if (namespace === "LINE_SCOPED") {
        controlled.inspectLineLifecycle.mockRejectedValue(corruption);
      } else {
        controlled.inspectDirectSeedAudioPlanLifecycles.mockRejectedValue(corruption);
      }

      await expect(
        resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies),
      ).rejects.toBe(corruption);
      expectNoPlacementPhase(controlled);
    },
  );

  it("O later-line corruption is not hidden by an earlier blocker or active work", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["GHOST", "KACEY", "MONT"]);
    const controlled = seams("f".repeat(64), { current: { [L01]: "RESERVED_ONLY" } });
    const corruption = new Error("controlled later-line corruption");
    controlled.inspectDirectSeedAudioPlanLifecycles.mockImplementation(async (_m, _e, _s, _sh, lineId) => {
      if (lineId === L03) throw corruption;
      return Object.freeze([]);
    });

    await expect(
      resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies),
    ).rejects.toBe(corruption);
    expect(controlled.inspectDirectSeedAudioPlanLifecycles).toHaveBeenCalledTimes(3);
  });
});

describe("C3 current-plan lifecycle buckets", () => {
  it("F all current lines NOTHING with no other evidence -> DIALOGUE_AUDIO_REQUIRED in canonical order", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["OLLIE", "KACEY", "OLLIE"]);
    const plan = await canonicalPlanFor(episode, bible);
    const controlled = seams(plan);

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state).toEqual({
      state: "DIALOGUE_AUDIO_REQUIRED",
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialoguePlanKey: plan.planKey,
      missingLineIds: [L01, L02, L03],
    });
    expectFrozenArrays(state);
    expectBothNamespacesInspected(controlled, [L01, L02, L03]);
    expectNoPlacementPhase(controlled);
  });

  it("G COMPLETED + NOTHING -> DIALOGUE_AUDIO_REQUIRED listing only NOTHING lines", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["OLLIE", "KACEY", "MONT"]);
    const plan = await canonicalPlanFor(episode, bible);
    const controlled = seams(plan, { current: { [L01]: "COMPLETED", [L03]: "COMPLETED" } });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state).toEqual({
      state: "DIALOGUE_AUDIO_REQUIRED",
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialoguePlanKey: plan.planKey,
      missingLineIds: [L02],
    });
    expectNoPlacementPhase(controlled);
  });

  it("H current RESERVED_ONLY -> DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["KACEY", "OLLIE"]);
    const plan = await canonicalPlanFor(episode, bible);
    const controlled = seams(plan, { current: { [L01]: "RESERVED_ONLY", [L02]: "COMPLETED" } });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state).toEqual({
      state: "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED",
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialoguePlanKey: plan.planKey,
      reservedLineIds: [L01],
      submittedLineIds: [],
      missingLineIds: [],
    });
    expectFrozenArrays(state);
    expectNoPlacementPhase(controlled);
  });

  it("I current SUBMITTED without reserved -> DIALOGUE_RECONCILIATION_REQUIRED", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["OLLIE", "KACEY", "MONT"]);
    const plan = await canonicalPlanFor(episode, bible);
    const controlled = seams(plan, { current: { [L01]: "COMPLETED", [L02]: "SUBMITTED" } });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state).toEqual({
      state: "DIALOGUE_RECONCILIATION_REQUIRED",
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialoguePlanKey: plan.planKey,
      submittedLineIds: [L02],
      missingLineIds: [L03],
    });
    expectFrozenArrays(state);
    expectNoPlacementPhase(controlled);
  });

  it("J SUBMITTED + RESERVED_ONLY + NOTHING -> RESERVED state carrying every bucket", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["OLLIE", "KACEY", "MONT"]);
    const plan = await canonicalPlanFor(episode, bible);
    const controlled = seams(plan, { current: { [L01]: "SUBMITTED", [L02]: "NOTHING", [L03]: "RESERVED_ONLY" } });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state).toEqual({
      state: "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED",
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialoguePlanKey: plan.planKey,
      reservedLineIds: [L03],
      submittedLineIds: [L01],
      missingLineIds: [L02],
    });
    expectNoPlacementPhase(controlled);
  });

  it("K corruption on a later line throws even when an earlier line is RESERVED_ONLY", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["KACEY", "MONT"]);
    const plan = await canonicalPlanFor(episode, bible);
    const controlled = seams(plan, { current: { [L01]: "RESERVED_ONLY" } });
    const corruption = new Error("Dialogue lifecycle submission exists without a durable reservation.");
    controlled.inspectLineLifecycle.mockImplementation(async (_m, _e, _s, _sh, lineId) => {
      if (lineId === L02) throw corruption;
      return classification("RESERVED_ONLY", plan.planKey);
    });

    await expect(
      resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies),
    ).rejects.toBe(corruption);
    expect(controlled.inspectLineLifecycle.mock.calls.map((call) => call[4])).toEqual([L01, L02]);
    expectNoPlacementPhase(controlled);
  });

  it("K corruption in a later Direct-SeedAudio line throws after an earlier SUBMITTED line", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["KACEY", "OLLIE"]);
    const plan = await canonicalPlanFor(episode, bible);
    const controlled = seams(plan, { current: { [L01]: "SUBMITTED" } });
    const corruption = new Error("controlled direct SeedAudio corruption");
    controlled.inspectDirectSeedAudioPlanLifecycles.mockImplementation(async (_m, _e, _s, _sh, lineId) => {
      if (lineId === L02) throw corruption;
      return Object.freeze([]);
    });

    await expect(
      resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies),
    ).rejects.toBe(corruption);
    expectNoPlacementPhase(controlled);
  });

  it("L line-scoped current evidence with a stale reservation planKey fails hard", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["KACEY"]);
    const plan = await canonicalPlanFor(episode, bible);
    const controlled = seams(plan, { current: { [L01]: classification("COMPLETED", OLD_PLAN_A) } });

    await expect(
      resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies),
    ).rejects.toThrow(
      `Dialogue lifecycle evidence for ${L01} belongs to dialogue plan ${OLD_PLAN_A}, not current canonical plan ${plan.planKey}.`,
    );
    expectNoPlacementPhase(controlled);
  });

  it.each(["RESERVED_ONLY", "SUBMITTED"] as const)(
    "L stale line-scoped current %s evidence fails hard instead of becoming an intervention state",
    async (stateName) => {
      const { episode: base, bible } = await fixtures();
      const episode = episodeWithDialogue(base, ["MONT", "KACEY"]);
      const plan = await canonicalPlanFor(episode, bible);
      const controlled = seams(plan, { current: { [L02]: classification(stateName, OLD_PLAN_B) } });

      await expect(
        resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies),
      ).rejects.toThrow(/belongs to dialogue plan/);
    },
  );

  it("M/N inspects both namespaces for every line with the canonical identity", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["OLLIE", "KACEY"]);
    const plan = await canonicalPlanFor(episode, bible);
    const mediaRoot = "C:/dispatch-media-root";
    const controlled = seams(plan);

    await resolveDurableShotDialogueCompositionState(input(episode, bible, mediaRoot), controlled.dependencies);

    expect(controlled.inspectLineLifecycle.mock.calls).toEqual([
      [mediaRoot, "EP02", "SC01", "S02", L01],
      [mediaRoot, "EP02", "SC01", "S02", L02],
    ]);
    expect(controlled.inspectDirectSeedAudioPlanLifecycles.mock.calls).toEqual([
      [mediaRoot, "EP02", "SC01", "S02", L01],
      [mediaRoot, "EP02", "SC01", "S02", L02],
    ]);
  });

  it("AH exhaustive mixed current states across three lines follow the locked precedence", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["OLLIE", "KACEY", "MONT"]);
    const plan = await canonicalPlanFor(episode, bible);
    const lineIds = [L01, L02, L03];
    let cases = 0;

    for (const stale of [false, true]) {
      for (const a of ALL_STATES) {
        for (const b of ALL_STATES) {
          for (const c of ALL_STATES) {
            const states = [a, b, c];
            const controlled = seams(plan, {
              current: { [L01]: a, [L02]: b, [L03]: c },
              history: stale ? { [L01]: [[OLD_PLAN_A, "SUBMITTED"]] } : {},
            });

            const result = await resolveDurableShotDialogueCompositionState(
              input(episode, bible),
              controlled.dependencies,
            );

            const expected = expectedStateFor(states, stale);
            expect(result.state, `${states.join(",")} stale=${stale}`).toBe(expected);

            const idsIn = (target: LifecycleState) => lineIds.filter((_id, index) => states[index] === target);
            if ("missingLineIds" in result) {
              expect(result.missingLineIds).toEqual(idsIn("NOTHING"));
            }
            if ("submittedLineIds" in result) {
              expect(result.submittedLineIds).toEqual(idsIn("SUBMITTED"));
            }
            if ("reservedLineIds" in result) {
              expect(result.reservedLineIds).toEqual(idsIn("RESERVED_ONLY"));
            }
            if (result.state === "DIALOGUE_AUDIO_REQUIRED") {
              expect(states.every((state) => state === "NOTHING" || state === "COMPLETED")).toBe(true);
              expect(stale).toBe(false);
            }
            expectBothNamespacesInspected(controlled, lineIds);
            expect(controlled.readLatestPlacementDecision).toHaveBeenCalledTimes(
              expected === "PLACEMENT_REQUIRED" ? 1 : 0,
            );
            expect(controlled.resolveCompositionAudioPlan).not.toHaveBeenCalled();
            cases += 1;
          }
        }
      }
    }

    expect(cases).toBe(128);
  });
});

describe("C3 cross-plan Direct-SeedAudio guard", () => {
  async function directSeedShot() {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["OLLIE", "KACEY", "OLLIE"]);
    const plan = await canonicalPlanFor(episode, bible);
    return { episode, bible, plan };
  }

  it.each(["RESERVED_ONLY", "SUBMITTED"] as const)(
    "O/P historical %s + current NOTHING -> STALE, never DIALOGUE_AUDIO_REQUIRED",
    async (historicalState) => {
      const { episode, bible, plan } = await directSeedShot();
      const controlled = seams(plan, { history: { [L01]: [[OLD_PLAN_A, historicalState]] } });

      const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

      expect(state).toEqual({
        state: "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED",
        episodeId: "EP02",
        sceneId: "SC01",
        shotId: "S02",
        dialoguePlanKey: plan.planKey,
        staleWork: [work(L01, "DIRECT_SEED_AUDIO", OLD_PLAN_A, historicalState)],
        reservedLineIds: [],
        submittedLineIds: [],
        missingLineIds: [L01, L02, L03],
      });
      expectFrozenArrays(state);
      expectNoPlacementPhase(controlled);
    },
  );

  it("Q historical COMPLETED only + current NOTHING -> DIALOGUE_AUDIO_REQUIRED, history not reported", async () => {
    const { episode, bible, plan } = await directSeedShot();
    const controlled = seams(plan, {
      history: { [L01]: [[OLD_PLAN_A, "COMPLETED"]], [L03]: [[OLD_PLAN_B, "COMPLETED"], [OLD_PLAN_C, "NOTHING"]] },
    });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state).toEqual({
      state: "DIALOGUE_AUDIO_REQUIRED",
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialoguePlanKey: plan.planKey,
      missingLineIds: [L01, L02, L03],
    });
  });

  it("R historical SUBMITTED + current RESERVED_ONLY -> STALE carrying the current reserved line", async () => {
    const { episode, bible, plan } = await directSeedShot();
    const controlled = seams(plan, {
      current: { [L01]: "RESERVED_ONLY", [L02]: "COMPLETED", [L03]: "COMPLETED" },
      history: { [L01]: [[OLD_PLAN_A, "SUBMITTED"]] },
    });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state).toMatchObject({
      state: "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED",
      staleWork: [work(L01, "DIRECT_SEED_AUDIO", OLD_PLAN_A, "SUBMITTED")],
      reservedLineIds: [L01],
      submittedLineIds: [],
      missingLineIds: [],
    });
    expectNoPlacementPhase(controlled);
  });

  it("S historical active + current SUBMITTED -> STALE outranks reconciliation", async () => {
    const { episode, bible, plan } = await directSeedShot();
    const controlled = seams(plan, {
      current: { [L01]: "COMPLETED", [L02]: "SUBMITTED", [L03]: "SUBMITTED" },
      history: { [L03]: [[OLD_PLAN_B, "RESERVED_ONLY"]] },
    });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state).toMatchObject({
      state: "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED",
      staleWork: [work(L03, "DIRECT_SEED_AUDIO", OLD_PLAN_B, "RESERVED_ONLY")],
      reservedLineIds: [],
      submittedLineIds: [L02, L03],
      missingLineIds: [],
    });
    expectNoPlacementPhase(controlled);
  });

  it("T/AI reports every historical active plan in canonical-line then planKey order; COMPLETED hides nothing", async () => {
    const { episode, bible, plan } = await directSeedShot();
    const controlled = seams(plan, {
      current: { [L01]: "COMPLETED", [L02]: "COMPLETED", [L03]: "COMPLETED" },
      history: {
        [L01]: [
          [OLD_PLAN_A, "COMPLETED"],
          [OLD_PLAN_B, "SUBMITTED"],
          [OLD_PLAN_C, "RESERVED_ONLY"],
        ],
        [L03]: [
          [OLD_PLAN_A, "RESERVED_ONLY"],
          [OLD_PLAN_B, "COMPLETED"],
          [OLD_PLAN_C, "SUBMITTED"],
        ],
      },
      decision: DECISION,
    });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state).toEqual({
      state: "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED",
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialoguePlanKey: plan.planKey,
      staleWork: [
        work(L01, "DIRECT_SEED_AUDIO", OLD_PLAN_B, "SUBMITTED"),
        work(L01, "DIRECT_SEED_AUDIO", OLD_PLAN_C, "RESERVED_ONLY"),
        work(L03, "DIRECT_SEED_AUDIO", OLD_PLAN_A, "RESERVED_ONLY"),
        work(L03, "DIRECT_SEED_AUDIO", OLD_PLAN_C, "SUBMITTED"),
      ],
      reservedLineIds: [],
      submittedLineIds: [],
      missingLineIds: [],
    });
    expectFrozenArrays(state);
    expectNoPlacementPhase(controlled);
  });

  it("U historical active work on a later line is never hidden by an earlier ordinary line", async () => {
    const { episode, bible, plan } = await directSeedShot();
    const controlled = seams(plan, {
      current: { [L01]: "RESERVED_ONLY", [L02]: "SUBMITTED" },
      history: { [L03]: [[OLD_PLAN_A, "SUBMITTED"]] },
    });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state).toMatchObject({
      state: "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED",
      staleWork: [work(L03, "DIRECT_SEED_AUDIO", OLD_PLAN_A, "SUBMITTED")],
      reservedLineIds: [L01],
      submittedLineIds: [L02],
      missingLineIds: [L03],
    });
  });

  it("V a Direct-SeedAudio inspector failure is a hard failure, never an ordinary state", async () => {
    const { episode, bible, plan } = await directSeedShot();
    const controlled = seams(plan, { current: { [L01]: "RESERVED_ONLY" } });
    const corruption = new Error("Unexpected entry in direct SeedAudio plan directory: x");
    controlled.inspectDirectSeedAudioPlanLifecycles.mockImplementation(async (_m, _e, _s, _sh, lineId) => {
      if (lineId === L03) throw corruption;
      return Object.freeze([]);
    });

    await expect(
      resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies),
    ).rejects.toBe(corruption);
    expect(controlled.inspectDirectSeedAudioPlanLifecycles).toHaveBeenCalledTimes(3);
    expectNoPlacementPhase(controlled);
  });

  it.each([
    ["absent", false],
    ["empty directory", true],
  ] as const)("G current Direct-SeedAudio plan %s -> current NOTHING", async (_label, currentDirectory) => {
    const { episode, bible, plan } = await directSeedShot();
    const controlled = seams(plan, {
      current: { [L02]: "COMPLETED", [L03]: "COMPLETED" },
      currentDirectory: { [L01]: currentDirectory },
    });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state).toMatchObject({ state: "DIALOGUE_AUDIO_REQUIRED", missingLineIds: [L01] });
  });
});

describe("C3 cross-namespace guard on the successful-plan path", () => {
  it.each(["RESERVED_ONLY", "SUBMITTED"] as const)(
    "A/B current LINE_SCOPED + Direct-SeedAudio %s -> STALE, never AUDIO_REQUIRED",
    async (active) => {
      const { episode: base, bible } = await fixtures();
      const episode = episodeWithDialogue(base, ["KACEY"]);
      const plan = await canonicalPlanFor(episode, bible);
      const controlled = seams(plan, { history: { [L01]: [[OLD_PLAN_A, active]] } });

      const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

      expect(state).toEqual({
        state: "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED",
        episodeId: "EP02",
        sceneId: "SC01",
        shotId: "S02",
        dialoguePlanKey: plan.planKey,
        staleWork: [work(L01, "DIRECT_SEED_AUDIO", OLD_PLAN_A, active)],
        reservedLineIds: [],
        submittedLineIds: [],
        missingLineIds: [L01],
      });
    },
  );

  it("C current LINE_SCOPED + Direct-SeedAudio COMPLETED only -> AUDIO_REQUIRED", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["KACEY"]);
    const plan = await canonicalPlanFor(episode, bible);
    const controlled = seams(plan, { history: { [L01]: [[OLD_PLAN_A, "COMPLETED"], [plan.planKey, "COMPLETED"]] } });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state).toMatchObject({ state: "DIALOGUE_AUDIO_REQUIRED", missingLineIds: [L01] });
  });

  it.each(["RESERVED_ONLY", "SUBMITTED"] as const)(
    "D/E current Direct-SeedAudio + LINE_SCOPED %s -> STALE with the record's planKey",
    async (active) => {
      const { episode: base, bible } = await fixtures();
      const episode = episodeWithDialogue(base, ["OLLIE"]);
      const plan = await canonicalPlanFor(episode, bible);
      const controlled = seams(plan, { lineScoped: { [L01]: classification(active, plan.planKey) } });

      const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

      expect(state).toEqual({
        state: "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED",
        episodeId: "EP02",
        sceneId: "SC01",
        shotId: "S02",
        dialoguePlanKey: plan.planKey,
        staleWork: [work(L01, "LINE_SCOPED", plan.planKey, active)],
        reservedLineIds: [],
        submittedLineIds: [],
        missingLineIds: [L01],
      });
    },
  );

  it("F current Direct-SeedAudio + LINE_SCOPED COMPLETED only -> AUDIO_REQUIRED (no stale-planKey rule for the other namespace)", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["OLLIE"]);
    const plan = await canonicalPlanFor(episode, bible);
    const controlled = seams(plan, { lineScoped: { [L01]: classification("COMPLETED", OLD_PLAN_C) } });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state).toMatchObject({ state: "DIALOGUE_AUDIO_REQUIRED", missingLineIds: [L01] });
  });

  it.each([
    ["RESERVED_ONLY", "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED"],
    ["SUBMITTED", "DIALOGUE_RECONCILIATION_REQUIRED"],
    ["COMPLETED", "PLACEMENT_REQUIRED"],
  ] as const)("H-J current Direct-SeedAudio plan %s -> %s", async (current, expected) => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["OLLIE"]);
    const plan = await canonicalPlanFor(episode, bible);
    const controlled = seams(plan, { current: { [L01]: current }, lineScoped: { [L01]: "COMPLETED" } });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state.state).toBe(expected);
  });

  it.each(["LINE_SCOPED", "DIRECT_SEED_AUDIO"] as const)(
    "M corruption in the non-current %s namespace hard-fails under an ordinary current state",
    async (namespace) => {
      const { episode: base, bible } = await fixtures();
      const characters = namespace === "LINE_SCOPED" ? (["OLLIE"] as const) : (["KACEY"] as const);
      const episode = episodeWithDialogue(base, characters);
      const plan = await canonicalPlanFor(episode, bible);
      const controlled = seams(plan, { current: { [L01]: "COMPLETED" } });
      const corruption = new Error(`controlled ${namespace} corruption`);
      if (namespace === "LINE_SCOPED") {
        controlled.inspectLineLifecycle.mockRejectedValue(corruption);
      } else {
        controlled.inspectDirectSeedAudioPlanLifecycles.mockRejectedValue(corruption);
      }

      await expect(
        resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies),
      ).rejects.toBe(corruption);
      expectNoPlacementPhase(controlled);
    },
  );

  it("N later-line cross-namespace active work cannot be hidden", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["KACEY", "MONT", "OLLIE"]);
    const plan = await canonicalPlanFor(episode, bible);
    const controlled = seams(plan, {
      current: { [L01]: "RESERVED_ONLY", [L02]: "COMPLETED" },
      lineScoped: { [L03]: classification("SUBMITTED", OLD_PLAN_B) },
    });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state).toMatchObject({
      state: "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED",
      staleWork: [work(L03, "LINE_SCOPED", OLD_PLAN_B, "SUBMITTED")],
      reservedLineIds: [L01],
      missingLineIds: [L03],
    });
  });

  it("staleWork orders LINE_SCOPED before DIRECT_SEED_AUDIO within a line", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["OLLIE"]);
    const plan = await canonicalPlanFor(episode, bible);
    const controlled = seams(plan, {
      lineScoped: { [L01]: classification("RESERVED_ONLY", OLD_PLAN_C) },
      history: { [L01]: [[OLD_PLAN_B, "SUBMITTED"], [OLD_PLAN_A, "RESERVED_ONLY"]] },
    });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state.state === "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED" && state.staleWork).toEqual([
      work(L01, "LINE_SCOPED", OLD_PLAN_C, "RESERVED_ONLY"),
      work(L01, "DIRECT_SEED_AUDIO", OLD_PLAN_A, "RESERVED_ONLY"),
      work(L01, "DIRECT_SEED_AUDIO", OLD_PLAN_B, "SUBMITTED"),
    ]);
  });

  // Step-915 exhaustive table: CURRENT x OTHER x HISTORICAL for both voice modes.
  it("P exhaustive single-line namespace/precedence table (2 modes x 4 x 4 x 3 = 96 rows)", async () => {
    const { episode: base, bible } = await fixtures();
    const historicalOptions = ["none", "active", "completed-only"] as const;
    let rows = 0;

    for (const mode of ["LINE_SCOPED", "DIRECT_SEED_AUDIO"] as const) {
      const episode = episodeWithDialogue(base, [mode === "LINE_SCOPED" ? "KACEY" : "OLLIE"]);
      const plan = await canonicalPlanFor(episode, bible);

      for (const current of ALL_STATES) {
        for (const other of ALL_STATES) {
          for (const historical of historicalOptions) {
            const history: HistoryEntry[] = [];
            if (historical === "active") history.push([OLD_PLAN_B, "SUBMITTED"]);
            if (historical === "completed-only") history.push([OLD_PLAN_B, "COMPLETED"]);
            const scenario: Scenario =
              mode === "LINE_SCOPED"
                ? {
                    current: { [L01]: current },
                    history: { [L01]: [[OLD_PLAN_A, other], ...history] },
                  }
                : {
                    current: { [L01]: current },
                    lineScoped: { [L01]: classification(other, OLD_PLAN_C) },
                    history: { [L01]: history },
                  };
            const controlled = seams(plan, scenario);

            const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

            const expectedWork: DialogueActiveWork[] = [];
            if (mode === "LINE_SCOPED") {
              if (isActive(other)) expectedWork.push(work(L01, "DIRECT_SEED_AUDIO", OLD_PLAN_A, other));
            } else if (isActive(other)) {
              expectedWork.push(work(L01, "LINE_SCOPED", OLD_PLAN_C, other));
            }
            if (historical === "active") expectedWork.push(work(L01, "DIRECT_SEED_AUDIO", OLD_PLAN_B, "SUBMITTED"));

            const expected = expectedStateFor([current], expectedWork.length > 0);
            const label = `${mode} current=${current} other=${other} historical=${historical}`;
            expect(state.state, label).toBe(expected);
            if (state.state === "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED") {
              expect(state.staleWork, label).toEqual(expectedWork);
            }
            if (state.state === "DIALOGUE_AUDIO_REQUIRED") {
              expect(expectedWork, label).toEqual([]);
              expect(current, label).toBe("NOTHING");
            }
            expectBothNamespacesInspected(controlled, [L01]);
            rows += 1;
          }
        }
      }
    }

    expect(rows).toBe(96);
  });
});

// Real lifecycle creators, readers and inspectors on a temporary media root;
// the canonical EP02/S02 line is Direct-SeedAudio.
describe("C3 guards with real durable evidence", () => {
  const REFERENCE_AUDIO_SHA256 = "ad7bc6a50675bddc74a4885f290667fad1076c5cd3d9844eb7ff2d84b0f94a2f";

  function planSnapshot(planKey: string) {
    return {
      planKey,
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialogueLineId: L01,
      lineNumber: 1,
      characterId: "OLLIE",
      characterName: "Ollie",
      text: "Look what I found!",
      deliveryNotes: "Curious, excited and gentle.",
      voice: {
        selectionStatus: "LOCKED",
        provider: "RUNWAY",
        voiceName: "Ollie",
        deliveryTraits: ["young", "curious", "warm", "friendly", "natural"] as string[],
        executionMode: "RUNWAY_REFERENCE_AUDIO",
        referenceAudio: {
          assetId: "OLLIE_VOICE_REFERENCE_V1",
          mediaRootRelativePath: "references/voices/OLLIE/ollie-reference-v1.mp3",
          bytes: 231_593,
          sha256: REFERENCE_AUDIO_SHA256,
          contentType: "audio/mpeg",
          durationSeconds: 14.4,
          codecName: "mp3",
          sampleRateHz: 44_100,
          channels: 1,
        },
      },
    } as const;
  }

  const reservationInput = (planKey: string) =>
    ({ episodeId: "EP02", sceneId: "SC01", shotId: "S02", dialogueLineId: L01, planKey, provider: "RUNWAY" }) as const;

  async function reserve(mediaRoot: string, planKey: string): Promise<void> {
    await createDialogueDirectSeedAudioReservation(mediaRoot, reservationInput(planKey), {
      now: () => "2026-10-06T17:00:00.000Z",
      createReservationId: () => `22222222-2222-4222-8222-${planKey.slice(0, 12)}`,
    });
  }

  async function reserveLineScoped(mediaRoot: string, planKey: string): Promise<void> {
    await createDialogueReservation(mediaRoot, reservationInput(planKey), {
      now: () => "2026-10-06T16:00:00.000Z",
      createReservationId: () => "33333333-3333-4333-8333-333333333333",
    });
  }

  async function submit(mediaRoot: string, planKey: string): Promise<void> {
    await reserve(mediaRoot, planKey);
    await createDialogueDirectSeedAudioSubmission(
      mediaRoot,
      {
        reservationId: `22222222-2222-4222-8222-${planKey.slice(0, 12)}`,
        episodeId: "EP02",
        sceneId: "SC01",
        shotId: "S02",
        dialogueLineId: L01,
        planKey,
        provider: "RUNWAY",
        providerExecutionId: `task-c3-${planKey.slice(0, 8)}`,
        providerEstimatedCredits: 5.25,
        recoveryMetadata: {
          request: {
            model: "seed_audio",
            promptText: "Look what I found!",
            outputFormat: "mp3",
            sampleRate: 44_100,
            voice: { type: "reference-audio", audioUri: "runway://uploads/ollie-reference-v1" },
          },
          localCreditCeiling: 30,
          plan: planSnapshot(planKey),
        },
      },
      { now: () => "2026-10-06T17:01:00.000Z" },
    );
  }

  it.each([
    ["RESERVED_ONLY", reserve],
    ["SUBMITTED", submit],
  ] as const)("O/P real historical %s + current NOTHING -> STALE through default dependencies", async (stateName, create) => {
    const { episode, bible } = await fixtures();
    const plan = await canonicalPlanFor(episode, bible);
    const mediaRoot = await createMediaRoot();
    await create(mediaRoot, OLD_PLAN_A);

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible, mediaRoot));

    expect(state).toEqual({
      state: "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED",
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialoguePlanKey: plan.planKey,
      staleWork: [work(L01, "DIRECT_SEED_AUDIO", OLD_PLAN_A, stateName)],
      reservedLineIds: [],
      submittedLineIds: [],
      missingLineIds: [L01],
    });
  });

  it("real LINE_SCOPED RESERVED_ONLY while the voice is Direct-SeedAudio -> STALE, never AUDIO_REQUIRED", async () => {
    const { episode, bible } = await fixtures();
    const plan = await canonicalPlanFor(episode, bible);
    const mediaRoot = await createMediaRoot();
    await reserveLineScoped(mediaRoot, OLD_PLAN_C);

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible, mediaRoot));

    expect(state).toMatchObject({
      state: "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED",
      dialoguePlanKey: plan.planKey,
      staleWork: [work(L01, "LINE_SCOPED", OLD_PLAN_C, "RESERVED_ONLY")],
      missingLineIds: [L01],
    });
  });

  it("real current-plan RESERVED_ONLY with no other evidence -> RESERVED intervention", async () => {
    const { episode, bible } = await fixtures();
    const plan = await canonicalPlanFor(episode, bible);
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, plan.planKey);

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible, mediaRoot));

    expect(state).toMatchObject({
      state: "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED",
      reservedLineIds: [L01],
      missingLineIds: [],
    });
  });

  it("real unexpected file in the CURRENT Direct-SeedAudio plan directory is a hard failure (tightened)", async () => {
    const { episode, bible } = await fixtures();
    const plan = await canonicalPlanFor(episode, bible);
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, plan.planKey);
    const currentDirectory = dirname(
      createDialogueDirectSeedAudioReservationPath(mediaRoot, "EP02", "SC01", "S02", L01, plan.planKey),
    );
    await writeFile(join(currentDirectory, "notes.txt"), "x", "utf8");

    await expect(resolveDurableShotDialogueCompositionState(input(episode, bible, mediaRoot))).rejects.toThrow(
      /Unexpected entry in direct SeedAudio plan directory/,
    );
  });

  it("real empty historical plan directory (NOTHING) does not block current generation", async () => {
    const { episode, bible } = await fixtures();
    const plan = await canonicalPlanFor(episode, bible);
    const mediaRoot = await createMediaRoot();
    await mkdir(
      dirname(createDialogueDirectSeedAudioReservationPath(mediaRoot, "EP02", "SC01", "S02", L01, OLD_PLAN_A)),
      { recursive: true },
    );

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible, mediaRoot));

    expect(state).toEqual({
      state: "DIALOGUE_AUDIO_REQUIRED",
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialoguePlanKey: plan.planKey,
      missingLineIds: [L01],
    });
  });

  it("V real corrupt historical evidence throws instead of DIALOGUE_AUDIO_REQUIRED", async () => {
    const { episode, bible } = await fixtures();
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, OLD_PLAN_A);
    const reservationPath = createDialogueDirectSeedAudioReservationPath(mediaRoot, "EP02", "SC01", "S02", L01, OLD_PLAN_A);
    await writeFile(reservationPath, "{corrupt", "utf8");

    await expect(resolveDurableShotDialogueCompositionState(input(episode, bible, mediaRoot))).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it("V real stray entry in the Direct-SeedAudio line directory throws", async () => {
    const { episode, bible } = await fixtures();
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, OLD_PLAN_A);
    const lineDirectory = dirname(
      dirname(createDialogueDirectSeedAudioReservationPath(mediaRoot, "EP02", "SC01", "S02", L01, OLD_PLAN_A)),
    );
    await writeFile(join(lineDirectory, "stray.json"), "{}", "utf8");

    await expect(resolveDurableShotDialogueCompositionState(input(episode, bible, mediaRoot))).rejects.toThrow(
      /Unexpected non-directory entry in direct SeedAudio history/,
    );
  });

  it("real corrupt LINE_SCOPED evidence throws for a Direct-SeedAudio line", async () => {
    const { episode, bible } = await fixtures();
    const mediaRoot = await createMediaRoot();
    const reservationPath = createDialogueReservationPath(mediaRoot, "EP02", "SC01", "S02", L01);
    await mkdir(dirname(reservationPath), { recursive: true });
    await writeFile(reservationPath, "{corrupt", "utf8");

    await expect(resolveDurableShotDialogueCompositionState(input(episode, bible, mediaRoot))).rejects.toThrow();
  });

  it("S real planning-blocked (PENDING voice) + real Direct-SeedAudio and LINE_SCOPED reservations -> active-work state", async () => {
    const { episode, bible: baseBible } = await fixtures();
    const bible = withPendingVoice(baseBible, "OLLIE");
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, OLD_PLAN_A);
    await reserveLineScoped(mediaRoot, OLD_PLAN_C);

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible, mediaRoot));

    expect(state).toEqual({
      state: "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED",
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      blockers: [{ reason: "VOICE_NOT_LOCKED", lineNumber: 1, dialogueLineId: L01, characterId: "OLLIE", voiceSelectionStatus: "PENDING" }],
      activeWork: [
        work(L01, "LINE_SCOPED", OLD_PLAN_C, "RESERVED_ONLY"),
        work(L01, "DIRECT_SEED_AUDIO", OLD_PLAN_A, "RESERVED_ONLY"),
      ],
    });
  });

  it("real planning-blocked with no durable evidence -> DIALOGUE_PLANNING_BLOCKED", async () => {
    const { episode, bible: baseBible } = await fixtures();
    const bible = withPendingVoice(baseBible, "OLLIE");
    const mediaRoot = await createMediaRoot();

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible, mediaRoot));

    expect(state.state).toBe("DIALOGUE_PLANNING_BLOCKED");
  });

  it("R real resolution performs no writes", async () => {
    const { episode, bible } = await fixtures();
    const mediaRoot = await createMediaRoot();
    await submit(mediaRoot, OLD_PLAN_A);
    await reserveLineScoped(mediaRoot, OLD_PLAN_C);
    const list = async () =>
      (await readdir(mediaRoot, { recursive: true, withFileTypes: true }))
        .map((entry) => join(entry.parentPath, entry.name))
        .sort();
    const before = await list();

    await resolveDurableShotDialogueCompositionState(input(episode, bible, mediaRoot));
    await resolveDurableShotDialogueCompositionState(input(episode, withPendingVoice(bible, "OLLIE"), mediaRoot));

    expect(await list()).toEqual(before);
  });
});

describe("C3 placement and B2d phase", () => {
  async function allCompleted(characters: readonly Speaker[], scenario: Scenario = {}) {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, characters);
    const plan = await canonicalPlanFor(episode, bible);
    const current = Object.fromEntries(plan.lines.map((line) => [line.dialogueLineId, "COMPLETED" as const]));
    const controlled = seams(plan, { current, ...scenario });
    return { episode, bible, plan, controlled };
  }

  it.each([
    ["line-scoped", ["KACEY", "MONT"]],
    ["Direct-SeedAudio", ["OLLIE"]],
    ["mixed", ["OLLIE", "KACEY"]],
  ] as const)("W all current %s lines COMPLETED + no placement -> PLACEMENT_REQUIRED without B2d", async (_label, characters) => {
    const { episode, bible, plan, controlled } = await allCompleted(characters);
    const mediaRoot = "C:/placement-media-root";

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible, mediaRoot), controlled.dependencies);

    expect(state).toEqual({
      state: "PLACEMENT_REQUIRED",
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialoguePlanKey: plan.planKey,
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(controlled.readLatestPlacementDecision.mock.calls).toEqual([[mediaRoot, "EP02", "SC01", "S02"]]);
    expect(controlled.resolveCompositionAudioPlan).not.toHaveBeenCalled();
  });

  it("X a placement-reader failure is a hard failure", async () => {
    const { episode, bible, controlled } = await allCompleted(["OLLIE", "KACEY"]);
    const corruption = new Error("Dialogue placement decision revision sequence is not contiguous");
    controlled.readLatestPlacementDecision.mockRejectedValue(corruption);

    await expect(
      resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies),
    ).rejects.toBe(corruption);
    expect(controlled.resolveCompositionAudioPlan).not.toHaveBeenCalled();
  });

  it("Y placement exists -> B2d with the exact current plan -> COMPOSITION_AUDIO_RESOLVED with B2d's object", async () => {
    const { episode, bible, plan, controlled } = await allCompleted(["OLLIE", "KACEY"], { decision: DECISION });
    const mediaRoot = "C:/b2d-media-root";

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible, mediaRoot), controlled.dependencies);

    expect(state).toEqual({
      state: "COMPOSITION_AUDIO_RESOLVED",
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialoguePlanKey: plan.planKey,
      audioPlan: AUDIO_PLAN,
    });
    expect(state.state === "COMPOSITION_AUDIO_RESOLVED" && state.audioPlan).toBe(AUDIO_PLAN);
    expect(Object.isFrozen(state)).toBe(true);
    expect(controlled.resolveCompositionAudioPlan).toHaveBeenCalledTimes(1);
    expect(controlled.resolveCompositionAudioPlan.mock.calls[0]).toEqual([
      { mediaRoot, ffprobeExecutable, dialoguePlan: plan },
    ]);
    expect(Object.keys(controlled.resolveCompositionAudioPlan.mock.calls[0]![0]).sort()).toEqual([
      "dialoguePlan",
      "ffprobeExecutable",
      "mediaRoot",
    ]);
  });

  it("Z every B2d failure propagates unchanged and never becomes PLACEMENT_REQUIRED", async () => {
    const { episode, bible, controlled } = await allCompleted(["KACEY"], { decision: DECISION });
    const failure = new Error("Durable dialogue placement decision revision 1 for EP02/SC01/S02 is stale");
    controlled.resolveCompositionAudioPlan.mockRejectedValue(failure);

    await expect(
      resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies),
    ).rejects.toBe(failure);
  });

  it("Z real B2d rejects a durable placement decision for a stale dialogue plan", async () => {
    const { episode, bible, plan, controlled } = await allCompleted(["OLLIE"]);
    const mediaRoot = await createMediaRoot();
    const stalePlan = await canonicalPlanFor(episodeWithDialogue(episode, ["OLLIE", "OLLIE"]), bible);
    const timing: VerifiedShotDialogueTiming = {
      schemaVersion: "1.0",
      timingMode: "AGGREGATE_ONLY",
      episodeId: stalePlan.episodeId,
      sceneId: stalePlan.sceneId,
      shotId: stalePlan.shotId,
      planKey: stalePlan.planKey,
      shotDurationSeconds: stalePlan.shotDurationSeconds,
      durationToleranceSeconds: 0.000001,
      totalSpeechDurationSeconds: 3,
      remainingDurationSeconds: stalePlan.shotDurationSeconds - 3,
      lines: stalePlan.lines.map((line, index) => ({
        lineNumber: line.lineNumber,
        dialogueLineId: line.dialogueLineId,
        sourceAudioPath: `controlled-media-root/voices/${line.dialogueLineId}.audio`,
        sourceBytes: 1000 + index,
        sourceSha256: String(index + 1).repeat(64),
        durationSeconds: 1.5,
      })),
    };
    await createDialoguePlacementDecision(
      mediaRoot,
      {
        dialoguePlan: stalePlan,
        timing,
        placements: stalePlan.lines.map((line, index) => ({
          dialogueLineId: line.dialogueLineId,
          startSeconds: 0.5 + index * 2,
        })),
      },
      { now: () => "2026-10-11T12:00:00.000Z" },
    );
    expect(stalePlan.planKey).not.toBe(plan.planKey);

    await expect(
      resolveDurableShotDialogueCompositionState(input(episode, bible, mediaRoot), {
        ...controlled.dependencies,
        readLatestPlacementDecision: readLatestDialoguePlacementDecision,
        resolveCompositionAudioPlan: resolveDurableDialogueCompositionAudioPlan,
      }),
    ).rejects.toThrow(/is stale: dialoguePlanKey/);
  });

  it("Z real B2d failure when its own re-read finds no decision is not downgraded", async () => {
    const { episode, bible, controlled } = await allCompleted(["KACEY"], { decision: DECISION });
    const mediaRoot = await createMediaRoot();

    await expect(
      resolveDurableShotDialogueCompositionState(input(episode, bible, mediaRoot), {
        ...controlled.dependencies,
        resolveCompositionAudioPlan: resolveDurableDialogueCompositionAudioPlan,
      }),
    ).rejects.toThrow(/requires a placement decision for EP02\/SC01\/S02; none exists/);
  });

  it.each([
    ["stale", { history: { [L01]: [[OLD_PLAN_A, "RESERVED_ONLY"]] as const } }],
    ["cross-namespace", { lineScoped: { [L01]: "SUBMITTED" } }],
    ["reserved", { current: { [L01]: "RESERVED_ONLY" } }],
    ["submitted", { current: { [L01]: "SUBMITTED" } }],
    ["missing", { current: { [L01]: "NOTHING" } }],
  ] as const)("AA placement and B2d are never reached with %s work", async (_label, override) => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["OLLIE", "KACEY"]);
    const plan = await canonicalPlanFor(episode, bible);
    const controlled = seams(plan, {
      decision: DECISION,
      ...override,
      current: { [L01]: "COMPLETED", [L02]: "COMPLETED", ...("current" in override ? override.current : {}) },
    });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state.state).not.toBe("PLACEMENT_REQUIRED");
    expect(state.state).not.toBe("COMPOSITION_AUDIO_RESOLVED");
    expectNoPlacementPhase(controlled);
  });

  it("planning-blocked states never reach placement or B2d", async () => {
    const { episode: base, bible } = await fixtures();
    const episode = episodeWithDialogue(base, ["GHOST"]);
    const controlled = seams("f".repeat(64), { decision: DECISION, current: { [L01]: "COMPLETED" } });

    const state = await resolveDurableShotDialogueCompositionState(input(episode, bible), controlled.dependencies);

    expect(state.state).toBe("DIALOGUE_PLANNING_BLOCKED");
    expectNoPlacementPhase(controlled);
  });
});

describe("C3 contract and security boundary", () => {
  const sourceUrl = new URL("../src/dialogue/resolveDurableShotDialogueCompositionState.ts", import.meta.url);

  it("AB-AF imports only the locked read-only components", async () => {
    const source = await readFile(sourceUrl, "utf8");
    const imports = [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)].map(
      (match) => `${match[2]}:${match[1]!.replace(/\s+/g, "")}`,
    );

    expect(imports).toEqual([
      "../schemas/character.schema.js:CharacterBible,",
      "../schemas/episodeManifest.schema.js:EpisodeManifest,",
      "./buildDialogueCompositionAudioPlan.js:DialogueCompositionAudioPlan,",
      "./buildShotDialoguePlan.js:buildShotDialoguePlan,",
      "./classifyDialogueLifecycle.js:DialogueLifecycleClassification,",
      "./inspectDialogueDirectSeedAudioPlanHistory.js:inspectDialogueDirectSeedAudioPlanLifecycles,typeDialogueDirectSeedAudioPlanLifecycle,",
      "./inspectDialogueLifecycle.js:inspectDialogueLifecycle,",
      "./inspectShotDialoguePlanningBlockers.js:inspectShotDialoguePlanningBlockers,typeDialoguePlanningBlocker,",
      "./readDialoguePlacementDecision.js:readLatestDialoguePlacementDecision,",
      "./resolveDurableDialogueCompositionAudioPlan.js:resolveDurableDialogueCompositionAudioPlan,",
    ]);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/node:child_process|node:fs|\bspawn\b|\bexecFile\b|\bfetch\s*\(/);
    expect(source).not.toMatch(
      /create(Dialogue|Runway)\w*|reconcile\w*\s*\(|recover\w*\s*\(|confirm\w*|executeDialogue\w*|render\w*\s*\(|writeFile|mkdir|unlink|coordinat\w*/i,
    );
  });

  it("AG has no catch blocks and never inspects error messages", async () => {
    const source = await readFile(sourceUrl, "utf8");

    expect(source).not.toMatch(/\btry\b|\bcatch\b|\.catch\s*\(|\.message\b|instanceof\s+Error/);
  });

  it("AB-AE exposes exactly the four read-only dependency seams", () => {
    expectTypeOf<ResolveDurableShotDialogueCompositionStateDependencies>().toEqualTypeOf<
      Readonly<{
        inspectLineLifecycle: typeof inspectDialogueLifecycle;
        inspectDirectSeedAudioPlanLifecycles: typeof inspectDialogueDirectSeedAudioPlanLifecycles;
        readLatestPlacementDecision: typeof readLatestDialoguePlacementDecision;
        resolveCompositionAudioPlan: typeof resolveDurableDialogueCompositionAudioPlan;
      }>
    >();
    expectTypeOf(resolveDurableShotDialogueCompositionState).parameters.toEqualTypeOf<
      [
        ResolveDurableShotDialogueCompositionStateInput,
        (ResolveDurableShotDialogueCompositionStateDependencies | undefined)?,
      ]
    >();
  });

  it("AK exposes exactly the nine locked workflow states and payloads", () => {
    expectTypeOf<DurableShotDialogueCompositionState["state"]>().toEqualTypeOf<
      | "NO_DIALOGUE"
      | "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED"
      | "DIALOGUE_PLANNING_BLOCKED"
      | "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED"
      | "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED"
      | "DIALOGUE_RECONCILIATION_REQUIRED"
      | "DIALOGUE_AUDIO_REQUIRED"
      | "PLACEMENT_REQUIRED"
      | "COMPOSITION_AUDIO_RESOLVED"
    >();
    expectTypeOf<DialogueDurableNamespace>().toEqualTypeOf<"LINE_SCOPED" | "DIRECT_SEED_AUDIO">();
    expectTypeOf<DialogueActiveWork>().toEqualTypeOf<
      Readonly<{
        dialogueLineId: string;
        namespace: DialogueDurableNamespace;
        planKey: string;
        state: "RESERVED_ONLY" | "SUBMITTED";
      }>
    >();
    expectTypeOf<DialogueStalePlanWork>().toEqualTypeOf<DialogueActiveWork>();
    expectTypeOf<Extract<DurableShotDialogueCompositionState, { state: "DIALOGUE_PLANNING_BLOCKED" }>>().toEqualTypeOf<
      Readonly<{
        state: "DIALOGUE_PLANNING_BLOCKED";
        episodeId: string;
        sceneId: string;
        shotId: string;
        blockers: readonly DialoguePlanningBlocker[];
      }>
    >();
    expectTypeOf<
      Extract<DurableShotDialogueCompositionState, { state: "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED" }>
    >().toEqualTypeOf<
      Readonly<{
        state: "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED";
        episodeId: string;
        sceneId: string;
        shotId: string;
        blockers: readonly DialoguePlanningBlocker[];
        activeWork: readonly DialogueActiveWork[];
      }>
    >();
    expectTypeOf<Extract<DurableShotDialogueCompositionState, { state: "DIALOGUE_AUDIO_REQUIRED" }>>().toEqualTypeOf<
      Readonly<{
        state: "DIALOGUE_AUDIO_REQUIRED";
        episodeId: string;
        sceneId: string;
        shotId: string;
        dialoguePlanKey: string;
        missingLineIds: readonly string[];
      }>
    >();
    expectTypeOf<
      Extract<DurableShotDialogueCompositionState, { state: "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED" }>
    >().toEqualTypeOf<
      Readonly<{
        state: "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED";
        episodeId: string;
        sceneId: string;
        shotId: string;
        dialoguePlanKey: string;
        staleWork: readonly DialogueStalePlanWork[];
        reservedLineIds: readonly string[];
        submittedLineIds: readonly string[];
        missingLineIds: readonly string[];
      }>
    >();
    expectTypeOf<
      Extract<DurableShotDialogueCompositionState, { state: "COMPOSITION_AUDIO_RESOLVED" }>["audioPlan"]
    >().toEqualTypeOf<DialogueCompositionAudioPlan>();
  });
});
