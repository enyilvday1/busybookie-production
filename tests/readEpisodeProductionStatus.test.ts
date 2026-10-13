import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

// The production read path imports loadEnvironment, which loads dotenv/config
// on import; tests never read a local .env.
vi.mock("dotenv/config", () => ({}));

import {
  readEpisodeProductionStatus,
  type ReadEpisodeProductionStatusDependencies,
} from "../src/application/readEpisodeProductionStatus.js";
import { runExecutionStatusCli } from "../src/execution/cli/runExecutionStatusCli.js";
import type { DurableEpisodeProductionState } from "../src/execution/resolveDurableEpisodeProductionState.js";
import type { Environment } from "../src/schemas/environment.schema.js";
import type { EpisodeManifest } from "../src/schemas/episodeManifest.schema.js";

const RULES = Object.freeze({ fixture: "rules" });
const BIBLE = Object.freeze({ fixture: "bible" });
const POLICY = Object.freeze({ fixture: "policy" });
const EPISODE = Object.freeze({ episodeId: "EP02", title: "Fixture", scenes: [] }) as unknown as EpisodeManifest;
const STATE = Object.freeze({ episodeId: "EP02", shots: [], summary: {} }) as unknown as DurableEpisodeProductionState;

function environment(ffprobe?: string): Environment {
  return {
    BUSYBOOKIE_MEDIA_ROOT: "Z:/controlled-media-root",
    ...(ffprobe === undefined ? {} : { BUSYBOOKIE_FFPROBE_PATH: ffprobe }),
  } as Environment;
}

function harness(env: Environment = environment()) {
  const deps = {
    loadEnvironment: vi.fn(() => env),
    loadProductionRules: vi.fn(async () => RULES),
    loadCharacterBible: vi.fn(async () => BIBLE),
    loadEpisodeManifest: vi.fn(async () => EPISODE),
    loadProviderRoutingPolicy: vi.fn(async () => POLICY),
    resolveMediaRoot: vi.fn(() => "Z:/controlled-media-root"),
    resolveEpisodeProductionState: vi.fn(async (_input: unknown) => STATE),
  };
  return { deps, typed: deps as unknown as ReadEpisodeProductionStatusDependencies };
}

describe("D1 readEpisodeProductionStatus", () => {
  it("composes the canonical loaders and read-only preflight, then returns C4 state by reference", async () => {
    const { deps, typed } = harness();
    const status = await readEpisodeProductionStatus("EP02", typed);

    expect(status.episode).toBe(EPISODE);
    expect(status.state).toBe(STATE);
    expect(Object.isFrozen(status)).toBe(true);
    expect(deps.loadEpisodeManifest).toHaveBeenCalledWith("EP02");
    expect(deps.resolveMediaRoot).toHaveBeenCalledWith(deps.loadEnvironment.mock.results[0]!.value, RULES);
    expect(deps.resolveEpisodeProductionState.mock.calls).toEqual([
      [
        {
          episode: EPISODE,
          bible: BIBLE,
          rules: RULES,
          policy: POLICY,
          mediaRoot: "Z:/controlled-media-root",
          ffprobeExecutable: "ffprobe",
        },
      ],
    ]);
  });

  it("uses a trimmed configured ffprobe path", async () => {
    const { deps, typed } = harness(environment("  C:/tools/ffprobe.exe  "));
    await readEpisodeProductionStatus("EP02", typed);
    expect(deps.resolveEpisodeProductionState.mock.calls[0]![0]).toMatchObject({ ffprobeExecutable: "C:/tools/ffprobe.exe" });
  });

  it("rejects an identity mismatch before media-root resolution or C4", async () => {
    const { deps, typed } = harness();
    deps.loadEpisodeManifest.mockResolvedValueOnce({ ...EPISODE, episodeId: "EP03" } as EpisodeManifest);
    await expect(readEpisodeProductionStatus("EP02", typed)).rejects.toThrow(
      "Loaded episode identity does not match the requested episode.",
    );
    expect(deps.resolveMediaRoot).not.toHaveBeenCalled();
    expect(deps.resolveEpisodeProductionState).not.toHaveBeenCalled();
  });

  it.each([
    "loadEnvironment",
    "loadProductionRules",
    "resolveMediaRoot",
    "resolveEpisodeProductionState",
  ] as const)("a %s failure propagates unchanged", async (stage) => {
    const { deps, typed } = harness();
    const failure = new Error(`${stage} failed`);
    if (stage === "loadEnvironment" || stage === "resolveMediaRoot") {
      deps[stage].mockImplementationOnce(() => {
        throw failure;
      });
    } else {
      deps[stage].mockRejectedValueOnce(failure);
    }
    await expect(readEpisodeProductionStatus("EP02", typed)).rejects.toBe(failure);
  });

  it("matches the execution:status CLI composition exactly (parity)", async () => {
    const service = harness(environment(" ffprobe-x "));
    await readEpisodeProductionStatus("EP02", service.typed);
    const cli = harness(environment(" ffprobe-x "));
    await runExecutionStatusCli(["--episode", "EP02"], { ...cli.deps, writeStdout: vi.fn() } as never);

    expect(service.deps.resolveEpisodeProductionState.mock.calls).toEqual(cli.deps.resolveEpisodeProductionState.mock.calls);
    expect(service.deps.loadEpisodeManifest.mock.calls).toEqual(cli.deps.loadEpisodeManifest.mock.calls);
    expect(service.deps.resolveMediaRoot.mock.calls).toEqual(cli.deps.resolveMediaRoot.mock.calls);
  });

  it("imports only the read-only media-root resolver, never validateMediaRoot itself", async () => {
    const source = await readFile(new URL("../src/application/readEpisodeProductionStatus.ts", import.meta.url), "utf8");
    expect(source).toMatch(/import\s*\{\s*resolveAndValidateMediaRootPath,?\s*\}\s*from\s*"\.\.\/validation\/validateMediaRoot\.js"/);
    expect(source).not.toMatch(/\bvalidateMediaRoot\s*\(/);
  });
});
