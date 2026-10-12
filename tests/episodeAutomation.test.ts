import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Everything below C6b is replaced so importing the real coordinator module
// (for its real EpisodeActionPostStateResolutionError class) has no effects.
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
vi.mock("../src/execution/coordinateEpisodeAction.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/coordinateEpisodeAction.js")>();
  return { ...actual, coordinateEpisodeAction: vi.fn() };
});

import { runDialogueGenerationCli } from "../src/dialogue/cli/runDialogueGenerationCli.js";
import { runDialogueReconcileCli } from "../src/dialogue/cli/runDialogueReconcileCli.js";
import { runProductionExecutionReconcileCli } from "../src/execution/cli/runProductionExecutionReconcileCli.js";
import { runSingleShotExecutionCli } from "../src/execution/cli/runSingleShotExecutionCli.js";
import {
  coordinateEpisodeAction,
  EpisodeActionPostStateResolutionError,
  type CoordinateEpisodeActionInput,
  type CoordinateEpisodeActionResult,
  type EpisodeCoordinatorAction,
  type EpisodeCoordinatorRunner,
} from "../src/execution/coordinateEpisodeAction.js";
import {
  MAX_EPISODE_AUTOMATION_ACTIONS,
  MAX_EPISODE_AUTOMATION_PLAN_BYTES,
  parseEpisodeAutomationPlan,
} from "../src/execution/episodeAutomationPlan.schema.js";
import { resolveDurableEpisodeProductionState } from "../src/execution/resolveDurableEpisodeProductionState.js";
import type { DurableEpisodeProductionState } from "../src/execution/resolveDurableEpisodeProductionState.js";
import {
  EpisodeAutomationError,
  runEpisodeAutomation,
  type RunEpisodeAutomationDependencies,
} from "../src/execution/runEpisodeAutomation.js";
import { loadEnvironment } from "../src/validation/loadEnvironment.js";

const EPISODE = "EP02";

const VG = { kind: "VISUAL_GENERATE", sceneId: "SC01", shotId: "S02", confirmPaidGeneration: true } as const;
const VR = { kind: "VISUAL_RECONCILE", sceneId: "SC01", shotId: "S02", confirmReconciliation: true } as const;
const DG = {
  kind: "DIALOGUE_GENERATE",
  sceneId: "SC01",
  shotId: "S02",
  dialogueLineId: "EP02_SC01_S02_L01",
  confirmPaidGeneration: true,
} as const;
const DR = {
  kind: "DIALOGUE_RECONCILE",
  sceneId: "SC01",
  shotId: "S02",
  dialogueLineId: "EP02_SC01_S02_L01",
  confirmReconciliation: true,
} as const;
const KINDS = { VISUAL_GENERATE: VG, VISUAL_RECONCILE: VR, DIALOGUE_GENERATE: DG, DIALOGUE_RECONCILE: DR } as const;
type Kind = keyof typeof KINDS;
const CONFIRMATION: Record<Kind, "confirmPaidGeneration" | "confirmReconciliation"> = {
  VISUAL_GENERATE: "confirmPaidGeneration",
  VISUAL_RECONCILE: "confirmReconciliation",
  DIALOGUE_GENERATE: "confirmPaidGeneration",
  DIALOGUE_RECONCILE: "confirmReconciliation",
};
const RUNNER: Record<Kind, EpisodeCoordinatorRunner> = {
  VISUAL_GENERATE: "runSingleShotExecutionCli",
  VISUAL_RECONCILE: "runProductionExecutionReconcileCli",
  DIALOGUE_GENERATE: "runDialogueGenerationCli",
  DIALOGUE_RECONCILE: "runDialogueReconcileCli",
};

function plan(actions: readonly unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { schemaVersion: "1.0", episodeId: EPISODE, actions, ...extra };
}

function shot(n: number): string {
  return `S${String(n).padStart(2, "0")}`;
}

function visualAt(n: number): typeof VG {
  return { ...VG, shotId: shot(n) } as typeof VG;
}

function state(marker: string): DurableEpisodeProductionState {
  return Object.freeze({ marker }) as unknown as DurableEpisodeProductionState;
}

function resultFor(action: EpisodeCoordinatorAction, n: number): CoordinateEpisodeActionResult {
  return Object.freeze({
    episodeId: EPISODE,
    action,
    runner: RUNNER[action.kind],
    beforeState: state(`before-${n}`),
    afterState: state(`after-${n}`),
  });
}

