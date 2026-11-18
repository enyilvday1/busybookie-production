import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tripwires: the adoption command must never load .env or the credential-
// bearing environment loader. Any import of either fails this file.
vi.mock("dotenv/config", () => { throw new Error("Visual evidence adoption must never load dotenv/config."); });
vi.mock("../src/validation/loadEnvironment.js", () => {
  throw new Error("Visual evidence adoption must never import loadEnvironment.");
});
vi.mock("@google/genai", () => { throw new Error("Visual evidence adoption must never load the Google SDK."); });
vi.mock("@runwayml/sdk", () => { throw new Error("Visual evidence adoption must never load the Runway SDK."); });
// Pass-through spy so default-runner ordering can be observed.
vi.mock("../src/execution/visualEvidenceAdoptionEnvironment.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/visualEvidenceAdoptionEnvironment.js")>();
  return { ...actual, loadVisualEvidenceAdoptionEnvironment: vi.fn(actual.loadVisualEvidenceAdoptionEnvironment) };
});
// Pass-through spies so the thin process/script can be exercised without
// any preflight, durable read or write.
vi.mock("../src/execution/cli/runVisualEvidenceAdoptionCli.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/cli/runVisualEvidenceAdoptionCli.js")>();
  return {
    ...actual,
    runVisualEvidenceAdoptionCli: vi.fn(actual.runVisualEvidenceAdoptionCli),
    formatVisualEvidenceAdoptionCliError: vi.fn(actual.formatVisualEvidenceAdoptionCliError),
  };
});

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadVisualEvidenceAdoptionEnvironment } from "../src/execution/visualEvidenceAdoptionEnvironment.js";
import { parseVisualEvidenceAdoptionCliArgs } from "../src/execution/cli/visualEvidenceAdoptionCliArgs.js";
import {
  formatVisualEvidenceAdoptionCliError,
  formatVisualEvidenceAdoptionSummary,
  runVisualEvidenceAdoptionCli,
  type RunVisualEvidenceAdoptionCliDependencies,
} from "../src/execution/cli/runVisualEvidenceAdoptionCli.js";
import { VisualEvidenceAdoptionError, type AdoptCompletedVisualEvidenceResult } from "../src/execution/adoptCompletedVisualEvidence.js";
import { VisualEvidenceAdoptionExistsError } from "../src/execution/createVisualEvidenceAdoption.js";
import { BoundEpisodeError } from "../src/execution/boundEpisodeProduction.types.js";

const M = "aa5ca3a2c7d51d87cade3a765d27c769262feaa3d00d962600dd4d6c35790005";
const O = "1a880ed064ef51521b12d7360904031cb3da6cc2ff9f6cc4cbb319b25e5b9c0d";
const VALID = ["--episode", "EP90", "--shot", "S01", "--expected-manifest-sha256", M, "--expected-observation-sha256", O, "--confirm-adoption"];

