import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Every module that could reach the environment, the media root, durable
// evidence or a provider is replaced. Nothing real is executed in this file.
vi.mock("../src/execution/cli/runSingleShotExecutionCli.js", () => ({ runSingleShotExecutionCli: vi.fn() }));
vi.mock("../src/execution/cli/runProductionExecutionReconcileCli.js", () => ({
  runProductionExecutionReconcileCli: vi.fn(),
}));
vi.mock("../src/dialogue/cli/runDialogueGenerationCli.js", () => ({ runDialogueGenerationCli: vi.fn() }));
vi.mock("../src/dialogue/cli/runDialogueReconcileCli.js", () => ({ runDialogueReconcileCli: vi.fn() }));
vi.mock("../src/execution/resolveDurableEpisodeProductionState.js", () => ({
  resolveDurableEpisodeProductionState: vi.fn(),
}));
vi.mock("../src/validation/loadEnvironment.js", () => ({ loadEnvironment: vi.fn() }));
vi.mock("../src/validation/loadProductionRules.js", () => ({ loadProductionRules: vi.fn() }));
vi.mock("../src/validation/loadCharacterBible.js", () => ({ loadCharacterBible: vi.fn() }));
vi.mock("../src/validation/loadEpisodeManifest.js", () => ({ loadEpisodeManifest: vi.fn() }));
vi.mock("../src/validation/loadProviderRoutingPolicy.js", () => ({ loadProviderRoutingPolicy: vi.fn() }));
vi.mock("../src/validation/validateMediaRoot.js", () => ({
  resolveAndValidateMediaRootPath: vi.fn(),
  validateMediaRoot: vi.fn(),
}));

import { runDialogueGenerationCli } from "../src/dialogue/cli/runDialogueGenerationCli.js";
import { runDialogueReconcileCli } from "../src/dialogue/cli/runDialogueReconcileCli.js";
import type { DurableShotDialogueCompositionState } from "../src/dialogue/resolveDurableShotDialogueCompositionState.js";
import { runProductionExecutionReconcileCli } from "../src/execution/cli/runProductionExecutionReconcileCli.js";
import { runSingleShotExecutionCli } from "../src/execution/cli/runSingleShotExecutionCli.js";
import {
  coordinateEpisodeAction,
  EpisodeActionPostStateResolutionError,
  type CoordinateEpisodeActionDependencies,
  type CoordinateEpisodeActionInput,
  type EpisodeCoordinatorAction,
} from "../src/execution/coordinateEpisodeAction.js";
import {
  resolveDurableEpisodeProductionState,
  type DurableEpisodeProductionState,
} from "../src/execution/resolveDurableEpisodeProductionState.js";
import type { DurableShotVisualGenerationState } from "../src/execution/resolveDurableShotVisualGenerationState.js";
import { loadCharacterBible } from "../src/validation/loadCharacterBible.js";
import { loadEnvironment } from "../src/validation/loadEnvironment.js";
import { loadEpisodeManifest } from "../src/validation/loadEpisodeManifest.js";
import { loadProductionRules } from "../src/validation/loadProductionRules.js";
import { loadProviderRoutingPolicy } from "../src/validation/loadProviderRoutingPolicy.js";
import { resolveAndValidateMediaRootPath, validateMediaRoot } from "../src/validation/validateMediaRoot.js";

const EPISODE = "EP02";
const SCENE = "SC01";
const SHOT = "S02";
const LINE = "EP02_SC01_S02_L01";
const OTHER_LINE = "EP02_SC01_S02_L02";
const MEDIA_ROOT = "C:/controlled-media-root";
const IMAGE = "C:/controlled-media-root/references/EP02/S02/approved-reference.png";

type VisualState = DurableShotVisualGenerationState["state"];
type DialogueState = DurableShotDialogueCompositionState["state"];

const VISUAL_STATES: readonly VisualState[] = [
  "RESERVED_ONLY_INTERVENTION_REQUIRED",
  "SUBMITTED_RECONCILIATION_REQUIRED",
  "LIFECYCLE_COMPLETED",
  "CANONICAL_NOT_EXECUTABLE",
  "VISUAL_AUTHORIZATION_REQUIRED",
  "REFERENCE_UNAVAILABLE",
  "REFERENCE_SELECTION_REQUIRED",
  "READY_FOR_GENERATION",
];

const DIALOGUE_STATES: readonly DialogueState[] = [
  "NO_DIALOGUE",
  "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED",
  "DIALOGUE_PLANNING_BLOCKED",
  "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED",
  "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED",
  "DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED",
  "DIALOGUE_RECONCILIATION_REQUIRED",
  "DIALOGUE_AUDIO_REQUIRED",
  "PLACEMENT_REQUIRED",
  "COMPOSITION_AUDIO_RESOLVED",
];

// The exact C2 object shapes that matter to the coordinator.
function visual(state: VisualState, shotId = SHOT): DurableShotVisualGenerationState {
  const base = { state, episodeId: EPISODE, shotId };
  if (state === "READY_FOR_GENERATION") {
    return Object.freeze({
      ...base,
      provider: "VEO",
      readiness: Object.freeze({ marker: "readiness" }),
      reference: Object.freeze({ assetId: "EP02_S02_REF", absolutePath: IMAGE }),
    }) as unknown as DurableShotVisualGenerationState;
  }
  return Object.freeze(base) as unknown as DurableShotVisualGenerationState;
}