function harness(onCall?: (input: CoordinateEpisodeActionInput, call: number) => Promise<CoordinateEpisodeActionResult>) {
  const coordinateAction = vi.fn(async (input: CoordinateEpisodeActionInput) => {
    const call = coordinateAction.mock.calls.length;
    return onCall ? onCall(input, call) : resultFor(input.action, call);
  });
  return {
    coordinateAction,
    deps: { coordinateAction } as unknown as RunEpisodeAutomationDependencies,
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (error: unknown) => error,
  );
}

describe("C7 A strict plan envelope", () => {
  it("accepts the canonical plan and returns a frozen copy", () => {
    const parsed = parseEpisodeAutomationPlan(plan([VG, VR]));
    expect(parsed).toEqual({ schemaVersion: "1.0", episodeId: EPISODE, actions: [VG, VR] });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.actions)).toBe(true);
  });

  it.each([
    ["schemaVersion 1", { schemaVersion: 1 }],
    ["schemaVersion 2.0", { schemaVersion: "2.0" }],
    ["missing schemaVersion", { schemaVersion: undefined }],
    ["malformed episodeId", { episodeId: "E02" }],
    ["flag-like episodeId", { episodeId: "--episode" }],
    ["empty actions", { actions: [] }],
    ["non-array actions", { actions: {} }],
    ["unknown top-level field", { extra: true }],
    ["global paid confirmation", { confirmPaidGeneration: true }],
    ["global reconciliation confirmation", { confirmReconciliation: true }],
  ])("rejects %s", (_label, override) => {
    const input = plan([VG], override);
    if ("schemaVersion" in override && override.schemaVersion === undefined) delete input.schemaVersion;
    expect(() => parseEpisodeAutomationPlan(input)).toThrow(/Episode automation plan is invalid/);
  });

  it.each([null, undefined, "plan", 7, []])("rejects a non-object plan %s", (input) => {
    expect(() => parseEpisodeAutomationPlan(input)).toThrow(/Episode automation plan is invalid/);
  });

  it(`accepts exactly ${MAX_EPISODE_AUTOMATION_ACTIONS} actions and rejects one more`, () => {
    // Canonical shot ids are S + 2-3 digits (+ optional letter): S001..S999, S01A, S01B.
    const ids = [...Array.from({ length: 999 }, (_v, i) => `S${String(i + 1).padStart(3, "0")}`), "S01A", "S01B"];
    const actions = ids.map((shotId) => ({ ...VG, shotId }));
    expect(parseEpisodeAutomationPlan(plan(actions.slice(0, 1000))).actions).toHaveLength(1000);
    expect(() => parseEpisodeAutomationPlan(plan(actions))).toThrow(/exceeds the allowed size/);
  });

  it("exports the locked limits", () => {
    expect(MAX_EPISODE_AUTOMATION_PLAN_BYTES).toBe(1048576);
    expect(MAX_EPISODE_AUTOMATION_ACTIONS).toBe(1000);
  });
});

describe("C7 B the four action shapes", () => {
  it.each(Object.entries(KINDS))("%s is accepted with exactly its C6b fields", (_kind, action) => {
    expect(parseEpisodeAutomationPlan(plan([action])).actions[0]).toEqual(action);
  });

  it.each([null, 7, "VISUAL_GENERATE", [], { kind: "VISUAL_INSPECT", sceneId: "SC01", shotId: "S02" }, {}])(
    "rejects a non-action entry %s",
    (entry) => {
      expect(() => parseEpisodeAutomationPlan(plan([VG, entry]))).toThrow(/actions\[1\]/);
    },
  );

  it("rejects a dialogue line on a visual action and a missing line on a dialogue action", () => {
    expect(() => parseEpisodeAutomationPlan(plan([{ ...VG, dialogueLineId: DG.dialogueLineId }]))).toThrow();
    const { dialogueLineId: _line, ...lineless } = DG;
    expect(() => parseEpisodeAutomationPlan(plan([lineless]))).toThrow();
  });
});