describe("strict visual evidence adoption CLI arguments", () => {
  it("accepts exactly the five flags, in any order", () => {
    const expected = { episodeId: "EP90", shotId: "S01", expectedManifestRawSha256: M, expectedObservationSha256: O, confirmAdoption: true };
    expect(parseVisualEvidenceAdoptionCliArgs(VALID)).toEqual(expected);
    expect(parseVisualEvidenceAdoptionCliArgs(["--confirm-adoption", "--expected-observation-sha256", O, "--shot", "S01",
      "--expected-manifest-sha256", M, "--episode", "EP90"])).toEqual(expected);
  });

  it("refuses to operate without --confirm-adoption", () => {
    expect(() => parseVisualEvidenceAdoptionCliArgs(VALID.filter(arg => arg !== "--confirm-adoption"))).toThrow(/--confirm-adoption is required/);
  });

  it.each(["--episode", "--shot", "--expected-manifest-sha256", "--expected-observation-sha256", "--confirm-adoption"])(
    "rejects a duplicate %s", (flag) => {
      const index = VALID.indexOf(flag);
      const repeat = flag === "--confirm-adoption" ? [flag] : [flag, VALID[index + 1]!];
      expect(() => parseVisualEvidenceAdoptionCliArgs([...VALID, ...repeat])).toThrow(/Duplicate/);
    });

  it.each(["--episode", "--shot", "--expected-manifest-sha256", "--expected-observation-sha256"])("requires %s", (flag) => {
    const index = VALID.indexOf(flag);
    expect(() => parseVisualEvidenceAdoptionCliArgs([...VALID.slice(0, index), ...VALID.slice(index + 2)])).toThrow(`${flag} is required.`);
  });

  it.each([
    ["a trailing flag with no value", [...VALID.slice(0, 8), "--expected-observation-sha256"]],
    ["a flag followed by another flag", ["--episode", "--shot", "S01", ...VALID.slice(4)]],
    ["an empty value", ["--episode", "", ...VALID.slice(2)]],
  ])("rejects %s", (_label, args) => {
    expect(() => parseVisualEvidenceAdoptionCliArgs(args)).toThrow(/requires a value|Duplicate/);
  });

  it.each([
    ["--scene", "SC01"], ["--order", "1"], ["--provider", "RUNWAY"], ["--force", null], ["--overwrite", null], ["--retry", null],
    ["--stdin", null], ["--plan", "plan.json"], ["--json", null], ["--api-key", "secret"], ["-", null],
  ])("rejects the unsupported argument %s", (flag, value) => {
    expect(() => parseVisualEvidenceAdoptionCliArgs([...VALID, flag, ...(value === null ? [] : [value])])).toThrow(/Unknown/);
  });

  it("rejects --flag=value forms without echoing the value", () => {
    let message = "";
    try { parseVisualEvidenceAdoptionCliArgs([...VALID.slice(2), "--episode=EP90-secret-value"]); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/Unknown visual evidence adoption CLI argument: --episode$/);
    expect(message).not.toContain("secret-value");
  });

  it("rejects positional arguments", () => {
    expect(() => parseVisualEvidenceAdoptionCliArgs([...VALID, "EP90"])).toThrow(/positional/);
    expect(() => parseVisualEvidenceAdoptionCliArgs(["EP90", ...VALID])).toThrow(/positional/);
  });

  it.each([
    ["--episode", "EP9"], ["--episode", "../EP90"], ["--shot", "s01"], ["--shot", "S01/.."],
    ["--expected-manifest-sha256", M.toUpperCase()], ["--expected-observation-sha256", O.slice(1)],
  ])("rejects an invalid %s value", (flag, value) => {
    const args = [...VALID]; args[args.indexOf(flag) + 1] = value;
    expect(() => parseVisualEvidenceAdoptionCliArgs(args)).toThrow(`${flag} is invalid.`);
  });
});

const EVIDENCE_ONLY_LINE =
  "Evidence only (NONE_EVIDENCE_ONLY): this command made no provider call and executed no generation, reconciliation, or plan. " +
  "Any later provider action requires a fresh reviewed plan and the existing confirmation, guard, and admission controls.";

function result(): AdoptCompletedVisualEvidenceResult {
  const target = { episodeId: "EP90", sceneId: "SC01", shotId: "S01", order: 1 };
  return {
    target,
    adoptionPath: "/media/generated-video/EP90/S01/evidence-adoptions/receipt.visual-evidence-adoption.json",
    adoptionSha256: "c".repeat(64),
    receipt: {} as AdoptCompletedVisualEvidenceResult["receipt"],
    postAdoptionPreflight: {
      shots: [{ shotId: "S01", intentAlignment: "REVIEWED" }],
      intentAlignment: "REVIEWED",
      completion: "VISUAL_PRODUCTION_COMPLETE",
      nextActionCandidate: null,
    } as unknown as AdoptCompletedVisualEvidenceResult["postAdoptionPreflight"],
  };
}

function harness(overrides: Partial<RunVisualEvidenceAdoptionCliDependencies> = {}) {
  const loadAdoptionEnvironment = vi.fn(overrides.loadAdoptionEnvironment ?? (() => ({ BUSYBOOKIE_MEDIA_ROOT: "/media" })));
  const adopt = vi.fn(async () => result());
  const writeStdout = vi.fn((_text: string) => undefined);
  const deps: RunVisualEvidenceAdoptionCliDependencies = {
    adopt: adopt as unknown as RunVisualEvidenceAdoptionCliDependencies["adopt"],
    currentDirectory: () => "/release", writeStdout, ...overrides, loadAdoptionEnvironment,
  };
  return { deps, loadAdoptionEnvironment, adopt, writeStdout };
}

