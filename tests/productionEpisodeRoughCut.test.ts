import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Module-load observation: the preflight module (which statically loads
// dotenv/config) must only be imported lazily, after the confirmation gate.
const state = vi.hoisted(() => ({
  preflightModuleLoaded: false,
  dotenvLoaded: false,
  preflightResult: undefined as unknown,
}));

vi.mock("dotenv/config", () => {
  state.dotenvLoaded = true;
  return {};
});
vi.mock("../src/composition/runCompositionPreflight.js", () => {
  state.preflightModuleLoaded = true;
  return { runCompositionPreflight: vi.fn(async () => state.preflightResult) };
});
// Pass-through spies so default seam wiring can be observed without executing
// any operational default in this file.
vi.mock("../src/validation/loadEpisodeManifest.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/validation/loadEpisodeManifest.js")>();
  return { ...actual, loadEpisodeManifest: vi.fn(actual.loadEpisodeManifest) };
});
vi.mock("../src/validation/loadCharacterBible.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/validation/loadCharacterBible.js")>();
  return { ...actual, loadCharacterBible: vi.fn(actual.loadCharacterBible) };
});
vi.mock("../src/composition/buildEpisodeCompositionPlan.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/composition/buildEpisodeCompositionPlan.js")>();
  return { ...actual, buildEpisodeCompositionPlan: vi.fn(actual.buildEpisodeCompositionPlan) };
});
vi.mock("../src/composition/composeEpisodeRoughCut.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/composition/composeEpisodeRoughCut.js")>();
  return { ...actual, composeEpisodeRoughCut: vi.fn(actual.composeEpisodeRoughCut) };
});
// Pass-through spies proving that no child process (FFmpeg/ffprobe) starts.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: vi.fn(actual.execFile),
    spawn: vi.fn(actual.spawn),
    exec: vi.fn(actual.exec),
  };
});

import { exec, execFile, spawn } from "node:child_process";

import { buildEpisodeCompositionPlan } from "../src/composition/buildEpisodeCompositionPlan.js";
import type {
  EpisodeCompositionPlan,
  EpisodeCompositionPlanShot,
} from "../src/composition/buildEpisodeCompositionPlan.js";
import { buildCompositionShotNormalizationPlan } from "../src/composition/buildCompositionShotNormalizationPlan.js";
import { buildDialogueCompositionShotNormalizationPlan } from "../src/composition/buildDialogueCompositionShotNormalizationPlan.js";
import {
  buildEpisodeRoughCutRenderPlan,
  type EpisodeRoughCutRenderPlan,
} from "../src/composition/buildEpisodeRoughCutRenderPlan.js";
import {
  composeEpisodeRoughCut,
  type ComposedEpisodeRoughCut,
} from "../src/composition/composeEpisodeRoughCut.js";
import { ensureEpisodeRoughCutRender } from "../src/composition/ensureEpisodeRoughCutRender.js";
import type { EpisodeRoughCutRenderRecord } from "../src/composition/episodeRoughCutRenderRecord.schema.js";
import { prepareEpisodeComposition } from "../src/composition/prepareEpisodeComposition.js";
import type { CompositionSourceMediaMetadata } from "../src/composition/probeCompositionSourceMedia.js";
import type { CompositionPreflightResult } from "../src/composition/runCompositionPreflight.js";
import {
  runProductionEpisodeRoughCut,
  type RunProductionEpisodeRoughCutDependencies,
  type RunProductionEpisodeRoughCutInput,
} from "../src/composition/runProductionEpisodeRoughCut.js";
import { verifyEpisodeRoughCutOutput } from "../src/composition/verifyEpisodeRoughCutOutput.js";
import type { DialogueCompositionAudioPlan } from "../src/dialogue/buildDialogueCompositionAudioPlan.js";
import { buildShotDialoguePlan, type ShotDialoguePlan } from "../src/dialogue/buildShotDialoguePlan.js";
import type { ExecutionLifecycleReconciliationResult } from "../src/execution/reconcileExecutionLifecycle.js";
import type { CharacterBible } from "../src/schemas/character.schema.js";
import type { EpisodeManifest } from "../src/schemas/episodeManifest.schema.js";
import type { ProductionRules } from "../src/schemas/productionRules.schema.js";
import { loadCharacterBible } from "../src/validation/loadCharacterBible.js";
import { loadEpisodeManifest } from "../src/validation/loadEpisodeManifest.js";