// The exact C3 object shapes. The requested line appears in every list a
// state carries, so only the state itself can decide admission.
function dialogue(
  state: DialogueState,
  lists: Partial<Record<"missingLineIds" | "submittedLineIds" | "reservedLineIds", readonly string[]>> = {},
  shotId = SHOT,
): DurableShotDialogueCompositionState {
  const base = { state, episodeId: EPISODE, sceneId: SCENE, shotId };
  const all = [LINE];
  const pick = (key: "missingLineIds" | "submittedLineIds" | "reservedLineIds") => Object.freeze([...(lists[key] ?? all)]);
  switch (state) {
    case "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED":
      return Object.freeze({
        ...base,
        dialoguePlanKey: "a".repeat(64),
        staleWork: Object.freeze([]),
        reservedLineIds: pick("reservedLineIds"),
        submittedLineIds: pick("submittedLineIds"),
        missingLineIds: pick("missingLineIds"),
      }) as unknown as DurableShotDialogueCompositionState;
    case "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED":
      return Object.freeze({
        ...base,
        dialoguePlanKey: "a".repeat(64),
        reservedLineIds: pick("reservedLineIds"),
        submittedLineIds: pick("submittedLineIds"),
        missingLineIds: pick("missingLineIds"),
      }) as unknown as DurableShotDialogueCompositionState;
    case "DIALOGUE_RECONCILIATION_REQUIRED":
      return Object.freeze({
        ...base,
        dialoguePlanKey: "a".repeat(64),
        submittedLineIds: pick("submittedLineIds"),
        missingLineIds: pick("missingLineIds"),
      }) as unknown as DurableShotDialogueCompositionState;
    case "DIALOGUE_AUDIO_REQUIRED":
      return Object.freeze({
        ...base,
        dialoguePlanKey: "a".repeat(64),
        missingLineIds: pick("missingLineIds"),
      }) as unknown as DurableShotDialogueCompositionState;
    case "DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED":
      return Object.freeze({
        ...base,
        openAdmissions: Object.freeze([
          Object.freeze({
            dialogueLineId: LINE,
            attemptNumber: 1,
            admissionId: "6f1e7d4c-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
            planKey: "a".repeat(64),
            generationNamespace: "DIRECT_SEED_AUDIO",
            matchesCurrentCanonicalPlan: true,
          }),
        ]),
      }) as unknown as DurableShotDialogueCompositionState;
    default:
      return Object.freeze({ ...base, dialoguePlanKey: "a".repeat(64) }) as unknown as DurableShotDialogueCompositionState;
  }
}

function episodeState(
  visualState: DurableShotVisualGenerationState,
  dialogueState: DurableShotDialogueCompositionState,
  marker = "before",
): DurableEpisodeProductionState {
  return Object.freeze({
    episodeId: EPISODE,
    marker,
    shots: Object.freeze([
      Object.freeze({
        order: 1,
        sceneId: SCENE,
        shotId: "S01",
        visualGenerationState: visual("LIFECYCLE_COMPLETED", "S01"),
        dialogueCompositionState: dialogue("NO_DIALOGUE", {}, "S01"),
      }),
      Object.freeze({
        order: 2,
        sceneId: SCENE,
        shotId: SHOT,
        visualGenerationState: visualState,
        dialogueCompositionState: dialogueState,
      }),
    ]),
    summary: Object.freeze({ marker: "counts are never used for admission" }),
  }) as unknown as DurableEpisodeProductionState;
}

type Harness = ReturnType<typeof harness>;

function harness(states: readonly DurableEpisodeProductionState[], loadedEpisodeId = EPISODE) {
  const events: string[] = [];
  const environment = Object.freeze({ BUSYBOOKIE_MEDIA_ROOT: MEDIA_ROOT });
  const rules = Object.freeze({ marker: "rules" });
  const bible = Object.freeze({ marker: "bible" });
  const policy = Object.freeze({ marker: "policy" });
  const episode = Object.freeze({ episodeId: loadedEpisodeId, marker: "episode" });
  const record = <T>(name: string, value: T) => {
    events.push(name);
    return value;
  };
  const resolveEpisodeProductionState = vi.fn(async () => {
    const index = resolveEpisodeProductionState.mock.calls.length - 1;
    events.push(`c4:${index + 1}`);
    const state = states[index];
    if (state === undefined) throw new Error(`unexpected C4 call ${index + 1}`);
    return state;
  });
  const runner = (name: string) => vi.fn(async (_args?: readonly string[]) => void events.push(`runner:${name}`));
  const runners = {
    runSingleShotExecutionCli: runner("runSingleShotExecutionCli"),
    runProductionExecutionReconcileCli: runner("runProductionExecutionReconcileCli"),
    runDialogueGenerationCli: runner("runDialogueGenerationCli"),
    runDialogueReconcileCli: runner("runDialogueReconcileCli"),
  };
  const dependencies = {
    loadEnvironment: vi.fn(() => record("loadEnvironment", environment)),
    loadProductionRules: vi.fn(async () => record("loadProductionRules", rules)),
    loadCharacterBible: vi.fn(async () => record("loadCharacterBible", bible)),
    loadEpisodeManifest: vi.fn(async (_episodeId: string) => record("loadEpisodeManifest", episode)),
    loadProviderRoutingPolicy: vi.fn(async () => record("loadProviderRoutingPolicy", policy)),
    resolveMediaRoot: vi.fn(() => record("resolveMediaRoot", MEDIA_ROOT)),
    resolveEpisodeProductionState,
    ...runners,
  };
  return {
    events,
    environment,
    rules,
    bible,
    policy,
    episode,
    dependencies,
    runners,
    resolveEpisodeProductionState,
    deps: dependencies as unknown as CoordinateEpisodeActionDependencies,
  };
}

function allCalls(controlled: Harness): number {
  return Object.values(controlled.dependencies).reduce((total, fn) => total + fn.mock.calls.length, 0);
}

