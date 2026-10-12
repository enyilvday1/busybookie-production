import {
  mkdtemp,
  readFile,
  readdir,
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
  resolveDurableShotDialogueCompositionState,
  type DurableShotDialogueCompositionState,
} from "../src/dialogue/resolveDurableShotDialogueCompositionState.js";

import {
  resolveDurableEpisodeProductionState,
  type DurableEpisodeProductionState,
  type DurableEpisodeProductionStateSummary,
  type DurableEpisodeShotProductionState,
  type ResolveDurableEpisodeProductionStateDependencies,
  type ResolveDurableEpisodeProductionStateInput,
} from "../src/execution/resolveDurableEpisodeProductionState.js";

import {
  resolveDurableShotVisualGenerationState,
  type DurableShotVisualGenerationState,
} from "../src/execution/resolveDurableShotVisualGenerationState.js";

import type {
  CharacterBible,
} from "../src/schemas/character.schema.js";

import type {
  EpisodeManifest,
} from "../src/schemas/episodeManifest.schema.js";

import type {
  ProviderRoutingPolicy,
} from "../src/schemas/providerRoutingPolicy.schema.js";

import type {
  ProductionRules,
} from "../src/schemas/productionRules.schema.js";

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

type VisualState = DurableShotVisualGenerationState["state"];
type DialogueState = DurableShotDialogueCompositionState["state"];

const VISUAL_KEY_ORDER: readonly VisualState[] = [
  "RESERVED_ONLY_INTERVENTION_REQUIRED",
  "SUBMITTED_RECONCILIATION_REQUIRED",
  "LIFECYCLE_COMPLETED",
  "CANONICAL_NOT_EXECUTABLE",
  "VISUAL_AUTHORIZATION_REQUIRED",
  "REFERENCE_UNAVAILABLE",
  "REFERENCE_SELECTION_REQUIRED",
  "READY_FOR_GENERATION",
];

const DIALOGUE_KEY_ORDER: readonly DialogueState[] = [
  "NO_DIALOGUE",
  "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED",
  "DIALOGUE_PLANNING_BLOCKED",
  "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED",
  "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED",
  "DIALOGUE_RECONCILIATION_REQUIRED",
  "DIALOGUE_AUDIO_REQUIRED",
  "PLACEMENT_REQUIRED",
  "COMPOSITION_AUDIO_RESOLVED",
];

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function canonicalInputs(): Promise<{
  episode: EpisodeManifest;
  bible: CharacterBible;
  rules: ProductionRules;
  policy: ProviderRoutingPolicy;
}> {
  const [episode, bible, rules, policy] = await Promise.all([
    loadEpisodeManifest("EP02"),
    loadCharacterBible(),
    loadProductionRules(),
    loadProviderRoutingPolicy(),
  ]);
  return { episode, bible, rules, policy };
}

// Five shots in three scenes whose manifest order differs from shot.order:
// SC02/S10 (order 4), SC02/S11 (order 1), SC01/S01 (order 5), SC03/S02 (order 2), SC03/S03 (order 3).
function multiSceneEpisode(base: EpisodeManifest): EpisodeManifest {
  const episode = structuredClone(base);
  const template = episode.scenes[0]!;
  const shotTemplate = template.shots[0]!;
  const shot = (id: string, order: number) => ({ ...structuredClone(shotTemplate), id, order });
  episode.scenes = [
    { ...structuredClone(template), id: "SC02", shots: [shot("S10", 4), shot("S11", 1)] },
    { ...structuredClone(template), id: "SC01", shots: [shot("S01", 5)] },
    { ...structuredClone(template), id: "SC03", shots: [shot("S02", 2), shot("S03", 3)] },
  ];
  return episode;
}

function visual(state: VisualState, marker: string): DurableShotVisualGenerationState {
  return Object.freeze({ state, marker }) as unknown as DurableShotVisualGenerationState;
}

function dialogue(state: DialogueState, marker: string): DurableShotDialogueCompositionState {
  return Object.freeze({ state, marker }) as unknown as DurableShotDialogueCompositionState;
}

type Call = readonly [axis: "visual" | "dialogue", shotId: string];

