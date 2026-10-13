import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pass-through spies on every lowercase function export, so formatting and
// parsing can be proven to touch no filesystem or child process.
const { spyFunctions } = vi.hoisted(() => ({
  spyFunctions: <T extends Record<string, unknown>>(actual: T): T =>
    Object.fromEntries(
      Object.entries(actual).map(([name, value]) => [
        name,
        typeof value === "function" && /^[a-z]/.test(name) ? vi.fn(value as (...args: never[]) => unknown) : value,
      ]),
    ) as T,
}));

vi.mock("node:fs", async (importOriginal) => spyFunctions(await importOriginal<typeof import("node:fs")>()));
vi.mock("node:fs/promises", async (importOriginal) =>
  spyFunctions(await importOriginal<typeof import("node:fs/promises")>()),
);
vi.mock("node:child_process", async (importOriginal) =>
  spyFunctions(await importOriginal<typeof import("node:child_process")>()),
);
// Pass-through spies so the thin script can be exercised without real work.
vi.mock("../src/composition/cli/runEpisodeRoughCutCli.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/composition/cli/runEpisodeRoughCutCli.js")>();
  return {
    ...actual,
    runEpisodeRoughCutCli: vi.fn(actual.runEpisodeRoughCutCli),
    formatEpisodeRoughCutCliError: vi.fn(actual.formatEpisodeRoughCutCliError),
  };
});

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";

import { parseEpisodeRoughCutCliArgs } from "../src/composition/cli/episodeRoughCutCliArgs.js";
import {
  EpisodeRoughCutCliOutputError,
  formatEpisodeRoughCutCliError,
  runEpisodeRoughCutCli,
  type RunEpisodeRoughCutCliDependencies,
} from "../src/composition/cli/runEpisodeRoughCutCli.js";
import type { ComposedEpisodeRoughCut } from "../src/composition/composeEpisodeRoughCut.js";
import type { RunProductionEpisodeRoughCutResult } from "../src/composition/runProductionEpisodeRoughCut.js";

const MEDIA_ROOT = "D:/Busybookie/Production";
const RENDER_KEY = "a".repeat(64);
const OUTPUT_PATH = `${MEDIA_ROOT}/exports/EP02/rough-cut/EP02_rough-cut_${RENDER_KEY}.mp4`;
const RECORD_PATH = `${MEDIA_ROOT}/exports/EP02/rough-cut/EP02_rough-cut_${RENDER_KEY}.composition-rough-cut.json`;
const FORBIDDEN_WORDING =
  /\b(complete|completed|completion|final|finalized|master|publish|published|publish-ready|ready|delivery|delivered|release|released)\b/i;
const GENERIC_HEADER = "Episode rough-cut operation failed.";
const GENERIC_FOOTER = [
  "Derived local artifacts (normalization caches, rough-cut media, render records) may exist from this attempt; nothing was rolled back.",
  "No retry, recovery or reconciliation was attempted. Inspect the reported condition before invoking again.",
];
const FALLBACK =
  "Episode rough-cut operation failed. The failure could not be described safely; nothing was rolled back.\n";

function result(renderStatus: "HIT" | "MATERIALIZED"): RunProductionEpisodeRoughCutResult {
  return Object.freeze({
    episodeId: "EP02",
    roughCut: Object.freeze({
      preparedComposition: Object.freeze({}),
      renderPlan: Object.freeze({ renderKey: RENDER_KEY, outputPath: OUTPUT_PATH }),
      renderStatus,
      artifact: Object.freeze({
        outputPath: OUTPUT_PATH,
        bytes: 1234,
        sha256: "b".repeat(64),
        contentType: "video/mp4",
        durationSeconds: 11,
        durationToleranceSeconds: 1 / 25,
      }),
    }) as unknown as ComposedEpisodeRoughCut,
    renderRecordPath: RECORD_PATH,
  });
}

function harness(roughCutResult: RunProductionEpisodeRoughCutResult = result("MATERIALIZED")) {
  const runComposition = vi.fn(async () => roughCutResult);
  const writeStdout = vi.fn((_text: string) => undefined);
  const deps = { runComposition, writeStdout } as unknown as RunEpisodeRoughCutCliDependencies;
  return { runComposition, writeStdout, deps };
}

function generic(...lines: string[]): string {
  return [GENERIC_HEADER, ...lines, ...GENERIC_FOOTER].join("\n") + "\n";
}