// Fixture paths only; nothing in this file reads or writes them.
const MEDIA_ROOT = "D:/Busybookie/Production";
const FFMPEG = "D:/Tools/ffmpeg/bin/ffmpeg.exe";
const FFPROBE = "D:/Tools/ffmpeg/bin/ffprobe.exe";
const RENDER_KEY = "a".repeat(64);
const OUTPUT_PATH = `${MEDIA_ROOT}/exports/EP02/rough-cut/EP02_rough-cut_${RENDER_KEY}.mp4`;
const RECORD_PATH = `${MEDIA_ROOT}/exports/EP02/rough-cut/EP02_rough-cut_${RENDER_KEY}.composition-rough-cut.json`;
const FORBIDDEN_WORDING =
  /\b(complete|completed|completion|final|finalized|master|publish|published|publish-ready|ready|delivery|delivered|release|released)\b/i;

const POST_PRODUCTION: ProductionRules["postProduction"] = Object.freeze({
  aspectRatio: "16:9",
  width: 1920,
  height: 1080,
  timelineFps: 25,
  audioSampleRateHz: 48000,
});

const EPISODE = Object.freeze({ episodeId: "EP02", title: "Fixture", scenes: [] }) as unknown as EpisodeManifest;
const BIBLE = Object.freeze({ characters: [] }) as unknown as CharacterBible;
const PREFLIGHT = Object.freeze({
  mediaRoot: MEDIA_ROOT,
  rules: Object.freeze({ postProduction: POST_PRODUCTION }),
  mediaToolchain: Object.freeze({
    ffmpegExecutable: FFMPEG,
    ffprobeExecutable: FFPROBE,
    ffmpegVersionOutput: "ffmpeg version fixture",
    ffprobeVersionOutput: "ffprobe version fixture",
  }),
}) as unknown as CompositionPreflightResult;
const PLAN = Object.freeze({ episodeId: "EP02", title: "Fixture", totalShots: 0, totalDurationSeconds: 0, shots: [] }) as unknown as EpisodeCompositionPlan;

function composed(renderStatus: "HIT" | "MATERIALIZED"): ComposedEpisodeRoughCut {
  return Object.freeze({
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
  }) as unknown as ComposedEpisodeRoughCut;
}

const VALID_INPUT: RunProductionEpisodeRoughCutInput = Object.freeze({
  episodeId: "EP02",
  confirmLocalComposition: true,
});

const STAGES = ["manifest", "bible", "preflight", "plan", "compose"] as const;
type Stage = (typeof STAGES)[number];

function harness(composition: ComposedEpisodeRoughCut = composed("MATERIALIZED")) {
  const events: Stage[] = [];
  const loadManifest = vi.fn(async (_episodeId: string) => {
    events.push("manifest");
    return EPISODE;
  });
  const loadBible = vi.fn(async () => {
    events.push("bible");
    return BIBLE;
  });
  const preflight = vi.fn(async () => {
    events.push("preflight");
    return PREFLIGHT;
  });
  const buildPlan = vi.fn(async () => {
    events.push("plan");
    return PLAN;
  });
  const compose = vi.fn(async () => {
    events.push("compose");
    return composition;
  });
  const deps = {
    loadEpisodeManifest: loadManifest,
    loadCharacterBible: loadBible,
    runCompositionPreflight: preflight,
    buildEpisodeCompositionPlan: buildPlan,
    composeEpisodeRoughCut: compose,
  } as unknown as RunProductionEpisodeRoughCutDependencies;
  const mocks: Record<Stage, ReturnType<typeof vi.fn>> = {
    manifest: loadManifest,
    bible: loadBible,
    preflight,
    plan: buildPlan,
    compose,
  };
  const totalCalls = () => Object.values(mocks).reduce((sum, mock) => sum + mock.mock.calls.length, 0);
  return { events, deps, mocks, totalCalls };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolveTick) => setTimeout(resolveTick, 0));

describe("C8 A local confirmation gate", () => {
  it.each([
    ["missing", { episodeId: "EP02" }],
    ["false", { episodeId: "EP02", confirmLocalComposition: false }],
    ["string true", { episodeId: "EP02", confirmLocalComposition: "true" }],
    ["number 1", { episodeId: "EP02", confirmLocalComposition: 1 }],
    ["null", { episodeId: "EP02", confirmLocalComposition: null }],
    ["array", { episodeId: "EP02", confirmLocalComposition: [true] }],
  ])("rejects a %s confirmation before any dependency call", async (_label, input) => {
    const { deps, totalCalls } = harness();
    await expect(runProductionEpisodeRoughCut(input as never, deps)).rejects.toThrow(
      "Episode rough-cut requires explicit local composition confirmation (confirmLocalComposition: true).",
    );
    expect(totalCalls()).toBe(0);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an array", [VALID_INPUT]],
    ["a string", "EP02"],
  ])("rejects %s input before any dependency call", async (_label, input) => {
    const { deps, totalCalls } = harness();
    await expect(runProductionEpisodeRoughCut(input as never, deps)).rejects.toThrow(
      "Episode rough-cut input must be an object.",
    );
    expect(totalCalls()).toBe(0);
  });

  it("is not satisfied by paid-generation or reconciliation confirmations", async () => {
    const { deps, totalCalls } = harness();
    for (const input of [
      { episodeId: "EP02", confirmPaidGeneration: true },
      { episodeId: "EP02", confirmReconciliation: true },
    ]) {
      await expect(runProductionEpisodeRoughCut(input as never, deps)).rejects.toThrow(
        "explicit local composition confirmation",
      );
    }
    expect(totalCalls()).toBe(0);
  });
});

