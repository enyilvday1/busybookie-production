import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  runDialogueVisualAuthorizationCli,
  type RunDialogueVisualAuthorizationCliDependencies,
} from "../src/dialogue/cli/runDialogueVisualAuthorizationCli.js";

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

import {
  validateEpisodeProduction,
} from "../src/validation/validateEpisodeProduction.js";

import {
  evaluateShotExecutionReadiness,
} from "../src/planning/evaluateShotExecutionReadiness.js";

import type {
  EpisodeManifest,
} from "../src/schemas/episodeManifest.schema.js";

const args = [
  "--episode", "EP02",
  "--shot", "S02",
  "--provider", "RUNWAY",
  "--confirm-authorization",
];

afterEach(() => {
  vi.restoreAllMocks();
});

const veoArgs = [
  "--episode", "EP02",
  "--shot", "S02",
  "--provider", "VEO",
  "--confirm-authorization",
];

// Advances the repository EP02 fixture to a generation-ready S02 in memory,
// mirroring makeS02Ready in the execution integration tests.
function makeS02Executable(
  episode: EpisodeManifest,
  provider: "RUNWAY" | "VEO",
  nativeAudio: boolean,
): void {
  episode.status = "READY_FOR_GENERATION";
  episode.approvals.script = "APPROVED";
  episode.approvals.storyboard = "APPROVED";
  episode.approvals.references = "APPROVED";
  const shot = episode.scenes[0]!.shots.find((candidate) => candidate.id === "S02")!;
  shot.references = {
    required: true,
    assetIds: ["OLLIE_CHARACTER_MASTER_REFERENCE_V1"],
    approvalStatus: "APPROVED",
  };
  shot.generation.provider = provider;
  shot.generation.nativeAudio = nativeAudio;
  shot.generation.status = "APPROVED_FOR_GENERATION";
}

async function fixture() {
  const [episode, bible, rules, policy] = await Promise.all([
    loadEpisodeManifest("EP02"),
    loadCharacterBible(),
    loadProductionRules(),
    loadProviderRoutingPolicy(),
  ]);
  const events: string[] = [];
  // All environment, media-root and durable operations below are mocks.
  const env = { BUSYBOOKIE_MEDIA_ROOT: "controlled-media-root" };
  const createAuthorization = vi.fn<
    RunDialogueVisualAuthorizationCliDependencies["createAuthorization"]
  >(async (mediaRoot, input) => {
    events.push("create");
    return {
      record: {
        ...input,
        schemaVersion: "1.0",
        authorizationId: "11111111-1111-4111-8111-111111111111",
        authorizedAt: "2026-10-11T12:00:00.000Z",
        status: "AUTHORIZED",
      },
      authorizationPath: `${mediaRoot}/authorization.json`,
    };
  });
  const dependencies = {
    loadEnvironment: vi.fn(() => env),
    loadProductionRules: vi.fn(async () => rules),
    loadCharacterBible: vi.fn(async () => bible),
    loadEpisodeManifest: vi.fn(async () => episode),
    loadProviderRoutingPolicy: vi.fn(async () => policy),
    validateMediaRoot: vi.fn(async () => {
      events.push("media");
      return env.BUSYBOOKIE_MEDIA_ROOT;
    }),
    validateEpisodeProduction: vi.fn<typeof validateEpisodeProduction>((...input) => {
      events.push("production");
      validateEpisodeProduction(...input);
    }),
    // The real readiness policy; only observed, never replaced, by default.
    evaluateShotExecutionReadiness: vi.fn<typeof evaluateShotExecutionReadiness>((...input) => {
      events.push("readiness");
      return evaluateShotExecutionReadiness(...input);
    }),
    createAuthorization,
  } satisfies RunDialogueVisualAuthorizationCliDependencies;

  vi.spyOn(console, "log").mockImplementation(() => undefined);
  return { episode, bible, rules, policy, env, events, dependencies, createAuthorization };
}

