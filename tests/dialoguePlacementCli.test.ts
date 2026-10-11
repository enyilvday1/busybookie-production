import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  runDialoguePlacementCli,
  type RunDialoguePlacementCliDependencies,
} from "../src/dialogue/cli/runDialoguePlacementCli.js";
import {
  buildShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";
import type {
  VerifiedShotDialogueTiming,
} from "../src/dialogue/verifyShotDialogueTiming.js";
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
  "--scene", "SC01",
  "--shot", "S02",
  "--placements", "EP02_SC01_S02_L01=0.50,EP02_SC01_S02_L02=2.75",
  "--confirm-placement",
];

afterEach(() => {
  vi.restoreAllMocks();
});

async function fixture(ffprobePath?: string) {
  const [episode, bible, rules] = await Promise.all([
    loadEpisodeManifest("EP02"),
    loadCharacterBible(),
    loadProductionRules(),
  ]);
  const scene = episode.scenes.find((candidate) => candidate.id === "SC01")!;
  const shot = scene.shots.find((candidate) => candidate.id === "S02")!;
  const plan = buildShotDialoguePlan({ episodeId: episode.episodeId, sceneId: scene.id, shot, bible });
  // Synthetic timing is returned only by the injected mock; no media is read or probed.
  const timing: VerifiedShotDialogueTiming = {
    schemaVersion: "1.0",
    timingMode: "AGGREGATE_ONLY",
    episodeId: plan.episodeId,
    sceneId: plan.sceneId,
    shotId: plan.shotId,
    planKey: plan.planKey,
    shotDurationSeconds: plan.shotDurationSeconds,
    durationToleranceSeconds: 0.000001,
    totalSpeechDurationSeconds: plan.lines.length,
    remainingDurationSeconds: plan.shotDurationSeconds - plan.lines.length,
    lines: plan.lines.map((line) => ({
      lineNumber: line.lineNumber,
      dialogueLineId: line.dialogueLineId,
      sourceAudioPath: `controlled-fixture/${line.dialogueLineId}.audio`,
      sourceBytes: 100,
      sourceSha256: "a".repeat(64),
      durationSeconds: 1,
    })),
  };
  const env = {
    BUSYBOOKIE_MEDIA_ROOT: "controlled-media-root",
    ...(ffprobePath === undefined ? {} : { BUSYBOOKIE_FFPROBE_PATH: ffprobePath }),
  };
  const events: string[] = [];
  const dependencies = {
    loadEnvironment: vi.fn(() => {
      events.push("environment");
      return env;
    }),
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
    buildShotDialoguePlan: vi.fn<typeof buildShotDialoguePlan>((input) => {
      events.push("plan");
      expect(input).toEqual({ episodeId: "EP02", sceneId: "SC01", shot, bible });
      return plan;
    }),
    verifyShotDialogueAudioTiming: vi.fn<
      RunDialoguePlacementCliDependencies["verifyShotDialogueAudioTiming"]
    >(async () => {
      events.push("timing");
      return timing;
    }),
    createDecision: vi.fn<RunDialoguePlacementCliDependencies["createDecision"]>(
      async (_mediaRoot, input) => {
        events.push("create");
        return {
          record: {
            schemaVersion: "1.0",
            episodeId: plan.episodeId,
            sceneId: plan.sceneId,
            shotId: plan.shotId,
            dialoguePlanKey: plan.planKey,
            revision: 2,
            recordedAt: "2026-10-11T12:00:00.000Z",
            placements: input.placements.map((placement) => ({
              ...placement,
              sourceSha256: "a".repeat(64),
            })),
          },
          decisionPath: "controlled-media-root/decision.json",
        };
      },
    ),
  } satisfies RunDialoguePlacementCliDependencies;
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  return { episode, bible, rules, scene, shot, plan, timing, env, events, dependencies, log };
}

