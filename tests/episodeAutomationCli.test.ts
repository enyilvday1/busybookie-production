import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Lower layers are replaced; nothing here can reach the environment, media,
// C4 or a provider.
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
// Pass-through spies: guard acquisition, fresh sessions and checked contexts stay observable.
vi.mock("../src/execution/episodeExecutionGuard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/episodeExecutionGuard.js")>();
  return { ...actual, acquireEpisodeExecutionGuard: vi.fn(actual.acquireEpisodeExecutionGuard),
    createFreshEpisodeOperatorSession: vi.fn(actual.createFreshEpisodeOperatorSession),
    createCheckedEpisodeExecutionContext: vi.fn(actual.createCheckedEpisodeExecutionContext) };
});
// Pass-through spy so the real bounded reader can be observed.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
// Pass-through spy so the thin script can be exercised without real execution.
vi.mock("../src/execution/cli/runEpisodeAutomationCli.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/cli/runEpisodeAutomationCli.js")>();
  return { ...actual, runEpisodeAutomationCli: vi.fn(actual.runEpisodeAutomationCli) };
});

import { open } from "node:fs/promises";

import { parseEpisodeAutomationCliArgs } from "../src/execution/cli/episodeAutomationCliArgs.js";
import {
  formatEpisodeAutomationCliError,
  readEpisodeAutomationPlanText,
  runEpisodeAutomationCli,
  type RunEpisodeAutomationCliDependencies,
} from "../src/execution/cli/runEpisodeAutomationCli.js";
import {
  coordinateEpisodeAction,
  EpisodeActionPostStateResolutionError,
  type CoordinateEpisodeActionResult,
  type EpisodeCoordinatorAction,
  type EpisodeCoordinatorRunner,
} from "../src/execution/coordinateEpisodeAction.js";
import { MAX_EPISODE_AUTOMATION_PLAN_BYTES, parseEpisodeAutomationPlan } from "../src/execution/episodeAutomationPlan.schema.js";
import { resolveDurableEpisodeProductionState } from "../src/execution/resolveDurableEpisodeProductionState.js";
import type { DurableEpisodeProductionState } from "../src/execution/resolveDurableEpisodeProductionState.js";
import { EpisodeAutomationError, type EpisodeAutomationResult } from "../src/execution/runEpisodeAutomation.js";
import { loadEnvironment } from "../src/validation/loadEnvironment.js";
import { runSingleShotExecutionCli } from "../src/execution/cli/runSingleShotExecutionCli.js";
import { runProductionExecutionReconcileCli } from "../src/execution/cli/runProductionExecutionReconcileCli.js";
import { BoundEpisodeError, bindingDigest, type BoundEpisodeActionResult } from "../src/execution/boundEpisodeProduction.types.js";
import { acquireEpisodeExecutionGuard, consumeFreshEpisodeOperatorSession, createCheckedEpisodeExecutionContext,
  createFreshEpisodeOperatorSession, type FreshEpisodeOperatorSession } from "../src/execution/episodeExecutionGuard.js";

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
const DR = { kind: "DIALOGUE_RECONCILE", sceneId: "SC01", shotId: "S02", dialogueLineId: "EP02_SC01_S02_L01", confirmReconciliation: true } as const;
const PLAN = { schemaVersion: "1.0", episodeId: EPISODE, actions: [DG, DR, { ...DG, shotId: "S03", dialogueLineId: "EP02_SC01_S03_L01" }] };
const RUNNER: Record<EpisodeCoordinatorAction["kind"], EpisodeCoordinatorRunner> = {
  VISUAL_GENERATE: "runSingleShotExecutionCli",
  VISUAL_RECONCILE: "runProductionExecutionReconcileCli",
  DIALOGUE_GENERATE: "runDialogueGenerationCli",
  DIALOGUE_RECONCILE: "runDialogueReconcileCli",
};

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "busybookie-c7-plan-"));
  roots.push(root);
  return root;
}

function result(action: EpisodeCoordinatorAction, n: number): CoordinateEpisodeActionResult {
  return Object.freeze({
    episodeId: EPISODE,
    action,
    runner: RUNNER[action.kind],
    beforeState: Object.freeze({ marker: `before-${n}` }) as unknown as DurableEpisodeProductionState,
    afterState: Object.freeze({ marker: `after-${n}` }) as unknown as DurableEpisodeProductionState,
  });
}

function automationResult(actions: readonly EpisodeCoordinatorAction[]): EpisodeAutomationResult {
  const results = Object.freeze(actions.map((action, index) => result(action, index + 1)));
  return Object.freeze({ episodeId: EPISODE, results, finalState: results[results.length - 1]!.afterState });
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (error: unknown) => error as Error,
  );
}

function harness(text: string = JSON.stringify(PLAN)) {
  const events: string[] = [];
  const readPlanText = vi.fn(async (_path: string) => {
    events.push("read");
    return text;
  });
  const runAutomation = vi.fn(async (plan: unknown) => {
    events.push("automation");
    return automationResult((plan as { actions: EpisodeCoordinatorAction[] }).actions);
  });
  const writeStdout = vi.fn((_text: string) => {
    events.push("stdout");
  });
  return {
    events,
    readPlanText,
    runAutomation,
    writeStdout,
    deps: { readPlanText, runAutomation, writeStdout } as unknown as RunEpisodeAutomationCliDependencies,
    output: () => writeStdout.mock.calls.map(([value]) => value).join(""),
  };
}

