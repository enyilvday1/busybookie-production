import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv/config", () => ({}));
// Pass-through spies so the thin script can be exercised without starting a
// real server.
vi.mock("../src/operatorServer/cli/runOperatorServerCli.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/operatorServer/cli/runOperatorServerCli.js")>();
  return {
    ...actual,
    runOperatorServerCli: vi.fn(actual.runOperatorServerCli),
    formatOperatorServerCliError: vi.fn(actual.formatOperatorServerCliError),
  };
});

import { readFile } from "node:fs/promises";

import {
  DEFAULT_OPERATOR_SERVER_PORT,
  formatOperatorServerCliError,
  parseOperatorServerCliArgs,
  runOperatorServerCli,
  type RunOperatorServerCliDependencies,
} from "../src/operatorServer/cli/runOperatorServerCli.js";
import { OperatorConsoleBuildError, type OperatorConsoleAssets } from "../src/operatorServer/operatorConsoleAssets.js";

const TOKEN = "c".repeat(64);
const CONSOLE_ASSETS: OperatorConsoleAssets = Object.freeze({ lookup: () => undefined });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((onResolve) => (resolve = onResolve));
  return { promise, resolve };
}

function harness() {
  const close = vi.fn(async () => undefined);
  const signal = deferred();
  const startServer = vi.fn(async ({ port }: { port: number }) => ({
    origin: `http://127.0.0.1:${port}`,
    port,
    token: TOKEN,
    close,
  }));
  const loadConsoleAssets = vi.fn(async () => CONSOLE_ASSETS);
  const writeStdout = vi.fn((_text: string) => undefined);
  const waitForShutdownSignal = vi.fn(() => signal.promise);
  const deps = {
    startServer,
    loadConsoleAssets,
    writeStdout,
    waitForShutdownSignal,
  } as unknown as RunOperatorServerCliDependencies;
  return { deps, startServer, loadConsoleAssets, writeStdout, close, signal, waitForShutdownSignal };
}

const flush = () => new Promise((resolveTick) => setTimeout(resolveTick, 0));

describe("D1 operator server CLI arguments", () => {
  it("defaults to port 4381 and accepts exactly --port <1024-65535>", () => {
    expect(DEFAULT_OPERATOR_SERVER_PORT).toBe(4381);
    expect(parseOperatorServerCliArgs([])).toEqual({ port: 4381 });
    expect(parseOperatorServerCliArgs(["--port", "1024"])).toEqual({ port: 1024 });
    expect(parseOperatorServerCliArgs(["--port", "65535"])).toEqual({ port: 65535 });
    expect(Object.isFrozen(parseOperatorServerCliArgs([]))).toBe(true);
  });

  it.each([
    [["--port"], "--port requires a port number."],
    [["--port", "abc"], "--port requires a port number."],
    [["--port", "+5000"], "--port requires a port number."],
    [["--port", "123456"], "--port requires a port number."],
    [["--port", "0"], "--port must be from 1024 to 65535."],
    [["--port", "80"], "--port must be from 1024 to 65535."],
    [["--port", "65536"], "--port must be from 1024 to 65535."],
    [["--port", "5000", "--port", "5001"], "Duplicate operator server CLI argument: --port"],
    [["--port=5000"], "Operator server CLI arguments do not accept --flag=value forms: --port"],
    [["--host", "0.0.0.0"], "Unknown operator server CLI argument: --host"],
    [["--token", TOKEN], "Unknown operator server CLI argument: --token"],
    [["--media-root", "D:/x"], "Unknown operator server CLI argument: --media-root"],
    [["-p", "5000"], "Unknown operator server CLI argument: -p"],
    [["5000"], "Unexpected positional operator server CLI argument."],
  ])("rejects %j", (args, message) => {
    expect(() => parseOperatorServerCliArgs(args)).toThrow(message);
  });

  it("a rejected token-like argument is never echoed", () => {
    expect(() => parseOperatorServerCliArgs([TOKEN])).toThrow("Unexpected positional operator server CLI argument.");
  });
});

