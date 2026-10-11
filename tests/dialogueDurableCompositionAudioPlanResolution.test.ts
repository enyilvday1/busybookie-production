import {
  mkdtemp,
  readFile,
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
  expectTypeOf,
  it,
  vi,
} from "vitest";

import {
  buildDialogueCompositionAudioPlan,
} from "../src/dialogue/buildDialogueCompositionAudioPlan.js";

import {
  buildDialoguePlacementPlan,
  type DialoguePlacementInputLine,
} from "../src/dialogue/buildDialoguePlacementPlan.js";

import {
  buildShotDialoguePlan,
  type ShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import {
  createDialoguePlacementDecision,
} from "../src/dialogue/createDialoguePlacementDecision.js";

import {
  DialoguePlacementDecisionSchema,
  type DialoguePlacementDecision,
} from "../src/dialogue/dialoguePlacementDecision.schema.js";

import {
  createDialoguePlacementDecisionPath,
} from "../src/dialogue/dialoguePlacementDecisionPath.js";

import {
  prepareVerifiedDialogueCompositionAudioPlan,
} from "../src/dialogue/prepareVerifiedDialogueCompositionAudioPlan.js";

import {
  readLatestDialoguePlacementDecision,
} from "../src/dialogue/readDialoguePlacementDecision.js";

import {
  resolveDurableDialogueCompositionAudioPlan,
  type ResolveDurableDialogueCompositionAudioPlanDependencies,
  type ResolveDurableDialogueCompositionAudioPlanInput,
} from "../src/dialogue/resolveDurableDialogueCompositionAudioPlan.js";

import type {
  verifyShotDialogueAudioTiming,
} from "../src/dialogue/verifyShotDialogueAudioTiming.js";

import type {
  VerifiedShotDialogueTiming,
} from "../src/dialogue/verifyShotDialogueTiming.js";

import {
  loadCharacterBible,
} from "../src/validation/loadCharacterBible.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

const ffprobeExecutable = "controlled-ffprobe";
const ORIGINAL_SHA = ["1".repeat(64), "2".repeat(64)] as const;
const CHANGED_SHA = "3".repeat(64);
const DURABLE_STARTS = [0.5, 2.5] as const;

const roots: string[] = [];

async function createMediaRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "busybookie-durable-dialogue-composition-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// Canonical two-line plan derived by the real builder from the repository EP02 fixture.
async function canonicalPlan(secondLineText = "A second line."): Promise<ShotDialoguePlan> {
  const [episode, bible] = await Promise.all([loadEpisodeManifest("EP02"), loadCharacterBible()]);
  const shot = structuredClone(episode.scenes[0]!.shots[1]!);
  shot.dialogue.push({ ...shot.dialogue[0]!, text: secondLineText });
  return buildShotDialoguePlan({ episodeId: "EP02", sceneId: "SC01", shot, bible });
}

// Controlled fresh timing evidence for the plan; values only, no derivation logic.
function freshTiming(
  plan: ShotDialoguePlan,
  options: Readonly<{ sha256?: readonly string[]; durations?: readonly number[] }> = {},
): VerifiedShotDialogueTiming {
  const durations = options.durations ?? [1.5, 2.25];
  const sha256 = options.sha256 ?? ORIGINAL_SHA;
  const total = durations.reduce((sum, value) => sum + value, 0);
  return {
    schemaVersion: "1.0",
    timingMode: "AGGREGATE_ONLY",
    episodeId: plan.episodeId,
    sceneId: plan.sceneId,
    shotId: plan.shotId,
    planKey: plan.planKey,
    shotDurationSeconds: plan.shotDurationSeconds,
    durationToleranceSeconds: 0.000001,
    totalSpeechDurationSeconds: total,
    remainingDurationSeconds: Math.max(0, plan.shotDurationSeconds - total),
    lines: plan.lines.map((line, index) => ({
      lineNumber: line.lineNumber,
      dialogueLineId: line.dialogueLineId,
      sourceAudioPath: `controlled-media-root/voices/${line.dialogueLineId}.audio`,
      sourceBytes: 1000 + index,
      sourceSha256: sha256[index]!,
      durationSeconds: durations[index]!,
    })),
  };
}

function placementsFor(
  plan: ShotDialoguePlan,
  starts: readonly number[] = DURABLE_STARTS,
): DialoguePlacementInputLine[] {
  return plan.lines.map((line, index) => ({
    dialogueLineId: line.dialogueLineId,
    startSeconds: starts[index]!,
  }));
}

// The real prepare helper with only its timing/ffprobe dependency controlled.
function controlledPrepare(timing: () => Promise<VerifiedShotDialogueTiming>) {
  const verifyAudioTiming = vi.fn<typeof verifyShotDialogueAudioTiming>(timing);
  const prepareAudioPlan = vi.fn<typeof prepareVerifiedDialogueCompositionAudioPlan>((input) =>
    prepareVerifiedDialogueCompositionAudioPlan(input, {
      verifyAudioTiming,
      buildPlacementPlan: buildDialoguePlacementPlan,
      buildAudioPlan: buildDialogueCompositionAudioPlan,
    }));
  return { verifyAudioTiming, prepareAudioPlan };
}

// Persists a decision through the real creator into a temporary media root.
async function persistDecision(
  mediaRoot: string,
  plan: ShotDialoguePlan,
  starts: readonly number[] = DURABLE_STARTS,
) {
  return createDialoguePlacementDecision(
    mediaRoot,
    { dialoguePlan: plan, timing: freshTiming(plan), placements: placementsFor(plan, starts) },
    { now: () => "2026-10-11T12:00:00.000Z" },
  );
}

function decisionFor(
  plan: ShotDialoguePlan,
  placements: DialoguePlacementDecision["placements"],
): DialoguePlacementDecision {
  return DialoguePlacementDecisionSchema.parse({
    schemaVersion: "1.0",
    revision: 1,
    recordedAt: "2026-10-11T12:00:00.000Z",
    episodeId: plan.episodeId,
    sceneId: plan.sceneId,
    shotId: plan.shotId,
    dialoguePlanKey: plan.planKey,
    placements,
  });
}

describe("durable dialogue composition audio-plan resolution", () => {
  it("resolves a fresh latest decision to the same plan the verified helper builds, with one timing pass", async () => {
    const mediaRoot = await createMediaRoot();
    const plan = await canonicalPlan();
    await persistDecision(mediaRoot, plan);
    const controlled = controlledPrepare(async () => freshTiming(plan));

    const result = await resolveDurableDialogueCompositionAudioPlan(
      { mediaRoot, ffprobeExecutable, dialoguePlan: plan },
      { readLatestDecision: readLatestDialoguePlacementDecision, prepareAudioPlan: controlled.prepareAudioPlan },
    );

    const expected = await prepareVerifiedDialogueCompositionAudioPlan(
      { mediaRoot, ffprobeExecutable, dialoguePlan: plan, placements: placementsFor(plan) },
      {
        verifyAudioTiming: async () => freshTiming(plan),
        buildPlacementPlan: buildDialoguePlacementPlan,
        buildAudioPlan: buildDialogueCompositionAudioPlan,
      },
    );

    expect(result).toEqual(expected);
    expect(controlled.prepareAudioPlan).toHaveBeenCalledTimes(1);
    expect(controlled.prepareAudioPlan.mock.calls[0]).toEqual([
      { mediaRoot, ffprobeExecutable, dialoguePlan: plan, placements: placementsFor(plan) },
    ]);
    expect(controlled.verifyAudioTiming).toHaveBeenCalledExactlyOnceWith({
      mediaRoot,
      ffprobeExecutable,
      plan,
    });
    expect(result.lines.map((line) => line.startSeconds)).toEqual([...DURABLE_STARTS]);
    expect(result.lines.map((line) => line.sourceSha256)).toEqual([...ORIGINAL_SHA]);
  });

  it("uses the latest revision of a contiguous durable chain", async () => {
    const mediaRoot = await createMediaRoot();
    const plan = await canonicalPlan();
    await persistDecision(mediaRoot, plan, [0.5, 2.5]);
    const latest = await persistDecision(mediaRoot, plan, [1, 3]);
    expect(latest.record.revision).toBe(2);
    const controlled = controlledPrepare(async () => freshTiming(plan));

    const result = await resolveDurableDialogueCompositionAudioPlan(
      { mediaRoot, ffprobeExecutable, dialoguePlan: plan },
      { readLatestDecision: readLatestDialoguePlacementDecision, prepareAudioPlan: controlled.prepareAudioPlan },
    );

    expect(result.lines.map((line) => line.startSeconds)).toEqual([1, 3]);
    expect(controlled.prepareAudioPlan.mock.calls[0]![0].placements).toEqual(placementsFor(plan, [1, 3]));
  });

  it("fails closed with the production reader when no decision exists, before any timing work", async () => {
    const mediaRoot = await createMediaRoot();
    const plan = await canonicalPlan();
    const controlled = controlledPrepare(async () => freshTiming(plan));
    const readLatestDecision = vi.fn<ResolveDurableDialogueCompositionAudioPlanDependencies["readLatestDecision"]>(
      readLatestDialoguePlacementDecision,
    );

    await expect(resolveDurableDialogueCompositionAudioPlan(
      { mediaRoot, ffprobeExecutable, dialoguePlan: plan },
      { readLatestDecision, prepareAudioPlan: controlled.prepareAudioPlan },
    )).rejects.toThrow("Durable dialogue composition requires a placement decision for EP02/SC01/S02; none exists.");

    expect(readLatestDecision).toHaveBeenCalledExactlyOnceWith(mediaRoot, "EP02", "SC01", "S02");
    expect(controlled.prepareAudioPlan).not.toHaveBeenCalled();
    expect(controlled.verifyAudioTiming).not.toHaveBeenCalled();
  });

  it("uses the real durable reader by default", async () => {
    const mediaRoot = await createMediaRoot();
    const plan = await canonicalPlan();

    await expect(resolveDurableDialogueCompositionAudioPlan({ mediaRoot, ffprobeExecutable, dialoguePlan: plan }))
      .rejects.toThrow(/requires a placement decision for EP02\/SC01\/S02; none exists/);
  });

  it("rejects a decision recorded for a different canonical plan before any timing work", async () => {
    const mediaRoot = await createMediaRoot();
    const recordedPlan = await canonicalPlan();
    await persistDecision(mediaRoot, recordedPlan);
    const currentPlan = await canonicalPlan("The second line was rewritten.");
    expect(currentPlan.planKey).not.toBe(recordedPlan.planKey);
    const controlled = controlledPrepare(async () => freshTiming(currentPlan));

    await expect(resolveDurableDialogueCompositionAudioPlan(
      { mediaRoot, ffprobeExecutable, dialoguePlan: currentPlan },
      { readLatestDecision: readLatestDialoguePlacementDecision, prepareAudioPlan: controlled.prepareAudioPlan },
    )).rejects.toThrow(
      `Durable dialogue placement decision revision 1 for EP02/SC01/S02 is stale: dialoguePlanKey ${recordedPlan.planKey} does not match current canonical plan key ${currentPlan.planKey}.`,
    );
    expect(controlled.prepareAudioPlan).not.toHaveBeenCalled();
    expect(controlled.verifyAudioTiming).not.toHaveBeenCalled();
  });

  it.each([
    ["missing canonical line", (plan: ShotDialoguePlan) => [
      { dialogueLineId: plan.lines[0]!.dialogueLineId, sourceSha256: ORIGINAL_SHA[0], startSeconds: 0.5 },
    ]],
    ["reordered canonical lines", (plan: ShotDialoguePlan) => [
      { dialogueLineId: plan.lines[1]!.dialogueLineId, sourceSha256: ORIGINAL_SHA[1], startSeconds: 0.5 },
      { dialogueLineId: plan.lines[0]!.dialogueLineId, sourceSha256: ORIGINAL_SHA[0], startSeconds: 2.5 },
    ]],
    ["non-canonical line identity", (plan: ShotDialoguePlan) => [
      { dialogueLineId: plan.lines[0]!.dialogueLineId, sourceSha256: ORIGINAL_SHA[0], startSeconds: 0.5 },
      { dialogueLineId: "EP02_SC01_S02_L03", sourceSha256: ORIGINAL_SHA[1], startSeconds: 2.5 },
    ]],
  ])("rejects a decision with %s before any timing work", async (_label, placements) => {
    const plan = await canonicalPlan();
    const controlled = controlledPrepare(async () => freshTiming(plan));

    await expect(resolveDurableDialogueCompositionAudioPlan(
      { mediaRoot: "controlled-media-root", ffprobeExecutable, dialoguePlan: plan },
      { readLatestDecision: async () => decisionFor(plan, placements(plan)), prepareAudioPlan: controlled.prepareAudioPlan },
    )).rejects.toThrow(
      "Durable dialogue placement decision revision 1 for EP02/SC01/S02 does not cover the canonical dialogue lines in order.",
    );
    expect(controlled.prepareAudioPlan).not.toHaveBeenCalled();
    expect(controlled.verifyAudioTiming).not.toHaveBeenCalled();
  });

  it.each([
    [0, "EP02_SC01_S02_L01"],
    [1, "EP02_SC01_S02_L02"],
  ] as const)("rejects changed source audio on line index %i (%s), checking every line", async (changedIndex, lineId) => {
    const mediaRoot = await createMediaRoot();
    const plan = await canonicalPlan();
    await persistDecision(mediaRoot, plan);
    const sha256: string[] = [...ORIGINAL_SHA];
    sha256[changedIndex] = CHANGED_SHA;
    const controlled = controlledPrepare(async () => freshTiming(plan, { sha256 }));

    await expect(resolveDurableDialogueCompositionAudioPlan(
      { mediaRoot, ffprobeExecutable, dialoguePlan: plan },
      { readLatestDecision: readLatestDialoguePlacementDecision, prepareAudioPlan: controlled.prepareAudioPlan },
    )).rejects.toThrow(
      `Durable dialogue placement decision revision 1 for EP02/SC01/S02 is stale: source audio changed for ${lineId} (stored ${ORIGINAL_SHA[changedIndex]}, verified ${CHANGED_SHA}).`,
    );
    expect(controlled.verifyAudioTiming).toHaveBeenCalledTimes(1);
  });

  it("makes a previously fresh decision unusable once its audio is regenerated", async () => {
    const mediaRoot = await createMediaRoot();
    const plan = await canonicalPlan();
    await persistDecision(mediaRoot, plan);
    let currentSha: readonly string[] = ORIGINAL_SHA;
    const controlled = controlledPrepare(async () => freshTiming(plan, { sha256: currentSha }));
    const dependencies = {
      readLatestDecision: readLatestDialoguePlacementDecision,
      prepareAudioPlan: controlled.prepareAudioPlan,
    };
    const input = { mediaRoot, ffprobeExecutable, dialoguePlan: plan };

    await expect(resolveDurableDialogueCompositionAudioPlan(input, dependencies)).resolves.toBeDefined();
    currentSha = [CHANGED_SHA, CHANGED_SHA];
    await expect(resolveDurableDialogueCompositionAudioPlan(input, dependencies))
      .rejects.toThrow(/is stale: source audio changed for EP02_SC01_S02_L01/);
  });

  it("propagates a fresh timing verification failure unchanged", async () => {
    const plan = await canonicalPlan();
    const failure = new Error("Dialogue timing admission requires COMPLETED lifecycle for EP02_SC01_S02_L02; received SUBMITTED.");
    const controlled = controlledPrepare(async () => {
      throw failure;
    });

    await expect(resolveDurableDialogueCompositionAudioPlan(
      { mediaRoot: "controlled-media-root", ffprobeExecutable, dialoguePlan: plan },
      { readLatestDecision: async () => decisionFor(plan, placementsFor(plan).map((p, i) => ({ ...p, sourceSha256: ORIGINAL_SHA[i]! }))), prepareAudioPlan: controlled.prepareAudioPlan },
    )).rejects.toBe(failure);
  });

  it.each([
    ["overlap", [2.5, 2.25], /overlap detected for EP02_SC01_S02_L02/],
    ["end beyond the shot", [1.5, 4], /EP02_SC01_S02_L02 ends beyond shot duration 6 seconds/],
  ] as const)("re-applies current placement rules to durable starts (%s)", async (_label, durations, expected) => {
    const mediaRoot = await createMediaRoot();
    const plan = await canonicalPlan();
    await persistDecision(mediaRoot, plan);
    const controlled = controlledPrepare(async () => freshTiming(plan, { durations }));

    await expect(resolveDurableDialogueCompositionAudioPlan(
      { mediaRoot, ffprobeExecutable, dialoguePlan: plan },
      { readLatestDecision: readLatestDialoguePlacementDecision, prepareAudioPlan: controlled.prepareAudioPlan },
    )).rejects.toThrow(expected);
  });

  it("propagates durable reader integrity failures instead of treating them as absence", async () => {
    const mediaRoot = await createMediaRoot();
    const plan = await canonicalPlan();
    await persistDecision(mediaRoot, plan);
    await persistDecision(mediaRoot, plan, [1, 3]);
    await rm(createDialoguePlacementDecisionPath(mediaRoot, "EP02", "SC01", "S02", 1));
    const controlled = controlledPrepare(async () => freshTiming(plan));

    await expect(resolveDurableDialogueCompositionAudioPlan(
      { mediaRoot, ffprobeExecutable, dialoguePlan: plan },
      { readLatestDecision: readLatestDialoguePlacementDecision, prepareAudioPlan: controlled.prepareAudioPlan },
    )).rejects.toThrow("Dialogue placement decision revision sequence is not contiguous: expected revision 1, received 2.");
    expect(controlled.prepareAudioPlan).not.toHaveBeenCalled();
  });

  it("fails closed if verified audio lines do not correspond to the durable lines", async () => {
    const plan = await canonicalPlan();
    const decision = decisionFor(plan, placementsFor(plan).map((p, i) => ({ ...p, sourceSha256: ORIGINAL_SHA[i]! })));
    const controlled = controlledPrepare(async () => freshTiming(plan));
    const truncated = vi.fn<typeof prepareVerifiedDialogueCompositionAudioPlan>(async (input) => {
      const audioPlan = await controlled.prepareAudioPlan(input);
      return { ...audioPlan, lines: audioPlan.lines.slice(0, 1) };
    });

    await expect(resolveDurableDialogueCompositionAudioPlan(
      { mediaRoot: "controlled-media-root", ffprobeExecutable, dialoguePlan: plan },
      { readLatestDecision: async () => decision, prepareAudioPlan: truncated },
    )).rejects.toThrow(/could not be confirmed fresh: verified audio covers 1 lines, expected 2/);
  });

  it("accepts only canonical plan, media root and ffprobe executable as public input", () => {
    expectTypeOf<keyof ResolveDurableDialogueCompositionAudioPlanInput>()
      .toEqualTypeOf<"mediaRoot" | "ffprobeExecutable" | "dialoguePlan">();
    expectTypeOf<keyof ResolveDurableDialogueCompositionAudioPlanDependencies>()
      .toEqualTypeOf<"readLatestDecision" | "prepareAudioPlan">();
  });

  it("keeps the resolver module read-only and limited to the durable reader and verified helper", async () => {
    const source = await readFile("src/dialogue/resolveDurableDialogueCompositionAudioPlan.ts", "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);

    expect(imports).toEqual([
      "./buildDialogueCompositionAudioPlan.js",
      "./buildShotDialoguePlan.js",
      "./prepareVerifiedDialogueCompositionAudioPlan.js",
      "./readDialoguePlacementDecision.js",
    ]);
    expect(source).toMatch(/import type \{\s*DialogueCompositionAudioPlan,\s*\} from "\.\/buildDialogueCompositionAudioPlan\.js"/);
    expect(source).toMatch(/import type \{\s*ShotDialoguePlan,\s*\} from "\.\/buildShotDialoguePlan\.js"/);
    expect(source).not.toMatch(
      /writeFile|mkdir|copyFile|rename|unlink|\brm\(|createWriteStream|execFile|spawn|verifyShotDialogueAudioTiming|createDialoguePlacementDecision|createDialogueVisualAuthorization|reconcile|Runway|Veo|composeEpisode|materialize/,
    );
  });
});