describe("visual evidence adoption CLI runner", () => {
  it("passes exactly the operator inputs and the process context, then prints the bounded summary", async () => {
    const h = harness({ loadAdoptionEnvironment: () => ({ BUSYBOOKIE_MEDIA_ROOT: "/media", BUSYBOOKIE_FFPROBE_PATH: "/usr/bin/ffprobe" }) });
    await runVisualEvidenceAdoptionCli(VALID, h.deps);
    expect(h.adopt).toHaveBeenCalledTimes(1);
    expect(h.adopt).toHaveBeenCalledWith({ episodeId: "EP90", shotId: "S01", expectedManifestRawSha256: M, expectedObservationSha256: O,
      repositoryRoot: "/release", mediaRoot: "/media", ffprobeExecutable: "/usr/bin/ffprobe" });
    const text = h.writeStdout.mock.calls.map(call => call[0]).join("");
    for (const line of ["Episode: EP90", "Scene: SC01", "Shot: S01", `Receipt SHA-256: ${"c".repeat(64)}`,
      "Receipt path: /media/generated-video/EP90/S01/evidence-adoptions/receipt.visual-evidence-adoption.json",
      "Post-adoption shot intent alignment: REVIEWED", "Post-adoption episode intent alignment: REVIEWED",
      "Post-adoption episode completion: VISUAL_PRODUCTION_COMPLETE", "Next action: NONE", EVIDENCE_ONLY_LINE]) {
      expect(text).toContain(line);
    }
    expect(text).not.toMatch(/authoriz/i);
  });

  it("omits ffprobe when it is not configured", async () => {
    const h = harness();
    await runVisualEvidenceAdoptionCli(VALID, h.deps);
    expect(h.adopt.mock.calls[0]).toEqual([{ episodeId: "EP90", shotId: "S01", expectedManifestRawSha256: M,
      expectedObservationSha256: O, repositoryRoot: "/release", mediaRoot: "/media" }]);
  });

  it.each([
    ["no --confirm-adoption", VALID.filter(arg => arg !== "--confirm-adoption")],
    ["a duplicate flag", [...VALID, "--shot", "S02"]],
    ["an unknown flag", [...VALID, "--scene", "SC01"]],
    ["a missing value", VALID.slice(0, -2)],
    ["a positional argument", [...VALID, "extra"]],
  ])("an argument error (%s) loads no environment and attempts no adoption", async (_label, args) => {
    const h = harness();
    await expect(runVisualEvidenceAdoptionCli(args, h.deps)).rejects.toThrow();
    expect(h.loadAdoptionEnvironment).not.toHaveBeenCalled();
    expect(h.adopt).not.toHaveBeenCalled();
    expect(h.writeStdout).not.toHaveBeenCalled();
  });

  it("a refused adoption writes no summary", async () => {
    const h = harness({ adopt: vi.fn(async () => { throw new VisualEvidenceAdoptionError("MANIFEST_MISMATCH"); }) as never });
    await expect(runVisualEvidenceAdoptionCli(VALID, h.deps)).rejects.toMatchObject({ code: "MANIFEST_MISMATCH" });
    expect(h.writeStdout).not.toHaveBeenCalled();
  });

  it("reports an exposed next frontier without claiming it is unauthorized, and states the controls still required", () => {
    const value = result();
    const next = { ...value, postAdoptionPreflight: { ...value.postAdoptionPreflight, completion: "INCOMPLETE",
      nextActionCandidate: { kind: "VISUAL_GENERATE" }, generationMayBeAuthorized: true } };
    const text = formatVisualEvidenceAdoptionSummary(next as unknown as AdoptCompletedVisualEvidenceResult);
    expect(text).toContain("Next action: VISUAL_GENERATE");
    // The command's own effects only; a later provider action needs the
    // normal plan, confirmation, guard and admission controls.
    expect(text).toContain(EVIDENCE_ONLY_LINE);
    expect(text).not.toMatch(/authoriz/i);
  });
});