describe("D1 operator server CLI runner", () => {
  it("starts on loopback, prints the one-time bootstrap, then closes only after a shutdown signal", async () => {
    const { deps, startServer, loadConsoleAssets, writeStdout, close, signal } = harness();
    const running = runOperatorServerCli(["--port", "5001"], deps);
    await flush();

    expect(loadConsoleAssets).toHaveBeenCalledTimes(1);
    expect(loadConsoleAssets.mock.invocationCallOrder[0]).toBeLessThan(startServer.mock.invocationCallOrder[0]!);
    expect(startServer.mock.calls).toEqual([[{ port: 5001, consoleAssets: CONSOLE_ASSETS }]]);
    expect(writeStdout).toHaveBeenCalledTimes(1);
    const lines = writeStdout.mock.calls[0]![0].split("\n");
    expect(lines).toEqual([
      "BusyBookie operator API (read-only) listening on http://127.0.0.1:5001",
      "Operator console: http://127.0.0.1:5001/",
      `Operator token for this launch: ${TOKEN}`,
      "Press Ctrl+C to stop.",
      "",
    ]);
    expect(lines.filter((line) => line.includes(TOKEN))).toHaveLength(1);
    expect(close).not.toHaveBeenCalled();

    signal.resolve();
    await running;
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("a startup failure propagates without any bootstrap output", async () => {
    const { deps, startServer, writeStdout } = harness();
    const failure = Object.assign(new Error("listen EADDRINUSE: address already in use 127.0.0.1:4381"), { code: "EADDRINUSE" });
    startServer.mockRejectedValueOnce(failure);
    await expect(runOperatorServerCli([], deps)).rejects.toBe(failure);
    expect(startServer.mock.calls).toEqual([[{ port: 4381, consoleAssets: CONSOLE_ASSETS }]]);
    expect(writeStdout).not.toHaveBeenCalled();
  });

  it("an argument failure starts nothing", async () => {
    const { deps, startServer, loadConsoleAssets } = harness();
    await expect(runOperatorServerCli(["--host", "0.0.0.0"], deps)).rejects.toThrow("Unknown operator server CLI argument: --host");
    expect(loadConsoleAssets).not.toHaveBeenCalled();
    expect(startServer).not.toHaveBeenCalled();
  });

  it("a missing or invalid console build fails before listening, with no bootstrap output", async () => {
    const { deps, startServer, loadConsoleAssets, writeStdout } = harness();
    const failure = new OperatorConsoleBuildError("BUILD_DIRECTORY_MISSING");
    loadConsoleAssets.mockRejectedValueOnce(failure);
    await expect(runOperatorServerCli([], deps)).rejects.toBe(failure);
    expect(startServer).not.toHaveBeenCalled();
    expect(writeStdout).not.toHaveBeenCalled();
  });

  it("a console build failure formats to one bounded, path-free line", () => {
    expect(formatOperatorServerCliError(new OperatorConsoleBuildError("INDEX_HTML_MISSING"))).toBe(
      "Operator server failed. Reason: Operator console build is missing or invalid (INDEX_HTML_MISSING). Build it with: npm --prefix apps/operator-console run build\n",
    );
  });

  it("startup errors format to one bounded line with no stack or object dump", () => {
    const failure = new Error("listen EADDRINUSE\n    at SECRET_STACK_FRAME");
    failure.stack = "Error\n    at SECRET_STACK_FRAME";
    expect(formatOperatorServerCliError(failure)).toBe("Operator server failed. Reason: listen EADDRINUSE\n");
    expect(formatOperatorServerCliError({ secret: "SECRET" })).toBe(
      "Operator server failed. Reason: non-Error value thrown (type object); contents not shown.\n",
    );
  });
});

describe("D1 operator server thin script", () => {
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
    const cli = await import("../src/operatorServer/cli/runOperatorServerCli.js");
    if (outcome === "resolve") vi.mocked(cli.runOperatorServerCli).mockResolvedValueOnce(undefined);
    else vi.mocked(cli.runOperatorServerCli).mockRejectedValueOnce(failure);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit must not be called");
    }) as never);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await import("../scripts/operator-server.js");
    await flush();
    const written = stderr.mock.calls.map((call) => call[0]);
    stderr.mockRestore();
    return { cli, exit, written };
  }

  it("success writes nothing to stderr and leaves exitCode unset", async () => {
    const { cli, exit, written } = await runScript("resolve");
    expect(cli.runOperatorServerCli).toHaveBeenCalledTimes(1);
    expect(written).toEqual([]);
    expect(process.exitCode).toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
  });

  it("failure is formatted once by the CLI formatter, exitCode 1, no process.exit, no retry", async () => {
    const failure = new Error("listen EADDRINUSE: address already in use 127.0.0.1:4381");
    const { cli, exit, written } = await runScript("reject", failure);
    expect(cli.runOperatorServerCli).toHaveBeenCalledTimes(1);
    expect(cli.formatOperatorServerCliError).toHaveBeenCalledWith(failure);
    expect(written).toEqual([vi.mocked(cli.formatOperatorServerCliError).mock.results[0]!.value]);
    expect(process.exitCode).toBe(1);
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("D1 source boundary, package and portability", () => {
  const read = async (path: string) =>
    (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const imports = (source: string) => [...code(source).matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]).sort();

  const PRODUCTION_IMPORTS: Record<string, string[]> = {
    "src/application/listCanonicalEpisodes.ts": [
      "../execution/executionReservation.schema.js",
      "../validation/loadEpisodeManifest.js",
      "node:fs",
      "node:fs/promises",
      "node:path",
    ],
    "src/application/readEpisodeProductionStatus.ts": [
      "../execution/resolveDurableEpisodeProductionState.js",
      "../schemas/episodeManifest.schema.js",
      "../validation/loadCharacterBible.js",
      "../validation/loadEnvironment.js",
      "../validation/loadEpisodeManifest.js",
      "../validation/loadProductionRules.js",
      "../validation/loadProviderRoutingPolicy.js",
      "../validation/validateMediaRoot.js",
    ],
    "src/application/operatorDtos.ts": [
      "../dialogue/resolveDurableShotDialogueCompositionState.js",
      "../execution/resolveDurableShotVisualGenerationState.js",
      "../planning/executionReadiness.types.js",
      "./listCanonicalEpisodes.js",
      "./readEpisodeProductionStatus.js",
    ],
    "src/operatorServer/operatorRequestSecurity.ts": ["node:crypto"],
    "src/operatorServer/operatorConsoleAssets.ts": ["node:fs/promises"],
    "src/operatorServer/createOperatorServer.ts": [
      "../application/listCanonicalEpisodes.js",
      "../application/operatorDtos.js",
      "../application/readEpisodeProductionStatus.js",
      "./operatorConsoleAssets.js",
      "./operatorRequestSecurity.js",
      "node:crypto",
      "node:http",
    ],
    "src/operatorServer/startOperatorServer.ts": [
      "./createOperatorServer.js",
      "./operatorConsoleAssets.js",
      "./operatorRequestSecurity.js",
    ],
    "src/operatorServer/cli/runOperatorServerCli.ts": [
      "../createOperatorServer.js",
      "../operatorConsoleAssets.js",
      "../startOperatorServer.js",
    ],
    "scripts/operator-server.ts": ["../src/operatorServer/cli/runOperatorServerCli.js"],
  };

  it.each(Object.entries(PRODUCTION_IMPORTS))("%s imports exactly its allowlisted modules", async (path, expected) => {
    expect(imports(await read(path))).toEqual([...expected].sort());
  });

  it("no D1 file references a mutation, provider, process or write authority", async () => {
    for (const path of Object.keys(PRODUCTION_IMPORTS)) {
      expect(code(await read(path)), path).not.toMatch(
        /child_process|coordinateEpisodeAction|runEpisodeAutomation|episodeAutomationPlan|composition\/|runProductionEpisodeRoughCut|\/runway\/|\/veo\/|reconcile|recover|materialize|writeFile|appendFile|mkdir|copyFile|unlink|\bvalidateMediaRoot\s*\(|\bexecFile\b|\bspawn\b/,
      );
    }
  });

  it("the thin script has no exit, retry, own formatting or logging", async () => {
    const source = await read("scripts/operator-server.ts");
    expect(source).toContain("process.exitCode = 1;");
    expect(source.match(/runOperatorServerCli\(\)/g)).toHaveLength(1);
    expect(source).not.toMatch(/process\.exit\s*\(|console\.|JSON\.stringify|\.stack\b/);
  });

  it("no D1 file declares its own episode-ID regex", async () => {
    for (const path of Object.keys(PRODUCTION_IMPORTS)) {
      expect(await read(path), path).not.toMatch(/EP\[0-9\]|\^EP/);
    }
  });

  it("brand text is presentation-only: none in application code and no commercial domains anywhere", async () => {
    for (const path of Object.keys(PRODUCTION_IMPORTS)) {
      expect(await read(path), path).not.toMatch(/busybookie\.(com|ai)/i);
    }
    for (const path of [
      "src/application/listCanonicalEpisodes.ts",
      "src/application/readEpisodeProductionStatus.ts",
      "src/application/operatorDtos.ts",
    ]) {
      // Existing EnvironmentSchema keys (e.g. BUSYBOOKIE_FFPROBE_PATH) are
      // configuration identifiers, not product branding.
      expect(code(await read(path)).replace(/\bBUSYBOOKIE_[A-Z_]+\b/g, ""), path).not.toMatch(/busybookie/i);
    }
  });

  it("package.json adds exactly operator:serve after dialogue:place with unchanged dependencies", async () => {
    const pkg = JSON.parse(await read("package.json")) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const keys = Object.keys(pkg.scripts);
    expect(pkg.scripts["operator:serve"]).toBe("tsx scripts/operator-server.ts");
    expect(keys.indexOf("operator:serve")).toBe(keys.indexOf("dialogue:place") + 1);
    expect(keys.at(-1)).toBe("operator:serve");
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
});