describe("C7 C per-action literal-true confirmations", () => {
  for (const kind of Object.keys(KINDS) as Kind[]) {
    it.each([["missing", undefined], ["false", false], ['"true"', "true"], ["1", 1], ["null", null], ["object", {}]])(
      `${kind} with %s confirmation rejects before any coordinator call`,
      async (_label, value) => {
        const action: Record<string, unknown> = { ...KINDS[kind] };
        if (value === undefined) delete action[CONFIRMATION[kind]];
        else action[CONFIRMATION[kind]] = value;
        const controlled = harness();
        await expect(runEpisodeAutomation(plan([action]), controlled.deps)).rejects.toThrow(
          /Episode automation plan is invalid/,
        );
        expect(controlled.coordinateAction).not.toHaveBeenCalled();
      },
    );

    it(`${kind} with the wrong-family confirmation rejects`, async () => {
      const action: Record<string, unknown> = { ...KINDS[kind] };
      delete action[CONFIRMATION[kind]];
      action[CONFIRMATION[kind] === "confirmPaidGeneration" ? "confirmReconciliation" : "confirmPaidGeneration"] = true;
      const controlled = harness();
      await expect(runEpisodeAutomation(plan([action]), controlled.deps)).rejects.toThrow();
      expect(controlled.coordinateAction).not.toHaveBeenCalled();
    });
  }

  it("a plan-level confirmation is not inherited by a confirmation-less action", async () => {
    const { confirmPaidGeneration: _c, ...unconfirmed } = VG;
    const controlled = harness();
    await expect(
      runEpisodeAutomation(plan([unconfirmed], { confirmPaidGeneration: true }), controlled.deps),
    ).rejects.toThrow();
    expect(controlled.coordinateAction).not.toHaveBeenCalled();
  });
});

describe("C7 D unsupported authority fields", () => {
  it.each([
    ["provider", "RUNWAY"],
    ["credentials", { apiKey: "sk-test" }],
    ["apiKey", "sk-test"],
    ["secret", "sk-test"],
    ["namespace", "DIRECT_SEED_AUDIO"],
    ["image", "C:/x.png"],
    ["referencePath", "C:/x.png"],
    ["planKey", "a".repeat(64)],
    ["state", "READY_FOR_GENERATION"],
    ["argv", ["--force"]],
    ["episodeId", EPISODE],
    ["overrides", {}],
  ])("rejects action field %s without echoing its value", (field, value) => {
    let message = "";
    try {
      parseEpisodeAutomationPlan(plan([{ ...DG, [field]: value }]));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/actions\[0\] contains unsupported fields/);
    expect(message).not.toContain("sk-test");
    expect(message).not.toContain(field === "episodeId" ? "\u0000" : field);
  });
});

describe("C7 E complete prevalidation", () => {
  it("a valid first action plus an invalid final action makes zero coordinator calls", async () => {
    const controlled = harness();
    await expect(
      runEpisodeAutomation(plan([VG, DG, { ...VR, confirmReconciliation: false }]), controlled.deps),
    ).rejects.toThrow(/actions\[2\]\.confirmReconciliation/);
    expect(controlled.coordinateAction).not.toHaveBeenCalled();
  });
});

describe("C7 F canonical identity", () => {
  it.each([
    ["sceneId", { ...VG, sceneId: "S01" }],
    ["shotId", { ...VR, shotId: "--shot" }],
    ["dialogueLineId format", { ...DG, dialogueLineId: "L01" }],
    ["line of another shot", { ...DG, dialogueLineId: "EP02_SC01_S03_L01" }],
    ["line of another scene", { ...DR, dialogueLineId: "EP02_SC02_S02_L01" }],
    ["line of another episode", { ...DG, dialogueLineId: "EP03_SC01_S02_L01" }],
  ])("rejects a malformed %s with no coordinator call", async (_label, action) => {
    const controlled = harness();
    await expect(runEpisodeAutomation(plan([VG, action].slice(1)), controlled.deps)).rejects.toThrow(
      /Episode automation plan is invalid/,
    );
    expect(controlled.coordinateAction).not.toHaveBeenCalled();
  });
});