function runnerCalls(controlled: Harness): Record<string, number> {
  return Object.fromEntries(Object.entries(controlled.runners).map(([name, fn]) => [name, fn.mock.calls.length]));
}

const ACTIONS = {
  VISUAL_GENERATE: { kind: "VISUAL_GENERATE", sceneId: SCENE, shotId: SHOT, confirmPaidGeneration: true },
  VISUAL_RECONCILE: { kind: "VISUAL_RECONCILE", sceneId: SCENE, shotId: SHOT, confirmReconciliation: true },
  DIALOGUE_GENERATE: {
    kind: "DIALOGUE_GENERATE",
    sceneId: SCENE,
    shotId: SHOT,
    dialogueLineId: LINE,
    confirmPaidGeneration: true,
  },
  DIALOGUE_RECONCILE: {
    kind: "DIALOGUE_RECONCILE",
    sceneId: SCENE,
    shotId: SHOT,
    dialogueLineId: LINE,
    confirmReconciliation: true,
  },
} as const satisfies Record<string, EpisodeCoordinatorAction>;

type Kind = keyof typeof ACTIONS;

function input(action: unknown, episodeId = EPISODE): CoordinateEpisodeActionInput {
  return { episodeId, action } as CoordinateEpisodeActionInput;
}

const EXPECTED_ARGV: Record<Kind, readonly string[]> = {
  VISUAL_GENERATE: ["--episode", EPISODE, "--shot", SHOT, "--image", IMAGE, "--confirm-paid-generation"],
  VISUAL_RECONCILE: ["--episode", EPISODE, "--shot", SHOT],
  DIALOGUE_GENERATE: [
    "--episode", EPISODE, "--scene", SCENE, "--shot", SHOT, "--line", LINE, "--confirm-paid-generation",
  ],
  DIALOGUE_RECONCILE: ["--episode", EPISODE, "--scene", SCENE, "--shot", SHOT, "--line", LINE],
};

const EXPECTED_RUNNER: Record<Kind, keyof Harness["runners"]> = {
  VISUAL_GENERATE: "runSingleShotExecutionCli",
  VISUAL_RECONCILE: "runProductionExecutionReconcileCli",
  DIALOGUE_GENERATE: "runDialogueGenerationCli",
  DIALOGUE_RECONCILE: "runDialogueReconcileCli",
};

// Admitted before-states; the other axis is deliberately a blocked/human state.
function admittedState(kind: Kind, marker = "before"): DurableEpisodeProductionState {
  switch (kind) {
    case "VISUAL_GENERATE":
      return episodeState(visual("READY_FOR_GENERATION"), dialogue("DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED"), marker);
    case "VISUAL_RECONCILE":
      return episodeState(visual("SUBMITTED_RECONCILIATION_REQUIRED"), dialogue("DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED"), marker);
    case "DIALOGUE_GENERATE":
      return episodeState(visual("RESERVED_ONLY_INTERVENTION_REQUIRED"), dialogue("DIALOGUE_AUDIO_REQUIRED"), marker);
    case "DIALOGUE_RECONCILE":
      return episodeState(visual("VISUAL_AUTHORIZATION_REQUIRED"), dialogue("DIALOGUE_RECONCILIATION_REQUIRED"), marker);
  }
}

const KINDS = Object.keys(ACTIONS) as Kind[];
const CONFIRMATION_FIELD: Record<Kind, "confirmPaidGeneration" | "confirmReconciliation"> = {
  VISUAL_GENERATE: "confirmPaidGeneration",
  VISUAL_RECONCILE: "confirmReconciliation",
  DIALOGUE_GENERATE: "confirmPaidGeneration",
  DIALOGUE_RECONCILE: "confirmReconciliation",
};

describe("C6b A confirmation is the first operational gate", () => {
  it.each([undefined, null, "VISUAL", "INSPECT", "visual_generate", 7])(
    "unknown action kind %s throws before any dependency call",
    async (kind) => {
      const controlled = harness([admittedState("VISUAL_GENERATE")]);
      await expect(
        coordinateEpisodeAction(input({ ...ACTIONS.VISUAL_GENERATE, kind }), controlled.deps),
      ).rejects.toThrow(/Unsupported episode coordinator action kind/);
      expect(allCalls(controlled)).toBe(0);
    },
  );

  it.each([null, undefined, "VISUAL_GENERATE"])("a non-object action %s throws before any dependency call", async (action) => {
    const controlled = harness([admittedState("VISUAL_GENERATE")]);
    await expect(coordinateEpisodeAction(input(action), controlled.deps)).rejects.toThrow();
    expect(allCalls(controlled)).toBe(0);
  });

  for (const kind of KINDS) {
    it.each([["missing", undefined], ["false", false], ['"true"', "true"], ["1", 1], ["{}", {}]] as const)(
      `${kind} with %s confirmation throws before any dependency call`,
      async (_label, value) => {
        const controlled = harness([admittedState(kind)]);
        const action: Record<string, unknown> = { ...ACTIONS[kind] };
        if (value === undefined) delete action[CONFIRMATION_FIELD[kind]];
        else action[CONFIRMATION_FIELD[kind]] = value;
        await expect(coordinateEpisodeAction(input(action), controlled.deps)).rejects.toThrow(
          `${kind} requires ${CONFIRMATION_FIELD[kind]} === true.`,
        );
        expect(allCalls(controlled)).toBe(0);
      },
    );

    it(`${kind}: the other kind's confirmation field does not satisfy the gate`, async () => {
      const controlled = harness([admittedState(kind)]);
      const action: Record<string, unknown> = { ...ACTIONS[kind] };
      delete action[CONFIRMATION_FIELD[kind]];
      action[CONFIRMATION_FIELD[kind] === "confirmPaidGeneration" ? "confirmReconciliation" : "confirmPaidGeneration"] = true;
      await expect(coordinateEpisodeAction(input(action), controlled.deps)).rejects.toThrow(/requires/);
      expect(allCalls(controlled)).toBe(0);
    });
  }

  it("confirmation is checked before id validation (bad ids + bad confirmation reports confirmation)", async () => {
    const controlled = harness([admittedState("DIALOGUE_GENERATE")]);
    await expect(
      coordinateEpisodeAction(
        input({ ...ACTIONS.DIALOGUE_GENERATE, shotId: "--shot", confirmPaidGeneration: false }, "--episode"),
        controlled.deps,
      ),
    ).rejects.toThrow("DIALOGUE_GENERATE requires confirmPaidGeneration === true.");
    expect(allCalls(controlled)).toBe(0);
  });

  it("a valid literal true proceeds through loaders, C4 and exactly one runner", async () => {
    const controlled = harness([admittedState("VISUAL_GENERATE"), admittedState("VISUAL_GENERATE", "after")]);
    await coordinateEpisodeAction(input(ACTIONS.VISUAL_GENERATE), controlled.deps);
    expect(controlled.events[0]).toBe("loadEnvironment");
    expect(controlled.runners.runSingleShotExecutionCli).toHaveBeenCalledTimes(1);
  });
});