describe("C7 CLI A argument parser", () => {
  it.each([
    [["--plan", "plan.json"], { planPath: "plan.json", validateOnly: false }],
    [["--plan", "C:/plans/episode plan.json"], { planPath: "C:/plans/episode plan.json", validateOnly: false }],
    [["--plan", "/abs/plan.json", "--validate-only"], { planPath: "/abs/plan.json", validateOnly: true }],
    [["--validate-only", "--plan", "dir with spaces/plan.json"], { planPath: "dir with spaces/plan.json", validateOnly: true }],
  ])("accepts %j", (args, expected) => {
    const options = parseEpisodeAutomationCliArgs(args);
    expect(options).toEqual({ planOnly: false, json: false, shotIds: null, confirmation: null, ...expected });
    expect(Object.isFrozen(options)).toBe(true);
  });

  it.each([
    [[], /--plan is required/],
    [["--validate-only"], /--plan is required/],
    [["--plan"], /--plan requires a plan file path/],
    [["--plan", ""], /--plan requires a plan file path/],
    [["--plan", "   "], /--plan requires a plan file path/],
    [["--plan", "--validate-only"], /--plan requires a plan file path/],
    [["--plan", "-"], /does not accept stdin/],
    [["--plan", "a.json", "--plan", "b.json"], /Duplicate .*--plan/],
    [["--plan", "a.json", "--validate-only", "--validate-only"], /Duplicate .*--validate-only/],
    [["--plan", "a.json", "--validate-only", "true"], /positional/],
    [["--plan=a.json"], /Unknown .*--plan/],
    [["--plan", "a.json", "--validate-only=yes"], /Unknown .*--validate-only/],
    [["--plan", "a.json", "extra.json"], /positional/],
    [["plan.json"], /positional/],
    [["--plan", "a.json", "--episode", "EP02"], /exactly one/],
    [["--plan", "a.json", "--plan-only", "--confirm-paid-generation"], /Plan-only/],
    [["--plan", "a.json", "--confirm-reconciliation", "--confirm-paid-generation"], /mutually exclusive/],
    [["--plan", "a.json", "--yes"], /Unknown/],
    [["--plan", "a.json", "--retry"], /Unknown .*--retry/],
    [["--plan", "a.json", "--force"], /Unknown .*--force/],
    [["--plan", "a.json", "--cursor", "3"], /Unknown .*--cursor/],
    [["--plan", "a.json", "--skip", "0"], /Unknown .*--skip/],
    [["--plan", "a.json", "--resume"], /Unknown .*--resume/],
    [["--plan", "a.json", "--shot", "S02"], /Unknown .*--shot/],
    [["--plan", "a.json", "--kind", "VISUAL_GENERATE"], /Unknown .*--kind/],
    [["--plan", "a.json", "--validate-only", "--json"], /structural/],
  ])("rejects %j", (args, expected) => {
    expect(() => parseEpisodeAutomationCliArgs(args)).toThrow(expected);
  });
});

describe("C7 CLI B argv failures happen before any file read", () => {
  it.each([[[]], [["--plan"]], [["--plan", "a.json", "--retry"]], [["--plan", "-"]], [["--plan", "a.json", "x"]]])(
    "%j -> no read, no automation",
    async (args) => {
      const controlled = harness();
      await expect(runEpisodeAutomationCli(args, controlled.deps)).rejects.toThrow();
      expect(controlled.readPlanText).not.toHaveBeenCalled();
      expect(controlled.runAutomation).not.toHaveBeenCalled();
      expect(controlled.writeStdout).not.toHaveBeenCalled();
    },
  );

  it("resolves a relative plan path against process.cwd() and passes absolute paths through", async () => {
    const relative = harness();
    await runEpisodeAutomationCli(["--plan", "plans/episode plan.json", "--validate-only"], relative.deps);
    expect(relative.readPlanText).toHaveBeenCalledWith(resolve(process.cwd(), "plans/episode plan.json"));

    const absolutePath = resolve(tmpdir(), "abs-plan.json");
    const absolute = harness();
    await runEpisodeAutomationCli(["--plan", absolutePath, "--validate-only"], absolute.deps);
    expect(absolute.readPlanText).toHaveBeenCalledWith(absolutePath);
  });
});

describe("C7 CLI C bounded control-file reader (temp fixtures only)", () => {
  it("reads a regular UTF-8 file", async () => {
    const dir = await tempDir();
    const path = join(dir, "plan.json");
    await writeFile(path, JSON.stringify(PLAN));
    await expect(readEpisodeAutomationPlanText(path)).resolves.toBe(JSON.stringify(PLAN));
  });

  it("accepts exactly the byte limit and rejects one byte more", async () => {
    const dir = await tempDir();
    const exact = join(dir, "exact.json");
    const over = join(dir, "over.json");
    await writeFile(exact, Buffer.alloc(MAX_EPISODE_AUTOMATION_PLAN_BYTES, 0x20));
    await writeFile(over, Buffer.alloc(MAX_EPISODE_AUTOMATION_PLAN_BYTES + 1, 0x20));
    await expect(readEpisodeAutomationPlanText(exact)).resolves.toHaveLength(MAX_EPISODE_AUTOMATION_PLAN_BYTES);
    await expect(readEpisodeAutomationPlanText(over)).rejects.toThrow(/exceeds 1048576 bytes/);
  });

  it("rejects a directory", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, "plan.json"));
    await expect(readEpisodeAutomationPlanText(join(dir, "plan.json"))).rejects.toThrow(
      /not a regular file|Could not open the episode automation plan file/,
    );
  });

  it("rejects a missing file", async () => {
    const dir = await tempDir();
    await expect(readEpisodeAutomationPlanText(join(dir, "missing.json"))).rejects.toThrow(
      /Could not open the episode automation plan file/,
    );
  });

  it.each([
    ["a lone continuation byte", [0x7b, 0x80, 0x7d]],
    ["a truncated two-byte sequence", [0x7b, 0x22, 0xc3, 0x22, 0x7d]],
    ["an overlong encoding", [0xc0, 0xaf]],
    ["an encoded surrogate", [0xed, 0xa0, 0x80]],
  ])("rejects invalid UTF-8 (%s) instead of substituting U+FFFD", async (_label, bytes) => {
    const dir = await tempDir();
    const path = join(dir, "plan.json");
    await writeFile(path, Buffer.from(bytes));
    await expect(readEpisodeAutomationPlanText(path)).rejects.toThrow("Episode automation plan is not valid UTF-8.");
  });

  it("malformed JSON is rejected without echoing plan content", async () => {
    const dir = await tempDir();
    const path = join(dir, "plan.json");
    await writeFile(path, '{"schemaVersion":"1.0","apiKey":"sk-SECRET-VALUE-123",');
    const controlled = harness();
    const error = await rejectionOf(
      runEpisodeAutomationCli(["--plan", path], {
        ...controlled.deps,
        readPlanText: readEpisodeAutomationPlanText,
      }),
    );
    expect(error.message).toBe("Episode automation plan is not valid JSON.");
    expect(formatEpisodeAutomationCliError(error)).not.toContain("sk-SECRET-VALUE-123");
    expect(controlled.runAutomation).not.toHaveBeenCalled();
  });

  it("an invalid plan with secret-like values is rejected without echoing them", async () => {
    const controlled = harness(
      JSON.stringify({ ...PLAN, actions: [{ ...VG, credentials: { apiKey: "sk-SECRET-VALUE-123" } }] }),
    );
    const error = await rejectionOf(runEpisodeAutomationCli(["--plan", "p.json"], controlled.deps));
    expect(error.message).toMatch(/actions\[0\] contains unsupported fields/);
    expect(error.message).not.toContain("sk-SECRET");
    expect(error.message).not.toContain("credentials");
    expect(formatEpisodeAutomationCliError(error)).not.toContain("sk-SECRET");
  });
});