function seams(
  visualFor: (shotId: string) => DurableShotVisualGenerationState = (shotId) => visual("CANONICAL_NOT_EXECUTABLE", shotId),
  dialogueFor: (shotId: string) => DurableShotDialogueCompositionState = (shotId) => dialogue("NO_DIALOGUE", shotId),
) {
  const calls: Call[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const track = async <T>(call: Call, produce: () => T): Promise<T> => {
    calls.push(call);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
    return produce();
  };
  const resolveVisualGenerationState = vi.fn<typeof resolveDurableShotVisualGenerationState>((input) =>
    track(["visual", input.shot.id], () => visualFor(input.shot.id)),
  );
  const resolveDialogueCompositionState = vi.fn<typeof resolveDurableShotDialogueCompositionState>((input) =>
    track(["dialogue", input.shotId], () => dialogueFor(input.shotId)),
  );
  const dependencies: ResolveDurableEpisodeProductionStateDependencies = {
    resolveVisualGenerationState,
    resolveDialogueCompositionState,
  };
  return { dependencies, resolveVisualGenerationState, resolveDialogueCompositionState, calls, maxInFlight: () => maxInFlight };
}

function input(
  episode: EpisodeManifest,
  inputs: Awaited<ReturnType<typeof canonicalInputs>>,
  mediaRoot = "C:/controlled-media-root",
): ResolveDurableEpisodeProductionStateInput {
  return { episode, bible: inputs.bible, rules: inputs.rules, policy: inputs.policy, mediaRoot, ffprobeExecutable: "controlled-ffprobe" };
}

// Resolves to the rejection reason; a fulfilled promise is a test failure.
function rejected(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error("expected the evaluation to reject");
    },
    (caught: unknown) => caught as Error,
  );
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

describe("C4 canonical order and dual-axis evaluation", () => {
  it("A/B/C/D evaluates shots by ascending global shot.order, C2 then C3, one shot at a time", async () => {
    const inputs = await canonicalInputs();
    const episode = multiSceneEpisode(inputs.episode);
    const controlled = seams();

    const result = await resolveDurableEpisodeProductionState(input(episode, inputs), controlled.dependencies);

    expect(result.shots.map((shot) => [shot.order, shot.sceneId, shot.shotId])).toEqual([
      [1, "SC02", "S11"],
      [2, "SC03", "S02"],
      [3, "SC03", "S03"],
      [4, "SC02", "S10"],
      [5, "SC01", "S01"],
    ]);
    expect(controlled.calls).toEqual([
      ["visual", "S11"], ["dialogue", "S11"],
      ["visual", "S02"], ["dialogue", "S02"],
      ["visual", "S03"], ["dialogue", "S03"],
      ["visual", "S10"], ["dialogue", "S10"],
      ["visual", "S01"], ["dialogue", "S01"],
    ]);
  });

  it("AA is strictly sequential (never more than one resolver call in flight)", async () => {
    const inputs = await canonicalInputs();
    const controlled = seams();

    await resolveDurableEpisodeProductionState(input(multiSceneEpisode(inputs.episode), inputs), controlled.dependencies);

    expect(controlled.maxInFlight()).toBe(1);
  });

  it("E/F/G preserves the exact C2 and C3 objects under the locked property names", async () => {
    const inputs = await canonicalInputs();
    const visuals = new Map<string, DurableShotVisualGenerationState>();
    const dialogues = new Map<string, DurableShotDialogueCompositionState>();
    const controlled = seams(
      (shotId) => {
        const value = visual("READY_FOR_GENERATION", shotId);
        visuals.set(shotId, value);
        return value;
      },
      (shotId) => {
        const value = dialogue("PLACEMENT_REQUIRED", shotId);
        dialogues.set(shotId, value);
        return value;
      },
    );

    const result = await resolveDurableEpisodeProductionState(input(inputs.episode, inputs), controlled.dependencies);

    for (const shot of result.shots) {
      expect(Object.keys(shot)).toEqual(["order", "sceneId", "shotId", "visualGenerationState", "dialogueCompositionState"]);
      expect(shot.visualGenerationState).toBe(visuals.get(shot.shotId));
      expect(shot.dialogueCompositionState).toBe(dialogues.get(shot.shotId));
    }
  });

  it("passes the canonical Shot object to C2 and only the shot id to C3", async () => {
    const inputs = await canonicalInputs();
    const controlled = seams();
    const mediaRoot = "C:/mapping-root";

    await resolveDurableEpisodeProductionState(input(inputs.episode, inputs, mediaRoot), controlled.dependencies);

    const [c2Input] = controlled.resolveVisualGenerationState.mock.calls[0]!;
    expect(c2Input.shot).toBe(inputs.episode.scenes[0]!.shots[0]);
    expect(c2Input).toEqual({
      episode: inputs.episode,
      shot: inputs.episode.scenes[0]!.shots[0],
      bible: inputs.bible,
      rules: inputs.rules,
      policy: inputs.policy,
      mediaRoot,
    });
    expect(controlled.resolveVisualGenerationState.mock.calls[0]!).toHaveLength(1);
    const [c3Input] = controlled.resolveDialogueCompositionState.mock.calls[0]!;
    expect(c3Input).toEqual({
      episode: inputs.episode,
      shotId: "S01",
      bible: inputs.bible,
      mediaRoot,
      ffprobeExecutable: "controlled-ffprobe",
    });
    expect(Object.keys(c3Input).sort()).toEqual(["bible", "episode", "ffprobeExecutable", "mediaRoot", "shotId"]);
  });

  it.each(VISUAL_KEY_ORDER)("O ordinary C2 state %s still evaluates C3", async (state) => {
    const inputs = await canonicalInputs();
    const controlled = seams(() => visual(state, "x"));

    const result = await resolveDurableEpisodeProductionState(input(inputs.episode, inputs), controlled.dependencies);

    expect(controlled.resolveDialogueCompositionState).toHaveBeenCalledTimes(2);
    expect(result.shots.every((shot) => shot.dialogueCompositionState.state === "NO_DIALOGUE")).toBe(true);
  });

  it.each(DIALOGUE_KEY_ORDER)("P ordinary C3 state %s keeps the C2 object", async (state) => {
    const inputs = await canonicalInputs();
    const visualObject = visual("REFERENCE_UNAVAILABLE", "kept");
    const controlled = seams(() => visualObject, () => dialogue(state, "x"));

    const result = await resolveDurableEpisodeProductionState(input(inputs.episode, inputs), controlled.dependencies);

    expect(result.shots.map((shot) => shot.visualGenerationState)).toEqual([visualObject, visualObject]);
    expect(result.shots.every((shot) => shot.visualGenerationState === visualObject)).toBe(true);
  });
});