describe("C7 G duplicates and structural conflicts", () => {
  it.each([
    ["an exact duplicate", [VG, VG], /duplicates an earlier VISUAL_GENERATE/],
    ["an exact dialogue duplicate", [DR, DR], /duplicates an earlier DIALOGUE_RECONCILE/],
    ["one shot in two scenes", [VG, { ...DG, sceneId: "SC02", dialogueLineId: "EP02_SC02_S02_L01" }], /different scene/],
    ["visual reconcile then generate", [VR, VG], /generation must precede reconciliation/],
    ["dialogue reconcile then generate", [DR, DG], /generation must precede reconciliation/],
  ] as const)("rejects %s", (_label, actions, expected) => {
    expect(() => parseEpisodeAutomationPlan(plan(actions))).toThrow(expected);
  });

  it.each([
    ["visual generate then reconcile", [VG, VR]],
    ["dialogue generate then reconcile", [DG, DR]],
    ["a lone visual reconcile", [VR]],
    ["a lone dialogue reconcile", [DR]],
    ["distinct dialogue lines in one shot", [DG, { ...DG, dialogueLineId: "EP02_SC01_S02_L02" }]],
    ["cross-axis entries for one shot in any order", [DR, VG, { ...DG, dialogueLineId: "EP02_SC01_S02_L02" }, VR]],
    ["dialogue reconcile before visual generate (different axes)", [DR, VG]],
  ] as const)("allows %s", (_label, actions) => {
    expect(parseEpisodeAutomationPlan(plan(actions)).actions).toHaveLength(actions.length);
  });
});

describe("C7 H immutability", () => {
  it("parsed actions are new frozen copies; caller mutation cannot widen authority", () => {
    const callerAction = { ...DG };
    const callerActions = [callerAction];
    const parsed = parseEpisodeAutomationPlan(plan(callerActions));
    expect(parsed.actions[0]).not.toBe(callerAction);
    expect(Object.isFrozen(parsed.actions[0])).toBe(true);
    (callerAction as Record<string, unknown>).shotId = "S09";
    callerActions.push({ ...VG } as never);
    expect(parsed.actions).toEqual([DG]);
  });

  it("mutating the caller plan during a deferred first call does not change the later forwarded action", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const callerActions: Record<string, unknown>[] = [{ ...VG }, { ...VR }];
    const callerPlan = plan(callerActions);
    const controlled = harness(async (input, call) => {
      if (call === 1) await gate;
      return resultFor(input.action, call);
    });

    const run = runEpisodeAutomation(callerPlan, controlled.deps);
    await new Promise((resolve) => setTimeout(resolve, 0));
    callerActions[1]!.shotId = "S99";
    callerActions[1]!.kind = "VISUAL_GENERATE";
    callerActions.push({ ...DG });
    (callerPlan as Record<string, unknown>).episodeId = "EP99";
    release();
    await run;

    expect(controlled.coordinateAction).toHaveBeenCalledTimes(2);
    expect(controlled.coordinateAction.mock.calls[1]![0]).toEqual({ episodeId: EPISODE, action: VR });
    expect(Object.isFrozen(controlled.coordinateAction.mock.calls[1]![0].action)).toBe(true);
  });
});

describe("C7 I exact forwarding", () => {
  it.each(Object.entries(KINDS))("%s is forwarded as exactly { episodeId, action }", async (_kind, action) => {
    const controlled = harness();
    await runEpisodeAutomation(plan([action]), controlled.deps);
    const [forwarded] = controlled.coordinateAction.mock.calls[0]!;
    expect(forwarded).toEqual({ episodeId: EPISODE, action });
    expect(Object.keys(forwarded).sort()).toEqual(["action", "episodeId"]);
    expect(Object.keys(forwarded.action).sort()).toEqual(Object.keys(action).sort());
  });
});

describe("C7 J operator order", () => {
  it("preserves literal plan order across kinds and reversed shot numbering", async () => {
    const actions = [
      visualAt(9),
      { ...DG, shotId: "S07", dialogueLineId: "EP02_SC01_S07_L01" },
      visualAt(3),
      { ...VR, shotId: "S09" },
      { ...DR, shotId: "S01", dialogueLineId: "EP02_SC01_S01_L01" },
    ];
    const controlled = harness();
    await runEpisodeAutomation(plan(actions), controlled.deps);
    expect(controlled.coordinateAction.mock.calls.map(([input]) => `${input.action.kind}:${input.action.shotId}`)).toEqual([
      "VISUAL_GENERATE:S09",
      "DIALOGUE_GENERATE:S07",
      "VISUAL_GENERATE:S03",
      "VISUAL_RECONCILE:S09",
      "DIALOGUE_RECONCILE:S01",
    ]);
  });
});