function spiedModuleFunctions() {
  return [fs, fsPromises, childProcess].flatMap((module) =>
    Object.values(module).filter((value) => vi.isMockFunction(value)),
  ) as ReturnType<typeof vi.fn>[];
}

const VALID_ARGS = ["--episode", "EP02", "--confirm-local-composition"];

describe("C8 CLI K argument parser", () => {
  it("accepts exactly --episode <id> and --confirm-local-composition in either order", () => {
    for (const args of [VALID_ARGS, ["--confirm-local-composition", "--episode", "EP02"]]) {
      const options = parseEpisodeRoughCutCliArgs(args);
      expect(options).toEqual({ episodeId: "EP02", confirmLocalComposition: true });
      expect(Object.isFrozen(options)).toBe(true);
    }
    expect(parseEpisodeRoughCutCliArgs(["--episode", " EP123 ", "--confirm-local-composition"]).episodeId).toBe(
      "EP123",
    );
  });

  it.each([
    [[], "--episode is required."],
    [["--confirm-local-composition"], "--episode is required."],
    [["--episode", "EP02"], "--confirm-local-composition is required: the rough-cut operation performs local normalization and rendering."],
    [["--episode"], "--episode requires an episode ID."],
    [["--episode", "--confirm-local-composition"], "--episode requires an episode ID."],
    [["--episode", "   ", "--confirm-local-composition"], "--episode requires an episode ID."],
    [["--episode", "EP2", "--confirm-local-composition"], "--episode requires a canonical episode ID (EP## or EP###)."],
    [["--episode", "ep02", "--confirm-local-composition"], "--episode requires a canonical episode ID (EP## or EP###)."],
    [["--episode", "../EP02", "--confirm-local-composition"], "--episode requires a canonical episode ID (EP## or EP###)."],
    [["--episode", "EP02", "--episode", "EP02", "--confirm-local-composition"], "Duplicate episode rough-cut CLI argument: --episode"],
    [[...VALID_ARGS, "--confirm-local-composition"], "Duplicate episode rough-cut CLI argument: --confirm-local-composition"],
    [["--episode=EP02", "--confirm-local-composition"], "Episode rough-cut CLI arguments do not accept --flag=value forms: --episode"],
    [["--episode", "EP02", "--confirm-local-composition=true"], "Episode rough-cut CLI arguments do not accept --flag=value forms: --confirm-local-composition"],
    [[...VALID_ARGS, "true"], "Unexpected positional episode rough-cut CLI argument."],
    [["EP02", "--confirm-local-composition"], "Unexpected positional episode rough-cut CLI argument."],
  ])("rejects %j", (args, message) => {
    expect(() => parseEpisodeRoughCutCliArgs(args)).toThrow(message);
  });

  it.each([
    "--plan",
    "--shot",
    "--line",
    "--output",
    "--media-root",
    "--ffmpeg",
    "--ffprobe",
    "--force",
    "--overwrite",
    "--retry",
    "--resume",
    "--validate-only",
    "--dry-run",
    "--confirm-paid-generation",
    "--confirm-reconciliation",
    "--publish",
    "--deliver",
    "-",
  ])("rejects the unsupported flag %s", (flag) => {
    expect(() => parseEpisodeRoughCutCliArgs([...VALID_ARGS, flag])).toThrow(
      `Unknown episode rough-cut CLI argument: ${flag}`,
    );
  });

  it("never echoes a rejected episode value", () => {
    expect(() => parseEpisodeRoughCutCliArgs(["--episode", "../secret-path", "--confirm-local-composition"])).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("secret-path") }),
    );
  });
});

