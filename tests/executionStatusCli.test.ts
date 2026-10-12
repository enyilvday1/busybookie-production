import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  DurableShotDialogueCompositionState,
} from "../src/dialogue/resolveDurableShotDialogueCompositionState.js";

import {
  parseExecutionStatusCliArgs,
} from "../src/execution/cli/executionStatusCliArgs.js";

import {
  runExecutionStatusCli,
  type RunExecutionStatusCliDependencies,
} from "../src/execution/cli/runExecutionStatusCli.js";

import {
  resolveDurableEpisodeProductionState,
  type DurableEpisodeProductionState,
} from "../src/execution/resolveDurableEpisodeProductionState.js";

import type {
  DurableShotVisualGenerationState,
} from "../src/execution/resolveDurableShotVisualGenerationState.js";

import type {
  Environment,
} from "../src/schemas/environment.schema.js";

import {
  loadCharacterBible,
} from "../src/validation/loadCharacterBible.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

import {
  loadProductionRules,
} from "../src/validation/loadProductionRules.js";

import {
  loadProviderRoutingPolicy,
} from "../src/validation/loadProviderRoutingPolicy.js";

// Pass-through spy so the script wrapper can be exercised without a real run.
vi.mock("../src/execution/cli/runExecutionStatusCli.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/cli/runExecutionStatusCli.js")>();
  return { ...actual, runExecutionStatusCli: vi.fn(actual.runExecutionStatusCli) };
});

const runnerSpy = vi.mocked(runExecutionStatusCli);

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const DIALOGUE_KEY_ORDER = [
  "NO_DIALOGUE",
  "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED",
  "DIALOGUE_PLANNING_BLOCKED",
  "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED",
  "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED",
  "DIALOGUE_RECONCILIATION_REQUIRED",
  "DIALOGUE_AUDIO_REQUIRED",
  "PLACEMENT_REQUIRED",
  "COMPOSITION_AUDIO_RESOLVED",
] as const;

function environment(mediaRoot = "Z:/controlled-media-root", ffprobe?: string): Environment {
  return Object.freeze({
    BUSYBOOKIE_MEDIA_ROOT: mediaRoot,
    ...(ffprobe === undefined ? {} : { BUSYBOOKIE_FFPROBE_PATH: ffprobe }),
  }) as Environment;
}

function reportWith(dialogueState: DurableShotDialogueCompositionState["state"], visualState: DurableShotVisualGenerationState["state"] = "CANONICAL_NOT_EXECUTABLE"): DurableEpisodeProductionState {
  const counts = Object.fromEntries(DIALOGUE_KEY_ORDER.map((key) => [key, key === dialogueState ? 1 : 0]));
  return Object.freeze({
    episodeId: "EP02",
    shots: [
      {
        order: 1,
        sceneId: "SC01",
        shotId: "S02",
        visualGenerationState: { state: visualState, episodeId: "EP02", shotId: "S02" },
        dialogueCompositionState: { state: dialogueState, episodeId: "EP02", sceneId: "SC01", shotId: "S02" },
      },
    ],
    summary: { totalShots: 1, visualGenerationStates: { [visualState]: 1 }, dialogueCompositionStates: counts },
  }) as unknown as DurableEpisodeProductionState;
}