describe("C7 K strict sequentialism", () => {
  it("never starts a call before the previous one resolves (max in flight = 1)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const releases: Array<() => void> = [];
    const controlled = harness(async (input, call) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => releases.push(resolve));
      inFlight -= 1;
      return resultFor(input.action, call);
    });

    const run = runEpisodeAutomation(plan([visualAt(1), visualAt(2), visualAt(3)]), controlled.deps);
    for (let step = 1; step <= 3; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(controlled.coordinateAction).toHaveBeenCalledTimes(step);
      releases[step - 1]!();
    }
    await run;
    expect(maxInFlight).toBe(1);
  });
});

describe("C7 L success contract", () => {
  it("retains exact result references, freezes, and finalState is the last afterState", async () => {
    const produced: CoordinateEpisodeActionResult[] = [];
    const controlled = harness(async (input, call) => {
      const result = resultFor(input.action, call);
      produced.push(result);
      return result;
    });
    const outcome = await runEpisodeAutomation(plan([VG, DG, VR]), controlled.deps);

    expect(outcome.episodeId).toBe(EPISODE);
    expect(outcome.results).toHaveLength(3);
    outcome.results.forEach((result, index) => expect(result).toBe(produced[index]));
    expect(outcome.finalState).toBe(produced[2]!.afterState);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(outcome.results)).toBe(true);
    expect(Object.keys(outcome).sort()).toEqual(["episodeId", "finalState", "results"]);
    expect(controlled.coordinateAction).toHaveBeenCalledTimes(3);
    expect(resolveDurableEpisodeProductionState).not.toHaveBeenCalled();
  });
});

describe("C7 M ordinary rejection stops the run", () => {
  it.each([0, 1, 2])("a rejection at index %i stops with the exact prefix and cause", async (failAt) => {
    const failure = new Error("C6b refused: VISUAL_GENERATE is not admitted");
    const produced: CoordinateEpisodeActionResult[] = [];
    const controlled = harness(async (input, call) => {
      if (call === failAt + 1) throw failure;
      const result = resultFor(input.action, call);
      produced.push(result);
      return result;
    });
    const actions = [visualAt(1), visualAt(2), visualAt(3)];

    const error = (await rejection(runEpisodeAutomation(plan(actions), controlled.deps))) as EpisodeAutomationError;

    expect(error).toBeInstanceOf(EpisodeAutomationError);
    expect(error.name).toBe("EpisodeAutomationError");
    expect(error.cause).toBe(failure);
    expect(error.episodeId).toBe(EPISODE);
    expect(error.failedActionIndex).toBe(failAt);
    expect(error.failedAction).toEqual(actions[failAt]);
    expect(Object.isFrozen(error.failedAction)).toBe(true);
    expect(error.failedActionOutcome).toBe("UNKNOWN");
    expect(error.completedResults).toHaveLength(failAt);
    error.completedResults.forEach((result, index) => expect(result).toBe(produced[index]));
    expect(Object.isFrozen(error.completedResults)).toBe(true);
    expect(controlled.coordinateAction).toHaveBeenCalledTimes(failAt + 1);
    expect(error.message).toContain(`stopped at action index ${failAt}`);
    expect(error.message).toContain("later actions were not attempted");
    expect(error.message).not.toMatch(/no effects|nothing happened|safe to retry/i);
    for (const forbidden of ["afterState", "finalState", "resumeToken", "cursor", "nextIndex"]) {
      expect(forbidden in error).toBe(false);
    }
  });
});