describe("C8 CLI L runner and success output", () => {
  it("argv failures happen before the rough-cut operation and print nothing", async () => {
    const { runComposition, writeStdout, deps } = harness();
    await expect(runEpisodeRoughCutCli(["--episode", "EP02"], deps)).rejects.toThrow(
      "--confirm-local-composition is required",
    );
    expect(runComposition).not.toHaveBeenCalled();
    expect(writeStdout).not.toHaveBeenCalled();
  });

  it.each([
    ["MATERIALIZED", "Episode rough cut rendered and recorded."],
    ["HIT", "Existing episode rough cut verified and reused."],
  ] as const)("%s: one operation call, then one fixed-shape rough-cut JSON report", async (renderStatus, summary) => {
    const { runComposition, writeStdout, deps } = harness(result(renderStatus));
    await runEpisodeRoughCutCli(VALID_ARGS, deps);
    expect(runComposition.mock.calls).toEqual([[{ episodeId: "EP02", confirmLocalComposition: true }]]);
    expect(writeStdout).toHaveBeenCalledTimes(1);
    const text = writeStdout.mock.calls[0]![0];
    expect(text).toBe(
      `${JSON.stringify(
        {
          episodeId: "EP02",
          artifactKind: "ROUGH_CUT",
          summary,
          renderStatus,
          renderKey: RENDER_KEY,
          outputPath: OUTPUT_PATH,
          renderRecordPath: RECORD_PATH,
          bytes: 1234,
          sha256: "b".repeat(64),
          durationSeconds: 11,
        },
        null,
        2,
      )}\n`,
    );
    expect(text).toMatch(/rough cut/);
    expect(text).not.toMatch(FORBIDDEN_WORDING);
  });
});

describe("C8 CLI M rejection and reporting failure", () => {
  it("an operation rejection propagates unchanged with no report", async () => {
    const { runComposition, writeStdout, deps } = harness();
    const refusal = new Error("Episode rough-cut render is orphaned: artifact exists without a durable render record.");
    runComposition.mockRejectedValueOnce(refusal);
    await expect(runEpisodeRoughCutCli(VALID_ARGS, deps)).rejects.toBe(refusal);
    expect(runComposition).toHaveBeenCalledTimes(1);
    expect(writeStdout).not.toHaveBeenCalled();
  });

  it("a stdout failure after a returned result is a typed reporting failure carrying roughCutResult; no second call", async () => {
    const roughCutResult = result("HIT");
    const { runComposition, writeStdout, deps } = harness(roughCutResult);
    const stdoutFailure = new Error("stdout closed");
    writeStdout.mockImplementationOnce(() => {
      throw stdoutFailure;
    });
    const error = (await runEpisodeRoughCutCli(VALID_ARGS, deps).catch((caught: unknown) => caught)) as
      EpisodeRoughCutCliOutputError;
    expect(error).toBeInstanceOf(EpisodeRoughCutCliOutputError);
    expect(error.name).toBe("EpisodeRoughCutCliOutputError");
    expect(error.roughCutResult).toBe(roughCutResult);
    expect(error.cause).toBe(stdoutFailure);
    expect(error.message).toBe(
      "Episode rough-cut operation returned, but CLI reporting failed. Inspect the reported rough-cut artifact and render record before invoking again.",
    );
    expect(Object.getOwnPropertyNames(error)).not.toContain("compositionCompleted");
    expect(Object.getOwnPropertyNames(error)).not.toContain("result");
    expect(runComposition).toHaveBeenCalledTimes(1);
  });
});