describe("C7 CLI D file lifecycle", () => {
  it("reads the selected file once and closes it before automation begins", async () => {
    const dir = await tempDir();
    const path = join(dir, "plan.json");
    await writeFile(path, JSON.stringify(PLAN));
    const events: string[] = [];
    const actualOpen = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).open;
    vi.mocked(open).mockImplementation((async (...args: Parameters<typeof actualOpen>) => {
      events.push("open");
      const handle = await actualOpen(...args);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        events.push("close");
        return close();
      };
      return handle;
    }) as typeof open);
    const controlled = harness();
    controlled.runAutomation.mockImplementation(async (plan: unknown) => {
      events.push("automation");
      return automationResult((plan as { actions: EpisodeCoordinatorAction[] }).actions);
    });

    await runEpisodeAutomationCli(["--plan", path], { ...controlled.deps, readPlanText: readEpisodeAutomationPlanText });

    expect(events).toEqual(["open", "close", "automation"]);
    expect(controlled.runAutomation).toHaveBeenCalledTimes(1);
  });
});

describe("C7 CLI E whole-plan validation before execution", () => {
  it("an invalid final entry makes zero automation calls", async () => {
    const controlled = harness(JSON.stringify({ ...PLAN, actions: [VG, DG, { ...VR, confirmReconciliation: "true" }] }));
    await expect(runEpisodeAutomationCli(["--plan", "p.json"], controlled.deps)).rejects.toThrow(
      /actions\[2\]\.confirmReconciliation/,
    );
    expect(controlled.runAutomation).not.toHaveBeenCalled();
    expect(controlled.writeStdout).not.toHaveBeenCalled();
  });
});

describe("C7 CLI F --validate-only", () => {
  it("validates completely and prints the concise non-execution message", async () => {
    const controlled = harness();
    await runEpisodeAutomationCli(["--plan", "p.json", "--validate-only"], controlled.deps);
    expect(controlled.output()).toBe(
      "Plan structurally valid (schema 1.0); 3 actions; no production preflight or execution performed.\n",
    );
    expect(controlled.output()).not.toMatch(/admissible|will succeed|cost|complete|safe to replay/i);
    expect(controlled.runAutomation).not.toHaveBeenCalled();
    expect(controlled.readPlanText).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid plan exactly as execution would", async () => {
    const controlled = harness(JSON.stringify({ ...PLAN, actions: [VR, VG] }));
    await expect(runEpisodeAutomationCli(["--plan", "p.json", "--validate-only"], controlled.deps)).rejects.toThrow(
      /generation must precede reconciliation/,
    );
    expect(controlled.writeStdout).not.toHaveBeenCalled();
  });

  it("with production defaults touches no coordinator, environment, C4 or runner", async () => {
    const dir = await tempDir();
    const path = join(dir, "plan.json");
    await writeFile(path, JSON.stringify(PLAN));
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runEpisodeAutomationCli(["--plan", path, "--validate-only"]);

    expect(stdout).toHaveBeenCalledWith(
      "Plan structurally valid (schema 1.0); 3 actions; no production preflight or execution performed.\n",
    );
    expect(coordinateEpisodeAction).not.toHaveBeenCalled();
    expect(loadEnvironment).not.toHaveBeenCalled();
    expect(resolveDurableEpisodeProductionState).not.toHaveBeenCalled();
  });
});

describe("C7 CLI G execution and summary", () => {
  it("passes the complete validated plan once and prints the post-run summary", async () => {
    const controlled = harness();
    await runEpisodeAutomationCli(["--plan", "p.json"], controlled.deps);

    expect(controlled.runAutomation).toHaveBeenCalledTimes(1);
    const [passed] = controlled.runAutomation.mock.calls[0]!;
    expect(passed).toEqual(PLAN);
    expect(Object.isFrozen(passed)).toBe(true);
    expect(controlled.events).toEqual(["read", "automation", "stdout"]);

    const output = controlled.output();
    expect(output).toContain("1. DIALOGUE_GENERATE EP02/SC01/S02 line EP02_SC01_S02_L01 -> runDialogueGenerationCli");
    expect(output).toContain("2. DIALOGUE_RECONCILE EP02/SC01/S02 line EP02_SC01_S02_L01 -> runDialogueReconcileCli");
    expect(output).toContain("3. DIALOGUE_GENERATE EP02/SC01/S03 line EP02_SC01_S03_L01 -> runDialogueGenerationCli");
    expect(output).toContain("Total successful explicit actions: 3");
    expect(output).toContain("The explicit automation plan finished");
    expect(output).toContain("Composition was not attempted");
    expect(output).not.toMatch(/marker|before-|after-|beforeState|afterState/);
    expect(output).not.toMatch(/episode complete|production complete|composition ready/i);
  });
});