describe("C7 N post-action state resolution failure", () => {
  it.each(Object.entries(KINDS))("%s: COMPLETED_STATE_UNRESOLVED, typed cause kept, no retry or continuation", async (kind, action) => {
    const postFailure = new EpisodeActionPostStateResolutionError({
      episodeId: EPISODE,
      action,
      runner: RUNNER[kind as Kind],
      cause: new Error("post-action C4 failed"),
    });
    const controlled = harness(async (input, call) => {
      if (call === 2) throw postFailure;
      return resultFor(input.action, call);
    });
    const other = kind.startsWith("VISUAL") ? { ...DG, shotId: "S05", dialogueLineId: "EP02_SC01_S05_L01" } : visualAt(5);

    const error = (await rejection(
      runEpisodeAutomation(plan([visualAt(1), action, other]), controlled.deps),
    )) as EpisodeAutomationError;

    expect(error.failedActionOutcome).toBe("COMPLETED_STATE_UNRESOLVED");
    expect(error.cause).toBe(postFailure);
    expect((error.cause as EpisodeActionPostStateResolutionError).actionCompleted).toBe(true);
    expect((error.cause as EpisodeActionPostStateResolutionError).runner).toBe(RUNNER[kind as Kind]);
    expect(error.failedActionIndex).toBe(1);
    expect(error.completedResults).toHaveLength(1);
    expect(controlled.coordinateAction).toHaveBeenCalledTimes(2);
    expect("afterState" in error || "finalState" in error).toBe(false);
  });

  it("classifies by type, not by message text", async () => {
    const lookalike = new Error("completed via runSingleShotExecutionCli, but the resulting durable episode state could not be resolved.");
    const controlled = harness(async () => {
      throw lookalike;
    });
    const error = (await rejection(runEpisodeAutomation(plan([VG]), controlled.deps))) as EpisodeAutomationError;
    expect(error.failedActionOutcome).toBe("UNKNOWN");
  });
});

describe("C7 O non-Error rejection", () => {
  it.each(["plain string", 42, null, { code: "X" }])("%s is kept as the cause with outcome UNKNOWN", async (value) => {
    const controlled = harness(async () => {
      throw value;
    });
    const error = (await rejection(runEpisodeAutomation(plan([VG, VR]), controlled.deps))) as EpisodeAutomationError;
    expect(error).toBeInstanceOf(EpisodeAutomationError);
    expect(error.cause).toBe(value);
    expect(error.failedActionOutcome).toBe("UNKNOWN");
    expect(controlled.coordinateAction).toHaveBeenCalledTimes(1);
    expect(error.message).not.toMatch(/no effects|no provider|nothing happened/i);
  });
});

describe("C7 P replay and operator-authored remaining plans", () => {
  it("an unchanged plan starts again at index 0 and a completed-target refusal stops it (no skip)", async () => {
    const actions = [visualAt(1), visualAt(2)];
    const first = harness();
    await runEpisodeAutomation(plan(actions), first.deps);

    const replay = harness(async (input, call) => {
      if (input.action.shotId === "S01") throw new Error("VISUAL_GENERATE is not admitted: current state is LIFECYCLE_COMPLETED.");
      return resultFor(input.action, call);
    });
    const error = (await rejection(runEpisodeAutomation(plan(actions), replay.deps))) as EpisodeAutomationError;
    expect(replay.coordinateAction.mock.calls[0]![0].action.shotId).toBe("S01");
    expect(replay.coordinateAction).toHaveBeenCalledTimes(1);
    expect(error.failedActionIndex).toBe(0);
  });

  it("a separately supplied remaining-action plan invokes only its own entries", async () => {
    const remaining = harness();
    await runEpisodeAutomation(plan([visualAt(2), { ...VR, shotId: "S02" }]), remaining.deps);
    expect(remaining.coordinateAction.mock.calls.map(([input]) => input.action)).toEqual([visualAt(2), { ...VR, shotId: "S02" }]);
  });
});

describe("C7 Q intervention refusals stop without repair", () => {
  it.each([
    "DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED",
    "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED",
    "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED",
    "DIALOGUE_PLANNING_BLOCKED",
  ])("refusal from %s stops; no follow-up action", async (refusedState) => {
    const refusal = new Error(`DIALOGUE_GENERATE is not admitted for EP02/SC01/S02: current state is ${refusedState}.`);
    const controlled = harness(async () => {
      throw refusal;
    });
    const error = (await rejection(runEpisodeAutomation(plan([DG, VG]), controlled.deps))) as EpisodeAutomationError;
    expect(error.cause).toBe(refusal);
    expect(controlled.coordinateAction).toHaveBeenCalledTimes(1);
  });
});

describe("C7 R no implicit reconciliation", () => {
  it("a generation whose afterState needs reconciliation does not add a reconcile", async () => {
    const controlled = harness(async (input, call) =>
      Object.freeze({ ...resultFor(input.action, call), afterState: state("SUBMITTED_RECONCILIATION_REQUIRED") }),
    );
    await runEpisodeAutomation(plan([VG]), controlled.deps);
    expect(controlled.coordinateAction).toHaveBeenCalledTimes(1);
  });

  it("a separately listed reconcile forwards exactly that confirmed object next", async () => {
    const controlled = harness();
    await runEpisodeAutomation(plan([VG, VR]), controlled.deps);
    expect(controlled.coordinateAction.mock.calls.map(([input]) => input.action)).toEqual([VG, VR]);
  });
});