describe("C6b B id validation happens before any I/O", () => {
  it.each([
    ["malformed episodeId", "VISUAL_GENERATE", { }, "E02"],
    ["flag-injected episodeId", "DIALOGUE_GENERATE", { }, "--confirm-paid-generation"],
    ["malformed sceneId", "VISUAL_RECONCILE", { sceneId: "S01" }, EPISODE],
    ["flag-injected sceneId", "DIALOGUE_RECONCILE", { sceneId: "--scene" }, EPISODE],
    ["malformed shotId", "VISUAL_GENERATE", { shotId: "SH02" }, EPISODE],
    ["flag-injected shotId", "VISUAL_RECONCILE", { shotId: "--image" }, EPISODE],
    ["non-string shotId", "VISUAL_GENERATE", { shotId: 2 }, EPISODE],
    ["malformed dialogueLineId", "DIALOGUE_GENERATE", { dialogueLineId: "L01" }, EPISODE],
    ["flag-injected dialogueLineId", "DIALOGUE_RECONCILE", { dialogueLineId: "--line" }, EPISODE],
    ["line from another shot", "DIALOGUE_GENERATE", { dialogueLineId: "EP02_SC01_S03_L01" }, EPISODE],
    ["line from another scene", "DIALOGUE_RECONCILE", { dialogueLineId: "EP02_SC02_S02_L01" }, EPISODE],
    ["line from another episode", "DIALOGUE_GENERATE", { dialogueLineId: "EP03_SC01_S02_L01" }, EPISODE],
  ] as const)("%s fails before loaders, C4 and runners", async (_label, kind, overrides, episodeId) => {
    const controlled = harness([admittedState(kind)]);
    await expect(
      coordinateEpisodeAction(input({ ...ACTIONS[kind], ...overrides }, episodeId), controlled.deps),
    ).rejects.toThrow();
    expect(allCalls(controlled)).toBe(0);
  });
});

describe("C6b C canonical load", () => {
  it("a loaded episode identity mismatch throws with no C4 and no runner", async () => {
    const controlled = harness([admittedState("VISUAL_GENERATE")], "EP03");
    await expect(coordinateEpisodeAction(input(ACTIONS.VISUAL_GENERATE), controlled.deps)).rejects.toThrow(
      /Loaded episode identity EP03 does not match the requested episode EP02/,
    );
    expect(controlled.resolveEpisodeProductionState).not.toHaveBeenCalled();
    expect(Object.values(runnerCalls(controlled))).toEqual([0, 0, 0, 0]);
  });

  it("builds the C4 input from one canonical load with the read-only media-root resolver", async () => {
    const controlled = harness([admittedState("DIALOGUE_GENERATE"), admittedState("DIALOGUE_GENERATE", "after")]);
    await coordinateEpisodeAction(input(ACTIONS.DIALOGUE_GENERATE), controlled.deps);

    expect(controlled.dependencies.loadEnvironment).toHaveBeenCalledTimes(1);
    expect(controlled.dependencies.loadEpisodeManifest).toHaveBeenCalledWith(EPISODE);
    expect(controlled.dependencies.resolveMediaRoot).toHaveBeenCalledWith(controlled.environment, controlled.rules);
    const [first] = controlled.resolveEpisodeProductionState.mock.calls[0] as unknown as [unknown];
    const [second] = controlled.resolveEpisodeProductionState.mock.calls[1] as unknown as [unknown];
    expect(first).toEqual({
      episode: controlled.episode,
      bible: controlled.bible,
      rules: controlled.rules,
      policy: controlled.policy,
      mediaRoot: MEDIA_ROOT,
      ffprobeExecutable: "ffprobe",
    });
    expect(second).toBe(first);
    for (const loader of [
      controlled.dependencies.loadEnvironment,
      controlled.dependencies.loadProductionRules,
      controlled.dependencies.loadCharacterBible,
      controlled.dependencies.loadEpisodeManifest,
      controlled.dependencies.loadProviderRoutingPolicy,
      controlled.dependencies.resolveMediaRoot,
    ]) {
      expect(loader).toHaveBeenCalledTimes(1);
    }
  });
});

