import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
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

import type {
  DialogueLifecycleClassification,
} from "../src/dialogue/classifyDialogueLifecycle.js";

import {
  createDialogueDirectSeedAudioCompletion,
} from "../src/dialogue/createDialogueDirectSeedAudioCompletion.js";

import {
  createDialogueDirectSeedAudioReservation,
} from "../src/dialogue/createDialogueDirectSeedAudioReservation.js";

import {
  createDialogueDirectSeedAudioSubmission,
} from "../src/dialogue/createDialogueDirectSeedAudioSubmission.js";

import {
  createDialogueDirectSeedAudioCompletionPath,
  createDialogueDirectSeedAudioReservationPath,
  createDialogueDirectSeedAudioSubmissionPath,
} from "../src/dialogue/dialogueDirectSeedAudioLifecyclePaths.js";

import {
  inspectDialogueDirectSeedAudioLifecycle,
} from "../src/dialogue/inspectDialogueDirectSeedAudioLifecycle.js";

import {
  inspectDialogueDirectSeedAudioPlanHistory,
  inspectDialogueDirectSeedAudioPlanLifecycles,
  type DialogueDirectSeedAudioHistoricalLifecycle,
  type DialogueDirectSeedAudioPlanLifecycle,
  type InspectDialogueDirectSeedAudioPlanHistoryDependencies,
} from "../src/dialogue/inspectDialogueDirectSeedAudioPlanHistory.js";

import {
  writeDialogueGenerationRecord,
} from "../src/dialogue/writeDialogueGenerationRecord.js";

const EPISODE_ID = "EP02";
const SCENE_ID = "SC01";
const SHOT_ID = "S02";
const LINE_ID = "EP02_SC01_S02_L01";

const PLAN_A = "a".repeat(64);
const PLAN_B = "b".repeat(64);
const PLAN_C = "c".repeat(64);
const PLAN_D = "d".repeat(64);
const PLAN_E = "e".repeat(64);
const CURRENT_PLAN = "f".repeat(64);

const REFERENCE_AUDIO_SHA256 =
  "ad7bc6a50675bddc74a4885f290667fad1076c5cd3d9844eb7ff2d84b0f94a2f";

const roots: string[] = [];

async function createMediaRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "busybookie-direct-seed-plan-history-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function reservationIdFor(planKey: string): string {
  return `11111111-1111-4111-8111-${planKey.slice(0, 12)}`;
}

function executionIdFor(planKey: string): string {
  return `task-history-${planKey.slice(0, 8)}`;
}

function planDirectory(mediaRoot: string, planKey: string): string {
  return dirname(
    createDialogueDirectSeedAudioReservationPath(
      mediaRoot,
      EPISODE_ID,
      SCENE_ID,
      SHOT_ID,
      LINE_ID,
      planKey,
    ),
  );
}

function historyRoot(mediaRoot: string): string {
  return dirname(planDirectory(mediaRoot, CURRENT_PLAN));
}

function inspectHistory(
  mediaRoot: string,
  dependencies?: InspectDialogueDirectSeedAudioPlanHistoryDependencies,
): Promise<readonly DialogueDirectSeedAudioHistoricalLifecycle[]> {
  return inspectDialogueDirectSeedAudioPlanHistory(
    mediaRoot,
    EPISODE_ID,
    SCENE_ID,
    SHOT_ID,
    LINE_ID,
    CURRENT_PLAN,
    dependencies,
  );
}

function request() {
  return {
    model: "seed_audio",
    promptText: "Look what I found!",
    outputFormat: "mp3",
    sampleRate: 44_100,
    voice: { type: "reference-audio", audioUri: "runway://uploads/ollie-reference-v1" },
  } as const;
}

function planSnapshot(planKey: string) {
  return {
    planKey,
    episodeId: EPISODE_ID,
    sceneId: SCENE_ID,
    shotId: SHOT_ID,
    dialogueLineId: LINE_ID,
    lineNumber: 1,
    characterId: "OLLIE",
    characterName: "Ollie",
    text: "Look what I found!",
    deliveryNotes: "Curious, excited and gentle.",
    voice: {
      selectionStatus: "LOCKED",
      provider: "RUNWAY",
      voiceName: "Ollie",
      deliveryTraits: ["young", "curious", "warm", "friendly", "natural"] as string[],
      executionMode: "RUNWAY_REFERENCE_AUDIO",
      referenceAudio: {
        assetId: "OLLIE_VOICE_REFERENCE_V1",
        mediaRootRelativePath: "references/voices/OLLIE/ollie-reference-v1.mp3",
        bytes: 231_593,
        sha256: REFERENCE_AUDIO_SHA256,
        contentType: "audio/mpeg",
        durationSeconds: 14.4,
        codecName: "mp3",
        sampleRateHz: 44_100,
        channels: 1,
      },
    },
  } as const;
}