describe("dialogue placement runner", () => {
  it("requires confirmation before every production dependency", async () => {
    const f = await fixture();
    await expect(runDialoguePlacementCli(args.slice(0, -1), f.dependencies))
      .rejects.toThrow(/requires --confirm-placement/);
    for (const dependency of Object.values(f.dependencies)) {
      expect(dependency).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["  controlled-tools/ffprobe.exe  ", "controlled-tools/ffprobe.exe"],
    [undefined, "ffprobe"],
    ["   ", "ffprobe"],
  ])("uses ffprobe configuration %j and fresh evidence", async (configured, expected) => {
    const f = await fixture(configured);
    await runDialoguePlacementCli(args, f.dependencies);

    expect(f.dependencies.loadEnvironment).toHaveBeenCalledExactlyOnceWith();
    expect(f.dependencies.loadProductionRules).toHaveBeenCalledExactlyOnceWith();
    expect(f.dependencies.loadCharacterBible).toHaveBeenCalledExactlyOnceWith();
    expect(f.dependencies.loadEpisodeManifest).toHaveBeenCalledExactlyOnceWith("EP02");
    expect(f.dependencies.validateMediaRoot).toHaveBeenCalledExactlyOnceWith(f.env, f.rules);
    expect(f.dependencies.validateEpisodeProduction).toHaveBeenCalledExactlyOnceWith(
      f.episode, f.bible, f.rules,
    );
    expect(f.dependencies.buildShotDialoguePlan).toHaveBeenCalledExactlyOnceWith({
      episodeId: "EP02", sceneId: "SC01", shot: f.shot, bible: f.bible,
    });
    expect(f.dependencies.verifyShotDialogueAudioTiming).toHaveBeenCalledExactlyOnceWith({
      mediaRoot: f.env.BUSYBOOKIE_MEDIA_ROOT,
      ffprobeExecutable: expected,
      plan: f.plan,
    });
    expect(f.dependencies.createDecision).toHaveBeenCalledExactlyOnceWith(
      f.env.BUSYBOOKIE_MEDIA_ROOT,
      {
        dialoguePlan: f.plan,
        timing: f.timing,
        placements: [
          { dialogueLineId: "EP02_SC01_S02_L01", startSeconds: 0.5 },
          { dialogueLineId: "EP02_SC01_S02_L02", startSeconds: 2.75 },
        ],
      },
    );
    const call = f.dependencies.createDecision.mock.calls[0]!;
    expect(call).toHaveLength(2);
    expect(call[1].dialoguePlan).toBe(f.plan);
    expect(call[1].timing).toBe(f.timing);
    expect(f.events).toEqual(["environment", "media", "production", "plan", "timing", "create"]);
    expect(f.log).toHaveBeenCalledWith(`Dialogue plan key: ${f.plan.planKey}`);
    expect(f.log).toHaveBeenCalledWith("Revision: 2");
    expect(f.log).toHaveBeenCalledWith("Placement count: 2");
    expect(f.log).toHaveBeenCalledWith("Decision path: controlled-media-root/decision.json");
  });

  it("rejects loaded episode identity mismatch before media admission", async () => {
    const f = await fixture();
    f.episode.episodeId = "EP99";
    await expect(runDialoguePlacementCli(args, f.dependencies))
      .rejects.toThrow(/Loaded episode identity does not match/);
    expect(f.dependencies.validateMediaRoot).not.toHaveBeenCalled();
    expect(f.dependencies.verifyShotDialogueAudioTiming).not.toHaveBeenCalled();
    expect(f.dependencies.createDecision).not.toHaveBeenCalled();
  });

  it.each([[3, "SC99", "scene"], [5, "S99", "shot"]] as const)(
    "rejects missing selected identity %s %s",
    async (index, identity, kind) => {
      const f = await fixture();
      const missing = [...args];
      missing[index] = identity;
      await expect(runDialoguePlacementCli(missing, f.dependencies))
        .rejects.toThrow(`could not find ${kind} ${identity}`);
      expect(f.dependencies.buildShotDialoguePlan).not.toHaveBeenCalled();
      expect(f.dependencies.verifyShotDialogueAudioTiming).not.toHaveBeenCalled();
      expect(f.dependencies.createDecision).not.toHaveBeenCalled();
    },
  );

  it("rejects an empty canonical plan before timing or creation", async () => {
    const f = await fixture();
    f.dependencies.buildShotDialoguePlan.mockReturnValueOnce({ ...f.plan, lines: [] });
    await expect(runDialoguePlacementCli(args, f.dependencies))
      .rejects.toThrow(/at least one canonical dialogue line/);
    expect(f.dependencies.verifyShotDialogueAudioTiming).not.toHaveBeenCalled();
    expect(f.dependencies.createDecision).not.toHaveBeenCalled();
  });

  it.each([
    "validateMediaRoot", "validateEpisodeProduction", "buildShotDialoguePlan",
    "verifyShotDialogueAudioTiming", "createDecision",
  ] as const)("propagates %s failure unchanged", async (name) => {
    const f = await fixture();
    const failure = new Error(`Controlled ${name} failure`);
    f.dependencies[name].mockImplementationOnce(() => {
      throw failure;
    });
    await expect(runDialoguePlacementCli(args, f.dependencies)).rejects.toBe(failure);
    if (name !== "createDecision") {
      expect(f.dependencies.createDecision).not.toHaveBeenCalled();
    } else {
      expect(f.dependencies.createDecision).toHaveBeenCalledTimes(1);
    }
    if (name !== "createDecision" && name !== "verifyShotDialogueAudioTiming") {
      expect(f.dependencies.verifyShotDialogueAudioTiming).not.toHaveBeenCalled();
    }
  });

  it("passes operator order unchanged to the durable creator", async () => {
    const f = await fixture();
    const reversed = [...args];
    reversed[7] = "EP02_SC01_S02_L02=2.75,EP02_SC01_S02_L01=0.50";
    await runDialoguePlacementCli(reversed, f.dependencies);
    expect(f.dependencies.createDecision.mock.calls[0]![1].placements).toEqual([
      { dialogueLineId: "EP02_SC01_S02_L02", startSeconds: 2.75 },
      { dialogueLineId: "EP02_SC01_S02_L01", startSeconds: 0.5 },
    ]);
  });
});