describe("C8 CLI formatter A-D useful, distinguishable reasons", () => {
  const ADMISSION = "Composition admission requires COMPLETED lifecycle for EP02/S03; received SUBMITTED.";
  const STALE =
    "Durable dialogue placement decision revision 2 for EP02/SC01/S02 is stale: dialoguePlanKey x does not match current canonical plan key y.";
  const ORPHAN = "Episode rough-cut render is orphaned: artifact exists without a durable render record.";

  it("A a C5 admission refusal appears verbatim", () => {
    expect(formatEpisodeRoughCutCliError(new Error(ADMISSION))).toBe(generic(`Reason: ${ADMISSION}`));
  });

  it("B an orphan intervention reason appears verbatim", () => {
    expect(formatEpisodeRoughCutCliError(new Error(ORPHAN))).toBe(generic(`Reason: ${ORPHAN}`));
  });

  it("C different refusals differ only in their Reason lines", () => {
    const outputs = [ADMISSION, STALE, ORPHAN].map((message) => formatEpisodeRoughCutCliError(new Error(message)));
    expect(new Set(outputs).size).toBe(3);
    for (const output of outputs) {
      const lines = output.trimEnd().split("\n");
      expect(lines[0]).toBe(GENERIC_HEADER);
      expect(lines.slice(-2)).toEqual(GENERIC_FOOTER);
    }
  });

  it("D a wrapped FFmpeg failure exposes the nested FFmpeg error lines", () => {
    const execFileFailure = new Error(
      "Command failed: D:/Tools/ffmpeg/bin/ffmpeg.exe -hide_banner -loglevel error -nostdin -n\n[mp4 @ 0x1] Could not write header\nConversion failed!\n",
    );
    const wrapped = new Error("Episode rough-cut FFmpeg failed for EP02.", { cause: execFileFailure });
    expect(formatEpisodeRoughCutCliError(wrapped)).toBe(
      generic(
        "Reason: Episode rough-cut FFmpeg failed for EP02.",
        "Cause 1: Command failed: D:/Tools/ffmpeg/bin/ffmpeg.exe -hide_banner -loglevel error -nostdin -n",
        "  [mp4 @ 0x1] Could not write header",
        "  Conversion failed!",
      ),
    );
  });

  it("a normalization wrapper keeps its cause and a dialogue cleanup failure shows only what it carries", () => {
    const normalization = new Error("Composition normalization FFmpeg failed for EP02/S01.", {
      cause: new Error("Command failed: ffmpeg\nInvalid data found when processing input"),
    });
    expect(formatEpisodeRoughCutCliError(normalization)).toContain("  Invalid data found when processing input");
    const cleanup = new Error(
      "Dialogue composition normalization temporary cleanup failed while handling a materialization failure for EP02/S02.",
      { cause: new Error("EPERM: operation not permitted") },
    );
    expect(formatEpisodeRoughCutCliError(cleanup)).toBe(
      generic(
        "Reason: Dialogue composition normalization temporary cleanup failed while handling a materialization failure for EP02/S02.",
        "Cause 1: EPERM: operation not permitted",
      ),
    );
  });
});

describe("C8 CLI formatter E-I leakage and non-Error safety", () => {
  it("E/F primary and cause stacks are never emitted", () => {
    const cause = new Error("inner");
    cause.stack = "Error: inner\n    at CAUSE_STACK_SENTINEL";
    const primary = new Error("outer", { cause });
    primary.stack = "Error: outer\n    at PRIMARY_STACK_SENTINEL";
    const text = formatEpisodeRoughCutCliError(primary);
    expect(text).not.toContain("STACK_SENTINEL");
    expect(text).toBe(generic("Reason: outer", "Cause 1: inner"));
  });

  it("G thrown objects are described by type only, never stringified or enumerated", () => {
    const toString = vi.fn(() => "TOSTRING_SENTINEL");
    const toJSON = vi.fn(() => "TOJSON_SENTINEL");
    const thrown = { apiKey: "OBJECT_SENTINEL", toString, toJSON };
    const text = formatEpisodeRoughCutCliError(thrown);
    expect(text).toBe(generic("Reason: non-Error value thrown (type object); contents not shown."));
    const asCause = formatEpisodeRoughCutCliError(new Error("wrapper", { cause: thrown }));
    expect(asCause).toBe(generic("Reason: wrapper", "Cause 1: non-Error value (type object); contents not shown."));
    for (const output of [text, asCause]) {
      expect(output).not.toMatch(/SENTINEL|\[object Object\]/);
    }
    expect(toString).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });

  it.each([
    ["string", "SECRET_STRING_VALUE", "string"],
    ["number", 42, "number"],
    ["undefined", undefined, "undefined"],
    ["null", null, "null"],
    ["symbol", Symbol("SECRET_SYMBOL"), "symbol"],
    ["bigint", 10n, "bigint"],
    ["function", () => "SECRET_FUNCTION", "function"],
  ])("H a thrown %s is deterministic and content-free", (_label, value, type) => {
    const text = formatEpisodeRoughCutCliError(value);
    expect(text).toBe(generic(`Reason: non-Error value thrown (type ${type}); contents not shown.`));
    expect(text).not.toContain("SECRET");
  });

  it("I empty, whitespace-only and non-string messages are deterministic", () => {
    expect(formatEpisodeRoughCutCliError(new Error(""))).toBe(generic("Reason: (empty message)"));
    expect(formatEpisodeRoughCutCliError(new Error("   \n \t \r\n"))).toBe(generic("Reason: (empty message)"));
    const nonString = new Error("x");
    Object.defineProperty(nonString, "message", { value: 42 });
    expect(formatEpisodeRoughCutCliError(nonString)).toBe(generic("Reason: (non-string message)"));
  });
});