async function reserve(mediaRoot: string, planKey: string): Promise<void> {
  await createDialogueDirectSeedAudioReservation(
    mediaRoot,
    {
      episodeId: EPISODE_ID,
      sceneId: SCENE_ID,
      shotId: SHOT_ID,
      dialogueLineId: LINE_ID,
      planKey,
      provider: "RUNWAY",
    },
    {
      now: () => "2026-10-06T17:00:00.000Z",
      createReservationId: () => reservationIdFor(planKey),
    },
  );
}

async function submit(mediaRoot: string, planKey: string): Promise<void> {
  await reserve(mediaRoot, planKey);
  await createDialogueDirectSeedAudioSubmission(
    mediaRoot,
    {
      reservationId: reservationIdFor(planKey),
      episodeId: EPISODE_ID,
      sceneId: SCENE_ID,
      shotId: SHOT_ID,
      dialogueLineId: LINE_ID,
      planKey,
      provider: "RUNWAY",
      providerExecutionId: executionIdFor(planKey),
      providerEstimatedCredits: 5.25,
      recoveryMetadata: {
        request: request(),
        localCreditCeiling: 30,
        plan: planSnapshot(planKey),
      },
    },
    { now: () => "2026-10-06T17:01:00.000Z" },
  );
}

async function complete(mediaRoot: string, planKey: string): Promise<void> {
  await submit(mediaRoot, planKey);
  const generationRecordPath = await writeDialogueGenerationRecord(mediaRoot, {
    schemaVersion: "3.0",
    recordedAt: "2026-10-06T17:02:00.000Z",
    status: "SUCCEEDED",
    provider: "RUNWAY",
    providerExecutionId: executionIdFor(planKey),
    providerModel: "seed_audio",
    providerCreatedAt: "2026-10-06T17:01:30.000Z",
    request: request(),
    credits: { localCeiling: 30, providerEstimated: 5.25, providerFinal: 4.75 },
    plan: planSnapshot(planKey),
    outputs: [
      {
        outputIndex: 1,
        destinationPath: join(
          mediaRoot,
          "generated-dialogue",
          EPISODE_ID,
          SHOT_ID,
          `${LINE_ID}_RUNWAY_${executionIdFor(planKey)}_01.audio`,
        ),
        bytes: 1_234,
        sha256: "b".repeat(64),
        contentType: "audio/mpeg",
      },
    ],
  });
  await createDialogueDirectSeedAudioCompletion(
    mediaRoot,
    {
      reservationId: reservationIdFor(planKey),
      episodeId: EPISODE_ID,
      sceneId: SCENE_ID,
      shotId: SHOT_ID,
      dialogueLineId: LINE_ID,
      planKey,
      provider: "RUNWAY",
      providerExecutionId: executionIdFor(planKey),
      generationRecordPath,
    },
    { now: () => "2026-10-06T17:03:00.000Z" },
  );
}

// A vi.fn wrapper drops readdir's overload set; the seam itself stays typed
// as the real readdir.
function asReadDirectory(mock: unknown): typeof readdir {
  return mock as typeof readdir;
}

const TEMP_SUFFIX =".part-4242-0f1e2d3c-4b5a-4978-8a6b-5c4d3e2f1a0b";

async function listTree(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .map((entry) => `${join(entry.parentPath, entry.name)}:${entry.isDirectory() ? "d" : "f"}`)
    .sort();
}