describe("C4 summary", () => {
  it("H/I/J all keys present, zero-filled, in the locked fixed order", async () => {
    const inputs = await canonicalInputs();
    const controlled = seams();

    const result = await resolveDurableEpisodeProductionState(input(inputs.episode, inputs), controlled.dependencies);

    expect(Object.keys(result.summary)).toEqual(["totalShots", "visualGenerationStates", "dialogueCompositionStates"]);
    expect(Object.keys(result.summary.visualGenerationStates)).toEqual(VISUAL_KEY_ORDER);
    expect(Object.keys(result.summary.dialogueCompositionStates)).toEqual(DIALOGUE_KEY_ORDER);
    expect(result.summary.visualGenerationStates).toEqual({
      RESERVED_ONLY_INTERVENTION_REQUIRED: 0,
      SUBMITTED_RECONCILIATION_REQUIRED: 0,
      LIFECYCLE_COMPLETED: 0,
      CANONICAL_NOT_EXECUTABLE: 2,
      VISUAL_AUTHORIZATION_REQUIRED: 0,
      REFERENCE_UNAVAILABLE: 0,
      REFERENCE_SELECTION_REQUIRED: 0,
      READY_FOR_GENERATION: 0,
    });
    expect(result.summary.dialogueCompositionStates.NO_DIALOGUE).toBe(2);
    expect(result.summary.totalShots).toBe(2);
  });

  it("K/L/M/N mixed nine-state dialogue fixture: exact objects and counts, including both planning-blocked states", async () => {
    const inputs = await canonicalInputs();
    const base = structuredClone(inputs.episode);
    const template = base.scenes[0]!.shots[0]!;
    // 12 shots: every C3 state once, plus the two planning-blocked states and AUDIO_REQUIRED again.
    const dialogueByShot: readonly DialogueState[] = [
      ...DIALOGUE_KEY_ORDER,
      "DIALOGUE_PLANNING_BLOCKED",
      "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED",
      "DIALOGUE_AUDIO_REQUIRED",
    ];
    const visualByShot: readonly VisualState[] = dialogueByShot.map((_state, index) => VISUAL_KEY_ORDER[index % 8]!);
    base.scenes = [
      {
        ...structuredClone(base.scenes[0]!),
        shots: dialogueByShot.map((_state, index) => ({
          ...structuredClone(template),
          id: `S${String(index + 1).padStart(2, "0")}`,
          order: index + 1,
        })),
      },
    ];
    const objects = new Map<string, DurableShotDialogueCompositionState>();
    const controlled = seams(
      (shotId) => visual(visualByShot[Number(shotId.slice(1)) - 1]!, shotId),
      (shotId) => {
        const value = dialogue(dialogueByShot[Number(shotId.slice(1)) - 1]!, shotId);
        objects.set(shotId, value);
        return value;
      },
    );

    const result = await resolveDurableEpisodeProductionState(input(base, inputs), controlled.dependencies);

    expect(result.summary.dialogueCompositionStates).toEqual({
      NO_DIALOGUE: 1,
      DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED: 2,
      DIALOGUE_PLANNING_BLOCKED: 2,
      DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED: 1,
      DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED: 1,
      DIALOGUE_RECONCILIATION_REQUIRED: 1,
      DIALOGUE_AUDIO_REQUIRED: 2,
      PLACEMENT_REQUIRED: 1,
      COMPOSITION_AUDIO_RESOLVED: 1,
    });
    expect(Object.keys(result.summary.dialogueCompositionStates)).toEqual(DIALOGUE_KEY_ORDER);
    expect(result.summary.visualGenerationStates).toEqual({
      RESERVED_ONLY_INTERVENTION_REQUIRED: 2,
      SUBMITTED_RECONCILIATION_REQUIRED: 2,
      LIFECYCLE_COMPLETED: 2,
      CANONICAL_NOT_EXECUTABLE: 2,
      VISUAL_AUTHORIZATION_REQUIRED: 1,
      REFERENCE_UNAVAILABLE: 1,
      REFERENCE_SELECTION_REQUIRED: 1,
      READY_FOR_GENERATION: 1,
    });
    expect(result.summary.totalShots).toBe(12);
    for (const shot of result.shots) {
      expect(shot.dialogueCompositionState).toBe(objects.get(shot.shotId));
    }
    const blocked = result.shots.filter((shot) => shot.dialogueCompositionState.state === "DIALOGUE_PLANNING_BLOCKED");
    const blockedActive = result.shots.filter(
      (shot) => shot.dialogueCompositionState.state === "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED",
    );
    expect(blocked.map((shot) => shot.shotId)).toEqual(["S03", "S10"]);
    expect(blockedActive.map((shot) => shot.shotId)).toEqual(["S02", "S11"]);
  });

  it("N/O deterministic: identical inputs produce identical serialised reports", async () => {
    const inputs = await canonicalInputs();
    const first = await resolveDurableEpisodeProductionState(input(multiSceneEpisode(inputs.episode), inputs), seams().dependencies);
    const second = await resolveDurableEpisodeProductionState(input(multiSceneEpisode(inputs.episode), inputs), seams().dependencies);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("an unknown discriminant fails closed instead of adding a summary key", async () => {
    const inputs = await canonicalInputs();
    const controlled = seams(() => visual("NOT_A_STATE" as VisualState, "x"));

    await expect(
      resolveDurableEpisodeProductionState(input(inputs.episode, inputs), controlled.dependencies),
    ).rejects.toThrow("Unknown durable shot state NOT_A_STATE cannot be summarised.");
  });

  it("AB/U no aggregate readiness or next-action fields; result, shots and summary frozen", async () => {
    const inputs = await canonicalInputs();

    const result = await resolveDurableEpisodeProductionState(input(inputs.episode, inputs), seams().dependencies);

    expect(Object.keys(result)).toEqual(["episodeId", "shots", "summary"]);
    const forbidden = ["nextAction", "overallStatus", "episodeStatus", "ready", "complete", "allComplete", "executable", "safeToGenerate", "canGenerate", "canCompose", "canRun", "episodeReady"];
    const keys = collectKeys(result);
    for (const key of forbidden) {
      expect(keys.has(key), key).toBe(false);
    }
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.shots)).toBe(true);
    expect(result.shots.every((shot) => Object.isFrozen(shot))).toBe(true);
    expect(Object.isFrozen(result.summary)).toBe(true);
    expect(Object.isFrozen(result.summary.visualGenerationStates)).toBe(true);
    expect(Object.isFrozen(result.summary.dialogueCompositionStates)).toBe(true);
  });
});