describe("C8 CLI formatter J-M normalization, bounds, depth and cycles", () => {
  it("J more than six lines keep the first, an omission marker and the last five", () => {
    const lines = Array.from({ length: 10 }, (_unused, index) => `line ${index + 1}`);
    const expected = generic(
      "Reason: line 1",
      "  ... 4 lines omitted ...",
      "  line 6",
      "  line 7",
      "  line 8",
      "  line 9",
      "  line 10",
    );
    expect(formatEpisodeRoughCutCliError(new Error(lines.join("\n")))).toBe(expected);
    expect(formatEpisodeRoughCutCliError(new Error(lines.join("\r\n")))).toBe(expected);
    expect(formatEpisodeRoughCutCliError(new Error(lines.join("\r")))).toBe(expected);
  });

  it("J exactly six lines are all kept; blank lines are dropped; control characters become spaces", () => {
    const six = ["a", "", "b", "c", "  ", "d", "e", "f"].join("\n");
    expect(formatEpisodeRoughCutCliError(new Error(six))).toBe(
      generic("Reason: a", "  b", "  c", "  d", "  e", "  f"),
    );
    expect(formatEpisodeRoughCutCliError(new Error("\ta\u0000b\u001bc\u007f "))).toBe(generic("Reason: a b c"));
  });

  it("K each line is bounded to 300 code points without splitting a surrogate pair", () => {
    expect(formatEpisodeRoughCutCliError(new Error("x".repeat(300)))).toBe(generic(`Reason: ${"x".repeat(300)}`));
    expect(formatEpisodeRoughCutCliError(new Error("x".repeat(400)))).toBe(generic(`Reason: ${"x".repeat(300)}...`));
    const astral = `${"x".repeat(299)}\u{1F600}${"y".repeat(10)}`;
    expect(formatEpisodeRoughCutCliError(new Error(astral))).toBe(
      generic(`Reason: ${"x".repeat(299)}\u{1F600}...`),
    );
    const tail = formatEpisodeRoughCutCliError(new Error(`first\n${"z".repeat(500)}`));
    expect(tail).toContain(`  ${"z".repeat(300)}...\n`);
  });

  it("L cause traversal stops after depth 4", () => {
    let chain = new Error("cause 6");
    for (let index = 5; index >= 1; index -= 1) chain = new Error(`cause ${index}`, { cause: chain });
    const primary = new Error("primary", { cause: chain });
    expect(formatEpisodeRoughCutCliError(primary)).toBe(
      generic(
        "Reason: primary",
        "Cause 1: cause 1",
        "Cause 2: cause 2",
        "Cause 3: cause 3",
        "Cause 4: cause 4",
        "Causes beyond depth 4 omitted.",
      ),
    );
    const exactlyFour = new Error("p", {
      cause: new Error("c1", { cause: new Error("c2", { cause: new Error("c3", { cause: new Error("c4") }) }) }),
    });
    expect(formatEpisodeRoughCutCliError(exactlyFour)).not.toContain("omitted");
  });

  it("M self and two-node cause cycles terminate", () => {
    const self = new Error("self");
    (self as { cause?: unknown }).cause = self;
    expect(formatEpisodeRoughCutCliError(self)).toBe(
      generic("Reason: self", "Cause 1: cause cycle detected; traversal stopped."),
    );
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    (first as { cause?: unknown }).cause = second;
    expect(formatEpisodeRoughCutCliError(first)).toBe(
      generic("Reason: first", "Cause 1: second", "Cause 2: cause cycle detected; traversal stopped."),
    );
  });
});

describe("C8 CLI formatter N never throws", () => {
  it("throwing getters and proxy traps are contained", () => {
    const badMessage = new Error("x");
    Object.defineProperty(badMessage, "message", {
      get() {
        throw new Error("getter boom");
      },
    });
    expect(formatEpisodeRoughCutCliError(badMessage)).toBe(generic("Reason: (message unavailable)"));

    const badCause = new Error("outer");
    Object.defineProperty(badCause, "cause", {
      get() {
        throw new Error("cause boom");
      },
    });
    expect(formatEpisodeRoughCutCliError(badCause)).toBe(
      generic("Reason: outer", "Cause 1: cause unavailable; traversal stopped."),
    );

    const trap = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("trap boom");
        },
      },
    );
    expect(formatEpisodeRoughCutCliError(trap)).toBe(
      generic("Reason: non-Error value thrown (type object); contents not shown."),
    );
    expect(formatEpisodeRoughCutCliError(new Error("outer", { cause: trap }))).toBe(
      generic("Reason: outer", "Cause 1: cause unavailable; traversal stopped."),
    );
  });

  it("an unexpected internal failure returns the exact fallback text", () => {
    const hostile = new EpisodeRoughCutCliOutputError(
      Object.defineProperty({}, "episodeId", {
        get() {
          throw new Error("hostile");
        },
      }) as never,
      new Error("stdout closed"),
    );
    expect(formatEpisodeRoughCutCliError(hostile)).toBe(FALLBACK);
  });
});