describe("C8 B strict input and canonical episode ID", () => {
  it.each([
    ["an unknown field", { ...VALID_INPUT, mediaRoot: "E:/elsewhere" }],
    ["a plan override", { ...VALID_INPUT, compositionPlan: {} }],
    ["a symbol field", { ...VALID_INPUT, [Symbol("extra")]: true }],
  ])("rejects %s before any dependency call", async (_label, input) => {
    const { deps, totalCalls } = harness();
    await expect(runProductionEpisodeRoughCut(input as never, deps)).rejects.toThrow(
      "Episode rough-cut input contains an unsupported field.",
    );
    expect(totalCalls()).toBe(0);
  });

  it.each(["EP2", "ep02", "EP0002", "../EP02", "EP02/../../secrets", "", " EP02", 2, undefined])(
    "rejects episode ID %j without echoing it",
    async (episodeId) => {
      const { deps, totalCalls } = harness();
      const rejection = runProductionEpisodeRoughCut(
        { episodeId, confirmLocalComposition: true } as never,
        deps,
      ).catch((error: unknown) => error);
      const error = (await rejection) as Error;
      expect(error.message).toBe("Episode rough-cut requires a canonical episode ID (EP## or EP###).");
      if (typeof episodeId === "string" && episodeId.length > 0) {
        expect(error.message).not.toContain(episodeId.trim());
      }
      expect(totalCalls()).toBe(0);
    },
  );

  it("accepts three-digit canonical IDs", async () => {
    const { deps, mocks } = harness();
    mocks.manifest.mockResolvedValueOnce({ ...EPISODE, episodeId: "EP123" });
    const result = await runProductionEpisodeRoughCut({ episodeId: "EP123", confirmLocalComposition: true }, deps);
    expect(result.episodeId).toBe("EP123");
    expect(mocks.manifest).toHaveBeenCalledWith("EP123");
  });
});

describe("C8 C input is captured before the first await", () => {
  it("a caller mutating its input during loading cannot change the selected episode", async () => {
    const { deps, mocks } = harness();
    const gate = deferred<EpisodeManifest>();
    mocks.manifest.mockImplementationOnce(() => gate.promise);
    const input = { episodeId: "EP02", confirmLocalComposition: true as const };
    const running = runProductionEpisodeRoughCut(input, deps);
    (input as { episodeId: string }).episodeId = "EP03";
    gate.resolve(EPISODE);
    const result = await running;
    expect(mocks.manifest).toHaveBeenCalledWith("EP02");
    expect(result.episodeId).toBe("EP02");
  });
});

describe("C8 D every earlier failure stops later stages", () => {
  it("a manifest identity mismatch stops the bible, preflight, plan and composition", async () => {
    const { deps, mocks, events } = harness();
    mocks.manifest.mockResolvedValueOnce({ ...EPISODE, episodeId: "EP03" });
    await expect(runProductionEpisodeRoughCut(VALID_INPUT, deps)).rejects.toThrow(
      "Episode rough-cut canonical manifest identity does not match EP02.",
    );
    expect(events).toEqual([]);
    expect(mocks.bible).not.toHaveBeenCalled();
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.compose).not.toHaveBeenCalled();
  });

  it.each(STAGES.map((stage, index) => [stage, index] as const))(
    "a %s failure prevents every later stage",
    async (stage, index) => {
      const { deps, mocks } = harness();
      const failure = new Error(`${stage} refused`);
      mocks[stage].mockRejectedValueOnce(failure);
      await expect(runProductionEpisodeRoughCut(VALID_INPUT, deps)).rejects.toBe(failure);
      for (const later of STAGES.slice(index + 1)) {
        expect(mocks[later], later).not.toHaveBeenCalled();
      }
    },
  );
});