describe("C4 hard failures", () => {
  it("Q/R/U/V/W a C2 throw aborts: C3 for that shot and later shots are not called; wrapped once with cause", async () => {
    const inputs = await canonicalInputs();
    const failure = new Error("controlled C2 corruption");
    const controlled = seams((shotId) => {
      if (shotId === "S02") throw failure;
      return visual("CANONICAL_NOT_EXECUTABLE", shotId);
    });

    const rejection = resolveDurableEpisodeProductionState(input(multiSceneEpisode(inputs.episode), inputs), controlled.dependencies);

    await expect(rejection).rejects.toThrow(
      "Durable episode evaluation failed for EP02/SC03/S02 (visual-generation): controlled C2 corruption",
    );
    const error = await rejected(rejection);
    expect(error.cause).toBe(failure);
    expect((error.cause as Error).cause).toBeUndefined();
    expect(controlled.calls).toEqual([["visual", "S11"], ["dialogue", "S11"], ["visual", "S02"]]);
  });

  it("S/T/U/V/W a C3 throw aborts: later shots are not called; wrapped once with cause", async () => {
    const inputs = await canonicalInputs();
    const failure = new Error("Dialogue lifecycle submission exists without a durable reservation.");
    const controlled = seams(undefined, (shotId) => {
      if (shotId === "S03") throw failure;
      return dialogue("DIALOGUE_PLANNING_BLOCKED", shotId);
    });

    const rejection = resolveDurableEpisodeProductionState(input(multiSceneEpisode(inputs.episode), inputs), controlled.dependencies);

    await expect(rejection).rejects.toThrow(
      "Durable episode evaluation failed for EP02/SC03/S03 (dialogue-composition): Dialogue lifecycle submission exists without a durable reservation.",
    );
    const error = await rejected(rejection);
    expect(error.cause).toBe(failure);
    expect(controlled.calls.at(-1)).toEqual(["dialogue", "S03"]);
    expect(controlled.calls.some((call) => call[1] === "S10" || call[1] === "S01")).toBe(false);
  });

  it("non-Error throws are wrapped with a string detail and kept as cause", async () => {
    const inputs = await canonicalInputs();
    const controlled = seams(() => {
      throw "raw failure";
    });

    const error = await rejected(resolveDurableEpisodeProductionState(input(inputs.episode, inputs), controlled.dependencies));

    expect(error.message).toBe("Durable episode evaluation failed for EP02/SC01/S01 (visual-generation): raw failure");
    expect(error.cause).toBe("raw failure");
  });

  it.each([
    ["duplicate shot id", (episode: EpisodeManifest) => { episode.scenes[2]!.shots[0]!.id = "S11"; }, "Episode EP02 has duplicate shot id S11."],
    ["duplicate shot order", (episode: EpisodeManifest) => { episode.scenes[2]!.shots[0]!.order = 4; }, "Episode EP02 has duplicate shot order 4."],
  ] as const)("Y/Z %s fails in preflight before any resolver call", async (_label, mutate, message) => {
    const inputs = await canonicalInputs();
    const episode = multiSceneEpisode(inputs.episode);
    mutate(episode);
    const controlled = seams();

    await expect(
      resolveDurableEpisodeProductionState(input(episode, inputs), controlled.dependencies),
    ).rejects.toThrow(message);
    expect(controlled.calls).toEqual([]);
  });
});