describe("C8 CLI formatter U reporting failure", () => {
  it("names the returned rough cut and the reporting cause, and never suggests repeating the operation", () => {
    const text = formatEpisodeRoughCutCliError(
      new EpisodeRoughCutCliOutputError(result("MATERIALIZED"), new Error("write EPIPE")),
    );
    expect(text).toBe(
      [
        "Episode rough-cut operation returned, but CLI reporting failed.",
        "Episode: EP02",
        "Render status: MATERIALIZED",
        `Rough-cut output: ${OUTPUT_PATH}`,
        `Render record: ${RECORD_PATH}`,
        `Rough-cut SHA-256: ${"b".repeat(64)}`,
        "Reason: write EPIPE",
        "Do not repeat the operation to recover this report. A later explicit invocation verifies and reuses the recorded rough cut.",
      ].join("\n") + "\n",
    );
  });
});

describe("C8 CLI terminology is rough-cut scoped", () => {
  it("success, fixed failure lines and reporting-failure text carry no completion, final or publication wording", async () => {
    const texts: string[] = [];
    for (const status of ["MATERIALIZED", "HIT"] as const) {
      const { writeStdout, deps } = harness(result(status));
      await runEpisodeRoughCutCli(VALID_ARGS, deps);
      texts.push(writeStdout.mock.calls[0]![0]);
    }
    const reporting = formatEpisodeRoughCutCliError(
      new EpisodeRoughCutCliOutputError(result("HIT"), new Error("stdout closed")),
    );
    for (const text of [...texts, reporting]) {
      expect(text).toMatch(/rough cut/);
      expect(text).not.toMatch(FORBIDDEN_WORDING);
    }
    // Propagated lower-layer Reason/Cause lines are excluded: existing C5
    // messages legitimately mention e.g. "COMPLETED lifecycle".
    const fixedLines = formatEpisodeRoughCutCliError(new Error("x"))
      .trimEnd()
      .split("\n")
      .filter((line) => !line.startsWith("Reason: "));
    expect(fixedLines).toEqual([GENERIC_HEADER, ...GENERIC_FOOTER]);
    for (const line of fixedLines) expect(line).not.toMatch(FORBIDDEN_WORDING);
  });
});