describe("C6b D before-state and exact target", () => {
  it("C4 runs once before the runner", async () => {
    const controlled = harness([admittedState("VISUAL_RECONCILE"), admittedState("VISUAL_RECONCILE", "after")]);
    await coordinateEpisodeAction(input(ACTIONS.VISUAL_RECONCILE), controlled.deps);
    expect(controlled.events.filter((event) => event.startsWith("c4:") || event.startsWith("runner:"))).toEqual([
      "c4:1",
      "runner:runProductionExecutionReconcileCli",
      "c4:2",
    ]);
  });

  it("a before-state C4 failure propagates unchanged and no runner runs", async () => {
    const controlled = harness([]);
    const failure = new Error("durable evidence corrupt");
    controlled.resolveEpisodeProductionState.mockRejectedValueOnce(failure);
    await expect(coordinateEpisodeAction(input(ACTIONS.DIALOGUE_GENERATE), controlled.deps)).rejects.toBe(failure);
    expect(controlled.resolveEpisodeProductionState).toHaveBeenCalledTimes(1);
    expect(Object.values(runnerCalls(controlled))).toEqual([0, 0, 0, 0]);
  });

  it.each([
    ["an unknown shot", { shotId: "S09" }],
    ["a sceneId mismatch", { sceneId: "SC02" }],
  ])("%s throws before any runner", async (_label, overrides) => {
    const controlled = harness([admittedState("VISUAL_GENERATE")]);
    await expect(
      coordinateEpisodeAction(input({ ...ACTIONS.VISUAL_GENERATE, ...overrides }), controlled.deps),
    ).rejects.toThrow(/has no exact durable shot/);
    expect(controlled.resolveEpisodeProductionState).toHaveBeenCalledTimes(1);
    expect(Object.values(runnerCalls(controlled))).toEqual([0, 0, 0, 0]);
  });

  it("summary counts are never consulted for admission", async () => {
    const before = episodeState(visual("CANONICAL_NOT_EXECUTABLE"), dialogue("NO_DIALOGUE"));
    const lying = Object.freeze({
      ...before,
      summary: Object.freeze({ visualGenerationStates: Object.freeze({ READY_FOR_GENERATION: 99 }) }),
    }) as unknown as DurableEpisodeProductionState;
    const controlled = harness([lying]);
    await expect(coordinateEpisodeAction(input(ACTIONS.VISUAL_GENERATE), controlled.deps)).rejects.toThrow(
      /current state is CANONICAL_NOT_EXECUTABLE/,
    );
  });
});

describe("C6b E visual admission matrix (8 visual states x 2 visual kinds)", () => {
  const ADMITTED = new Set(["READY_FOR_GENERATION:VISUAL_GENERATE", "SUBMITTED_RECONCILIATION_REQUIRED:VISUAL_RECONCILE"]);
  for (const state of VISUAL_STATES) {
    for (const kind of ["VISUAL_GENERATE", "VISUAL_RECONCILE"] as const) {
      const admitted = ADMITTED.has(`${state}:${kind}`);
      it(`${state} + ${kind} -> ${admitted ? "runner" : "throw, no runner"} (dialogue axis blocked)`, async () => {
        const before = episodeState(visual(state), dialogue("DIALOGUE_PLANNING_BLOCKED"));
        const controlled = harness([before, episodeState(visual(state), dialogue("DIALOGUE_PLANNING_BLOCKED"), "after")]);
        const run = coordinateEpisodeAction(input(ACTIONS[kind]), controlled.deps);
        if (admitted) {
          await expect(run).resolves.toMatchObject({ runner: EXPECTED_RUNNER[kind] });
          expect(controlled.runners[EXPECTED_RUNNER[kind]]).toHaveBeenCalledTimes(1);
        } else {
          await expect(run).rejects.toThrow(`${kind} is not admitted for EP02/SC01/S02: current state is ${state}.`);
          expect(Object.values(runnerCalls(controlled))).toEqual([0, 0, 0, 0]);
          expect(controlled.resolveEpisodeProductionState).toHaveBeenCalledTimes(1);
        }
      });
    }
  }
});