describe("dialogue visual authorization runner", () => {
  it("rejects absent confirmation before any production dependency is called", async () => {
    const f = await fixture();

    await expect(runDialogueVisualAuthorizationCli(args.slice(0, -1), f.dependencies))
      .rejects.toThrow(/requires --confirm-authorization/);

    for (const dependency of Object.values(f.dependencies)) {
      expect(dependency).not.toHaveBeenCalled();
    }
    expect(f.dependencies.loadProviderRoutingPolicy).not.toHaveBeenCalled();
    expect(f.dependencies.evaluateShotExecutionReadiness).not.toHaveBeenCalled();
  });

  it("creates exactly one VEO authorization with fixed semantics for an executable canonical VEO shot", async () => {
    const f = await fixture();
    makeS02Executable(f.episode, "VEO", true);

    await runDialogueVisualAuthorizationCli(veoArgs, f.dependencies);

    expect(f.dependencies.loadEpisodeManifest).toHaveBeenCalledExactlyOnceWith("EP02");
    expect(f.dependencies.loadProviderRoutingPolicy).toHaveBeenCalledExactlyOnceWith();
    expect(f.dependencies.validateMediaRoot).toHaveBeenCalledExactlyOnceWith(f.env, f.rules);
    expect(f.dependencies.validateEpisodeProduction).toHaveBeenCalledExactlyOnceWith(
      f.episode, f.bible, f.rules,
    );
    expect(f.dependencies.evaluateShotExecutionReadiness).toHaveBeenCalledExactlyOnceWith(
      f.episode,
      f.episode.scenes[0]!.shots[1],
      f.bible,
      f.rules,
      f.policy,
      { provider: "VEO", source: "DURABLE_DIALOGUE_VISUAL_AUTHORIZATION" },
    );
    expect(f.dependencies.evaluateShotExecutionReadiness).toHaveReturnedWith(
      expect.objectContaining({ disposition: "EXECUTABLE", executionProvider: "VEO" }),
    );
    expect(f.events).toEqual(["media", "production", "readiness", "create"]);
    expect(f.createAuthorization).toHaveBeenCalledExactlyOnceWith(
      f.env.BUSYBOOKIE_MEDIA_ROOT,
      {
        episodeId: "EP02",
        shotId: "S02",
        provider: "VEO",
        purpose: "DIALOGUE_VISUAL_GENERATION",
        nativeAudioDisposition: "DISCARD_AFTER_VISUAL_GENERATION",
        dialogueAuthority: "EXTERNAL_VERIFIED_DIALOGUE",
        authorizationSource: "HUMAN_OPERATOR",
      },
    );
  });

  it("rejects a requested provider that differs from the repository fixture's canonical VEO provider", async () => {
    const f = await fixture();
    expect(f.episode.scenes[0]!.shots[1]!.generation.provider).toBe("VEO");

    await expect(runDialogueVisualAuthorizationCli(args, f.dependencies))
      .rejects.toThrow(
        "requested provider RUNWAY does not match canonical provider VEO for EP02/SC01/S02",
      );
    expect(f.dependencies.evaluateShotExecutionReadiness).not.toHaveBeenCalled();
    expect(f.createAuthorization).not.toHaveBeenCalled();
  });

  it("rejects a provider mismatch even when the canonical shot is otherwise executable", async () => {
    const f = await fixture();
    makeS02Executable(f.episode, "VEO", true);

    await expect(runDialogueVisualAuthorizationCli(args, f.dependencies))
      .rejects.toThrow(/requested provider RUNWAY does not match canonical provider VEO/);
    expect(f.dependencies.evaluateShotExecutionReadiness).not.toHaveBeenCalled();
    expect(f.createAuthorization).not.toHaveBeenCalled();
  });

  it("rejects a canonically matching RUNWAY dialogue shot that the real readiness policy cannot execute", async () => {
    const f = await fixture();
    makeS02Executable(f.episode, "RUNWAY", false);

    await expect(runDialogueVisualAuthorizationCli(args, f.dependencies))
      .rejects.toThrow(
        /EP02\/SC01\/S02 with provider RUNWAY is not executable under current production policy \(readiness NOT_READY\)\. Blockers: .*contains dialogue/,
      );
    expect(f.dependencies.evaluateShotExecutionReadiness).toHaveBeenCalledTimes(1);
    expect(f.createAuthorization).not.toHaveBeenCalled();
  });

  it("rejects the repository VEO fixture while its episode is not yet generation-ready", async () => {
    const f = await fixture();

    await expect(runDialogueVisualAuthorizationCli(veoArgs, f.dependencies))
      .rejects.toThrow(/not executable under current production policy \(readiness NOT_READY\).*status is DRAFT/);
    expect(f.createAuthorization).not.toHaveBeenCalled();
  });

  it.each(["MANUAL_REVIEW", "CONFLICT", "BLOCKED"] as const)("fails closed when readiness reports %s", async (disposition) => {
    const f = await fixture();
    makeS02Executable(f.episode, "VEO", true);
    f.dependencies.evaluateShotExecutionReadiness.mockImplementationOnce((...input) => ({
      ...evaluateShotExecutionReadiness(...input),
      disposition,
      blockers: ["Controlled readiness blocker"],
    }));

    await expect(runDialogueVisualAuthorizationCli(veoArgs, f.dependencies))
      .rejects.toThrow(`(readiness ${disposition}). Blockers: Controlled readiness blocker`);
    expect(f.createAuthorization).not.toHaveBeenCalled();
  });

  it("fails closed when readiness is executable for a different provider", async () => {
    const f = await fixture();
    makeS02Executable(f.episode, "VEO", true);
    f.dependencies.evaluateShotExecutionReadiness.mockImplementationOnce((...input) => ({
      ...evaluateShotExecutionReadiness(...input),
      executionProvider: "RUNWAY",
    }));

    await expect(runDialogueVisualAuthorizationCli(veoArgs, f.dependencies))
      .rejects.toThrow(/not executable under current production policy/);
    expect(f.createAuthorization).not.toHaveBeenCalled();
  });

  it.each(["evaluateShotExecutionReadiness", "loadProviderRoutingPolicy"] as const)("propagates %s failure before creation", async (dependency) => {
    const f = await fixture();
    makeS02Executable(f.episode, "VEO", true);
    const failure = new Error("Controlled policy failure");
    f.dependencies[dependency].mockImplementationOnce(() => {
      throw failure;
    });

    await expect(runDialogueVisualAuthorizationCli(veoArgs, f.dependencies))
      .rejects.toBe(failure);
    expect(f.createAuthorization).not.toHaveBeenCalled();
  });

  it("rejects a loaded episode identity mismatch", async () => {
    const f = await fixture();
    f.episode.episodeId = "EP99";

    await expect(runDialogueVisualAuthorizationCli(args, f.dependencies))
      .rejects.toThrow(/Loaded episode identity does not match/);
    expect(f.dependencies.validateMediaRoot).not.toHaveBeenCalled();
    expect(f.createAuthorization).not.toHaveBeenCalled();
  });

  it("rejects a missing shot", async () => {
    const f = await fixture();
    const missingArgs = [...args];
    missingArgs[3] = "S99";

    await expect(runDialogueVisualAuthorizationCli(missingArgs, f.dependencies))
      .rejects.toThrow(/could not find shot S99/);
    expect(f.createAuthorization).not.toHaveBeenCalled();
  });

  it("rejects duplicate shot IDs across scenes even if an injected loader admits them", async () => {
    const f = await fixture();
    const duplicate = structuredClone(f.episode.scenes[0]!);
    duplicate.id = "SC02";
    f.episode.scenes.push(duplicate);

    await expect(runDialogueVisualAuthorizationCli(args, f.dependencies))
      .rejects.toThrow(/multiple shots named S02/);
    expect(f.createAuthorization).not.toHaveBeenCalled();
  });

  it("rejects a shot without declared dialogue", async () => {
    const f = await fixture();
    const nonDialogueArgs = [...args];
    nonDialogueArgs[3] = "S01";

    await expect(runDialogueVisualAuthorizationCli(nonDialogueArgs, f.dependencies))
      .rejects.toThrow(/contains no dialogue/);
    expect(f.createAuthorization).not.toHaveBeenCalled();
  });

  it.each(["validateMediaRoot", "validateEpisodeProduction"] as const)("propagates %s failure before creation", async (dependency) => {
    const f = await fixture();
    const failure = new Error("Controlled admission failure");
    f.dependencies[dependency].mockImplementationOnce(() => {
      throw failure;
    });

    await expect(runDialogueVisualAuthorizationCli(args, f.dependencies))
      .rejects.toBe(failure);
    expect(f.createAuthorization).not.toHaveBeenCalled();
  });

  it.each(["Dialogue visual authorization already exists", "Controlled write failure"])("propagates creator failure: %s", async (message) => {
    const f = await fixture();
    makeS02Executable(f.episode, "VEO", true);
    const failure = new Error(message);
    f.createAuthorization.mockRejectedValueOnce(failure);

    await expect(runDialogueVisualAuthorizationCli(veoArgs, f.dependencies))
      .rejects.toBe(failure);
    expect(f.createAuthorization).toHaveBeenCalledTimes(1);
  });
});