describe("C8 CLI T formatting and parsing perform no filesystem or process activity", () => {
  it("records zero fs, fs/promises and child_process calls", () => {
    const spies = spiedModuleFunctions();
    expect(spies.length).toBeGreaterThan(20);
    for (const spy of spies) spy.mockClear();
    const self = new Error("self");
    (self as { cause?: unknown }).cause = self;
    for (const value of [
      new Error("Episode rough-cut FFmpeg failed for EP02.", { cause: new Error("Command failed\nboom") }),
      self,
      { secret: true },
      null,
      new EpisodeRoughCutCliOutputError(result("HIT"), new Error("stdout closed")),
    ]) {
      formatEpisodeRoughCutCliError(value);
    }
    parseEpisodeRoughCutCliArgs(VALID_ARGS);
    expect(() => parseEpisodeRoughCutCliArgs(["--force"])).toThrow();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("C8 CLI O-S thin script", () => {
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  async function runScript(outcome: "resolve" | "reject", failure?: unknown) {
    vi.resetModules();
    const cli = await import("../src/composition/cli/runEpisodeRoughCutCli.js");
    if (outcome === "resolve") vi.mocked(cli.runEpisodeRoughCutCli).mockResolvedValueOnce(undefined);
    else vi.mocked(cli.runEpisodeRoughCutCli).mockRejectedValueOnce(failure);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit must not be called");
    }) as never);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await import("../scripts/episode-rough-cut.js");
    await new Promise((resolveTick) => setTimeout(resolveTick, 0));
    const written = stderr.mock.calls.map((call) => call[0]);
    stderr.mockRestore();
    return { cli, exit, written, consoleError };
  }

  it("P success leaves process.exitCode unset and writes no stderr", async () => {
    const { cli, exit, written } = await runScript("resolve");
    expect(cli.runEpisodeRoughCutCli).toHaveBeenCalledTimes(1);
    expect(cli.formatEpisodeRoughCutCliError).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    expect(written).toEqual([]);
    expect(exit).not.toHaveBeenCalled();
  });

  it("O/P/Q/R a rejection is delegated to the single formatter, exitCode 1, no process.exit, no retry", async () => {
    const failure = new Error("Composition admission requires COMPLETED lifecycle for EP02/S02; received SUBMITTED.");
    const { cli, exit, written, consoleError } = await runScript("reject", failure);
    expect(cli.runEpisodeRoughCutCli).toHaveBeenCalledTimes(1);
    expect(cli.formatEpisodeRoughCutCliError).toHaveBeenCalledTimes(1);
    expect(cli.formatEpisodeRoughCutCliError).toHaveBeenCalledWith(failure);
    const formatted = vi.mocked(cli.formatEpisodeRoughCutCliError).mock.results[0]!.value as string;
    expect(written).toEqual([formatted]);
    expect(formatted).toContain(`Reason: ${failure.message}`);
    expect(consoleError).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it("O/Q/S the script source is a thin caller with no own formatting, exit, retry or recovery path", async () => {
    const { readFile } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const source = (await readFile(new URL("../scripts/episode-rough-cut.ts", import.meta.url), "utf8")).replace(
      /\r\n/g,
      "\n",
    );
    expect([...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1])).toEqual([
      "../src/composition/cli/runEpisodeRoughCutCli.js",
    ]);
    expect(source).toContain("formatEpisodeRoughCutCliError(");
    expect(source).toContain("process.exitCode = 1;");
    expect(source.match(/runEpisodeRoughCutCli\(\)/g)).toHaveLength(1);
    expect(source).not.toMatch(/process\.exit\s*\(|console\.|JSON\.stringify|inspect\(|\.stack\b/);
  });
});

describe("C8 CLI package, index and C5/C6/C7 boundaries", () => {
  const read = async (path: string) => {
    const { readFile } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    return (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  };
  const imports = (source: string) => [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]).sort();

  it("package.json adds only episode:rough-cut after episode:automate, with unchanged dependencies", async () => {
    const pkg = JSON.parse(await read("package.json")) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts["episode:rough-cut"]).toBe("tsx scripts/episode-rough-cut.ts");
    const keys = Object.keys(pkg.scripts);
    expect(keys.indexOf("episode:rough-cut")).toBe(keys.indexOf("episode:automate") + 1);
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

  it("src/index.ts exposes no rough-cut surface", async () => {
    expect(await read("src/index.ts")).toBe(
      'export const BUSYBOOKIE_PRODUCTION_VERSION = "0.1.0";\n\nexport function getProductionVersion(): string {\n  return BUSYBOOKIE_PRODUCTION_VERSION;\n}\n',
    );
  });

  it("the C8 parser and runner import only their allowlisted modules (no C6/C7, provider or recovery path)", async () => {
    expect(imports(await read("src/composition/cli/episodeRoughCutCliArgs.ts"))).toEqual([
      "../../execution/executionReservation.schema.js",
    ]);
    expect(imports(await read("src/composition/cli/runEpisodeRoughCutCli.ts"))).toEqual([
      "../ensureEpisodeRoughCutRender.js",
      "../runProductionEpisodeRoughCut.js",
      "./episodeRoughCutCliArgs.js",
    ]);
  });

  it("C7 remains composition-excluded: no C7 file references the rough-cut operator", async () => {
    for (const path of [
      "src/execution/episodeAutomationPlan.schema.ts",
      "src/execution/runEpisodeAutomation.ts",
      "src/execution/cli/episodeAutomationCliArgs.ts",
      "src/execution/cli/runEpisodeAutomationCli.ts",
      "scripts/episode-automation.ts",
    ]) {
      const code = (await read(path)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, path).not.toMatch(/rough-cut|RoughCut|confirmLocalComposition|runProductionEpisode/);
    }
  });
});