describe("C8 E exact sequential order", () => {
  it("never starts a stage before the previous one settles, and calls each exactly once", async () => {
    const { deps, mocks, events } = harness();
    const gates = Object.fromEntries(STAGES.map((stage) => [stage, deferred<unknown>()])) as Record<
      Stage,
      ReturnType<typeof deferred<unknown>>
    >;
    const values: Record<Stage, unknown> = {
      manifest: EPISODE,
      bible: BIBLE,
      preflight: PREFLIGHT,
      plan: PLAN,
      compose: composed("MATERIALIZED"),
    };
    for (const stage of STAGES) {
      mocks[stage].mockImplementationOnce(() => {
        events.push(stage);
        return gates[stage].promise;
      });
    }
    const running = runProductionEpisodeRoughCut(VALID_INPUT, deps);
    for (const [index, stage] of STAGES.entries()) {
      await flush();
      expect(events).toEqual(STAGES.slice(0, index + 1));
      gates[stage].resolve(values[stage]);
    }
    await running;
    for (const stage of STAGES) {
      expect(mocks[stage], stage).toHaveBeenCalledTimes(1);
    }
  });
});

describe("C8 F exact forwarding", () => {
  it("forwards canonical objects by reference with no overrides or injected lower dependencies", async () => {
    const { deps, mocks } = harness();
    await runProductionEpisodeRoughCut(VALID_INPUT, deps);
    expect(mocks.manifest.mock.calls).toEqual([["EP02"]]);
    expect(mocks.bible.mock.calls).toEqual([[]]);
    expect(mocks.preflight.mock.calls).toEqual([[]]);
    expect(mocks.plan.mock.calls).toHaveLength(1);
    expect(mocks.plan.mock.calls[0]).toHaveLength(1);
    const planInput = mocks.plan.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(planInput).sort()).toEqual(["episode", "mediaRoot"]);
    expect(planInput.mediaRoot).toBe(MEDIA_ROOT);
    expect(planInput.episode).toBe(EPISODE);
    expect(mocks.compose.mock.calls[0]).toHaveLength(1);
    const composeInput = mocks.compose.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(composeInput).sort()).toEqual([
      "bible",
      "compositionPlan",
      "episode",
      "ffmpegExecutable",
      "ffprobeExecutable",
      "mediaRoot",
      "postProduction",
    ]);
    expect(composeInput.compositionPlan).toBe(PLAN);
    expect(composeInput.episode).toBe(EPISODE);
    expect(composeInput.bible).toBe(BIBLE);
    expect(composeInput.mediaRoot).toBe(MEDIA_ROOT);
    expect(composeInput.postProduction).toBe(POST_PRODUCTION);
    expect(composeInput.ffmpegExecutable).toBe(FFMPEG);
    expect(composeInput.ffprobeExecutable).toBe(FFPROBE);
  });
});

describe("C8 G rough-cut result semantics", () => {
  it.each(["MATERIALIZED", "HIT"] as const)(
    "%s returns the exact composer result in a frozen rough-cut-scoped wrapper",
    async (renderStatus) => {
      const composition = composed(renderStatus);
      const { deps } = harness(composition);
      const result = await runProductionEpisodeRoughCut(VALID_INPUT, deps);
      expect(Object.isFrozen(result)).toBe(true);
      expect(result.roughCut).toBe(composition);
      expect(result.roughCut.renderStatus).toBe(renderStatus);
      expect(result.episodeId).toBe("EP02");
      expect(result.renderRecordPath).toBe(RECORD_PATH);
      expect(Object.keys(result)).toEqual(["episodeId", "roughCut", "renderRecordPath"]);
      for (const key of Object.keys(result)) {
        expect(key).not.toMatch(FORBIDDEN_WORDING);
      }
    },
  );
});