function seams(report: DurableEpisodeProductionState = reportWith("NO_DIALOGUE")) {
  const writes: string[] = [];
  const order: string[] = [];
  const loadEnvironment = vi.fn<RunExecutionStatusCliDependencies["loadEnvironment"]>(() => {
    order.push("loadEnvironment");
    return environment();
  });
  const loadProductionRulesSpy = vi.fn<typeof loadProductionRules>(async () => {
    order.push("loadProductionRules");
    return loadProductionRules();
  });
  const loadCharacterBibleSpy = vi.fn<typeof loadCharacterBible>(async () => {
    order.push("loadCharacterBible");
    return loadCharacterBible();
  });
  const loadEpisodeManifestSpy = vi.fn<typeof loadEpisodeManifest>(async (episodeId) => {
    order.push(`loadEpisodeManifest:${episodeId}`);
    return loadEpisodeManifest(episodeId);
  });
  const loadProviderRoutingPolicySpy = vi.fn<typeof loadProviderRoutingPolicy>(async () => {
    order.push("loadProviderRoutingPolicy");
    return loadProviderRoutingPolicy();
  });
  const resolveMediaRoot = vi.fn<RunExecutionStatusCliDependencies["resolveMediaRoot"]>((env) => {
    order.push("resolveMediaRoot");
    return env.BUSYBOOKIE_MEDIA_ROOT;
  });
  const resolveEpisodeProductionState = vi.fn<typeof resolveDurableEpisodeProductionState>(async () => {
    order.push("resolveEpisodeProductionState");
    return report;
  });
  const writeStdout = vi.fn((text: string) => {
    order.push("writeStdout");
    writes.push(text);
  });
  const dependencies: RunExecutionStatusCliDependencies = {
    loadEnvironment,
    loadProductionRules: loadProductionRulesSpy,
    loadCharacterBible: loadCharacterBibleSpy,
    loadEpisodeManifest: loadEpisodeManifestSpy,
    loadProviderRoutingPolicy: loadProviderRoutingPolicySpy,
    resolveMediaRoot,
    resolveEpisodeProductionState,
    writeStdout,
  };
  return {
    dependencies,
    writes,
    order,
    loadEnvironment,
    loadEpisodeManifest: loadEpisodeManifestSpy,
    resolveMediaRoot,
    resolveEpisodeProductionState,
    writeStdout,
  };
}