describe("BusyBookie direct SeedAudio plan-history inspection", () => {
  it("A returns a frozen empty history when direct-seed-audio/ does not exist", async () => {
    const mediaRoot = await createMediaRoot();

    const history = await inspectHistory(mediaRoot);

    expect(history).toEqual([]);
    expect(Object.isFrozen(history)).toBe(true);
  });

  it("B/Q excludes the current planKey directory and its lifecycle evidence", async () => {
    const mediaRoot = await createMediaRoot();
    await submit(mediaRoot, CURRENT_PLAN);

    const inspectLifecycle = vi.fn(inspectDialogueDirectSeedAudioLifecycle);
    const history = await inspectHistory(mediaRoot, {
      readDirectory: readdir,
      inspectLifecycle,
    });

    expect(history).toEqual([]);
    expect(inspectLifecycle).not.toHaveBeenCalled();
  });

  it("C returns a historical RESERVED_ONLY plan through the real inspector", async () => {
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, PLAN_A);
    await reserve(mediaRoot, CURRENT_PLAN);

    const history = await inspectHistory(mediaRoot);

    expect(history).toHaveLength(1);
    expect(history[0]!.planKey).toBe(PLAN_A);
    expect(history[0]!.lifecycle.state).toBe("RESERVED_ONLY");
    if (history[0]!.lifecycle.state === "RESERVED_ONLY") {
      expect(history[0]!.lifecycle.reservation.planKey).toBe(PLAN_A);
      expect(history[0]!.lifecycle.reservation.reservationId).toBe(reservationIdFor(PLAN_A));
    }
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(history[0])).toBe(true);
  });

  it("D returns a historical SUBMITTED plan", async () => {
    const mediaRoot = await createMediaRoot();
    await submit(mediaRoot, PLAN_A);

    const history = await inspectHistory(mediaRoot);

    expect(history.map((entry) => [entry.planKey, entry.lifecycle.state])).toEqual([
      [PLAN_A, "SUBMITTED"],
    ]);
  });

  it("E/L returns a historical COMPLETED plan with all three canonical files accepted", async () => {
    const mediaRoot = await createMediaRoot();
    await complete(mediaRoot, PLAN_A);

    expect((await readdir(planDirectory(mediaRoot, PLAN_A))).sort()).toEqual([
      `${LINE_ID}.dialogue-completion.json`,
      `${LINE_ID}.dialogue-reservation.json`,
      `${LINE_ID}.dialogue-submission.json`,
    ]);

    const history = await inspectHistory(mediaRoot);

    expect(history.map((entry) => [entry.planKey, entry.lifecycle.state])).toEqual([
      [PLAN_A, "COMPLETED"],
    ]);
  });

  it("F classifies an empty historical plan directory as NOTHING", async () => {
    const mediaRoot = await createMediaRoot();
    await mkdir(planDirectory(mediaRoot, PLAN_A), { recursive: true });

    const history = await inspectHistory(mediaRoot);

    expect(history).toEqual([{ planKey: PLAN_A, lifecycle: { state: "NOTHING" } }]);
  });

  it("G returns multiple historical plans sorted ascending by planKey", async () => {
    const mediaRoot = await createMediaRoot();
    await complete(mediaRoot, PLAN_D);
    await reserve(mediaRoot, PLAN_B);
    await mkdir(planDirectory(mediaRoot, PLAN_E), { recursive: true });
    await submit(mediaRoot, PLAN_A);
    await reserve(mediaRoot, CURRENT_PLAN);
    await submit(mediaRoot, PLAN_C);

    const history = await inspectHistory(mediaRoot);

    expect(history.map((entry) => [entry.planKey, entry.lifecycle.state])).toEqual([
      [PLAN_A, "SUBMITTED"],
      [PLAN_B, "RESERVED_ONLY"],
      [PLAN_C, "SUBMITTED"],
      [PLAN_D, "COMPLETED"],
      [PLAN_E, "NOTHING"],
    ]);
  });

  it.each([
    // Distinct from PLAN_A so a case-insensitive filesystem cannot alias it.
    ["uppercase digest", "C".repeat(64)],
    ["short digest", "a".repeat(63)],
    ["arbitrary name", "old-plan"],
  ])("H rejects a %s directory in direct-seed-audio/", async (_label, name) => {
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, PLAN_A);
    await mkdir(join(historyRoot(mediaRoot), name), { recursive: true });

    await expect(inspectHistory(mediaRoot)).rejects.toThrow(
      /Unexpected directory in direct SeedAudio history \(not a planKey\)/,
    );
  });

  it.each([
    ["stray file", "notes.txt"],
    ["planKey-named file", PLAN_A],
    ["current-planKey-named file", CURRENT_PLAN],
  ])("I rejects a non-directory entry (%s) in direct-seed-audio/", async (_label, name) => {
    const mediaRoot = await createMediaRoot();
    await mkdir(historyRoot(mediaRoot), { recursive: true });
    await writeFile(join(historyRoot(mediaRoot), name), "x", "utf8");

    await expect(inspectHistory(mediaRoot)).rejects.toThrow(
      /Unexpected non-directory entry in direct SeedAudio history/,
    );
  });

  it.each([
    ["unknown file", "notes.txt"],
    ["other line's reservation", "EP02_SC01_S02_L02.dialogue-reservation.json"],
    ["generation record name", `${LINE_ID}.dialogue-generation.json`],
    ["temp with a bad identity", `${LINE_ID}.dialogue-reservation.json.part-abc`],
    ["temp for an unknown file", `notes.txt${TEMP_SUFFIX}`],
    ["double temp marker", `${LINE_ID}.dialogue-reservation.json${TEMP_SUFFIX}${TEMP_SUFFIX}`],
  ])("J rejects an unexpected file (%s) inside a historical plan directory", async (_label, name) => {
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, PLAN_A);
    await writeFile(join(planDirectory(mediaRoot, PLAN_A), name), "x", "utf8");

    await expect(inspectHistory(mediaRoot)).rejects.toThrow(
      /Unexpected entry in historical direct SeedAudio plan directory/,
    );
  });

  it.each([
    ["nested directory", "nested"],
    ["directory named like the reservation", `${LINE_ID}.dialogue-reservation.json`],
    ["directory named like a canonical temp", `${LINE_ID}.dialogue-submission.json${TEMP_SUFFIX}`],
  ])("K rejects a non-file entry (%s) inside a historical plan directory", async (_label, name) => {
    const mediaRoot = await createMediaRoot();
    await mkdir(join(planDirectory(mediaRoot, PLAN_A), name), { recursive: true });

    await expect(inspectHistory(mediaRoot)).rejects.toThrow(
      /Unexpected (non-file )?entry in historical direct SeedAudio plan directory/,
    );
  });

  it("M accepts canonical .part temp files and leaves classification to the durable records", async () => {
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, PLAN_A);
    const directory = planDirectory(mediaRoot, PLAN_A);
    for (const kind of ["reservation", "submission", "completion"]) {
      await writeFile(join(directory, `${LINE_ID}.dialogue-${kind}.json${TEMP_SUFFIX}`), "{", "utf8");
    }

    const history = await inspectHistory(mediaRoot);

    expect(history.map((entry) => [entry.planKey, entry.lifecycle.state])).toEqual([
      [PLAN_A, "RESERVED_ONLY"],
    ]);
  });

  it("N fails hard on a malformed historical reservation", async () => {
    const mediaRoot = await createMediaRoot();
    const reservationPath = createDialogueDirectSeedAudioReservationPath(
      mediaRoot,
      EPISODE_ID,
      SCENE_ID,
      SHOT_ID,
      LINE_ID,
      PLAN_A,
    );
    await mkdir(dirname(reservationPath), { recursive: true });
    await writeFile(reservationPath, "{not json", "utf8");

    await expect(inspectHistory(mediaRoot)).rejects.toThrow(
      /Dialogue direct SeedAudio reservation is not valid JSON/,
    );
  });

  it("O fails hard on an orphan historical submission", async () => {
    const mediaRoot = await createMediaRoot();
    await submit(mediaRoot, PLAN_A);
    await rm(
      createDialogueDirectSeedAudioReservationPath(
        mediaRoot,
        EPISODE_ID,
        SCENE_ID,
        SHOT_ID,
        LINE_ID,
        PLAN_A,
      ),
    );

    await expect(inspectHistory(mediaRoot)).rejects.toThrow(
      "Dialogue lifecycle submission exists without a durable reservation.",
    );
  });

  it("P fails hard when a historical record contradicts its plan-scoped path", async () => {
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, PLAN_A);
    await mkdir(planDirectory(mediaRoot, PLAN_B), { recursive: true });
    await writeFile(
      createDialogueDirectSeedAudioReservationPath(
        mediaRoot,
        EPISODE_ID,
        SCENE_ID,
        SHOT_ID,
        LINE_ID,
        PLAN_B,
      ),
      await readFile(
        createDialogueDirectSeedAudioReservationPath(
          mediaRoot,
          EPISODE_ID,
          SCENE_ID,
          SHOT_ID,
          LINE_ID,
          PLAN_A,
        ),
        "utf8",
      ),
      "utf8",
    );

    await expect(inspectHistory(mediaRoot)).rejects.toThrow(
      /Dialogue direct SeedAudio reservation identity does not match its deterministic plan-scoped path/,
    );
  });

  it("does not hide corruption in a later historical plan behind an earlier valid one", async () => {
    const mediaRoot = await createMediaRoot();
    await complete(mediaRoot, PLAN_A);
    await submit(mediaRoot, PLAN_B);
    await rm(
      createDialogueDirectSeedAudioSubmissionPath(
        mediaRoot,
        EPISODE_ID,
        SCENE_ID,
        SHOT_ID,
        LINE_ID,
        PLAN_B,
      ),
    );
    await writeFile(
      createDialogueDirectSeedAudioCompletionPath(
        mediaRoot,
        EPISODE_ID,
        SCENE_ID,
        SHOT_ID,
        LINE_ID,
        PLAN_B,
      ),
      await readFile(
        createDialogueDirectSeedAudioCompletionPath(
          mediaRoot,
          EPISODE_ID,
          SCENE_ID,
          SHOT_ID,
          LINE_ID,
          PLAN_A,
        ),
        "utf8",
      ),
      "utf8",
    );

    await expect(inspectHistory(mediaRoot)).rejects.toThrow();
  });

  it("propagates a non-ENOENT root read failure unchanged", async () => {
    const mediaRoot = await createMediaRoot();
    const failure = Object.assign(new Error("controlled EACCES"), { code: "EACCES" });
    const readDirectory = vi
      .fn<InspectDialogueDirectSeedAudioPlanHistoryDependencies["readDirectory"]>()
      .mockRejectedValue(failure);
    const inspectLifecycle = vi.fn<
      InspectDialogueDirectSeedAudioPlanHistoryDependencies["inspectLifecycle"]
    >();

    await expect(
      inspectHistory(mediaRoot, { readDirectory: asReadDirectory(readDirectory), inspectLifecycle }),
    ).rejects.toBe(failure);
    expect(inspectLifecycle).not.toHaveBeenCalled();
  });

  it("propagates a historical plan-directory read failure", async () => {
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, PLAN_A);
    const failure = Object.assign(new Error("controlled EIO"), { code: "EIO" });
    let calls = 0;
    const readDirectory = vi.fn(((...args: Parameters<typeof readdir>) => {
      calls += 1;
      if (calls === 2) {
        return Promise.reject(failure);
      }
      return readdir(...args);
    }) as typeof readdir);

    await expect(
      inspectHistory(mediaRoot, {
        readDirectory: asReadDirectory(readDirectory),
        inspectLifecycle: inspectDialogueDirectSeedAudioLifecycle,
      }),
    ).rejects.toBe(failure);
  });

  it("S uses the injected seams with the bounded line-specific root and each historical planKey", async () => {
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, PLAN_B);
    await reserve(mediaRoot, PLAN_A);
    await reserve(mediaRoot, CURRENT_PLAN);

    const readDirectory = vi.fn(readdir);
    const classification = Object.freeze({ state: "NOTHING" as const });
    const inspectLifecycle = vi.fn<
      InspectDialogueDirectSeedAudioPlanHistoryDependencies["inspectLifecycle"]
    >(async () => classification);

    const history = await inspectHistory(mediaRoot, { readDirectory: asReadDirectory(readDirectory), inspectLifecycle });

    expect(readDirectory.mock.calls.map((call) => call[0])).toEqual([
      historyRoot(mediaRoot),
      planDirectory(mediaRoot, PLAN_A),
      planDirectory(mediaRoot, PLAN_B),
    ]);
    expect(historyRoot(mediaRoot)).toBe(
      join(mediaRoot, "voices", EPISODE_ID, SHOT_ID, LINE_ID, "direct-seed-audio"),
    );
    expect(inspectLifecycle.mock.calls).toEqual([
      [mediaRoot, EPISODE_ID, SCENE_ID, SHOT_ID, LINE_ID, PLAN_A],
      [mediaRoot, EPISODE_ID, SCENE_ID, SHOT_ID, LINE_ID, PLAN_B],
    ]);
    expect(history[0]!.lifecycle).toBe(classification);
    expect(history[1]!.lifecycle).toBe(classification);
  });

  it("propagates an injected inspector failure unchanged", async () => {
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, PLAN_A);
    const failure = new Error("controlled historical corruption");

    await expect(
      inspectHistory(mediaRoot, {
        readDirectory: readdir,
        inspectLifecycle: vi.fn(async () => {
          throw failure;
        }),
      }),
    ).rejects.toBe(failure);
  });

  it("validates identity through the existing path helper before reading", async () => {
    const mediaRoot = await createMediaRoot();
    const readDirectory = vi.fn(readdir);

    await expect(
      inspectDialogueDirectSeedAudioPlanHistory(
        mediaRoot,
        EPISODE_ID,
        SCENE_ID,
        SHOT_ID,
        "EP02_SC01_S03_L01",
        CURRENT_PLAN,
        { readDirectory: asReadDirectory(readDirectory), inspectLifecycle: inspectDialogueDirectSeedAudioLifecycle },
      ),
    ).rejects.toThrow(/line identity does not match/);

    await expect(
      inspectDialogueDirectSeedAudioPlanHistory(
        mediaRoot,
        EPISODE_ID,
        SCENE_ID,
        SHOT_ID,
        LINE_ID,
        "not-a-plan-key",
        { readDirectory: asReadDirectory(readDirectory), inspectLifecycle: inspectDialogueDirectSeedAudioLifecycle },
      ),
    ).rejects.toThrow();

    expect(readDirectory).not.toHaveBeenCalled();
  });

  it("does not scan sibling lines, shots or the general voices tree", async () => {
    const mediaRoot = await createMediaRoot();
    await mkdir(join(mediaRoot, "voices", EPISODE_ID, SHOT_ID, "EP02_SC01_S02_L02", "direct-seed-audio", "junk"), {
      recursive: true,
    });
    await mkdir(join(mediaRoot, "voices", EPISODE_ID, "S01", "junk"), { recursive: true });
    await writeFile(join(mediaRoot, "voices", "stray.txt"), "x", "utf8");

    await expect(inspectHistory(mediaRoot)).resolves.toEqual([]);
  });

  it("R performs no writes to the media root", async () => {
    const mediaRoot = await createMediaRoot();
    await complete(mediaRoot, PLAN_A);
    await submit(mediaRoot, PLAN_B);
    await mkdir(planDirectory(mediaRoot, PLAN_C), { recursive: true });
    await writeFile(
      join(planDirectory(mediaRoot, PLAN_B), `${LINE_ID}.dialogue-completion.json${TEMP_SUFFIX}`),
      "{",
      "utf8",
    );

    const before = await listTree(mediaRoot);
    const beforeMtime = (await stat(historyRoot(mediaRoot))).mtimeMs;

    await inspectHistory(mediaRoot);

    expect(await listTree(mediaRoot)).toEqual(before);
    expect((await stat(historyRoot(mediaRoot))).mtimeMs).toBe(beforeMtime);
  });

  it("R imports no write, provider or process APIs", async () => {
    const source = await readFile(
      new URL("../src/dialogue/inspectDialogueDirectSeedAudioPlanHistory.ts", import.meta.url),
      "utf8",
    );

    const imports = [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)].map(
      (match) => `${match[2]}:${match[1]!.replace(/\s+/g, "")}`,
    );

    expect(imports).toEqual([
      "node:fs:Dirent,",
      "node:fs/promises:readdir,",
      "node:path:basename,dirname,join,",
      "./classifyDialogueLifecycle.js:DialogueLifecycleClassification,",
      "./dialogueDirectSeedAudioLifecyclePaths.js:createDialogueDirectSeedAudioCompletionPath,createDialogueDirectSeedAudioLineDirectory,createDialogueDirectSeedAudioReservationPath,createDialogueDirectSeedAudioSubmissionPath,",
      "./dialogueReservation.schema.js:DialogueReservationPlanKeySchema,",
      "./inspectDialogueDirectSeedAudioLifecycle.js:inspectDialogueDirectSeedAudioLifecycle,",
    ]);

    expect(source).not.toMatch(
      /\b(writeFile|mkdir|unlink|rename|copyFile|rm|appendFile|open|create(Dialogue|Runway)\w*(Reservation|Submission|Completion|Decision|Executor|Reconciler)|reconcile\w*|spawn|execFile|fetch)\s*\(/,
    );
  });

  it("exposes the locked signature and readonly result type", () => {
    expectTypeOf(inspectDialogueDirectSeedAudioPlanHistory).parameters.toEqualTypeOf<
      [
        string,
        string,
        string,
        string,
        string,
        string,
        (InspectDialogueDirectSeedAudioPlanHistoryDependencies | undefined)?,
      ]
    >();
    expectTypeOf(inspectDialogueDirectSeedAudioPlanHistory).returns.toEqualTypeOf<
      Promise<readonly DialogueDirectSeedAudioHistoricalLifecycle[]>
    >();
    expectTypeOf<DialogueDirectSeedAudioHistoricalLifecycle>().toEqualTypeOf<
      Readonly<{ planKey: string; lifecycle: DialogueLifecycleClassification }>
    >();
    expectTypeOf<InspectDialogueDirectSeedAudioPlanHistoryDependencies>().toEqualTypeOf<
      Readonly<{
        readDirectory: typeof readdir;
        inspectLifecycle: typeof inspectDialogueDirectSeedAudioLifecycle;
      }>
    >();
  });
});