describe("C6b F dialogue admission matrix (10 dialogue states x 2 dialogue kinds)", () => {
  const ADMITTED = new Set([
    "DIALOGUE_AUDIO_REQUIRED:DIALOGUE_GENERATE",
    "DIALOGUE_RECONCILIATION_REQUIRED:DIALOGUE_RECONCILE",
  ]);
  for (const state of DIALOGUE_STATES) {
    for (const kind of ["DIALOGUE_GENERATE", "DIALOGUE_RECONCILE"] as const) {
      const admitted = ADMITTED.has(`${state}:${kind}`);
      it(`${state} + ${kind} -> ${admitted ? "runner" : "throw, no runner"} (visual axis blocked)`, async () => {
        const before = episodeState(visual("REFERENCE_SELECTION_REQUIRED"), dialogue(state));
        const controlled = harness([before, episodeState(visual("REFERENCE_SELECTION_REQUIRED"), dialogue(state), "after")]);
        const run = coordinateEpisodeAction(input(ACTIONS[kind]), controlled.deps);
        if (admitted) {
          await expect(run).resolves.toMatchObject({ runner: EXPECTED_RUNNER[kind] });
          expect(controlled.runners[EXPECTED_RUNNER[kind]]).toHaveBeenCalledTimes(1);
        } else {
          await expect(run).rejects.toThrow(`${kind} is not admitted for EP02/SC01/S02: current state is ${state}.`);
          expect(Object.values(runnerCalls(controlled))).toEqual([0, 0, 0, 0]);
        }
      });
    }
  }

  it.each([
    ["generate: line absent from missingLineIds", "DIALOGUE_GENERATE", dialogue("DIALOGUE_AUDIO_REQUIRED", { missingLineIds: [OTHER_LINE] }), /is not a missing line/],
    ["reconcile: line absent from submittedLineIds", "DIALOGUE_RECONCILE", dialogue("DIALOGUE_RECONCILIATION_REQUIRED", { submittedLineIds: [OTHER_LINE] }), /is not a submitted line/],
    ["generate: line missing only inside RECONCILIATION_REQUIRED", "DIALOGUE_GENERATE", dialogue("DIALOGUE_RECONCILIATION_REQUIRED", { submittedLineIds: [OTHER_LINE], missingLineIds: [LINE] }), /DIALOGUE_RECONCILIATION_REQUIRED/],
    ["generate: line missing only inside RESERVED_ONLY", "DIALOGUE_GENERATE", dialogue("DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED"), /DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED/],
    ["generate: line missing only inside STALE_PLAN", "DIALOGUE_GENERATE", dialogue("DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED"), /DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED/],
    ["reconcile: line submitted only inside RESERVED_ONLY", "DIALOGUE_RECONCILE", dialogue("DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED"), /DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED/],
    ["reconcile: line submitted only inside STALE_PLAN", "DIALOGUE_RECONCILE", dialogue("DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED"), /DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED/],
    ["generate: admission-open never generates (no automatic resume)", "DIALOGUE_GENERATE", dialogue("DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED"), /ADMISSION_OPEN/],
    ["reconcile: admission-open never reconciles", "DIALOGUE_RECONCILE", dialogue("DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED"), /ADMISSION_OPEN/],
    ["generate: planning-blocked with active work", "DIALOGUE_GENERATE", dialogue("DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED"), /PLANNING_BLOCKED_ACTIVE_WORK/],
    ["reconcile: planning-blocked", "DIALOGUE_RECONCILE", dialogue("DIALOGUE_PLANNING_BLOCKED"), /DIALOGUE_PLANNING_BLOCKED/],
  ] as const)("%s -> throw, no runner", async (_label, kind, state, expected) => {
    const controlled = harness([episodeState(visual("READY_FOR_GENERATION"), state)]);
    await expect(coordinateEpisodeAction(input(ACTIONS[kind]), controlled.deps)).rejects.toThrow(expected);
    expect(Object.values(runnerCalls(controlled))).toEqual([0, 0, 0, 0]);
  });
});

describe("C6b G exact runner dispatch", () => {
  for (const kind of KINDS) {
    it(`${kind} calls only ${EXPECTED_RUNNER[kind]} once with the exact argv`, async () => {
      const controlled = harness([admittedState(kind), admittedState(kind, "after")]);
      await coordinateEpisodeAction(input(ACTIONS[kind]), controlled.deps);

      const selected = controlled.runners[EXPECTED_RUNNER[kind]];
      expect(selected).toHaveBeenCalledTimes(1);
      expect(selected.mock.calls[0]).toEqual([EXPECTED_ARGV[kind]]);
      expect(runnerCalls(controlled)).toEqual({
        runSingleShotExecutionCli: 0,
        runProductionExecutionReconcileCli: 0,
        runDialogueGenerationCli: 0,
        runDialogueReconcileCli: 0,
        [EXPECTED_RUNNER[kind]]: 1,
      });
      const argv = selected.mock.calls[0]![0]!;
      expect(argv.includes("--confirm-paid-generation")).toBe(kind.endsWith("GENERATE"));
      expect(argv.some((value) => /confirm-reconcil|namespace|planKey|DIRECT_SEED|LINE_SCOPED/i.test(value))).toBe(false);
    });
  }

  it("VISUAL_GENERATE passes C4's reference.absolutePath as --image (no reference choice)", async () => {
    const controlled = harness([admittedState("VISUAL_GENERATE"), admittedState("VISUAL_GENERATE", "after")]);
    await coordinateEpisodeAction(input(ACTIONS.VISUAL_GENERATE), controlled.deps);
    const argv = controlled.runners.runSingleShotExecutionCli.mock.calls[0]![0]!;
    expect(argv[argv.indexOf("--image") + 1]).toBe(IMAGE);
  });
});

describe("C6b H success semantics", () => {
  for (const kind of KINDS) {
    it(`${kind}: C4 twice around exactly one runner; frozen result with exact identities`, async () => {
      const before = admittedState(kind);
      const after = admittedState(kind, "after");
      const controlled = harness([before, after]);
      const callerAction = { ...ACTIONS[kind] };

      const result = await coordinateEpisodeAction(input(callerAction), controlled.deps);

      expect(controlled.resolveEpisodeProductionState).toHaveBeenCalledTimes(2);
      expect(controlled.events.filter((event) => event.startsWith("c4:") || event.startsWith("runner:"))).toEqual([
        "c4:1",
        `runner:${EXPECTED_RUNNER[kind]}`,
        "c4:2",
      ]);
      expect(result.episodeId).toBe(EPISODE);
      expect(result.runner).toBe(EXPECTED_RUNNER[kind]);
      expect(result.beforeState).toBe(before);
      expect(result.afterState).toBe(after);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.action)).toBe(true);
      expect(result.action).not.toBe(callerAction);
      expect(result.action).toEqual(ACTIONS[kind]);
      (callerAction as Record<string, unknown>).shotId = "S99";
      expect(result.action.shotId).toBe(SHOT);
      expect(Object.keys(result).sort()).toEqual(["action", "afterState", "beforeState", "episodeId", "runner"]);
    });
  }

  it("the frozen action copy carries only the locked fields", async () => {
    const controlled = harness([admittedState("DIALOGUE_RECONCILE"), admittedState("DIALOGUE_RECONCILE", "after")]);
    const result = await coordinateEpisodeAction(
      input({ ...ACTIONS.DIALOGUE_RECONCILE, extra: "ignored", confirmPaidGeneration: true }),
      controlled.deps,
    );
    expect(result.action).toEqual(ACTIONS.DIALOGUE_RECONCILE);
  });
});