describe("execution:status argument parser", () => {
  it("A parses a valid --episode", () => {
    expect(parseExecutionStatusCliArgs(["--episode", "EP02"])).toEqual({ episodeId: "EP02" });
    expect(Object.isFrozen(parseExecutionStatusCliArgs(["--episode", "EP02"]))).toBe(true);
  });

  it.each([
    ["B missing --episode", [], "--episode is required."],
    ["C missing value", ["--episode"], "--episode requires a value."],
    ["C flag as value", ["--episode", "--other"], "--episode requires a value."],
    ["D duplicate --episode", ["--episode", "EP02", "--episode", "EP02"], "Duplicate execution status CLI argument: --episode"],
    ["E unknown argument", ["--episode", "EP02", "--confirm-paid-generation"], "Unknown execution status CLI argument: --confirm-paid-generation"],
    ["F positional argument", ["EP02"], "Unknown execution status CLI argument: EP02"],
  ] as const)("%s is rejected", (_label, args, message) => {
    expect(() => parseExecutionStatusCliArgs(args)).toThrow(message);
  });

  it.each(["../EP02", "EP2", "ep02", "EP02/../x"])("G invalid episode id %s is rejected by the canonical schema", (episodeId) => {
    expect(() => parseExecutionStatusCliArgs(["--episode", episodeId])).toThrow(/episodeId must use the Busybookie EP## or EP### format/);
  });
});

describe("execution:status runner", () => {
  it("G invalid episode id fails before environment, loaders or path construction", async () => {
    const controlled = seams();

    await expect(runExecutionStatusCli(["--episode", "../EP02"], controlled.dependencies)).rejects.toThrow();
    expect(controlled.order).toEqual([]);
  });

  it("H/I/K/L/M canonical loaders, read-only media-root resolver, evaluator once, then exactly one JSON write", async () => {
    const report = reportWith("DIALOGUE_AUDIO_REQUIRED");
    const controlled = seams(report);

    await runExecutionStatusCli(["--episode", "EP02"], controlled.dependencies);

    expect(controlled.loadEpisodeManifest).toHaveBeenCalledExactlyOnceWith("EP02");
    expect(controlled.resolveMediaRoot).toHaveBeenCalledTimes(1);
    const [env, rules] = controlled.resolveMediaRoot.mock.calls[0]!;
    expect(env).toEqual(environment());
    expect(rules).toEqual(await loadProductionRules());
    expect(controlled.resolveEpisodeProductionState).toHaveBeenCalledTimes(1);
    const [evaluatorInput] = controlled.resolveEpisodeProductionState.mock.calls[0]!;
    expect(evaluatorInput).toEqual({
      episode: await loadEpisodeManifest("EP02"),
      bible: await loadCharacterBible(),
      rules: await loadProductionRules(),
      policy: await loadProviderRoutingPolicy(),
      mediaRoot: "Z:/controlled-media-root",
      ffprobeExecutable: "ffprobe",
    });
    expect(controlled.writes).toEqual([`${JSON.stringify(report, null, 2)}\n`]);
    expect(controlled.order.at(-1)).toBe("writeStdout");
    expect(controlled.order.indexOf("writeStdout")).toBe(controlled.order.length - 1);
    expect(controlled.order.filter((entry) => entry === "writeStdout")).toHaveLength(1);
  });

  it("uses BUSYBOOKIE_FFPROBE_PATH when configured", async () => {
    const controlled = seams();
    controlled.loadEnvironment.mockReturnValue(environment("Z:/controlled-media-root", "  C:/tools/ffprobe.exe  "));

    await runExecutionStatusCli(["--episode", "EP02"], controlled.dependencies);

    expect(controlled.resolveEpisodeProductionState.mock.calls[0]![0].ffprobeExecutable).toBe("C:/tools/ffprobe.exe");
  });

  it.each([
    ["N DIALOGUE_PLANNING_BLOCKED", "DIALOGUE_PLANNING_BLOCKED", "CANONICAL_NOT_EXECUTABLE"],
    ["O DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED", "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED", "CANONICAL_NOT_EXECUTABLE"],
    ["P stale-plan intervention", "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED", "RESERVED_ONLY_INTERVENTION_REQUIRED"],
    ["P reconciliation", "DIALOGUE_RECONCILIATION_REQUIRED", "SUBMITTED_RECONCILIATION_REQUIRED"],
    ["P visual authorization", "PLACEMENT_REQUIRED", "VISUAL_AUTHORIZATION_REQUIRED"],
  ] as const)("%s report resolves (exit 0) with the JSON report", async (_label, dialogueState, visualState) => {
    const report = reportWith(dialogueState, visualState);
    const controlled = seams(report);

    await expect(runExecutionStatusCli(["--episode", "EP02"], controlled.dependencies)).resolves.toBeUndefined();

    expect(controlled.writes).toEqual([`${JSON.stringify(report, null, 2)}\n`]);
    expect(JSON.parse(controlled.writes[0]!).shots[0].dialogueCompositionState.state).toBe(dialogueState);
  });

  it.each([
    ["Q evaluator", (c: ReturnType<typeof seams>, failure: Error) => c.resolveEpisodeProductionState.mockRejectedValue(failure)],
    ["R loader", (c: ReturnType<typeof seams>, failure: Error) => c.loadEpisodeManifest.mockRejectedValue(failure)],
    ["S read-only media-root resolver", (c: ReturnType<typeof seams>, failure: Error) => c.resolveMediaRoot.mockImplementation(() => { throw failure; })],
  ] as const)("%s failure rejects and writes nothing to stdout", async (_label, arrange, ) => {
    const controlled = seams();
    const failure = new Error("controlled hard failure");
    arrange(controlled, failure);

    await expect(runExecutionStatusCli(["--episode", "EP02"], controlled.dependencies)).rejects.toBe(failure);
    expect(controlled.writeStdout).not.toHaveBeenCalled();
  });

  it("episode identity mismatch rejects without output", async () => {
    const controlled = seams();
    controlled.loadEpisodeManifest.mockResolvedValue({ ...(await loadEpisodeManifest("EP02")), episodeId: "EP90" });

    await expect(runExecutionStatusCli(["--episode", "EP02"], controlled.dependencies)).rejects.toThrow(
      "Loaded episode identity does not match --episode.",
    );
    expect(controlled.writeStdout).not.toHaveBeenCalled();
  });

  it("T/V/W/Q real loaders + real evaluator on a temp media root: deterministic JSON, nine dialogue keys in order, no files written", async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), "busybookie-execution-status-"));
    roots.push(mediaRoot);
    const run = async () => {
      const controlled = seams();
      controlled.loadEnvironment.mockReturnValue(environment(mediaRoot));
      await runExecutionStatusCli(["--episode", "EP02"], {
        ...controlled.dependencies,
        resolveEpisodeProductionState: resolveDurableEpisodeProductionState,
      });
      return controlled.writes;
    };

    const first = await run();
    const second = await run();

    expect(first).toHaveLength(1);
    expect(first).toEqual(second);
    expect(first[0]!.endsWith("}\n")).toBe(true);
    const parsed = JSON.parse(first[0]!) as DurableEpisodeProductionState;
    expect(Object.keys(parsed)).toEqual(["episodeId", "shots", "summary"]);
    expect(Object.keys(parsed.summary.dialogueCompositionStates)).toEqual(DIALOGUE_KEY_ORDER);
    expect(Object.keys(parsed.shots[0]!)).toEqual(["order", "sceneId", "shotId", "visualGenerationState", "dialogueCompositionState"]);
    expect(first[0]).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
    expect(await readdir(mediaRoot, { recursive: true })).toEqual([]);
  });
});