describe("C7 CLI H inherited runner output", () => {
  it("does not capture or parse lower output; the summary is built from typed results", async () => {
    const originalLog = console.log;
    const lower = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const controlled = harness();
    controlled.runAutomation.mockImplementation(async (plan: unknown) => {
      console.log("Single-shot execution completed: EP02/S02 (WRONG-RUNNER-TEXT)");
      return automationResult((plan as { actions: EpisodeCoordinatorAction[] }).actions);
    });

    await runEpisodeAutomationCli(["--plan", "p.json"], controlled.deps);

    expect(lower).toHaveBeenCalledWith("Single-shot execution completed: EP02/S02 (WRONG-RUNNER-TEXT)");
    expect(controlled.output()).not.toContain("WRONG-RUNNER-TEXT");
    lower.mockRestore();
    expect(console.log).toBe(originalLog);
  });
});

function automationError(failedIndex: number, cause: unknown): EpisodeAutomationError {
  const actions: EpisodeCoordinatorAction[] = [VG, DG, VR];
  return new EpisodeAutomationError({
    episodeId: EPISODE,
    failedActionIndex: failedIndex,
    failedAction: actions[failedIndex]!,
    completedResults: actions.slice(0, failedIndex).map((action, index) => result(action, index + 1)),
    cause,
  });
}

describe("C7 CLI I-L error formatting", () => {
  it("a middle failure lists the prefix, the failed one-based ordinal and target, and later actions not attempted", () => {
    const text = formatEpisodeAutomationCliError(automationError(1, new Error("DIALOGUE_GENERATE is not admitted")));
    expect(text).toContain("Episode automation stopped for EP02.");
    expect(text).toContain("Successful explicit actions before the failure: 1");
    expect(text).toContain("1. VISUAL_GENERATE EP02/SC01/S02 -> runSingleShotExecutionCli");
    expect(text).toContain("Failed action: #2 DIALOGUE_GENERATE EP02/SC01/S02 line EP02_SC01_S02_L01");
    expect(text).toContain("Outcome: UNKNOWN");
    expect(text).toContain("Later actions in the plan were not attempted.");
    expect(text).not.toMatch(/plan finished|Total successful/);
  });

  it("a post-state failure says the action completed and requires durable-state inspection; no retry wording", () => {
    const action = DG;
    const cause = new EpisodeActionPostStateResolutionError({
      episodeId: EPISODE,
      action,
      runner: "runDialogueGenerationCli",
      cause: new Error("C4 evaluation failed"),
    });
    const text = formatEpisodeAutomationCliError(automationError(1, cause));
    expect(text).toContain("COMPLETED_STATE_UNRESOLVED");
    expect(text).toContain("the action completed, but the resulting durable state could not be resolved");
    expect(text).toContain("Inspect durable state");
    expect(text).toContain("before deciding whether to resume");
    expect(text).not.toMatch(/\bretry(ing)? (automatically|now)|will retry|safe to retry/i);
  });

  it("UNKNOWN never claims the action had no effects", () => {
    const text = formatEpisodeAutomationCliError(automationError(0, "non-error rejection"));
    expect(text).toContain("the action outcome may include durable effects");
    expect(text).not.toMatch(/no effects|nothing happened|no provider|not charged/i);
    expect(text).toContain("Successful explicit actions before the failure: 0");
  });

  it("generic and non-Error values are formatted safely without stacks or object dumps", () => {
    const error = new Error("plain failure\n    at secret stack frame");
    const generic = formatEpisodeAutomationCliError(error);
    expect(generic).toBe("\nEpisode automation failed: plain failure");
    expect(formatEpisodeAutomationCliError({ apiKey: "sk-SECRET" })).toBe(
      "\nEpisode automation failed with a non-error value.",
    );
    const nested = formatEpisodeAutomationCliError(automationError(0, { apiKey: "sk-SECRET" }));
    expect(nested).not.toContain("sk-SECRET");
    expect(nested).not.toContain("[object Object]");
  });
});

describe("C7 CLI M reporting failure never reruns automation", () => {
  it("a failing final stdout write propagates; automation ran exactly once", async () => {
    const controlled = harness();
    controlled.writeStdout.mockImplementation(() => {
      throw new Error("stdout closed");
    });
    await expect(runEpisodeAutomationCli(["--plan", "p.json"], controlled.deps)).rejects.toThrow("stdout closed");
    expect(controlled.runAutomation).toHaveBeenCalledTimes(1);
  });
});