describe("C6b I runner failure", () => {
  for (const kind of KINDS) {
    it(`${kind}: the exact runner error propagates; no after-state, no retry, no other runner`, async () => {
      const controlled = harness([admittedState(kind), admittedState(kind, "after")]);
      const failure = new Error(`${kind} secured runner failed`);
      controlled.runners[EXPECTED_RUNNER[kind]].mockRejectedValueOnce(failure);

      await expect(coordinateEpisodeAction(input(ACTIONS[kind]), controlled.deps)).rejects.toBe(failure);

      expect(controlled.resolveEpisodeProductionState).toHaveBeenCalledTimes(1);
      expect(controlled.runners[EXPECTED_RUNNER[kind]]).toHaveBeenCalledTimes(1);
      expect(Object.values(runnerCalls(controlled)).reduce((a, b) => a + b, 0)).toBe(1);
    });
  }
});

describe("C6b J post-action C4 failure", () => {
  for (const kind of KINDS) {
    it(`${kind}: EpisodeActionPostStateResolutionError with the action completed and the cause preserved`, async () => {
      const controlled = harness([admittedState(kind)]);
      const postFailure = new Error("post-action durable evidence unreadable");
      controlled.resolveEpisodeProductionState
        .mockResolvedValueOnce(admittedState(kind))
        .mockRejectedValueOnce(postFailure);

      const rejection = await coordinateEpisodeAction(input(ACTIONS[kind]), controlled.deps).then(
        () => null,
        (error: unknown) => error,
      );

      expect(rejection).toBeInstanceOf(EpisodeActionPostStateResolutionError);
      expect(rejection).toBeInstanceOf(Error);
      const error = rejection as EpisodeActionPostStateResolutionError;
      expect(error.name).toBe("EpisodeActionPostStateResolutionError");
      expect(error.actionCompleted).toBe(true);
      expect(error.episodeId).toBe(EPISODE);
      expect(error.action).toEqual(ACTIONS[kind]);
      expect(Object.isFrozen(error.action)).toBe(true);
      expect(error.runner).toBe(EXPECTED_RUNNER[kind]);
      expect(error.cause).toBe(postFailure);
      expect(error.message).toBe(
        `Episode action ${kind} for EP02 completed via ${EXPECTED_RUNNER[kind]}, but the resulting durable episode state could not be resolved.`,
      );
      expect("afterState" in error).toBe(false);
      expect(controlled.resolveEpisodeProductionState).toHaveBeenCalledTimes(2);
      expect(Object.values(runnerCalls(controlled)).reduce((a, b) => a + b, 0)).toBe(1);
    });
  }

  it("is never used for pre-action failures", async () => {
    const preFailure = new Error("before-state failure");
    const controlled = harness([]);
    controlled.resolveEpisodeProductionState.mockRejectedValueOnce(preFailure);
    const rejection = await coordinateEpisodeAction(input(ACTIONS.VISUAL_GENERATE), controlled.deps).catch(
      (error: unknown) => error,
    );
    expect(rejection).toBe(preFailure);
    expect(rejection).not.toBeInstanceOf(EpisodeActionPostStateResolutionError);
  });
});

describe("C6b K axis isolation", () => {
  it.each(DIALOGUE_STATES)("VISUAL_GENERATE is admitted with READY_FOR_GENERATION while dialogue is %s", async (state) => {
    const controlled = harness([
      episodeState(visual("READY_FOR_GENERATION"), dialogue(state)),
      episodeState(visual("READY_FOR_GENERATION"), dialogue(state), "after"),
    ]);
    await expect(coordinateEpisodeAction(input(ACTIONS.VISUAL_GENERATE), controlled.deps)).resolves.toMatchObject({
      runner: "runSingleShotExecutionCli",
    });
  });

  it.each(DIALOGUE_STATES)("VISUAL_RECONCILE is admitted with SUBMITTED_RECONCILIATION_REQUIRED while dialogue is %s", async (state) => {
    const controlled = harness([
      episodeState(visual("SUBMITTED_RECONCILIATION_REQUIRED"), dialogue(state)),
      episodeState(visual("SUBMITTED_RECONCILIATION_REQUIRED"), dialogue(state), "after"),
    ]);
    await expect(coordinateEpisodeAction(input(ACTIONS.VISUAL_RECONCILE), controlled.deps)).resolves.toMatchObject({
      runner: "runProductionExecutionReconcileCli",
    });
  });

  it.each(VISUAL_STATES)("DIALOGUE_GENERATE is admitted with DIALOGUE_AUDIO_REQUIRED while visual is %s", async (state) => {
    const controlled = harness([
      episodeState(visual(state), dialogue("DIALOGUE_AUDIO_REQUIRED")),
      episodeState(visual(state), dialogue("DIALOGUE_AUDIO_REQUIRED"), "after"),
    ]);
    await expect(coordinateEpisodeAction(input(ACTIONS.DIALOGUE_GENERATE), controlled.deps)).resolves.toMatchObject({
      runner: "runDialogueGenerationCli",
    });
  });

  it.each(VISUAL_STATES)("DIALOGUE_RECONCILE is admitted with DIALOGUE_RECONCILIATION_REQUIRED while visual is %s", async (state) => {
    const controlled = harness([
      episodeState(visual(state), dialogue("DIALOGUE_RECONCILIATION_REQUIRED")),
      episodeState(visual(state), dialogue("DIALOGUE_RECONCILIATION_REQUIRED"), "after"),
    ]);
    await expect(coordinateEpisodeAction(input(ACTIONS.DIALOGUE_RECONCILE), controlled.deps)).resolves.toMatchObject({
      runner: "runDialogueReconcileCli",
    });
  });
});

