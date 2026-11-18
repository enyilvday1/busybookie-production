import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv/config", () => ({}));
// Pass-through spies: each test decides whether the real gate and verifier
// run, and the CLI is always stubbed so no server ever starts.
vi.mock("../src/operatorServer/cli/runOperatorServerCli.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/operatorServer/cli/runOperatorServerCli.js")>();
  return {
    ...actual,
    runOperatorServerCli: vi.fn(async () => undefined),
    formatOperatorServerCliError: vi.fn(actual.formatOperatorServerCliError),
  };
});
vi.mock("../src/execution/portableReleaseRuntimeIdentity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/portableReleaseRuntimeIdentity.js")>();
  return {
    ...actual,
    requirePortableReleaseWorkingDirectory: vi.fn(actual.requirePortableReleaseWorkingDirectory),
    requirePortableReleaseIdentity: vi.fn(actual.requirePortableReleaseIdentity),
  };
});

import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PortableReleaseIdentityError,
  requirePortableReleaseWorkingDirectory,
} from "../src/execution/portableReleaseRuntimeIdentity.js";

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
// A real absolute directory that is not the release root.
const OTHER_DIRECTORY = resolve(tmpdir());

const MISMATCH_LINE =
  "Operator server failed. Reason: Portable release identity verification failed (RELEASE_ROOT_WORKING_DIRECTORY_MISMATCH).\n";

const flush = () => new Promise((resolveTick) => setTimeout(resolveTick, 0));

function deferred() {
  let resolveDeferred!: () => void;
  const promise = new Promise<void>((onResolve) => (resolveDeferred = onResolve));
  return { promise, resolve: resolveDeferred };
}

async function freshModules() {
  vi.resetModules();
  const cli = await import("../src/operatorServer/cli/runOperatorServerCli.js");
  const identity = await import("../src/execution/portableReleaseRuntimeIdentity.js");
  const binding = await import("../src/execution/episodeInputBinding.js");
  return { cli, identity, binding };
}

type Verified = Awaited<ReturnType<typeof import("../src/execution/portableReleaseRuntimeIdentity.js").requirePortableReleaseIdentity>>;