describe("visual evidence adoption CLI error formatting", () => {
  it.each([
    [new VisualEvidenceAdoptionError("OBSERVATION_MISMATCH"), /refused \(OBSERVATION_MISMATCH\); no receipt was written/],
    [new VisualEvidenceAdoptionError("POST_ADOPTION_STATE_UNRESOLVED", true), /receipt was written, but post-adoption verification failed/],
    [new VisualEvidenceAdoptionExistsError("/media/x.json"), /already exists and is never replaced/],
    [new BoundEpisodeError("INPUT_BINDING_DRIFT"), /stopped \(INPUT_BINDING_DRIFT\); no receipt was written/],
  ])("formats %s as one bounded line", (error, pattern) => {
    const text = formatVisualEvidenceAdoptionCliError(error);
    expect(text).toMatch(pattern);
    expect(text).not.toMatch(/\n\s+at /);
  });

  it("never prints a stack, a cause or more than one bounded line", () => {
    const error = new Error(`first line ${"x".repeat(400)}\nsecond line with RUNWAYML_API_SECRET=leak`, { cause: new Error("cause-secret") });
    const text = formatVisualEvidenceAdoptionCliError(error);
    expect(text).not.toContain("second line");
    expect(text).not.toContain("cause-secret");
    expect(text).not.toContain("leak");
    expect(text.length).toBeLessThan(400);
    expect(formatVisualEvidenceAdoptionCliError("raw")).toBe("\nVisual evidence adoption failed with a non-error value.");
  });
});

describe("thin process entrypoint and development script", () => {
  let originalExitCode: typeof process.exitCode;
  beforeEach(() => { originalExitCode = process.exitCode; process.exitCode = undefined; });
  afterEach(() => { process.exitCode = originalExitCode; vi.restoreAllMocks(); });

  const flush = () => new Promise(resolveTick => setTimeout(resolveTick, 0));

  async function run(script: string, outcome: "resolve" | "reject", failure?: unknown) {
    vi.resetModules();
    const cli = await import("../src/execution/cli/runVisualEvidenceAdoptionCli.js");
    if (outcome === "resolve") vi.mocked(cli.runVisualEvidenceAdoptionCli).mockResolvedValueOnce(undefined);
    else vi.mocked(cli.runVisualEvidenceAdoptionCli).mockRejectedValueOnce(failure);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("process.exit must not be called"); }) as never);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await import(script);
    await flush();
    return { cli, exit, stderr };
  }

  it.each(["../src/execution/visualEvidenceAdoptionProcess.js", "../scripts/episode-adopt-visual-evidence.js"])(
    "%s: success leaves exitCode unset and writes no error", async (script) => {
      const { cli, exit, stderr } = await run(script, "resolve");
      expect(cli.runVisualEvidenceAdoptionCli).toHaveBeenCalledTimes(1);
      expect(stderr).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
      expect(exit).not.toHaveBeenCalled();
    });

  it.each(["../src/execution/visualEvidenceAdoptionProcess.js", "../scripts/episode-adopt-visual-evidence.js"])(
    "%s: failure is formatted once, sets exitCode 1 and never calls process.exit", async (script) => {
      const failure = new VisualEvidenceAdoptionError("MANIFEST_MISMATCH");
      const { cli, exit, stderr } = await run(script, "reject", failure);
      expect(cli.formatVisualEvidenceAdoptionCliError).toHaveBeenCalledWith(failure);
      expect(stderr).toHaveBeenCalledTimes(1);
      expect(stderr.mock.calls[0]![0]).toMatch(/refused \(MANIFEST_MISMATCH\)/);
      expect(process.exitCode).toBe(1);
      expect(exit).not.toHaveBeenCalled();
    });

  it("the process source uses exitCode, never process.exit, stack output or JSON payloads", async () => {
    for (const path of ["src/execution/visualEvidenceAdoptionProcess.ts", "scripts/episode-adopt-visual-evidence.ts"]) {
      const source = (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
      expect(source).toContain("process.exitCode = 1;");
      expect(source).not.toMatch(/process\.exit\s*\(|\.stack\b|JSON\.stringify/);
      expect(source.match(/runVisualEvidenceAdoptionCli\(\)/g)).toHaveLength(1);
    }
  });
});