describe("BusyBookie direct SeedAudio all-plan inspection", () => {
  function inspectAllPlans(
    mediaRoot: string,
    dependencies?: InspectDialogueDirectSeedAudioPlanHistoryDependencies,
  ): Promise<readonly DialogueDirectSeedAudioPlanLifecycle[]> {
    return inspectDialogueDirectSeedAudioPlanLifecycles(
      mediaRoot,
      EPISODE_ID,
      SCENE_ID,
      SHOT_ID,
      LINE_ID,
      dependencies,
    );
  }

  it("A returns a frozen empty result when the line directory does not exist", async () => {
    const mediaRoot = await createMediaRoot();

    const plans = await inspectAllPlans(mediaRoot);

    expect(plans).toEqual([]);
    expect(Object.isFrozen(plans)).toBe(true);
  });

  it("B-H returns every plan, including NOTHING and the would-be current plan, sorted ascending", async () => {
    const mediaRoot = await createMediaRoot();
    await complete(mediaRoot, PLAN_D);
    await reserve(mediaRoot, PLAN_B);
    await mkdir(planDirectory(mediaRoot, PLAN_E), { recursive: true });
    await submit(mediaRoot, PLAN_A);
    await reserve(mediaRoot, CURRENT_PLAN);

    const plans = await inspectAllPlans(mediaRoot);

    expect(plans.map((entry) => [entry.planKey, entry.lifecycle.state])).toEqual([
      [PLAN_A, "SUBMITTED"],
      [PLAN_B, "RESERVED_ONLY"],
      [PLAN_D, "COMPLETED"],
      [PLAN_E, "NOTHING"],
      [CURRENT_PLAN, "RESERVED_ONLY"],
    ]);
    expect(Object.isFrozen(plans)).toBe(true);
    for (const entry of plans) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });

  it("I rejects an invalid planKey directory in the line directory", async () => {
    const mediaRoot = await createMediaRoot();
    await mkdir(join(historyRoot(mediaRoot), "old-plan"), { recursive: true });

    await expect(inspectAllPlans(mediaRoot)).rejects.toThrow(
      /Unexpected directory in direct SeedAudio history \(not a planKey\)/,
    );
  });

  it("J rejects a non-directory entry in the line directory", async () => {
    const mediaRoot = await createMediaRoot();
    await mkdir(historyRoot(mediaRoot), { recursive: true });
    await writeFile(join(historyRoot(mediaRoot), "notes.txt"), "x", "utf8");

    await expect(inspectAllPlans(mediaRoot)).rejects.toThrow(
      /Unexpected non-directory entry in direct SeedAudio history/,
    );
  });

  it.each([
    ["unexpected file", "notes.txt", false],
    ["directory named like a canonical file", `${LINE_ID}.dialogue-reservation.json`, true],
  ])("K rejects an %s inside any plan directory", async (_label, name, directory) => {
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, PLAN_A);
    if (directory) {
      await mkdir(join(planDirectory(mediaRoot, PLAN_B), name), { recursive: true });
    } else {
      await writeFile(join(planDirectory(mediaRoot, PLAN_A), name), "x", "utf8");
    }

    await expect(inspectAllPlans(mediaRoot)).rejects.toThrow(
      /Unexpected (non-file )?entry in direct SeedAudio plan directory/,
    );
  });

  it("T an unexpected file in the plan the caller treats as current also fails (no exclusion)", async () => {
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, CURRENT_PLAN);
    await writeFile(join(planDirectory(mediaRoot, CURRENT_PLAN), "notes.txt"), "x", "utf8");

    await expect(inspectAllPlans(mediaRoot)).rejects.toThrow(
      /Unexpected entry in direct SeedAudio plan directory/,
    );
  });

  it("canonical .part temp files are accepted", async () => {
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, PLAN_A);
    await writeFile(
      join(planDirectory(mediaRoot, PLAN_A), `${LINE_ID}.dialogue-submission.json${TEMP_SUFFIX}`),
      "{",
      "utf8",
    );

    const plans = await inspectAllPlans(mediaRoot);

    expect(plans.map((entry) => entry.lifecycle.state)).toEqual(["RESERVED_ONLY"]);
  });

  it("L malformed lifecycle record fails hard", async () => {
    const mediaRoot = await createMediaRoot();
    const reservationPath = createDialogueDirectSeedAudioReservationPath(
      mediaRoot,
      EPISODE_ID,
      SCENE_ID,
      SHOT_ID,
      LINE_ID,
      PLAN_A,
    );
    await mkdir(dirname(reservationPath), { recursive: true });
    await writeFile(reservationPath, "{not json", "utf8");

    await expect(inspectAllPlans(mediaRoot)).rejects.toThrow(/not valid JSON/);
  });

  it("M orphan lifecycle chain fails hard", async () => {
    const mediaRoot = await createMediaRoot();
    await submit(mediaRoot, PLAN_A);
    await rm(
      createDialogueDirectSeedAudioReservationPath(mediaRoot, EPISODE_ID, SCENE_ID, SHOT_ID, LINE_ID, PLAN_A),
    );

    await expect(inspectAllPlans(mediaRoot)).rejects.toThrow(
      "Dialogue lifecycle submission exists without a durable reservation.",
    );
  });

  it("N identity contradiction with the plan-scoped path fails hard", async () => {
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, PLAN_A);
    await mkdir(planDirectory(mediaRoot, PLAN_B), { recursive: true });
    await writeFile(
      createDialogueDirectSeedAudioReservationPath(mediaRoot, EPISODE_ID, SCENE_ID, SHOT_ID, LINE_ID, PLAN_B),
      await readFile(
        createDialogueDirectSeedAudioReservationPath(mediaRoot, EPISODE_ID, SCENE_ID, SHOT_ID, LINE_ID, PLAN_A),
        "utf8",
      ),
      "utf8",
    );

    await expect(inspectAllPlans(mediaRoot)).rejects.toThrow(
      /identity does not match its deterministic plan-scoped path/,
    );
  });

  it("O/P history still excludes currentPlanKey and never inspects or enumerates its contents", async () => {
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, PLAN_A);
    await reserve(mediaRoot, CURRENT_PLAN);
    await writeFile(join(planDirectory(mediaRoot, CURRENT_PLAN), "notes.txt"), "x", "utf8");

    const readDirectory = vi.fn(readdir);
    const inspectLifecycle = vi.fn(inspectDialogueDirectSeedAudioLifecycle);
    const history = await inspectHistory(mediaRoot, {
      readDirectory: asReadDirectory(readDirectory),
      inspectLifecycle,
    });

    expect(history.map((entry) => [entry.planKey, entry.lifecycle.state])).toEqual([[PLAN_A, "RESERVED_ONLY"]]);
    expect(readDirectory.mock.calls.map((call) => call[0])).toEqual([
      historyRoot(mediaRoot),
      planDirectory(mediaRoot, PLAN_A),
    ]);
    expect(inspectLifecycle.mock.calls.map((call) => call[5])).toEqual([PLAN_A]);
  });

  it("Q/R/S history ordering, ENOENT and included-plan corruption behaviour are unchanged", async () => {
    const empty = await createMediaRoot();
    await expect(inspectHistory(empty)).resolves.toEqual([]);

    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, PLAN_C);
    await submit(mediaRoot, PLAN_A);
    await reserve(mediaRoot, CURRENT_PLAN);
    expect((await inspectHistory(mediaRoot)).map((entry) => entry.planKey)).toEqual([PLAN_A, PLAN_C]);

    await writeFile(join(planDirectory(mediaRoot, PLAN_C), "notes.txt"), "x", "utf8");
    await expect(inspectHistory(mediaRoot)).rejects.toThrow(
      /Unexpected entry in historical direct SeedAudio plan directory/,
    );
  });

  it("uses the injected seams with the line directory and every planKey, none excluded", async () => {
    const mediaRoot = await createMediaRoot();
    await reserve(mediaRoot, PLAN_B);
    await reserve(mediaRoot, CURRENT_PLAN);
    const readDirectory = vi.fn(readdir);
    const classification = Object.freeze({ state: "NOTHING" as const });
    const inspectLifecycle = vi.fn<
      InspectDialogueDirectSeedAudioPlanHistoryDependencies["inspectLifecycle"]
    >(async () => classification);

    await inspectAllPlans(mediaRoot, { readDirectory: asReadDirectory(readDirectory), inspectLifecycle });

    expect(readDirectory.mock.calls[0]![0]).toBe(
      join(mediaRoot, "voices", EPISODE_ID, SHOT_ID, LINE_ID, "direct-seed-audio"),
    );
    expect(inspectLifecycle.mock.calls).toEqual([
      [mediaRoot, EPISODE_ID, SCENE_ID, SHOT_ID, LINE_ID, PLAN_B],
      [mediaRoot, EPISODE_ID, SCENE_ID, SHOT_ID, LINE_ID, CURRENT_PLAN],
    ]);
  });

  it("propagates a non-ENOENT line-directory read failure unchanged", async () => {
    const mediaRoot = await createMediaRoot();
    const failure = Object.assign(new Error("controlled EACCES"), { code: "EACCES" });
    const readDirectory = vi
      .fn<InspectDialogueDirectSeedAudioPlanHistoryDependencies["readDirectory"]>()
      .mockRejectedValue(failure);

    await expect(
      inspectAllPlans(mediaRoot, {
        readDirectory: asReadDirectory(readDirectory),
        inspectLifecycle: inspectDialogueDirectSeedAudioLifecycle,
      }),
    ).rejects.toBe(failure);
  });

  it("validates identity before any read and never scans sibling lines", async () => {
    const mediaRoot = await createMediaRoot();
    const readDirectory = vi.fn(readdir);

    await expect(
      inspectDialogueDirectSeedAudioPlanLifecycles(mediaRoot, EPISODE_ID, SCENE_ID, SHOT_ID, "EP02_SC01_S03_L01", {
        readDirectory: asReadDirectory(readDirectory),
        inspectLifecycle: inspectDialogueDirectSeedAudioLifecycle,
      }),
    ).rejects.toThrow(/line identity does not match/);
    expect(readDirectory).not.toHaveBeenCalled();

    await mkdir(join(mediaRoot, "voices", EPISODE_ID, SHOT_ID, "EP02_SC01_S02_L02", "direct-seed-audio", "junk"), {
      recursive: true,
    });
    await expect(inspectAllPlans(mediaRoot)).resolves.toEqual([]);
  });

  it("U performs no writes", async () => {
    const mediaRoot = await createMediaRoot();
    await complete(mediaRoot, PLAN_A);
    await submit(mediaRoot, PLAN_B);
    await mkdir(planDirectory(mediaRoot, PLAN_C), { recursive: true });
    const before = await listTree(mediaRoot);

    await inspectAllPlans(mediaRoot);

    expect(await listTree(mediaRoot)).toEqual(before);
  });

  it("exposes the locked all-plan signature and result type", () => {
    expectTypeOf(inspectDialogueDirectSeedAudioPlanLifecycles).parameters.toEqualTypeOf<
      [string, string, string, string, string, (InspectDialogueDirectSeedAudioPlanHistoryDependencies | undefined)?]
    >();
    expectTypeOf(inspectDialogueDirectSeedAudioPlanLifecycles).returns.toEqualTypeOf<
      Promise<readonly DialogueDirectSeedAudioPlanLifecycle[]>
    >();
    expectTypeOf<DialogueDirectSeedAudioPlanLifecycle>().toEqualTypeOf<
      Readonly<{ planKey: string; lifecycle: DialogueLifecycleClassification }>
    >();
    expectTypeOf<DialogueDirectSeedAudioHistoricalLifecycle>().toEqualTypeOf<DialogueDirectSeedAudioPlanLifecycle>();
  });
});