describe("C4 boundaries and real defaults", () => {
  const sourceUrl = new URL("../src/execution/resolveDurableEpisodeProductionState.ts", import.meta.url);

  it("AC/AD imports only the C2/C3 authorities and schema types; no write/provider/paid/reconcile/render", async () => {
    const source = await readFile(sourceUrl, "utf8");
    const imports = [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)].map(
      (match) => `${match[2]}:${match[1]!.replace(/\s+/g, "")}`,
    );

    expect(imports).toEqual([
      "../schemas/character.schema.js:CharacterBible,",
      "../schemas/episodeManifest.schema.js:EpisodeManifest,Shot,",
      "../schemas/providerRoutingPolicy.schema.js:ProviderRoutingPolicy,",
      "../schemas/productionRules.schema.js:ProductionRules,",
      "../dialogue/resolveDurableShotDialogueCompositionState.js:resolveDurableShotDialogueCompositionState,typeDurableShotDialogueCompositionState,",
      "./resolveDurableShotVisualGenerationState.js:resolveDurableShotVisualGenerationState,typeDurableShotVisualGenerationState,",
    ]);
    expect(source).not.toMatch(
      /node:|writeFile|appendFile|mkdir|rename\(|unlink|copyFile|createWriteStream|create(Dialogue|Execution|Runway)\w*|reconcile\w*\(|confirm\w*|execute(SingleShot|Veo|Runway)|render\w*\(|spawn|execFile|fetch\(|Promise\.all/,
    );
  });

  it("X never classifies errors by message text", async () => {
    const source = await readFile(sourceUrl, "utf8");

    expect(source).not.toMatch(/\.message\s*(===|!==|\.includes|\.startsWith|\.match)|\.test\(\s*\w*\.message|switch\s*\(\s*\w*\.message/);
    expect(source.match(/\.message/g)).toHaveLength(1);
  });

  it("exposes the locked types and dependency seam", () => {
    expectTypeOf<DurableEpisodeShotProductionState>().toEqualTypeOf<
      Readonly<{
        order: number;
        sceneId: string;
        shotId: string;
        visualGenerationState: DurableShotVisualGenerationState;
        dialogueCompositionState: DurableShotDialogueCompositionState;
      }>
    >();
    expectTypeOf<DurableEpisodeProductionState>().toEqualTypeOf<
      Readonly<{ episodeId: string; shots: readonly DurableEpisodeShotProductionState[]; summary: DurableEpisodeProductionStateSummary }>
    >();
    expectTypeOf<DurableEpisodeProductionStateSummary>().toEqualTypeOf<
      Readonly<{
        totalShots: number;
        visualGenerationStates: Readonly<Record<VisualState, number>>;
        dialogueCompositionStates: Readonly<Record<DialogueState, number>>;
      }>
    >();
    expectTypeOf<ResolveDurableEpisodeProductionStateInput>().toEqualTypeOf<
      Readonly<{
        episode: EpisodeManifest;
        bible: CharacterBible;
        rules: ProductionRules;
        policy: ProviderRoutingPolicy;
        mediaRoot: string;
        ffprobeExecutable: string;
      }>
    >();
    expectTypeOf<ResolveDurableEpisodeProductionStateDependencies>().toEqualTypeOf<
      Readonly<{
        resolveVisualGenerationState: typeof resolveDurableShotVisualGenerationState;
        resolveDialogueCompositionState: typeof resolveDurableShotDialogueCompositionState;
      }>
    >();
  });

  it("AE/AF real C2+C3 defaults on a temp media root: PENDING voice reports DIALOGUE_PLANNING_BLOCKED without writes", async () => {
    const inputs = await canonicalInputs();
    const mediaRoot = await mkdtemp(join(tmpdir(), "busybookie-episode-production-state-"));
    roots.push(mediaRoot);
    const bible = structuredClone(inputs.bible);
    const ollie = bible.characters.find((character) => character.id === "OLLIE")!;
    (ollie as { voice: unknown }).voice = {
      selectionStatus: "PENDING",
      provider: "RUNWAY",
      voiceName: null,
      deliveryTraits: ["young"],
    };

    const result = await resolveDurableEpisodeProductionState({ ...input(inputs.episode, inputs, mediaRoot), bible });

    expect(result.shots.map((shot) => [shot.shotId, shot.visualGenerationState.state, shot.dialogueCompositionState.state])).toEqual([
      ["S01", "CANONICAL_NOT_EXECUTABLE", "NO_DIALOGUE"],
      ["S02", "CANONICAL_NOT_EXECUTABLE", "DIALOGUE_PLANNING_BLOCKED"],
    ]);
    expect(result.summary.dialogueCompositionStates.DIALOGUE_PLANNING_BLOCKED).toBe(1);
    expect(await readdir(mediaRoot, { recursive: true })).toEqual([]);
  });

  it("AE real defaults with the locked bible report the canonical states and still write nothing", async () => {
    const inputs = await canonicalInputs();
    const mediaRoot = await mkdtemp(join(tmpdir(), "busybookie-episode-production-state-"));
    roots.push(mediaRoot);

    const result = await resolveDurableEpisodeProductionState(input(inputs.episode, inputs, mediaRoot));

    expect(result.shots.map((shot) => [shot.shotId, shot.visualGenerationState.state, shot.dialogueCompositionState.state])).toEqual([
      ["S01", "CANONICAL_NOT_EXECUTABLE", "NO_DIALOGUE"],
      ["S02", "VISUAL_AUTHORIZATION_REQUIRED", "DIALOGUE_AUDIO_REQUIRED"],
    ]);
    expect(await readdir(mediaRoot, { recursive: true })).toEqual([]);
  });
});