// A recording environment: every property access, presence check,
// enumeration and descriptor lookup is logged.
function recordingEnvironment(values: Record<string, string | undefined>) {
  const accesses: string[] = [];
  const proxy = new Proxy(values, {
    get: (target, key) => { accesses.push(`get:${String(key)}`); return Reflect.get(target, key); },
    has: (target, key) => { accesses.push(`has:${String(key)}`); return Reflect.has(target, key); },
    ownKeys: (target) => { accesses.push("ownKeys"); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor: (target, key) => { accesses.push(`descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); },
  });
  return { proxy, accesses };
}

const RUNWAY_SENTINEL = "runway-credential-sentinel-value";
const GEMINI_SENTINEL = "gemini-credential-sentinel-value";

describe("least-privilege adoption environment", () => {
  it("reads exactly BUSYBOOKIE_MEDIA_ROOT and BUSYBOOKIE_FFPROBE_PATH, never a provider credential, never enumerating", () => {
    const { proxy, accesses } = recordingEnvironment({ BUSYBOOKIE_MEDIA_ROOT: "/media", BUSYBOOKIE_FFPROBE_PATH: "/usr/bin/ffprobe",
      RUNWAYML_API_SECRET: RUNWAY_SENTINEL, GEMINI_API_KEY: GEMINI_SENTINEL, BUSYBOOKIE_FFMPEG_PATH: "/usr/bin/ffmpeg" });
    const environment = loadVisualEvidenceAdoptionEnvironment(proxy);
    expect(accesses).toEqual(["get:BUSYBOOKIE_MEDIA_ROOT", "get:BUSYBOOKIE_FFPROBE_PATH"]);
    expect(accesses.some(access => /RUNWAYML_API_SECRET|GEMINI_API_KEY/.test(access))).toBe(false);
    expect(environment).toEqual({ BUSYBOOKIE_MEDIA_ROOT: "/media", BUSYBOOKIE_FFPROBE_PATH: "/usr/bin/ffprobe" });
    expect(JSON.stringify(environment)).not.toMatch(/sentinel/);
    expect(Object.isFrozen(environment)).toBe(true);
  });

  it("requires no provider credential when credentials are absent", () => {
    const { proxy, accesses } = recordingEnvironment({ BUSYBOOKIE_MEDIA_ROOT: "/media" });
    expect(loadVisualEvidenceAdoptionEnvironment(proxy)).toEqual({ BUSYBOOKIE_MEDIA_ROOT: "/media" });
    expect(accesses).toEqual(["get:BUSYBOOKIE_MEDIA_ROOT", "get:BUSYBOOKIE_FFPROBE_PATH"]);
  });

  it("treats an empty BUSYBOOKIE_FFPROBE_PATH as not configured", () => {
    expect(loadVisualEvidenceAdoptionEnvironment({ BUSYBOOKIE_MEDIA_ROOT: "/media", BUSYBOOKIE_FFPROBE_PATH: "" }))
      .toEqual({ BUSYBOOKIE_MEDIA_ROOT: "/media" });
  });

  it.each([
    ["absent", {}],
    ["empty", { BUSYBOOKIE_MEDIA_ROOT: "" }],
    ["blank", { BUSYBOOKIE_MEDIA_ROOT: "   " }],
  ])("refuses a %s media root with fixed text that echoes no environment value", (_label, values) => {
    let message = "";
    try {
      loadVisualEvidenceAdoptionEnvironment({ ...values, RUNWAYML_API_SECRET: RUNWAY_SENTINEL, GEMINI_API_KEY: GEMINI_SENTINEL });
    } catch (error) { message = (error as Error).message; }
    expect(message).toBe("Visual evidence adoption requires BUSYBOOKIE_MEDIA_ROOT in the process environment (BUSYBOOKIE_FFPROBE_PATH is optional).");
    expect(message).not.toMatch(/sentinel/);
  });

  it("does not clear or modify provider credential variables", () => {
    const values: Record<string, string | undefined> = { BUSYBOOKIE_MEDIA_ROOT: "/media",
      RUNWAYML_API_SECRET: RUNWAY_SENTINEL, GEMINI_API_KEY: GEMINI_SENTINEL };
    const before = { ...values };
    loadVisualEvidenceAdoptionEnvironment(values);
    expect(values).toEqual(before);
  });
});

describe("default runner uses only the least-privilege environment, after argument validation", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it.each([
    ["no --confirm-adoption", VALID.filter(arg => arg !== "--confirm-adoption")],
    ["a duplicate flag", [...VALID, "--episode", "EP90"]],
    ["an unknown flag", [...VALID, "--api-key", "x"]],
    ["a missing value", ["--episode"]],
    ["a positional argument", ["EP90", ...VALID]],
  ])("an argument error (%s) never invokes the environment loader", async (_label, args) => {
    const environment = await import("../src/execution/visualEvidenceAdoptionEnvironment.js");
    vi.mocked(environment.loadVisualEvidenceAdoptionEnvironment).mockClear();
    await expect(runVisualEvidenceAdoptionCli(args)).rejects.toThrow();
    expect(environment.loadVisualEvidenceAdoptionEnvironment).not.toHaveBeenCalled();
  });

  it("valid arguments reach the narrow loader, which stops a missing media root before any adoption", async () => {
    const environment = await import("../src/execution/visualEvidenceAdoptionEnvironment.js");
    vi.mocked(environment.loadVisualEvidenceAdoptionEnvironment).mockClear();
    vi.stubEnv("BUSYBOOKIE_MEDIA_ROOT", undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real network tripwire."));
    await expect(runVisualEvidenceAdoptionCli(VALID)).rejects.toThrow(/requires BUSYBOOKIE_MEDIA_ROOT/);
    expect(environment.loadVisualEvidenceAdoptionEnvironment).toHaveBeenCalledTimes(1);
    expect(environment.loadVisualEvidenceAdoptionEnvironment).toHaveBeenCalledWith();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// The runtime import closure, from TypeScript source, excluding type-only
// imports (erased at compile time).
function runtimeImportClosure(entries: readonly string[]): Readonly<{ files: readonly string[]; specifiers: readonly string[] }> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const seen = new Set<string>(); const specifiers = new Set<string>();
  const stack = entries.map(entry => resolve(root, entry));
  const statement = /(?:^|[\n;])\s*(import|export)\s+(type\s+)?[^;"'`]*?\bfrom\s*["']([^"']+)["']|(?:^|[\n;])\s*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const match of source.matchAll(statement)) {
      if (match[2]) continue;
      const specifier = match[3] ?? match[4] ?? match[5]!;
      specifiers.add(specifier);
      if (specifier.startsWith(".")) {
        const target = resolve(dirname(file), specifier).replace(/\.js$/, ".ts");
        if (existsSync(target)) stack.push(target);
      }
    }
  }
  return { files: [...seen].map(file => relative(root, file).split("\\").join("/")).sort(), specifiers: [...specifiers].sort() };
}

describe("adoption command source boundary", () => {
  const closure = runtimeImportClosure([
    "src/execution/visualEvidenceAdoptionProcess.ts",
    "scripts/episode-adopt-visual-evidence.ts",
  ]);

  it("never reaches dotenv/config or the credential-bearing loadEnvironment", () => {
    expect(closure.files).toContain("src/execution/visualEvidenceAdoptionEnvironment.ts");
    expect(closure.files).toContain("src/execution/adoptCompletedVisualEvidence.ts");
    expect(closure.files).not.toContain("src/validation/loadEnvironment.ts");
    expect(closure.specifiers.filter(specifier => /^dotenv(\/|$)|loadEnvironment\.js$/.test(specifier))).toEqual([]);
  });

  it("reaches no provider SDK or network client module", () => {
    expect(closure.specifiers.filter(specifier =>
      /^@google\/genai|^@runwayml\/sdk|^node:(https?|http2|net|tls|dgram)$|^(https?|http2|net|tls|undici)$/.test(specifier))).toEqual([]);
  });

  it("the CLI, service and environment modules never name provider credential variables", async () => {
    for (const path of ["src/execution/cli/runVisualEvidenceAdoptionCli.ts", "src/execution/cli/visualEvidenceAdoptionCliArgs.ts",
      "src/execution/adoptCompletedVisualEvidence.ts", "src/execution/visualEvidenceAdoptionEnvironment.ts",
      "src/execution/visualEvidenceAdoptionProcess.ts", "scripts/episode-adopt-visual-evidence.ts"]) {
      const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
      expect(source, path).not.toMatch(/RUNWAYML_API_SECRET|GEMINI_API_KEY|GOOGLE_API_KEY|dotenv|loadEnvironment\b/);
    }
  });
});
