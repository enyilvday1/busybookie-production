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
  validateEpisodeProduction,
} from "../src/validation/validateEpisodeProduction.js";

const args = [
  "--episode", "EP02",
  "--shot", "S02",
  "--provider", "RUNWAY",
  "--confirm-authorization",
];

afterEach(() => {
  vi.restoreAllMocks();
});

async function fixture() {
  const [episode, bible, rules] = await Promise.all([
    loadEpisodeManifest("EP02"),
    loadCharacterBible(),
    loadProductionRules(),
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
    validateMediaRoot: vi.fn(async () => {
      events.push("media");
      return env.BUSYBOOKIE_MEDIA_ROOT;
    }),
    validateEpisodeProduction: vi.fn<typeof validateEpisodeProduction>((...input) => {
      events.push("production");
      validateEpisodeProduction(...input);
    }),
    createAuthorization,
  } satisfies RunDialogueVisualAuthorizationCliDependencies;

  vi.spyOn(console, "log").mockImplementation(() => undefined);
  return { episode, bible, rules, env, events, dependencies, createAuthorization };
}

describe("dialogue visual authorization runner", () => {
  it("rejects absent confirmation before any production dependency is called", async () => {
    const f = await fixture();

    await expect(runDialogueVisualAuthorizationCli(args.slice(0, -1), f.dependencies))
      .rejects.toThrow(/requires --confirm-authorization/);

    for (const dependency of Object.values(f.dependencies)) {
      expect(dependency).not.toHaveBeenCalled();
    }
  });

  it.each(["RUNWAY", "VEO"])("creates exactly one %s authorization with fixed semantics", async (provider) => {
    const f = await fixture();
    const confirmedArgs = [...args];
    confirmedArgs[5] = provider;

    await runDialogueVisualAuthorizationCli(confirmedArgs, f.dependencies);

    expect(f.dependencies.loadEpisodeManifest).toHaveBeenCalledExactlyOnceWith("EP02");
    expect(f.dependencies.validateMediaRoot).toHaveBeenCalledExactlyOnceWith(f.env, f.rules);
    expect(f.dependencies.validateEpisodeProduction).toHaveBeenCalledExactlyOnceWith(
      f.episode, f.bible, f.rules,
    );
    expect(f.events).toEqual(["media", "production", "create"]);
    expect(f.createAuthorization).toHaveBeenCalledExactlyOnceWith(
      f.env.BUSYBOOKIE_MEDIA_ROOT,
      {
        episodeId: "EP02",
        shotId: "S02",
        provider,
        purpose: "DIALOGUE_VISUAL_GENERATION",
        nativeAudioDisposition: "DISCARD_AFTER_VISUAL_GENERATION",
        dialogueAuthority: "EXTERNAL_VERIFIED_DIALOGUE",
        authorizationSource: "HUMAN_OPERATOR",
      },
    );
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
    const failure = new Error(message);
    f.createAuthorization.mockRejectedValueOnce(failure);

    await expect(runDialogueVisualAuthorizationCli(args, f.dependencies))
      .rejects.toBe(failure);
    expect(f.createAuthorization).toHaveBeenCalledTimes(1);
  });
});