describe("C7 S a later independent target never runs after a failure", () => {
  it("an unrelated later shot is not attempted", async () => {
    const controlled = harness(async (input, call) => {
      if (call === 1) throw new Error("runner failed");
      return resultFor(input.action, call);
    });
    await expect(
      runEpisodeAutomation(plan([visualAt(1), { ...DG, shotId: "S08", dialogueLineId: "EP02_SC01_S08_L01" }]), controlled.deps),
    ).rejects.toBeInstanceOf(EpisodeAutomationError);
    expect(controlled.coordinateAction).toHaveBeenCalledTimes(1);
  });
});

describe("C7 T default dependency seam", () => {
  beforeEach(() => {
    vi.mocked(coordinateEpisodeAction).mockReset();
  });

  it("without injected dependencies the actual coordinateEpisodeAction symbol is called; no lower runner", async () => {
    vi.mocked(coordinateEpisodeAction).mockImplementation(async (input) => resultFor(input.action, 1));
    const outcome = await runEpisodeAutomation(plan([VG, DR]));
    expect(coordinateEpisodeAction).toHaveBeenCalledTimes(2);
    expect(outcome.results).toHaveLength(2);
    for (const runner of [runSingleShotExecutionCli, runProductionExecutionReconcileCli, runDialogueGenerationCli, runDialogueReconcileCli]) {
      expect(runner).not.toHaveBeenCalled();
    }
    expect(loadEnvironment).not.toHaveBeenCalled();
  });
});

// TypeScript 7 ships no JS compiler API, so this tripwire tokenizes the source
// after stripping comments and enumerates every import form. Behavioural tests
// above remain the primary evidence.
function importsOf(source: string): Array<{ specifier: string; typeOnly: boolean }> {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const found: Array<{ specifier: string; typeOnly: boolean }> = [];
  for (const match of code.matchAll(/\b(import|export)\s+(type\s+)?([^;]*?)\s+from\s+"([^"]+)"/g)) {
    found.push({ specifier: match[4]!, typeOnly: Boolean(match[2]) });
  }
  for (const match of code.matchAll(/\bimport\s+"([^"]+)"/g)) found.push({ specifier: match[1]!, typeOnly: false });
  for (const match of code.matchAll(/\b(?:import|require)\s*\(\s*["'`]?([^"'`)]*)/g)) found.push({ specifier: `dynamic:${match[1]}`, typeOnly: false });
  return found;
}

describe("C7 U source boundary", () => {
  const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const FORBIDDEN = /runSingleShotExecutionCli|runProductionExecutionReconcileCli|runDialogueGenerationCli|runDialogueReconcileCli|resolveDurableShot|admitDialogueLineGeneration|AdmissionLedger|executeSingleShot|Reservation\(|Reconciler|createDialogueVisualAuthorization|PlacementDecision|compos|render|ffmpeg|setTimeout|setInterval|Promise\.(all|race|any|allSettled)|node:|child_process|\.message\b/i;

  it("runEpisodeAutomation imports only the coordinator, the pure plan parser and a C4 type", async () => {
    const source = await read("src/execution/runEpisodeAutomation.ts");
    expect(importsOf(source)).toEqual([
      { specifier: "./coordinateEpisodeAction.js", typeOnly: false },
      { specifier: "./episodeAutomationPlan.schema.js", typeOnly: false },
      { specifier: "./resolveDurableEpisodeProductionState.js", typeOnly: true },
    ]);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(FORBIDDEN);
    expect(code.match(/\.coordinateAction\s*\(/g)).toHaveLength(1);
  });

  it("the plan schema is pure: zod, id schemas and a coordinator type only", async () => {
    const source = await read("src/execution/episodeAutomationPlan.schema.ts");
    expect(importsOf(source)).toEqual([
      { specifier: "zod", typeOnly: false },
      { specifier: "../dialogue/dialogueReservation.schema.js", typeOnly: false },
      { specifier: "./coordinateEpisodeAction.js", typeOnly: true },
      { specifier: "./executionReservation.schema.js", typeOnly: false },
    ]);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(FORBIDDEN);
    expect(code).not.toMatch(/\.regex\(|new RegExp/);
  });
});