describe("execution:status source, wiring and boundaries", () => {
  it("I/J/U runner imports the read-only resolver, never validateMediaRoot, and nothing mutating", async () => {
    const source = await readFile(new URL("../src/execution/cli/runExecutionStatusCli.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)].map(
      (match) => `${match[2]}:${match[1]!.replace(/\s+/g, "")}`,
    );

    expect(imports).toEqual([
      "../../validation/loadCharacterBible.js:loadCharacterBible,",
      "../../validation/loadEnvironment.js:loadEnvironment,",
      "../../validation/loadEpisodeManifest.js:loadEpisodeManifest,",
      "../../validation/loadProductionRules.js:loadProductionRules,",
      "../../validation/loadProviderRoutingPolicy.js:loadProviderRoutingPolicy,",
      "../../validation/validateMediaRoot.js:resolveAndValidateMediaRootPath,",
      "../resolveDurableEpisodeProductionState.js:resolveDurableEpisodeProductionState,",
      "./executionStatusCliArgs.js:parseExecutionStatusCliArgs,",
    ]);
    // Comments may explain why validateMediaRoot is avoided; code may not use it.
    const code = source.replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/validateMediaRoot\b(?!\.js)/);
    expect(code).not.toMatch(
      /node:fs|writeFile|appendFile|mkdir|rename\(|unlink|copyFile|createWriteStream|create(Dialogue|Execution|Runway)\w*|reconcile\w*\(|confirm\w*|execute(SingleShot|Veo|Runway)|render\w*\(|spawn|execFile|fetch\(|console\.log/,
    );
    expect(code.match(/\.writeStdout\(/g)).toHaveLength(1);
  });

  it("parser module is pure (no fs, path or loader imports)", async () => {
    const source = await readFile(new URL("../src/execution/cli/executionStatusCliArgs.ts", import.meta.url), "utf8");

    expect([...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1])).toEqual(["../executionReservation.schema.js"]);
  });

  it("X script wrapper delegates only to the runner", async () => {
    const source = await readFile(new URL("../scripts/execution-status.ts", import.meta.url), "utf8");

    expect([...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1])).toEqual([
      "../src/execution/cli/runExecutionStatusCli.js",
    ]);
    expect(source).toMatch(/runExecutionStatusCli\(\)\.catch\(/);
  });

  it("L/N script wrapper: hard failure -> stderr message and exitCode 1, nothing on stdout", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    runnerSpy.mockImplementationOnce(async () => {
      throw new Error("controlled evaluator failure");
    });

    vi.resetModules();
    await import("../scripts/execution-status.js");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(process.exitCode).toBe(1);
    expect(stderr.mock.calls).toEqual([[""], ["Execution status failed: controlled evaluator failure"]]);
    expect(stdout).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("script wrapper: successful run leaves exitCode unset and writes nothing to stderr", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    runnerSpy.mockImplementationOnce(async () => undefined);

    vi.resetModules();
    await import("../scripts/execution-status.js");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(process.exitCode).toBeUndefined();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("Y package.json exposes execution:status through the existing tsx launcher convention", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["execution:status"]).toBe("tsx scripts/execution-status.ts");
    expect(packageJson.scripts["execution:plan"]).toBe("tsx scripts/execution-plan.ts");
    const keys = Object.keys(packageJson.scripts);
    expect(keys.indexOf("execution:status")).toBe(keys.indexOf("execution:reconcile") + 1);
  });
});