describe("C7 CLI N thin script", () => {
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  async function runScript(outcome: "resolve" | "reject", failure?: unknown) {
    vi.resetModules();
    const cli = await import("../src/execution/cli/runEpisodeAutomationCli.js");
    if (outcome === "resolve") vi.mocked(cli.runEpisodeAutomationCli).mockResolvedValueOnce(undefined);
    else vi.mocked(cli.runEpisodeAutomationCli).mockRejectedValueOnce(failure);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit must not be called");
    }) as never);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await import("../scripts/episode-automation.js");
    await new Promise((resolveTick) => setTimeout(resolveTick, 0));
    return { cli, exit, stderr };
  }

  it("success leaves process.exitCode unset", async () => {
    const { cli, exit, stderr } = await runScript("resolve");
    expect(cli.runEpisodeAutomationCli).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
    expect(stderr).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("rejection is formatted to stderr with exitCode 1 and no process.exit", async () => {
    const failure = automationError(1, new Error("refused"));
    const { exit, stderr } = await runScript("reject", failure);
    expect(process.exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr.mock.calls[0]![0]).toContain("Episode automation stopped for EP02.");
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("C7 CLI O-Q package, index and composition boundaries", () => {
  const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

  it("package.json gains exactly the episode:automate script after execution:status", async () => {
    const pkg = JSON.parse(await read("package.json")) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts["episode:automate"]).toBe("tsx scripts/episode-automation.ts");
    expect(Object.keys(pkg.scripts)).toEqual([
      "test",
      "build",
      "typecheck",
      "test:watch",
      "validate:characters",
      "clean",
      "validate:rules",
      "validate:episode",
      "validate:runtime",
      "runway:gen45",
      "veo:generate",
      "routing:report",
      "execution:plan",
      "execution:generate",
      "execution:reconcile",
      "execution:status",
      "episode:automate",
      "episode:rough-cut",
      "dialogue:generate",
      "dialogue:reconcile",
      "dialogue:authorize-visual",
      "dialogue:place",
      "operator:serve",
    ]);
    expect(pkg.dependencies).toEqual({
      "@google/genai": "^2.24.0",
      "@runwayml/sdk": "^4.20.0",
      dotenv: "^18.0.2",
      zod: "^4.6.5",
    });
    expect(pkg.devDependencies).toEqual({
      "@types/node": "^26.6.2",
      tsx: "^4.23.15",
      typescript: "^7.0.2",
      vitest: "^5.0.1",
    });
  });

  it("src/index.ts exposes no automation surface", async () => {
    const source = (await read("src/index.ts")).replace(/\r\n/g, "\n");
    expect(source).toBe(
      'export const BUSYBOOKIE_PRODUCTION_VERSION = "0.1.0";\n\nexport function getProductionVersion(): string {\n  return BUSYBOOKIE_PRODUCTION_VERSION;\n}\n',
    );
  });

  it("no C7 file imports or calls composition, render or FFmpeg, or claims readiness", async () => {
    for (const path of [
      "src/execution/episodeAutomationPlan.schema.ts",
      "src/execution/runEpisodeAutomation.ts",
      "src/execution/cli/episodeAutomationCliArgs.ts",
      "src/execution/cli/runEpisodeAutomationCli.ts",
      "scripts/episode-automation.ts",
    ]) {
      const code = (await read(path)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, path).not.toMatch(
        /from\s+"[^"]*composition[^"]*"|buildEpisodeCompositionPlan|prepareEpisodeComposition|composeEpisodeRoughCut|RoughCutRender|materializeEpisodeRoughCut|ffmpeg|compositionReady/i,
      );
    }
    const script = (await read("scripts/episode-automation.ts")).replace(/\r\n/g, "\n");
    expect(script).not.toMatch(/process\.exit\s*\(/);
    expect(script).toContain("process.exitCode = 1;");
  });
});

// ---------------------------------------------------------------------------
// B5 Slice-2I-B (R39F): the official episode CLI carries an already-reviewed
// VISUAL_ATTEMPT_GENERATE plan. The frozen action is the only attempt identity.
// Synthetic plans only; lower automation is a probe, so no media, guard or provider.

type ControlledKind = "VISUAL_GENERATE" | "VISUAL_RECONCILE" | "VISUAL_ATTEMPT_GENERATE";
const digest = (character: string) => character.repeat(64);
const SYNTHETIC_MEDIA = resolve(tmpdir(), "busybookie-r39f-synthetic-media");

function controlledPlan(kind: ControlledKind, actionOverrides: Readonly<Record<string, unknown>> = {}) {
  const target = { episodeId: EPISODE, sceneId: "SC01", shotId: "S01", order: 1 };
  const scope = { kind: "EPISODE_SCOPE", shotIds: ["S01"] };
  const referenceBinding = { shotId: "S01", order: 1, assetId: "ref", mediaRootRelativePath: "references/ref.png",
    canonicalAbsolutePath: join(SYNTHETIC_MEDIA, "references/ref.png"), sha256: digest("c"), bytes: 1, contentType: "image/png",
    shotApprovalStatus: "APPROVED", approvedAssetIds: ["ref"] };
  const inputBinding = { bindingVersion: "1.0", episodeId: EPISODE, scope, orderedTargets: [target],
    fileBindings: [{ role: "MANIFEST", canonicalPath: join(SYNTHETIC_MEDIA, "repo/episodes/EP02/episode.json"), exists: true,
      rawSha256: digest("f"), bytes: 1 }],
    referenceBindings: [referenceBinding],
    runtimeIdentity: { reviewedRevision: "a".repeat(40), repositoryRoot: join(SYNTHETIC_MEDIA, "repo"), mediaRoot: SYNTHETIC_MEDIA,
      physicalMediaRoot: SYNTHETIC_MEDIA, executableInputs: [{ role: "RUNTIME", canonicalPath: join(SYNTHETIC_MEDIA, "repo/runtime.txt"),
        exists: true, rawSha256: digest("e"), bytes: 1 }], ffprobe: null } };
  const submitted = { reservationId: "00000000-0000-4000-8000-000000000001", durableProvider: "RUNWAY", reservationSha256: digest("1"),
    submissionSha256: digest("2"), providerExecutionIdentitySha256: digest("3") };
  const observation = { target, lifecycle: kind === "VISUAL_RECONCILE" ? "SUBMITTED" : "NOTHING",
    ...(kind === "VISUAL_RECONCILE" ? submitted : { reservationId: null, durableProvider: null, reservationSha256: null,
      submissionSha256: null, providerExecutionIdentitySha256: null }),
    completionSha256: null, generationRecordSha256: null, outputIdentitySha256: null };
  const action = kind === "VISUAL_RECONCILE"
    ? { ...target, kind, expectedLifecycle: "SUBMITTED", ...submitted, confirmReconciliation: true }
    : kind === "VISUAL_GENERATE"
      ? { ...target, kind, expectedLifecycle: "NOTHING", resolvedProvider: "RUNWAY", referenceBinding,
        costAuthority: { unit: "RUNWAY_CREDITS", modeledValue: 60, maxModeledValue: 60, policySha256: digest("9") }, confirmPaidGeneration: true }
      : { ...target, kind, attemptNumber: 2, expectedAttemptLifecycle: "ADMITTED_ONLY", resolvedProvider: "GOOGLE_GENAI", referenceBinding,
        costAuthority: { unit: "MICRO_USD", modeledValue: 1513600, maxModeledValue: 1513600, policySha256: digest("9") }, confirmPaidGeneration: true };
  return { schemaVersion: "2.0", mode: "CONTROLLED_VISUAL", episodeId: EPISODE, scope, inputBinding,
    inputBindingSha256: bindingDigest(inputBinding), observations: [observation], observationsSha256: bindingDigest([observation]),
    evidenceAdoptions: [], maximumNewProviderCreates: kind === "VISUAL_RECONCILE" ? 0 : 1,
    operatingCondition: { singleOperator: true, noConcurrentAuthoring: true, noUnguardedRunners: true },
    actions: [{ ...action, ...actionOverrides }] };
}

const STOPPED_RESULT = Object.freeze({ status: "STOPPED", stopReason: "SUBMITTED_RECOVERY_REQUIRED", dispatchAllowanceConsumed: 1,
  observedNewCreateCount: 1, recoveryDispatchCount: 0, afterPlan: null, visualCompletion: "INCOMPLETE" }) as unknown as BoundEpisodeActionResult;

function controlledHarness(plan: unknown) {
  const readPlanText = vi.fn(async (_path: string) => JSON.stringify(plan));
  // Probe for the existing runEpisodeAutomation: it alone mints the checked context.
  const runAutomation = vi.fn(async (_plan: unknown, _dependencies: unknown, _session?: FreshEpisodeOperatorSession) => STOPPED_RESULT);
  const buildPreflight = vi.fn(async (_input: Record<string, unknown>) => ({ completion: "INCOMPLETE", inventory: { complete: true } }));
  const readRuntimeIdentity = vi.fn(async () => { throw new Error("Runtime identity must not be read for a plan file."); });
  const writeStdout = vi.fn((_text: string) => undefined);
  const setExitCode = vi.fn((_code: 0 | 1) => undefined);
  return { readPlanText, runAutomation, buildPreflight, writeStdout, setExitCode,
    deps: { readPlanText, runAutomation, buildPreflight, readRuntimeIdentity, writeStdout, setExitCode } as unknown as RunEpisodeAutomationCliDependencies };
}

const LEGACY_PLAN_ONLY_KEYS = ["episodeId", "evidenceAdoptions", "expectedBinding", "mediaRoot", "runtimeIdentity", "scope"];

describe("B5 Slice-2I-B episode CLI carries a reviewed visual attempt", () => {
  const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

  beforeEach(() => {
    vi.mocked(coordinateEpisodeAction).mockClear();
    vi.mocked(runSingleShotExecutionCli).mockClear();
    vi.mocked(runProductionExecutionReconcileCli).mockClear();
    vi.mocked(loadEnvironment).mockClear();
    vi.mocked(acquireEpisodeExecutionGuard).mockClear();
    vi.mocked(createFreshEpisodeOperatorSession).mockClear();
    vi.mocked(createCheckedEpisodeExecutionContext).mockClear();
  });

  function expectNoLowerAuthority() {
    expect(acquireEpisodeExecutionGuard).not.toHaveBeenCalled();
    expect(createCheckedEpisodeExecutionContext).not.toHaveBeenCalled();
    expect(coordinateEpisodeAction).not.toHaveBeenCalled();
    expect(runSingleShotExecutionCli).not.toHaveBeenCalled();
    expect(runProductionExecutionReconcileCli).not.toHaveBeenCalled();
    expect(loadEnvironment).not.toHaveBeenCalled();
  }

  it("the synthetic fixtures are accepted by the real plan parser", () => {
    for (const kind of ["VISUAL_GENERATE", "VISUAL_RECONCILE", "VISUAL_ATTEMPT_GENERATE"] as const) {
      expect(parseEpisodeAutomationPlan(controlledPlan(kind)).actions[0]!.kind).toBe(kind);
    }
  });

  it("A. an attempt plan runs once through runEpisodeAutomation on a fresh GENERATION session", async () => {
    const plan = controlledPlan("VISUAL_ATTEMPT_GENERATE");
    const h = controlledHarness(plan);
    await runEpisodeAutomationCli(["--plan", "p.json", "--confirm-paid-generation"], h.deps);

    expect(h.runAutomation).toHaveBeenCalledTimes(1);
    const [passed, lowerDependencies, session] = h.runAutomation.mock.calls[0]!;
    expect(passed).toEqual(parseEpisodeAutomationPlan(plan));
    expect(lowerDependencies).toBeUndefined();
    expect(session).toMatchObject({ confirmation: "GENERATION" });
    expect(createFreshEpisodeOperatorSession).toHaveBeenCalledTimes(1);
    expect(createFreshEpisodeOperatorSession).toHaveBeenCalledWith("GENERATION", true);
    // The session is genuine, single-use and GENERATION only.
    expect(() => consumeFreshEpisodeOperatorSession(session, "RECONCILIATION")).toThrow(BoundEpisodeError);
    expect(() => consumeFreshEpisodeOperatorSession(session, "GENERATION")).not.toThrow();
    expect(() => consumeFreshEpisodeOperatorSession(session, "GENERATION")).toThrow(BoundEpisodeError);
    // The CLI neither preflights nor mints a checked context for execution; runEpisodeAutomation does.
    expect(h.buildPreflight).not.toHaveBeenCalled();
    expectNoLowerAuthority();
    expect(h.setExitCode).toHaveBeenCalledWith(1);
  });

  it.each([[["--confirm-reconciliation"]], [[]]])("B. an attempt plan with %j fails closed before any session or automation", async (extra) => {
    const h = controlledHarness(controlledPlan("VISUAL_ATTEMPT_GENERATE"));
    await expect(runEpisodeAutomationCli(["--plan", "p.json", ...extra], h.deps))
      .rejects.toMatchObject({ name: "BoundEpisodeError", code: "OPERATING_CONDITION_UNESTABLISHED" });
    expect(h.runAutomation).not.toHaveBeenCalled();
    expect(h.buildPreflight).not.toHaveBeenCalled();
    expect(h.writeStdout).not.toHaveBeenCalled();
    expect(createFreshEpisodeOperatorSession).not.toHaveBeenCalled();
    expectNoLowerAuthority();
  });

  it.each([
    ["VISUAL_GENERATE", "--confirm-paid-generation", "GENERATION", "--confirm-reconciliation"],
    ["VISUAL_RECONCILE", "--confirm-reconciliation", "RECONCILIATION", "--confirm-paid-generation"],
  ] as const)("C/D. legacy %s keeps %s -> %s and refuses %s", async (kind, flag, family, wrong) => {
    const refused = controlledHarness(controlledPlan(kind));
    await expect(runEpisodeAutomationCli(["--plan", "p.json", wrong], refused.deps))
      .rejects.toMatchObject({ code: "OPERATING_CONDITION_UNESTABLISHED" });
    expect(refused.runAutomation).not.toHaveBeenCalled();

    const h = controlledHarness(controlledPlan(kind));
    await runEpisodeAutomationCli(["--plan", "p.json", flag], h.deps);
    expect(h.runAutomation).toHaveBeenCalledTimes(1);
    expect(h.runAutomation.mock.calls[0]![2]).toMatchObject({ confirmation: family });
    expect(createFreshEpisodeOperatorSession).toHaveBeenCalledTimes(1);
    expect(createFreshEpisodeOperatorSession).toHaveBeenCalledWith(family, true);
    expect(h.buildPreflight).not.toHaveBeenCalled();
  });

  it.each([2, 3, 7])("E. plan-only attempt %i preflights exactly the frozen { shotId, attemptNumber }", async (attemptNumber) => {
    const plan = controlledPlan("VISUAL_ATTEMPT_GENERATE", { attemptNumber });
    const h = controlledHarness(plan);
    await runEpisodeAutomationCli(["--plan", "p.json", "--plan-only", "--json"], h.deps);

    expect(h.buildPreflight).toHaveBeenCalledTimes(1);
    const [input] = h.buildPreflight.mock.calls[0]!;
    expect(input.visualAttemptSelection).toStrictEqual({ shotId: "S01", attemptNumber });
    expect(Object.keys(input).sort()).toEqual([...LEGACY_PLAN_ONLY_KEYS, "visualAttemptSelection"].sort());
    expect(input).toMatchObject({ episodeId: EPISODE, scope: plan.scope, mediaRoot: SYNTHETIC_MEDIA,
      expectedBinding: plan.inputBinding, runtimeIdentity: plan.inputBinding.runtimeIdentity, evidenceAdoptions: [] });
    expect(JSON.parse(h.writeStdout.mock.calls[0]![0])).toEqual({ completion: "INCOMPLETE", inventory: { complete: true } });
    expect(h.setExitCode).toHaveBeenCalledWith(1);
  });

  it.each(["VISUAL_GENERATE", "VISUAL_RECONCILE"] as const)("E. legacy %s plan-only preflight is unchanged and carries no attempt selection", async (kind) => {
    const plan = controlledPlan(kind);
    const h = controlledHarness(plan);
    await runEpisodeAutomationCli(["--plan", "p.json", "--plan-only", "--json"], h.deps);
    const [input] = h.buildPreflight.mock.calls[0]!;
    expect(Object.keys(input).sort()).toEqual(LEGACY_PLAN_ONLY_KEYS);
    expect("visualAttemptSelection" in input).toBe(false);
    expect(input).toMatchObject({ expectedBinding: plan.inputBinding, mediaRoot: SYNTHETIC_MEDIA });
  });

  it("F. plan-only attempt is read-only: no session, guard, checked context, coordinator, runner, environment or network", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real network tripwire."));
    const h = controlledHarness(controlledPlan("VISUAL_ATTEMPT_GENERATE"));
    await runEpisodeAutomationCli(["--plan", "p.json", "--plan-only"], h.deps);
    expect(h.readPlanText).toHaveBeenCalledTimes(1);
    expect(h.buildPreflight).toHaveBeenCalledTimes(1);
    expect(h.runAutomation).not.toHaveBeenCalled();
    expect(createFreshEpisodeOperatorSession).not.toHaveBeenCalled();
    expectNoLowerAuthority();
    expect(network).not.toHaveBeenCalled();
    expect(() => parseEpisodeAutomationCliArgs(["--plan", "p.json", "--plan-only", "--confirm-paid-generation"])).toThrow(/Plan-only accepts no confirmation/);
  });

  it.each([
    [["--plan", "a.json", "--attempt", "2"]],
    [["--plan", "a.json", "--confirm-paid-generation", "--attempt", "2"]],
    [["--plan", "a.json", "--plan-only", "--attempt", "2"]],
    [["--plan", "a.json", "--attempt=2"]],
    [["--episode", "EP02", "--plan-only", "--attempt", "2"]],
  ])("G. the episode CLI accepts no attempt argument: %j", async (args) => {
    expect(() => parseEpisodeAutomationCliArgs(args)).toThrow(/Unknown episode automation CLI argument: --attempt/);
    const h = controlledHarness(controlledPlan("VISUAL_ATTEMPT_GENERATE"));
    await expect(runEpisodeAutomationCli(args, h.deps)).rejects.toThrow(/--attempt/);
    expect(h.readPlanText).not.toHaveBeenCalled();
    expect(h.buildPreflight).not.toHaveBeenCalled();
    expect(h.runAutomation).not.toHaveBeenCalled();
  });

  it("G. the CLI derives the attempt only from the frozen action: no argument, environment, scan or increment", async () => {
    const options = parseEpisodeAutomationCliArgs(["--plan", "a.json", "--confirm-paid-generation"]);
    expect(Object.keys(options).some(key => /attempt/i.test(key))).toBe(false);
    expect(await read("src/execution/cli/episodeAutomationCliArgs.ts")).not.toMatch(/attempt/i);
    const code = (await read("src/execution/cli/runEpisodeAutomationCli.ts")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/--attempt|process\.env\.\w*ATTEMPT|readdir|opendir|attemptNumber\s*[+-]|options\.attempt/i);
    expect(code.match(/visualAttemptSelection/g)).toHaveLength(1);
    expect(code).toMatch(/\{\s*visualAttemptSelection:\s*\{\s*shotId:\s*action\.shotId,\s*attemptNumber:\s*action\.attemptNumber,?\s*\},?\s*\}/);
  });

  it.each([
    ["attempt 1", { attemptNumber: 1 }],
    ["attempt 0", { attemptNumber: 0 }],
    ["a negative attempt", { attemptNumber: -2 }],
    ["a fractional attempt", { attemptNumber: 2.5 }],
    ["a string attempt", { attemptNumber: "2" }],
    ["an unsafe attempt", { attemptNumber: Number.MAX_SAFE_INTEGER + 1 }],
    ["a missing attempt", { attemptNumber: undefined }],
    ["a non-admitted lifecycle", { expectedAttemptLifecycle: "SUBMITTED" }],
    ["a non-Google provider", { resolvedProvider: "RUNWAY" }],
    ["no paid confirmation", { confirmPaidGeneration: false }],
    ["a smuggled second attempt field", { attempt: 3 }],
    ["an out-of-scope shot", { shotId: "S02" }],
    ["a mismatched scene", { sceneId: "SC02" }],
  ])("H. %s fails through the existing plan authority before preflight, session or automation", async (_label, overrides) => {
    for (const mode of [["--confirm-paid-generation"], ["--plan-only"]]) {
      const h = controlledHarness(controlledPlan("VISUAL_ATTEMPT_GENERATE", overrides));
      await expect(runEpisodeAutomationCli(["--plan", "p.json", ...mode], h.deps))
        .rejects.toThrow(/Episode automation plan is invalid|Controlled episode operation stopped \(INPUT_BINDING_DRIFT\)/);
      expect(h.readPlanText).toHaveBeenCalledTimes(1);
      expect(h.buildPreflight).not.toHaveBeenCalled();
      expect(h.runAutomation).not.toHaveBeenCalled();
      expect(h.writeStdout).not.toHaveBeenCalled();
    }
    expect(createFreshEpisodeOperatorSession).not.toHaveBeenCalled();
    expectNoLowerAuthority();
  });

  it("I/J. the thin script and the package entrypoint are unchanged", async () => {
    expect((await read("scripts/episode-automation.ts")).replace(/\r\n/g, "\n").trimEnd()).toBe([
      "import {",
      "  formatEpisodeAutomationCliError,",
      "  runEpisodeAutomationCli,",
      "} from \"../src/execution/cli/runEpisodeAutomationCli.js\";",
      "",
      "runEpisodeAutomationCli().catch(",
      "  (error: unknown) => {",
      "    console.error(",
      "      formatEpisodeAutomationCliError(",
      "        error,",
      "      ),",
      "    );",
      "",
      "    process.exitCode = 1;",
      "  },",
      ");",
    ].join("\n"));
    const pkg = JSON.parse(await read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["episode:automate"]).toBe("tsx scripts/episode-automation.ts");
    expect(Object.entries(pkg.scripts).filter(([name, command]) => /attempt/i.test(name) || /attempt/i.test(command))).toEqual([]);
  });

  it("K. runEpisodeAutomationCli holds no provider, attempt-writer, runner, routing or checked-context authority", async () => {
    const code = (await read("src/execution/cli/runEpisodeAutomationCli.ts")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(new RegExp(["executeGoogleGenAiVisualAttemptSingleShot", "executeGoogleGenAiOperatorSingleShot",
      "submitGoogleGenAiSingleShot", "FromReservationIdentity", "createVisualAttemptExecution(?:Reservation|Submission|Completion)",
      "createVisualAttemptGenerationRecord", "createVisualAttemptAdmission", "ProviderExecutionId", "executeProductionVisualAttemptSingleShot",
      "createProductionSingleShotExecutionDependencies", "runSingleShotExecutionCli", "runProductionExecutionReconcileCli",
      "createCheckedEpisodeExecutionContext", "acquireEpisodeExecutionGuard", "coordinateEpisodeAction\\s*\\(", "@google\\/genai",
      "GoogleGenAi", "GOOGLE_GENAI", "GEMINI", "ProviderRouting", "evaluateShotProvider"].join("|")));
    const specifiers = [...new Set([...code.matchAll(/(?:from\s+|import\s*\(\s*)"([^"]+)"/g)].map(match => match[1]))].sort();
    expect(specifiers).toEqual(["node:fs", "node:fs/promises", "node:path", "../coordinateEpisodeAction.js", "../episodeAutomationPlan.schema.js",
      "../runEpisodeAutomation.js", "../boundEpisodeProduction.types.js", "../buildBoundEpisodePreflight.js", "../episodeInputBinding.js",
      "../episodeExecutionGuard.js", "./episodeAutomationCliArgs.js"].sort());
    // Coordinator and guard are type-only statically; the lazy guard import mints only a fresh session.
    expect(code).toMatch(/import type \{\s*EpisodeCoordinatorAction,\s*\} from "\.\.\/coordinateEpisodeAction\.js";/);
    expect(code).toMatch(/import type \{ FreshEpisodeOperatorSession \} from "\.\.\/episodeExecutionGuard\.js";/);
    expect(code.match(/\(await import\("[^"]+"\)\)\.\w+/g)).toEqual([
      "(await import(\"../runEpisodeAutomation.js\")).runEpisodeAutomation",
      "(await import(\"../episodeExecutionGuard.js\")).createFreshEpisodeOperatorSession",
    ]);
    expect(code.match(/\.runAutomation\(/g)).toHaveLength(1);
  });
});