describe("C6b default dependencies are the exact secured runners and read-only loaders", () => {
  beforeEach(() => {
    vi.mocked(runSingleShotExecutionCli).mockReset().mockResolvedValue(undefined);
    vi.mocked(runProductionExecutionReconcileCli).mockReset().mockResolvedValue(undefined);
    vi.mocked(runDialogueGenerationCli).mockReset().mockResolvedValue(undefined);
    vi.mocked(runDialogueReconcileCli).mockReset().mockResolvedValue(undefined);
    vi.mocked(loadEnvironment).mockReset().mockReturnValue({ BUSYBOOKIE_MEDIA_ROOT: MEDIA_ROOT } as never);
    vi.mocked(loadProductionRules).mockReset().mockResolvedValue({ marker: "rules" } as never);
    vi.mocked(loadCharacterBible).mockReset().mockResolvedValue({ marker: "bible" } as never);
    vi.mocked(loadEpisodeManifest).mockReset().mockResolvedValue({ episodeId: EPISODE } as never);
    vi.mocked(loadProviderRoutingPolicy).mockReset().mockResolvedValue({ marker: "policy" } as never);
    vi.mocked(resolveAndValidateMediaRootPath).mockReset().mockReturnValue(MEDIA_ROOT);
    vi.mocked(validateMediaRoot).mockReset();
    vi.mocked(resolveDurableEpisodeProductionState).mockReset();
  });

  for (const kind of KINDS) {
    it(`${kind} with default dependencies reaches only ${EXPECTED_RUNNER[kind]}`, async () => {
      vi.mocked(resolveDurableEpisodeProductionState)
        .mockResolvedValueOnce(admittedState(kind))
        .mockResolvedValueOnce(admittedState(kind, "after"));

      const result = await coordinateEpisodeAction(input(ACTIONS[kind]));

      const defaults = {
        runSingleShotExecutionCli,
        runProductionExecutionReconcileCli,
        runDialogueGenerationCli,
        runDialogueReconcileCli,
      };
      for (const [name, fn] of Object.entries(defaults)) {
        expect(vi.mocked(fn), name).toHaveBeenCalledTimes(name === EXPECTED_RUNNER[kind] ? 1 : 0);
      }
      expect(vi.mocked(defaults[EXPECTED_RUNNER[kind]]).mock.calls[0]).toEqual([EXPECTED_ARGV[kind]]);
      expect(resolveAndValidateMediaRootPath).toHaveBeenCalledTimes(1);
      expect(validateMediaRoot).not.toHaveBeenCalled();
      expect(resolveDurableEpisodeProductionState).toHaveBeenCalledTimes(2);
      expect(result.runner).toBe(EXPECTED_RUNNER[kind]);
    });
  }
});

describe("C6b L source boundary", () => {
  const sourceUrl = new URL("../src/execution/coordinateEpisodeAction.ts", import.meta.url);
  const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("imports only canonical loaders, the read-only media-root resolver, id schemas, C4 and the four secured runners", async () => {
    const source = await readFile(sourceUrl, "utf8");
    const imports = [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)].map(
      (match) => `${match[2]}:${match[1]!.replace(/\s+/g, "")}`,
    );
    expect(imports).toEqual([
      "../dialogue/cli/runDialogueGenerationCli.js:runDialogueGenerationCli,",
      "../dialogue/cli/runDialogueReconcileCli.js:runDialogueReconcileCli,",
      "../dialogue/dialogueReservation.schema.js:DialogueReservationEpisodeIdSchema,DialogueReservationLineIdSchema,DialogueReservationSceneIdSchema,DialogueReservationShotIdSchema,dialogueReservationIdentityMatches,",
      "../validation/loadCharacterBible.js:loadCharacterBible,",
      "../validation/loadEnvironment.js:loadEnvironment,",
      "../validation/loadEpisodeManifest.js:loadEpisodeManifest,",
      "../validation/loadProductionRules.js:loadProductionRules,",
      "../validation/loadProviderRoutingPolicy.js:loadProviderRoutingPolicy,",
      "../validation/validateMediaRoot.js:resolveAndValidateMediaRootPath,",
      "./cli/runProductionExecutionReconcileCli.js:runProductionExecutionReconcileCli,",
      "./cli/runSingleShotExecutionCli.js:runSingleShotExecutionCli,",
      "./executionReservation.schema.js:ExecutionReservationEpisodeIdSchema,ExecutionReservationShotIdSchema,",
      "./resolveDurableEpisodeProductionState.js:resolveDurableEpisodeProductionState,typeDurableEpisodeProductionState,typeDurableEpisodeShotProductionState,typeResolveDurableEpisodeProductionStateInput,",
    ]);
    expect(source).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
  });

  it("references no lower-level mutation, ledger, provider, composition or filesystem-write surface", async () => {
    const code = strip(await readFile(sourceUrl, "utf8"));
    expect(code).not.toMatch(
      /createDialogueVisualAuthorization|createDialoguePlacementDecision|VisualReferenceAssetRegistry|admitDialogueLineGeneration|inspectDialogueGenerationAdmissionLedger|generation-admission|executeSingleShot|executeDialogue\w*|Runway\w*ProductionExecutor|Runway\w*ProductionReconciler|reconcileExecutionLifecycle|reconcileDialogueLifecycle|createExecutionReservation|createDialogue\w*Reservation|RunwayML|GoogleGenAI|@runwayml|@google|compose\w*|render\w*|node:fs|writeFile|mkdir|copyFile|unlink|\bvalidateMediaRoot\s*\(|RUNWAYML_API_SECRET|GEMINI_API_KEY|\.message\b/,
    );
    expect(code.match(/dependencies\s*\.\s*run\w+Cli\s*\(/g)).toHaveLength(4);
  });
});