describe("C8 H failures propagate unchanged with no retry", () => {
  it.each(STAGES)("a %s rejection (Error or non-Error) is the exact rejection value", async (stage) => {
    for (const failure of [new Error(`${stage} failed`), { secret: "not-an-error" }]) {
      const { deps, mocks } = harness();
      mocks[stage].mockRejectedValueOnce(failure);
      await expect(runProductionEpisodeRoughCut(VALID_INPUT, deps)).rejects.toBe(failure);
      for (const each of STAGES) {
        expect(mocks[each].mock.calls.length, each).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("C8 I default wiring loads preflight lazily after confirmation", () => {
  it("importing the operator and refusing invalid input load neither preflight nor dotenv", async () => {
    expect(state.preflightModuleLoaded).toBe(false);
    await expect(
      runProductionEpisodeRoughCut({ episodeId: "EP02", confirmLocalComposition: false } as never),
    ).rejects.toThrow("explicit local composition confirmation");
    await expect(
      runProductionEpisodeRoughCut({ episodeId: "../EP02", confirmLocalComposition: true } as never),
    ).rejects.toThrow("canonical episode ID");
    expect(state.preflightModuleLoaded).toBe(false);
    expect(state.dotenvLoaded).toBe(false);
    expect(loadEpisodeManifest).not.toHaveBeenCalled();
    expect(loadCharacterBible).not.toHaveBeenCalled();
  });

  it("valid input runs the fixed default seams in order with the lazily imported preflight", async () => {
    state.preflightResult = PREFLIGHT;
    const composition = composed("MATERIALIZED");
    vi.mocked(loadEpisodeManifest).mockResolvedValueOnce(EPISODE);
    vi.mocked(loadCharacterBible).mockResolvedValueOnce(BIBLE);
    vi.mocked(buildEpisodeCompositionPlan).mockResolvedValueOnce(PLAN);
    vi.mocked(composeEpisodeRoughCut).mockResolvedValueOnce(composition);

    const result = await runProductionEpisodeRoughCut(VALID_INPUT);

    expect(result.roughCut).toBe(composition);
    expect(state.preflightModuleLoaded).toBe(true);
    expect(state.dotenvLoaded).toBe(false);
    const { runCompositionPreflight } = await import("../src/composition/runCompositionPreflight.js");
    expect(runCompositionPreflight).toHaveBeenCalledTimes(1);
    const order = [
      vi.mocked(loadEpisodeManifest).mock.invocationCallOrder[0]!,
      vi.mocked(loadCharacterBible).mock.invocationCallOrder[0]!,
      vi.mocked(runCompositionPreflight).mock.invocationCallOrder[0]!,
      vi.mocked(buildEpisodeCompositionPlan).mock.invocationCallOrder[0]!,
      vi.mocked(composeEpisodeRoughCut).mock.invocationCallOrder[0]!,
    ];
    expect([...order].sort((left, right) => left - right)).toEqual(order);
    expect(vi.mocked(composeEpisodeRoughCut).mock.calls[0]).toHaveLength(1);
  });
});

// J: actual canonical EP02 data with the actual plan, preparation, dialogue
// plan, normalization-plan and render-plan authorities. Only evidence
// verification, probes, normalization caches and the render boundary are
// replaced, so no FFmpeg, media root or provider can be reached.
describe("C8 J actual C5 admission and composition authorities", () => {
  const SHOT_FIXTURE: Record<string, { bytes: number; sha: string }> = {
    S01: { bytes: 10_001, sha: "1".repeat(64) },
    S02: { bytes: 10_002, sha: "2".repeat(64) },
  };

  let events: string[];
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    events = [];
    vi.mocked(execFile).mockClear();
    vi.mocked(spawn).mockClear();
    vi.mocked(exec).mockClear();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("network must not be used");
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    expect(execFile).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  function verifiedShot(shotId: string): ExecutionLifecycleReconciliationResult {
    const fixture = SHOT_FIXTURE[shotId]!;
    return Object.freeze({
      lifecycleState: "COMPLETED",
      reconciliationMode: "DURABLE_COMPLETION",
      provider: "VEO",
      providerExecutionId: `operations/${shotId}`,
      generationRecord: Object.freeze({
        outputs: [
          Object.freeze({
            outputIndex: 1,
            destinationPath: `${MEDIA_ROOT}/generated-video/EP02/${shotId}/${shotId}_01.mp4`,
            bytes: fixture.bytes,
            sha256: fixture.sha,
            contentType: "video/mp4",
          }),
        ],
      }),
    }) as unknown as ExecutionLifecycleReconciliationResult;
  }

  function sourceMedia(input: { sourceVideoPath: string; nativeAudio: boolean }, durationSeconds: number) {
    return Object.freeze({
      sourceVideoPath: input.sourceVideoPath,
      formatName: "mov,mp4,m4a,3gp,3g2,mj2",
      durationSeconds,
      video: Object.freeze({
        codecName: "h264",
        profile: "High",
        width: 1280,
        height: 720,
        pixelFormat: "yuv420p",
        frameRate: 24,
      }),
      audio: input.nativeAudio
        ? Object.freeze({
            codecName: "aac",
            profile: "LC",
            sampleRateHz: 48000,
            channels: 2,
            channelLayout: "stereo",
          })
        : null,
    }) as CompositionSourceMediaMetadata;
  }

  function dialogueAudio(dialoguePlan: ShotDialoguePlan, shotDurationSeconds: number): DialogueCompositionAudioPlan {
    return Object.freeze({
      schemaVersion: "1.0",
      audioMode: "REPLACE_SOURCE_WITH_DIALOGUE",
      mixNativeAudio: false,
      episodeId: dialoguePlan.episodeId,
      sceneId: dialoguePlan.sceneId,
      shotId: dialoguePlan.shotId,
      dialoguePlanKey: dialoguePlan.planKey,
      shotDurationSeconds,
      sourceNativeAudio: true,
      sourceAudioDisposition: "DISCARD_NATIVE_AUDIO",
      lines: Object.freeze(
        dialoguePlan.lines.map((line, index) =>
          Object.freeze({
            lineNumber: index + 1,
            dialogueLineId: line.dialogueLineId,
            sourceAudioPath: `${MEDIA_ROOT}/voices/EP02/${dialoguePlan.shotId}/${line.dialogueLineId}/line.audio`,
            sourceBytes: 12_345,
            sourceSha256: "c".repeat(64),
            startSeconds: 0.5,
            durationSeconds: 1.5,
            endSeconds: 2,
          }),
        ),
      ),
      audioKey: "d".repeat(64),
    }) as unknown as DialogueCompositionAudioPlan;
  }

  function normalizedArtifact(plan: { outputPath: string; shotId: string }, durationSeconds: number) {
    return Object.freeze({
      cacheStatus: "MATERIALIZED" as const,
      artifact: Object.freeze({
        outputPath: plan.outputPath,
        bytes: 20_000,
        sha256: (plan.shotId === "S01" ? "5" : "6").repeat(64),
        contentType: "video/mp4" as const,
        durationSeconds,
        durationToleranceSeconds: 1 / 25,
      }),
    });
  }

  type Options = Readonly<{
    verifyShot?: (shotId: string) => ExecutionLifecycleReconciliationResult;
    resolveDialogue?: (dialoguePlan: ShotDialoguePlan, duration: number) => DialogueCompositionAudioPlan;
    ensureRender?: (plan: EpisodeRoughCutRenderPlan) => Promise<unknown>;
  }>;

  async function realChain(options: Options = {}) {
    const actualLoadManifest = (
      await vi.importActual<typeof import("../src/validation/loadEpisodeManifest.js")>(
        "../src/validation/loadEpisodeManifest.js",
      )
    ).loadEpisodeManifest;
    const actualLoadBible = (
      await vi.importActual<typeof import("../src/validation/loadCharacterBible.js")>(
        "../src/validation/loadCharacterBible.js",
      )
    ).loadCharacterBible;
    const actualBuildPlan = (
      await vi.importActual<typeof import("../src/composition/buildEpisodeCompositionPlan.js")>(
        "../src/composition/buildEpisodeCompositionPlan.js",
      )
    ).buildEpisodeCompositionPlan;
    const actualCompose = (
      await vi.importActual<typeof import("../src/composition/composeEpisodeRoughCut.js")>(
        "../src/composition/composeEpisodeRoughCut.js",
      )
    ).composeEpisodeRoughCut;

    const durations = new Map<string, number>();
    const verifyShot = vi.fn(async (input: { shotId: string }) => {
      events.push(`verify:${input.shotId}`);
      return (options.verifyShot ?? verifiedShot)(input.shotId);
    });
    const probeSource = vi.fn(async (input: { sourceVideoPath: string; nativeAudio: boolean }) => {
      const shotId = input.sourceVideoPath.includes("/S01/") ? "S01" : "S02";
      events.push(`probe:${shotId}`);
      return sourceMedia(input, durations.get(shotId)!);
    });
    const ensureV1 = vi.fn(async (input: { plan: { outputPath: string; shotId: string } }) => {
      events.push(`ensure-v1:${input.plan.shotId}`);
      return normalizedArtifact(input.plan, durations.get(input.plan.shotId)!);
    });
    const ensureV2 = vi.fn(async (input: { plan: { outputPath: string; shotId: string } }) => {
      events.push(`ensure-v2:${input.plan.shotId}`);
      return normalizedArtifact(input.plan, durations.get(input.plan.shotId)!);
    });
    const resolveDialogueAudioPlan = vi.fn(async (input: { dialoguePlan: ShotDialoguePlan }) => {
      events.push(`resolve:${input.dialoguePlan.shotId}`);
      return (options.resolveDialogue ?? dialogueAudio)(
        input.dialoguePlan,
        durations.get(input.dialoguePlan.shotId)!,
      );
    });
    const ensureRender = vi.fn(async (input: { plan: EpisodeRoughCutRenderPlan }) => {
      events.push("render");
      if (options.ensureRender) return options.ensureRender(input.plan);
      return Object.freeze({
        renderStatus: "MATERIALIZED" as const,
        artifact: Object.freeze({
          outputPath: input.plan.outputPath,
          bytes: 33_003,
          sha256: "9".repeat(64),
          contentType: "video/mp4" as const,
          durationSeconds: 11,
          durationToleranceSeconds: 1 / 25,
        }),
      });
    });
    const compose = vi.fn((input: Parameters<typeof composeEpisodeRoughCut>[0]) =>
      actualCompose(input, {
        prepareComposition: (prepareInput) =>
          prepareEpisodeComposition(prepareInput, {
            probeSource: probeSource as never,
            buildNormalizationPlan: buildCompositionShotNormalizationPlan,
            ensureNormalizationCache: ensureV1 as never,
            buildDialoguePlan: buildShotDialoguePlan,
            resolveDialogueAudioPlan: resolveDialogueAudioPlan as never,
            buildDialogueNormalizationPlan: buildDialogueCompositionShotNormalizationPlan,
            ensureDialogueNormalizationCache: ensureV2 as never,
          }),
        buildRenderPlan: buildEpisodeRoughCutRenderPlan,
        ensureRender: ensureRender as never,
      }),
    );

    const deps: RunProductionEpisodeRoughCutDependencies = {
      loadEpisodeManifest: async (episodeId) => {
        const episode = await actualLoadManifest(episodeId);
        for (const scene of episode.scenes) {
          for (const shot of scene.shots) durations.set(shot.id, shot.durationSeconds);
        }
        return episode;
      },
      loadCharacterBible: () => actualLoadBible(),
      runCompositionPreflight: async () => PREFLIGHT,
      buildEpisodeCompositionPlan: (input) => actualBuildPlan(input, { verifyShot: verifyShot as never }),
      composeEpisodeRoughCut: compose,
    };
    return { deps, verifyShot, probeSource, ensureV1, ensureV2, resolveDialogueAudioPlan, ensureRender, compose };
  }

  it("admits every canonical shot in order, resolves dialogue before any normalization and routes v1/v2", async () => {
    const chain = await realChain();
    const result = await runProductionEpisodeRoughCut(VALID_INPUT, chain.deps);
    expect(events).toEqual([
      "verify:S01",
      "verify:S02",
      "resolve:S02",
      "probe:S01",
      "ensure-v1:S01",
      "probe:S02",
      "ensure-v2:S02",
      "render",
    ]);
    expect(result.roughCut.renderStatus).toBe("MATERIALIZED");
    expect(result.roughCut.renderPlan.shots.map((shot) => shot.shotId)).toEqual(["S01", "S02"]);
    expect(result.roughCut.artifact.outputPath).toBe(result.roughCut.renderPlan.outputPath);
    expect(result.renderRecordPath).toBe(
      result.roughCut.renderPlan.outputPath.replace(/\.mp4$/, ".composition-rough-cut.json"),
    );
  });

  it("a later shot that is not COMPLETED blocks composition entirely (no repair, no reconciliation)", async () => {
    const refusal = new Error("Composition admission requires COMPLETED lifecycle for EP02/S02; received SUBMITTED.");
    const chain = await realChain({
      verifyShot: (shotId) => {
        if (shotId === "S02") throw refusal;
        return verifiedShot(shotId);
      },
    });
    await expect(runProductionEpisodeRoughCut(VALID_INPUT, chain.deps)).rejects.toBe(refusal);
    expect(events).toEqual(["verify:S01", "verify:S02"]);
    expect(chain.compose).not.toHaveBeenCalled();
    expect(chain.probeSource).not.toHaveBeenCalled();
    expect(chain.ensureV1).not.toHaveBeenCalled();
    expect(chain.ensureV2).not.toHaveBeenCalled();
    expect(chain.ensureRender).not.toHaveBeenCalled();
  });

  it("a stale dialogue placement refuses before any probe or normalization", async () => {
    const stale = new Error("Durable dialogue placement decision revision 2 for EP02/SC01/S02 is stale.");
    const chain = await realChain({
      resolveDialogue: () => {
        throw stale;
      },
    });
    await expect(runProductionEpisodeRoughCut(VALID_INPUT, chain.deps)).rejects.toBe(stale);
    expect(events).toEqual(["verify:S01", "verify:S02", "resolve:S02"]);
    expect(chain.probeSource).not.toHaveBeenCalled();
    expect(chain.ensureV1).not.toHaveBeenCalled();
    expect(chain.ensureV2).not.toHaveBeenCalled();
    expect(chain.ensureRender).not.toHaveBeenCalled();
  });

  function realEnsure(
    plan: EpisodeRoughCutRenderPlan,
    durable: Readonly<{ record: boolean; artifact: boolean }>,
  ) {
    const outputMedia = Object.freeze({
      sourceVideoPath: plan.outputPath,
      formatName: "mov,mp4,m4a,3gp,3g2,mj2",
      durationSeconds: plan.totalDurationSeconds,
      video: Object.freeze({
        codecName: "h264",
        profile: "High",
        width: 1920,
        height: 1080,
        pixelFormat: "yuv420p",
        frameRate: 25,
      }),
      audio: Object.freeze({
        codecName: "aac",
        profile: "LC",
        sampleRateHz: 48000,
        channels: 2,
        channelLayout: "stereo",
      }),
    }) as CompositionSourceMediaMetadata;
    const verified = verifyEpisodeRoughCutOutput({ plan, outputMedia });
    const record = {
      schemaVersion: "1.0",
      recordedAt: "2026-10-01T00:00:00.000Z",
      status: "RENDERED",
      plan: JSON.parse(JSON.stringify(plan)),
      artifact: {
        outputPath: verified.outputPath,
        bytes: 77_007,
        sha256: "7".repeat(64),
        contentType: "video/mp4",
        durationSeconds: verified.durationSeconds,
        durationToleranceSeconds: verified.durationToleranceSeconds,
      },
    } as unknown as EpisodeRoughCutRenderRecord;
    const io = {
      readRecord: vi.fn(async () => (durable.record ? record : null)),
      artifactExists: vi.fn(async () => durable.artifact),
      inspectFile: vi.fn(async () => ({ bytes: 77_007, sha256: "7".repeat(64) })),
      probeOutput: vi.fn(async () => outputMedia),
      materialize: vi.fn(async () => {
        throw new Error("materialize must not run");
      }),
      writeRecord: vi.fn(async () => {
        throw new Error("writeRecord must not run");
      }),
      now: () => new Date("2026-10-13T00:00:00.000Z"),
    };
    return { io, run: () => ensureEpisodeRoughCutRender({ ffmpegExecutable: FFMPEG, ffprobeExecutable: FFPROBE, plan }, io as never) };
  }

  it("a valid existing canonical rough cut is verified and reused (HIT) without rendering or new records", async () => {
    let io: ReturnType<typeof realEnsure>["io"] | undefined;
    const chain = await realChain({
      ensureRender: (plan) => {
        const ensure = realEnsure(plan, { record: true, artifact: true });
        io = ensure.io;
        return ensure.run();
      },
    });
    const result = await runProductionEpisodeRoughCut(VALID_INPUT, chain.deps);
    expect(result.roughCut.renderStatus).toBe("HIT");
    expect(result.roughCut.artifact.sha256).toBe("7".repeat(64));
    expect(io!.inspectFile).toHaveBeenCalledTimes(1);
    expect(io!.probeOutput).toHaveBeenCalledTimes(1);
    expect(io!.materialize).not.toHaveBeenCalled();
    expect(io!.writeRecord).not.toHaveBeenCalled();
  });

  it.each([
    [
      "an orphaned artifact without a record",
      { record: false, artifact: true },
      "Episode rough-cut render is orphaned: artifact exists without a durable render record.",
    ],
    [
      "a record without its artifact",
      { record: true, artifact: false },
      "Episode rough-cut render is incomplete: durable render record exists without its artifact.",
    ],
  ])("%s refuses for human intervention with no render, repair or overwrite", async (_label, durable, message) => {
    let io: ReturnType<typeof realEnsure>["io"] | undefined;
    const chain = await realChain({
      ensureRender: (plan) => {
        const ensure = realEnsure(plan, durable);
        io = ensure.io;
        return ensure.run();
      },
    });
    await expect(runProductionEpisodeRoughCut(VALID_INPUT, chain.deps)).rejects.toThrow(message);
    expect(io!.materialize).not.toHaveBeenCalled();
    expect(io!.writeRecord).not.toHaveBeenCalled();
    expect(chain.ensureRender).toHaveBeenCalledTimes(1);
    expect(chain.compose).toHaveBeenCalledTimes(1);
  });
});

describe("C8 source boundary of the operator module", () => {
  it("imports only canonical loaders, the episode-ID schema and C5 composition authorities", async () => {
    const source = await readFile(
      new URL("../src/composition/runProductionEpisodeRoughCut.ts", import.meta.url),
      "utf8",
    );
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]).sort();
    expect(specifiers).toEqual([
      "../execution/executionReservation.schema.js",
      "../validation/loadCharacterBible.js",
      "../validation/loadEpisodeManifest.js",
      "./buildEpisodeCompositionPlan.js",
      "./composeEpisodeRoughCut.js",
      "./episodeRoughCutRenderRecordPath.js",
      "./runCompositionPreflight.js",
    ]);
    expect(source).toMatch(/import\s+type\s+\{\s*runCompositionPreflight,?\s*\}\s+from\s+"\.\/runCompositionPreflight\.js"/);
    const dynamicImports = [...source.matchAll(/import\(\s*"([^"]+)"\s*\)/g)].map((match) => match[1]);
    expect(dynamicImports).toEqual(["./runCompositionPreflight.js"]);
  });
});