describe("release-root / working-directory gate", () => {
  it("accepts exactly the release root, with or without a trailing separator", () => {
    expect(() => requirePortableReleaseWorkingDirectory(REPOSITORY_ROOT, REPOSITORY_ROOT)).not.toThrow();
    expect(() => requirePortableReleaseWorkingDirectory(`${REPOSITORY_ROOT}/`, REPOSITORY_ROOT)).not.toThrow();
  });

  it.each([
    ["an unrelated directory", OTHER_DIRECTORY],
    ["a child of the release root", join(REPOSITORY_ROOT, "episodes")],
    ["the parent of the release root", resolve(REPOSITORY_ROOT, "..")],
  ])("refuses %s with one fixed, path-free error and no cause", (_label, workingDirectory) => {
    let failure: unknown;
    try {
      requirePortableReleaseWorkingDirectory(REPOSITORY_ROOT, workingDirectory);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(PortableReleaseIdentityError);
    expect(failure).toMatchObject({ failure: "RELEASE_ROOT_WORKING_DIRECTORY_MISMATCH" });
    expect((failure as Error).message).toBe(
      "Portable release identity verification failed (RELEASE_ROOT_WORKING_DIRECTORY_MISMATCH).",
    );
    expect((failure as Error).cause).toBeUndefined();
    expect((failure as Error).message).not.toContain(REPOSITORY_ROOT);
    expect((failure as Error).message).not.toContain(workingDirectory);
  });
});

describe("compiled production operator bootstrap (npm start)", () => {
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  // The working directory is a seam: process.cwd is spied, never changed.
  // `settled` waits for a bootstrap whose real verification performs file I/O
  // and so outlasts a single flush.
  async function runBootstrap(
    options: Readonly<{
      script?: string;
      workingDirectory?: string;
      settled?: () => boolean;
    }> = {},
  ) {
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(options.workingDirectory ?? REPOSITORY_ROOT);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit must not be called");
    }) as never);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await import(options.script ?? "../src/operatorServer/operatorServerProcess.js");
    await flush();
    if (options.settled !== undefined) {
      const settled = options.settled;
      await vi.waitFor(() => {
        if (!settled()) throw new Error("bootstrap not settled");
      }, { timeout: 10_000 });
    }
    const written = stderr.mock.calls.map((call) => String(call[0]));
    stderr.mockRestore();
    cwd.mockRestore();
    return { exit, written };
  }

  it("gates the working directory, verifies once, then enters the CLI once, in that order", async () => {
    const { cli, identity, binding } = await freshModules();
    vi.mocked(identity.requirePortableReleaseIdentity).mockResolvedValueOnce(undefined as unknown as Verified);

    const { exit, written } = await runBootstrap();

    const gate = vi.mocked(identity.requirePortableReleaseWorkingDirectory);
    const verify = vi.mocked(identity.requirePortableReleaseIdentity);
    const run = vi.mocked(cli.runOperatorServerCli);

    expect(gate).toHaveBeenCalledTimes(1);
    const [gateRoot, workingDirectory] = gate.mock.calls[0]!;
    // The release root the console assets are served from: two levels above
    // the module. The working directory comes from process.cwd().
    expect(resolve(gateRoot)).toBe(REPOSITORY_ROOT);
    expect(workingDirectory).toBe(REPOSITORY_ROOT);

    expect(verify).toHaveBeenCalledTimes(1);
    const [verifyRoot, dependencies] = verify.mock.calls[0]!;
    expect(verifyRoot).toBe(gateRoot);
    expect(dependencies).toEqual({
      readBoundFile: binding.readBoundFile,
      requireLinkSafeContainedPath: binding.requireLinkSafeContainedPath,
    });

    // Console load, listen and token output all happen inside the CLI.
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith();
    expect(gate.mock.invocationCallOrder[0]!).toBeLessThan(verify.mock.invocationCallOrder[0]!);
    expect(verify.mock.invocationCallOrder[0]!).toBeLessThan(run.mock.invocationCallOrder[0]!);

    expect(written).toEqual([]);
    expect(process.exitCode).toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
  });

  it("does not enter the CLI (console assets, listener, token) until verification settles", async () => {
    const { cli, identity } = await freshModules();
    const pending = deferred();
    vi.mocked(identity.requirePortableReleaseIdentity).mockReturnValueOnce(
      pending.promise as unknown as Promise<Verified>,
    );

    await runBootstrap();
    expect(identity.requirePortableReleaseIdentity).toHaveBeenCalledTimes(1);
    expect(cli.runOperatorServerCli).not.toHaveBeenCalled();

    pending.resolve();
    await flush();
    expect(cli.runOperatorServerCli).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an unrelated directory", OTHER_DIRECTORY],
    ["a child of the release root", join(REPOSITORY_ROOT, "config")],
  ])(
    "a working directory of %s fails before verification and never enters the CLI, with no path reported",
    async (_label, workingDirectory) => {
      const { cli, identity } = await freshModules();

      const { exit, written } = await runBootstrap({ workingDirectory });

      expect(identity.requirePortableReleaseWorkingDirectory).toHaveBeenCalledTimes(1);
      expect(identity.requirePortableReleaseIdentity).not.toHaveBeenCalled();
      expect(cli.runOperatorServerCli).not.toHaveBeenCalled();
      expect(cli.formatOperatorServerCliError).toHaveBeenCalledTimes(1);
      expect(written).toEqual([MISMATCH_LINE]);

      const reported = written.join("");
      expect(reported).not.toContain(REPOSITORY_ROOT);
      expect(reported).not.toContain(workingDirectory);
      expect(process.exitCode).toBe(1);
      expect(exit).not.toHaveBeenCalled();
    },
  );

  it("a verification failure never enters the CLI and exits 1 with one bounded, path-free line", async () => {
    const { cli, identity } = await freshModules();
    const failure = new identity.PortableReleaseIdentityError("RELEASE_IDENTITY_INVALID");
    vi.mocked(identity.requirePortableReleaseIdentity).mockRejectedValueOnce(failure);

    const { exit, written } = await runBootstrap();

    expect(identity.requirePortableReleaseIdentity).toHaveBeenCalledTimes(1);
    expect(cli.runOperatorServerCli).not.toHaveBeenCalled();
    expect(cli.formatOperatorServerCliError).toHaveBeenCalledTimes(1);
    expect(cli.formatOperatorServerCliError).toHaveBeenCalledWith(failure);
    expect(written).toEqual([
      "Operator server failed. Reason: Portable release identity verification failed (RELEASE_IDENTITY_INVALID).\n",
    ]);
    expect(process.exitCode).toBe(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it("with the real gate and verifier, a matching tree without a release identity is refused before the CLI", async () => {
    // The source checkout has no busybookie-release-identity.json, so the
    // compiled production path must refuse it rather than fall back to Git.
    const { cli, identity } = await freshModules();

    const { exit, written } = await runBootstrap({
      settled: () => process.exitCode !== undefined || vi.mocked(cli.runOperatorServerCli).mock.calls.length > 0,
    });

    expect(identity.requirePortableReleaseIdentity).toHaveBeenCalledTimes(1);
    expect(cli.runOperatorServerCli).not.toHaveBeenCalled();
    expect(written).toEqual([
      "Operator server failed. Reason: Portable release identity verification failed (RELEASE_IDENTITY_MISSING).\n",
    ]);
    expect(written.join("")).not.toContain(REPOSITORY_ROOT);
    expect(process.exitCode).toBe(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it("the source development script is not given the gate or the production-manifest requirement", async () => {
    const { cli, identity } = await freshModules();

    const { exit, written } = await runBootstrap({
      script: "../scripts/operator-server.js",
      workingDirectory: OTHER_DIRECTORY,
    });

    expect(identity.requirePortableReleaseWorkingDirectory).not.toHaveBeenCalled();
    expect(identity.requirePortableReleaseIdentity).not.toHaveBeenCalled();
    expect(cli.runOperatorServerCli).toHaveBeenCalledTimes(1);
    expect(written).toEqual([]);
    expect(process.exitCode).toBeUndefined();
    expect(exit).not.toHaveBeenCalled();

    const source = await readFile(new URL("../scripts/operator-server.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/portableReleaseRuntimeIdentity|requirePortableRelease|release-identity|process\.cwd/);
  });
});
